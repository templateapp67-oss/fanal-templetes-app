import { appointmentInstant } from './appointmentTime.js';
export { appointmentInstant } from './appointmentTime.js';
import { createHash } from 'node:crypto';
import { BackendError, databaseForToken, readDatabase } from './backendContext.js';
import { createRazorpayClient } from './razorpay.js';
import { NORMALIZED_BOOKING_SELECT, presentBooking } from './normalizedBookingAccess.js';

export function catalogId(salon: string, kind: string, id: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
  const hash = createHash('md5').update(`${salon}:${kind}:${id}`).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
}
/** The existing database RPC owns price calculation, slot validation and atomic insertion. */
export async function createNormalizedBooking(db: any, req: any, actor: string, body: any, verifiedPaymentId: string | null, integrations = { userDatabase: databaseForToken, gateway: createRazorpayClient }) {
  const booking = body.booking;
  if (booking?.booking_type === 'home') throw new BackendError(422, 'Home visits are not available through this booking service yet. Please contact the salon.', 'home_booking_unavailable');
  const slug = String(body.subdomain || booking?.subdomain || '').trim().toLowerCase();
  let query = db.from('salons').select('id,timezone,accepts_online_bookings').eq('is_active', true);
  if (slug) query = query.eq('slug', slug);
  else if (body.salon_id) query = query.eq('id', body.salon_id);
  else throw new BackendError(400, 'A salon must be selected.');
  const salon = await readDatabase(() => query.maybeSingle());
  if (!salon || !salon.accepts_online_bookings) throw new BackendError(409, 'This salon is not currently accepting online bookings.');
  const ids = [...new Set<string>((booking.services?.length ? booking.services.map((s: any)=>String(s.service_id)) : [String(booking.service_id || '')]).map((id: string)=>catalogId(salon.id,'service',id)))];
  const services = await readDatabase(() => db.from('services').select('id,price_paise').eq('salon_id', salon.id).eq('is_active', true).eq('is_bookable_online', true).in('id', ids));
  if (!ids.length || services?.length !== ids.length) throw new BackendError(409, 'The selected service is no longer available. Reload the salon menu.');
  const totalPaise = services.reduce((sum: number,s: any)=>sum+Number(s.price_paise),0);
  const reference = String(body.idempotency_key || booking.payment_id || '').trim();
  if (!reference || reference.length > 200) throw new BackendError(400, 'A booking reference is required.');
  const idempotencyKey = createHash('sha256').update(`${actor}:${reference}`).digest('hex');
  let staffId: string | null = null;
  const selectedStaff = booking.staff_id || booking.metadata?.stylist_id;
  if (selectedStaff && selectedStaff !== 'any') {
    staffId = catalogId(salon.id,'staff',String(selectedStaff));
    const staff = await readDatabase(() => db.from('staff').select('id').eq('id',staffId).eq('salon_id',salon.id).eq('is_active',true).maybeSingle());
    if (!staff) throw new BackendError(409,'The selected specialist is unavailable.');
  }
  const start = appointmentInstant(booking.booking_date,booking.time_slot,salon.timezone);
  const customerName = String(booking.customer_name || '').trim().slice(0, 120);
  const customerPhone = String(booking.customer_phone || '').replace(/[^\d+]/g, '').slice(0, 20);
  if (!customerName) throw new BackendError(400, 'A customer name is required.');
  if (!/^[+\d]{7,20}$/.test(customerPhone)) throw new BackendError(400, 'A valid contact phone number is required.');
  const customerEmail = booking.customer_email ? String(booking.customer_email).trim().toLowerCase().slice(0, 254) : null;
  const note = String(booking.notes || '').slice(0, 2000);
  let payment: any = null;
  if (verifiedPaymentId) {
    payment = await integrations.gateway()?.fetchPayment?.(verifiedPaymentId,req.res?.locals?.requestDeadlineAt);
    if (!payment?.captured || payment.orderId !== body.payment?.razorpay_order_id || payment.currency !== 'INR' || payment.amountPaidRupees <= 0 || Math.round(payment.amountPaidRupees*100) > totalPaise) throw new BackendError(409,'The gateway payment could not be matched to this booking.','payment_unverified');
    const order=await integrations.gateway()?.fetchOrder?.(payment.orderId,req.res?.locals?.requestDeadlineAt);
    if (!order || order.notes?.nexora_actor !== actor || order.notes?.nexora_salon !== salon.id || order.notes?.nexora_reference !== reference || order.notes?.nexora_start !== start || order.notes?.nexora_services !== createHash('sha256').update(ids.slice().sort().join(',')).digest('hex')) throw new BackendError(409,'This payment order does not match your account and booking.','payment_order_mismatch');
    const used = await readDatabase(() => db.from('payments').select('booking_id').eq('provider_payment_id',verifiedPaymentId).maybeSingle());
    if (used) {
      const previous = await readDatabase(() => db.from('bookings').select(NORMALIZED_BOOKING_SELECT).eq('id',used.booking_id).eq('customer_user_id',actor).eq('idempotency_key',idempotencyKey).maybeSingle());
      if (!previous) throw new BackendError(409,'This payment is already linked to a booking.','payment_already_used');
      return presentBooking(previous);
    }
  }
  const token = String(req.headers.authorization).replace(/^Bearer\s+/i,'');
  const id = await readDatabase(() => integrations.userDatabase(token).rpc('nexora_create_customer_booking', {
    p_salon_id: salon.id, p_service_ids: ids, p_staff_id: staffId, p_appointment_start: start,
    p_customer_user_id: actor,
    p_customer_name: customerName, p_customer_phone: customerPhone,
    p_customer_email: customerEmail, p_customer_note: note, p_idempotency_key: idempotencyKey,
  }));
  if (!id) throw new BackendError(503,'The database did not return a saved booking.');
  if (payment) {
    await readDatabase(() => db.rpc('record_verified_payment_capture', {
      p_booking_id: id, p_provider: 'razorpay', p_provider_event_id: `checkout:${verifiedPaymentId}`,
      p_provider_order_id: payment.orderId, p_provider_payment_id: verifiedPaymentId,
      p_amount_paise: Math.round(payment.amountPaidRupees*100), p_method: payment.method || 'unknown',
      p_payload_hash: createHash('sha256').update(JSON.stringify(payment)).digest('hex'),
    }));
  }
  const saved = await readDatabase(() => db.from('bookings').select(NORMALIZED_BOOKING_SELECT).eq('id',id).eq('customer_user_id',actor).maybeSingle());
  if (!saved) throw new BackendError(503,'Booking saved, but confirmation could not be loaded. Retry with the same booking reference.');
  return presentBooking(saved);
}
