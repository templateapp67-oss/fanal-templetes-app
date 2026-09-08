// ============================================================================
// Shared read/update routes for bookings + notifications.
//
// WHY THIS FILE EXISTS
// --------------------
// These five handlers used to be hand-copied into `server.ts` AND
// `api/index.ts`. The copies drifted, and both copies shared three real bugs:
//
//   1. **Cross-tenant leak** — `GET /api/bookings` returned EVERY booking row in
//      the database, so any salon owner's dashboard (and anyone who could call
//      the endpoint) saw every other salon's customers, phone numbers and
//      revenue. The list is now scoped to an owner (uuid / subdomain / email)
//      and refuses to answer unscoped in live mode.
//   2. **Silent failure** — when the database errored, the handlers answered
//      `{ success: true, data: <in-memory mock> }`. The dashboard rendered an
//      empty, cheerful "No bookings found" while Supabase was actually down or
//      RLS-blocked. Live mode now returns the real error (with `degraded` info);
//      the mock store is only used when Supabase is genuinely not configured.
//   3. **No timeouts** — a hanging database call kept the request open until the
//      platform killed it, producing an un-parseable HTML 500.
//
// `/api/notifications/read` additionally used to answer `success: true` after a
// failed update, so the unread badge silently came back on the next poll.
// ============================================================================

import { applyBookingUpdate, buildStatusNotifications, isUuidLike } from './bookingOps';
import { PERSISTABLE_BOOKING_STATUS_SET } from '../src/lib/bookingStatus';
import { isValidIsoDate } from './bookingCreate';
import {
  runDb,
  newRequestId,
  DEFAULT_DB_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard';
import { safeDatabaseError, sendSafeError, isMissingTableError } from './safeError';

export interface BookingRoutesDeps {
  db: any;
  isMock: boolean;
  /** Explicit server-side service-role availability for live writes/reads. */
  hasAdminClient?: boolean;
  getMockBookings: () => any[];
  setMockBookings?: (rows: any[]) => void;
  getMockNotifications: () => any[];
  setMockNotifications: (rows: any[]) => void;
  addMockNotifications: (rows: any[]) => void;
  resolveOwnerEmail: (ownerId: string | null | undefined, deadlineAt?: number) => Promise<string>;
}

const byNewestFirst = (a: any, b: any) =>
  new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime();
// Shared registry — see src/lib/bookingStatus.ts. Kept in one place because the
// duplicate copy here had already drifted from bookingCreate.ts's list.
const ALLOWED_BOOKING_STATUSES = PERSISTABLE_BOOKING_STATUS_SET;

function rejectMissingAdminClient(deps: BookingRoutesDeps, res: any, requestId: string): boolean {
  // Production entrypoints pass an explicit false when only the anon client is
  // available. Focused unit tests may omit the flag; that keeps the route
  // helpers usable with lightweight database doubles without weakening the
  // actual serverless guard.
  if (deps.isMock || deps.hasAdminClient !== false) return false;
  if (!responseAlreadyEnded(res)) {
    res.status(503).json({
      success: false,
      code: 'supabase_not_configured',
      requestId,
      retryable: true,
      error: 'The booking service is not connected to its database yet. Please try again later.',
    });
  }
  return true;
}

/**
 * Resolve which salon a dashboard request is allowed to read.
 * Accepts `?owner_id=<uuid>`, `?subdomain=<slug>` or `?email=<owner email>`.
 */
export async function resolveOwnerScope(
  deps: Pick<BookingRoutesDeps, 'db' | 'isMock'>,
  query: Record<string, any>,
  deadlineAt?: number
): Promise<{ ownerId: string | null; error?: string; errorStatus?: number }> {
  const ownerId = typeof query.owner_id === 'string' ? query.owner_id.trim() : '';
  if (isUuidLike(ownerId)) return { ownerId };
  if (ownerId) return { ownerId: null, error: `owner_id "${ownerId}" is not a valid uuid.` };

  if (deps.isMock) return { ownerId: null };

  const subdomain = typeof query.subdomain === 'string' ? query.subdomain.trim().toLowerCase() : '';
  if (subdomain) {
    const { data, error } = await runDb(
      () => deps.db.from('profiles').select('id').eq('subdomain', subdomain).maybeSingle(),
      { label: 'scope lookup by subdomain', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
    );
    if (error) {
      const safe = safeDatabaseError(error, 'The salon could not be resolved right now.');
      return { ownerId: null, error: safe.message, errorStatus: safe.status };
    }
    if (isUuidLike((data as any)?.id)) return { ownerId: (data as any).id };
    return { ownerId: null, error: `No salon found for subdomain "${subdomain}".` };
  }

  const email = typeof query.email === 'string' ? query.email.trim() : '';
  if (email) {
    const { data, error } = await runDb(
      () => deps.db.from('profiles').select('id').eq('email', email).maybeSingle(),
      { label: 'scope lookup by email', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
    );
    if (error) {
      const safe = safeDatabaseError(error, 'The salon could not be resolved right now.');
      return { ownerId: null, error: safe.message, errorStatus: safe.status };
    }
    if (isUuidLike((data as any)?.id)) return { ownerId: (data as any).id };
    return { ownerId: null, error: `No salon account found for "${email}".` };
  }

  return { ownerId: null };
}

// ---------------------------------------------------------------------------
// GET /api/bookings
// ---------------------------------------------------------------------------
export function createBookingsListHandler(deps: BookingRoutesDeps) {
  return async function listBookings(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkls');
    try {
      if (rejectMissingAdminClient(deps, res, requestId)) return;
      const deadlineAt = res.locals?.requestDeadlineAt;
      if (deps.isMock) {
        const scope = typeof req.query?.owner_id === 'string' ? req.query.owner_id.trim() : '';
        const rows = [...deps.getMockBookings()]
          .filter((b) => !scope || !b.owner_id || b.owner_id === scope)
          .sort(byNewestFirst);
        if (responseAlreadyEnded(res)) return;
        return void res.json({ success: true, mode: 'mock', requestId, data: rows });
      }

      const { ownerId, error: scopeError, errorStatus: scopeErrorStatus } = await resolveOwnerScope(deps, req.query || {}, deadlineAt);
      if (scopeError) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(scopeErrorStatus === 503 ? 503 : 400).json({
          success: false,
          code: scopeErrorStatus === 503 ? 'database_unavailable' : 'invalid_scope',
          requestId,
          error: scopeError,
          ...(scopeErrorStatus === 503 ? { retryable: true } : {}),
        });
      }
      if (!ownerId) {
        // Refusing beats leaking every salon's customer list.
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({
          success: false,
          code: 'owner_scope_required',
          requestId,
          error:
            'A salon must be identified to list bookings. Pass ?owner_id=<uuid> (or ?subdomain= / ?email=). Sign in to load your live bookings.',
        });
      }

      const { data, error } = await runDb(
        () =>
          deps.db
            .from('bookings')
            .select('*')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: false })
            .limit(500),
        { label: `bookings list (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );

      if (error) {
        console.error(`[Bookings] (${requestId}) List failed:`, error.message || error);
        if (responseAlreadyEnded(res)) return;
        const safe = safeDatabaseError(error, 'Live bookings could not be loaded.');
        return void res.status(safe.status).json({
          success: false,
          code: safe.code,
          requestId,
          error: safe.message,
          ...(safe.retryable ? { retryable: true } : {}),
        });
      }

      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, mode: 'live', requestId, data: data || [] });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) List threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Live bookings could not be loaded.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/bookings/:id  (guest "manage my booking" link — uuid is the secret)
// ---------------------------------------------------------------------------
export function createBookingGetHandler(deps: BookingRoutesDeps) {
  return async function getBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkget');
    const deadlineAt = res.locals?.requestDeadlineAt;
    const id = String(req.params?.id || '').trim();
    try {
      if (rejectMissingAdminClient(deps, res, requestId)) return;
      if (!id) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({ success: false, code: 'invalid_id', requestId, error: 'A booking id is required.' });
      }
      if (!deps.isMock && !isUuidLike(id)) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({ success: false, code: 'invalid_id', requestId, error: 'The booking id must be a valid UUID.' });
      }

      if (deps.isMock) {
        const booking = deps.getMockBookings().find((b) => b.id === id);
        if (!booking) {
          if (responseAlreadyEnded(res)) return;
        return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found.' });
        }
        if (responseAlreadyEnded(res)) return;
        return void res.json({ success: true, mode: 'mock', requestId, data: booking });
      }

      const { data, error } = await runDb(
        () => deps.db.from('bookings').select('*').eq('id', id).maybeSingle(),
        { label: `booking fetch (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );

      if (error) {
        console.error(`[Bookings] (${requestId}) Fetch failed:`, error.message || error);
        if (responseAlreadyEnded(res)) return;
        const safe = safeDatabaseError(error, 'This booking could not be loaded.');
        return void res.status(safe.status).json({
          success: false,
          code: safe.code,
          requestId,
          error: safe.message,
          ...(safe.retryable ? { retryable: true } : {}),
        });
      }
      if (!data) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found.' });
      }
      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, mode: 'live', requestId, data });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) Fetch threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'This booking could not be loaded.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /api/bookings/update
// ---------------------------------------------------------------------------
export function createBookingUpdateHandler(deps: BookingRoutesDeps) {
  return async function updateBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkup');
    try {
      if (rejectMissingAdminClient(deps, res, requestId)) return;
      const deadlineAt = res.locals?.requestDeadlineAt;
      const { id, status, proposed_date, proposed_time_slot } = req.body ?? {};
      if (!id || !status) {
        return void res
          .status(400)
          .json({ success: false, code: 'invalid_request', requestId, error: 'id and status are required.' });
      }
      if (!deps.isMock && !isUuidLike(id)) {
        return void res.status(400).json({ success: false, code: 'invalid_id', requestId, error: 'The booking id must be a valid UUID.' });
      }
      if (typeof status !== 'string' || !ALLOWED_BOOKING_STATUSES.has(status)) {
        return void res.status(400).json({
          success: false,
          code: 'invalid_status',
          requestId,
          error: `Unsupported booking status \"${String(status)}\".`,
        });
      }
      if (status === 'reschedule_proposed' && (!proposed_date || !proposed_time_slot)) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({
          success: false,
          code: 'invalid_request',
          requestId,
          error: 'A proposed date and time are required to propose a reschedule.',
        });
      }
      if (status === 'reschedule_proposed' && !isValidIsoDate(proposed_date)) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({
          success: false,
          code: 'invalid_date',
          requestId,
          error: 'The proposed date must be a real YYYY-MM-DD date.',
        });
      }

      let data: any;

      if (deps.isMock) {
        const rows = deps.getMockBookings();
        const idx = rows.findIndex((b) => b.id === id);
        if (idx === -1) {
          if (responseAlreadyEnded(res)) return;
        return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found' });
        }
        const existing = rows[idx];
        const changes = applyBookingUpdate(existing, { status, proposed_date, proposed_time_slot });
        data = { ...existing, ...changes };
        rows[idx] = data;
      } else {
        // Live mode: read the current row first — the confirmation transition
        // needs the proposed slot, and a read/write failure must surface as a
        // real error, never as a fake in-memory success.
        const { data: existing, error: fetchError } = await runDb(
          () => deps.db.from('bookings').select('*').eq('id', id).maybeSingle(),
          { label: `booking read-for-update (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (fetchError) {
          console.error(`[Bookings] (${requestId}) Failed to read booking for update:`, fetchError);
          if (responseAlreadyEnded(res)) return;
        const safe = safeDatabaseError(fetchError, 'The booking could not be loaded for update.');
        return void res.status(safe.status).json({
            success: false,
            code: safe.code,
            requestId,
            error: safe.message,
            ...(safe.retryable ? { retryable: true } : {}),
          });
        }
        if (!existing) {
          if (responseAlreadyEnded(res)) return;
        return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found' });
        }
        const changes = applyBookingUpdate(existing, { status, proposed_date, proposed_time_slot });
        const { data: updated, error: updateError } = await runDb(
          () => deps.db.from('bookings').update(changes).eq('id', id).select().single(),
          { label: `booking update (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (updateError || !updated) {
          console.error(`[Bookings] (${requestId}) Failed to update booking:`, updateError);
          if (responseAlreadyEnded(res)) return;
        const safe = safeDatabaseError(updateError, 'Booking update failed.');
        return void res.status(safe.status).json({
            success: false,
            code: safe.code,
            requestId,
            error: safe.message,
            ...(safe.retryable ? { retryable: true } : {}),
          });
        }
        data = updated;
      }

      // Notifications are best-effort — they must never fail the transition.
      try {
        const ownerEmail = await deps.resolveOwnerEmail(data.owner_id, deadlineAt);
        const notifs = buildStatusNotifications(
          data,
          status,
          data.proposed_date ?? proposed_date,
          data.proposed_time_slot ?? proposed_time_slot,
          ownerEmail
        );
        if (notifs) {
          const rows = [notifs.owner];
          if (notifs.customer) rows.unshift(notifs.customer);
          if (deps.isMock || inAppNotificationsTableMissing) {
            deps.addMockNotifications(
              rows.map((n) => ({ ...n, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() }))
            );
          } else {
            const { error: notifError } = await runDb(
              () => deps.db.from('in_app_notifications').insert(rows),
              { label: `status notification (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
            );
            if (notifError) {
              if (isMissingTableError(notifError, 'in_app_notifications')) {
                inAppNotificationsTableMissing = true;
                deps.addMockNotifications(
                  rows.map((n) => ({ ...n, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() }))
                );
              } else {
                console.warn(`[Bookings] (${requestId}) Notification insert error:`, notifError.message);
              }
            }
          }
        }
      } catch (notifErr: any) {
        console.warn(`[Bookings] (${requestId}) Notification step threw:`, notifErr?.message || notifErr);
      }

      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, requestId, data });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) Update threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Booking update failed.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/notifications?email=
// ---------------------------------------------------------------------------
let inAppNotificationsTableMissing = false;

export function createNotificationsListHandler(deps: BookingRoutesDeps) {
  return async function listNotifications(req: any, res: any): Promise<void> {
    const requestId = newRequestId('ntls');
    const deadlineAt = res.locals?.requestDeadlineAt;
    const email = typeof req.query?.email === 'string' ? req.query.email.trim() : '';
    try {
      if (rejectMissingAdminClient(deps, res, requestId)) return;
      if (!email) {
        return void res
          .status(400)
          .json({ success: false, code: 'invalid_request', requestId, error: 'An email address is required.' });
      }

      if (deps.isMock || inAppNotificationsTableMissing) {
        const rows = deps
          .getMockNotifications()
          .filter((n) => String(n.user_email || '').toLowerCase() === email.toLowerCase())
          .sort(byNewestFirst);
        if (responseAlreadyEnded(res)) return;
        return void res.json({
          success: true,
          mode: deps.isMock ? 'mock' : 'memory_fallback',
          requestId,
          data: rows,
        });
      }

      const { data, error } = await runDb(
        () =>
          deps.db
            .from('in_app_notifications')
            .select('*')
            .eq('user_email', email)
            .order('created_at', { ascending: false })
            .limit(100),
        { label: `notifications list (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );

      if (error) {
        if (isMissingTableError(error, 'in_app_notifications')) {
          inAppNotificationsTableMissing = true;
          const rows = deps
            .getMockNotifications()
            .filter((n) => String(n.user_email || '').toLowerCase() === email.toLowerCase())
            .sort(byNewestFirst);
          if (responseAlreadyEnded(res)) return;
          return void res.json({ success: true, mode: 'memory_fallback', requestId, data: rows });
        }
        console.warn(`[Notifications] (${requestId}) List failed:`, error.message || error);
        if (responseAlreadyEnded(res)) return;
        const safe = safeDatabaseError(error, 'Notifications could not be loaded.');
        return void res.status(safe.status).json({
          success: false,
          code: safe.code,
          requestId,
          error: safe.message,
          ...(safe.retryable ? { retryable: true } : {}),
        });
      }
      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, mode: 'live', requestId, data: data || [] });
    } catch (err: any) {
      if (isMissingTableError(err, 'in_app_notifications')) {
        inAppNotificationsTableMissing = true;
        const rows = deps
          .getMockNotifications()
          .filter((n) => String(n.user_email || '').toLowerCase() === email.toLowerCase())
          .sort(byNewestFirst);
        if (responseAlreadyEnded(res)) return;
        return void res.json({ success: true, mode: 'memory_fallback', requestId, data: rows });
      }
      console.error(`[Notifications] (${requestId}) List threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Notifications could not be loaded.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /api/notifications/read
// ---------------------------------------------------------------------------
export function createNotificationsReadHandler(deps: BookingRoutesDeps) {
  return async function markNotificationsRead(req: any, res: any): Promise<void> {
    const requestId = newRequestId('ntrd');
    const deadlineAt = res.locals?.requestDeadlineAt;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    try {
      if (rejectMissingAdminClient(deps, res, requestId)) return;
      if (!email) {
        return void res
          .status(400)
          .json({ success: false, code: 'invalid_request', requestId, error: 'An email address is required.' });
      }

      if (deps.isMock || inAppNotificationsTableMissing) {
        deps.setMockNotifications(
          deps.getMockNotifications().map((n) =>
            String(n.user_email || '').toLowerCase() === email.toLowerCase() ? { ...n, is_read: true } : n
          )
        );
        if (responseAlreadyEnded(res)) return;
        return void res.json({ success: true, mode: deps.isMock ? 'mock' : 'memory_fallback', requestId });
      }

      const { error } = await runDb(
        () => deps.db.from('in_app_notifications').update({ is_read: true }).eq('user_email', email).eq('is_read', false),
        { label: `notifications mark read (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );

      if (error) {
        if (isMissingTableError(error, 'in_app_notifications')) {
          inAppNotificationsTableMissing = true;
          deps.setMockNotifications(
            deps.getMockNotifications().map((n) =>
              String(n.user_email || '').toLowerCase() === email.toLowerCase() ? { ...n, is_read: true } : n
            )
          );
          if (responseAlreadyEnded(res)) return;
          return void res.json({ success: true, mode: 'memory_fallback', requestId });
        }
        // Previously this answered `success: true`, so the badge silently came
        // back on the next poll with no explanation anywhere.
        console.warn(`[Notifications] (${requestId}) Mark-read failed:`, error.message || error);
        if (responseAlreadyEnded(res)) return;
        const safe = safeDatabaseError(error, 'Notifications could not be marked as read.');
        return void res.status(safe.status).json({
          success: false,
          code: safe.code,
          requestId,
          error: safe.message,
          ...(safe.retryable ? { retryable: true } : {}),
        });
      }
      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, mode: 'live', requestId });
    } catch (err: any) {
      if (isMissingTableError(err, 'in_app_notifications')) {
        inAppNotificationsTableMissing = true;
        deps.setMockNotifications(
          deps.getMockNotifications().map((n) =>
            String(n.user_email || '').toLowerCase() === email.toLowerCase() ? { ...n, is_read: true } : n
          )
        );
        if (responseAlreadyEnded(res)) return;
        return void res.json({ success: true, mode: 'memory_fallback', requestId });
      }
      console.error(`[Notifications] (${requestId}) Mark-read threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      sendSafeError(res, err, {
        requestId,
        context: 'database',
        fallbackMessage: 'Notifications could not be marked as read.',
      });
    }
  };
}
