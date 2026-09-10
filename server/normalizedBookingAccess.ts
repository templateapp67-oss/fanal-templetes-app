import { appointmentInstant } from './appointmentTime.js';
import { BackendError, databaseForToken, ownerSalonIds, readDatabase, verifyBackendUser } from './backendContext.js';
import { mapOwnerBooking } from './ownerBookings.js';

export const NORMALIZED_BOOKING_SELECT = '*,customer:salon_customers!bookings_salon_customer_id_fkey(name,phone,email),salon:salons!bookings_salon_id_fkey(id,name,slug,address,city,phone,whatsapp,latitude,longitude,timezone,logo_url,cover_url),review:reviews!reviews_booking_id_fkey(rating,review_text,updated_at),items:booking_items(service_id,service_name_snapshot,duration_minutes_snapshot,unit_price_paise,quantity)';
export function presentBooking(row: any, owner = false) {
  const mapped = mapOwnerBooking(row);
  const salon = row.salon || {};
  const result = { ...mapped,
    salon: { ...salon, imageUrl: salon.logo_url || salon.cover_url, currency: row.currency },
    customer_email: row.customer?.email || '',
    services: (row.items || []).map((i: any) => ({ service_id: i.service_id, name: i.service_name_snapshot, price: Number(i.unit_price_paise) / 100, duration: i.duration_minutes_snapshot })),
    notes: row.customer_note || '',
    metadata: { stylist_name: row.staff_name_snapshot || '', ...(row.review ? { review_rating: row.review.rating, review_text: row.review.review_text, reviewed_at: row.review.updated_at } : {}) },
    advance_paid_amount: Number(row.paid_amount || 0),
  };
  if (!owner) { delete result.internal_note; delete result.idempotency_key; delete result.created_by; }
  return result;
}
export async function findAuthorizedBooking(db: any, actor: string, id: string, ownerOnly = false) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new BackendError(400, 'A valid booking id is required.');
  if (!ownerOnly) {
    const own = await readDatabase(() => db.from('bookings').select(NORMALIZED_BOOKING_SELECT).eq('id', id).eq('customer_user_id', actor).maybeSingle());
    if (own) return { row: own, isOwner: false };
  }
  const salons = await ownerSalonIds(db, actor);
  if (salons.length) {
    const owned = await readDatabase(() => db.from('bookings').select(NORMALIZED_BOOKING_SELECT).eq('id', id).in('salon_id', salons).maybeSingle());
    if (owned) return { row: owned, isOwner: true };
  }
  throw new BackendError(404, 'Booking not found.', 'not_found');
}
export async function readNormalizedBooking(db: any, req: any) {
  const { user } = await verifyBackendUser(db, req);
  const { row, isOwner } = await findAuthorizedBooking(db, user.id, String(req.params?.id || ''));
  return { success: true, data: presentBooking(row, isOwner) };
}
export async function listNormalizedCustomerBookings(db: any, actor: string) {
  const rows = await readDatabase(() => db.from('bookings').select(NORMALIZED_BOOKING_SELECT)
    .eq('customer_user_id', actor).order('created_at', { ascending: false }).limit(200));
  return (rows || []).map((row: any) => presentBooking(row));
}

const OWNER_TRANSITIONS: Record<string, string[]> = {
  payment_pending: ['confirmed', 'cancelled', 'reschedule_proposed'],
  pending: ['confirmed', 'cancelled', 'checked_in', 'reschedule_proposed'],
  confirmed: ['cancelled', 'checked_in', 'no_show', 'reschedule_proposed', 'completed'],
  reschedule_requested: ['confirmed', 'cancelled', 'reschedule_proposed'],
  reschedule_proposed: ['confirmed', 'cancelled'],
  checked_in: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};
export function ownerBookingChanges(row: any, input: any) {
  const status = String(input.status || '');
  if (status === row.status) return null;
  if (!OWNER_TRANSITIONS[row.status]?.includes(status)) throw new BackendError(409, `Cannot change ${row.status} to ${status}.`, 'invalid_transition');
  const changes: any = { status, updated_at: new Date().toISOString() };
  const timestamp: Record<string, string> = { confirmed: 'confirmed_at', cancelled: 'cancelled_at', checked_in: 'checked_in_at', in_progress: 'started_at', completed: 'completed_at', no_show: 'no_show_at' };
  if (timestamp[status]) changes[timestamp[status]] = changes.updated_at;
  if (status === 'reschedule_proposed') {
    appointmentInstant(input.proposed_date || '', input.proposed_time_slot || '', row.salon?.timezone || 'Asia/Kolkata');
    changes.proposed_date = input.proposed_date;
    changes.proposed_time_slot = input.proposed_time_slot;
  }
  if (status === 'confirmed' && row.status === 'reschedule_proposed') {
    // Applying a proposal must also move the appointment, not just its label.
    const start = appointmentInstant(row.proposed_date || '', String(row.proposed_time_slot || '').slice(0,5), row.salon?.timezone || 'Asia/Kolkata');
    const duration = Date.parse(row.appointment_end) - Date.parse(row.appointment_start);
    if (!Number.isFinite(duration) || duration <= 0) throw new BackendError(409, 'The existing appointment duration is invalid.');
    changes.appointment_start = start;
    changes.appointment_end = new Date(Date.parse(start) + duration).toISOString();
    changes.proposed_date = null;
    changes.proposed_time_slot = null;
  }
  return changes;
}
export async function updateNormalizedBooking(db: any, req: any) {
  const { user, token } = await verifyBackendUser(db, req);
  const { row, isOwner } = await findAuthorizedBooking(db, user.id, String(req.body?.id || ''));
  if (!isOwner) {
    if (req.body?.status === 'confirmed' && row.status === 'reschedule_proposed') {
      const changes = ownerBookingChanges(row, { status: 'confirmed' });
      const updated = await readDatabase(() => db.from('bookings').update(changes).eq('id', row.id).eq('customer_user_id', user.id).eq('status', 'reschedule_proposed').select('id').maybeSingle());
      if (!updated) throw new BackendError(409, 'The proposed appointment changed. Refresh and try again.');
    } else if (req.body?.status === 'cancelled') {
      const cancelled = await readDatabase(() => databaseForToken(token).rpc('cancel_customer_booking', { p_booking_id: row.id, p_reason: String(req.body?.reason || 'Customer cancellation').slice(0,500) }));
      if (!cancelled) throw new BackendError(409, 'This booking could not be cancelled.');
    } else {
      throw new BackendError(403, 'This change requires the salon owner.');
    }
  } else {
    const changes = ownerBookingChanges(row, req.body);
    if (changes) {
      const updated = await readDatabase(() => db.from('bookings').update(changes).eq('id', row.id).eq('salon_id', row.salon_id).eq('status', row.status).select('id').maybeSingle());
      if (!updated) throw new BackendError(409, 'Booking changed in another tab. Refresh and try again.', 'write_conflict');
    }
  }
  const fresh = await findAuthorizedBooking(db, user.id, row.id);
  return { success: true, data: presentBooking(fresh.row, fresh.isOwner) };
}
