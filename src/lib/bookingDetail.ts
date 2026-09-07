// ============================================================================
// Booking detail page — pure logic.
//
// Two things here are easy to get subtly wrong, so they are functions with
// tests rather than inline JSX:
//
//   • REWARD POINTS. The owner dashboard awards points on completion with a
//     specific formula. If the detail page computed them any other way it would
//     promise a number the salon never grants. `calculateLoyaltyPoints` mirrors
//     SaaSDashboard exactly.
//   • PAYMENT / REWARD WORDING. Both have to describe a state the customer
//     cannot see the columns for, and must not overstate it: points on a
//     *pending* booking are promised, not granted.
// ============================================================================

import { describeBookingStatus, type DisplayBookingStatus } from './bookingStatus';
import { buildDirectionsUrl } from './bookingConfirmation';
import { canCancelBooking, canReview, type CancelDecision } from './bookingTabs';

// ---------------------------------------------------------------------------
// Loyalty points
// ---------------------------------------------------------------------------

export interface LoyaltyTerms {
  programEnabled: boolean;
  pointsPerVisit: number;
  pointsPerHundredSpent: number;
  /** The customer's tier multiplier; 1.0 for a new (bronze) customer. */
  tierMultiplier: number;
  tier: string;
}

/**
 * Mirrors `SaaSDashboard.updateAppointmentStatus` exactly:
 *   spendPoints = round((amount / 100) * pointsPerHundredSpent)
 *   earned      = round((pointsPerVisit + spendPoints) * tierMultiplier)
 *
 * Any drift between the two makes the detail page promise points the salon will
 * not award, which is worse than showing nothing.
 */
export function calculateLoyaltyPoints(input: {
  totalAmount: number;
  pointsPerVisit: number;
  pointsPerHundredSpent: number;
  tierMultiplier?: number;
}): number {
  const amount = Number.isFinite(Number(input.totalAmount)) ? Number(input.totalAmount) : 0;
  const perHundred = Number.isFinite(Number(input.pointsPerHundredSpent)) ? Number(input.pointsPerHundredSpent) : 0;
  const perVisit = Number.isFinite(Number(input.pointsPerVisit)) ? Number(input.pointsPerVisit) : 0;
  const multiplier =
    Number.isFinite(Number(input.tierMultiplier)) && Number(input.tierMultiplier) > 0
      ? Number(input.tierMultiplier)
      : 1;

  const spendPoints = Math.round((amount / 100) * perHundred);
  return Math.round((perVisit + spendPoints) * multiplier);
}

export type RewardState = 'disabled' | 'not_earned' | 'pending' | 'earned';

export interface RewardStatus {
  state: RewardState;
  /** Points this visit grants (0 when it grants none). */
  points: number;
  tier: string;
  label: string;
  detail: string;
}

/**
 * What the customer's loyalty account gets from this booking.
 *
 * `pending` is deliberately worded as a promise ("will be added"), not a
 * balance — the points only exist once the salon marks the visit complete.
 */
export function buildRewardStatus(input: {
  status: unknown;
  totalAmount: number;
  loyalty?: Partial<LoyaltyTerms> | null;
}): RewardStatus {
  const loyalty: LoyaltyTerms = {
    programEnabled: input.loyalty?.programEnabled !== false,
    pointsPerVisit: Number(input.loyalty?.pointsPerVisit ?? 0),
    pointsPerHundredSpent: Number(input.loyalty?.pointsPerHundredSpent ?? 0),
    tierMultiplier: Number(input.loyalty?.tierMultiplier ?? 1),
    tier: String(input.loyalty?.tier ?? 'bronze'),
  };
  const statusId = describeBookingStatus(input.status).id;

  const points = calculateLoyaltyPoints({
    totalAmount: input.totalAmount,
    pointsPerVisit: loyalty.pointsPerVisit,
    pointsPerHundredSpent: loyalty.pointsPerHundredSpent,
    tierMultiplier: loyalty.tierMultiplier,
  });

  if (!loyalty.programEnabled) {
    return {
      state: 'disabled',
      points: 0,
      tier: loyalty.tier,
      label: 'No rewards at this salon',
      detail: 'This salon has not switched on a loyalty programme.',
    };
  }

  if (statusId === 'cancelled' || statusId === 'no_show') {
    return {
      state: 'not_earned',
      points: 0,
      tier: loyalty.tier,
      label: 'No points earned',
      detail:
        statusId === 'no_show'
          ? 'Points are not awarded for a missed appointment.'
          : 'Points are not awarded for a cancelled booking.',
    };
  }

  if (statusId === 'completed') {
    return {
      state: 'earned',
      points,
      tier: loyalty.tier,
      label: `${points} points earned`,
      detail: `Added to your ${loyalty.tier} balance for this visit.`,
    };
  }

  return {
    state: 'pending',
    points,
    tier: loyalty.tier,
    label: `${points} points on completion`,
    detail: 'Points are added once the salon marks your visit complete.',
  };
}

// ---------------------------------------------------------------------------
// Payment status
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Not paid yet',
  paid_deposit: 'Advance paid',
  paid_full: 'Paid in full',
  pay_at_salon: 'Pay at the salon',
  refunded: 'Refunded',
  failed: 'Payment failed',
};

/** Human wording for the `payment_status` column; unknown values are shown raw. */
export function paymentStatusLabel(status: unknown): string {
  const key = String(status ?? '').trim();
  if (!key) return 'Not paid yet';
  return PAYMENT_STATUS_LABELS[key] ?? key.replace(/_/g, ' ');
}

/**
 * True when there is still money owed at the salon. Drives the "balance due"
 * line, which matters more than the raw status word because it is what the
 * customer has to bring with them.
 */
export function outstandingBalance(totalAmount: number, advancePaid: number): number {
  const total = Number.isFinite(Number(totalAmount)) ? Number(totalAmount) : 0;
  const paid = Number.isFinite(Number(advancePaid)) ? Number(advancePaid) : 0;
  return Math.max(0, total - paid);
}

// ---------------------------------------------------------------------------
// Detail view model
// ---------------------------------------------------------------------------

export interface BookingDetailView {
  bookingId: string;
  /** The customer-facing reference (NX-…), when one was issued. */
  reference: string;
  status: DisplayBookingStatus;
  salonName: string;
  salonImageUrl: string;
  /** Primary service plus any add-ons, in the order they were booked. */
  services: string[];
  staffName: string;
  date: string;
  time: string;
  totalAmount: number;
  advancePaid: number;
  balanceDue: number;
  currency: string;
  paymentStatus: string;
  customerNote: string;
  serviceAt: 'salon' | 'home';
  address: string;
  salonPhone: string;
  salonWhatsapp: string;
  latitude: number | null;
  longitude: number | null;
  reviewRating: number | null;
  reward: RewardStatus;
  bookedAt: string;
}

/**
 * Names of the add-ons booked alongside the primary service.
 *
 * The API writes these as `{ name, price, duration }` objects, but a row saved
 * by an older build may hold plain strings, so both shapes are read. Anything
 * unrecognisable is dropped rather than rendered as "[object Object]".
 */
export function readServiceAddOns(value: unknown): string[] {
  const names: string[] = [];
  const push = (item: unknown) => {
    const name = typeof item === 'string' ? item : String((item as any)?.name ?? '');
    const clean = name.trim();
    if (clean) names.push(clean);
  };
  if (Array.isArray(value)) {
    for (const item of value) push(item);
  } else if (typeof value === 'string' && value.trim()) {
    for (const part of value.split(',')) push(part);
  }
  return names;
}

/**
 * Map a booking row plus the salon/loyalty data the API attaches onto what the
 * detail page renders.
 *
 * Add-ons ride along in `metadata.service_addons` because `bookings` has a
 * single `service_name` column and the checkout folds add-on prices into the
 * total without itemising them.
 */
export function toBookingDetailView(input: {
  row: any;
  salon?: any;
  loyalty?: Partial<LoyaltyTerms> | null;
}): BookingDetailView {
  const source = input.row && typeof input.row === 'object' ? input.row : {};
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const salon = input.salon && typeof input.salon === 'object' ? input.salon : {};

  const totalAmount = Number.isFinite(Number(source.total_amount)) ? Number(source.total_amount) : 0;
  const advancePaid = Number.isFinite(Number(source.advance_paid_amount)) ? Number(source.advance_paid_amount) : 0;
  const rating = Number(metadata.review_rating);

  const primary = String(source.service_name ?? '').trim();
  const services = [primary, ...readServiceAddOns(metadata.service_addons)].filter(Boolean);

  const lat = coordOrNull(salon.latitude);
  const lng = coordOrNull(salon.longitude);

  return {
    bookingId: String(source.id ?? ''),
    reference: String(source.payment_id ?? '').trim(),
    status: describeBookingStatus(source.status).id as DisplayBookingStatus,
    salonName: String(salon.name ?? metadata.salon_name ?? '').trim() || 'Salon',
    salonImageUrl: String(salon.imageUrl ?? '').trim(),
    services: services.length > 0 ? services : ['Appointment'],
    staffName: String(metadata.stylist_name ?? '').trim() || 'Assigned by the salon',
    date: String(source.booking_date ?? '').trim(),
    time: String(source.time_slot ?? '').trim(),
    totalAmount,
    advancePaid,
    balanceDue: outstandingBalance(totalAmount, advancePaid),
    currency: String(salon.currency ?? metadata.currency ?? '').trim() || '₹',
    paymentStatus: paymentStatusLabel(source.payment_status),
    customerNote: String(source.notes ?? '').trim(),
    serviceAt: String(source.booking_type) === 'home' ? 'home' : 'salon',
    address: String(salon.address ?? '').trim(),
    salonPhone: String(salon.phone ?? '').trim(),
    salonWhatsapp: String(salon.whatsapp ?? '').trim(),
    latitude: lat,
    longitude: lng,
    reviewRating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null,
    reward: buildRewardStatus({ status: source.status, totalAmount, loyalty: input.loyalty }),
    bookedAt: String(source.created_at ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface BookingDetailActions {
  /** Google Maps turn-by-turn link, or null when there is nothing to route to. */
  directionsUrl: string | null;
  callHref: string | null;
  whatsappHref: string | null;
  /** Cancel is offered only for an upcoming, non-terminal booking. */
  cancel: CancelDecision;
  /** Show "Write a review" — completed visits the customer has not reviewed. */
  reviewable: boolean;
  /** Already reviewed; the page shows the rating instead of asking again. */
  reviewed: boolean;
}

/**
 * A usable latitude/longitude, or null.
 *
 * `Number(null)` is 0, so a plain Number() would turn an unset coordinate into
 * a real one at the equator. Blank and null both mean "not published".
 */
function coordOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Strip a number down to the digits `tel:` and `wa.me` both expect. */
function telDigits(raw: string): string {
  return String(raw ?? '').replace(/[^0-9]/g, '');
}

/**
 * Which actions this booking offers right now.
 *
 * The two conditionals in the spec are decided here rather than in JSX, so a
 * test can assert "a completed booking shows Review and not Cancel" without
 * rendering a browser: `cancel.allowed` is false for every terminal status and
 * for a slot that has passed, and `reviewable` is only ever true for a
 * completed booking that has not been reviewed yet.
 */
export function resolveBookingDetailActions(
  view: BookingDetailView,
  nowMs: number,
  leadMinutes = 0
): BookingDetailActions {
  const callDigits = telDigits(view.salonPhone);
  const whatsappDigits = telDigits(view.salonWhatsapp || view.salonPhone);
  // `wa.me` wants a country code with no leading zero; Indian numbers are
  // stored as +91… so the stripped digits already start with 91.
  const whatsappHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits.replace(/^0+/, '')}?text=${encodeURIComponent(
        `Hi, this is about my booking ${view.reference || view.bookingId}.`
      )}`
    : null;

  return {
    directionsUrl: buildDirectionsUrl({
      latitude: view.latitude,
      longitude: view.longitude,
      address: view.address,
    }),
    callHref: callDigits ? `tel:+${callDigits.replace(/^0+/, '')}` : null,
    whatsappHref,
    cancel: canCancelBooking({
      status: view.status,
      date: view.date,
      time: view.time,
      nowMs,
      leadMinutes,
    }),
    reviewable: canReview({ status: view.status, reviewRating: view.reviewRating }),
    reviewed: view.reviewRating !== null,
  };
}
