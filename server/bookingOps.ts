// ============================================================================
// Shared booking write operations for BOTH Express entrypoints (server.ts for
// dev/prod and api/index.ts for the serverless deployment).
//
// Before this module existed, each handler was hand-copied in two files and
// the copies drifted (different null-guards, different notification handling,
// different fallback behaviour). Anything that must behave identically in dev
// and in production lives here.
// ============================================================================

import { bookingStatusLabel } from '../src/lib/bookingStatus';

/** Postgres `uuid`-shaped value (any version). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Every column the `bookings` table accepts (schema migration 00001). */
const BOOKING_COLUMNS = new Set([
  'owner_id',
  'user_id',
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
  'metadata',
]);

/** One ordered line inside `bookings.metadata.services`. */
export interface StructuredServiceLine {
  service_id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

/**
 * Metadata is shallow JSON primitives EXCEPT for the single documented
 * structured key: `metadata.services`, the ordered multi-service lines every
 * booking screen reads back through `toBookingServiceLines` /
 * `toBookingDetailView`. `safeMetadataObject` keeps that key explicitly.
 */
export type BookingMetadata = Record<
  string,
  string | number | boolean | null | StructuredServiceLine[]
>;

const MAX_METADATA_VALUE_LENGTH = 500;
/** Ceiling on how many service lines a booking may carry. */
export const MAX_STRUCTURED_SERVICE_LINES = 20;
/** Per-line name cap (display text only; the parent `service_name` has its own cap). */
export const MAX_SERVICE_LINE_NAME_LENGTH = 160;
/**
 * Cap for the parent `service_name` rebuilt from the line names — the same
 * convention the customer app uses (`server/customerRoutes.ts`), so the
 * owner dashboard and booking cards see the same joined label either way.
 */
export const MAX_JOINED_SERVICE_NAME_LENGTH = 240;

/**
 * Normalize a caller-supplied `services` array into structured lines.
 * Accepts both snake_case (the shape this repo writes) and camelCase /
 * `unit_price` (the shape older integrations post), drops unusable entries,
 * and caps every field so the JSONB write can never be a second unbounded
 * request body. Returns null when the value is not a usable array.
 */
export function normalizeServiceLines(value: unknown): StructuredServiceLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const lines: StructuredServiceLine[] = [];
  for (const raw of value.slice(0, MAX_STRUCTURED_SERVICE_LINES)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const serviceId = String(o.service_id ?? o.serviceId ?? '').trim().slice(0, 80);
    const name = String(o.name ?? o.service_name ?? '').trim().slice(0, MAX_SERVICE_LINE_NAME_LENGTH);
    if (!name && !serviceId) continue;
    const price = Number(o.price ?? o.unit_price ?? NaN);
    const duration = Number(o.duration_minutes ?? o.durationMinutes ?? NaN);
    lines.push({
      service_id: serviceId,
      name,
      price: Number.isFinite(price) && price >= 0 ? Number(price.toFixed(2)) : 0,
      duration_minutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    });
  }
  return lines.length > 0 ? lines : null;
}

/** "Cut + Balayage + Gel-X Nails" from structured lines, capped for the parent column. */
export function joinServiceLineNames(lines: StructuredServiceLine[]): string {
  return lines
    .map((line) => line.name)
    .filter(Boolean)
    .join(' + ')
    .slice(0, MAX_JOINED_SERVICE_NAME_LENGTH);
}

function safeMetadataString(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_METADATA_VALUE_LENGTH);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const serialized = JSON.stringify(value);
    return (typeof serialized === 'string' ? serialized : String(value)).slice(0, MAX_METADATA_VALUE_LENGTH);
  } catch {
    return String(value).slice(0, MAX_METADATA_VALUE_LENGTH);
  }
}

function safeMetadataObject(value: unknown): BookingMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata: BookingMetadata = {};
  // Metadata is diagnostic context, not a second unbounded request body. Keep
  // only shallow JSON primitives so a malformed client object cannot make the
  // Supabase JSONB insert fail or consume excessive memory. The single
  // deliberate exception is `metadata.services` — the structured multi-service
  // lines (see `normalizeServiceLines`) — which every read path consumes.
  // Every OTHER nested value (including arrays under any other key) is still
  // dropped, so a caller cannot smuggle an arbitrary blob through.
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) continue;
    if (key === 'services') {
      const lines = normalizeServiceLines(raw);
      if (lines) metadata.services = lines;
      continue;
    }
    if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      const primitive = raw as string | number | boolean | null;
      metadata[key] = typeof primitive === 'string' ? primitive.slice(0, MAX_METADATA_VALUE_LENGTH) : primitive;
    }
  }
  return metadata;
}

/**
 * Keep only columns the schema knows about. Previously an unknown key in the
 * client payload (e.g. a renamed field from a newer build) made the whole
 * insert fail with 'column … does not exist' — a silent, hard-to-trace 500.
 * UUID foreign keys are normalized before they reach Postgres. When a local
 * template id such as `hs-1` is supplied, the FK column is set to null and
 * the original value is retained under the same key in `metadata` JSONB.
 * `user_id` is treated the same way, and is never populated from an
 * unauthenticated client field.
 */
export function sanitizeBookingRow(input: unknown): Record<string, any> {
  const row: Record<string, any> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return row;

  const metadata = safeMetadataObject((input as Record<string, unknown>).metadata);
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === 'metadata') continue;
    if (!BOOKING_COLUMNS.has(key)) continue;

    if (key === 'service_id' || key === 'owner_id' || key === 'user_id') {
      if (value === null || value === undefined) {
        if (value === null) row[key] = null;
        continue;
      }
      if (isUuidLike(value)) {
        row[key] = value;
      } else {
        row[key] = null;
        metadata[key] = safeMetadataString(value);
      }
      continue;
    }
    if (value !== undefined) row[key] = value;
  }

  if (Object.keys(metadata).length > 0) row.metadata = metadata;
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
  const label = bookingStatusLabel(status);
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
  } else if (status === 'completed') {
    title = 'Appointment Completed';
    message = `Your appointment on ${booking.booking_date} at ${booking.time_slot} is complete. Thank you for visiting!`;
  } else if (status === 'no_show') {
    // Told to the customer plainly: this is the outcome that forfeits the
    // advance, so a silent status change would read as a bug.
    title = 'Marked as No-show';
    message = `Your booking on ${booking.booking_date} at ${booking.time_slot} was marked as a no-show. Please contact the salon if this is a mistake.`;
  } else {
    return null;
  }
  const out: any = {
    owner: {
      user_email: ownerEmail,
      title: `Booking ${label}`,
      message: `${booking.customer_name || 'A customer'}'s booking was marked ${label.toLowerCase()}.`,
    },
  };
  if (booking.customer_email) {
    out.customer = { user_email: booking.customer_email, title, message };
  }
  return out;
}
