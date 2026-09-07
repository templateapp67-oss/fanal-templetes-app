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
import { runDb, newRequestId, DEFAULT_DB_TIMEOUT_MS, LOOKUP_DB_TIMEOUT_MS } from './dbGuard';

export interface BookingRoutesDeps {
  db: any;
  isMock: boolean;
  getMockBookings: () => any[];
  setMockBookings?: (rows: any[]) => void;
  getMockNotifications: () => any[];
  setMockNotifications: (rows: any[]) => void;
  addMockNotifications: (rows: any[]) => void;
  resolveOwnerEmail: (ownerId: string | null | undefined) => Promise<string>;
}

const byNewestFirst = (a: any, b: any) =>
  new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime();

/**
 * Resolve which salon a dashboard request is allowed to read.
 * Accepts `?owner_id=<uuid>`, `?subdomain=<slug>` or `?email=<owner email>`.
 */
export async function resolveOwnerScope(
  deps: Pick<BookingRoutesDeps, 'db' | 'isMock'>,
  query: Record<string, any>
): Promise<{ ownerId: string | null; error?: string }> {
  const ownerId = typeof query.owner_id === 'string' ? query.owner_id.trim() : '';
  if (isUuidLike(ownerId)) return { ownerId };
  if (ownerId) return { ownerId: null, error: `owner_id "${ownerId}" is not a valid uuid.` };

  if (deps.isMock) return { ownerId: null };

  const subdomain = typeof query.subdomain === 'string' ? query.subdomain.trim().toLowerCase() : '';
  if (subdomain) {
    const { data, error } = await runDb(
      () => deps.db.from('profiles').select('id').eq('subdomain', subdomain).maybeSingle(),
      { label: 'scope lookup by subdomain', timeoutMs: LOOKUP_DB_TIMEOUT_MS }
    );
    if (error) return { ownerId: null, error: error.message || 'Owner lookup failed.' };
    if (isUuidLike((data as any)?.id)) return { ownerId: (data as any).id };
    return { ownerId: null, error: `No salon found for subdomain "${subdomain}".` };
  }

  const email = typeof query.email === 'string' ? query.email.trim() : '';
  if (email) {
    const { data, error } = await runDb(
      () => deps.db.from('profiles').select('id').eq('email', email).maybeSingle(),
      { label: 'scope lookup by email', timeoutMs: LOOKUP_DB_TIMEOUT_MS }
    );
    if (error) return { ownerId: null, error: error.message || 'Owner lookup failed.' };
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
      if (deps.isMock) {
        const scope = typeof req.query?.owner_id === 'string' ? req.query.owner_id.trim() : '';
        const rows = [...deps.getMockBookings()]
          .filter((b) => !scope || !b.owner_id || b.owner_id === scope)
          .sort(byNewestFirst);
        return void res.json({ success: true, mode: 'mock', requestId, data: rows });
      }

      const { ownerId, error: scopeError } = await resolveOwnerScope(deps, req.query || {});
      if (scopeError) {
        return void res.status(400).json({ success: false, code: 'invalid_scope', requestId, error: scopeError });
      }
      if (!ownerId) {
        // Refusing beats leaking every salon's customer list.
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
        { label: `bookings list (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS }
      );

      if (error) {
        console.error(`[Bookings] (${requestId}) List failed:`, error.message || error);
        return void res.status(error.code === 'db_timeout' ? 503 : 500).json({
          success: false,
          code: error.code || 'db_error',
          requestId,
          error: `Live bookings could not be loaded (${error.message || 'database error'}).`,
        });
      }

      res.json({ success: true, mode: 'live', requestId, data: data || [] });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) List threw:`, err?.stack || err);
      res.status(500).json({
        success: false,
        code: 'unexpected_error',
        requestId,
        error: err?.message || 'Bookings could not be loaded.',
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
    const id = String(req.params?.id || '').trim();
    try {
      if (!id) {
        return void res.status(400).json({ success: false, code: 'invalid_id', requestId, error: 'A booking id is required.' });
      }

      if (deps.isMock) {
        const booking = deps.getMockBookings().find((b) => b.id === id);
        if (!booking) {
          return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found.' });
        }
        return void res.json({ success: true, mode: 'mock', requestId, data: booking });
      }

      const { data, error } = await runDb(
        () => deps.db.from('bookings').select('*').eq('id', id).maybeSingle(),
        { label: `booking fetch (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS }
      );

      if (error) {
        console.error(`[Bookings] (${requestId}) Fetch failed:`, error.message || error);
        return void res.status(error.code === 'db_timeout' ? 503 : 500).json({
          success: false,
          code: error.code || 'db_error',
          requestId,
          error: `This booking could not be loaded (${error.message || 'database error'}).`,
        });
      }
      if (!data) {
        return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found.' });
      }
      res.json({ success: true, mode: 'live', requestId, data });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) Fetch threw:`, err?.stack || err);
      res.status(500).json({
        success: false,
        code: 'unexpected_error',
        requestId,
        error: err?.message || 'Booking could not be loaded.',
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
      const { id, status, proposed_date, proposed_time_slot } = req.body ?? {};
      if (!id || !status) {
        return void res
          .status(400)
          .json({ success: false, code: 'invalid_request', requestId, error: 'id and status are required.' });
      }
      if (status === 'reschedule_proposed' && (!proposed_date || !proposed_time_slot)) {
        return void res.status(400).json({
          success: false,
          code: 'invalid_request',
          requestId,
          error: 'A proposed date and time are required to propose a reschedule.',
        });
      }

      let data: any;

      if (deps.isMock) {
        const rows = deps.getMockBookings();
        const idx = rows.findIndex((b) => b.id === id);
        if (idx === -1) {
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
          { label: `booking read-for-update (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS }
        );
        if (fetchError) {
          console.error(`[Bookings] (${requestId}) Failed to read booking for update:`, fetchError);
          return void res.status(fetchError.code === 'db_timeout' ? 503 : 500).json({
            success: false,
            code: fetchError.code || 'db_error',
            requestId,
            error: fetchError.message,
          });
        }
        if (!existing) {
          return void res.status(404).json({ success: false, code: 'not_found', requestId, error: 'Booking not found' });
        }
        const changes = applyBookingUpdate(existing, { status, proposed_date, proposed_time_slot });
        const { data: updated, error: updateError } = await runDb(
          () => deps.db.from('bookings').update(changes).eq('id', id).select().single(),
          { label: `booking update (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS }
        );
        if (updateError || !updated) {
          console.error(`[Bookings] (${requestId}) Failed to update booking:`, updateError);
          return void res.status(updateError?.code === 'db_timeout' ? 503 : 500).json({
            success: false,
            code: updateError?.code || 'db_error',
            requestId,
            error: updateError?.message || 'Booking update failed.',
          });
        }
        data = updated;
      }

      // Notifications are best-effort — they must never fail the transition.
      try {
        const ownerEmail = await deps.resolveOwnerEmail(data.owner_id);
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
          if (deps.isMock) {
            deps.addMockNotifications(
              rows.map((n) => ({ ...n, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() }))
            );
          } else {
            const { error: notifError } = await runDb(
              () => deps.db.from('in_app_notifications').insert(rows),
              { label: `status notification (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, retry: false }
            );
            if (notifError) console.warn(`[Bookings] (${requestId}) Notification insert error:`, notifError.message);
          }
        }
      } catch (notifErr: any) {
        console.warn(`[Bookings] (${requestId}) Notification step threw:`, notifErr?.message || notifErr);
      }

      res.json({ success: true, requestId, data });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) Update threw:`, err?.stack || err);
      res.status(500).json({
        success: false,
        code: 'unexpected_error',
        requestId,
        error: err?.message || 'Booking update failed.',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/notifications?email=
// ---------------------------------------------------------------------------
export function createNotificationsListHandler(deps: BookingRoutesDeps) {
  return async function listNotifications(req: any, res: any): Promise<void> {
    const requestId = newRequestId('ntls');
    const email = typeof req.query?.email === 'string' ? req.query.email.trim() : '';
    try {
      if (!email) {
        return void res
          .status(400)
          .json({ success: false, code: 'invalid_request', requestId, error: 'An email address is required.' });
      }

      if (deps.isMock) {
        const rows = deps.getMockNotifications().filter((n) => n.user_email === email).sort(byNewestFirst);
        return void res.json({ success: true, mode: 'mock', requestId, data: rows });
      }

      const { data, error } = await runDb(
        () =>
          deps.db
            .from('in_app_notifications')
            .select('*')
            .eq('user_email', email)
            .order('created_at', { ascending: false })
            .limit(100),
        { label: `notifications list (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS }
      );

      if (error) {
        console.warn(`[Notifications] (${requestId}) List failed:`, error.message || error);
        return void res.status(error.code === 'db_timeout' ? 503 : 500).json({
          success: false,
          code: error.code || 'db_error',
          requestId,
          error: `Notifications could not be loaded (${error.message || 'database error'}).`,
        });
      }
      res.json({ success: true, mode: 'live', requestId, data: data || [] });
    } catch (err: any) {
      console.error(`[Notifications] (${requestId}) List threw:`, err?.stack || err);
      res.status(500).json({
        success: false,
        code: 'unexpected_error',
        requestId,
        error: err?.message || 'Notifications could not be loaded.',
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
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      if (!email) {
        return void res
          .status(400)
          .json({ success: false, code: 'invalid_request', requestId, error: 'An email address is required.' });
      }

      if (deps.isMock) {
        deps.setMockNotifications(
          deps.getMockNotifications().map((n) => (n.user_email === email ? { ...n, is_read: true } : n))
        );
        return void res.json({ success: true, mode: 'mock', requestId });
      }

      const { error } = await runDb(
        () => deps.db.from('in_app_notifications').update({ is_read: true }).eq('user_email', email).eq('is_read', false),
        { label: `notifications mark read (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS }
      );

      if (error) {
        // Previously this answered `success: true`, so the badge silently came
        // back on the next poll with no explanation anywhere.
        console.warn(`[Notifications] (${requestId}) Mark-read failed:`, error.message || error);
        return void res.status(error.code === 'db_timeout' ? 503 : 500).json({
          success: false,
          code: error.code || 'db_error',
          requestId,
          error: `Notifications could not be marked as read (${error.message || 'database error'}).`,
        });
      }
      res.json({ success: true, mode: 'live', requestId });
    } catch (err: any) {
      console.error(`[Notifications] (${requestId}) Mark-read threw:`, err?.stack || err);
      res.status(500).json({
        success: false,
        code: 'unexpected_error',
        requestId,
        error: err?.message || 'Notifications could not be marked as read.',
      });
    }
  };
}
