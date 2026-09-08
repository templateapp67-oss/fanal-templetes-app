// ============================================================================
// Supabase row → Customer App entity mappers.
//
// Shared by `server/customerRoutes.ts` and the screens so the two can never
// disagree about what a row means — the exact failure mode `salonSync.ts` was
// written to fix on the owner side (camelCase app state vs snake_case columns,
// friendly string ids vs uuids).
//
// Nothing in here invents a value. When a column is null the mapped field is
// the empty string/zero/null, so a screen renders "no rating yet" instead of a
// fabricated 4.8.
// ============================================================================

import {
  DEFAULT_SERVICE_MINUTES,
  distanceKm,
  normalizeClock,
  normalizeReferralCode,
  parseWindow,
  referralCodeFor,
} from './schema';
// Same helper the client's checkout button and the server's advance endpoint use,
// so the amount shown, charged and recorded can never drift apart.
import { computeAdvanceDeposit } from '../advanceDeposit';
import type { SalonGalleryItem,
  BookingServiceLine,
  CustomerBooking,
  CustomerFavourite,
  CustomerNotification,
  CustomerProfile,
  CustomerReview,
  CustomerSalon,
  CustomerService,
  CustomerSlot,
  CustomerStaff,
  Membership,
  Offer,
  OfferRedemption,
  QrPayment,
  Referral,
  RewardTransaction,
  RewardWallet,
  SlotWindow,
} from './types';

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: unknown): boolean => value === true || value === 'true' || value === 1;

const isoDate = (value: unknown): string => {
  if (!value) return '';
  const raw = String(value);
  // Postgres date columns arrive as YYYY-MM-DD; timestamps as ISO strings.
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
};

const isoDateTime = (value: unknown): string => (value ? new Date(String(value)).toISOString() : '');

/** Read one key out of a jsonb object column that may be null or a string. */
export function jsonValue(row: any, key: string): any {
  if (!row || typeof row !== 'object') return undefined;
  const container = row.metadata;
  if (!container) return undefined;
  if (typeof container === 'string') {
    try {
      const parsed = JSON.parse(container);
      return parsed && typeof parsed === 'object' ? parsed[key] : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof container === 'object' ? container[key] : undefined;
}

// ---------------------------------------------------------------------------
// profiles → salons / profiles
// ---------------------------------------------------------------------------

/**
 * Is this `profiles` row a published salon rather than a plain customer row?
 *
 * The signup trigger creates a profile for every auth user, customer included,
 * so discovery must key off the columns only an owner fills in. Anything else
 * would list customers as salons.
 */
export function isSalonProfile(row: any): boolean {
  return !!row && !!str(row.salon_name) && !!str(row.subdomain) && !!str(row.business_type);
}

function workingHoursFrom(row: any): { monFri: string; saturday: string; sunday: string } {
  const source = row?.working_hours && typeof row.working_hours === 'object' ? row.working_hours : {};
  return {
    monFri: str(source.monFri ?? row?.working_hours_monfri),
    saturday: str(source.saturday ?? row?.working_hours_sat),
    sunday: str(source.sunday ?? row?.working_hours_sun),
  };
}

export function toCustomerSalon(
  row: any,
  extras: {
    from?: { latitude?: number | null; longitude?: number | null } | null;
    serviceCount?: number;
    minServicePrice?: number | null;
    categories?: string[];
    hasActiveOffers?: boolean;
    recentBookings?: number;
    gallery?: SalonGalleryItem[];
    rating?: { average: number; count: number };
    favourite?: boolean;
    now?: Date;
  } = {}
): CustomerSalon {
  const hours = workingHoursFrom(row);
  const homeService = row?.home_service && typeof row.home_service === 'object' ? row.home_service : {};
  return {
    id: str(row.id),
    ownerId: str(row.id),
    name: str(row.salon_name),
    // Stored lower-case by the owner app and looked up with `.eq('subdomain',
    // handle.toLowerCase())`, so a stray capital here would 404 a real salon's
    // own link.
    subdomain: str(row.subdomain).toLowerCase(),
    businessType: str(row.business_type),
    tagline: str(row.tagline),
    about: str(row.about),
    logoUrl: str(row.logo_url || row.cover_image_url),
    coverImageUrl: str(row.cover_image_url || row.logo_url),
    city: str(row.city),
    state: str(row.state),
    address: [str(row.full_address), str(row.address_line2), str(row.landmark)].filter(Boolean).join(', '),
    postalCode: str(row.postal_code),
    latitude: row.latitude === null || row.latitude === undefined ? null : num(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : num(row.longitude),
    phone: str(row.phone_number),
    whatsapp: str(row.whatsapp || row.phone_number),
    instagram: str(row.instagram_handle),
    currency: str(row.currency) || '₹',
    themePreset: str(row.theme_preset),
    themeAccentKey: str(row.theme_accent_key) || 'slate',
    requireDeposit: bool(row.require_deposit),
    depositPercentage: num(row.deposit_percentage, 20),
    homeServiceEnabled: bool(homeService.enabled),
    workingHours: hours,
    distanceKm: distanceKm(extras.from, row),
    openNow: openNowFrom(hours, extras.now),
    serviceCount: num(extras.serviceCount),
    minServicePrice: extras.minServicePrice === undefined || extras.minServicePrice === null ? null : num(extras.minServicePrice),
    categories: Array.isArray(extras.categories) ? extras.categories.filter(Boolean).map((entry) => String(entry)) : [],
    hasActiveOffers: extras.hasActiveOffers === true,
    recentBookings: num(extras.recentBookings),
    rating: extras.rating ?? { average: 0, count: 0 },
    favourite: !!extras.favourite,
    gallery: Array.isArray(extras.gallery) ? extras.gallery : [],
    source: 'supabase',
  };
}

/** `openNow` is derived from the owner's published hours, never assumed. */
export function openNowFrom(
  hours: { monFri?: string; saturday?: string; sunday?: string } | null | undefined,
  now: Date = new Date()
): boolean | null {
  // No published hours is not "closed" and not "open" — it is unknown, and the
  // chip stays off rather than guessing.
  if (!hours || typeof hours !== 'object') return null;
  const day = now.getDay();
  const raw = day === 0 ? hours.sunday : day === 6 ? hours.saturday : hours.monFri;
  const window = parseWindow(String(raw || ''));
  if (!window) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const clock = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  return minutes >= clock(window.fromTime) && minutes <= clock(window.toTime);
}

export function toCustomerProfile(row: any): CustomerProfile {
  return {
    id: str(row?.id),
    fullName: str(row?.full_name),
    email: str(row?.email),
    phone: str(row?.phone_number),
    whatsapp: str(row?.whatsapp || row?.phone_number),
    city: str(row?.city),
    // `address_line2` is the salon's second address line for a published row and
    // the customer's locality otherwise - which is exactly why the write handler
    // refuses it on a salon row. Read is fine; the guard is on the way in.
    area: str(row?.address_line2),
    address: str(row?.full_address),
    dateOfBirth: typeof row?.date_of_birth === 'string' ? row.date_of_birth.slice(0, 10) : undefined,
    avatarUrl: str(row?.owner_photo_url),
    postalCode: str(row?.postal_code),
    state: str(row?.state),
    landmark: str(row?.landmark),
    latitude: row?.latitude === null || row?.latitude === undefined ? null : num(row.latitude),
    longitude: row?.longitude === null || row?.longitude === undefined ? null : num(row.longitude),
    updatedAt: row?.updated_at ? isoDateTime(row.updated_at) : null,
    // No column anywhere in this schema means "language", so the API answers
    // empty and the screen fills it from the device. Returning a guess here would
    // make a stored value look real.
    language: '',
    languageSource: 'none' as const,
    // A customer profile row is one that has not published a salon.
    isCustomerRecord: !isSalonProfile(row),
    referralCode: referralCodeFor(str(row?.id) || null),
  };
}

// ---------------------------------------------------------------------------
// services / stylists
// ---------------------------------------------------------------------------

/**
 * A `services` row carries a price and no discount. The only discount this
 * product can honestly show is one the SALON published as a `loyalty_rewards`
 * row (`percentage_discount` / `flat_discount`, optionally scoped to a
 * category), so that is what a service card shows - matched by category,
 * never invented.
 */
export function serviceDiscountFor(row: any, rewards: any[] = []): { label: string; percent: number; points: number | null } {
  const category = str(row.category) || 'General';
  const applicable = (rewards || []).filter(
    (reward: any) => reward && reward.is_active !== false && (!reward.applicable_category || String(reward.applicable_category).trim() === '' || str(reward.applicable_category) === category)
  );
  if (!applicable.length) return { label: '', percent: 0, points: null };
  const best = applicable.slice().sort((a: any, b: any) => Number(b.discount_value ?? 0) - Number(a.discount_value ?? 0))[0];
  const value = num(best.discount_value);
  const type = str(best.reward_type);
  const label =
    type === 'flat_discount' && value > 0
      ? `Rs${value % 1 ? value.toFixed(2) : value} off with ${Math.max(1, num(best.required_points, 1))} pts`
      : value > 0
        ? `${Math.round(value)}% off with ${Math.max(1, num(best.required_points, 1))} pts`
        : str(best.title) || '';
  return {
    label,
    percent: type === 'percentage_discount' || type === '' ? Math.max(0, Math.min(100, Math.round(value))) : 0,
    points: num(best.required_points) || null,
  };
}

export function toCustomerService(row: any, extras: { rewards?: any[] } = {}): CustomerService {
  const discount = serviceDiscountFor(row, extras.rewards || []);
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    name: str(row.name),
    category: str(row.category) || 'General',
    description: str(row.description),
    icon: str(row.icon) || 'sparkles',
    price: num(row.price),
    // A NULL `duration_minutes` is 0 by `num()`'s rules, and a 0-minute service
    // makes every slot bookable back-to-back. The column is nullable even though
    // it has a default, so treat "no value" as the app's own fallback.
    durationMinutes: row.duration_minutes === null || row.duration_minutes === undefined || row.duration_minutes === '' ? DEFAULT_SERVICE_MINUTES : num(row.duration_minutes),
    popular: bool(row.popular),
    showDuration: row.show_duration === false ? false : true,
    sortOrder: num(row.sort_order),
    discountLabel: discount.label,
    discountPercent: discount.percent,
    discountPoints: discount.points,
    source: 'supabase',
  };
}

export function toCustomerStaff(row: any): CustomerStaff {
  const schedule = Array.isArray(row.schedule) ? row.schedule : [];
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    name: str(row.name),
    role: str(row.role) || 'Service Provider',
    avatarUrl: str(row.avatar_url),
    bio: str(row.bio),
    specialties: Array.isArray(row.specialties) ? row.specialties.map((item: unknown) => str(item)).filter(Boolean) : [],
    assignedServiceIds: Array.isArray(row.assigned_services)
      ? row.assigned_services.map((item: unknown) => str(item)).filter(Boolean)
      : [],
    rating: Math.round(num(row.rating, 0) * 10) / 10,
    status: str(row.status) || 'Available',
    // The owner's `hide_phone` flag is honoured server-side; the field simply
    // is not present in the payload when hidden.
    phone: bool(row.hide_phone) ? '' : str(row.phone),
    scheduleConfigured: schedule.length > 0,
    source: 'supabase',
  };
}

// ---------------------------------------------------------------------------
// bookings (+ booking_services line items and reviews)
// ---------------------------------------------------------------------------

/**
 * `booking_services` line items, read out of `bookings.metadata.services`.
 *
 * Falls back to the booking's own single-service columns for rows created
 * before the structured-lines convention existed (older customer-app builds,
 * older public-site BookingModal writes). Rows written by the current customer
 * app and the public site's modal both carry the full ordered line list, so
 * every screen renders lines uniformly either way.
 */
export function toBookingServiceLines(row: any): BookingServiceLine[] {
  const raw = jsonValue(row, 'services');
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((item: any, index: number) => ({
        id: str(item?.id) || `${str(row.id)}-${index}`,
        serviceId: str(item?.service_id ?? item?.serviceId),
        name: str(item?.name ?? item?.service_name),
        price: num(item?.price),
        durationMinutes: num(item?.duration_minutes ?? item?.durationMinutes),
        staffId: str(item?.staff_id ?? item?.staffId),
        staffName: str(item?.staff_name ?? item?.staffName),
      }))
      .filter((line: BookingServiceLine) => line.name || line.serviceId);
  }
  const name = str(row.service_name);
  const serviceId = str(row.service_id);
  if (!name && !serviceId) return [];
  return [
    {
      id: `${str(row.id)}-0`,
      serviceId,
      name,
      price: num(row.total_amount),
      durationMinutes: num(jsonValue(row, 'duration_minutes')),
      staffId: '',
      staffName: '',
    },
  ];
}

export function toCustomerReview(row: any): CustomerReview | null {
  const rating = num(jsonValue(row, 'review_rating'));
  if (!rating) return null;
  return {
    id: `rev-${str(row.id)}`,
    bookingId: str(row.id),
    salonId: str(row.owner_id),
    salonName: str(row.salon_name),
    serviceName: str(row.service_name),
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    text: str(jsonValue(row, 'review_text')),
    visitedOn: isoDate(row.booking_date),
    createdAt: isoDateTime(jsonValue(row, 'reviewed_at') || row.updated_at || row.created_at),
    publicVisible: true,
    source: 'supabase',
  };
}

/** The deposit policy recorded on a booking row, or 0 when the app did not set one. */
export function depositPolicyPercent(row: any): number {
  const policy = jsonValue(row, 'deposit_policy');
  const percent = Number(policy && policy.percentage);
  return Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : 0;
}

/**
 * What is still owed as a deposit: recomputed from the stored total and policy,
 * and zero once anything has been paid or the row is not awaiting payment.
 * Kept next to the mapper so no screen can offer a different number than the
 * advance endpoint will accept.
 */
export function depositDueFor(row: any): number {
  const percent = depositPolicyPercent(row);
  if (!percent) return 0;
  if (String(row?.payment_status ?? 'pending') !== 'pending') return 0;
  if (num(row?.advance_paid_amount) > 0) return 0;
  return computeAdvanceDeposit(num(row?.total_amount), percent).rupees;
}

export function toCustomerBooking(row: any, extras: { salon?: any; currency?: string } = {}): CustomerBooking {
  const lines = toBookingServiceLines(row);
  const total = num(row.total_amount);
  const paid = num(row.advance_paid_amount);
  const salonName = str(extras.salon?.salon_name) || str(row.salon_name) || '';
  const review = toCustomerReview(row);
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    salonName,
    salonLogoUrl: str(extras.salon?.logo_url || extras.salon?.cover_image_url),
    currency: str(extras.salon?.currency) || str(extras.currency) || '₹',
    customerName: str(row.customer_name),
    customerPhone: str(row.customer_phone),
    customerEmail: str(row.customer_email),
    serviceName: str(row.service_name) || lines.map((line) => line.name).filter(Boolean).join(' + '),
    serviceLines: lines,
    totalAmount: total,
    advancePaid: paid,
    balanceDue: Math.max(0, Math.round((total - paid) * 100) / 100),
    // The percentage the customer app stored at booking time. A booking the
    // salon created itself has no policy on the row, so the customer app offers
    // no pay-deposit button for it rather than guessing an amount.
    depositPercent: depositPolicyPercent(row),
    depositDue: depositDueFor(row),
    date: isoDate(row.booking_date),
    time: normalizeClock(row.time_slot),
    status: str(row.status) || 'pending',
    paymentStatus: str(row.payment_status) || 'pending',
    bookingType: str(row.booking_type) === 'home' ? 'home' : 'salon',
    homeAddress: str(row.home_address),
    notes: str(row.notes),
    proposedDate: isoDate(row.proposed_date),
    proposedTime: normalizeClock(row.proposed_time_slot),
    staffNames: [...new Set(lines.map((line) => line.staffName).filter(Boolean))],
    review,
    referralCode: normalizeReferralCode(jsonValue(row, 'referral_code')),
    createdAt: isoDateTime(row.created_at),
    updatedAt: isoDateTime(row.updated_at || row.created_at),
    source: 'supabase',
  };
}

// ---------------------------------------------------------------------------
// rewards / wallets / offers
// ---------------------------------------------------------------------------

export const QR_PAYMENT_TYPE = 'qr_payment';
export const REWARD_TYPE_PREFIX = 'Referral';

export function toRewardTransaction(row: any, salonName = ''): RewardTransaction {
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    salonName,
    date: isoDate(row.date || row.created_at),
    description: str(row.description),
    pointsChange: num(row.points_change),
    type: str(row.type) || 'bonus',
    source: 'supabase',
  };
}

/**
 * `loyalty_point_transactions` has no amount, status or reference column, so a
 * QR payment's money detail lives in its `description`. Both halves are here on
 * purpose: `qrLedgerDescription` is the ONLY writer and `toQrPayment` is the
 * ONLY reader, so the two cannot drift apart the way a hand-written regex
 * against someone else's string always does.
 *
 * A customer-recorded payment is NOT credited: `points_change` stays 0 until the
 * gateway confirms the money moved, at which point the row is updated in place
 * (never duplicated) and carries `verified <payment id>`.
 */
export const QR_STATE_PENDING = 'awaiting verification';
export const QR_STATE_VERIFIED = 'verified';
export const QR_STATE_BELOW_MINIMUM = 'below earning minimum';

export function qrLedgerDescription(input: {
  amount: number;
  reference: string;
  state?: typeof QR_STATE_PENDING | typeof QR_STATE_BELOW_MINIMUM;
  gatewayPaymentId?: string;
}): string {
  const amount = `₹${Math.max(0, Math.round(Number(input.amount || 0) * 100) / 100).toFixed(2)}`;
  const reference = String(input.reference || '').trim().slice(0, 64);
  const state = input.gatewayPaymentId
    ? `${QR_STATE_VERIFIED} ${String(input.gatewayPaymentId).trim().slice(0, 64)}`
    : input.state || QR_STATE_PENDING;
  return `QR payment (${state}) ${amount}${reference ? ` ref:${reference}` : ''}`.slice(0, 200);
}

/** The salon's published showcase, from `social_videos`. Empty is a real answer. */
export function toSalonGallery(rows: any[]): SalonGalleryItem[] {
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    id: str(row.id),
    title: str(row.title) || 'Salon video',
    url: str(row.youtube_url),
    thumbnailUrl: str(row.thumbnail_url),
    kind: 'video' as const,
  }));
}

/** Reverse of `qrLedgerDescription`, tolerant of rows the owner typed by hand. */
export function parseQrDescription(description: string): {
  amount: number;
  reference: string;
  gatewayPaymentId: string;
  state: typeof QR_STATE_PENDING | typeof QR_STATE_VERIFIED | typeof QR_STATE_BELOW_MINIMUM;
} {
  const text = String(description || '');
  const reference = /(?:ref|reference|txn)[:#]?\s*([A-Za-z0-9-]{4,32})/i.exec(text)?.[1] || '';
  const amountRaw =
    /₹\s*([\d,.]+)/.exec(text)?.[1] || /(?:^|\s)(\d{1,7}(?:\.\d{1,2})?)\s*(?:INR|rs)/i.exec(text)?.[1] || '';
  const gatewayPaymentId = new RegExp(`${QR_STATE_VERIFIED}\\s+([A-Za-z0-9_\\-]{4,64})`).exec(text)?.[1] || '';
  const state: typeof QR_STATE_PENDING | typeof QR_STATE_VERIFIED | typeof QR_STATE_BELOW_MINIMUM = gatewayPaymentId
    ? QR_STATE_VERIFIED
    : text.toLowerCase().includes(QR_STATE_BELOW_MINIMUM)
      ? QR_STATE_BELOW_MINIMUM
      : QR_STATE_PENDING;
  return { amount: num(String(amountRaw).replace(/,/g, '')), reference, gatewayPaymentId, state };
}

export function toQrPayment(row: any, salonName = ''): QrPayment {
  const parsed = parseQrDescription(str(row.description));
  const pointsCredited = num(row.points_change);
  // A positive balance change is the only thing that makes a payment credited —
  // never the words in the description. `verified` without points is a gateway
  // lookup that has not been applied yet, and `credited` without a lookup is a
  // row the owner wrote themselves (they carry no marker at all).
  const creditedByBalance = pointsCredited > 0;
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    salonName,
    reference: parsed.reference,
    amount: parsed.amount,
    pointsCredited: creditedByBalance ? pointsCredited : 0,
    date: isoDate(row.date || row.created_at),
    paymentStatus: parsed.state === QR_STATE_VERIFIED ? 'verified' : 'claimed',
    rewardStatus: creditedByBalance
      ? 'credited'
      : parsed.state === QR_STATE_BELOW_MINIMUM
        ? 'below_minimum'
        : 'awaiting_verification',
    gatewayPaymentId: parsed.gatewayPaymentId,
    source: 'supabase',
  };
}

/**
 * Wallet from a `clients` row.
 *
 * `nextTier` uses the owner's own thresholds from `loyalty_config`, so the app
 * never shows progress toward a tier the salon has not defined.
 */
export function toRewardWallet(
  row: any,
  extras: {
    salonName?: string;
    currency?: string;
    config?: any;
    programEnabled?: boolean;
    lifetimeEarned?: number;
    lifetimeRedeemed?: number;
  } = {}
): RewardWallet {
  const lifetime = num(row.lifetime_points, num(row.points));
  const thresholds =
    extras.config?.tier_thresholds && typeof extras.config.tier_thresholds === 'object' ? extras.config.tier_thresholds : null;
  const order: Array<{ tier: string; min: number }> = thresholds
    ? Object.entries(thresholds)
        .map(([tier, value]) => ({ tier, min: num(value) }))
        .sort((a, b) => a.min - b.min)
    : [];
  const nextIndex = order.findIndex((entry) => entry.min > lifetime);
  const next = nextIndex >= 0 ? order[nextIndex] : null;
  // `progress` is a fraction (0..1) of the distance from the tier the customer
  // is IN to the tier they are heading toward — the same unit `toMembership`
  // uses, so a screen can multiply by 100 once and never guess.
  const floor = nextIndex > 0 ? order[nextIndex - 1].min : 0;
  const span = next ? Math.max(1, next.min - floor) : 1;
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    salonName: str(extras.salonName || row.salon_name || ''),
    currency: str(extras.currency) || '₹',
    points: num(row.points),
    lifetimePoints: lifetime,
    lifetimeEarned: num(extras.lifetimeEarned, lifetime),
    lifetimeRedeemed: num(extras.lifetimeRedeemed),
    tierLadder: order.map((entry) => entry.tier),
    tier: str(row.loyalty_tier) || 'bronze',
    totalVisits: num(row.total_visits),
    totalSpent: num(row.total_spent),
    lastVisit: isoDate(row.last_visit),
    programEnabled: extras.programEnabled !== false,
    nextTier: next
      ? {
          tier: next.tier,
          pointsNeeded: Math.max(0, next.min - lifetime),
          progress: Math.max(0, Math.min(1, (lifetime - floor) / span)),
        }
      : null,
    source: 'supabase',
  };
}

export function toMembership(
  row: any,
  extras: { salonName?: string; config?: any; programEnabled?: boolean } = {}
): Membership {
  const config = extras.config || {};
  const tier = str(row.loyalty_tier) || 'bronze';
  const multipliers =
    config.tier_multipliers && typeof config.tier_multipliers === 'object' ? config.tier_multipliers : {};
  const thresholds =
    config.tier_thresholds && typeof config.tier_thresholds === 'object' ? config.tier_thresholds : {};
  const lifetime = num(row.lifetime_points, num(row.points));
  const ordered: Array<{ tier: string; min: number }> = Object.keys(thresholds)
    .map((key) => ({ tier: key, min: num(thresholds[key]) }))
    .sort((a, b) => a.min - b.min);
  const currentIndex = ordered.findIndex((entry) => entry.tier === tier);
  const nextEntry = currentIndex >= 0 ? ordered[currentIndex + 1] : ordered.find((entry) => entry.min > lifetime);
  const previousMin = currentIndex > 0 ? ordered[currentIndex].min : 0;
  const span = nextEntry ? Math.max(1, nextEntry.min - (ordered[currentIndex]?.min ?? 0)) : 1;
  return {
    id: `member-${str(row.id)}`,
    salonId: str(row.owner_id),
    salonName: str(extras.salonName || ''),
    tier,
    points: num(row.points),
    lifetimePoints: lifetime,
    multiplier: num(multipliers[tier], 1),
    // Benefits are the configured multiplier + the tiers' own thresholds — the
    // schema has no benefit copy, so the app states what is actually granted.
    benefits: [
      `${num(multipliers[tier], 1)}× points on every visit`,
      `${num(config.points_per_visit, 0)} base points per completed visit`,
      `${num(config.points_per_hundred_spent, 0)} points per 100 spent`,
    ],
    nextTier: nextEntry
      ? {
          tier: nextEntry.tier,
          pointsNeeded: Math.max(0, nextEntry.min - lifetime),
          progress: Math.max(0, Math.min(1, (lifetime - previousMin) / span)),
        }
      : null,
    startDate: isoDate(row.created_at),
    // No expiry column exists on `clients`, so the honest answer is "none set".
    endDate: row.membership_ends_on ? isoDate(row.membership_ends_on) : null,
    active: extras.programEnabled !== false && !!tier,
    memberSince: isoDate(row.created_at),
    source: 'supabase',
  };
}

export function toOffer(
  row: any,
  extras: { salonName?: string; walletPoints?: number; redeemedCount?: number } = {}
): Offer {
  const required = num(row.required_points);
  const points = num(extras.walletPoints);
  const type = str(row.reward_type) || 'percentage_discount';
  const value = num(row.discount_value);
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    salonName: str(extras.salonName || ''),
    title: str(row.title),
    description: str(row.description),
    rewardType: type,
    discountValue: value,
    requiredPoints: required,
    applicableCategory: str(row.applicable_category),
    couponPrefix: str(row.coupon_code_prefix),
    active: row.is_active !== false,
    redeemable: row.is_active !== false && points >= required,
    pointsShort: Math.max(0, required - points),
    redeemedCount: num(extras.redeemedCount),
    // The schema carries no expiry column, so the app says "while active"
    // rather than inventing a date the owner never set.
    expiresLabel: 'While active in this salon\'s loyalty program',
    source: 'supabase',
  };
}

export function toOfferRedemption(row: any, salonName = ''): OfferRedemption {
  return {
    id: str(row.id),
    salonId: str(row.owner_id),
    salonName,
    offerId: str(row.reward_id),
    offerTitle: str(row.reward_title),
    couponCode: str(row.coupon_code),
    discountSummary: str(row.discount_summary),
    pointsSpent: num(row.points_spent),
    redeemedAt: isoDate(row.redeemed_at || row.created_at),
    status: str(row.status) || 'active',
    source: 'supabase',
  };
}

// ---------------------------------------------------------------------------
// notifications / favourites / referrals / slots
// ---------------------------------------------------------------------------

export function toCustomerNotification(row: any): CustomerNotification {
  const title = str(row.title);
  const message = str(row.message);
  const bookingId = str(jsonValue(row, 'booking_id') || row.booking_id || '');
  return {
    id: str(row.id),
    title: title || 'Salon update',
    message,
    read: bool(row.is_read),
    createdAt: isoDateTime(row.created_at),
    salonId: str(row.owner_id),
    bookingId,
    source: 'supabase',
  };
}

/** Favourite salons/staff derived from the customer's own booking history. */
export function deriveFavourites(
  bookings: CustomerBooking[],
  salons: Map<string, any>
): CustomerFavourite[] {
  const byKey = new Map<string, CustomerFavourite>();
  for (const booking of bookings) {
    const salonKey = `salon:${booking.salonId}:`;
    const existing = byKey.get(salonKey);
    const name = booking.salonName || str(salons.get(booking.salonId)?.salon_name) || 'Salon';
    byKey.set(salonKey, {
      id: salonKey,
      salonId: booking.salonId,
      salonName: name,
      staffId: '',
      staffName: '',
      serviceId: '',
      serviceName: '',
      kind: 'salon',
      origin: 'booked',
      lastVisit: (existing?.lastVisit || '') > booking.date ? existing!.lastVisit : booking.date,
      visits: (existing?.visits || 0) + 1,
      source: 'derived',
    });
    for (const line of booking.serviceLines || []) {
      if (!line?.serviceId) continue;
      const serviceKey = `service:${booking.salonId}:${line.serviceId}`;
      const serviceExisting = byKey.get(serviceKey);
      byKey.set(serviceKey, {
        id: serviceKey,
        salonId: booking.salonId,
        salonName: name,
        staffId: line.staffId || '',
        staffName: line.staffName || '',
        serviceId: line.serviceId,
        serviceName: line.name || 'Service',
        kind: 'service',
        origin: 'booked',
        lastVisit: (serviceExisting?.lastVisit || '') > booking.date ? serviceExisting!.lastVisit : booking.date,
        visits: (serviceExisting?.visits || 0) + 1,
        source: 'derived',
      });
    }
    for (const staffName of booking.staffNames) {
      const staffKey = `staff:${booking.salonId}:${staffName}`;
      const staffExisting = byKey.get(staffKey);
      byKey.set(staffKey, {
        id: staffKey,
        salonId: booking.salonId,
        salonName: name,
        staffId: '',
        staffName,
        serviceId: '',
        serviceName: '',
        kind: 'staff',
        origin: 'booked',
        lastVisit: (staffExisting?.lastVisit || '') > booking.date ? staffExisting!.lastVisit : booking.date,
        visits: (staffExisting?.visits || 0) + 1,
        source: 'derived',
      });
    }
  }
  return [...byKey.values()].sort((a, b) => String(b.lastVisit).localeCompare(String(a.lastVisit)));
}

/** Referral rows: real bookings that carried this customer's code. */
export function deriveReferrals(input: {
  code: string;
  bookings: { row: any; salonName: string }[];
  transactions: any[];
}): Referral[] {
  const items: Referral[] = [];
  for (const entry of input.bookings) {
    const row = entry.row;
    items.push({
      id: `ref-${str(row.id)}`,
      code: input.code,
      label: str(row.customer_name) ? `${str(row.customer_name)} · ${str(row.service_name)}` : 'A friend',
      status: str(row.status) === 'completed' ? 'credited' : 'booked',
      salonName: entry.salonName,
      date: isoDate(row.booking_date || row.created_at),
      pointsEarned: 0,
      source: 'derived',
    });
  }
  for (const row of input.transactions) {
    const description = str(row.description);
    if (!description.toLowerCase().includes(REWARD_TYPE_PREFIX.toLowerCase())) continue;
    items.push({
      id: `ref-tx-${str(row.id)}`,
      code: input.code,
      label: description,
      status: 'credited',
      salonName: '',
      date: isoDate(row.date || row.created_at),
      pointsEarned: num(row.points_change),
      source: 'supabase',
    });
  }
  return items;
}

/** Assemble the slot grid response the screens consume verbatim. */
export function toSlotWindow(input: {
  salonId: string;
  date: string;
  serviceIds: string[];
  durationMinutes: number;
  slots: CustomerSlot[];
  anyStaffScheduled: boolean;
  anyAvailable: boolean;
}): SlotWindow {
  const closedReason: SlotWindow['closedReason'] = !input.anyStaffScheduled
    ? input.slots.length
      ? ''
      : 'no-schedule'
    : !input.anyAvailable
      ? 'all-taken'
      : '';
  return {
    salonId: input.salonId,
    date: input.date,
    serviceIds: input.serviceIds,
    durationMinutes: input.durationMinutes,
    slots: input.slots,
    closedReason: input.slots.length ? '' : closedReason,
    fetchedAt: new Date().toISOString(),
    source: 'derived',
  };
}
