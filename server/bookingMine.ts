// ============================================================================
// Customer-facing booking endpoints: "My Bookings".
//
//   GET  /api/bookings/mine          — the signed-in customer's own bookings
//   POST /api/bookings/mine/cancel   — cancel one of them, if policy allows
//   POST /api/bookings/mine/review   — rate a completed visit
//
// WHY THESE ARE SEPARATE FROM /api/bookings
// -----------------------------------------
// The existing `GET /api/bookings` is scoped to a salon OWNER (`?owner_id=` /
// `?subdomain=`) and returns every customer of that salon. It is not usable for
// a customer list, and it must not be widened to be: the obvious shortcut —
// accepting `?user_id=` — would let any caller read any account's bookings by
// guessing an id.
//
// So the identity here comes only from the verified bearer token. The customer
// id is never read from the query string or the request body, and the cancel
// and review handlers re-read the row and re-check `user_id` before writing, so
// a booking id from someone else's list is rejected even if it is guessed.
//
// The cancellation rule is imported from `src/lib/bookingTabs.ts` — the same
// function the UI uses to enable or disable the button — so the server can
// never disagree with what the page promised.
// ============================================================================

import type { BookingAuthResult } from './bookingAuth.js';
import { isUuidLike } from './bookingOps.js';
import { canCancelBooking, validateReview, MAX_REVIEW_LENGTH } from '../src/lib/bookingTabs.js';
import type { LoyaltyTerms } from '../src/lib/bookingDetail.js';
import { describeBookingStatus } from '../src/lib/bookingStatus.js';
import {
  runDb,
  newRequestId,
  DEFAULT_DB_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard.js';
import { safeDatabaseError, sendSafeError } from './safeError.js';

export interface BookingMineDeps {
  db: any;
  isMock: boolean;
  hasAdminClient?: boolean;
  getMockBookings: () => any[];
  setMockBookings?: (rows: any[]) => void;
  addMockNotifications: (rows: any[]) => void;
  resolveOwnerEmail: (ownerId: string | null | undefined, deadlineAt?: number) => Promise<string>;
  /** Verifies the caller's Supabase access token (mock mode uses `mock:<id>`). */
  authenticateUser: (req: any, deadlineAt?: number) => Promise<BookingAuthResult>;
  /** Injectable so tests do not depend on the wall clock. */
  now?: () => number;
}

const SALON_COLUMNS = 'id, salon_name, cover_image_url, logo_url, city, currency';

function answer(res: any, status: number, body: Record<string, any>): void {
  if (responseAlreadyEnded(res)) return;
  res.status(status).json(body);
}

/**
 * Answer with the auth gate's own status and code.
 *
 * The parameter is the whole `BookingAuthResult` rather than its failure arm:
 * this project compiles without `strictNullChecks`, so TypeScript cannot narrow
 * a discriminated union and a narrowed parameter type will not type-check at
 * the (correct) call sites that follow an `if (!auth.ok)` guard.
 */
function authFailure(res: any, requestId: string, auth: BookingAuthResult): void {
  const status = (auth as any).status === 503 ? 503 : 401;
  answer(res, status, {
    success: false,
    code: (auth as any).code ?? 'auth_required',
    requestId,
    error: (auth as any).error ?? 'Please sign in to see your bookings.',
    ...(status === 503 ? { retryable: true } : {}),
  });
}

function requireAdminClient(deps: BookingMineDeps, res: any, requestId: string): boolean {
  if (deps.isMock || deps.hasAdminClient !== false) return false;
  answer(res, 503, {
    success: false,
    code: 'supabase_not_configured',
    requestId,
    retryable: true,
    error: 'Your bookings are not connected to the database yet. Please try again later.',
  });
  return true;
}

/**
 * Does this row belong to the caller? Mock rows keep a non-UUID customer id in
 * `metadata` (see `sanitizeBookingRow`), so both places are checked.
 */
export function bookingBelongsTo(row: any, userId: string): boolean {
  if (!row || typeof row !== 'object' || !userId) return false;
  if (String(row.user_id ?? '') === userId) return true;
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return String(metadata.user_id ?? '') === userId;
}

/**
 * Resolve salon name / image / city for a set of bookings.
 *
 * Best-effort on purpose: `bookings` has no salon columns, so this is a
 * presentation join. If the profiles lookup fails the list must still render —
 * with a fallback salon name rather than as an error the customer cannot act on.
 */
async function loadSalonSummaries(
  deps: BookingMineDeps,
  rows: any[],
  deadlineAt?: number
): Promise<Map<string, { name: string; imageUrl: string; city: string; currency: string }>> {
  const out = new Map<string, { name: string; imageUrl: string; city: string; currency: string }>();
  const ownerIds = [
    ...new Set(rows.map((r) => String(r?.owner_id ?? '')).filter((id) => isUuidLike(id))),
  ];
  if (deps.isMock || ownerIds.length === 0) return out;

  const { data, error } = await runDb(
    () => deps.db.from('profiles').select(SALON_COLUMNS).in('id', ownerIds),
    { label: 'salon summaries for my bookings', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    console.warn('[MyBookings] Salon summary lookup failed (continuing without it):', error.message || error);
    return out;
  }
  for (const profile of Array.isArray(data) ? data : []) {
    const id = String(profile?.id ?? '');
    if (!id) continue;
    out.set(id, {
      name: String(profile?.salon_name ?? '').trim(),
      imageUrl: String(profile?.logo_url ?? profile?.cover_image_url ?? '').trim(),
      city: String(profile?.city ?? '').trim(),
      currency: String(profile?.currency ?? '').trim(),
    });
  }
  return out;
}

function attachSalons(rows: any[], salons: Map<string, any>): any[] {
  return rows.map((row) => ({
    ...row,
    salon: salons.get(String(row?.owner_id ?? '')) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// GET /api/bookings/mine
// ---------------------------------------------------------------------------
export function createMyBookingsListHandler(deps: BookingMineDeps) {
  return async function listMyBookings(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkmine');
    try {
      if (requireAdminClient(deps, res, requestId)) return;
      const deadlineAt = res.locals?.requestDeadlineAt;

      const auth = await deps.authenticateUser(req, deadlineAt);
      if (!auth.ok) {
        authFailure(res, requestId, auth);
        return;
      }
      const userId = auth.user.id;

      let rows: any[];
      if (deps.isMock) {
        rows = deps.getMockBookings().filter((row) => bookingBelongsTo(row, userId));
      } else {
        const { data, error } = await runDb(
          () =>
            deps.db
              .from('bookings')
              .select('*')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(200),
          { label: `my bookings (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (error) {
          console.error(`[MyBookings] (${requestId}) List failed:`, error.message || error);
          const safe = safeDatabaseError(error, 'Your bookings could not be loaded.');
          answer(res, safe.status, {
            success: false,
            code: safe.code,
            requestId,
            error: safe.message,
            ...(safe.retryable ? { retryable: true } : {}),
          });
          return;
        }
        rows = Array.isArray(data) ? data : [];
      }

      const salons = await loadSalonSummaries(deps, rows, deadlineAt);
      if (responseAlreadyEnded(res)) return;
      res.json({
        success: true,
        mode: deps.isMock ? 'mock' : 'live',
        requestId,
        data: attachSalons(rows, salons),
      });
    } catch (err: any) {
      console.error(`[MyBookings] (${requestId}) List threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Your bookings could not be loaded.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Shared read-one-row-and-check-ownership step for the write handlers
// ---------------------------------------------------------------------------
async function loadOwnedBooking(
  deps: BookingMineDeps,
  res: any,
  requestId: string,
  id: unknown,
  userId: string,
  deadlineAt?: number
): Promise<any | null> {
  if (!id || typeof id !== 'string' || !id.trim()) {
    answer(res, 400, { success: false, code: 'invalid_request', requestId, error: 'A booking id is required.' });
    return null;
  }

  if (deps.isMock) {
    const row = deps.getMockBookings().find((b) => b.id === id);
    if (!row) {
      answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });
      return null;
    }
    if (!bookingBelongsTo(row, userId)) {
      // Reported as not-found rather than forbidden: confirming that a guessed
      // id exists is exactly the information this must not give away.
      answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });
      return null;
    }
    return row;
  }

  if (!isUuidLike(id)) {
    answer(res, 400, { success: false, code: 'invalid_id', requestId, error: 'That booking reference is not valid.' });
    return null;
  }

  const { data, error } = await runDb(
    () => deps.db.from('bookings').select('*').eq('id', id).maybeSingle(),
    { label: `my booking read (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error) {
    const safe = safeDatabaseError(error, 'The booking could not be loaded.');
    answer(res, safe.status, {
      success: false,
      code: safe.code,
      requestId,
      error: safe.message,
      ...(safe.retryable ? { retryable: true } : {}),
    });
    return null;
  }
  if (!data || !bookingBelongsTo(data, userId)) {
    answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });
    return null;
  }
  return data;
}

async function notifyOwnerBestEffort(
  deps: BookingMineDeps,
  row: any,
  title: string,
  message: string,
  deadlineAt?: number
): Promise<void> {
  try {
    const ownerEmail = await deps.resolveOwnerEmail(row?.owner_id, deadlineAt);
    const notification = { user_email: ownerEmail, title, message, read: false };
    if (deps.isMock) {
      deps.addMockNotifications([notification]);
      return;
    }
    await runDb(() => deps.db.from('notifications').insert([notification]), {
      label: 'my booking notification',
      timeoutMs: LOOKUP_DB_TIMEOUT_MS,
      deadlineAt,
    });
  } catch (err: any) {
    // A notification failure must never undo the customer's action.
    console.warn('[MyBookings] Notification insert failed:', err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/bookings/mine/cancel
// ---------------------------------------------------------------------------
export function createCancelMyBookingHandler(deps: BookingMineDeps) {
  return async function cancelMyBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkcxl');
    try {
      if (requireAdminClient(deps, res, requestId)) return;
      const deadlineAt = res.locals?.requestDeadlineAt;

      const auth = await deps.authenticateUser(req, deadlineAt);
      if (!auth.ok) {
        authFailure(res, requestId, auth);
        return;
      }

      const existing = await loadOwnedBooking(deps, res, requestId, req.body?.id, auth.user.id, deadlineAt);
      if (!existing || responseAlreadyEnded(res)) return;

      // Same rule the UI uses to enable the button, so the server cannot
      // reject something the page offered.
      const decision = canCancelBooking({
        status: existing.status,
        date: existing.booking_date,
        time: existing.time_slot,
        nowMs: (deps.now ?? Date.now)(),
      });
      if (!decision.allowed) {
        answer(res, 409, {
          success: false,
          code: 'not_cancellable',
          requestId,
          status: existing.status,
          error: decision.reason,
        });
        return;
      }

      let updated: any;
      if (deps.isMock) {
        const rows = deps.getMockBookings();
        const idx = rows.findIndex((b) => b.id === existing.id);
        if (idx === -1) {
          answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });
          return;
        }
        updated = { ...rows[idx], status: 'cancelled' };
        rows[idx] = updated;
      } else {
        const { data, error } = await runDb(
          () => deps.db.from('bookings').update({ status: 'cancelled' }).eq('id', existing.id).select().single(),
          { label: `my booking cancel (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (error || !data) {
          console.error(`[MyBookings] (${requestId}) Cancel failed:`, error?.message || error);
          const safe = safeDatabaseError(error, 'The booking could not be cancelled.');
          answer(res, safe.status, {
            success: false,
            code: safe.code,
            requestId,
            error: safe.message,
            ...(safe.retryable ? { retryable: true } : {}),
          });
          return;
        }
        updated = data;
      }

      await notifyOwnerBestEffort(
        deps,
        updated,
        'Booking Cancelled by Customer',
        `${updated.customer_name || 'A customer'} cancelled their ${updated.service_name || 'appointment'} on ${updated.booking_date} at ${updated.time_slot}.`,
        deadlineAt
      );

      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, requestId, data: updated });
    } catch (err: any) {
      console.error(`[MyBookings] (${requestId}) Cancel threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'The booking could not be cancelled.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /api/bookings/mine/review
// ---------------------------------------------------------------------------
export function createReviewMyBookingHandler(deps: BookingMineDeps) {
  return async function reviewMyBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkrev');
    try {
      if (requireAdminClient(deps, res, requestId)) return;
      const deadlineAt = res.locals?.requestDeadlineAt;

      const auth = await deps.authenticateUser(req, deadlineAt);
      if (!auth.ok) {
        authFailure(res, requestId, auth);
        return;
      }

      const existing = await loadOwnedBooking(deps, res, requestId, req.body?.id, auth.user.id, deadlineAt);
      if (!existing || responseAlreadyEnded(res)) return;

      const validation = validateReview({
        status: existing.status,
        rating: req.body?.rating,
        text: req.body?.text,
      });
      if (!validation.ok) {
        answer(res, 422, { success: false, code: 'invalid_review', requestId, error: validation.error });
        return;
      }

      // Reviews ride along in the booking's `metadata` jsonb — there is no
      // reviews table, and inventing one for a star rating would be a bigger
      // migration than the feature needs.
      const prior = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
      const metadata = {
        ...prior,
        review_rating: validation.rating,
        review_text: validation.text.slice(0, MAX_REVIEW_LENGTH),
        reviewed_at: new Date((deps.now ?? Date.now)()).toISOString(),
        reviewed_by: auth.user.id,
      };

      let updated: any;
      if (deps.isMock) {
        const rows = deps.getMockBookings();
        const idx = rows.findIndex((b) => b.id === existing.id);
        if (idx === -1) {
          answer(res, 404, { success: false, code: 'not_found', requestId, error: 'We could not find that booking.' });
          return;
        }
        updated = { ...rows[idx], metadata };
        rows[idx] = updated;
      } else {
        const { data, error } = await runDb(
          () => deps.db.from('bookings').update({ metadata }).eq('id', existing.id).select().single(),
          { label: `my booking review (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (error || !data) {
          console.error(`[MyBookings] (${requestId}) Review failed:`, error?.message || error);
          const safe = safeDatabaseError(error, 'Your review could not be saved.');
          answer(res, safe.status, {
            success: false,
            code: safe.code,
            requestId,
            error: safe.message,
            ...(safe.retryable ? { retryable: true } : {}),
          });
          return;
        }
        updated = data;
      }

      await notifyOwnerBestEffort(
        deps,
        updated,
        `New ${validation.rating}-star review`,
        `${updated.customer_name || 'A customer'} rated their ${updated.service_name || 'appointment'} ${validation.rating}/5.` +
          (validation.text ? ` "${validation.text}"` : ''),
        deadlineAt
      );

      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, requestId, data: updated });
    } catch (err: any) {
      console.error(`[MyBookings] (${requestId}) Review threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Your review could not be saved.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/bookings/mine/:id — the booking detail page
// ---------------------------------------------------------------------------

const SALON_DETAIL_COLUMNS =
  'id, salon_name, cover_image_url, logo_url, city, currency, full_address, address_line2, landmark, phone_number, whatsapp, latitude, longitude';

export interface SalonContact {
  name: string;
  imageUrl: string;
  city: string;
  currency: string;
  address: string;
  phone: string;
  whatsapp: string;
  latitude: number | null;
  longitude: number | null;
}

/** Assemble the street address from the profile's separate parts. */
function composeSalonAddress(profile: any): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const field of [profile?.full_address, profile?.address_line2, profile?.landmark, profile?.city]) {
    const value = String(field ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(value);
  }
  return parts.join(', ');
}

/**
 * Plausible spellings of one Indian mobile number.
 *
 * Returns [] when the value is not a 10-digit mobile, so a landline or a
 * malformed number never becomes a wildcard match.
 */
function phoneCandidates(raw: unknown): string[] {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (ten.length !== 10 || !/^[6-9]/.test(ten)) return [];
  const set = new Set<string>([ten, `+91${ten}`, `91${ten}`, `0${ten}`]);
  const original = String(raw ?? '').trim();
  if (original) set.add(original);
  return [...set];
}

function numericOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Salon name, image and contact details for the detail page.
 * Best-effort: Directions and "Contact salon" degrade to disabled rather than
 * failing the whole page.
 */
async function loadSalonContact(
  deps: BookingMineDeps,
  ownerId: unknown,
  deadlineAt?: number
): Promise<SalonContact | null> {
  if (deps.isMock || !isUuidLike(String(ownerId ?? ''))) return null;
  const { data, error } = await runDb(
    () => deps.db.from('profiles').select(SALON_DETAIL_COLUMNS).eq('id', String(ownerId)).maybeSingle(),
    { label: 'salon contact for booking detail', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
  );
  if (error || !data) {
    if (error) console.warn('[MyBookings] Salon contact lookup failed:', error.message || error);
    return null;
  }
  return {
    name: String(data.salon_name ?? '').trim(),
    imageUrl: String(data.logo_url ?? data.cover_image_url ?? '').trim(),
    city: String(data.city ?? '').trim(),
    currency: String(data.currency ?? '').trim(),
    address: composeSalonAddress(data),
    phone: String(data.phone_number ?? '').trim(),
    whatsapp: String(data.whatsapp ?? '').trim(),
    latitude: numericOrNull(data.latitude),
    longitude: numericOrNull(data.longitude),
  };
}

export interface LoyaltyLookup {
  loyalty: Partial<LoyaltyTerms> | null;
  /** True when the lookup failed, as opposed to the salon having no programme. */
  unavailable: boolean;
}

/**
 * Resolve what this visit is worth in loyalty points.
 *
 * No `loyalty_config` row means the salon has not set a programme up, which is
 * reported as "no rewards" — not as zero points under a programme that does not
 * exist. A failed lookup is reported separately, so a database blip is never
 * presented to the customer as "this salon has no rewards".
 *
 * The tier multiplier comes from the customer's own `clients` row when it can
 * be matched; otherwise it stays at 1.0. Understating is the safe direction —
 * promising a gold-tier award to a bronze customer is not recoverable.
 */
async function loadLoyaltyTerms(
  deps: BookingMineDeps,
  booking: any,
  deadlineAt?: number
): Promise<LoyaltyLookup> {
  const ownerId = String(booking?.owner_id ?? '');
  if (deps.isMock || !isUuidLike(ownerId)) return { loyalty: null, unavailable: false };

  try {
    const { data: config, error } = await runDb(
      () =>
        deps.db
          .from('loyalty_config')
          .select('program_enabled, points_per_visit, points_per_hundred_spent, tier_multipliers')
          .eq('owner_id', ownerId)
          .maybeSingle(),
      { label: 'loyalty config for booking detail', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
    );
    if (error) {
      console.warn('[MyBookings] Loyalty config lookup failed:', error.message || error);
      return { loyalty: null, unavailable: true };
    }
    if (!config) return { loyalty: null, unavailable: false };
    if (config.program_enabled === false) {
      return { loyalty: { programEnabled: false, tier: 'bronze', tierMultiplier: 1 }, unavailable: false };
    }

    let tier = 'bronze';
    // `bookings.customer_phone` is normalised to +91XXXXXXXXXX at checkout, but
    // `clients.phone` is whatever the salon typed on the dashboard, so the two
    // rarely spell the same number identically. Match any plausible spelling,
    // and only when exactly one client matches — two clients sharing a number
    // could sit on different tiers, and guessing would over-promise points.
    const candidates = phoneCandidates(booking?.customer_phone);
    if (candidates.length > 0) {
      const { data: matches, error: clientError } = await runDb(
        () =>
          deps.db
            .from('clients')
            .select('loyalty_tier, lifetime_points, phone')
            .eq('owner_id', ownerId)
            .in('phone', candidates),
        { label: 'loyalty tier for booking detail', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      if (clientError) {
        console.warn('[MyBookings] Loyalty tier lookup failed (using base tier):', clientError.message || clientError);
      } else if (Array.isArray(matches) && matches.length === 1 && matches[0]?.loyalty_tier) {
        tier = String(matches[0].loyalty_tier);
      }
    }

    const multipliers =
      config.tier_multipliers && typeof config.tier_multipliers === 'object' ? config.tier_multipliers : {};
    const multiplier = Number((multipliers as Record<string, unknown>)[tier] ?? 1);

    return {
      loyalty: {
        programEnabled: true,
        pointsPerVisit: Number(config.points_per_visit ?? 0),
        pointsPerHundredSpent: Number(config.points_per_hundred_spent ?? 0),
        tierMultiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
        tier,
      },
      unavailable: false,
    };
  } catch (err: any) {
    console.warn('[MyBookings] Loyalty lookup threw (continuing without it):', err?.message || err);
    return { loyalty: null, unavailable: true };
  }
}

export function createMyBookingDetailHandler(deps: BookingMineDeps) {
  return async function getMyBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkdtl');
    try {
      if (requireAdminClient(deps, res, requestId)) return;
      const deadlineAt = res.locals?.requestDeadlineAt;

      const auth = await deps.authenticateUser(req, deadlineAt);
      if (!auth.ok) {
        authFailure(res, requestId, auth);
        return;
      }

      const id = String(req.params?.id ?? '').trim();
      // Same ownership gate as cancel and review: another customer's booking is
      // reported as not-found rather than forbidden.
      const booking = await loadOwnedBooking(deps, res, requestId, id, auth.user.id, deadlineAt);
      if (!booking || responseAlreadyEnded(res)) return;

      const salon = await loadSalonContact(deps, booking.owner_id, deadlineAt);
      const { loyalty, unavailable } = await loadLoyaltyTerms(deps, booking, deadlineAt);

      if (responseAlreadyEnded(res)) return;
      res.json({
        success: true,
        mode: deps.isMock ? 'mock' : 'live',
        requestId,
        data: { booking, salon, loyalty, loyaltyUnavailable: unavailable },
      });
    } catch (err: any) {
      console.error(`[MyBookings] (${requestId}) Detail threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'This booking could not be loaded.',
      });
    }
  };
}

/** Re-exported so the client can describe a status without a second import. */
export { describeBookingStatus };
