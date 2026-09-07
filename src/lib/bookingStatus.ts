// ============================================================================
// Booking lifecycle statuses — ONE source of truth for:
//   • the statuses a booking can hold,
//   • the copy each status shows a customer,
//   • the badge colours used by every screen (confirmation, owner dashboard,
//     customer portal),
//   • which statuses the API is allowed to write.
//
// WHY THIS FILE EXISTS
// --------------------
// The status list was previously duplicated in four places that had already
// drifted:
//   • `Appointment.status` in src/types.ts        → 4 values, no `no_show`
//   • server/bookingCreate.ts ALLOWED_STATUS      → 5 values (adds
//                                                   `reschedule_proposed`)
//   • server/bookingRoutes.ts ALLOWED_BOOKING_STATUSES → same 5, hand-copied
//   • BookingManager.tsx badge colours            → a ternary whose final
//                                                   `else` painted BOTH
//                                                   `completed` and
//                                                   `cancelled` red, so a
//                                                   finished job looked
//                                                   identical to a
//                                                   cancellation.
// A booking marked no-show by the salon had nowhere to live at all: the API
// rejected it as an "unsupported booking status".
//
// `no_show` matters commercially — it is the difference between "customer
// cancelled" (often refundable) and "customer never turned up" (advance kept),
// so it must be a distinct, persistable state.
//
// This module is deliberately React-free so the Express/serverless handlers can
// import it directly, the same way they already import `../src/lib/tenant`.
// ============================================================================

/** The five lifecycle states a booking moves through, in order of severity. */
export const BOOKING_STATUS_ORDER = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type BookingLifecycleStatus = (typeof BOOKING_STATUS_ORDER)[number];

/**
 * `reschedule_proposed` is a real, persisted state in this app (the salon
 * offers a new slot and waits for the customer to accept) but it is not one of
 * the five lifecycle outcomes, so it is modelled as a sibling rather than
 * being folded into `pending` and losing the proposed date/time handling.
 */
export const TRANSITIONAL_BOOKING_STATUSES = ['reschedule_proposed'] as const;

export type TransitionalBookingStatus = (typeof TRANSITIONAL_BOOKING_STATUSES)[number];

/** Every status the API may store on a booking row. */
export type BookingStatus = BookingLifecycleStatus | TransitionalBookingStatus;

/**
 * `not_submitted` is display-only: the booking never reached the salon's
 * database (offline / preview sandbox). It must never be written to a row, so
 * it is deliberately absent from `BOOKING_STATUS_ORDER` and therefore from
 * `isPersistableBookingStatus()`.
 */
export type DisplayBookingStatus = BookingStatus | 'not_submitted';

export type BookingStatusTone = 'amber' | 'emerald' | 'sky' | 'rose' | 'slate' | 'blue' | 'orange';

export interface BookingStatusDescriptor {
  id: DisplayBookingStatus;
  /** Title-case label for a badge, e.g. "No-show". */
  label: string;
  /** One-line explanation a customer can act on. */
  description: string;
  tone: BookingStatusTone;
  /** Tailwind classes for a pill/badge. */
  badgeClassName: string;
  /** Tailwind text colour for headings/icons that should match the badge. */
  textClassName: string;
  /** True once no further transition is expected. */
  isTerminal: boolean;
  /** True for statuses the API may persist (i.e. not display-only). */
  isPersistable: boolean;
}

const TONE_CLASSES: Record<BookingStatusTone, { badge: string; text: string }> = {
  amber: { badge: 'bg-amber-100 text-amber-800 border-amber-300', text: 'text-amber-700' },
  emerald: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', text: 'text-emerald-700' },
  sky: { badge: 'bg-sky-100 text-sky-800 border-sky-300', text: 'text-sky-700' },
  rose: { badge: 'bg-rose-100 text-rose-800 border-rose-300', text: 'text-rose-700' },
  slate: { badge: 'bg-slate-200 text-slate-700 border-slate-300', text: 'text-slate-600' },
  blue: { badge: 'bg-blue-100 text-blue-800 border-blue-300', text: 'text-blue-700' },
  orange: { badge: 'bg-orange-100 text-orange-800 border-orange-300', text: 'text-orange-700' },
};

function descriptor(
  id: DisplayBookingStatus,
  label: string,
  description: string,
  tone: BookingStatusTone,
  isTerminal: boolean,
  isPersistable: boolean
): BookingStatusDescriptor {
  return {
    id,
    label,
    description,
    tone,
    badgeClassName: `border ${TONE_CLASSES[tone].badge}`,
    textClassName: TONE_CLASSES[tone].text,
    isTerminal,
    isPersistable,
  };
}

/**
 * The registry, keyed by status id. `not_submitted` is included so every
 * consumer renders *something* sensible instead of falling through to an
 * "unknown" branch, but it is flagged non-persistable.
 */
export const BOOKING_STATUSES: Record<DisplayBookingStatus, BookingStatusDescriptor> = {
  pending: descriptor(
    'pending',
    'Pending',
    'Submitted to the salon. Waiting for them to accept this slot.',
    'amber',
    false,
    true
  ),
  confirmed: descriptor(
    'confirmed',
    'Confirmed',
    'The salon has accepted your slot. Please arrive 10 minutes early.',
    'emerald',
    false,
    true
  ),
  completed: descriptor(
    'completed',
    'Completed',
    'This appointment is finished. We hope to see you again.',
    'sky',
    true,
    true
  ),
  cancelled: descriptor(
    'cancelled',
    'Cancelled',
    'This booking was cancelled. No further action is needed.',
    'rose',
    true,
    true
  ),
  no_show: descriptor(
    'no_show',
    'No-show',
    'The customer did not arrive for the booked slot.',
    'orange',
    true,
    true
  ),
  reschedule_proposed: descriptor(
    'reschedule_proposed',
    'Reschedule Proposed',
    'The salon suggested a new time. Please accept or decline it.',
    'blue',
    false,
    true
  ),
  not_submitted: descriptor(
    'not_submitted',
    'Not Submitted',
    'This booking never reached the salon. Send the details on WhatsApp or call to confirm.',
    'slate',
    false,
    false
  ),
};

/** Unknown/legacy values (e.g. a column written by an older build). */
const UNKNOWN_DESCRIPTOR: BookingStatusDescriptor = descriptor(
  'pending',
  'Unknown',
  'This booking has an unrecognised status.',
  'slate',
  false,
  false
);

/**
 * Look a status up. Never throws and never returns undefined: an unrecognised
 * value stored by an older build renders as a neutral "Unknown" pill rather
 * than crashing the dashboard.
 */
export function describeBookingStatus(status: unknown): BookingStatusDescriptor {
  if (typeof status !== 'string') return UNKNOWN_DESCRIPTOR;
  const normalised = status.trim().toLowerCase();
  return (BOOKING_STATUSES as Record<string, BookingStatusDescriptor>)[normalised] ?? UNKNOWN_DESCRIPTOR;
}

/** True when `status` is one of the five lifecycle states. */
export function isBookingLifecycleStatus(status: unknown): status is BookingLifecycleStatus {
  return typeof status === 'string' && (BOOKING_STATUS_ORDER as readonly string[]).includes(status);
}

/**
 * True when the API may store this status. Display-only states such as
 * `not_submitted` are rejected so they can never leak into a booking row.
 */
export function isPersistableBookingStatus(status: unknown): status is BookingStatus {
  return (
    typeof status === 'string' &&
    (isBookingLifecycleStatus(status) ||
      (TRANSITIONAL_BOOKING_STATUSES as readonly string[]).includes(status))
  );
}

/** Every status the API accepts, as a `Set` for cheap membership tests. */
export const PERSISTABLE_BOOKING_STATUS_SET: ReadonlySet<string> = new Set<string>([
  ...BOOKING_STATUS_ORDER,
  ...TRANSITIONAL_BOOKING_STATUSES,
]);

/** Human label for any status, for plain-text contexts (SMS, WhatsApp, logs). */
export function bookingStatusLabel(status: unknown): string {
  return describeBookingStatus(status).label;
}

/**
 * The customer-facing headline for the confirmation page.
 *
 * The confirmation screen must never claim more than the booking row actually
 * says: saying "Your booking is confirmed." while the salon has only received
 * a pending request teaches customers to ignore the confirmation page, and the
 * reverse (a paid, accepted booking described as "pending") makes them phone
 * the salon. So the headline is derived from the status, not hardcoded.
 */
export function bookingStatusHeadline(status: unknown): string {
  const id = describeBookingStatus(status).id;
  switch (id) {
    case 'confirmed':
      return 'Your booking is confirmed.';
    case 'pending':
      return 'Your booking is submitted.';
    case 'completed':
      return 'Your appointment is completed.';
    case 'cancelled':
      return 'Your booking was cancelled.';
    case 'no_show':
      return 'This booking was marked as a no-show.';
    case 'reschedule_proposed':
      return 'The salon proposed a new time.';
    default:
      return 'Your booking is saved on this device.';
  }
}
