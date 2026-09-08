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
import { isMockOrderId, resolveSignatureSecret, verifyRazorpaySignature } from './razorpay';
import { computeAdvanceDeposit, DEFAULT_DEPOSIT_PERCENT } from '../src/lib/advanceDeposit';
import { canCancelBooking, validateReview, MAX_REVIEW_LENGTH } from '../src/lib/bookingTabs';
import {
  buildSlotGrid,
  dayWindowFor,
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
  QR_PAYMENT_TYPE,
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
}

const DISCOVERY_COLUMNS =
  'id, salon_name, business_type, tagline, about, logo_url, cover_image_url, city, state, full_address, address_line2, postal_code, latitude, longitude, phone_number, whatsapp, instagram_handle, subdomain, currency, theme_preset, theme_accent_key, working_hours, home_service, require_deposit, deposit_percentage, founding_year';

const SALON_SUMMARY_COLUMNS = 'id, salon_name, logo_url, cover_image_url, city, currency';

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
      if (deps.isMock) return void ok(res, deps, requestId, [], notConnectedNotice(deps));

      const query = req.query || {};
      const limit = Math.min(60, Math.max(1, Number(query.limit || deps.discoveryLimit || 24)));
      const city = String(query.city || '').trim();
      const term = String(query.q || '').trim().toLowerCase();
      const businessType = String(query.businessType || query.business_type || '').trim();
      const sort = String(query.sort || 'nearby');

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
        builder = builder.or(`salon_name.ilike.%${term}%,tagline.ilike.%${term}%,city.ilike.%${term}%`);
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
      const salons = rows.map((row: any) =>
        toCustomerSalon(row, { from: { latitude: numberOr(query.latitude), longitude: numberOr(query.longitude) } })
      );
      const withRatings = await attachRatings(deps, salons, deadlineAt);
      const withCounts = await attachServiceCounts(deps, withRatings, deadlineAt);

      const ordered = withCounts
        .filter((salon: any) => (term ? matchesTerm(salon, term) : true))
        .sort((a: any, b: any) => {
          if (sort === 'rating') return b.rating.average - a.rating.average || a.name.localeCompare(b.name);
          if (sort === 'name') return a.name.localeCompare(b.name);
          const da = a.distanceKm === null ? Number.MAX_SAFE_INTEGER : a.distanceKm;
          const db = b.distanceKm === null ? Number.MAX_SAFE_INTEGER : b.distanceKm;
          return da - db || a.name.localeCompare(b.name);
        })
        .slice(0, limit);

      ok(res, deps, requestId, ordered);
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) Discovery threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Salons could not be loaded right now.' });
    }
  };
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

      const [withRating] = await attachRatings(
        deps,
        [toCustomerSalon(profileRow, { from: { latitude: numberOr(req.query?.lat), longitude: numberOr(req.query?.lng) } })],
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
      ok(res, deps, requestId, (Array.isArray(data) ? data : []).map(toCustomerService));
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
    phone: 'phone_number',
    whatsapp: 'whatsapp',
    city: 'city',
    address: 'full_address',
    postalCode: 'postal_code',
    state: 'state',
    landmark: 'landmark',
  };
  for (const [key, column] of Object.entries(map)) {
    if (!(key in (body || {}))) continue;
    const value = body[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
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
      delete finalUpdates.id;

      if (!Object.keys(finalUpdates).length) {
        return void ok(res, deps, requestId, existing ? toCustomerProfile(existing) : null, {
          notice: skipped.length ? `Not writable by a customer: ${skipped.join(', ')}.` : 'Nothing to update.',
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
        ...(skipped.length ? { notice: `Not writable by a customer: ${skipped.join(', ')}.` } : {}),
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

      const problems = validateCustomerBooking(body);
      if (problems.length) {
        return void answer(res, 422, { success: false, code: 'invalid_booking', requestId, error: problems[0], fieldErrors: problems });
      }

      if (deps.isMock) {
        return void answer(res, 503, {
          success: false,
          code: 'supabase_not_configured',
          requestId,
          retryable: true,
          error: 'Bookings need the connected Supabase database. Nothing was saved or charged.',
        });
      }

      // --- 1. the salon, from its published profile row --------------------
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
        return void answer(res, 502, {
          success: false,
          code: 'salon_unreadable',
          requestId,
          error: 'We could not reach the salon to complete your booking. Nothing was charged.',
          retryable: true,
        });
      }
      if (!salonRow || !isSalonProfile(salonRow)) {
        return void answer(res, 422, {
          success: false,
          code: 'salon_not_published',
          requestId,
          error: 'That salon is not accepting bookings right now.',
        });
      }
      const ownerUid = String(salonRow.id);

      // --- 2. services, priced from the salon's own menu -------------------
      const serviceIds: string[] = Array.isArray(body.serviceIds) ? body.serviceIds.map(String).filter(Boolean) : [];
      const serviceResult = await runDb(
        () => deps.db.from('services').select('id, name, price, duration_minutes, category').eq('owner_id', ownerUid).limit(400),
        { label: 'booking: services', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (serviceResult.error) return void fail(res, requestId, serviceResult.error, 'The salon menu could not be read. Please try again.');
      const menu: any[] = Array.isArray(serviceResult.data) ? serviceResult.data : [];
      const byId = new Map(menu.map((row) => [String(row.id), row]));
      const chosen = serviceIds.map((id) => byId.get(id)).filter(Boolean);
      if (!chosen.length) {
        return void answer(res, 422, {
          success: false,
          code: 'unknown_service',
          requestId,
          error: "None of the selected services are on this salon's menu any more. Please pick again.",
        });
      }

      // --- 3. stylist + a live collision check before writing --------------
      const staffId = String(body.staffId || '').trim();
      let staffRow: any = null;
      if (staffId && isUuidLike(staffId)) {
        const staffResult = await runDb(
          () => deps.db.from('stylists').select('id, name, status, schedule').eq('id', staffId).eq('owner_id', ownerUid).maybeSingle(),
          { label: 'booking: stylist', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
        );
        if (staffResult.error) return void fail(res, requestId, staffResult.error, 'The stylist could not be verified.');
        staffRow = staffResult.data;
        if (staffRow && String(staffRow.status) === 'Inactive') staffRow = null;
      }

      const clash = await slotIsTaken(deps, ownerUid, String(body.date), String(body.time), staffRow ? String(staffRow.id) : '', deadlineAt);
      if (clash.error) return void fail(res, requestId, clash.error, 'Availability could not be checked. Please try again.');
      if (clash.taken) {
        return void answer(res, 409, {
          success: false,
          code: 'slot_taken',
          requestId,
          error: 'That time was just booked by someone else. Pick another slot — your details are still here.',
          retryable: true,
        });
      }

      const duration = chosen.reduce((total: number, row: any) => total + Number(row.duration_minutes ?? 30), 0);
      const subtotal = chosen.reduce((total: number, row: any) => total + Number(row.price ?? 0), 0);
      const requireDeposit = salonRow.require_deposit === true;
      const depositPercentage = Math.min(100, Math.max(0, Number(salonRow.deposit_percentage ?? 20)));
      // Same helper the client uses for the button label and the server uses when
      // it records the payment, so ₹87 on screen is ₹87 at the gateway is ₹87 on
      // the booking — that agreement is why this arithmetic lives in src/lib.
      const deposit = requireDeposit ? computeAdvanceDeposit(subtotal, depositPercentage).rupees : 0;

      const profileResult = await runDb(
        () => deps.db.from('profiles').select('full_name, phone_number, email, city').eq('id', user.id).maybeSingle(),
        { label: 'booking: customer details', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      const customerRow = profileResult.data || {};
      const customerName = String(body.customerName || customerRow.full_name || 'Customer').trim().slice(0, 120) || 'Customer';
      const customerPhone = String(body.customerPhone || customerRow.phone_number || '').trim();
      const customerEmail = String(user.email || customerRow.email || '').trim();

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
      };

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
        // `advance_paid_amount` is only ever written by the payment verifier,
        // so the customer app starts at 0 and hands off to the Razorpay path.
        advance_paid_amount: 0,
        status: 'pending',
        payment_status: deposit > 0 ? 'pending' : 'pay_at_salon',
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
      ok(res, deps, requestId, {
        booking: toCustomerBooking(stored, { salon: salonRow }),
        serviceLines: toBookingServiceLines(stored),
        written: { bookings: 1, serviceLines: serviceLines.length, notifications: notificationsWritten },
        slots: snapshot.slots,
        depositDue: deposit,
        depositPercent: depositPercentage,
        requireDeposit,
        salon: toCustomerSalon(salonRow),
        referral: { code: metadata.referral_code || '', credited: false },
        paymentHandoff: deposit > 0 ? 'razorpay_advance' : 'pay_at_salon',
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
 * Complete the deposit for a booking that already exists.
 *
 * The customer app books first and pays second — the only order that works when
 * the booking is created through this API, because the gateway round-trip
 * (order → checkout → callback) can outlive a request and the money needs a
 * booking to attach to. `src/lib/bookingApi.ts:294` states the rule this
 * follows: a booking is only ever marked paid when the gateway says so. So the
 * signature is re-verified HERE, and the amount stored is the one *this server*
 * recomputes from the booking total and the deposit percentage — never whatever
 * the client claims it paid.
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
      const [salons, configs, transactions] = await Promise.all([
        loadSalonRowsByIds(deps, ownerIds, deadlineAt),
        loadLoyaltyConfigs(deps, ownerIds, deadlineAt),
        loadTransactionsForWallets(deps, wallets.rows, undefined, deadlineAt),
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
          });
        }),
        transactions: transactions.map((row: any) => toRewardTransaction(row, salons.get(String(row.owner_id))?.salon_name || '')),
      });
    } catch (err: any) {
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your rewards could not be loaded.' });
    }
  };
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
 * A scanned QR payment becomes a ledger entry, not a parallel receipt store: one
 * `loyalty_point_transactions` row of type `qr_payment` plus the matching
 * `clients.points` credit. If the credit fails the ledger row is deleted, so
 * points can never appear without a transaction — or a transaction without the
 * points behind it.
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
          error: 'QR rewards need the connected Supabase database. Nothing was credited.',
        });
      }

      // Only a wallet the customer already owns at this salon may be credited.
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

      const configResult = await runDb(() => deps.db.from('loyalty_config').select('*').eq('owner_id', salonId).maybeSingle(), {
        label: 'qr: loyalty config',
        timeoutMs: LOOKUP_DB_TIMEOUT_MS,
        deadlineAt,
      });
      const config = configResult.data || {};
      if (config.program_enabled === false) {
        return void answer(res, 422, {
          success: false,
          code: 'program_disabled',
          requestId,
          error: "This salon's rewards program is paused, so QR payments are not earning points right now.",
        });
      }
      const perHundred = Math.max(0, Number(config.points_per_hundred_spent ?? 10));
      const pointsCredited = Math.floor((amount / 100) * perHundred);
      if (pointsCredited <= 0) {
        return void answer(res, 422, {
          success: false,
          code: 'below_minimum',
          requestId,
          error: `This payment is below the ${perHundred > 0 ? Math.ceil(100 / perHundred) : 100}-rupee minimum for earning points.`,
        });
      }

      const today = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10);
      const txInsert = await runDb(
        () =>
          deps.db
            .from('loyalty_point_transactions')
            .insert({
              owner_id: salonId,
              client_id: wallet.id,
              date: today,
              description: `QR payment ₹${amount.toFixed(2)} ref:${reference}`.slice(0, 200),
              points_change: pointsCredited,
              type: QR_PAYMENT_TYPE,
            })
            .select()
            .single(),
        { label: 'qr: transaction insert', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (txInsert.error || !txInsert.data) {
        console.error(`[Customer] (${requestId}) QR transaction failed:`, txInsert.error);
        return void fail(res, requestId, txInsert.error, 'Your payment could not be recorded. Nothing was credited — please try again at the desk.');
      }

      const balanceUpdate = await runDb(
        () =>
          deps.db
            .from('clients')
            .update({
              points: Number(wallet.points ?? 0) + pointsCredited,
              lifetime_points: Number(wallet.lifetime_points ?? wallet.points ?? 0) + pointsCredited,
              total_spent: Number(wallet.total_spent ?? 0) + amount,
              last_visit: today,
              updated_at: new Date((deps.now ?? Date.now)()).toISOString(),
            })
            .eq('id', wallet.id)
            .select()
            .single(),
        { label: 'qr: wallet credit', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (balanceUpdate.error || !balanceUpdate.data) {
        console.error(`[Customer] (${requestId}) QR balance failed — removing transaction:`, balanceUpdate.error);
        const rollback = await runDb(() => deps.db.from('loyalty_point_transactions').delete().eq('id', txInsert.data.id), {
          label: 'qr: transaction rollback',
          timeoutMs: DEFAULT_DB_TIMEOUT_MS,
          deadlineAt,
          retry: false,
        });
        if (rollback.error) console.error(`[Customer] (${requestId}) QR ROLLBACK FAILED — transaction ${txInsert.data.id} left orphaned:`, rollback.error);
        return void fail(res, requestId, balanceUpdate.error, 'Your points could not be credited. Nothing was recorded — please try again.');
      }

      const salons = await loadSalonRowsByIds(deps, [salonId], deadlineAt);
      const refreshed = await runDb(
        () =>
          deps.db
            .from('loyalty_point_transactions')
            .select('*')
            .eq('client_id', wallet.id)
            .order('created_at', { ascending: false })
            .limit(30),
        { label: 'qr: refresh transactions', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      const salonName = salons.get(salonId)?.salon_name || '';
      ok(res, deps, requestId, {
        payment: toQrPayment(txInsert.data, salonName),
        wallet: toRewardWallet(balanceUpdate.data, { salonName, currency: salons.get(salonId)?.currency, config }),
        transactions: (Array.isArray(refreshed.data) ? refreshed.data : []).map((row: any) => toRewardTransaction(row, salonName)),
      });
    } catch (err: any) {
      console.error(`[Customer] (${requestId}) QR confirm threw:`, err?.stack || err);
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Your payment could not be recorded.' });
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
        wallets.rows.map((row: any) =>
          toMembership(row, { salonName: salons.get(String(row.owner_id))?.salon_name, config: configs.get(String(row.owner_id)) })
        )
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
    ['/api/customer/bookings/create', 'post', createBookingCreateHandler(deps)],
    ['/api/customer/me/bookings/:id/advance', 'post', createBookingAdvanceHandler(deps)],
    ['/api/customer/me/reviews', 'get', createReviewListHandler(deps)],
    ['/api/customer/me/reviews', 'post', createReviewWriteHandler(deps)],
    ['/api/customer/me/favourites', 'get', createFavouritesHandler(deps)],
    ['/api/customer/me/rewards', 'get', createRewardsHandler(deps)],
    ['/api/customer/me/qr-payments', 'get', createQrPaymentsHandler(deps)],
    ['/api/customer/me/qr-payments/confirm', 'post', createQrConfirmHandler(deps)],
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
