// ============================================================================
// "My Bookings" — pure logic for the customer's booking list.
//
// Split out of the page component so the decisions that are easy to get wrong
// are testable without a DOM:
//   • which tab a booking belongs in,
//   • whether it may still be cancelled,
//   • whether a review may be submitted,
//   • the order the cards appear in.
//
// All of it is derived from the booking's real status and slot, never from a
// "days ago" guess: a booking the salon forgot to close is still `pending`, and
// filing it under Completed would tell the customer something untrue.
// ============================================================================

import {
  describeBookingStatus,
  type BookingStatus,
  type DisplayBookingStatus,
} from './bookingStatus.js';
import { SALON_UTC_OFFSET_MINUTES, toUtcTimestamp } from './bookingConfirmation.js';

export type BookingTabId = 'upcoming' | 'completed' | 'cancelled';

export interface BookingTabDescriptor {
  id: BookingTabId;
  label: string;
  /** Empty-state copy specific to this tab. */
  emptyTitle: string;
  emptyBody: string;
}

export const BOOKING_TABS: BookingTabDescriptor[] = [
  {
    id: 'upcoming',
    label: 'Upcoming',
    emptyTitle: 'No upcoming visits',
    emptyBody: 'Nothing is scheduled right now. Book your next appointment and it will show up here.',
  },
  {
    id: 'completed',
    label: 'Completed',
    emptyTitle: 'No completed visits yet',
    emptyBody: 'Once you have finished an appointment it will appear here, ready for a review.',
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    emptyTitle: 'No cancelled bookings',
    emptyBody: 'Bookings you cancel — or miss — are kept here for your records.',
  },
];

export const DEFAULT_TAB: BookingTabId = 'upcoming';

export function isBookingTabId(value: unknown): value is BookingTabId {
  return value === 'upcoming' || value === 'completed' || value === 'cancelled';
}

/**
 * Which tab a status belongs to.
 *
 * `no_show` is filed with Cancelled because the appointment did not happen —
 * but it keeps its own badge, since the advance is forfeited rather than
 * refunded and the customer should be able to tell the two apart.
 */
export function tabForStatus(status: unknown): BookingTabId {
  switch (describeBookingStatus(status).id) {
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'no_show':
      return 'cancelled';
    default:
      // pending, confirmed, reschedule_proposed, not_submitted and anything
      // unrecognised: still an open booking, so it stays visible in Upcoming
      // rather than disappearing from the customer's list entirely.
      return 'upcoming';
  }
}

// ---------------------------------------------------------------------------
// Slot maths
// ---------------------------------------------------------------------------

const UNKNOWN_SLOT = Number.MAX_SAFE_INTEGER;

/** Instant of the booked slot in ms, or null when it cannot be parsed. */
export function slotInstant(date: string, time: string, now?: Date): number | null {
  const ms = toUtcTimestamp(date, time, SALON_UTC_OFFSET_MINUTES);
  void now;
  return ms;
}

/** True when the booked slot is already in the past. Unparseable is not "past". */
export function isSlotPast(date: string, time: string, nowMs: number): boolean {
  const ms = toUtcTimestamp(date, time, SALON_UTC_OFFSET_MINUTES);
  if (ms === null) return false;
  return ms <= nowMs;
}

// ---------------------------------------------------------------------------
// Cancellation policy
// ---------------------------------------------------------------------------

export interface CancelDecision {
  allowed: boolean;
  /** Shown as the button tooltip / the reason it is disabled. Empty when allowed. */
  reason: string;
}

/**
 * May the customer still cancel?
 *
 * Two rules: the booking must not already be terminal, and its slot must not
 * have passed. `leadMinutes` lets a salon require notice (e.g. 120 = two hours
 * before); it defaults to 0, i.e. "any time before the appointment starts".
 */
export function canCancelBooking(input: {
  status: unknown;
  date?: string | null;
  time?: string | null;
  nowMs: number;
  leadMinutes?: number;
}): CancelDecision {
  const descriptor = describeBookingStatus(input.status);

  if (descriptor.id === 'cancelled') {
    return { allowed: false, reason: 'This booking is already cancelled.' };
  }
  if (descriptor.id === 'completed') {
    return { allowed: false, reason: 'This appointment has already been completed.' };
  }
  if (descriptor.id === 'no_show') {
    return { allowed: false, reason: 'This booking was recorded as a no-show.' };
  }

  const slotMs = toUtcTimestamp(String(input.date ?? ''), String(input.time ?? ''));
  if (slotMs === null) {
    // No usable slot: we cannot prove it has passed, so let the salon decide.
    return { allowed: true, reason: '' };
  }

  const lead = Number.isFinite(Number(input.leadMinutes)) && Number(input.leadMinutes) > 0
    ? Number(input.leadMinutes)
    : 0;
  const cutoff = slotMs - lead * 60_000;
  if (input.nowMs >= cutoff) {
    return {
      allowed: false,
      reason: lead > 0
        ? `Cancellations close ${lead / 60 >= 1 ? `${Math.round(lead / 60)} hours` : `${lead} minutes`} before the appointment. Please call the salon.`
        : 'The appointment time has passed. Please contact the salon.',
    };
  }

  return { allowed: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Review policy
// ---------------------------------------------------------------------------

export const MAX_REVIEW_LENGTH = 500;

/**
 * Flat rather than a discriminated union: this project compiles without
 * `strictNullChecks`, where TypeScript cannot narrow a union, so consumers
 * (including the API handlers) would not type-check on the `.error` arm.
 */
export interface ReviewValidation {
  ok: boolean;
  rating: number;
  text: string;
  /** Empty when ok. */
  error: string;
}

/**
 * A review is only for a finished appointment. Reviewing a cancelled booking
 * would be reviewing a visit that never happened.
 */
export function validateReview(input: {
  status: unknown;
  rating: unknown;
  text?: unknown;
}): ReviewValidation {
  if (describeBookingStatus(input.status).id !== 'completed') {
    return { ok: false, rating: 0, text: '', error: 'You can review this booking once the appointment is completed.' };
  }

  const rating = Number(input.rating);
  if (!Number.isFinite(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, rating: 0, text: '', error: 'Please choose a rating between 1 and 5 stars.' };
  }

  const text = String(input.text ?? '').trim();
  if (text.length > MAX_REVIEW_LENGTH) {
    return { ok: false, rating: 0, text: '', error: `Please keep your review under ${MAX_REVIEW_LENGTH} characters.` };
  }

  return { ok: true, rating, text, error: '' };
}

// ---------------------------------------------------------------------------
// Card model
// ---------------------------------------------------------------------------

export interface CustomerBookingCard {
  id: string;
  salonName: string;
  /** Empty string when the salon has no image; the card falls back to initials. */
  salonImageUrl: string;
  salonCity: string;
  serviceName: string;
  staffName: string;
  date: string;
  time: string;
  status: DisplayBookingStatus;
  totalAmount: number;
  advancePaid: number;
  currency: string;
  serviceAt: 'salon' | 'home';
  /** Present once the customer has reviewed a completed visit. */
  reviewRating: number | null;
  isPast: boolean;
  /** Booking reference, when one was issued (stored as payment_id). */
  reference: string;
}

/**
 * Map a `bookings` row (plus the salon summary the API attaches) onto the card.
 *
 * `salon_name` and the staff name are not columns on `bookings` — salon details
 * are resolved from `profiles` server-side, and the stylist rides along in
 * `metadata` because it was never a column. Both fall back to something
 * readable rather than rendering an empty row.
 */
export function toCustomerBookingCard(row: any, nowMs: number): CustomerBookingCard {
  const source = row && typeof row === 'object' ? row : {};
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const salon = source.salon && typeof source.salon === 'object' ? source.salon : {};

  const amount = Number(source.total_amount);
  const advance = Number(source.advance_paid_amount);
  const rating = Number(metadata.review_rating);
  const statusId = describeBookingStatus(source.status).id as DisplayBookingStatus;

  return {
    id: String(source.id ?? ''),
    salonName: String(salon.name ?? metadata.salon_name ?? '').trim() || 'Salon',
    salonImageUrl: String(salon.imageUrl ?? '').trim(),
    salonCity: String(salon.city ?? '').trim(),
    serviceName: String(source.service_name ?? '').trim() || 'Appointment',
    staffName: String(metadata.stylist_name ?? '').trim() || 'Assigned by the salon',
    date: String(source.booking_date ?? '').trim(),
    time: String(source.time_slot ?? '').trim(),
    status: statusId,
    totalAmount: Number.isFinite(amount) ? amount : 0,
    advancePaid: Number.isFinite(advance) ? advance : 0,
    currency: String(salon.currency ?? metadata.currency ?? '').trim() || '₹',
    serviceAt: String(source.booking_type) === 'home' ? 'home' : 'salon',
    reviewRating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null,
    isPast: isSlotPast(String(source.booking_date ?? ''), String(source.time_slot ?? ''), nowMs),
    reference: String(source.payment_id ?? '').trim(),
  };
}

/**
 * Order the cards.
 *
 * Upcoming sorts soonest-first with anything already past pushed to the bottom
 * (a stale booking the salon never closed should not outrank tomorrow's
 * appointment). History tabs sort most-recent-first.
 */
export function sortCustomerBookings(
  cards: CustomerBookingCard[],
  tab: BookingTabId
): CustomerBookingCard[] {
  const instantOf = (card: CustomerBookingCard): number =>
    toUtcTimestamp(card.date, card.time) ?? UNKNOWN_SLOT;

  const sorted = [...cards];
  if (tab === 'upcoming') {
    sorted.sort((a, b) => {
      // Past-due last, regardless of how soon the slot was.
      if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
      const diff = instantOf(a) - instantOf(b);
      return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
    });
  } else {
    sorted.sort((a, b) => {
      const diff = instantOf(b) - instantOf(a);
      return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
    });
  }
  return sorted;
}

/** Bucket + sort in one call, for the page to render straight from. */
export function groupBookingsByTab(
  cards: CustomerBookingCard[]
): Record<BookingTabId, CustomerBookingCard[]> {
  const buckets: Record<BookingTabId, CustomerBookingCard[]> = {
    upcoming: [],
    completed: [],
    cancelled: [],
  };
  for (const card of cards) buckets[tabForStatus(card.status)].push(card);
  return {
    upcoming: sortCustomerBookings(buckets.upcoming, 'upcoming'),
    completed: sortCustomerBookings(buckets.completed, 'completed'),
    cancelled: sortCustomerBookings(buckets.cancelled, 'cancelled'),
  };
}

/** Whether a completed visit still needs a review. */
export function canReview(card: Pick<CustomerBookingCard, 'status' | 'reviewRating'>): boolean {
  return describeBookingStatus(card.status).id === 'completed' && card.reviewRating === null;
}

/** Canonical status type re-export so the page does not import two modules. */
export type { BookingStatus };
