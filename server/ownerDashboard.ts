import { createHash } from 'node:crypto';
import { BackendError, databaseForToken, ownerSalonIds, readDatabase, verifyBackendUser } from './backendContext.js';
import { NORMALIZED_BOOKING_SELECT, presentBooking } from './normalizedBookingAccess.js';
import { appointmentInstant } from './appointmentTime.js';
import { catalogId } from './normalizedBookingCreate.js';
import { mapOwnerBookingDbError } from './ownerBookingErrors.js';

// Page explicitly: PostgREST otherwise silently caps a dashboard at 1,000 rows.
export async function allRows(query: () => any) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await readDatabase(() => query().range(offset, offset + 499));
    rows.push(...(page || []));
    if (!page || page.length < 500) return rows;
    if (rows.length >= 50000) throw new BackendError(422, 'This account needs a date-filtered report; totals have not been truncated.');
  }
}

export async function dashboardSalon(db: any, req: any) {
  const identity = await verifyBackendUser(db, req);
  const ids = await ownerSalonIds(db, identity.user.id);
  if (!ids.length) throw new BackendError(403, 'No active salon membership was found.');
  const slug = String(req.query?.subdomain || req.body?.subdomain || '');
  const salons = await readDatabase(() => db.from('salons').select('id,slug,timezone').in('id', ids));
  const matched = slug ? salons?.filter((salon: any) => salon.slug === slug) : [];
  // Match the workspace RPC: a legacy editor slug may differ from the saved
  // salon slug. A sole authorized salon is unambiguous; never guess among many.
  const salon = matched?.length === 1 ? matched[0] : salons?.length === 1 ? salons[0] : null;
  if (!salon) throw new BackendError(403, 'Select one salon belonging to your account.');
  return { ...identity, salon };
}

export function dashboardAppointment(row: any) {
  const booking = presentBooking(row, true);
  return {
    id: row.id, clientName: booking.customer_name, clientPhone: booking.customer_phone,
    clientEmail: booking.customer_email, serviceId: row.items?.[0]?.service_id || '',
    serviceName: booking.service_name, servicePrice: booking.total_amount,
    stylistId: row.staff_id || '', stylistName: row.staff_name_snapshot || '',
    date: booking.booking_date, time: booking.time_slot, status: row.status,
    paymentStatus: Number(row.paid_amount || 0) >= booking.total_amount && booking.total_amount > 0 ? 'paid_full' : Number(row.paid_amount || 0) > 0 ? 'paid_deposit' : 'pay_at_salon',
    amountPaid: Number(row.paid_amount || 0), createdAt: row.created_at,
  };
}

export async function readOwnerDashboard(db: any, req: any) {
  const { salon } = await dashboardSalon(db, req);
  const bookings = await allRows(() => db.from('bookings').select(NORMALIZED_BOOKING_SELECT).eq('salon_id', salon.id).order('id'));
  const customers = await allRows(() => db.from('salon_customers').select('id,name,phone,email').eq('salon_id', salon.id).order('id'));
  const services = await allRows(() => db.from('services').select('id,name,price_paise,duration_minutes').eq('salon_id',salon.id).eq('is_active',true).order('id'));
  const staff = await allRows(() => db.from('staff').select('id,name,role_title').eq('salon_id',salon.id).eq('is_active',true).order('id'));
  const hours = await readDatabase(() => db.from('salon_hours').select('day_of_week,opens_at,closes_at,is_closed').eq('salon_id',salon.id).order('day_of_week'));
  const clients = customers.map((c: any) => {
    const visits = bookings.filter((b: any) => b.salon_customer_id === c.id && b.status === 'completed');
    return { ...c, totalVisits: visits.length, totalSpent: visits.reduce((sum: number,b: any) => sum + Number(b.total_paise)/100,0),
      lastVisit: visits.map((b: any) => dashboardAppointment(b).date).sort().at(-1) || '', notes: '', favoriteStylist: '' };
  });
  return { success: true, hours, appointments: bookings.map(dashboardAppointment), clients, services: services.map(s => ({ id:s.id,name:s.name,price:Number(s.price_paise)/100,durationMinutes:s.duration_minutes,description:'',category:'',icon:'scissors' })), stylists: staff.map(s => ({id:s.id,name:s.name,role:s.role_title || ''})), loadedAt: new Date().toISOString() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createOwnerAppointment(db: any, req: any, userDatabase = databaseForToken) {
  const { salon, token, user } = await dashboardSalon(db, req);
  const input = req.body || {};
  if (!String(input.clientName || '').trim() || !String(input.clientPhone || '').trim()) throw new BackendError(400, 'Client name and phone are required.');
  if (!input.reference || String(input.reference).length > 100) throw new BackendError(400, 'A booking reference is required.');
  if (input.paymentStatus && input.paymentStatus !== 'pay_at_salon') throw new BackendError(400, 'Record payments through the payment workflow after creating the booking.', 'payment_workflow_required');
  // Only persisted catalogue UUIDs may enter database foreign keys. Editor
  // ids, array indexes, slugs or generated frontend ids are refused here —
  // they can never silently book an arbitrary catalogue record.
  if (!UUID_RE.test(String(input.serviceId || ''))) throw new BackendError(400, 'Choose a service from the saved salon catalogue.', 'service_required');
  if (!UUID_RE.test(String(input.stylistId || ''))) throw new BackendError(400, 'Choose a specialist from the saved salon team.', 'staff_required');
  const serviceId = catalogId(salon.id, 'service', String(input.serviceId));
  const staffId = catalogId(salon.id, 'staff', String(input.stylistId));
  const service = await readDatabase(() => db.from('services').select('id').eq('id',serviceId).eq('salon_id',salon.id).eq('is_active',true).maybeSingle());
  if (!service) throw new BackendError(409, 'The selected service is no longer available in this salon. Refresh the calendar and choose a service from the saved catalogue.', 'service_unavailable');
  const staff = await readDatabase(() => db.from('staff').select('id').eq('id',staffId).eq('salon_id',salon.id).eq('is_active',true).maybeSingle());
  if (!staff) throw new BackendError(409, 'The selected specialist is no longer available in this salon. Refresh the calendar and choose a specialist from the saved team.', 'staff_unavailable');
  // Same idempotency scheme as the customer checkout path: actor + reference
  // hashed to a stable key, so a retried submit returns the original booking.
  const idempotencyKey = createHash('sha256').update(`${user.id}:${String(input.reference)}`).digest('hex');
  let id: string | null = null;
  try {
    id = await readDatabase(() => userDatabase(token).rpc('create_owner_booking', {
      p_salon_id: salon.id, p_service_ids: [serviceId], p_staff_id: staffId,
      p_appointment_start: appointmentInstant(input.date, input.time, salon.timezone || 'Asia/Kolkata'),
      p_customer_user_id: null, p_customer_name: String(input.clientName).trim(), p_customer_phone: String(input.clientPhone).trim(),
      p_customer_email: input.clientEmail ? String(input.clientEmail).trim().slice(0, 254) : null,
      p_customer_note: null, p_is_walk_in: true, p_idempotency_key: idempotencyKey,
    }));
  } catch (error: any) {
    // Diagnostics stay in the server log: the caller identity, resolved salon,
    // catalogue ids and the exact database rejection (code/message/details/hint).
    console.error('[owner-appointment] create_owner_booking rejected', {
      authUid: user.id, salonId: salon.id, serviceId, staffId,
      appointmentStart: input.date && input.time ? `${input.date} ${input.time} (${salon.timezone || 'Asia/Kolkata'})` : null,
      reference: String(input.reference),
      code: error?.code ?? null, message: error?.message ?? String(error),
      details: error?.details ?? null, hint: error?.hint ?? null,
    });
    throw mapOwnerBookingDbError(error);
  }
  if (!id) throw new BackendError(503, 'The appointment was not created. Please retry.', 'booking_not_created');
  return { success: true, id };
}

export function ownerDashboardHandler(db: any, create = false, userDatabase = databaseForToken) {
  return async (req: any, res: any) => {
    try { res.json(await (create ? createOwnerAppointment(db, req, userDatabase) : readOwnerDashboard(db, req))); }
    catch (error: any) {
      if (!(error instanceof BackendError)) {
        // Raw database internals never reach the browser; they land in the
        // server log so a failure can be diagnosed without exposing them.
        console.error('[owner-dashboard] unhandled database rejection', {
          create, code: error?.code ?? null, message: error?.message ?? String(error),
          details: error?.details ?? null, hint: error?.hint ?? null,
        });
        return res.status(503).json({ success: false, error: 'The booking database could not complete this request. Please retry.', code: 'database_unavailable' });
      }
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
  };
}

export function validateSalonHours(input: any, salonId: string) {
  if (!Array.isArray(input) || input.length !== 7 || new Set(input.map(h=>h.day_of_week)).size !== 7) throw new BackendError(400,'Provide all seven days once.');
  return input.map(h => {
    if (!Number.isInteger(h.day_of_week) || h.day_of_week < 0 || h.day_of_week > 6 || typeof h.is_closed !== 'boolean') throw new BackendError(400,'Invalid day or closed status.');
    if (!h.is_closed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.opens_at) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.closes_at) || h.opens_at >= h.closes_at)) throw new BackendError(400,'Choose valid opening and closing times. Closing must be later on the same day.');
    return {salon_id:salonId,day_of_week:h.day_of_week,is_closed:h.is_closed,opens_at:h.is_closed?null:h.opens_at,closes_at:h.is_closed?null:h.closes_at};
  });
}
export function salonHoursHandler(db: any) {
  return async (req: any,res: any) => {
    try {
      const {salon,user}=await dashboardSalon(db,req);
      const salonRow=await readDatabase(()=>db.from('salons').select('organization_id').eq('id',salon.id).single());
      const membership=await readDatabase(()=>db.from('organization_members').select('id').eq('organization_id',salonRow.organization_id).eq('user_id',user.id).eq('status','active').in('role',['owner','manager']).maybeSingle());
      if(!membership)throw new BackendError(403,'Only an owner or manager can change salon hours.');
      const rows=validateSalonHours(req.body?.hours,salon.id);
      const saved=await readDatabase(()=>db.from('salon_hours').upsert(rows,{onConflict:'salon_id,day_of_week'}).select('day_of_week,opens_at,closes_at,is_closed'));
      if(saved?.length!==7)throw new BackendError(409,'Opening hours were not saved.');
      // Missing staff calendars inherit the explicitly saved salon hours.
      // Never overwrite a specialist's individually configured schedule.
      const staff=await readDatabase(()=>db.from('staff').select('id').eq('salon_id',salon.id).eq('is_active',true));
      if(staff?.length){
        const schedules=await readDatabase(()=>db.from('staff_schedules').select('staff_id').in('staff_id',staff.map((s:any)=>s.id)));
        const configured=new Set((schedules||[]).map((s:any)=>s.staff_id));
        const missing=staff.filter((s:any)=>!configured.has(s.id)).flatMap((s:any)=>rows.map(h=>({staff_id:s.id,day_of_week:h.day_of_week,is_working:!h.is_closed,start_time:h.opens_at,end_time:h.closes_at})));
        if(missing.length)await readDatabase(()=>db.from('staff_schedules').upsert(missing,{onConflict:'staff_id,day_of_week',ignoreDuplicates:true}));
      }
      res.json({success:true,hours:saved});
    }catch(error:any){res.status(error instanceof BackendError?error.status:503).json({success:false,error:error instanceof BackendError?error.message:'Opening hours could not be saved.',code:error.code});}
  };
}
