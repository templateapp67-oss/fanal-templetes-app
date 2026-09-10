import { BackendError, databaseForToken, ownerSalonIds, readDatabase, verifyBackendUser } from './backendContext.js';
import { NORMALIZED_BOOKING_SELECT, presentBooking } from './normalizedBookingAccess.js';
import { appointmentInstant } from './appointmentTime.js';
import { catalogId } from './normalizedBookingCreate.js';

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
  const staff = await allRows(() => db.from('staff').select('id,name').eq('salon_id',salon.id).eq('is_active',true).order('id'));
  const clients = customers.map((c: any) => {
    const visits = bookings.filter((b: any) => b.salon_customer_id === c.id && b.status === 'completed');
    return { ...c, totalVisits: visits.length, totalSpent: visits.reduce((sum: number,b: any) => sum + Number(b.total_paise)/100,0),
      lastVisit: visits.map((b: any) => dashboardAppointment(b).date).sort().at(-1) || '', notes: '', favoriteStylist: '' };
  });
  return { success: true, appointments: bookings.map(dashboardAppointment), clients, services: services.map(s => ({ id:s.id,name:s.name,price:Number(s.price_paise)/100,durationMinutes:s.duration_minutes,description:'',category:'',icon:'scissors' })), stylists: staff.map(s => ({id:s.id,name:s.name})), loadedAt: new Date().toISOString() };
}

export async function createOwnerAppointment(db: any, req: any, userDatabase = databaseForToken) {
  const { salon, token } = await dashboardSalon(db, req);
  const input = req.body || {};
  if (!String(input.clientName || '').trim() || !String(input.clientPhone || '').trim()) throw new BackendError(400, 'Client name and phone are required.');
  if (!input.reference || String(input.reference).length > 100) throw new BackendError(400, 'A booking reference is required.');
  if (input.paymentStatus && input.paymentStatus !== 'pay_at_salon') throw new BackendError(400, 'Record payments through the payment workflow after creating the booking.');
  const serviceId = catalogId(salon.id, 'service', String(input.serviceId || ''));
  const staffId = catalogId(salon.id, 'staff', String(input.stylistId || ''));
  const service = await readDatabase(() => db.from('services').select('id').eq('id',serviceId).eq('salon_id',salon.id).eq('is_active',true).maybeSingle());
  const staff = await readDatabase(() => db.from('staff').select('id').eq('id',staffId).eq('salon_id',salon.id).eq('is_active',true).maybeSingle());
  if (!service || !staff) throw new BackendError(409, 'Save an active service and specialist before adding an appointment.');
  const id = await readDatabase(() => userDatabase(token).rpc('create_owner_booking', {
    p_salon_id: salon.id, p_service_ids: [serviceId], p_staff_id: staffId,
    p_appointment_start: appointmentInstant(input.date,input.time,salon.timezone || 'Asia/Kolkata'),
    p_customer_user_id: null, p_customer_name: String(input.clientName).trim(), p_customer_phone: String(input.clientPhone).trim(),
    p_customer_note: input.clientEmail ? `Contact email: ${String(input.clientEmail).slice(0,254)}` : null,
    p_is_walk_in: true, p_idempotency_key: String(input.reference),
  }));
  if (!id) throw new BackendError(409, 'The appointment was not created.');
  return { success: true, id };
}

export function ownerDashboardHandler(db: any, create = false) {
  return async (req: any, res: any) => {
    try { res.json(await (create ? createOwnerAppointment(db,req) : readOwnerDashboard(db,req))); }
    catch (error: any) { res.status(error instanceof BackendError ? error.status : 503).json({ success: false, error: error instanceof BackendError ? error.message : 'The booking database could not complete this request. Please retry.', code: error.code || 'database_unavailable' }); }
  };
}
