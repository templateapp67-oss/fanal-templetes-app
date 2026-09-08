// ============================================================================
// Customer App domain types.
//
// These are the shapes the screens render. They are deliberately NOT the
// `SalonProfile` / `Appointment` / `ClientRecord` types of the owner editor:
// those describe what an owner edits, and reusing them is how a customer screen
// ends up showing a salon's draft state or another customer's booking.
//
// Every field is either a real Supabase column (snake_case in the DB, mapped
// here) or an explicitly-labelled derivation — see `source` on the payload
// types, which is how the UI says "live", "derived" or "device" instead of
// implying more database backing than a mapping actually has.
// ============================================================================

export type DataSource = 'supabase' | 'derived' | 'device';

export interface CustomerProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  whatsapp: string;
  city: string;
  address: string;
  postalCode: string;
  state: string;
  landmark: string;
  latitude: number | null;
  longitude: number | null;
  updatedAt: string | null;
  /** True when the row belongs to a signed-in customer (never an owner row). */
  isCustomerRecord: boolean;
  referralCode: string;
}

export interface CustomerLocation {
  city: string;
  latitude: number | null;
  longitude: number | null;
  label: string;
  /** How the location was obtained — drives the "use my location" affordance. */
  source: 'gps' | 'profile' | 'manual';
  updatedAt: string;
}

export interface CustomerSalon {
  id: string;
  ownerId: string;
  name: string;
  subdomain: string;
  businessType: string;
  tagline: string;
  about: string;
  logoUrl: string;
  coverImageUrl: string;
  city: string;
  state: string;
  address: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  whatsapp: string;
  instagram: string;
  currency: string;
  themePreset: string;
  themeAccentKey: string;
  requireDeposit: boolean;
  depositPercentage: number;
  homeServiceEnabled: boolean;
  workingHours: { monFri: string; saturday: string; sunday: string };
  distanceKm: number | null;
  openNow: boolean | null;
  serviceCount: number;
  rating: { average: number; count: number };
  favourite: boolean;
  source: DataSource;
}

export interface CustomerService {
  id: string;
  salonId: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  price: number;
  durationMinutes: number;
  popular: boolean;
  showDuration: boolean;
  sortOrder: number;
  source: DataSource;
}

export interface CustomerStaff {
  id: string;
  salonId: string;
  name: string;
  role: string;
  avatarUrl: string;
  bio: string;
  specialties: string[];
  assignedServiceIds: string[];
  rating: number;
  status: string;
  /** Only present when the owner left `hide_phone` false. */
  phone: string;
  scheduleConfigured: boolean;
  source: DataSource;
}

export interface CustomerSlot {
  date: string;
  time: string;
  staffId: string;
  staffName: string;
  available: boolean;
  reason: '' | 'past' | 'booked' | 'off-shift';
}

export interface SlotWindow {
  salonId: string;
  date: string;
  serviceIds: string[];
  durationMinutes: number;
  slots: CustomerSlot[];
  /** Why a day is empty — so the UI explains "closed" instead of "no data". */
  closedReason: '' | 'no-staff' | 'no-schedule' | 'all-taken';
  fetchedAt: string;
  source: DataSource;
}

export interface BookingServiceLine {
  id: string;
  serviceId: string;
  name: string;
  price: number;
  durationMinutes: number;
  staffId: string;
  staffName: string;
}

export interface CustomerBooking {
  id: string;
  salonId: string;
  salonName: string;
  salonLogoUrl: string;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  serviceName: string;
  serviceLines: BookingServiceLine[];
  totalAmount: number;
  advancePaid: number;
  balanceDue: number;
  /** 0 unless this booking was created by the customer app with a deposit policy. */
  depositPercent: number;
  /** ₹ still owed for the deposit — what the pay button offers, server-derived. */
  depositDue: number;
  date: string;
  time: string;
  status: string;
  paymentStatus: string;
  bookingType: 'salon' | 'home';
  homeAddress: string;
  notes: string;
  proposedDate: string;
  proposedTime: string;
  staffNames: string[];
  review: CustomerReview | null;
  referralCode: string;
  createdAt: string;
  updatedAt: string;
  source: DataSource;
}

export interface CustomerReview {
  id: string;
  bookingId: string;
  salonId: string;
  salonName: string;
  serviceName: string;
  rating: number;
  text: string;
  visitedOn: string;
  createdAt: string;
  /** Set when the review is visible on the salon page (owner's data). */
  publicVisible: boolean;
  source: DataSource;
}

export interface CustomerFavourite {
  id: string;
  salonId: string;
  salonName: string;
  staffId: string;
  staffName: string;
  kind: 'salon' | 'staff';
  /** 'booked' = derived from real bookings; 'pinned' = the customer's choice. */
  origin: 'booked' | 'pinned';
  lastVisit: string;
  visits: number;
  source: DataSource;
}

export interface RewardWallet {
  id: string;
  salonId: string;
  salonName: string;
  currency: string;
  points: number;
  lifetimePoints: number;
  tier: string;
  totalVisits: number;
  totalSpent: number;
  lastVisit: string;
  programEnabled: boolean;
  /**
   * `pointsNeeded` is what is STILL TO GO (never an absolute threshold) and
   * `progress` is the 0..1 fraction of the way from the current tier's floor to
   * that threshold. Multiply by 100 once, in the view.
   */
  nextTier: { tier: string; pointsNeeded: number; progress: number } | null;
  source: DataSource;
}

export interface RewardTransaction {
  id: string;
  salonId: string;
  salonName: string;
  date: string;
  description: string;
  pointsChange: number;
  type: string;
  source: DataSource;
}

export interface QrPayment {
  id: string;
  salonId: string;
  salonName: string;
  reference: string;
  amount: number;
  pointsCredited: number;
  date: string;
  status: 'credited' | 'pending';
  source: DataSource;
}

export interface Membership {
  id: string;
  salonId: string;
  salonName: string;
  tier: string;
  points: number;
  lifetimePoints: number;
  multiplier: number;
  benefits: string[];
  /** Same units as `RewardWallet.nextTier`: remaining points, and a 0..1 fraction. */
  nextTier: { tier: string; pointsNeeded: number; progress: number } | null;
  memberSince: string;
  source: DataSource;
}

export interface Referral {
  id: string;
  code: string;
  label: string;
  status: 'clicked' | 'booked' | 'credited';
  salonName: string;
  date: string;
  pointsEarned: number;
  source: DataSource;
}

export interface CustomerNotification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  salonId: string;
  bookingId: string;
  source: DataSource;
}

export interface SearchHistoryItem {
  id: string;
  query: string;
  city: string;
  usedAt: string;
  count: number;
  source: DataSource;
}

export interface Offer {
  id: string;
  salonId: string;
  salonName: string;
  title: string;
  description: string;
  rewardType: 'percentage_discount' | 'flat_discount' | 'free_service' | string;
  discountValue: number;
  requiredPoints: number;
  applicableCategory: string;
  couponPrefix: string;
  active: boolean;
  redeemable: boolean;
  pointsShort: number;
  redeemedCount: number;
  expiresLabel: string;
  source: DataSource;
}

export interface OfferRedemption {
  id: string;
  salonId: string;
  salonName: string;
  offerId: string;
  offerTitle: string;
  couponCode: string;
  discountSummary: string;
  pointsSpent: number;
  redeemedAt: string;
  status: 'active' | 'used' | string;
  source: DataSource;
}

/** Envelope returned by every `/api/customer/*` route. */
export interface CustomerApiEnvelope<T> {
  success: boolean;
  mode: 'live' | 'mock';
  requestId?: string;
  data: T;
  error?: string;
  code?: string;
  retryable?: boolean;
  /** Mapping kinds behind this payload, for the in-app data-source badge. */
  mapped?: Record<string, string>;
}

/**
 * One flat shape, on purpose (the same reasoning as `BookingSaveOutcome` in
 * src/lib/bookingApi.ts): this project compiles without `strictNullChecks`, so
 * TypeScript cannot narrow a discriminated union and every consumer would need
 * casts. `ok` plus an optional payload keeps screens honest about failure
 * instead of collapsing an error into an empty array — showing "No bookings
 * yet" to a customer with three appointments is precisely the bug this exists
 * to prevent.
 */
export interface CustomerResult<T> {
  ok: boolean;
  data?: T;
  mode?: 'live' | 'mock';
  requestId?: string;
  /** A server-side explanation that is not a failure (e.g. "not published"). */
  notice?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  status?: number;
  /** Extra envelope fields the caller needs (written rows, stored columns). */
  [key: string]: any;
}
