// ============================================================================
// Shared booking write operations for BOTH Express entrypoints (server.ts for
// dev/prod and api/index.ts for the serverless deployment).
//
// Before this module existed, each handler was hand-copied in two files and
// the copies drifted (different null-guards, different notification handling,
// different fallback behaviour). Anything that must behave identically in dev
// and in production lives here.
// ============================================================================

/** Postgres `uuid`-shaped value (any version). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Every column the `bookings` table accepts (schema migration 00001). */
const BOOKING_COLUMNS = new Set([
  'owner_id',
  'customer_name',
  'customer_phone',
  'customer_email',
  'service_id',
  'service_name',
  'booking_date',
  'time_slot',
  'total_amount',
  'advance_paid_amount',
  'status',
  'payment_status',
  'payment_id',
  'booking_type',
  'home_address',
  'proposed_date',
  'proposed_time_slot',
  'notes',
]);

/**
 * Keep only columns the schema knows about. Previously an unknown key in the
 * client payload (e.g. a renamed field from a newer build) made the whole
 * insert fail with 'column … does not exist' — a silent, hard-to-trace 500.
 * `service_id`/`stylist-like` foreign keys are dropped (set null) when they are
 * not real UUIDs: the editor preview runs against local template ids such as
 * 'hs-1', which can never reference a DB row; the booking must still persist
 * with its denormalized service_name.
 */
export function sanitizeBookingRow(input: any): Record<string, any> {
  const row: Record<string, any> = {};
  if (!input || typeof input !== 'object') return row;
  for (const [key, value] of Object.entries(input)) {
    if (!BOOKING_COLUMNS.has(key)) continue;
    if ((key === 'service_id' || key === 'owner_id') && value !== null && value !== undefined) {
      row[key] = isUuidLike(value) ? value : null;
      continue;
    }
    if (value !== undefined) row[key] = value;
  }
  return row;
}

/**
 * Compute the next row state for a status transition. Pure function shared by
 * the mock registry and the real database path so both stay identical.
 *
 * Fixes the "accept reschedule" bug: confirming a booking that has a proposed
 * slot used to only flip status — the booking kept the OLD date/time and the
 * proposed columns were never cleared, so customers saw the wrong slot as
 * confirmed. Now confirming applies the proposed slot and clears the proposal.
 */
export function applyBookingUpdate(
  existing: any,
  next: { status?: string; proposed_date?: string; proposed_time_slot?: string } | null | undefined
): { status?: string; booking_date?: string; time_slot?: string; proposed_date?: string | null; proposed_time_slot?: string | null } {
  const status = next?.status;
  const changes: any = { status };
  if (status === 'reschedule_proposed') {
    changes.proposed_date = next?.proposed_date ?? null;
    changes.proposed_time_slot = next?.proposed_time_slot ?? null;
    return changes;
  }
  if (status === 'confirmed' && existing) {
    if (existing.proposed_date) {
      // The customer accepted the salon's proposed slot — move the booking.
      changes.booking_date = existing.proposed_date;
      changes.time_slot = existing.proposed_time_slot ?? existing.time_slot;
      changes.proposed_date = null;
      changes.proposed_time_slot = null;
    }
    return changes;
  }
  return changes;
}

/** Notification rows (customer + owner) for a booking status transition. */
export function buildStatusNotifications(
  booking: any,
  status: string,
  proposedDate?: string | null,
  proposedTimeSlot?: string | null,
  ownerEmail = 'owner@salon.com'
): { customer?: Record<string, any>; owner: Record<string, any> } | null {
  if (!booking) return null;
  let title = '';
  let message = '';
  if (status === 'reschedule_proposed') {
    title = 'Reschedule Proposed';
    message = `The salon proposed a new time: ${proposedDate} at ${proposedTimeSlot}.`;
  } else if (status === 'confirmed') {
    title = 'Booking Confirmed';
    message = `Your booking on ${booking.booking_date} at ${booking.time_slot} is now confirmed.`;
  } else if (status === 'cancelled') {
    title = 'Booking Cancelled';
    message = 'Your booking was cancelled.';
  } else {
    return null;
  }
  const out: any = { owner: { user_email: ownerEmail, title: `Booking ${status}`, message: `${booking.customer_name || 'A customer'}'s booking was ${status}.` } };
  if (booking.customer_email) {
    out.customer = { user_email: booking.customer_email, title, message };
  }
  return out;
}
