// ============================================================================
// Nexora SalonOS — Customer App API.
//
// ONE FILE, BOTH ENTRYPOINTS
// --------------------------
// `registerCustomerRoutes()` is called from `server.ts` (dev/preview) and
// `api/index.ts` (Vercel). This repo's history is full of handlers that were
// hand-copied into both files and then drifted, so nothing here is duplicated:
// routes, guards and mappers all live in this module.
//
// ACCESS MODEL (why a proxy exists instead of the browser talking to Supabase)
// ---------------------------------------------------------------------------
// Every salon table in this schema is owner-scoped (`owner_id = auth.uid()`).
// There is no customer SELECT policy, so a customer token asking PostgREST for
// `services` gets an empty array — not an error, just nothing. Adding customer
// policies would mean changing RLS, which this task explicitly rules out.
//
// So the customer app reads through here, on the service-role client, and this
// module applies the scoping the policies would otherwise apply:
//
//   • catalogue (salons / services / staff / offers / a salon's reviews)
//     → filtered to published + active rows, SELECT only; no write route exists
//   • private rows (bookings, wallet, redemptions, notifications, profile)
//     → the customer id comes ONLY from the verified bearer token, never from
//       the query string or body (the /api/bookings/mine rule), and every write
//       re-reads the row and re-checks ownership before touching it
//
// A mutation that changes availability re-reads the affected rows before
// answering, so a screen never renders a value the database did not confirm.
// ============================================================================

import type { BookingAuthResult } from './bookingAuth';
import { isUuidLike, sanitizeBookingRow } from './bookingOps';
import { isValidIsoDate } from './bookingCreate';
import {
  createRazorpayClient,
  isMockOrderId,
  resolveSignatureSecret,
  verifyRazorpaySignature,
  razorpayPublicConfig,
  logRazorpayConfigSafely,
  fingerprintPaymentOrder,
  rememberPaymentOrder,
  recallPaymentOrder,
  consumePaymentOrder,
  resolveOrderAmount,
  getRazorpayConfigIssues,
} from './razorpay';
import type { RazorpayPayment } from './razorpay';
import { computeAdvanceDeposit, DEFAULT_DEPOSIT_PERCENT } from '../src/lib/advanceDeposit';
import { canCancelBooking, validateReview, MAX_REVIEW_LENGTH } from '../src/lib/bookingTabs';
import {
  buildSlotGrid,
  dayWindowFor,
  QR_MIN_QUALIFYING_RUPEES,
  salonWindowFromHours,
  slotStatusBlocks,
  normalizeReferralCode,
  normalizeClock,
  referralCodeFor,
  CUSTOMER_SCHEMA_MAP,
} from '../src/lib/customer/schema';
import {
  deriveFavourites,
  deriveReferrals,
  isSalonProfile,
  jsonValue,
  toBookingServiceLines,
  toCustomerBooking,
  toCustomerNotification,
  toCustomerProfile,
  toCustomerReview,
  toCustomerSalon,
  toCustomerService,
  toCustomerStaff,
  toMembership,
  toOffer,
  toOfferRedemption,
  toQrPayment,
  toRewardTransaction,
  toRewardWallet,
  toSlotWindow,
  toSalonGallery,
  parseQrDescription,
  qrLedgerDescription,
  QR_PAYMENT_TYPE,
  QR_STATE_BELOW_MINIMUM,
} from '../src/lib/customer/mappers';
import {
  runDb,
  withDbTimeout,
  newRequestId,
  responseAlreadyEnded,
  DEFAULT_DB_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
} from './dbGuard';
import { safeDatabaseError, sendSafeError } from './safeError';

export interface CustomerRoutesDeps {
  db: any;
  isMock: boolean;
  hasAdminClient?: boolean;
  authenticateUser: (req: any, deadlineAt?: number) => Promise<BookingAuthResult>;
  getMockBookings: () => any[];
  getMockNotifications: () => any[];
  addMockNotifications: (rows: any[]) => void;
  resolveOwnerEmail: (ownerId: string | null | undefined, deadlineAt?: number) => Promise<string>;
  now?: () => number;
  /** Discovery scans published salons; cap it so it cannot fan out. */
  discoveryLimit?: number;
  /**
   * Gateway client used to verify a payment before a reward is credited.
   * Injectable so the money rule can be tested without a network, and left
   * undefined in production where `resolveGateway()` builds it from env.
   */
  gateway?: { fetchPayment?: (paymentId: string, deadlineAt?: number) => Promise<any> | null } | null;
}

const DISCOVERY_COLUMNS =
  'id, salon_name, business_type, tagline, about, logo_url, cover_image_url, city, state, full_address, address_line2, postal_code, latitude, longitude, phone_number, whatsapp, instagram_handle, subdomain, currency, theme_preset, theme_accent_key, working_hours, home_service, require_deposit, deposit_percentage, founding_year';

const SALON_SUMMARY_COLUMNS = 'id, salon_name, logo_url, cover_image_url, city, currency';

/**
 * `profiles` columns that appear on a salon's PUBLIC page. On a row that
 * publishes a salon these belong to the owner: a customer editing their own
 * locality, avatar or map pin must not silently repaint or relocate the business
 * that shares the row. Identity columns (`full_name`, `phone_number`,
 * `whatsapp`) stay writable - they are the same person either way.
 */
const SALON_PUBLIC_COLUMNS = [
  'city',
  'full_address',
  'address_line2',
  'postal_code',
  'state',
  'landmark',
  'owner_photo_url',
  'latitude',
  'longitude',
] as const;

/** Columns a customer may write. Salon identity/theme/config are never here. */
const CUSTOMER_PROFILE_COLUMNS = [
  'full_name',
  'phone_number',
  'whatsapp',
  'city',
  'full_address',
  'postal_code',
  'state',
  'landmark',
  'date_of_birth',
] as const;

const CUSTOMER_GEO_COLUMNS = ['latitude', 'longitude'] as const;

function answer(res: any, status: number, body: Record<string, any>): void {
  if (responseAlreadyEnded(res)) return;
  res.status(status).json(body);
}

function ok<T>(res: any, deps: CustomerRoutesDeps, requestId: string, data: T, extra: Record<string, any> = {}): void {
  if (responseAlreadyEnded(res)) return;
  res.json({
    success: true,
    mode: deps.isMock ? 'mock' : 'live',
    requestId,
    data,
    // Every response carries the physical mapping behind it. The Customer App
    // shell shows this as a data-source chip and the verify script asserts on
    // it, so a screen can no longer quietly render something the DB did not give.
    mapped: mappingSummary(),
    ...extra,
  });
}

function fail(res: any, requestId: string, error: unknown, fallback: string): void {
  const safe = safeDatabaseError(error, fallback);
  answer(res, safe.status, {
    success: false,
    code: safe.code,
    requestId,
    error: safe.message,
    ...(safe.retryable ? { retryable: true } : {}),
  });
}

function mappingSummary(): Record<string, { table: string | null; kind: string }> {
  const out: Record<string, { table: string | null; kind: string }> = {};
  for (const entry of CUSTOMER_SCHEMA_MAP) {
    out[entry.logical] = { table: entry.table, kind: entry.kind };
  }
  return out;
}

function notConnectedNotice(deps: CustomerRoutesDeps): Record<string, string> {
  return deps.isMock
    ? { notice: 'Not connected to Supabase — no salon data is available and nothing was saved to a database.' }
    : {};
}

/** `authenticateUser` takes a request; Express exposes it as `res.req`. */
function reqOf(res: any): any {
  return res?.req ?? res?.request ?? { headers: {} };
}

function requireAuth(
  deps: CustomerRoutesDeps,
  res: any,
  requestId: string,
  deadlineAt: number | undefined
): Promise<{ id: string; email?: string } | null> {
  return deps
    .authenticateUser(reqOf(res), deadlineAt)
    .then((auth: BookingAuthResult) => {
      if (!auth.ok) {
        const status = (auth as any).status === 503 ? 503 : 401;
        answer(res, status, {
          success: false,
          code: (auth as any).code ?? 'auth_required',
          requestId,
          error: (auth as any).error ?? 'Please sign in to open your salon account.',
          ...(status === 503 ? { retryable: true } : {}),
        });
        return null;
      }
      return auth.user;
    })
    .catch((err: any) => {
      sendSafeError(res, err, {
        requestId,
        context: 'auth',
        fallbackMessage: 'We could not verify your sign-in right now. Please try again.',
      });
      return null;
    });
}

// ---------------------------------------------------------------------------
// Wallet resolution — the trickiest part of mapping customers onto `clients`
// ---------------------------------------------------------------------------
/**
 * `clients` has no user_id, so a customer's wallets are resolved from keys the
 * customer cannot forge: the email on their verified token, plus the
 * email/phone already stored on their own bookings. The caller never supplies a
 * client id — the ids returned here are what every rewards/QR/redemption read
 * is filtered by, which is what keeps one member's balance out of another's
 * wallet screen.
 */
async function loadCustomerWallets(
  deps: CustomerRoutesDeps,
  user: { id: string; email?: string },
  deadlineAt: number | undefined
): Promise<{ rows: any[] }> {
  if (deps.isMock) return { rows: [] };

  const bookingsResult = await runDb(
    () => deps.db.from('bookings').select('customer_email, customer_phone, owner_id').eq('user_id', user.id).limit(500),
    { label: 'customer identity keys', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  const emails = new Set<string>();
  const phones = new Set<string>();
  if (user.email) emails.add(String(user.email).toLowerCase());
  for (const row of Array.isArray(bookingsResult.data) ? bookingsResult.data : []) {
    const email = String(row?.customer_email ?? '').trim().toLowerCase();
    if (email) emails.add(email);
    const phone = String(row?.customer_phone ?? '').replace(/\D/g, '');
    if (phone.length >= 10) phones.add(phone);
  }
  if (!emails.size && !phones.size) return { rows: [] };

  const walletRows: any[] = [];
  const lookups: Promise<void>[] = [];
  const collect = (column: string, values: string[], label: string) => {
    if (!values.length) return;
    lookups.push(
      runDb(() => deps.db.from('clients').select('*').in(column, values), {
        label,
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      }).then((result) => {
        if (result.error) {
          // A wallet is worth showing the rest of the page for; report, degrade.
          console.warn(`[Customer] ${label} failed:`, result.error.message || result.error);
          return;
        }
        walletRows.push(...(Array.isArray(result.data) ? result.data : []));
      })
    );
  };
  collect('email', [...emails], 'customer wallets by email');
  collect('phone', [...phones], 'customer wallets by phone');
  await Promise.all(lookups);

  const seen = new Set<string>();
  return {
    rows: walletRows.filter((row) => {
      const id = String(row?.id ?? '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };
}

async function loadSalonMap(
  deps: CustomerRoutesDeps,
  rows: any[],
  deadlineAt: number | undefined
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const ids = [...new Set(rows.map((row) => String(row?.owner_id ?? '')).filter((id) => isUuidLike(id)))];
  if (deps.isMock || !ids.length) return map;
  const { data, error } = await runDb(
    () => deps.db.from('profiles').select(SALON_SUMMARY_COLUMNS).in('id', ids),
    { label: 'salon summaries for customer', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[Customer] Salon summary lookup failed (continuing without it):', error.message || error);
    return map;
  }
  for (const row of Array.isArray(data) ? data : []) map.set(String(row.id), row);
  return map;
}

async function loadSalonRowsByIds(deps: CustomerRoutesDeps, ids: string[], deadlineAt: number | undefined): Promise<Map<string, any>> {
  return loadSalonMap(deps, ids.map((id) => ({ owner_id: id })), deadlineAt);
}

async function loadLoyaltyConfigs(
  deps: CustomerRoutesDeps,
  ownerIds: string[],
  deadlineAt: number | undefined
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (deps.isMock || !ownerIds.length) return map;
  const { data, error } = await runDb(
    () => deps.db.from('loyalty_config').select('*').in('owner_id', ownerIds),
    { label: 'loyalty config for customer', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[Customer] Loyalty config lookup failed (using table defaults):', error.message || error);
    return map;
  }
  for (const row of Array.isArray(data) ? data : []) map.set(String(row.owner_id), row);
  return map;
}

// ---------------------------------------------------------------------------
// GET /api/customer/connection — "are the tables really wired up?"
// ---------------------------------------------------------------------------
export function createConnectionHandler(deps: CustomerRoutesDeps) {
  return async function connection(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custconn');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const tables = [...new Set(CUSTOMER_SCHEMA_MAP.flatMap((entry) => entry.tables))].sort();
      const report: Record<string, { exists: boolean; rows: number | null; error?: string }> = {};

      if (deps.isMock) {
        for (const table of tables) report[table] = { exists: false, rows: null, error: 'supabase_not_configured' };
        return void ok(res, deps, requestId, { mode: 'mock', tables: report, mapping: mappingSummary() }, notConnectedNotice(deps));
      }

      await Promise.all(
        tables.map(async (table) => {
          // `head: true` + exact count asks PostgREST for the Content-Range
          // header only: one cheap round-trip per table proves the table exists
          // AND that the service role can read it, without shipping any rows to
          // the browser. `runDb` normalises to {data,error} and would drop the
          // count, so the raw call is timed directly here.
          const remaining = typeof deadlineAt === 'number' ? deadlineAt - Date.now() : LOOKUP_DB_TIMEOUT_MS;
          const budget = Math.max(1, Math.min(LOOKUP_DB_TIMEOUT_MS, remaining));
          try {
            const result: any = await withDbTimeout(
              deps.db.from(table).select('*', { count: 'exact', head: true }),
              `connection check ${table}`,
              budget
            );
            const error = result?.error ?? null;
            if (error) {
              const code = String(error?.code || '');
              const message = String(error?.message || '');
              report[table] = {
                // 42P01 ("undefined_table") is the only answer that means the
                // table is missing. A timeout or a 406 means the table is there
                // and the probe failed — never report that as an absent table.
                exists: code !== '42P01' && !/does not exist|undefined table|relation .* not found/i.test(message),
                rows: null,
                error: message || 'unreadable',
              };
              return;
            }
            report[table] = { exists: true, rows: Number(result?.count ?? 0) };
          } catch (err: any) {
            report[table] = { exists: false, rows: null, error: err?.message || 'probe timed out' };
          }
        })
      );

      ok(res, deps, requestId, { mode: 'live', tables: report, mapping: mappingSummary() });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Connection check threw:`, err?.stack || err);
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'The database connection check could not be completed.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
function numberOr(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null;
}

function matchesTerm(salon: any, term: string): boolean {
  return `${salon.name} ${salon.tagline} ${salon.city} ${salon.businessType}`.toLowerCase().includes(term);
}

/**
 * Salon rating = the average of reviews actually stored on that salon's
 * bookings. One read per page of salons, not one per salon, and no rating is
 * ever displayed for a salon nobody has reviewed.
 */
async function attachRatings(deps: CustomerRoutesDeps, salons: any[], deadlineAt: number | undefined): Promise<any[]> {
  if (deps.isMock || !salons.length) return salons;
  const ownerIds = salons.map((salon) => salon.id).filter(isUuidLike);
  if (!ownerIds.length) return salons;
  const { data, error } = await runDb(
    () =>
      deps.db
        .from('bookings')
        .select('id, owner_id, metadata, status')
        .in('owner_id', ownerIds)
        .not('metadata->>review_rating', 'is', null)
        .limit(2000),
    { label: 'salon ratings for discovery', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[Customer] Rating lookup failed (showing "no ratings yet"):', error.message || error);
    return salons.map((salon) => ({ ...salon, rating: { average: 0, count: 0 } }));
  }
  const buckets = new Map<string, { total: number; count: number }>();
  for (const row of Array.isArray(data) ? data : []) {
    const rating = Number(jsonValue(row, 'review_rating'));
    if (!Number.isFinite(rating) || rating < 1) continue;
    const key = String(row.owner_id);
    const bucket = buckets.get(key) || { total: 0, count: 0 };
    bucket.total += Math.min(5, Math.round(rating));
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return salons.map((salon) => {
    const bucket = buckets.get(String(salon.id));
    return {
      ...salon,
      rating: bucket ? { average: Math.round((bucket.total / bucket.count) * 10) / 10, count: bucket.count } : { average: 0, count: 0 },
    };
  });
}

async function attachServiceCounts(deps: CustomerRoutesDeps, salons: any[], deadlineAt: number | undefined): Promise<any[]> {
  if (deps.isMock || !salons.length) return salons;
  const ownerIds = salons.map((salon) => salon.id).filter(isUuidLike);
  if (!ownerIds.length) return salons;
  const { data, error } = await runDb(
    () => deps.db.from('services').select('id, owner_id').in('owner_id', ownerIds).limit(4000),
    { label: 'service counts for discovery', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[Customer] Service count lookup failed:', error.message || error);
    return salons.map((salon) => ({ ...salon, serviceCount: 0 }));
  }
  const counts = new Map<string, number>();
  for (const row of Array.isArray(data) ? data : []) {
    const key = String(row.owner_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return salons.map((salon) => ({ ...salon, serviceCount: counts.get(String(salon.id)) || 0 }));
}

export function createSalonListHandler(deps: CustomerRoutesDeps) {
  return async function listSalons(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custlist');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      if (deps.isMock) {
        // Echo the filters even with no database: "did my filter reach the API at
        // all?" is the first question worth answering on a deployment without keys.
        return void ok(res, deps, requestId, [], { ...notConnectedNotice(deps), filtersApplied: { ...req.query } });
      }

      const query = req.query || {};
      const limit = Math.min(60, Math.max(1, Number(query.limit || deps.discoveryLimit || 24)));
      const city = String(query.city || '').trim();
      const term = String(query.q || '').trim().toLowerCase();
      const businessType = String(query.businessType || query.business_type || '').trim();
      const category = String(query.category || '').trim();
      const sort = String(query.sort || 'nearby');
      // Price is a ceiling, not a range: "under Rs600" is the question a
      // customer actually asks, and `services.price` on a minimum is what
      // answers it. A floor would filter out the cheap options they want.
      const maxPrice = Number.isFinite(Number(query.maxPrice)) && Number(query.maxPrice) > 0 ? Number(query.maxPrice) : null;
      const minRating = Number.isFinite(Number(query.minRating)) && Number(query.minRating) > 0 ? Number(query.minRating) : null;
      const openOnly = query.openNow === 'true' || query.openNow === '1';
      const offersOnly = query.offersOnly === 'true' || query.offersOnly === '1';

      // Published salons only: a customer's `profiles` row has no salon_name,
      // so without this filter every customer in the app would list as a salon.
      let builder = deps.db
        .from('profiles')
        .select(DISCOVERY_COLUMNS)
        .not('salon_name', 'is', null)
        .not('subdomain', 'is', null);
      if (city) builder = builder.ilike('city', `%${city}%`);
      if (businessType) builder = builder.eq('business_type', businessType);
      if (term && term.length <= 40) {
        builder = builder.or(`salon_name.ilike.%${term}%,tagline.ilike.%${term}%,city.ilike.%${term}%,business_type.ilike.%${term}%`);
      }
      builder = builder.order('salon_name', { ascending: true }).limit(Math.min(300, limit * 6));

      const { data, error } = await runDb(() => builder, {
        label: 'customer salon discovery',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
      if (error) {
        console.error(`[Customer] (${requestId}) Discovery failed:`, error.message || error);
        return void fail(res, requestId, error, 'Salons could not be loaded right now.');
      }

      const rows = (Array.isArray(data) ? data : []).filter(isSalonProfile);
      // One pass over services/rewards/bookings for the whole candidate set: the
      // filters below and the "from Rs" a card quotes both need it, and per-salon
      // queries would turn a 24-card list into ~72 round-trips.
      const catalogue = await attachCatalogueFacts(deps, rows, deadlineAt);

      const salons = rows.map((row: any) => {
        const offered = catalogue.services.get(String(row.id)) || [];
        const prices = offered.map((service: any) => Number(service.price)).filter((value: number) => Number.isFinite(value) && value > 0);
        const categories = [...new Set(offered.map((service: any) => String(service.category || 'General').trim()).filter(Boolean))];
        return toCustomerSalon(row, {
          from: { latitude: numberOr(query.latitude), longitude: numberOr(query.longitude) },
          serviceCount: offered.length,
          minServicePrice: prices.length ? Math.min(...prices) : null,
          categories,
          hasActiveOffers: catalogue.offerOwnerIds.has(String(row.id)),
          recentBookings: catalogue.recentBookings.get(String(row.id)) || 0,
        });
      });
      const withRatings = await attachRatings(deps, salons, deadlineAt);

      const ordered = withRatings
        .filter((salon: any) => (term ? matchesTerm(salon, term) || serviceMatchesTerm(catalogue.services.get(String(salon.id)), term) : true))
        .filter((salon: any) => (category ? salon.categories.some((entry: string) => entry.toLowerCase() === category.toLowerCase()) : true))
        .filter((salon: any) => (maxPrice === null ? true : salon.minServicePrice !== null && salon.minServicePrice <= maxPrice))
        .filter((salon: any) => (minRating === null ? true : salon.rating.count > 0 && salon.rating.average >= minRating))
        .filter((salon: any) => (openOnly ? salon.openNow === true : true))
        .filter((salon: any) => (offersOnly ? salon.hasActiveOffers : true))
        .sort((a: any, b: any) => {
          if (sort === 'rating') return b.rating.average - a.rating.average || a.name.localeCompare(b.name);
          if (sort === 'name') return a.name.localeCompare(b.name);
          if (sort === 'trending') return b.recentBookings - a.recentBookings || b.rating.average - a.rating.average || a.name.localeCompare(b.name);
          if (sort === 'price') return (a.minServicePrice ?? Number.MAX_SAFE_INTEGER) - (b.minServicePrice ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
          const da = a.distanceKm === null ? Number.MAX_SAFE_INTEGER : a.distanceKm;
          const db = b.distanceKm === null ? Number.MAX_SAFE_INTEGER : b.distanceKm;
          return da - db || a.name.localeCompare(b.name);
        })
        .slice(0, limit);

      ok(res, deps, requestId, ordered, {
        filtersApplied: {
          city: city || '',
          q: term || '',
          category: category || '',
          maxPrice,
          minRating,
          openNow: openOnly,
          offersOnly,
          sort,
        },
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Discovery threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Salons could not be loaded right now.' });
    }
  };
}

/** A service menu entry is a legitimate reason to surface a salon for a search. */
function serviceMatchesTerm(services: any[] | undefined, term: string): boolean {
  if (!services || !term) return false;
  return services.some(
    (service: any) =>
      String(service.name || '').toLowerCase().includes(term) || String(service.category || '').toLowerCase().includes(term)
  );
}

export function createSalonDetailHandler(deps: CustomerRoutesDeps) {
  return async function salonDetail(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custsalon');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const handle = String(req.params.idOrSubdomain || '').trim();
      if (!handle) {
        return void answer(res, 400, { success: false, code: 'invalid_request', requestId, error: 'A salon id or subdomain is required.' });
      }
      if (deps.isMock) return void ok(res, deps, requestId, null, notConnectedNotice(deps));

      const lookup = isUuidLike(handle)
        ? deps.db.from('profiles').select(DISCOVERY_COLUMNS).eq('id', handle).maybeSingle()
        : deps.db.from('profiles').select(DISCOVERY_COLUMNS).eq('subdomain', handle.toLowerCase()).maybeSingle();
      const { data: profileRow, error } = await runDb(() => lookup, {
        label: 'salon detail profile',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
      if (error) {
        console.error(`[Customer] (${requestId}) Salon detail failed:`, error.message || error);
        return void fail(res, requestId, error, 'This salon could not be loaded right now.');
      }
      if (!profileRow || !isSalonProfile(profileRow)) {
        // 200 + null means "not published", which the screen renders as an empty
        // state. A 404 here would be indistinguishable from a broken route.
        return void ok(res, deps, requestId, null, { notice: 'This salon is not published yet.' });
      }

      const galleryRows = await runDb(
        () =>
          deps.db
            .from('social_videos')
            .select('id, title, youtube_url, thumbnail_url, category_tag')
            .eq('owner_id', profileRow.id)
            .order('sort_order', { ascending: true })
            .limit(12),
        { label: 'salon gallery', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      if (galleryRows.error) {
        // A missing showcase is decoration, not a broken page: log and continue.
        console.warn(`[Customer] (${requestId}) Gallery lookup failed (salon page shows none):`, galleryRows.error.message || galleryRows.error);
      }
      const [withRating] = await attachRatings(
        deps,
        [
          toCustomerSalon(profileRow, {
            from: { latitude: numberOr(req.query?.lat), longitude: numberOr(req.query?.lng) },
            gallery: toSalonGallery(galleryRows.data || []),
          }),
        ],
        deadlineAt
      );
      const [withCounts] = await attachServiceCounts(deps, [withRating], deadlineAt);
      ok(res, deps, requestId, withCounts);
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Salon detail threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'This salon could not be loaded right now.' });
    }
  };
}

/** `:idOrSubdomain` is a uuid or a published subdomain — resolve it once. */
async function resolveSalonId(
  deps: CustomerRoutesDeps,
  raw: unknown,
  deadlineAt: number | undefined
): Promise<{ id?: string; error?: string; status?: number; code?: string }> {
  const handle = String(raw ?? '').trim();
  if (!handle) return { error: 'A salon id or subdomain is required.', status: 400, code: 'invalid_request' };
  if (isUuidLike(handle)) return { id: handle };
  if (deps.isMock) return { id: handle };
  const { data, error } = await runDb(
    () => deps.db.from('profiles').select('id').eq('subdomain', handle.toLowerCase()).maybeSingle(),
    { label: 'resolve salon subdomain', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    const safe = safeDatabaseError(error, 'This salon could not be resolved.');
    return { error: safe.message, status: safe.status, code: safe.code };
  }
  if (!data?.id) return { error: 'This salon is not published yet.', status: 200, code: 'salon_not_found' };
  return { id: String(data.id) };
}

function salonLookupFailed(res: any, requestId: string, resolved: { error?: string; status?: number; code?: string }): boolean {
  if (!resolved.error) return false;
  answer(res, resolved.status || 400, { success: false, code: resolved.code || 'invalid_request', requestId, error: resolved.error });
  return true;
}

// ---------------------------------------------------------------------------
// Catalogue reads (read-only by construction: no write route exists for these)
// ---------------------------------------------------------------------------
/** What each client row has spent on redemptions, from `loyalty_redeemed_rewards`. */
async function loadRedeemedTotals(deps: CustomerRoutesDeps, wallets: any[], deadlineAt: number | undefined): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (deps.isMock || !wallets.length) return totals;
  const ids = wallets.map((row: any) => String(row.id)).filter(Boolean);
  const { data, error } = await runDb(
    () => deps.db.from('loyalty_redeemed_rewards').select('client_id, points_spent').in('client_id', ids).limit(2000),
    { label: 'redeemed totals', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[Customer] Redeemed total lookup failed (wallet shows 0 redeemed):', error.message || error);
    return totals;
  }
  for (const row of Array.isArray(data) ? data : []) {
    const key = String(row.client_id);
    totals.set(key, (totals.get(key) || 0) + Math.max(0, Number(row.points_spent) || 0));
  }
  return totals;
}

/** Active rewards for one salon, used to label real discounts on service cards. */
async function loadSalonRewards(deps: CustomerRoutesDeps, ownerId: string, deadlineAt: number | undefined): Promise<any[]> {
  if (deps.isMock || !ownerId) return [];
  const { data, error } = await runDb(
    () => deps.db.from('loyalty_rewards').select('*').eq('owner_id', ownerId).eq('is_active', true).limit(60),
    { label: 'salon rewards for service cards', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    // A discount label is decoration; a failed menu read is not. Degrade quietly.
    console.warn('[Customer] Reward lookup failed (service cards show no discount):', error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Everything discovery can only learn by looking at the catalogue: the price a
 * card quotes as "from", the categories that filter works on, whether the salon
 * has live offers, and how much it was booked recently.
 *
 * One query per table for the whole candidate set - discovery would otherwise fan
 * out to four round-trips per salon and turn a list of 24 into 96.
 */
async function attachCatalogueFacts(
  deps: CustomerRoutesDeps,
  salons: any[],
  deadlineAt: number | undefined
): Promise<{ services: Map<string, any[]>; offerOwnerIds: Set<string>; recentBookings: Map<string, number> }> {
  const services = new Map<string, any[]>();
  const offerOwnerIds = new Set<string>();
  const recentBookings = new Map<string, number>();
  if (deps.isMock || !salons.length) return { services, offerOwnerIds, recentBookings };
  const ownerIds = salons.map((salon) => String(salon.id)).filter(isUuidLike);
  if (!ownerIds.length) return { services, offerOwnerIds, recentBookings };

  const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [serviceResult, offerResult, bookingResult] = await Promise.all([
    runDb(
      () =>
        deps.db
          .from('services')
          .select('id, owner_id, name, category, price, duration_minutes')
          .in('owner_id', ownerIds)
          .limit(4000),
      { label: 'discovery service index', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    ),
    runDb(
      () => deps.db.from('loyalty_rewards').select('owner_id, is_active').in('owner_id', ownerIds).eq('is_active', true).limit(1200),
      { label: 'discovery offers', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    ),
    runDb(
      () =>
        deps.db
          .from('bookings')
          .select('owner_id, booking_date')
          .in('owner_id', ownerIds)
          .gte('booking_date', sinceIso)
          .limit(4000),
      { label: 'discovery recent bookings', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    ),
  ]);

  if (serviceResult.error) console.warn('[Customer] Discovery service index failed (cards show no price/categories):', serviceResult.error.message || serviceResult.error);
  for (const row of Array.isArray(serviceResult.data) ? serviceResult.data : []) {
    const key = String(row.owner_id);
    const list = services.get(key) || [];
    list.push(row);
    services.set(key, list);
  }
  if (offerResult.error) console.warn('[Customer] Discovery offer lookup failed:', offerResult.error.message || offerResult.error);
  for (const row of Array.isArray(offerResult.data) ? offerResult.data : []) offerOwnerIds.add(String(row.owner_id));
  if (bookingResult.error) {
    // "Trending" degrades to "no recent signal" rather than to a made-up number.
    console.warn('[Customer] Discovery booking-trend lookup failed:', bookingResult.error.message || bookingResult.error);
  }
  for (const row of Array.isArray(bookingResult.data) ? bookingResult.data : []) {
    const key = String(row.owner_id);
    recentBookings.set(key, (recentBookings.get(key) || 0) + 1);
  }
  return { services, offerOwnerIds, recentBookings };
}

export function createSalonServicesHandler(deps: CustomerRoutesDeps) {
  return async function salonServices(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custsvc');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const resolved = await resolveSalonId(deps, req.params.idOrSubdomain, deadlineAt);
      if (salonLookupFailed(res, requestId, resolved)) return;
      if (deps.isMock) return void ok(res, deps, requestId, [], notConnectedNotice(deps));

      const { data, error } = await runDb(
        () => deps.db.from('services').select('*').eq('owner_id', resolved.id!).order('sort_order').limit(200),
        { label: 'salon services for customer', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) {
        console.error(`[Customer] (${requestId}) Services failed:`, error.message || error);
        return void fail(res, requestId, error, "This salon's service menu could not be loaded.");
      }
      const rewards = await loadSalonRewards(deps, resolved.id!, deadlineAt);
      const services = (Array.isArray(data) ? data : []).map((row: any) => toCustomerService(row, { rewards }));
      ok(res, deps, requestId, services);
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: "This salon's service menu could not be loaded." });
    }
  };
}

export function createSalonStaffHandler(deps: CustomerRoutesDeps) {
  return async function salonStaff(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custstaff');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const resolved = await resolveSalonId(deps, req.params.idOrSubdomain, deadlineAt);
      if (salonLookupFailed(res, requestId, resolved)) return;
      if (deps.isMock) return void ok(res, deps, requestId, [], notConnectedNotice(deps));

      // Inactive staff cannot be booked, so they are not listed; `hide_phone`
      // is applied in the mapper so a hidden number never reaches the browser.
      const { data, error } = await runDb(
        () =>
          deps.db
            .from('stylists')
            .select('*')
            .eq('owner_id', resolved.id!)
            .neq('status', 'Inactive')
            .order('sort_order')
            .limit(100),
        { label: 'salon staff for customer', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) {
        console.error(`[Customer] (${requestId}) Staff failed:`, error.message || error);
        return void fail(res, requestId, error, "This salon's team could not be loaded.");
      }
      ok(res, deps, requestId, (Array.isArray(data) ? data : []).map(toCustomerStaff));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: "This salon's team could not be loaded." });
    }
  };
}

export function createSalonReviewsHandler(deps: CustomerRoutesDeps) {
  return async function salonReviews(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custrevs');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const resolved = await resolveSalonId(deps, req.params.idOrSubdomain, deadlineAt);
      if (salonLookupFailed(res, requestId, resolved)) return;
      if (deps.isMock) return void ok(res, deps, requestId, [], notConnectedNotice(deps));

      const { data, error } = await runDb(
        () =>
          deps.db
            .from('bookings')
            .select('id, owner_id, service_name, booking_date, created_at, updated_at, metadata, status')
            .eq('owner_id', resolved.id!)
            .not('metadata->>review_rating', 'is', null)
            .order('created_at', { ascending: false })
            .limit(100),
        { label: 'salon reviews for customer', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) {
        console.error(`[Customer] (${requestId}) Reviews failed:`, error.message || error);
        return void fail(res, requestId, error, 'Reviews could not be loaded for this salon.');
      }
      ok(res, deps, requestId, (Array.isArray(data) ? data : []).map((row: any) => toCustomerReview(row)).filter(Boolean));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Reviews could not be loaded for this salon.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Slots — availability derived from stylists.schedule minus held bookings
// ---------------------------------------------------------------------------
function staffIdsOf(bookingRow: any): string[] {
  const ids = new Set<string>();
  const metadata = bookingRow?.metadata && typeof bookingRow.metadata === 'object' ? bookingRow.metadata : {};
  const single = String(metadata.stylist_id ?? metadata.staff_id ?? '').trim();
  if (single) ids.add(single);
  for (const line of Array.isArray(metadata.services) ? metadata.services : []) {
    const value = String(line?.staff_id ?? '').trim();
    if (value) ids.add(value);
  }
  return [...ids];
}

function totalDurationFor(serviceIds: string[], serviceRows: any[]): number {
  if (!serviceIds.length) return 0;
  const byId = new Map(serviceRows.map((row) => [String(row.id), row]));
  return serviceIds.reduce((total, id) => total + Number(byId.get(id)?.duration_minutes ?? 30), 0);
}

async function collectSlots(
  deps: CustomerRoutesDeps,
  salonId: string,
  date: string,
  serviceIds: string[],
  staffFilter: string,
  deadlineAt: number | undefined
): Promise<{ slots: any[]; window: any; staffCount: number }> {
  const [staffResult, serviceResult, bookingsResult, profileResult] = await Promise.all([
    runDb(
      () =>
        deps.db
          .from('stylists')
          .select('id, owner_id, name, schedule, status, assigned_services')
          .eq('owner_id', salonId)
          .neq('status', 'Inactive')
          .order('sort_order')
          .limit(100),
      { label: 'slots: staff schedules', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    ),
    runDb(() => deps.db.from('services').select('id, duration_minutes, name').eq('owner_id', salonId).limit(400), {
      label: 'slots: service durations',
      timeoutMs: DEFAULT_DB_TIMEOUT_MS,
      deadlineAt,
    }),
    runDb(
      () => deps.db.from('bookings').select('id, time_slot, status, service_id, metadata').eq('owner_id', salonId).eq('booking_date', date).limit(2000),
      { label: 'slots: held times', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    ),
    runDb(() => deps.db.from('profiles').select('id, working_hours').eq('id', salonId).maybeSingle(), {
      label: 'slots: salon hours',
      timeoutMs: LOOKUP_DB_TIMEOUT_MS,
      deadlineAt,
    }),
  ]);

  const error = staffResult.error || serviceResult.error || bookingsResult.error || profileResult.error;
  if (error) return { slots: [], window: null, staffCount: 0 };

  const duration = totalDurationFor(serviceIds, Array.isArray(serviceResult.data) ? serviceResult.data : []);
  const held = Array.isArray(bookingsResult.data) ? bookingsResult.data : [];
  const salonHours = salonWindowFromHours(profileResult.data?.working_hours || null, date);
  const allStaff = Array.isArray(staffResult.data) ? staffResult.data : [];
  const staffRows = staffFilter ? allStaff.filter((row: any) => String(row.id) === staffFilter) : allStaff;
  const serviceIdSet = new Set(serviceIds);

  const grid: any[] = [];
  for (const staffRow of staffRows) {
    // A stylist must actually be assigned to at least one chosen service.
    const assigned = Array.isArray(staffRow.assigned_services) ? staffRow.assigned_services.map(String) : [];
    if (serviceIdSet.size && assigned.length && !assigned.some((id) => serviceIdSet.has(id))) continue;
    const window = dayWindowFor(staffRow.schedule, date) || salonHours;
    if (!window) continue;

    const heldTimes = held
      .filter((row: any) => {
        if (!slotStatusBlocks(row?.status)) return false;
        const ids = staffIdsOf(row);
        // A booking with no stylist holds the slot for everybody. Assuming it
        // belongs to no one is exactly how a double booking gets created.
        if (!ids.length) return true;
        return ids.includes(String(staffRow.id));
      })
      .map((row: any) => normalizeClock(row.time_slot))
      .filter(Boolean);

    grid.push(
      ...buildSlotGrid({
        date,
        fromTime: window.fromTime,
        toTime: window.toTime,
        durationMinutes: duration,
        takenTimes: heldTimes,
        staffId: String(staffRow.id),
        now: new Date((deps.now ?? Date.now)()),
      }).map((slot) => ({
        ...slot,
        staffName: String(staffRow.name ?? ''),
        reason: slot.available ? '' : heldTimes.includes(slot.time) ? 'booked' : 'past',
      }))
    );
  }
  return { slots: grid, window: { durationMinutes: duration }, staffCount: staffRows.length };
}

export function createSlotsHandler(deps: CustomerRoutesDeps) {
  return async function slots(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custslots');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const resolved = await resolveSalonId(deps, req.params.idOrSubdomain, deadlineAt);
      if (salonLookupFailed(res, requestId, resolved)) return;
      const date = String(req.query?.date ?? '').trim();
      if (!isValidIsoDate(date)) {
        return void answer(res, 400, {
          success: false,
          code: 'invalid_date',
          requestId,
          error: 'A real YYYY-MM-DD date is required to check availability.',
        });
      }
      const serviceIds = String(req.query?.service_ids ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const staffFilter = String(req.query?.staff_id ?? '').trim();

      if (deps.isMock) {
        return void ok(
          res,
          deps,
          requestId,
          toSlotWindow({
            salonId: resolved.id || '',
            date,
            serviceIds,
            durationMinutes: 0,
            slots: [],
            anyStaffScheduled: false,
            anyAvailable: false,
          }),
          notConnectedNotice(deps)
        );
      }

      const { slots: grid, window, staffCount } = await collectSlots(deps, resolved.id!, date, serviceIds, staffFilter, deadlineAt);
      if (!grid.length && !staffCount) {
        // No rows at all can mean "closed", "no stylist has a schedule", or "the
        // salon has no staff". The screen shows the first two honestly instead of
        // an empty grid that looks like a bug.
        console.warn(`[Customer] (${requestId}) No slots for salon ${resolved.id} on ${date}`);
      }
      ok(
        res,
        deps,
        requestId,
        toSlotWindow({
          salonId: resolved.id!,
          date,
          serviceIds,
          durationMinutes: window?.durationMinutes ?? 0,
          slots: grid,
          anyStaffScheduled: grid.length > 0,
          anyAvailable: grid.some((slot) => slot.available),
        })
      );
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Slots threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Availability could not be loaded right now.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Profile + location
// ---------------------------------------------------------------------------
export function createProfileReadHandler(deps: CustomerRoutesDeps) {
  return async function profileRead(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custprof');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      if (deps.isMock) {
        return void ok(res, deps, requestId, toCustomerProfile({ id: user.id, email: user.email || '' }), notConnectedNotice(deps));
      }
      const { data, error } = await runDb(
        () => deps.db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        { label: 'customer profile read', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) return void fail(res, requestId, error, 'Your profile could not be loaded.');
      // `handle_new_user` creates this row on signup. If it is missing (a user
      // created before the trigger existed) answer from the session so the screen
      // still renders instead of dead-ending on a row that will never arrive.
      ok(res, deps, requestId, toCustomerProfile(data || { id: user.id, email: user.email || '', full_name: '' }));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your profile could not be loaded.' });
    }
  };
}

/**
 * Whitelist, not a rename map: an unknown key is dropped, never passed through.
 *
 * Exported so tests (and the setup doc) can assert on the exact rule instead of
 * trusting the handler around it — this is the one function standing between a
 * signed-in customer and the salon's own columns on a shared row.
 */
export function pickProfileUpdates(body: any): { updates: Record<string, any>; dropped: string[] } {
  const updates: Record<string, any> = {};
  const dropped: string[] = [];
  const map: Record<string, string> = {
    fullName: 'full_name',
    // `owner_photo_url` is the person's photo on any row that is not a published
    // salon; on a salon row it is part of their public page, so the guard below
    // refuses it there rather than letting a customer repaint an owner's site.
    avatarUrl: 'owner_photo_url',
    area: 'address_line2',
    phone: 'phone_number',
    whatsapp: 'whatsapp',
    city: 'city',
    address: 'full_address',
    postalCode: 'postal_code',
    state: 'state',
    landmark: 'landmark',
    dateOfBirth: 'date_of_birth',
  };
  // `date_of_birth` is a real date column, not free text: validated before it
  // reaches the database, and an empty value clears it (never stores '').
  if ('dateOfBirth' in (body || {})) {
    const raw = body.dateOfBirth;
    const text = String(raw ?? '').trim();
    if (raw === null || text === '') {
      updates.date_of_birth = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))) {
      dropped.push('dateOfBirth');
    } else if (text > new Date().toISOString().slice(0, 10)) {
      dropped.push('dateOfBirth');
    } else {
      updates.date_of_birth = text;
    }
  }
  for (const [key, column] of Object.entries(map)) {
    if (key === 'dateOfBirth') continue; // handled above with real validation
    if (!(key in (body || {}))) continue;
    const value = body[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (column === 'owner_photo_url' && !/^(https?:\/\/|data:image\/)/i.test(text)) {
      dropped.push(key);
      continue;
    }
    if (text.length > 240) {
      dropped.push(key);
      continue;
    }
    updates[column] = text;
  }
  const allowed = new Set<string>([...CUSTOMER_PROFILE_COLUMNS, ...CUSTOMER_GEO_COLUMNS]);
  for (const key of Object.keys(body || {})) {
    const column = map[key] || key;
    if (!allowed.has(column)) dropped.push(key);
  }
  return { updates, dropped };
}

/** Says exactly which columns were refused, and where they do belong. */
function salonWriteNotice(skipped: string[]): string {
  const unique = [...new Set(skipped)];
  return `Not written from the customer app, because these columns are on your salon's public page: ${unique.join(', ')}. The owner dashboard edits them.`;
}

export function createProfileWriteHandler(deps: CustomerRoutesDeps) {
  return async function profileWrite(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custprofw');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const { updates, dropped } = pickProfileUpdates(req.body);
      const geoRequested = req.body?.latitude !== undefined || req.body?.longitude !== undefined;

      if (deps.isMock) {
        return void ok(res, deps, requestId, toCustomerProfile({ id: user.id, email: user.email || '', ...updates }), {
          notice: 'Not connected to Supabase — nothing was saved.',
        });
      }

      // Geo columns are shared with the salon's own coordinates. Writing a
      // customer's GPS fix into `profiles.latitude` would silently move that
      // salon on every map and distance sort in the app, so it happens only on a
      // row that is not a published salon. Owners keep a location on the device.
      const current = await runDb(
        () => deps.db.from('profiles').select('id, salon_name, business_type, subdomain, city, full_address, latitude, longitude').eq('id', user.id).maybeSingle(),
        { label: 'customer profile pre-read', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      const existing = current.data;
      const isSalonRow = isSalonProfile(existing);
      const finalUpdates: Record<string, any> = { ...updates };
      const skipped: string[] = [...dropped];
      if (geoRequested) {
        if (isSalonRow) {
          skipped.push('latitude', 'longitude');
        } else {
          const lat = numberOr(req.body.latitude);
          const lng = numberOr(req.body.longitude);
          if (lat !== null && lng !== null) {
            finalUpdates.latitude = lat;
            finalUpdates.longitude = lng;
          }
        }
      }
      // The wider rule, stated once: on a row that publishes a salon, anything
      // that shows up on the salon's public page is the owner's to write. A
      // customer sharing that row may edit who they are, not who the salon is.
      if (isSalonRow) {
        for (const column of SALON_PUBLIC_COLUMNS) {
          if (column in finalUpdates) {
            delete finalUpdates[column];
            skipped.push(column);
          }
        }
      }
      delete finalUpdates.id;

      if (!Object.keys(finalUpdates).length) {
        // Still report the geo verdict: the screen decides whether to keep the
        // pin on the device based on this, and silence would read as success.
        return void ok(res, deps, requestId, existing ? toCustomerProfile(existing) : null, {
          locationStored: geoRequested ? !isSalonRow : undefined,
          notice: skipped.length ? salonWriteNotice(skipped) : 'Nothing to update.',
        });
      }
      finalUpdates.updated_at = new Date((deps.now ?? Date.now)()).toISOString();

      // Update-or-insert: the row exists for accounts created after the trigger
      // was installed, and must be created for the ones before it.
      const write = existing
        ? deps.db.from('profiles').update(finalUpdates).eq('id', user.id).select().single()
        : deps.db.from('profiles').insert({ id: user.id, email: user.email || null, ...finalUpdates }).select().single();
      const { data, error } = await runDb(() => write, {
        label: 'customer profile write',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
      if (error) {
        console.error(`[Customer] (${requestId}) Profile write failed:`, error.message || error);
        return void fail(res, requestId, error, 'Your profile could not be saved.');
      }
      ok(res, deps, requestId, toCustomerProfile(data), {
        storedColumns: Object.keys(finalUpdates).filter((key) => key !== 'updated_at'),
        locationStored: geoRequested ? !isSalonRow : undefined,
        ...(skipped.length ? { notice: salonWriteNotice(skipped) } : {}),
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Profile write threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your profile could not be saved.' });
    }
  };
}

/**
 * POST /api/customer/me/location — same writer as the profile, restricted to the
 * location columns, so "Location" in the flow cannot accidentally rename the
 * customer's salon or move an owner's map pin (see the geo rule above).
 */
export function createLocationWriteHandler(deps: CustomerRoutesDeps) {
  const writeProfile = createProfileWriteHandler(deps);
  return async function locationWrite(req: any, res: any): Promise<void> {
    const body = req.body || {};
    req.body = {
      city: body.city,
      address: body.address ?? body.label,
      latitude: body.latitude,
      longitude: body.longitude,
    };
    await writeProfile(req, res);
  };
}

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------
export function createMyBookingsHandler(deps: CustomerRoutesDeps) {
  return async function myBookings(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custbkgs');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const salonFilter = String(req.query?.salon_id ?? '').trim();

      let rows: any[];
      if (deps.isMock) {
        rows = deps
          .getMockBookings()
          .filter((row: any) => String(row.user_id ?? '') === user.id || String(jsonValue(row, 'user_id') ?? '') === user.id);
      } else {
        let builder = deps.db
          .from('bookings')
          .select('*')
          .eq('user_id', user.id)
          .order('booking_date', { ascending: false })
          .limit(200);
        if (salonFilter && isUuidLike(salonFilter)) builder = builder.eq('owner_id', salonFilter);
        const result = await runDb(() => builder, { label: 'customer bookings', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt });
        if (result.error) {
          console.error(`[Customer] (${requestId}) Bookings failed:`, result.error.message || result.error);
          return void fail(res, requestId, result.error, 'Your bookings could not be loaded.');
        }
        rows = Array.isArray(result.data) ? result.data : [];
      }

      const salons = await loadSalonMap(deps, rows, deadlineAt);
      const mapped = rows.map((row: any) => toCustomerBooking(row, { salon: salons.get(String(row.owner_id)) }));
      const tab = String(req.query?.tab ?? '').trim();
      ok(res, deps, requestId, tab ? mapped.filter((booking: any) => tabMatches(booking.status, tab)) : mapped);
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your bookings could not be loaded.' });
    }
  };
}

/** Same three buckets the customer's My Bookings page already uses. */
function tabMatches(status: string, tab: string): boolean {
  if (tab === 'upcoming') return ['pending', 'confirmed', 'in_progress', 'reschedule_requested', 'reschedule_proposed'].includes(status);
  if (tab === 'completed') return status === 'completed';
  return status === 'cancelled' || status === 'no_show';
}

/**
 * Read a booking and prove it belongs to the caller.
 *
 * Answers not-found rather than forbidden for a foreign id: confirming that
 * someone else's booking exists is precisely the information this must leak.
 */
async function loadOwnedBookingRow(
  deps: CustomerRoutesDeps,
  id: string,
  userId: string,
  deadlineAt: number | undefined
): Promise<any | null> {
  if (deps.isMock) {
    const row = deps.getMockBookings().find((item: any) => String(item.id) === id);
    if (!row) return null;
    return String(row.user_id ?? jsonValue(row, 'user_id') ?? '') === userId ? row : null;
  }
  if (!isUuidLike(id)) return null;
  const { data, error } = await runDb(
    () => deps.db.from('bookings').select('*').eq('id', id).maybeSingle(),
    { label: 'customer booking ownership read', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[Customer] Booking ownership read failed:', error.message || error);
    return null;
  }
  if (!data) return null;
  return String(data.user_id ?? '') === userId ? data : null;
}

export function createMyBookingDetailHandler(deps: CustomerRoutesDeps) {
  return async function myBookingDetail(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custbkg');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const id = String(req.params.id ?? '').trim();
      if (!id) return void answer(res, 400, { success: false, code: 'invalid_request', requestId, error: 'A booking id is required.' });
      const row = await loadOwnedBookingRow(deps, id, user.id, deadlineAt);
      if (!row) return void answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });
      const salons = await loadSalonMap(deps, [row], deadlineAt);
      ok(res, deps, requestId, toCustomerBooking(row, { salon: salons.get(String(row.owner_id)) }));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'That booking could not be loaded.' });
    }
  };
}

async function mutateOwnBooking(
  deps: CustomerRoutesDeps,
  id: string,
  changes: Record<string, any>,
  userId: string,
  deadlineAt: number | undefined,
  requestId: string
): Promise<{ row?: any; error?: any }> {
  if (deps.isMock) {
    const rows = deps.getMockBookings();
    const index = rows.findIndex((row: any) => String(row.id) === String(id));
    if (index === -1) return { error: new Error('not_found') };
    const row = { ...rows[index], ...changes };
    rows[index] = row;
    return { row };
  }
  // The re-read IS the check: `changes` can never retarget another row's id.
  const fresh = await loadOwnedBookingRow(deps, String(id), userId, deadlineAt);
  if (!fresh) return { error: new Error('not_found') };
  const { data, error } = await runDb(
    () =>
      deps.db
        .from('bookings')
        .update({ ...changes, updated_at: new Date((deps.now ?? Date.now)()).toISOString() })
        .eq('id', fresh.id)
        .select()
        .single(),
    { label: `customer booking update (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) return { error };
  return { row: data };
}

async function bestEffortNotification(
  deps: CustomerRoutesDeps,
  booking: any,
  title: string,
  message: string,
  deadlineAt: number | undefined
): Promise<number> {
  if (!booking) return 0;
  try {
    const ownerEmail = await deps.resolveOwnerEmail(booking.owner_id, deadlineAt);
    const row = { owner_id: booking.owner_id, user_email: ownerEmail || 'owner@nexora.local', title, message };
    if (deps.isMock) {
      deps.addMockNotifications([{ ...row, id: String(Date.now()), is_read: false, created_at: new Date().toISOString() }]);
      return 1;
    }
    const { error } = await runDb(() => deps.db.from('in_app_notifications').insert([row]), {
      label: 'customer action notification',
      timeoutMs: LOOKUP_DB_TIMEOUT_MS,
      deadlineAt,
      retry: false,
    });
    if (error) {
      console.warn('[Customer] Notification insert failed (action kept):', error.message || error);
      return 0;
    }
    return 1;
  } catch (err: any) {
    // A booking the customer already made must not be reported as failed
    // because the notification feed was unreachable.
    console.warn('[Customer] Notification step threw (action kept):', err?.message || err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Shared booking intent — salon, services, staff, slot, deposit, all from
// live rows. Used by both the payment-order route and booking create so a
// checkout cannot mint an order for a slot the salon does not actually hold.
// ---------------------------------------------------------------------------
type BookingIntentFailure = {
  ok: false;
  status: number;
  code: string;
  error: string;
  retryable?: boolean;
  fieldErrors?: string[];
};

type BookingIntent = {
  ok: true;
  user: { id: string; email?: string };
  ownerUid: string;
  salonRow: any;
  chosen: any[];
  staffRow: any | null;
  duration: number;
  subtotal: number;
  requireDeposit: boolean;
  depositPercentage: number;
  deposit: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  serviceLines: any[];
  metadata: Record<string, any>;
  body: any;
};

async function prepareCustomerBookingIntent(
  deps: CustomerRoutesDeps,
  user: { id: string; email?: string },
  body: any,
  deadlineAt: number | undefined,
  requestId: string
): Promise<BookingIntent | BookingIntentFailure> {
  const problems = validateCustomerBooking(body);
  if (problems.length) {
    return { ok: false, status: 422, code: 'invalid_booking', error: problems[0], fieldErrors: problems };
  }

  if (deps.isMock) {
    return {
      ok: false,
      status: 503,
      code: 'supabase_not_configured',
      retryable: true,
      error: 'Bookings need the connected Supabase database. Nothing was saved or charged.',
    };
  }

  const salonResult = isUuidLike(String(body.salonId))
    ? await runDb(() => deps.db.from('profiles').select(DISCOVERY_COLUMNS).eq('id', body.salonId).maybeSingle(), {
        label: 'booking: salon',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      })
    : await runDb(() => deps.db.from('profiles').select(DISCOVERY_COLUMNS).eq('subdomain', String(body.salonId).toLowerCase()).maybeSingle(), {
        label: 'booking: salon by subdomain',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
  const salonRow = salonResult.data;
  if (salonResult.error) {
    console.error(`[Customer] (${requestId}) Booking aborted (salon read failed):`, salonResult.error.message || salonResult.error);
    return {
      ok: false,
      status: 502,
      code: 'salon_unreadable',
      error: 'We could not reach the salon to complete your booking. Nothing was charged.',
      retryable: true,
    };
  }
  if (!salonRow || !isSalonProfile(salonRow)) {
    return {
      ok: false,
      status: 422,
      code: 'salon_not_published',
      error: 'That salon is not accepting bookings right now.',
    };
  }
  const ownerUid = String(salonRow.id);

  const serviceIds: string[] = Array.isArray(body.serviceIds) ? body.serviceIds.map(String).filter(Boolean) : [];
  const serviceResult = await runDb(
    () => deps.db.from('services').select('id, name, price, duration_minutes, category').eq('owner_id', ownerUid).limit(400),
    { label: 'booking: services', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (serviceResult.error) {
    const safe = safeDatabaseError(serviceResult.error, 'The salon menu could not be read. Please try again.');
    return { ok: false, status: safe.status, code: safe.code, error: safe.message, retryable: safe.retryable };
  }
  const menu: any[] = Array.isArray(serviceResult.data) ? serviceResult.data : [];
  const byId = new Map(menu.map((row) => [String(row.id), row]));
  const chosen = serviceIds.map((id) => byId.get(id)).filter(Boolean);
  if (!chosen.length) {
    return {
      ok: false,
      status: 422,
      code: 'unknown_service',
      error: "None of the selected services are on this salon's menu any more. Please pick again.",
    };
  }

  const staffId = String(body.staffId || '').trim();
  let staffRow: any = null;
  if (staffId) {
    if (!isUuidLike(staffId)) {
      return {
        ok: false,
        status: 400,
        code: 'staff_unavailable',
        error: 'That stylist could not be recognised at this salon. Pick another, or choose "any available".',
      };
    }
    const staffResult = await runDb(
      () => deps.db.from('stylists').select('id, name, status, schedule').eq('id', staffId).eq('owner_id', ownerUid).maybeSingle(),
      { label: 'booking: stylist', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
    );
    if (staffResult.error) {
      const safe = safeDatabaseError(staffResult.error, 'The stylist could not be verified.');
      return { ok: false, status: safe.status, code: safe.code, error: safe.message, retryable: safe.retryable };
    }
    staffRow = staffResult.data;
    if (!staffRow || String(staffRow.status) === 'Inactive') {
      return {
        ok: false,
        status: 400,
        code: 'staff_unavailable',
        error: 'That stylist is not bookable at this salon any more. Pick another, or choose "any available".',
      };
    }
  }

  const clash = await slotIsTaken(deps, ownerUid, String(body.date), String(body.time), staffRow ? String(staffRow.id) : '', deadlineAt);
  if (clash.error) {
    const safe = safeDatabaseError(clash.error, 'Availability could not be checked. Please try again.');
    return { ok: false, status: safe.status, code: safe.code, error: safe.message, retryable: safe.retryable };
  }
  if (clash.taken) {
    return {
      ok: false,
      status: 409,
      code: 'slot_taken',
      error: 'That time was just booked by someone else. Pick another slot — your details are still here.',
      retryable: true,
    };
  }

  const duration = chosen.reduce((total: number, row: any) => total + Number(row.duration_minutes ?? 30), 0);
  const subtotal = chosen.reduce((total: number, row: any) => total + Number(row.price ?? 0), 0);
  const requireDeposit = salonRow.require_deposit === true;
  const depositPercentage = Math.min(100, Math.max(0, Number(salonRow.deposit_percentage ?? 20)));
  const deposit = requireDeposit ? computeAdvanceDeposit(subtotal, depositPercentage).rupees : 0;

  const profileResult = await runDb(
    () => deps.db.from('profiles').select('full_name, phone_number, email, city').eq('id', user.id).maybeSingle(),
    { label: 'booking: customer details', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  const customerRow = profileResult.data || {};
  const customerName = String(body.customerName || customerRow.full_name || 'Customer').trim().slice(0, 120) || 'Customer';
  const customerPhone = String(body.customerPhone || customerRow.phone_number || '').trim();
  const customerEmail = String(user.email || customerRow.email || '').trim();
  const bookingRef = String(body.bookingRef || body.receipt || '').trim().slice(0, 40);

  const serviceLines = chosen.map((row: any, index: number) => ({
    id: `${ownerUid}-${index}`,
    service_id: String(row.id),
    name: String(row.name ?? ''),
    price: Number(row.price ?? 0),
    duration_minutes: Number(row.duration_minutes ?? 30),
    staff_id: staffRow ? String(staffRow.id) : '',
    staff_name: staffRow ? String(staffRow.name ?? '') : '',
  }));

  const metadata = {
    source: 'customer_app',
    services: serviceLines,
    duration_minutes: duration,
    staff_id: staffRow ? String(staffRow.id) : null,
    staff_name: staffRow ? String(staffRow.name ?? '') : null,
    referral_code: normalizeReferralCode(body.referralCode) || null,
    user_id: user.id,
    requested_slot: { date: String(body.date), time: String(body.time) },
    deposit_policy: { require_deposit: requireDeposit, percentage: depositPercentage },
    ...(bookingRef ? { booking_ref: bookingRef } : {}),
  };

  return {
    ok: true,
    user,
    ownerUid,
    salonRow,
    chosen,
    staffRow,
    duration,
    subtotal,
    requireDeposit,
    depositPercentage,
    deposit,
    customerName,
    customerPhone,
    customerEmail,
    serviceLines,
    metadata,
    body,
  };
}

function failIntent(res: any, requestId: string, intent: BookingIntentFailure): void {
  answer(res, intent.status, {
    success: false,
    code: intent.code,
    requestId,
    error: intent.error,
    ...(intent.retryable ? { retryable: true } : {}),
    ...(intent.fieldErrors ? { fieldErrors: intent.fieldErrors } : {}),
  });
}

function verifyPostedRazorpay(body: any): {
  ok: boolean;
  status?: number;
  code?: string;
  error?: string;
  orderId?: string;
  paymentId?: string;
  signature?: string;
  mode?: string;
} {
  const orderId = String(body?.razorpay_order_id ?? body?.orderId ?? '');
  const paymentId = String(body?.razorpay_payment_id ?? body?.paymentId ?? '');
  const signature = String(body?.razorpay_signature ?? body?.signature ?? '');
  if (!orderId || !paymentId || !signature) {
    return {
      ok: false,
      status: 400,
      code: 'payment_reference_required',
      error: 'The gateway reference is missing, so the payment cannot be verified — nothing was recorded.',
    };
  }
  const { secret, mode } = resolveSignatureSecret();
  if (!secret) {
    return {
      ok: false,
      status: 409,
      code: 'payments_disabled',
      error: 'Online payments are not enabled for this salon. Pay at the salon instead.',
    };
  }
  if (mode !== 'mock' && isMockOrderId(orderId)) {
    return {
      ok: false,
      status: 400,
      code: 'payment_unverified',
      error: 'We could not verify your payment with the gateway. Nothing was recorded.',
    };
  }
  const verified = verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: secret });
  if (!verified) {
    console.error('[Customer] Razorpay signature verification FAILED', { order: orderId, mode });
    return {
      ok: false,
      status: 400,
      code: 'payment_unverified',
      error: 'We could not verify your payment with the gateway. Nothing was recorded.',
    };
  }
  return { ok: true, orderId, paymentId, signature, mode };
}

/**
 * GET /api/customer/payments/config
 *
 * Authenticated snapshot of the public key + gateway mode. Missing keys are
 * `configured: false` with HTTP 200 — never HTTP 500. Secrets never leave
 * the server.
 */
export function createPaymentConfigHandler(deps: CustomerRoutesDeps) {
  return async function paymentConfig(_req: any, res: any): Promise<void> {
    const requestId = newRequestId('custpaycfg');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const config = razorpayPublicConfig();
      if (!config.configured) logRazorpayConfigSafely(config);
      // Dual shape: customer `data` envelope + Razorpay top-level fields so
      // both `customerRequest` and `fetchRazorpayConfig` can read it.
      if (responseAlreadyEnded(res)) return;
      res.status(200).json({
        success: true,
        requestId,
        ...config,
        data: config,
        mapped: mappingSummary(),
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Payment config error (returning configured=false, not HTTP 500):`, err?.message || err);
      const fallback = {
        configured: false,
        mock: false,
        mode: 'disabled' as const,
        keyId: null,
        depositPercent: DEFAULT_DEPOSIT_PERCENT,
        code: 'razorpay_not_configured',
        issues: ['Secure payment service is not configured on this server.'],
      };
      if (responseAlreadyEnded(res)) return;
      res.status(200).json({ success: true, requestId, ...fallback, data: fallback });
    }
  };
}

/**
 * POST /api/customer/payments/order
 *
 * Create (or reuse) a Razorpay order only after the signed-in customer, salon,
 * services, amount, staff, date, time and slot have all been validated against
 * live rows. Never invents a paid booking.
 */
export function createPaymentOrderHandler(deps: CustomerRoutesDeps) {
  return async function paymentOrder(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custpayord');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const body = req.body || {};
      const intent = await prepareCustomerBookingIntent(deps, user, body, deadlineAt, requestId);
      if (intent.ok === false) return void failIntent(res, requestId, intent);
      if (intent.deposit <= 0) {
        return void answer(res, 409, {
          success: false,
          code: 'no_deposit_due',
          requestId,
          error: 'This salon does not require an online deposit for the selected services.',
        });
      }

      const claimedTotal = Number(body.totalAmount);
      if (Number.isFinite(claimedTotal) && Math.abs(claimedTotal - intent.subtotal) > 1) {
        return void answer(res, 400, {
          success: false,
          code: 'amount_mismatch',
          requestId,
          error: `The total shown (₹${claimedTotal}) does not match this salon's live menu (₹${intent.subtotal}). Refresh and try again.`,
        });
      }

      const amount = resolveOrderAmount({
        totalAmount: intent.subtotal,
        depositPercent: intent.depositPercentage,
        amount: body.amount,
      });
      if (!amount.ok) {
        return void answer(res, amount.status || 400, { success: false, code: amount.code, requestId, error: amount.error });
      }
      if (Math.abs(amount.rupees - intent.deposit) > 0.5) {
        return void answer(res, 400, {
          success: false,
          code: 'amount_mismatch',
          requestId,
          error: `The advance shown does not match ${intent.depositPercentage}% of ₹${intent.subtotal} (₹${intent.deposit}).`,
        });
      }

      const client = createRazorpayClient();
      if (!client) {
        const issues = getRazorpayConfigIssues();
        console.error('[Customer] Payment order requested but the gateway is disabled:', issues.join(' '));
        return void answer(res, 503, {
          success: false,
          code: 'razorpay_not_configured',
          requestId,
          retryable: true,
          error: 'Online payment is temporarily unavailable (payment gateway not configured). No appointment was created.',
          issues,
        });
      }

      const receipt = String(body.receipt || body.bookingRef || '').slice(0, 40);
      const fingerprint = fingerprintPaymentOrder({
        customer: user.id,
        salon: intent.ownerUid,
        services: intent.chosen.map((row: any) => String(row.id)).sort().join(','),
        date: String(body.date),
        time: String(body.time),
        staff: intent.staffRow ? String(intent.staffRow.id) : '',
        rupees: amount.rupees,
        receipt,
        mode: client.mode,
      });
      const cached = recallPaymentOrder(fingerprint);
      if (cached) {
        console.log(`[Customer] (${requestId}) Reusing unpaid order ${cached.order.id} for ${receipt || 'draft'}`);
        return void res.status(200).json({
          success: true,
          requestId,
          reused: true,
          mode: cached.mode,
          mock: cached.mode === 'mock',
          keyId: cached.keyId,
          order: {
            id: cached.order.id,
            amount: cached.order.amount,
            currency: cached.order.currency,
            receipt: cached.order.receipt ?? null,
          },
          deposit: { rupees: cached.rupees, paise: cached.paise, percent: cached.percent },
          data: {
            order: {
              id: cached.order.id,
              amount: cached.order.amount,
              currency: cached.order.currency,
              receipt: cached.order.receipt ?? null,
            },
            deposit: { rupees: cached.rupees, paise: cached.paise, percent: cached.percent },
            mode: cached.mode,
            keyId: cached.keyId,
            mock: cached.mode === 'mock',
          },
        });
      }

      const order = await client.createOrder(
        {
          amount: amount.rupees,
          currency: 'INR',
          receipt,
          notes: {
            booking_ref: receipt,
            salon_id: intent.ownerUid,
            customer_id: user.id,
            slot: `${body.date} ${body.time}`,
            total_amount: intent.subtotal,
            deposit_percent: intent.depositPercentage,
            advance_amount: amount.rupees,
          },
        },
        deadlineAt
      );
      rememberPaymentOrder(fingerprint, {
        order,
        keyId: client.keyId,
        mode: client.mode,
        rupees: amount.rupees,
        paise: order.amount,
        percent: amount.percent,
      });
      console.log(`[Customer] (${requestId}) ${client.mode} order ${order.id} for ₹${amount.rupees} (receipt ${receipt || 'none'})`);
      res.status(200).json({
        success: true,
        requestId,
        mode: client.mode,
        mock: client.mode === 'mock',
        keyId: client.keyId,
        order: { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt ?? null },
        deposit: { rupees: amount.rupees, paise: order.amount, percent: amount.percent },
        data: {
          order: { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt ?? null },
          deposit: { rupees: amount.rupees, paise: order.amount, percent: amount.percent },
          mode: client.mode,
          keyId: client.keyId,
          mock: client.mode === 'mock',
        },
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Payment order failed:`, err?.stack || err?.message || err);
      const timeout = err?.code === 'razorpay_timeout';
      const unreachable = err?.code === 'razorpay_unreachable';
      const tooSmall = /at least ₹1/.test(String(err?.message || ''));
      if (tooSmall) {
        return void answer(res, 400, { success: false, code: 'invalid_amount', requestId, error: err.message });
      }
      answer(res, timeout ? 504 : unreachable ? 503 : 502, {
        success: false,
        code: timeout ? 'request_timeout' : unreachable ? 'razorpay_unreachable' : 'razorpay_order_failed',
        requestId,
        retryable: true,
        error: timeout
          ? 'The payment gateway took too long to respond. No payment was charged — please try again.'
          : unreachable
            ? 'Online payment is temporarily unreachable from the server. No appointment was created.'
            : 'The payment gateway could not start the order. No payment was charged — please try again.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /api/customer/bookings/create — the transactional booking
// ---------------------------------------------------------------------------
export function createBookingCreateHandler(deps: CustomerRoutesDeps) {
  return async function createBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custnew');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const body = req.body || {};

      // Same captured payment → same booking, even if that row now holds the slot.
      const postedEarly = body.payment && typeof body.payment === 'object' ? body.payment : body;
      const claimedPaymentId = String(postedEarly?.razorpay_payment_id ?? postedEarly?.paymentId ?? '').trim();
      if (claimedPaymentId && !deps.isMock) {
        const existingPaid = await runDb(
          () => deps.db.from('bookings').select('*').eq('payment_id', claimedPaymentId).maybeSingle(),
          { label: 'booking: payment idempotency (early)', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
        );
        const existingRow = existingPaid.data;
        if (existingRow && String(existingRow.user_id ?? '') === user.id) {
          const salon = await runDb(
            () => deps.db.from('profiles').select(DISCOVERY_COLUMNS).eq('id', existingRow.owner_id).maybeSingle(),
            { label: 'booking: salon for paid replay', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
          );
          const snapshot = await collectSlots(deps, String(existingRow.owner_id), String(existingRow.booking_date), [], '', deadlineAt);
          return void ok(res, deps, requestId, {
            booking: toCustomerBooking(existingRow, { salon: salon.data }),
            serviceLines: toBookingServiceLines(existingRow),
            written: { bookings: 0, serviceLines: 0, notifications: 0 },
            slots: snapshot.slots,
            depositDue: 0,
            depositPercent: Number(jsonValue(existingRow, 'deposit_policy')?.percentage) || 0,
            requireDeposit: true,
            salon: salon.data ? toCustomerSalon(salon.data) : undefined,
            referral: { code: jsonValue(existingRow, 'referral_code') || '', credited: false },
            paymentHandoff: 'razorpay_advance',
          }, { notice: 'This payment already created your booking — nothing was charged again.' });
        }
      }

      const intent = await prepareCustomerBookingIntent(deps, user, body, deadlineAt, requestId);
      if (intent.ok === false) return void failIntent(res, requestId, intent);

      const {
        ownerUid,
        salonRow,
        staffRow,
        subtotal,
        requireDeposit,
        depositPercentage,
        deposit,
        customerName,
        customerPhone,
        customerEmail,
        serviceLines,
      } = intent;
      let metadata = intent.metadata;

      // Deposit salons: the booking is created only after the gateway signature
      // verifies. A client cannot skip this by posting `advance_paid_amount`.
      let paidAdvance = 0;
      let paymentId: string | null = null;
      let paymentMode: string | null = null;
      if (deposit > 0) {
        const posted = body.payment && typeof body.payment === 'object' ? body.payment : body;
        const verified = verifyPostedRazorpay(posted);
        if (!verified.ok) {
          if (!posted?.razorpay_payment_id && !posted?.paymentId) {
            return void answer(res, 402, {
              success: false,
              code: 'payment_required',
              requestId,
              error: 'This salon requires an online deposit before the appointment is created. Nothing was saved.',
              depositDue: deposit,
              depositPercent: depositPercentage,
            });
          }
          return void answer(res, verified.status || 400, {
            success: false,
            code: verified.code,
            requestId,
            error: verified.error,
          });
        }
        const claimed = Number(posted.amount);
        if (Number.isFinite(claimed) && Math.abs(claimed - deposit) > 1) {
          return void answer(res, 409, {
            success: false,
            code: 'payment_amount_mismatch',
            requestId,
            error: `The order was for ₹${Math.round(claimed)} but this booking's deposit is ₹${deposit}. Nothing was recorded.`,
          });
        }
        paidAdvance = deposit;
        paymentId = verified.paymentId || null;
        paymentMode = verified.mode || null;
        metadata = {
          ...metadata,
          deposit_paid_at: new Date((deps.now ?? Date.now)()).toISOString(),
          payment_gateway_mode: paymentMode,
          razorpay_order_id: verified.orderId,
        };

        // Idempotency: the same captured payment must not create a second row.
        if (paymentId) {
          const existing = await runDb(
            () => deps.db.from('bookings').select('*').eq('payment_id', paymentId).maybeSingle(),
            { label: 'booking: payment idempotency', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
          );
          const existingRow = existing.data;
          if (existingRow && String(existingRow.user_id ?? '') === user.id) {
            const snapshot = await collectSlots(deps, ownerUid, String(body.date), [], '', deadlineAt);
            return void ok(res, deps, requestId, {
              booking: toCustomerBooking(existingRow, { salon: salonRow }),
              serviceLines: toBookingServiceLines(existingRow),
              written: { bookings: 0, serviceLines: 0, notifications: 0 },
              slots: snapshot.slots,
              depositDue: 0,
              depositPercent: depositPercentage,
              requireDeposit,
              salon: toCustomerSalon(salonRow),
              referral: { code: metadata.referral_code || '', credited: false },
              paymentHandoff: 'razorpay_advance',
            }, { notice: 'This payment already created your booking — nothing was charged again.' });
          }
        }
      }

      // --- 4. create the booking (parent) ---------------------------------
      const parentRow = sanitizeBookingRow({
        owner_id: ownerUid,
        user_id: user.id,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        service_id: serviceLines[0].service_id,
        service_name: serviceLines.map((line) => line.name).join(' + ').slice(0, 240),
        booking_date: String(body.date),
        time_slot: normalizeClock(body.time),
        total_amount: subtotal,
        advance_paid_amount: paidAdvance,
        status: paidAdvance > 0 ? 'confirmed' : 'pending',
        payment_status: paidAdvance > 0 ? 'paid_deposit' : deposit > 0 ? 'pending' : 'pay_at_salon',
        payment_id: paymentId,
        booking_type: body.bookingType === 'home' ? 'home' : 'salon',
        home_address: body.bookingType === 'home' ? String(body.homeAddress || '').slice(0, 300) : null,
        notes: String(body.notes || '').slice(0, 1000) || null,
        metadata,
      });

      const insertResult = await runDb(() => deps.db.from('bookings').insert(parentRow).select().single(), {
        label: 'booking insert',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
      if (insertResult.error || !insertResult.data) {
        console.error(`[Customer] (${requestId}) Booking insert failed:`, insertResult.error);
        if (String((insertResult.error as any)?.code || '') === '23505') {
          return void answer(res, 409, {
            success: false,
            code: 'duplicate_booking',
            requestId,
            error: 'You already have a booking for that salon, date and time.',
          });
        }
        return void fail(res, requestId, insertResult.error, 'Your booking could not be saved. Nothing was charged.');
      }
      const booking = insertResult.data;

      // --- 5. create the booking_services lines -----------------------------
      // No junction table exists, so the lines are their own write against
      // `bookings.metadata.services`. Like the real thing, a failure here rolls
      // the booking back instead of leaving a parent whose total and duration
      // disagree with the services it says it holds.
      const linesWrite = await runDb(
        () =>
          deps.db
            .from('bookings')
            .update({
              metadata: { ...metadata, services_confirmed_at: new Date((deps.now ?? Date.now)()).toISOString() },
            })
            .eq('id', booking.id)
            .select()
            .single(),
        { label: 'booking_services lines', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (linesWrite.error || !linesWrite.data) {
        console.error(`[Customer] (${requestId}) Line write failed — rolling back booking:`, linesWrite.error);
        const rollback = await runDb(() => deps.db.from('bookings').delete().eq('id', booking.id), {
          label: 'booking rollback',
          timeoutMs: DEFAULT_DB_TIMEOUT_MS,
          deadlineAt,
          retry: false,
        });
        if (rollback.error) {
          console.error(`[Customer] (${requestId}) ROLLBACK FAILED — stale booking ${booking.id}:`, rollback.error);
        }
        return void answer(res, 502, {
          success: false,
          code: rollback.error ? 'booking_rollback_failed' : 'booking_incomplete',
          requestId,
          retryable: true,
          error: rollback.error
            ? 'Your booking was started but could not be completed, and we could not cancel it automatically. Please contact the salon — do not pay twice.'
            : 'We could not complete the service list on your booking, so it was cancelled and nothing was saved. Please try again.',
          ...(rollback.error ? { staleBookingId: booking.id } : {}),
        });
      }

      // --- 6. refresh status/details from what the DB actually stored ------
      const refreshed = await runDb(() => deps.db.from('bookings').select('*').eq('id', booking.id).single(), {
        label: 'booking refresh',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
      const stored = refreshed.data || linesWrite.data;

      // 6b. another request can slip in between the check and the insert. If the
      // slot now belongs to somebody else, undo ours: a booking is only kept
      // when there is no competing claimant.
      const collision = await slotIsTaken(deps, ownerUid, String(body.date), String(body.time), staffRow ? String(staffRow.id) : '', deadlineAt, String(booking.id));
      if (collision.taken) {
        console.warn(`[Customer] (${requestId}) Slot collision after insert — cancelling ${booking.id}`);
        await runDb(() => deps.db.from('bookings').delete().eq('id', booking.id), {
          label: 'booking collision rollback',
          timeoutMs: DEFAULT_DB_TIMEOUT_MS,
          deadlineAt,
          retry: false,
        });
        return void answer(res, 409, {
          success: false,
          code: 'slot_taken',
          requestId,
          error: 'That slot was taken a moment ago and your booking was not kept. Please choose another time.',
          retryable: true,
        });
      }

      // 6c. tell the salon (and the customer). Best-effort by design: a
      // notification failure never undoes a booking the database accepted.
      let notificationsWritten = 0;
      try {
        const ownerEmail = await deps.resolveOwnerEmail(ownerUid, deadlineAt);
        const notifRows = [
          {
            owner_id: ownerUid,
            user_email: ownerEmail || 'owner@nexora.local',
            title: 'New booking from the Nexora app',
            message: `${customerName} booked ${stored.service_name || 'a service'} on ${stored.booking_date} at ${stored.time_slot}.`,
          },
        ];
        if (customerEmail) {
          notifRows.push({
            owner_id: ownerUid,
            user_email: customerEmail,
            title: 'Booking request received',
            message: `Your booking at ${salonRow.salon_name} for ${stored.booking_date} at ${stored.time_slot} is pending confirmation.`,
          });
        }
        const notif = await runDb(() => deps.db.from('in_app_notifications').insert(notifRows), {
          label: 'booking notifications',
          timeoutMs: LOOKUP_DB_TIMEOUT_MS,
          deadlineAt,
          retry: false,
        });
        if (notif.error) console.warn(`[Customer] (${requestId}) Notification insert failed (booking kept):`, notif.error.message || notif.error);
        else notificationsWritten = notifRows.length;
      } catch (err: any) {
        console.warn(`[Customer] (${requestId}) Notification step threw (booking kept):`, err?.message || err);
      }

      // --- 7. return the fresh availability grid so the slot disappears ------
      const snapshot = await collectSlots(deps, ownerUid, String(body.date), [], '', deadlineAt);
      if (paidAdvance > 0) {
        consumePaymentOrder(
          fingerprintPaymentOrder({
            customer: user.id,
            salon: ownerUid,
            services: intent.chosen.map((row: any) => String(row.id)).sort().join(','),
            date: String(body.date),
            time: String(body.time),
            staff: staffRow ? String(staffRow.id) : '',
            rupees: paidAdvance,
            receipt: String(body.receipt || body.bookingRef || '').slice(0, 40),
            mode: paymentMode || '',
          })
        );
      }
      ok(res, deps, requestId, {
        booking: toCustomerBooking(stored, { salon: salonRow }),
        serviceLines: toBookingServiceLines(stored),
        written: { bookings: 1, serviceLines: serviceLines.length, notifications: notificationsWritten },
        slots: snapshot.slots,
        depositDue: paidAdvance > 0 ? 0 : deposit,
        depositPercent: depositPercentage,
        requireDeposit,
        salon: toCustomerSalon(salonRow),
        referral: { code: metadata.referral_code || '', credited: false },
        paymentHandoff: paidAdvance > 0 ? 'razorpay_advance' : deposit > 0 ? 'razorpay_advance' : 'pay_at_salon',
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Booking create threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your booking could not be saved. Nothing was charged.' });
    }
  };
}

function validateCustomerBooking(body: any): string[] {
  const problems: string[] = [];
  if (!body || typeof body !== 'object') return ['A booking object is required.'];
  if (!String(body.salonId || '').trim()) problems.push('A salon is required.');
  if (!isValidIsoDate(body.date)) problems.push('Choose a real date (YYYY-MM-DD).');
  if (!/^\d{1,2}:\d{2}$/.test(String(body.time || '').trim())) problems.push('Choose a start time.');
  if (!Array.isArray(body.serviceIds) || !body.serviceIds.filter(Boolean).length) problems.push('Select at least one service.');
  if (body.bookingType === 'home' && String(body.homeAddress || '').trim().length < 8) problems.push('A home-visit address is required.');
  const todayIso = new Date().toISOString().slice(0, 10);
  if (isValidIsoDate(body.date) && String(body.date) < todayIso) problems.push('That date is in the past.');
  return problems;
}

/**
 * Is this slot already held? `ignoreBookingId` lets the caller re-check *after*
 * its own insert without matching itself.
 */
async function slotIsTaken(
  deps: CustomerRoutesDeps,
  ownerUid: string,
  date: string,
  time: string,
  staffId: string,
  deadlineAt: number | undefined,
  ignoreBookingId?: string
): Promise<{ taken: boolean; error?: any }> {
  if (deps.isMock) {
    return {
      taken: deps.getMockBookings().some(
        (row: any) =>
          String(row.owner_id) === ownerUid &&
          String(row.booking_date) === date &&
          normalizeClock(row.time_slot) === normalizeClock(time) &&
          slotStatusBlocks(row.status) &&
          (!ignoreBookingId || String(row.id) !== ignoreBookingId) &&
          (!staffId || !staffIdsOf(row).length || staffIdsOf(row).includes(staffId))
      ),
    };
  }
  // `time_slot` is free text, so the same appointment can be stored as `11:00` or
  // `11:00:00`. An `.eq` on one spelling would miss the other and call the slot
  // free, so both are asked for and the answer is judged on normalised values.
  const clock = normalizeClock(time);
  const spellings = [...new Set([clock, `${clock}:00`])];
  const { data, error } = await runDb(
    () =>
      deps.db
        .from('bookings')
        .select('id, metadata, status, time_slot')
        .eq('owner_id', ownerUid)
        .eq('booking_date', date)
        .in('time_slot', spellings)
        .limit(100),
    { label: 'slot collision check', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) return { taken: false, error };
  for (const row of Array.isArray(data) ? data : []) {
    if (normalizeClock(row.time_slot) !== clock) continue;
    if (ignoreBookingId && String(row.id) === ignoreBookingId) continue;
    if (!slotStatusBlocks(row.status)) continue;
    const ids = staffIdsOf(row);
    if (!staffId || !ids.length || ids.includes(staffId)) return { taken: true };
  }
  return { taken: false };
}

// ---------------------------------------------------------------------------
// Cancel / reschedule / review
// ---------------------------------------------------------------------------
export function createCancelHandler(deps: CustomerRoutesDeps) {
  return async function cancel(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custcancel');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const row = await loadOwnedBookingRow(deps, String(req.body?.id ?? ''), user.id, deadlineAt);
      if (!row) return void answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });

      // The same rule the button uses, so the server can never refuse what the
      // UI promised (or accept what it warned about).
      const decision = canCancelBooking({
        status: row.status,
        date: row.booking_date,
        time: row.time_slot,
        nowMs: (deps.now ?? Date.now)(),
      });
      if (!decision.allowed) {
        return void answer(res, 409, {
          success: false,
          code: 'not_cancellable',
          requestId,
          error: decision.reason || 'This booking can no longer be cancelled here. Please contact the salon.',
        });
      }
      const updated = await mutateOwnBooking(deps, row.id, { status: 'cancelled' }, user.id, deadlineAt, requestId);
      if (updated.error) return void fail(res, requestId, updated.error, 'Your booking could not be cancelled.');
      await bestEffortNotification(
        deps,
        updated.row,
        'Booking cancelled',
        `${row.customer_name || 'A customer'} cancelled the ${row.service_name || 'appointment'} on ${row.booking_date} at ${row.time_slot}.`,
        deadlineAt
      );
      ok(res, deps, requestId, toCustomerBooking(updated.row, {}));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your booking could not be cancelled.' });
    }
  };
}

export function createRescheduleHandler(deps: CustomerRoutesDeps) {
  return async function reschedule(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custresch');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const row = await loadOwnedBookingRow(deps, String(req.body?.id ?? ''), user.id, deadlineAt);
      if (!row) return void answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });

      const date = String(req.body?.proposed_date ?? '').trim();
      const time = String(req.body?.proposed_time_slot ?? '').trim();
      if (!isValidIsoDate(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
        return void answer(res, 400, {
          success: false,
          code: 'invalid_request',
          requestId,
          error: 'A real date and time are required to propose a new time.',
        });
      }
      const taken = await slotIsTaken(deps, String(row.owner_id), date, time, String(jsonValue(row, 'staff_id') || ''), deadlineAt, String(row.id));
      if (taken.taken) {
        return void answer(res, 409, { success: false, code: 'slot_taken', requestId, error: 'That new time is already booked. Pick another one.', retryable: true });
      }
      const updated = await mutateOwnBooking(
        deps,
        row.id,
        { status: 'reschedule_proposed', proposed_date: date, proposed_time_slot: time },
        user.id,
        deadlineAt,
        requestId
      );
      if (updated.error) return void fail(res, requestId, updated.error, 'Your request could not be sent.');
      await bestEffortNotification(
        deps,
        updated.row,
        'Reschedule requested',
        `${row.customer_name || 'A customer'} asked to move their ${row.service_name || 'appointment'} to ${date} at ${time}.`,
        deadlineAt
      );
      ok(res, deps, requestId, toCustomerBooking(updated.row, {}));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your request could not be sent.' });
    }
  };
}

/**
 * Complete the deposit for a booking that already exists (pay-at-salon salons,
 * or a leftover pending row). Deposit salons now collect payment *before*
 * insert (`createBookingCreateHandler`); this route remains for bookings that
 * were saved unpaid. The signature is re-verified HERE, and the amount stored
 * is the one *this server* recomputes from the booking total and the deposit
 * percentage — never whatever the client claims it paid.
 */
export function createBookingAdvanceHandler(deps: CustomerRoutesDeps) {
  return async function bookingAdvance(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custpay');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      if (deps.isMock) {
        return void answer(res, 503, {
          success: false,
          code: 'supabase_not_configured',
          requestId,
          error: 'A deposit cannot be attached while the database is not configured — nothing was charged.',
          retryable: true,
        });
      }
      const row = await loadOwnedBookingRow(deps, String(req.params.id ?? req.body?.id ?? ''), user.id, deadlineAt);
      if (!row) return void answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });

      // Idempotency first: a customer who pays twice must not be charged twice.
      const paidAlready = String(row.payment_status ?? 'pending') !== 'pending';
      if (paidAlready) {
        ok(res, deps, requestId, toCustomerBooking(row, {}), {
          notice: 'This booking already has its deposit recorded — nothing was charged again.',
        });
        return;
      }

      const orderId = String(req.body?.razorpay_order_id ?? req.body?.orderId ?? '');
      const paymentId = String(req.body?.razorpay_payment_id ?? req.body?.paymentId ?? '');
      const signature = String(req.body?.razorpay_signature ?? req.body?.signature ?? '');
      if (!orderId || !paymentId || !signature) {
        return void answer(res, 400, {
          success: false,
          code: 'payment_reference_required',
          requestId,
          error: 'The gateway reference is missing, so the payment cannot be verified — nothing was recorded.',
        });
      }

      const { secret, mode } = resolveSignatureSecret();
      if (!secret) {
        return void answer(res, 409, {
          success: false,
          code: 'payments_disabled',
          requestId,
          error: 'Online payments are not enabled for this salon. Pay at the salon instead.',
        });
      }
      if (mode !== 'mock' && isMockOrderId(orderId)) {
        return void answer(res, 400, {
          success: false,
          code: 'payment_unverified',
          requestId,
          error: 'We could not verify your payment with the gateway. The booking is still pending — no amount was recorded.',
        });
      }
      const verified = verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: secret });
      if (!verified) {
        console.error('[Customer] Razorpay signature verification FAILED for a deposit', { order: orderId, mode });
        return void answer(res, 400, {
          success: false,
          code: 'payment_unverified',
          requestId,
          error: 'We could not verify your payment with the gateway. The booking is still pending — no amount was recorded.',
        });
      }

      const total = Number(row.total_amount ?? 0);
      // Percentage precedence: what the client was told at booking time, then
      // the policy stored on the booking itself, then the app-wide default. The
      // salon can change its deposit policy between the two requests; the stored
      // policy is what the customer agreed to, so that is what we honour.
      const storedPolicy = jsonValue(row, 'deposit_policy');
      const percent = [
        Number(req.body?.depositPercent),
        Number(storedPolicy && storedPolicy.percentage),
        Number(row.deposit_percentage),
      ].find((value) => Number.isFinite(value) && value > 0) ?? DEFAULT_DEPOSIT_PERCENT;
      const expected = computeAdvanceDeposit(total, percent);
      if (expected.rupees <= 0) {
        return void answer(res, 409, {
          success: false,
          code: 'no_deposit_due',
          requestId,
          error: 'This booking has no deposit due.',
        });
      }
      const claimed = Number(req.body?.amount);
      if (Number.isFinite(claimed) && Math.abs(claimed - expected.rupees) > 1) {
        return void answer(res, 409, {
          success: false,
          code: 'payment_amount_mismatch',
          requestId,
          error: `The order was for ₹${Math.round(claimed)} but this booking's deposit is ₹${expected.rupees}. Nothing was recorded — please contact the salon.`,
        });
      }

      const metadata = { ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}), deposit_paid_at: new Date((deps.now ?? Date.now)()).toISOString(), payment_gateway_mode: mode };
      const updated = await mutateOwnBooking(
        deps,
        row.id,
        {
          advance_paid_amount: expected.rupees,
          payment_id: paymentId,
          payment_status: 'paid_deposit',
          status: row.status === 'pending' ? 'confirmed' : row.status,
          metadata,
        },
        user.id,
        deadlineAt,
        requestId
      );
      if (updated.error) {
        // The money IS captured, so this must not read as a failed payment.
        console.error('[Customer] deposit captured but not recorded on the booking', { requestId, code: (updated.error as any)?.code });
        answer(res, 200, {
          success: true,
          mode: 'live',
          requestId,
          notice:
            'Your payment succeeded, but the booking could not be updated. The salon has the payment reference — please show them this screen.',
          data: { paymentId, orderId, amount: expected.rupees, needsSalonAttention: true },
          mapped: mappingSummary(),
        });
        return;
      }

      await bestEffortNotification(
        deps,
        updated.row,
        'Deposit paid online',
        `${row.customer_name || 'A customer'} paid a ₹${expected.rupees} deposit for the appointment on ${String(updated.row?.booking_date ?? row.booking_date ?? '')} at ${String(updated.row?.time_slot ?? row.time_slot ?? '')}.`,
        deadlineAt
      );

      ok(res, deps, requestId, toCustomerBooking(updated.row, {}), {
        paymentId,
        orderId,
        amount: expected.rupees,
        gatewayMode: mode,
      });
    } catch (err: any) {
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Your payment could not be recorded. If money left your account, contact the salon with your booking reference.',
      });
    }
  };
}

export function createReviewWriteHandler(deps: CustomerRoutesDeps) {
  return async function reviewWrite(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custrevw');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const row = await loadOwnedBookingRow(deps, String(req.body?.id ?? ''), user.id, deadlineAt);
      if (!row) return void answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });

      const validation = validateReview({ status: row.status, rating: req.body?.rating, text: req.body?.text });
      if (!validation.ok) {
        return void answer(res, 422, { success: false, code: 'invalid_review', requestId, error: validation.error });
      }
      // Exactly the shape /api/bookings/mine/review writes, so owner and
      // customer screens read one field rather than two competing ones.
      const prior = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const metadata = {
        ...prior,
        review_rating: validation.rating,
        review_text: String(validation.text || '').slice(0, MAX_REVIEW_LENGTH),
        reviewed_at: new Date((deps.now ?? Date.now)()).toISOString(),
        reviewed_by: user.id,
      };
      const updated = await mutateOwnBooking(deps, row.id, { metadata }, user.id, deadlineAt, requestId);
      if (updated.error) return void fail(res, requestId, updated.error, 'Your review could not be saved.');
      await bestEffortNotification(
        deps,
        updated.row,
        `New ${validation.rating}-star review`,
        `${row.customer_name || 'A customer'} rated their ${row.service_name || 'appointment'} ${validation.rating}/5.`,
        deadlineAt
      );
      ok(res, deps, requestId, toCustomerReview(updated.row));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your review could not be saved.' });
    }
  };
}

export function createReviewListHandler(deps: CustomerRoutesDeps) {
  return async function reviewList(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custrevlist');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      let rows: any[];
      if (deps.isMock) {
        rows = deps.getMockBookings().filter((row: any) => String(row.user_id ?? '') === user.id);
      } else {
        const result = await runDb(
          () =>
            deps.db
              .from('bookings')
              .select('*')
              .eq('user_id', user.id)
              .not('metadata->>review_rating', 'is', null)
              .order('updated_at', { ascending: false })
              .limit(200),
          { label: 'my reviews', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (result.error) return void fail(res, requestId, result.error, 'Your reviews could not be loaded.');
        rows = Array.isArray(result.data) ? result.data : [];
      }
      const salons = await loadSalonMap(deps, rows, deadlineAt);
      const reviews = rows
        .map((row: any) => toCustomerReview({ ...row, salon_name: salons.get(String(row.owner_id))?.salon_name }))
        .filter(Boolean);
      ok(res, deps, requestId, reviews);
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your reviews could not be loaded.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Favourites (derived) / search suggestions (derived) / geocode
// ---------------------------------------------------------------------------
export function createFavouritesHandler(deps: CustomerRoutesDeps) {
  return async function favourites(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custfav');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const bookingsResult = deps.isMock
        ? { data: deps.getMockBookings().filter((row: any) => String(row.user_id ?? jsonValue(row, 'user_id') ?? '') === user.id), error: null as any }
        : await runDb(
            () => deps.db.from('bookings').select('*').eq('user_id', user.id).order('booking_date', { ascending: false }).limit(300),
            { label: 'favourites from bookings', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
          );
      if (bookingsResult.error) return void fail(res, requestId, bookingsResult.error, 'Your favourites could not be loaded.');
      const rows = Array.isArray(bookingsResult.data) ? bookingsResult.data : [];
      const salons = await loadSalonMap(deps, rows, deadlineAt);
      const bookings = rows.map((row: any) => toCustomerBooking(row, { salon: salons.get(String(row.owner_id)) }));
      // Only the derived half — manual pins live on the device (see schema map).
      ok(res, deps, requestId, deriveFavourites(bookings, salons));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your favourites could not be loaded.' });
    }
  };
}

export function createSearchSuggestionsHandler(deps: CustomerRoutesDeps) {
  return async function suggestions(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custsugg');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const city = String(req.query?.city || '').trim();
      if (deps.isMock) return void ok(res, deps, requestId, [], notConnectedNotice(deps));

      const salonResult = await runDb(
        () => {
          let builder = deps.db.from('profiles').select('id, salon_name, city').not('salon_name', 'is', null);
          if (city) builder = builder.ilike('city', `%${city}%`);
          return builder.limit(80);
        },
        { label: 'suggestion salons', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      const salons = Array.isArray(salonResult.data) ? salonResult.data : [];
      const ids = salons.map((row: any) => String(row.id)).filter(isUuidLike);
      if (!ids.length) return void ok(res, deps, requestId, []);

      const serviceResult = await runDb(
        () => deps.db.from('services').select('name, category, owner_id').in('owner_id', ids).limit(1500),
        { label: 'suggestion services', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      const counts = new Map<string, { count: number; city: string }>();
      const bump = (name: string, city: string) => {
        const clean = String(name || '').trim();
        if (!clean) return;
        const key = clean.toLowerCase().slice(0, 60);
        const entry = counts.get(key) || { count: 0, city };
        entry.count += 1;
        counts.set(key, entry);
      };
      for (const row of Array.isArray(serviceResult.data) ? serviceResult.data : []) {
        bump(row.name, '');
      }
      // Salon names count too, so typing a salon's name suggests the salon.
      for (const row of salons) bump(row.salon_name, String(row.city || ''));

      const term = String(req.query?.q || '').trim().toLowerCase();
      const items = [...counts.entries()]
        .filter(([key]) => (term ? key.includes(term) : true))
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([key, value]) => ({
          id: key,
          query: key,
          city: value.city,
          usedAt: new Date().toISOString(),
          count: value.count,
          source: 'derived' as const,
        }));
      ok(res, deps, requestId, items);
    } catch (err: any) {
      // Suggestions are an affordance, not a fact: failure shows none, never an
      // error banner over a search box.
      console.warn(`[Customer] (${requestId}) Suggestions failed (showing none):`, err?.message || err);
      ok(res, deps, requestId, []);
    }
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(value))) return Number.NaN;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function createGeocodeHandler(deps: CustomerRoutesDeps) {
  return async function geocode(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custgeo');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const lat = numberOr(req.query?.lat);
      const lng = numberOr(req.query?.lng);
      if (lat === null || lng === null) return void ok(res, deps, requestId, { city: '' });
      if (deps.isMock) return void ok(res, deps, requestId, { city: '' }, notConnectedNotice(deps));
      const { data, error } = await runDb(
        () =>
          deps.db
            .from('profiles')
            .select('id, city, latitude, longitude, salon_name')
            .not('salon_name', 'is', null)
            .not('latitude', 'is', null)
            .limit(500),
        { label: 'reverse geocode', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) {
        console.warn(`[Customer] (${requestId}) Geocode failed (falling back to manual city):`, error.message || error);
        return void ok(res, deps, requestId, { city: '' });
      }
      let best: { city: string; distance: number } | null = null;
      for (const row of Array.isArray(data) ? data : []) {
        const distance = haversineKm(lat, lng, Number(row.latitude), Number(row.longitude));
        if (!Number.isFinite(distance)) continue;
        if (!best || distance < best.distance) best = { city: String(row.city || ''), distance };
      }
      ok(res, deps, requestId, { city: best?.city || '', nearestKm: best ? Math.round(best.distance * 10) / 10 : null });
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your city could not be detected.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------
async function loadTransactionsForWallets(
  deps: CustomerRoutesDeps,
  wallets: any[],
  types: string[] | undefined,
  deadlineAt: number | undefined
): Promise<any[]> {
  if (deps.isMock || !wallets.length) return [];
  const clientIds = wallets.map((row: any) => String(row.id)).filter(Boolean);
  if (!clientIds.length) return [];
  let builder = deps.db
    .from('loyalty_point_transactions')
    .select('*')
    .in('client_id', clientIds)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (types && types.length) builder = builder.in('type', types);
  const { data, error } = await runDb(() => builder, { label: 'reward transactions', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt });
  if (error) {
    // The balance is on the wallet row, so a ledger failure degrades to
    // "points, no history" rather than hiding the whole screen.
    console.warn('[Customer] Transaction lookup failed (showing the wallet only):', error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export function createRewardsHandler(deps: CustomerRoutesDeps) {
  return async function rewards(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custrw');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const wallets = await loadCustomerWallets(deps, user, deadlineAt);
      if (!wallets.rows.length) return void ok(res, deps, requestId, { wallets: [], transactions: [] });
      const ownerIds = [...new Set(wallets.rows.map((row: any) => String(row.owner_id)))];
      const [salons, configs, transactions, redeemed] = await Promise.all([
        loadSalonRowsByIds(deps, ownerIds, deadlineAt),
        loadLoyaltyConfigs(deps, ownerIds, deadlineAt),
        loadTransactionsForWallets(deps, wallets.rows, undefined, deadlineAt),
        loadRedeemedTotals(deps, wallets.rows, deadlineAt),
      ]);
      ok(res, deps, requestId, {
        wallets: wallets.rows.map((row: any) => {
          const salon = salons.get(String(row.owner_id));
          const config = configs.get(String(row.owner_id));
          return toRewardWallet(row, {
            salonName: salon?.salon_name,
            currency: salon?.currency,
            config,
            programEnabled: config?.program_enabled !== false,
            // Earned and redeemed are sums of this customer's own rows, not the
            // lifetime counter: a client's `lifetime_points` never goes down when
            // they redeem, so the two numbers answer different questions.
            lifetimeEarned: transactions
              .filter((entry: any) => String(entry.client_id) === String(row.id))
              .reduce((sum: number, entry: any) => sum + Math.max(0, Number(entry.points_change) || 0), 0),
            lifetimeRedeemed: redeemed.get(String(row.id)) || 0,
          });
        }),
        transactions: transactions.map((row: any) => toRewardTransaction(row, salons.get(String(row.owner_id))?.salon_name || '')),
      });
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your rewards could not be loaded.' });
    }
  };
}

/** A reward may only be credited from evidence the customer cannot produce. */
function resolveGateway(deps: CustomerRoutesDeps): { client: any | null; reason: string } {
  if (deps.gateway !== undefined) return { client: deps.gateway, reason: '' };
  const client = createRazorpayClient();
  if (!client) {
    return { client: null, reason: 'This deployment has no payment gateway configured, so the salon must confirm the credit at the desk.' };
  }
  if (client.mode === 'mock') {
    return { client: null, reason: 'This deployment runs a simulated gateway, which has no real payment to verify — the salon confirms the credit.' };
  }
  if (typeof client.fetchPayment !== 'function') {
    return { client: null, reason: 'This deployment cannot look up a payment, so the salon must confirm the credit.' };
  }
  return { client, reason: '' };
}

/** Points a VERIFIED rupee amount earns under the salon's own configuration. */
function qrPointsForAmount(amountRupees: number, perHundred: number): number {
  if (amountRupees < QR_MIN_QUALIFYING_RUPEES) return 0;
  return Math.max(0, Math.floor((amountRupees / 100) * Math.max(0, perHundred)));
}

export function createQrPaymentsHandler(deps: CustomerRoutesDeps) {
  return async function qrPayments(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custqr');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const wallets = await loadCustomerWallets(deps, user, deadlineAt);
      const transactions = await loadTransactionsForWallets(deps, wallets.rows, [QR_PAYMENT_TYPE], deadlineAt);
      const salons = await loadSalonRowsByIds(deps, [...new Set(transactions.map((row: any) => String(row.owner_id)))], deadlineAt);
      ok(res, deps, requestId, transactions.map((row: any) => toQrPayment(row, salons.get(String(row.owner_id))?.salon_name || '')));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your QR rewards could not be loaded.' });
    }
  };
}

/**
 * POST /api/customer/me/qr-payments/confirm
 *
 * A customer recording a QR payment creates a LEDGER ENTRY, not a reward. The
 * row goes in with `points_change = 0` and an "awaiting verification"
 * description, and `clients.points` is never touched here.
 *
 * That asymmetry is the point: the amount and reference in this request are
 * claims. Crediting points from them would let anyone type ₹50,000 into the
 * customer app and buy a haircut. The credit happens in
 * `POST /api/customer/me/qr-payments/verify`, which asks the payment gateway
 * what it actually received — a call only a server holding the secret key can
 * make — or when the salon records the entry themselves.
 */
export function createQrConfirmHandler(deps: CustomerRoutesDeps) {
  return async function qrConfirm(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custqrc');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const salonId = String(req.body?.salonId ?? '').trim();
      const amount = Math.round(Number(req.body?.amount ?? 0) * 100) / 100;
      const reference = String(req.body?.reference ?? '').trim().slice(0, 64);
      if (!salonId) return void answer(res, 400, { success: false, code: 'invalid_request', requestId, error: 'Scan a salon QR to record a payment.' });
      if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) {
        return void answer(res, 422, { success: false, code: 'invalid_amount', requestId, error: 'Enter a real payment amount between 1 and 500000.' });
      }
      if (!reference) {
        return void answer(res, 422, { success: false, code: 'invalid_reference', requestId, error: 'The QR code could not be read. Try again in better light.' });
      }
      if (deps.isMock) {
        return void answer(res, 503, {
          success: false,
          code: 'supabase_not_configured',
          requestId,
          retryable: true,
          error: 'QR payments need the connected Supabase database. Nothing was recorded.',
        });
      }

      // Only a wallet the customer already owns at this salon may be linked.
      const wallets = await loadCustomerWallets(deps, user, deadlineAt);
      const wallet = wallets.rows.find((row: any) => String(row.owner_id) === salonId);
      if (!wallet) {
        return void answer(res, 422, {
          success: false,
          code: 'no_wallet_at_salon',
          requestId,
          error: 'You do not have a rewards wallet at this salon yet. Book a service there first, and your QR payments will be credited to it.',
        });
      }

      // A payment that was never logged twice: the same salon + amount +
      // reference is the same event, so a double tap returns the existing entry.
      const existing = await runDb(
        () =>
          deps.db
            .from('loyalty_point_transactions')
            .select('*')
            .eq('client_id', wallet.id)
            .eq('type', QR_PAYMENT_TYPE)
            .ilike('description', `%ref:${reference}%`)
            .limit(1),
        { label: 'qr: duplicate check', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      const existingRow = Array.isArray(existing.data) ? existing.data[0] : null;
      if (existingRow) {
        const salons = await loadSalonRowsByIds(deps, [salonId], deadlineAt);
        ok(res, deps, requestId, { payment: toQrPayment(existingRow, salons.get(salonId)?.salon_name || ''), wallet: null, transactions: [] }, {
          notice: 'This payment was already recorded — nothing was added twice.',
        });
        return;
      }

      const configResult = await runDb(() => deps.db.from('loyalty_config').select('*').eq('owner_id', salonId).maybeSingle(), {
        label: 'qr: loyalty config',
        timeoutMs: LOOKUP_DB_TIMEOUT_MS,
        deadlineAt,
      });
      const config = configResult.data || {};
      const perHundred = Math.max(0, Number(config.points_per_hundred_spent ?? 10));
      const programOff = config.program_enabled === false;
      const estimated = programOff ? 0 : qrPointsForAmount(amount, perHundred);

      const today = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10);
      const txInsert = await runDb(
        () =>
          deps.db
            .from('loyalty_point_transactions')
            .insert({
              owner_id: salonId,
              client_id: wallet.id,
              date: today,
              // Zero points: this row is a record of a claim, not a reward.
              points_change: 0,
              description: qrLedgerDescription({
                amount,
                reference,
                state: estimated > 0 ? undefined : QR_STATE_BELOW_MINIMUM,
              }),
              type: QR_PAYMENT_TYPE,
            })
            .select()
            .single(),
        { label: 'qr: transaction insert', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (txInsert.error || !txInsert.data) {
        console.error(`[Customer] (${requestId}) QR transaction failed:`, txInsert.error);
        return void fail(res, requestId, txInsert.error, 'Your payment could not be recorded. Please try again at the desk.');
      }

      const salons = await loadSalonRowsByIds(deps, [salonId], deadlineAt);
      const salonName = salons.get(salonId)?.salon_name || '';
      ok(res, deps, requestId, {
        payment: toQrPayment(txInsert.data, salonName),
        // The wallet is returned unread on purpose: nothing about it changed.
        wallet: toRewardWallet(wallet, { salonName, currency: salons.get(salonId)?.currency, config, programEnabled: !programOff }),
        transactions: [],
        estimatedPoints: estimated,
        gatewayVerifiable: resolveGateway(deps).client !== null,
      }, {
        notice: programOff
          ? 'Recorded. This salon has paused its rewards program, so this payment will not earn points.'
          : estimated > 0
            ? `Recorded. ${estimated} point${estimated === 1 ? '' : 's'} will be added when the payment is verified — this app cannot add them itself.`
            : `Recorded. Payments below ₹${QR_MIN_QUALIFYING_RUPEES} do not earn points at this salon.`,
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) QR confirm threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your payment could not be recorded.' });
    }
  };
}

/**
 * POST /api/customer/me/qr-payments/verify
 *
 * The only path in this app that turns a QR payment into points. The customer
 * supplies nothing but the id of their own entry and the gateway payment id; the
 * SERVER decides the amount by asking Razorpay what was captured, and only then
 * writes the ledger row and the wallet balance.
 *
 * Rules that make this safe:
 *  • the entry must belong to a wallet that resolves to the caller's own
 *    email/phone — ids alone never grant access;
 *  • the gateway must report the payment as captured;
 *  • points come from the GATEWAY amount, not the claimed amount, so an inflated
 *    claim simply earns less;
 *  • if the wallet credit fails, the ledger row goes back to zero so points
 *    never exist without the transaction behind them;
 *  • a second call on a credited row is a no-op.
 */
export function createQrVerifyHandler(deps: CustomerRoutesDeps) {
  return async function qrVerify(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custqrv');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      if (deps.isMock) {
        return void answer(res, 503, {
          success: false,
          code: 'supabase_not_configured',
          requestId,
          retryable: true,
          error: 'Nothing can be verified while the database is not configured.',
        });
      }
      const paymentRowId = String(req.body?.paymentId ?? req.body?.id ?? '').trim();
      const gatewayPaymentId = String(req.body?.razorpay_payment_id ?? req.body?.gatewayPaymentId ?? '').trim();
      if (!paymentRowId || !gatewayPaymentId) {
        return void answer(res, 400, {
          success: false,
          code: 'payment_reference_required',
          requestId,
          error: 'Verification needs the payment id from the gateway receipt.',
        });
      }

      const wallets = await loadCustomerWallets(deps, user, deadlineAt);
      if (!wallets.rows.length) {
        return void answer(res, 422, { success: false, code: 'no_wallet_at_salon', requestId, error: 'You have no rewards wallet to credit yet.' });
      }
      const walletIds = new Set(wallets.rows.map((row: any) => String(row.id)));

      const found = await runDb(
        () => deps.db.from('loyalty_point_transactions').select('*').eq('id', paymentRowId).maybeSingle(),
        { label: 'qr: load entry', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      const row = found.data;
      if (!row || found.error || !walletIds.has(String(row.client_id))) {
        // Same shape as "not there": an id that belongs to someone else must not
        // be distinguishable from a wrong id.
        return void answer(res, 404, { success: false, code: 'not_found', requestId, error: 'That payment entry could not be found.' });
      }
      if (Number(row.points_change ?? 0) > 0) {
        const salons = await loadSalonRowsByIds(deps, [String(row.owner_id)], deadlineAt);
        ok(res, deps, requestId, { payment: toQrPayment(row, salons.get(String(row.owner_id))?.salon_name || ''), alreadyVerified: true }, {
          notice: 'This payment was already verified and credited once — nothing was added twice.',
        });
        return;
      }

      const claimed = parseQrDescription(String(row.description || ''));
      const { client: gateway, reason: gatewayReason } = resolveGateway(deps);
      if (!gateway) {
        return void answer(res, 409, {
          success: false,
          code: 'payments_disabled',
          requestId,
          retryable: false,
          error: `${gatewayReason} Your payment stays recorded, and its points stay pending until then.`,
        });
      }

      let payment: RazorpayPayment | null = null;
      try {
        payment = await gateway.fetchPayment(gatewayPaymentId, deadlineAt);
      } catch (err: any) {
        const code = err?.code === 'razorpay_timeout' ? 'db_timeout' : 'razorpay_unreachable';
        return void answer(res, 503, {
          success: false,
          code,
          requestId,
          retryable: true,
          error: 'The payment gateway could not be reached, so nothing was credited. Try again in a moment.',
        });
      }
      if (!payment) {
        return void answer(res, 409, {
          success: false,
          code: 'payment_unverified',
          requestId,
          error: 'The gateway has no such payment. Nothing was credited — check the payment id on your receipt.',
        });
      }
      if (!payment.captured) {
        return void answer(res, 409, {
          success: false,
          code: 'payment_unverified',
          requestId,
          error: `That payment is "${payment.status || 'not captured'}" at the gateway, so no reward can be issued for it yet.`,
        });
      }
      // The gateway's amount is the truth. A claim of ₹5,000 against a ₹750
      // payment earns ₹750's worth of points, and a claim BELOW what was paid
      // is refused rather than silently enlarged.
      const verifiedAmount = payment.amountPaidRupees || payment.amountRupees;
      if (claimed.amount > 0 && verifiedAmount + 1 < claimed.amount) {
        return void answer(res, 409, {
          success: false,
          code: 'payment_amount_mismatch',
          requestId,
          error: `You recorded ₹${claimed.amount} but the gateway shows ₹${verifiedAmount}. Nothing was credited — record the payment again with the real amount.`,
        });
      }

      const configResult = await runDb(() => deps.db.from('loyalty_config').select('*').eq('owner_id', row.owner_id).maybeSingle(), {
        label: 'qr: loyalty config (verify)',
        timeoutMs: LOOKUP_DB_TIMEOUT_MS,
        deadlineAt,
      });
      const config = configResult.data || {};
      if (config.program_enabled === false) {
        return void answer(res, 422, {
          success: false,
          code: 'program_disabled',
          requestId,
          error: "This salon's rewards program is paused, so this payment cannot earn points right now. It stays recorded.",
        });
      }
      const perHundred = Math.max(0, Number(config.points_per_hundred_spent ?? 10));
      const points = qrPointsForAmount(verifiedAmount, perHundred);
      if (points <= 0) {
        // Below the qualifying floor: the payment is real and stays on the
        // ledger, marked, with no points. Crediting ₹40 worth of points would be
        // the salon's rule being silently ignored by its own app.
        const marked = await runDb(
          () =>
            deps.db
              .from('loyalty_point_transactions')
              .update({
                description: qrLedgerDescription({
                  amount: verifiedAmount,
                  reference: claimed.reference,
                  gatewayPaymentId: payment.id,
                  state: QR_STATE_BELOW_MINIMUM,
                }),
              })
              .eq('id', row.id),
          { label: 'qr: mark below minimum', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
        );
        if (marked.error) console.error(`[Customer] (${requestId}) could not mark the entry below-minimum:`, marked.error);
        return void answer(res, 422, {
          success: false,
          code: 'below_minimum',
          requestId,
          error: `A verified payment of ₹${verifiedAmount} is below the ₹${QR_MIN_QUALIFYING_RUPEES} minimum for earning points. It is recorded; it does not earn.`,
        });
      }

      const today = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10);
      const credited = await runDb(
        () =>
          deps.db
            .from('loyalty_point_transactions')
            .update({
              points_change: points,
              description: qrLedgerDescription({ amount: verifiedAmount, reference: claimed.reference, gatewayPaymentId: payment.id }),
            })
            .eq('id', row.id)
            .eq('points_change', 0)
            .select()
            .maybeSingle(),
        { label: 'qr: credit ledger row', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (credited.error || !credited.data) {
        if (credited.error) console.error(`[Customer] (${requestId}) QR ledger update failed:`, credited.error);
        return void fail(
          res,
          requestId,
          credited.error || { message: 'The entry changed under us.' },
          'The payment was verified but the points could not be written. Nothing was credited — please try again.'
        );
      }

      const wallet = wallets.rows.find((entry: any) => String(entry.id) === String(row.client_id));
      const balanceUpdate = await runDb(
        () =>
          deps.db
            .from('clients')
            .update({
              points: Number(wallet?.points ?? 0) + points,
              lifetime_points: Number(wallet?.lifetime_points ?? wallet?.points ?? 0) + points,
              total_spent: Number(wallet?.total_spent ?? 0) + verifiedAmount,
              last_visit: today,
              updated_at: new Date((deps.now ?? Date.now)()).toISOString(),
            })
            .eq('id', row.client_id)
            .select()
            .single(),
        { label: 'qr: wallet credit', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (balanceUpdate.error || !balanceUpdate.data) {
        // Roll the ledger row back to its uncredited state: a pending payment is
        // a truth, a credited payment with no points behind it is not.
        console.error(`[Customer] (${requestId}) QR balance failed — reverting ledger row:`, balanceUpdate.error);
        const rollback = await runDb(
          () =>
            deps.db
              .from('loyalty_point_transactions')
              .update({
                points_change: 0,
                description: qrLedgerDescription({ amount: verifiedAmount, reference: claimed.reference }),
              })
              .eq('id', row.id),
          { label: 'qr: ledger rollback', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
        );
        if (rollback.error) {
          console.error(`[Customer] (${requestId}) QR ROLLBACK FAILED — entry ${row.id} shows points with no balance:`, rollback.error);
        }
        return void fail(res, requestId, balanceUpdate.error, 'Your points could not be credited. The payment stays recorded as awaiting confirmation.');
      }

      const salons = await loadSalonRowsByIds(deps, [String(row.owner_id)], deadlineAt);
      const salonName = salons.get(String(row.owner_id))?.salon_name || '';
      const transactions = await loadTransactionsForWallets(deps, wallets.rows, [QR_PAYMENT_TYPE], deadlineAt);
      ok(res, deps, requestId, {
        payment: toQrPayment(credited.data, salonName),
        wallet: toRewardWallet(balanceUpdate.data, { salonName, currency: salons.get(String(row.owner_id))?.currency, config }),
        transactions: transactions.map((entry: any) => toRewardTransaction(entry, salonName)),
        verifiedAmount,
        gatewayPaymentId: payment.id,
      }, { notice: `Verified against the gateway: ${points} point${points === 1 ? '' : 's'} credited for ₹${verifiedAmount}.` });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) QR verify threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'This payment could not be verified.' });
    }
  };
}

export function createMembershipsHandler(deps: CustomerRoutesDeps) {
  return async function memberships(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custmem');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const wallets = await loadCustomerWallets(deps, user, deadlineAt);
      if (!wallets.rows.length) return void ok(res, deps, requestId, []);
      const ownerIds = [...new Set(wallets.rows.map((row: any) => String(row.owner_id)))];
      const [salons, configs] = await Promise.all([loadSalonRowsByIds(deps, ownerIds, deadlineAt), loadLoyaltyConfigs(deps, ownerIds, deadlineAt)]);
      ok(
        res,
        deps,
        requestId,
        wallets.rows.map((row: any) => {
          const config = configs.get(String(row.owner_id));
          return toMembership(row, {
            salonName: salons.get(String(row.owner_id))?.salon_name,
            config,
            // `active` is the salon's switch, not a status this app tracks:
            // there is no membership state column, only the program being on.
            programEnabled: config?.program_enabled !== false,
          });
        })
      );
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your membership could not be loaded.' });
    }
  };
}

/**
 * A shareable link must survive leaving the app, so it is absolute: `?ref=NX-…`
 * on its own is only useful inside this tab. The host comes from the request
 * (which is what knows the tenant subdomain and the deployed domain), with the
 * `/app` prefix the Customer App is mounted on.
 */
function referralLink(req: any, code: string): string {
  if (!code) return '';
  const query = `?ref=${encodeURIComponent(code)}`;
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req?.secure ? 'https' : 'http');
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  return host ? `${proto}://${host}/app${query}` : `/app${query}`;
}

export function createReferralsHandler(deps: CustomerRoutesDeps) {
  return async function referrals(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custref');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const code = referralCodeFor(user.id);
      if (!code) return void ok(res, deps, requestId, { code: '', link: '', items: [] });
      if (deps.isMock) return void ok(res, deps, requestId, { code, link: referralLink(req, code), items: [] }, notConnectedNotice(deps));

      const [bookingsResult, wallets] = await Promise.all([
        runDb(
          () =>
            deps.db
              .from('bookings')
              .select('id, owner_id, customer_name, service_name, booking_date, status, metadata')
              .filter('metadata->>referral_code', 'eq', code)
              .limit(200),
          { label: 'referral bookings', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        ),
        loadCustomerWallets(deps, user, deadlineAt),
      ]);
      if (bookingsResult.error) {
        // The code is derived from the token, so it is shown even when the
        // history read fails — the customer can still share it.
        console.warn(`[Customer] (${requestId}) Referral history failed (code still shown):`, bookingsResult.error.message || bookingsResult.error);
      }
      const rows = Array.isArray(bookingsResult.data) ? bookingsResult.data : [];
      const salons = await loadSalonMap(deps, rows, deadlineAt);
      const transactions = wallets.rows.length ? await loadTransactionsForWallets(deps, wallets.rows, ['bonus'], deadlineAt) : [];
      ok(res, deps, requestId, {
        code,
        link: referralLink(req, code),
        items: deriveReferrals({
          code,
          bookings: rows.map((row: any) => ({ row, salonName: salons.get(String(row.owner_id))?.salon_name || '' })),
          transactions,
        }),
      });
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your referrals could not be loaded.' });
    }
  };
}

export function createOfferListHandler(deps: CustomerRoutesDeps) {
  return async function offers(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custoffers');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const salonFilter = String(req.query?.salon_id ?? '').trim();
      if (deps.isMock) return void ok(res, deps, requestId, [], notConnectedNotice(deps));

      let builder = deps.db.from('loyalty_rewards').select('*').eq('is_active', true).order('sort_order').limit(200);
      if (salonFilter && isUuidLike(salonFilter)) builder = builder.eq('owner_id', salonFilter);
      const result = await runDb(() => builder, { label: 'offers', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt });
      if (result.error) return void fail(res, requestId, result.error, 'Offers could not be loaded right now.');
      const rows = Array.isArray(result.data) ? result.data : [];
      const salons = await loadSalonRowsByIds(deps, [...new Set(rows.map((row: any) => String(row.owner_id)))], deadlineAt);

      // Redeemability needs the customer's own balance, so a signed-in caller
      // gets a real "you have enough points"; a guest sees the price and no
      // false affordance. Auth is optional here — a catalogue read is public.
      const walletBySalon = new Map<string, number>();
      const redeemedByOffer = new Map<string, number>();
      const auth = await deps.authenticateUser(req, deadlineAt).catch(() => ({ ok: false } as any));
      if (auth.ok) {
        const wallets = await loadCustomerWallets(deps, auth.user, deadlineAt);
        for (const row of wallets.rows) walletBySalon.set(String(row.owner_id), Number(row.points ?? 0));
        if (wallets.rows.length) {
          const redemptions = await runDb(
            () =>
              deps.db
                .from('loyalty_redeemed_rewards')
                .select('id, reward_id, owner_id')
                .in('client_id', wallets.rows.map((row: any) => String(row.id)))
                .limit(1000),
            { label: 'offer redemption counts', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
          );
          for (const row of Array.isArray(redemptions.data) ? redemptions.data : []) {
            const key = String(row.reward_id);
            redeemedByOffer.set(key, (redeemedByOffer.get(key) || 0) + 1);
          }
        }
      }

      ok(
        res,
        deps,
        requestId,
        rows.map((row: any) =>
          toOffer(row, {
            salonName: salons.get(String(row.owner_id))?.salon_name || '',
            walletPoints: walletBySalon.get(String(row.owner_id)),
            redeemedCount: redeemedByOffer.get(String(row.id)),
          })
        )
      );
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Offers could not be loaded right now.' });
    }
  };
}

/**
 * POST /api/customer/offers/redeem — points out, coupon in, in that order.
 *
 * Three rows are written: the redemption, the negative point transaction, the
 * wallet balance. The last two are undone if any one of them fails, so a coupon
 * is never issued for points the customer still holds.
 */
export function createOfferRedeemHandler(deps: CustomerRoutesDeps) {
  return async function redeem(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custredeem');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      const offerId = String(req.body?.offerId ?? '').trim();
      const salonId = String(req.body?.salonId ?? '').trim();
      if (!offerId || !isUuidLike(offerId)) {
        return void answer(res, 400, { success: false, code: 'invalid_offer', requestId, error: 'That offer is not valid.' });
      }
      if (deps.isMock) {
        return void answer(res, 503, {
          success: false,
          code: 'supabase_not_configured',
          requestId,
          retryable: true,
          error: 'Redeeming rewards needs the connected Supabase database. Nothing was changed.',
        });
      }

      const offerResult = await runDb(() => deps.db.from('loyalty_rewards').select('*').eq('id', offerId).maybeSingle(), {
        label: 'redeem: offer',
        timeoutMs: DEFAULT_DB_TIMEOUT_MS,
        deadlineAt,
      });
      const offer = offerResult.data;
      if (offerResult.error) return void fail(res, requestId, offerResult.error, 'That offer could not be checked.');
      if (!offer || offer.is_active === false) {
        return void answer(res, 410, { success: false, code: 'offer_inactive', requestId, error: 'This offer is no longer available at that salon.' });
      }
      if (salonId && String(offer.owner_id) !== salonId) {
        return void answer(res, 422, { success: false, code: 'offer_saloon_mismatch', requestId, error: 'That offer belongs to a different salon.' });
      }

      const wallets = await loadCustomerWallets(deps, user, deadlineAt);
      const wallet = wallets.rows.find((row: any) => String(row.owner_id) === String(offer.owner_id));
      if (!wallet) {
        return void answer(res, 422, {
          success: false,
          code: 'no_wallet_at_salon',
          requestId,
          error: 'You need a rewards wallet at this salon before you can redeem one of its offers.',
        });
      }
      const required = Number(offer.required_points ?? 0);
      const balance = Number(wallet.points ?? 0);
      if (balance < required) {
        return void answer(res, 402, {
          success: false,
          code: 'insufficient_points',
          requestId,
          error: `You need ${required - balance} more points to redeem ${offer.title}.`,
        });
      }

      const now = new Date((deps.now ?? Date.now)());
      const prefix = String(offer.coupon_code_prefix || 'NEXORA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'NEXORA';
      const coupon = `${prefix}-${String(now.getTime()).slice(-6)}`;
      const type = String(offer.reward_type || 'percentage_discount');
      const value = Number(offer.discount_value ?? 0);
      const summary =
        type === 'percentage_discount'
          ? `${value}% off${offer.applicable_category ? ` ${offer.applicable_category}` : ''}`
          : type === 'flat_discount'
            ? `₹${value} off`
            : `Free ${String(offer.title || '').replace(/^free\s+/i, '')}`;

      const redemptionInsert = await runDb(
        () =>
          deps.db
            .from('loyalty_redeemed_rewards')
            .insert({
              owner_id: offer.owner_id,
              client_id: wallet.id,
              reward_id: offer.id,
              reward_title: offer.title,
              discount_summary: summary,
              points_spent: required,
              redeemed_at: now.toISOString().slice(0, 10),
              coupon_code: coupon,
              status: 'active',
            })
            .select()
            .single(),
        { label: 'redeem: create coupon', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (redemptionInsert.error || !redemptionInsert.data) {
        console.error(`[Customer] (${requestId}) Redemption insert failed:`, redemptionInsert.error);
        return void fail(res, requestId, redemptionInsert.error, 'Your reward could not be redeemed. Your points are unchanged.');
      }

      const txInsert = await runDb(
        () =>
          deps.db
            .from('loyalty_point_transactions')
            .insert({
              owner_id: offer.owner_id,
              client_id: wallet.id,
              date: now.toISOString().slice(0, 10),
              description: `Redeemed ${offer.title} (${coupon})`.slice(0, 200),
              points_change: -required,
              type: 'redeemed',
            })
            .select()
            .single(),
        { label: 'redeem: debit points', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      const balanceUpdate = txInsert.error
        ? { error: txInsert.error, data: null as any }
        : await runDb(
            () =>
              deps.db
                .from('clients')
                .update({ points: balance - required, updated_at: now.toISOString() })
                .eq('id', wallet.id)
                .select()
                .single(),
            { label: 'redeem: wallet balance', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
          );

      if (balanceUpdate.error || !balanceUpdate.data) {
        console.error(`[Customer] (${requestId}) Redemption balance failed — rolling back:`, balanceUpdate.error);
        const undone: Promise<any>[] = [
          runDb(() => deps.db.from('loyalty_redeemed_rewards').delete().eq('id', redemptionInsert.data.id), {
            label: 'redeem: rollback coupon',
            timeoutMs: DEFAULT_DB_TIMEOUT_MS,
            deadlineAt,
            retry: false,
          }),
        ];
        if (txInsert.data?.id) {
          undone.push(
            runDb(() => deps.db.from('loyalty_point_transactions').delete().eq('id', txInsert.data.id), {
              label: 'redeem: rollback transaction',
              timeoutMs: DEFAULT_DB_TIMEOUT_MS,
              deadlineAt,
              retry: false,
            })
          );
        }
        const results = await Promise.all(undone);
        const rollbackFailed = results.some((row: any) => row?.error);
        return void answer(res, 502, {
          success: false,
          code: rollbackFailed ? 'redeem_rollback_failed' : 'redeem_failed',
          requestId,
          retryable: true,
          error: rollbackFailed
            ? 'Your redemption could not be completed and needs a manual check by the salon. Your points may not have changed.'
            : 'Your redemption could not be completed, so it was cancelled. Your points are unchanged.',
        });
      }

      const salons = await loadSalonRowsByIds(deps, [String(offer.owner_id)], deadlineAt);
      const salonName = salons.get(String(offer.owner_id))?.salon_name || '';
      await bestEffortNotification(
        deps,
        { owner_id: offer.owner_id },
        'Reward redeemed',
        `${wallet.name || 'A member'} redeemed "${offer.title}" at ${salonName || 'your salon'} — coupon ${coupon}.`,
        deadlineAt
      );

      ok(res, deps, requestId, {
        redemption: toOfferRedemption(redemptionInsert.data, salonName),
        wallet: toRewardWallet(balanceUpdate.data, { salonName, currency: salons.get(String(offer.owner_id))?.currency }),
        transaction: txInsert.data ? toRewardTransaction(txInsert.data, salonName) : null,
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Redeem threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your reward could not be redeemed.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export function createMyNotificationsHandler(deps: CustomerRoutesDeps) {
  return async function notifications(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custntf');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      if (!user.email) {
        return void ok(res, deps, requestId, [], { notice: 'Notifications are addressed to your email, which is missing from your account.' });
      }
      if (deps.isMock) {
        const rows = deps
          .getMockNotifications()
          .filter((row: any) => String(row.user_email).toLowerCase() === String(user.email).toLowerCase())
          .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
        return void ok(res, deps, requestId, rows.map(toCustomerNotification));
      }
      const { data, error } = await runDb(
        () =>
          deps.db
            .from('in_app_notifications')
            .select('*')
            .eq('user_email', user.email)
            .order('created_at', { ascending: false })
            .limit(100),
        { label: 'customer notifications', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) return void fail(res, requestId, error, 'Your notifications could not be loaded.');
      ok(res, deps, requestId, (Array.isArray(data) ? data : []).map(toCustomerNotification));
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your notifications could not be loaded.' });
    }
  };
}

export function createMarkReadHandler(deps: CustomerRoutesDeps) {
  return async function markRead(req: any, res: any): Promise<void> {
    const requestId = newRequestId('custntfr');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const user = await requireAuth(deps, res, requestId, deadlineAt);
      if (!user) return;
      if (!user.email) {
        return void ok(res, deps, requestId, { updated: 0 }, { notice: 'No email on this account, so notifications cannot be matched.' });
      }
      if (deps.isMock) {
        let updated = 0;
        for (const row of deps.getMockNotifications()) {
          if (String(row.user_email).toLowerCase() === String(user.email).toLowerCase() && !row.is_read) {
            row.is_read = true;
            updated += 1;
          }
        }
        return void ok(res, deps, requestId, { updated });
      }
      const { data, error } = await runDb(
        () =>
          deps.db
            .from('in_app_notifications')
            .update({ is_read: true })
            .eq('user_email', user.email)
            .eq('is_read', false)
            .select('id'),
        { label: 'mark notifications read', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (error) return void fail(res, requestId, error, 'Your notifications could not be marked as read.');
      ok(res, deps, requestId, { updated: Array.isArray(data) ? data.length : 0 });
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your notifications could not be marked as read.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Registration — called identically by server.ts and api/index.ts
// ---------------------------------------------------------------------------
export function registerCustomerRoutes(
  app: any,
  deps: CustomerRoutesDeps,
  wrap: (handler: any) => any = (handler) => handler,
  timeout: (ms: number) => any = () => (_req: any, _res: any, next: any) => next()
): void {
  const routes: Array<[string, 'get' | 'post', any]> = [
    ['/api/customer/connection', 'get', createConnectionHandler(deps)],
    ['/api/customer/salons', 'get', createSalonListHandler(deps)],
    ['/api/customer/salons/:idOrSubdomain', 'get', createSalonDetailHandler(deps)],
    ['/api/customer/salons/:idOrSubdomain/services', 'get', createSalonServicesHandler(deps)],
    ['/api/customer/salons/:idOrSubdomain/staff', 'get', createSalonStaffHandler(deps)],
    ['/api/customer/salons/:idOrSubdomain/reviews', 'get', createSalonReviewsHandler(deps)],
    ['/api/customer/salons/:idOrSubdomain/slots', 'get', createSlotsHandler(deps)],
    ['/api/customer/offers', 'get', createOfferListHandler(deps)],
    ['/api/customer/offers/redeem', 'post', createOfferRedeemHandler(deps)],
    ['/api/customer/search-suggestions', 'get', createSearchSuggestionsHandler(deps)],
    ['/api/customer/geocode', 'get', createGeocodeHandler(deps)],
    ['/api/customer/me/profile', 'get', createProfileReadHandler(deps)],
    ['/api/customer/me/profile', 'post', createProfileWriteHandler(deps)],
    ['/api/customer/me/location', 'post', createLocationWriteHandler(deps)],
    ['/api/customer/me/bookings', 'get', createMyBookingsHandler(deps)],
    ['/api/customer/me/bookings/:id', 'get', createMyBookingDetailHandler(deps)],
    ['/api/customer/me/bookings/cancel', 'post', createCancelHandler(deps)],
    ['/api/customer/me/bookings/reschedule', 'post', createRescheduleHandler(deps)],
    ['/api/customer/payments/config', 'get', createPaymentConfigHandler(deps)],
    ['/api/customer/payments/order', 'post', createPaymentOrderHandler(deps)],
    ['/api/customer/bookings/create', 'post', createBookingCreateHandler(deps)],
    ['/api/customer/me/bookings/:id/advance', 'post', createBookingAdvanceHandler(deps)],
    ['/api/customer/me/reviews', 'get', createReviewListHandler(deps)],
    ['/api/customer/me/reviews', 'post', createReviewWriteHandler(deps)],
    ['/api/customer/me/favourites', 'get', createFavouritesHandler(deps)],
    ['/api/customer/me/rewards', 'get', createRewardsHandler(deps)],
    ['/api/customer/me/qr-payments', 'get', createQrPaymentsHandler(deps)],
    ['/api/customer/me/qr-payments/confirm', 'post', createQrConfirmHandler(deps)],
    ['/api/customer/me/qr-payments/verify', 'post', createQrVerifyHandler(deps)],
    ['/api/customer/me/memberships', 'get', createMembershipsHandler(deps)],
    ['/api/customer/me/referrals', 'get', createReferralsHandler(deps)],
    ['/api/customer/me/notifications', 'get', createMyNotificationsHandler(deps)],
    ['/api/customer/me/notifications/read', 'post', createMarkReadHandler(deps)],
  ];

  for (const [path, method, handler] of routes) {
    // Method-first matching means `/me/bookings/:id` (GET) can never shadow
    // `/me/bookings/cancel` (POST); only same-method literal-vs-param overlaps
    // need ordering, and none of these routes have one.
    app[method](path, timeout(12000), wrap(handler));
  }
}
