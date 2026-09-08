// ============================================================================
// Customer App data client.
//
// This is the ONLY way a customer screen reaches data. Rules it enforces:
//
//   • No import of mockData / templateData / loyaltyData defaults anywhere
//     under src/customer or src/lib/customer. An empty result is an empty
//     result; screens then show their empty state. That is the whole point of
//     the module: a screen can no longer render a template salon by accident.
//   • Identity is never a parameter. `customerId` is not sent anywhere; the
//     server derives it from the verified bearer token, exactly like
//     /api/bookings/mine already does.
//   • Salon catalogue reads are read-only by construction — there are no write
//     functions for salons/services/staff/offers here.
//   • `offline`/`rejected`/`server` failures stay distinguishable, so a failed
//     fetch never looks like "you have no favourites".
//
// Every call returns the flat `CustomerResult<T>` shape (see types.ts) and
// reports the physical mapping in `mapped` so the UI can show a data-source
// badge and the verify script can assert no screen is guessing.
// ============================================================================

import { getBookingAccessToken } from '../bookingApi';
import { isMockSupabase, supabase, supabaseConfig } from '../supabaseClient';
import { CUSTOMER_SCHEMA_MAP, entityMap } from './schema';
import {
  clearSearchHistory as clearSearchHistoryOnDevice,
  mergeFavourites,
  pushSearchHistory,
  readFavouritePins,
  readSearchHistory,
  writeFavouritePins,
  type FavouritePin,
} from './deviceStore';
import type {
  BookingServiceLine,
  CustomerBooking,
  CustomerFavourite,
  CustomerLocation,
  CustomerNotification,
  CustomerProfile,
  CustomerResult,
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
  SearchHistoryItem,
  SlotWindow,
} from './types';

export type CustomerAuthUser = { id?: string; email?: string } | null | undefined;

/** Raised when the app is not connected to a Supabase project at all. */
export const NOT_CONNECTED_ERROR =
  'The Customer App is not connected to Supabase yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (plus SUPABASE_SERVICE_ROLE_KEY for the API) to resume live data.';

export function customerBackendConnected(): boolean {
  return !isMockSupabase && supabaseConfig.mode === 'live';
}

/** `?tab=`-style query building without pulling a URL library into the client. */
function toQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Override for tests; defaults to the Supabase session token. */
  accessToken?: string;
  timeoutMs?: number;
}

export interface CustomerFetchOutcome<T> {
  result: CustomerResult<T>;
  token: string | undefined;
}

/**
 * The single request funnel for the customer app.
 *
 * `requireAuth` routes answer 401 with a readable reason, which the screens
 * translate into "sign in to see this" — never into an empty list.
 */
export async function customerRequest<T>(
  path: string,
  options: RequestOptions & { requireAuth?: boolean; empty?: T } = {}
): Promise<CustomerResult<T>> {
  const { method = 'GET', body, signal, requireAuth = false, empty } = options;

  // Connectivity is the server's call, not the browser's guess: `/api/customer/*`
  // answers `mode: 'mock'` + a `notice` when Supabase is not configured, and the
  // shell turns that into a visible "not connected" chip. A local check here
  // would have to duplicate the server's env resolution to be right.
  let token = options.accessToken;
  if (requireAuth && !token) {
    const session = await currentCustomerUser();
    token = await getBookingAccessToken(session);
    if (!token) {
      return {
        ok: false,
        error: 'Please sign in to see your salon account.',
        code: 'auth_required',
        retryable: false,
        status: 401,
      };
    }
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), options.timeoutMs ?? 15000);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? controller?.signal,
    });
    const text = await response.text().catch(() => '');
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (response.ok && json && json.success === true) {
      const payload = json.data === undefined ? empty : json.data;
      const result: any = {
        ok: true,
        data: (payload ?? empty) as T,
        mode: json.mode === 'mock' ? 'mock' : 'live',
        requestId: json.requestId,
      };
      if (json.notice) result.notice = String(json.notice);
      return result;
    }

    const status = response.status;
    return {
      ok: false,
      error:
        json?.error ||
        (text
          ? `The salon service answered HTTP ${status}.`
          : `The salon service could not be reached (HTTP ${status}).`),
      code: json?.code || (status === 401 ? 'auth_required' : status >= 500 ? 'server_error' : 'rejected'),
      retryable: json?.retryable === true || status === 408 || status === 429 || status >= 500,
      status,
      requestId: json?.requestId,
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'The salon service took too long to answer. Please try again.'
        : err?.message || 'Network request failed.',
      code: aborted ? 'timeout' : 'offline',
      retryable: true,
      status: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The signed-in customer, from the same Supabase session the owner editor uses. */
export async function currentCustomerUser(): Promise<{ id: string; email?: string } | null> {
  if (isMockSupabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    return user?.id ? { id: user.id, email: user.email ?? undefined } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discovery (read-only salon catalogue)
// ---------------------------------------------------------------------------

export interface SalonSearchQuery {
  q?: string;
  city?: string;
  businessType?: string;
  /** `services.category` — a salon matches when it actually offers that category. */
  category?: string;
  /** Ceiling on the salon's cheapest published service price. */
  maxPrice?: number;
  minRating?: number;
  openNow?: boolean;
  offersOnly?: boolean;
  sort?: 'nearby' | 'rating' | 'name' | 'trending' | 'price';
  latitude?: number;
  longitude?: number;
  limit?: number;
}

export function searchSalons(query: SalonSearchQuery): Promise<CustomerResult<CustomerSalon[]>> {
  return customerRequest<CustomerSalon[]>(`/api/customer/salons${toQuery({ ...query })}`, {
    empty: [],
  });
}

export function getSalon(idOrSubdomain: string): Promise<CustomerResult<CustomerSalon | null>> {
  return customerRequest<CustomerSalon | null>(
    `/api/customer/salons/${encodeURIComponent(idOrSubdomain)}`,
    { empty: null }
  );
}

export function listSalonServices(salonId: string): Promise<CustomerResult<CustomerService[]>> {
  return customerRequest<CustomerService[]>(
    `/api/customer/salons/${encodeURIComponent(salonId)}/services`,
    { empty: [] }
  );
}

export function listSalonStaff(salonId: string): Promise<CustomerResult<CustomerStaff[]>> {
  return customerRequest<CustomerStaff[]>(
    `/api/customer/salons/${encodeURIComponent(salonId)}/staff`,
    { empty: [] }
  );
}

export function listSalonReviews(salonId: string): Promise<CustomerResult<CustomerReview[]>> {
  return customerRequest<CustomerReview[]>(
    `/api/customer/salons/${encodeURIComponent(salonId)}/reviews`,
    { empty: [] }
  );
}

export interface SlotQuery {
  date: string;
  serviceIds?: string[];
  staffId?: string;
}

export function fetchSlotWindow(
  salonId: string,
  query: SlotQuery
): Promise<CustomerResult<SlotWindow | null>> {
  return customerRequest<SlotWindow | null>(
    `/api/customer/salons/${encodeURIComponent(salonId)}/slots${toQuery({
      date: query.date,
      service_ids: (query.serviceIds || []).join(','),
      staff_id: query.staffId,
    })}`,
    { empty: null }
  );
}

export function listOffers(salonId?: string): Promise<CustomerResult<Offer[]>> {
  return customerRequest<Offer[]>(`/api/customer/offers${toQuery({ salon_id: salonId })}`, {
    empty: [],
  });
}

export function searchSuggestions(input: {
  q?: string;
  city?: string;
}): Promise<CustomerResult<SearchHistoryItem[]>> {
  return customerRequest<SearchHistoryItem[]>(`/api/customer/search-suggestions${toQuery(input)}`, {
    empty: [],
  });
}

/**
 * Turn a failed `CustomerResult` into a sentence a customer can act on.
 *
 * The API already returns human-readable `error` text for most codes, so this
 * is only a translation table for the codes whose wording is written for a
 * developer log (and for the ones whose remedy lives on another screen).
 * Screens call it instead of printing `result.code`, which is how "slot_taken"
 * used to end up verbatim in front of a user.
 */
export function normalizeCustomerErrorMessage(result: {
  error?: string;
  code?: string;
  notice?: string;
  retryable?: boolean;
}): string {
  switch (result.code) {
    case 'auth_required':
      return 'Please sign in to continue. Nothing was changed.';
    case 'supabase_not_configured':
      return 'This salon is not connected to a database yet, so bookings cannot be saved. Please try again later.';
    case 'slot_taken':
      return 'That time was just booked by someone else. Your details are still here — pick another time.';
    case 'not_cancellable':
      return result.error || 'This booking can no longer be cancelled here. Call the salon to change it.';
    case 'invalid_slot':
    case 'invalid_request':
      return result.error || 'Something in the form is not valid yet. Check the highlighted fields.';
    case 'not_found':
    case 'booking_not_found':
      return 'We could not find that record on your account. It may have been changed by the salon.';
    case 'rate_limited':
      return 'Too many attempts at once. Wait a moment and try again.';
    case 'network_error':
      return 'We could not reach the salon right now. Check your connection and try again.';
    case 'timeout':
      return 'The salon took too long to answer. Nothing was saved — please try again.';
    default:
      return result.error || result.notice || 'The request did not go through. Nothing was saved.';
  }
}

// ---------------------------------------------------------------------------
// Private customer records (self-scoped)
// ---------------------------------------------------------------------------

export function getMyProfile(): Promise<CustomerResult<CustomerProfile | null>> {
  return customerRequest<CustomerProfile | null>('/api/customer/me/profile', {
    requireAuth: true,
    empty: null,
  });
}

export function saveMyProfile(input: {
  fullName?: string;
  phone?: string;
  whatsapp?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  state?: string;
  landmark?: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<CustomerResult<CustomerProfile | null>> {
  return customerRequest<CustomerProfile | null>('/api/customer/me/profile', {
    method: 'POST',
    body: input,
    requireAuth: true,
    empty: null,
  });
}

export function saveMyLocation(input: CustomerLocation): Promise<CustomerResult<CustomerProfile | null>> {
  return customerRequest<CustomerProfile | null>('/api/customer/me/location', {
    method: 'POST',
    body: {
      city: input.city,
      latitude: input.latitude,
      longitude: input.longitude,
      label: input.label,
      source: input.source,
    },
    requireAuth: true,
    empty: null,
  });
}

export function listMyBookings(input: { salonId?: string; tab?: string } = {}): Promise<
  CustomerResult<CustomerBooking[]>
> {
  return customerRequest<CustomerBooking[]>(`/api/customer/me/bookings${toQuery(input)}`, {
    requireAuth: true,
    empty: [],
  });
}

export function getMyBooking(id: string): Promise<CustomerResult<CustomerBooking | null>> {
  return customerRequest<CustomerBooking | null>(`/api/customer/me/bookings/${encodeURIComponent(id)}`, {
    requireAuth: true,
    empty: null,
  });
}

export interface CreateBookingInput {
  salonId: string;
  date: string;
  time: string;
  serviceIds: string[];
  /** Optional stylist; when omitted the salon assigns the first available one. */
  staffId?: string;
  bookingType?: 'salon' | 'home';
  homeAddress?: string;
  notes?: string;
  referralCode?: string;
  /** Payment: the deposit path already lives in /api/bookings + Razorpay. */
  payDeposit?: boolean;
}

export interface CreatedBooking {
  booking: CustomerBooking;
  serviceLines: BookingServiceLine[];
  /** Rows the app wrote, so the confirmation can prove what was persisted. */
  written: { bookings: number; serviceLines: number; notifications: number };
  slots: CustomerSlot[];
  /** ₹ the deposit is, already rounded the way the gateway will charge it. */
  depositDue?: number;
  depositPercent?: number;
  requireDeposit?: boolean;
  paymentHandoff?: 'razorpay_advance' | 'pay_at_salon';
}

export interface BookingAdvancePayment {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  /** ₹ the customer was shown; the server re-derives it and refuses a mismatch. */
  amount?: number;
  depositPercent?: number;
}

export interface BookingAdvanceResult {
  booking?: CustomerBooking;
  paymentId?: string;
  orderId?: string;
  amount?: number;
  gatewayMode?: 'live' | 'test' | 'mock' | 'disabled';
  /** The gateway took the money but the row could not be updated — see `notice`. */
  needsSalonAttention?: boolean;
}

/**
 * Create a booking. `created` is what the API re-read after the write, so the
 * confirmation screen renders the stored row (id, status, amounts, timestamps)
 * rather than the values that were posted.
 */
export function createBooking(input: CreateBookingInput): Promise<CustomerResult<CreatedBooking>> {
  return customerRequest<CreatedBooking>('/api/customer/bookings/create', {
    method: 'POST',
    body: input,
    requireAuth: true,
  });
}

export function cancelMyBooking(id: string, reason?: string): Promise<CustomerResult<CustomerBooking | null>> {
  return customerRequest<CustomerBooking | null>('/api/customer/me/bookings/cancel', {
    method: 'POST',
    body: { id, reason },
    requireAuth: true,
    empty: null,
  });
}

export function proposeMyBookingReschedule(
  id: string,
  date: string,
  time: string
): Promise<CustomerResult<CustomerBooking | null>> {
  return customerRequest<CustomerBooking | null>('/api/customer/me/bookings/reschedule', {
    method: 'POST',
    body: { id, proposed_date: date, proposed_time_slot: time },
    requireAuth: true,
    empty: null,
  });
}

/**
 * Record a deposit that was already paid through the gateway. The server
 * re-verifies the Razorpay signature itself (server/razorpay.ts) and recomputes
 * the amount from the stored booking, so a client cannot mark a booking paid
 * with an unrelated order or a smaller amount.
 */
export function payBookingAdvance(
  bookingId: string,
  payment: BookingAdvancePayment
): Promise<CustomerResult<BookingAdvanceResult>> {
  return customerRequest<BookingAdvanceResult>(
    `/api/customer/me/bookings/${encodeURIComponent(bookingId)}/advance`,
    { method: 'POST', body: payment, requireAuth: true }
  );
}

export function reviewMyBooking(
  id: string,
  rating: number,
  text: string
): Promise<CustomerResult<CustomerReview | null>> {
  return customerRequest<CustomerReview | null>('/api/customer/me/reviews', {
    method: 'POST',
    body: { id, rating, text },
    requireAuth: true,
    empty: null,
  });
}

export function listMyReviews(): Promise<CustomerResult<CustomerReview[]>> {
  return customerRequest<CustomerReview[]>('/api/customer/me/reviews', {
    requireAuth: true,
    empty: [],
  });
}

export function listMyFavourites(): Promise<CustomerResult<CustomerFavourite[]>> {
  return customerRequest<CustomerFavourite[]>('/api/customer/me/favourites', {
    requireAuth: true,
    empty: [],
  });
}

/**
 * The favourites list as the customer sees it: the derived half from real
 * booking rows (server) merged with this device's own pins.
 */
export async function listFavourites(
  customerId: string | null | undefined
): Promise<CustomerResult<CustomerFavourite[]>> {
  const remote = await customerRequest<CustomerFavourite[]>('/api/customer/me/favourites', {
    requireAuth: true,
    empty: [],
  });
  if (!remote.ok) return remote;
  const merged = mergeFavourites(remote.data || [], readFavouritePins(customerId));
  return { ok: true, data: merged, mode: remote.mode, requestId: remote.requestId };
}

/**
 * Pin or unpin. The derived half cannot be unpinned (it is history, not a
 * preference), so unpinning writes the opposite pin state; both live in the
 * customer's own device bucket and are reported with source 'device'.
 */
export async function toggleFavourite(
  customerId: string | null | undefined,
  input: {
    salonId: string;
    staffId?: string;
    serviceId?: string;
    kind: 'salon' | 'staff' | 'service';
    salonName?: string;
    staffName?: string;
    serviceName?: string;
    pinned: boolean;
  }
): Promise<CustomerResult<CustomerFavourite[]>> {
  const pins = readFavouritePins(customerId);
  const matches = (pin: FavouritePin) =>
    pin.salonId === input.salonId &&
    pin.kind === input.kind &&
    (input.kind === 'salon' ? true : input.kind === 'staff' ? pin.staffId === input.staffId : pin.serviceId === input.serviceId);
  const nextPins = input.pinned
    ? [
        {
          salonId: input.salonId,
          staffId: input.staffId || '',
          serviceId: input.serviceId || '',
          kind: input.kind,
          salonName: input.salonName || '',
          staffName: input.staffName || '',
          serviceName: input.serviceName || '',
          pinnedAt: new Date().toISOString(),
        },
        ...pins.filter((pin) => !matches(pin)),
      ]
    : pins.filter((pin) => !matches(pin));
  writeFavouritePins(customerId, nextPins);
  const remote = await customerRequest<CustomerFavourite[]>('/api/customer/me/favourites', {
    requireAuth: true,
    empty: [],
  });
  const derived = remote.ok ? remote.data || [] : [];
  return {
    ok: true,
    data: mergeFavourites(derived, nextPins),
    mode: remote.ok ? remote.mode : 'live',
  };
}

/** Recent searches: device-bucketed per customer id (no column exists for it). */
export function listMySearchHistory(customerId: string | null | undefined): CustomerResult<SearchHistoryItem[]> {
  return { ok: true, data: readSearchHistory(customerId), mode: customerBackendConnected() ? 'live' : 'mock' };
}

export function recordSearch(
  customerId: string | null | undefined,
  query: string,
  city: string
): CustomerResult<SearchHistoryItem[]> {
  const data = pushSearchHistory(customerId, query, city);
  invalidateCustomerData('search-history');
  return { ok: true, data, mode: customerBackendConnected() ? 'live' : 'mock' };
}

export function clearSearchHistory(
  customerId: string | null | undefined
): CustomerResult<SearchHistoryItem[]> {
  invalidateCustomerData('search-history-cleared');
  return { ok: true, data: clearSearchHistoryOnDevice(customerId), mode: customerBackendConnected() ? 'live' : 'mock' };
}

export function listMyRewards(): Promise<CustomerResult<{ wallets: RewardWallet[]; transactions: RewardTransaction[] }>> {
  return customerRequest<{ wallets: RewardWallet[]; transactions: RewardTransaction[] }>(
    '/api/customer/me/rewards',
    { requireAuth: true, empty: { wallets: [], transactions: [] } }
  );
}

export function listMyQrPayments(): Promise<CustomerResult<QrPayment[]>> {
  return customerRequest<QrPayment[]>('/api/customer/me/qr-payments', {
    requireAuth: true,
    empty: [],
  });
}

export function confirmQrPayment(input: {
  salonId: string;
  amount: number;
  reference: string;
  method?: 'qr_scan' | 'upi_id';
}): Promise<CustomerResult<{ payment: QrPayment | null; wallet: RewardWallet | null; transactions: RewardTransaction[] }>> {
  return customerRequest('/api/customer/me/qr-payments/confirm', {
    method: 'POST',
    body: input,
    requireAuth: true,
    empty: { payment: null, wallet: null, transactions: [] },
  });
}

/**
 * Ask the SERVER to verify a recorded QR payment against the payment gateway.
 * The customer never sends an amount: what gets credited is whatever the gateway
 * says was captured, which is why this route exists at all.
 */
export function verifyQrPayment(input: {
  paymentId: string;
  razorpayPaymentId: string;
}): Promise<
  CustomerResult<{
    payment: QrPayment | null;
    wallet: RewardWallet | null;
    transactions: RewardTransaction[];
    verifiedAmount?: number;
    alreadyVerified?: boolean;
  }>
> {
  return customerRequest('/api/customer/me/qr-payments/verify', {
    method: 'POST',
    body: input,
    requireAuth: true,
    empty: { payment: null, wallet: null, transactions: [] },
  });
}

export function listMyMemberships(): Promise<CustomerResult<Membership[]>> {
  return customerRequest<Membership[]>('/api/customer/me/memberships', {
    requireAuth: true,
    empty: [],
  });
}

export function listMyReferrals(): Promise<CustomerResult<{ code: string; link: string; items: Referral[] }>> {
  return customerRequest('/api/customer/me/referrals', {
    requireAuth: true,
    empty: { code: '', link: '', items: [] },
  });
}

export function redeemOffer(input: { offerId: string; salonId: string }): Promise<
  CustomerResult<{ redemption: OfferRedemption | null; wallet: RewardWallet | null; transaction: RewardTransaction | null }>
> {
  return customerRequest('/api/customer/offers/redeem', {
    method: 'POST',
    body: input,
    requireAuth: true,
    empty: { redemption: null, wallet: null, transaction: null },
  });
}

export function listMyNotifications(): Promise<CustomerResult<CustomerNotification[]>> {
  return customerRequest<CustomerNotification[]>('/api/customer/me/notifications', {
    requireAuth: true,
    empty: [],
  });
}

export function markMyNotificationsRead(): Promise<CustomerResult<{ updated: number }>> {
  return customerRequest<{ updated: number }>('/api/customer/me/notifications/read', {
    method: 'POST',
    body: {},
    requireAuth: true,
    empty: { updated: 0 },
  });
}

/** Everything one screen needs to show connection health in one call. */
export function customerConnectionReport(): Promise<
  CustomerResult<{
    mode: 'live' | 'mock';
    tables: Record<string, { exists: boolean; rows: number | null; rls: boolean; policies: number }>;
    mapping: Record<string, { table: string | null; kind: string }>;
  }>
> {
  return customerRequest('/api/customer/connection', { empty: { mode: 'mock', tables: {}, mapping: {} } });
}

// ---------------------------------------------------------------------------
// Invalidation bus — how a write tells every open screen to re-read.
// ---------------------------------------------------------------------------

type InvalidateListener = (reason: string) => void;
const listeners = new Set<InvalidateListener>();

export function onCustomerDataInvalidate(listener: InvalidateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidateCustomerData(reason: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(reason);
    } catch {
      // A broken subscriber must never break the mutation that just succeeded.
    }
  }
}

/** Mapping metadata for the data-source badge, keyed by logical entity name. */
export function customerMappingBadges(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of CUSTOMER_SCHEMA_MAP) {
    out[entry.logical] = entry.kind === 'table' ? `supabase:${entry.table}` : `${entry.kind}:${entry.tables.join('+')}`;
  }
  return out;
}

export function mappingNote(logical: string): string {
  return entityMap(logical)?.note ?? '';
}

export type {
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
  SearchHistoryItem,
  SlotWindow,
};
