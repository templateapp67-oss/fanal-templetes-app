import { createHash } from 'node:crypto';
import { BackendError, readDatabase, verifyBackendUser } from './backendContext.js';
import { catalogId } from './normalizedBookingCreate.js';
import { appointmentInstant } from './appointmentTime.js';
import { handleCreateRazorpayOrder } from './razorpay.js';
import { REQUIRED_ADVANCE_PERCENT } from '../src/lib/advanceDeposit.js';
import { minutesNowInTimezone, normalizeBookingDate, todayInTimezone, weekdayForBookingDate } from '../src/lib/customer/bookingDate.js';

function clockMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

async function emptyAvailabilityDetails(db: any, salonId: string, serviceIds: string[], date: string, timezone: string, rpcResult: any) {
  let durationMinutes = Number(rpcResult?.duration_minutes ?? rpcResult?.durationMinutes) || 0;
  let hours: any = null;
  if (!durationMinutes) {
    try {
      const serviceRows = await readDatabase(() => db.from('services').select('duration_minutes').eq('salon_id', salonId).in('id', serviceIds));
      if (Array.isArray(serviceRows) && serviceRows.length) {
        durationMinutes = serviceRows.reduce((sum: number, row: any) => sum + (Number(row?.duration_minutes) || 30), 0);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.warn('[booking availability] Could not read service durations for empty-slot diagnosis:', error);
    }
  }
  try {
    hours = await readDatabase(() => db.from('salon_hours').select('opens_at,closes_at,is_closed').eq('salon_id', salonId).eq('day_of_week', weekdayForBookingDate(date)).maybeSingle());
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.warn('[booking availability] Could not read salon hours for empty-slot diagnosis:', error);
  }

  const opensAt = clockMinutes(hours?.opens_at);
  const closesAt = clockMinutes(hours?.closes_at);
  let remainingMinutes = opensAt !== null && closesAt !== null && closesAt > opensAt ? closesAt - opensAt : null;
  if (remainingMinutes !== null && todayInTimezone(new Date(), timezone) === date) {
    remainingMinutes = Math.max(0, closesAt! - Math.max(opensAt!, minutesNowInTimezone(new Date(), timezone)));
  }

  let reason = 'fully_booked';
  if (Array.isArray(rpcResult?.available_staff) && rpcResult.available_staff.length === 0) reason = 'no_specialist';
  else if (hours?.is_closed === true || opensAt === null || closesAt === null || closesAt <= opensAt) reason = 'schedule_missing';
  else if (durationMinutes > 0 && remainingMinutes !== null && durationMinutes > remainingMinutes) reason = 'duration_overflow';
  return { durationMinutes: durationMinutes || null, remainingMinutes, availabilityReason: reason };
}

export async function customerAvailability(db: any, input: any) {
  const slug = String(input.subdomain || '').trim().toLowerCase();
  if (!slug) throw new BackendError(400, 'Choose a salon.');
  const salon = await readDatabase(() => db.from('salons').select('id,timezone,accepts_online_bookings').eq('slug',slug).eq('is_active',true).is('deleted_at',null).maybeSingle());
  // Availability must mirror the AUTHORITATIVE booking contract exactly. The
  // public storefront is served for any active salon regardless of admin
  // verification, and the booking path gates ONLY on is_active + booking enabled.
  if (!salon) throw new BackendError(404, 'This salon could not be found. Check the link and try again.', 'salon_not_found');
  const acceptsOnlineBookings = salon.accepts_online_bookings ?? true;
  if (!acceptsOnlineBookings) throw new BackendError(409, 'This salon is not accepting online bookings. Contact the salon to book.', 'online_booking_disabled');
  const requested = Array.isArray(input.service_ids) ? input.service_ids : String(input.service_ids || '').split(',').filter(Boolean);
  if (!requested.length || requested.length > 20) throw new BackendError(400,'Choose between 1 and 20 services.');
  const ids = [...new Set<string>(requested.map((id: any)=>catalogId(salon.id,'service',String(id))))];
  const staff = input.staff_id && !['any','any_available'].includes(input.staff_id) ? catalogId(salon.id,'staff',String(input.staff_id)) : null;
  // Availability keys are calendar dates in the salon timezone, never UTC
  // instants. Normalize legacy DD-MM-YYYY input before validating or querying.
  const date = normalizeBookingDate(input.date);
  if (!date) throw new BackendError(400, 'A real YYYY-MM-DD or DD-MM-YYYY date is required to check availability.', 'invalid_date');
  const timezone = String(salon.timezone || 'Asia/Kolkata');
  appointmentInstant(date, '12:00', timezone);
  const rows = await readDatabase(() => db.rpc('nexora_customer_booking_options',{p_salon_id:salon.id,p_service_ids:ids,p_staff_id:staff,p_date:date}));
  const formatter = new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const rawSlots = Array.isArray(rows) ? rows : (Array.isArray(rows?.available_slots) ? rows.available_slots.map((slot:any) => ({slot_start:slot.starts_at,slot_end:slot.ends_at,staff_id:slot.staff_id || staff,total_paise:rows.total_paise})) : []);
  const slots = rawSlots.map((row: any)=>({time:formatter.format(new Date(row.slot_start)),start:row.slot_start,end:row.slot_end,staffId:row.staff_id ?? staff,totalPaise:Number(row.total_paise)}));
  let emptyDetails: any = {};
  if (!slots.length) emptyDetails = await emptyAvailabilityDetails(db, salon.id, ids, date, timezone, rows);
  return {
    success:true,
    salonId:salon.id,
    serviceIds:ids,
    timezone,
    date,
    slots,
    durationMinutes: Number(rows?.duration_minutes) || emptyDetails.durationMinutes || null,
    remainingMinutes: emptyDetails.remainingMinutes ?? null,
    availabilityReason: slots.length ? '' : (emptyDetails.availabilityReason || (rows?.closed ? 'schedule_missing' : 'fully_booked')),
  };
}
export function availabilityHandler(db: any) {
  return async (req:any,res:any) => {
    try { res.set('Cache-Control','no-store');res.json(await customerAvailability(db,req.query)); }
    catch (e:any) {
      if (process.env.NODE_ENV !== 'production') console.error('[booking availability] Request failed:', e);
      res.status(e instanceof BackendError?e.status:503).json({success:false,error:e instanceof BackendError?e.message:'Availability could not be loaded. Please retry.',code:e.code || 'availability_failed'});
    }
  };
}

/** Validate identity, actual capacity and the current quote before opening checkout. */
export function customerPaymentOrderHandler(db:any,isMock:boolean) {
  return async (req:any,res:any) => {
    if (isMock) return handleCreateRazorpayOrder(req,res);
    try {
      const {user}=await verifyBackendUser(db,req);
      const input=req.body || {};
      const availability=await customerAvailability(db,input);
      const option=availability.slots.find((slot:any)=>slot.time===input.time && slot.staffId===input.staff_id);
      if (!option) throw new BackendError(409,'This slot is no longer available. Choose another time.','slot_unavailable');
      if (Math.round(Number(input.totalAmount)*100)!==option.totalPaise) throw new BackendError(409,'The service price changed. Reload the salon menu before paying.','price_changed');
      req.body={...input,totalAmount:option.totalPaise/100,depositPercent:REQUIRED_ADVANCE_PERCENT,receipt:createHash('sha256').update(user.id+':'+String(input.receipt||'')).digest('hex').slice(0,40),notes:{...input.notes,nexora_actor:user.id,nexora_salon:availability.salonId,nexora_reference:String(input.receipt||''),nexora_start:new Date(option.start).toISOString(),nexora_services:createHash('sha256').update(availability.serviceIds.slice().sort().join(',')).digest('hex')}};
      return handleCreateRazorpayOrder(req,res);
    }catch(e:any){
      if (process.env.NODE_ENV !== 'production') console.error('[booking checkout] Order preparation failed:', e);
      res.status(e instanceof BackendError?e.status:503).json({success:false,error:e instanceof BackendError?e.message:'Checkout could not be prepared.',code:e.code || 'checkout_failed'});
    }
  };
}
