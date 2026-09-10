// ============================================================================
// Map raw database/PostgREST rejections of the owner booking workflow into
// actionable application errors.
//
// WHY: for weeks every failed appointment save surfaced as the same opaque
// "The booking database could not complete this request. Please retry." —
// including the actual production failure (PGRST202: the create_owner_booking
// RPC had never been created). Callers now get a message they can act on,
// while the raw code/details/hint stay in the server log (never the browser).
// ============================================================================

import { BackendError } from './backendContext.js';

/** Messages our own create_owner_booking RPC raises with errcode 22023. */
const RPC_INPUT_MESSAGES = /^(A (salon|client name|client phone number|booking reference|appointment start time|specialist|service)|Select (a specialist|at least one service)|The (selected (specialist|service)|salon (customer|bookings) table)|This appointment reference)/i;

export function mapOwnerBookingDbError(error: any, context = 'create_owner_booking'): BackendError {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? error ?? '');
  const detail = String(error?.details ?? '');
  const hint = String(error?.hint ?? '');

  // Server-side diagnostics only. Never includes keys or credentials — just
  // the database rejection itself, so a support request can be matched to a
  // log line without exposing anything sensitive to the browser.
  console.error(`[owner-booking] database rejected ${context}`, {
    code: code || null,
    message: message.slice(0, 500) || null,
    details: detail.slice(0, 500) || null,
    hint: hint.slice(0, 500) || null,
  });

  // The RPC (or a table it needs) is not installed in this database yet.
  // This is the exact production failure behind the "live appointment save
  // is rejected by the database" blocker: PGRST202 / Postgres 42883.
  if (code === 'PGRST202' || code === 'PGRST204' || code === '42883' || code === '42P01' ||
      /schema cache|does not exist/i.test(message)) {
    return new BackendError(503,
      'Appointments cannot be saved yet — this salon database is missing the create_owner_booking update. ' +
      'Apply supabase/migrations/20260910200000_create_owner_booking.sql in the Supabase SQL Editor, then retry.',
      'booking_rpc_missing');
  }
  if (code === '42501') {
    return new BackendError(403, 'This appointment is outside your salon workspace. Sign in with the account that manages this salon.', 'forbidden');
  }
  if (code === '23503') {
    if (/staff/i.test(detail + message)) {
      return new BackendError(409, 'The selected specialist is no longer available. Refresh the calendar and choose a specialist from the saved team.', 'staff_unavailable');
    }
    return new BackendError(409, 'The selected service is no longer available. Refresh the calendar and choose a service from the saved catalogue.', 'service_unavailable');
  }
  if (code === '23P01' || /already booked for this specialist/i.test(message)) {
    return new BackendError(409, 'The requested time is already booked for this specialist. Choose another slot.', 'slot_conflict');
  }
  if (code === '23505') {
    return new BackendError(409, 'This appointment reference was already used for another booking. Please try saving again.', 'duplicate_reference');
  }
  if (code === '23514') {
    return new BackendError(400, 'The appointment could not be stored with the requested status or times. Check the date and time and retry.', 'invalid_booking_values');
  }
  if (code === '23502') {
    return new BackendError(400, 'The salon database requires a booking field this form does not provide yet. Contact support with code 23502.', 'missing_required_field');
  }
  if (code === '22023' && RPC_INPUT_MESSAGES.test(message)) {
    // Our own RPC validation text is already customer-safe copy.
    return new BackendError(409, message, 'invalid_appointment_input');
  }
  if (code === '22P02') {
    return new BackendError(400, 'One of the selected values is not valid. Refresh the calendar and choose a service and specialist from the saved lists.', 'invalid_value');
  }
  return new BackendError(503, 'The booking database could not complete this request. Please retry.', 'database_unavailable');
}
