// ============================================================================
// Bookings/notifications read + update routes.
//
// Covers the three gaps these handlers shared before they were extracted from
// the two entrypoints:
//   • GET /api/bookings returned EVERY salon's bookings (cross-tenant leak),
//   • database failures were masked as `{ success: true, data: [] }`,
//   • POST /api/notifications/read answered `success: true` after a failed
//     update, so the unread badge silently came back.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBookingsListHandler,
  createBookingGetHandler,
  createBookingUpdateHandler,
  createNotificationsListHandler,
  createNotificationsReadHandler,
  resolveOwnerScope,
} from '../server/bookingRoutes';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const OTHER = '3f0d9a2e-5c4b-4a1d-8b7e-11223344aabb';

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    locals: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

/** Minimal Supabase double with per-table scripted results. */
function makeDb(script: Record<string, any>) {
  const seen: any[] = [];
  const from = (table: string) => {
    const state: any = { table, filters: {}, op: 'select' };
    const api: any = {
      select() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
        seen.push({ table, op: 'select', filters: { ...state.filters } });
        return Promise.resolve(script[table]?.select ?? { data: [], error: null });
      },
      eq(column: string, value: any) {
        state.filters[column] = value;
        return api;
      },
      update(values: any) {
        state.op = 'update';
        state.values = values;
        const result = script[table]?.update ?? { data: { id: 'b1', ...values }, error: null };
        const thenable: any = Promise.resolve(result);
        thenable.eq = (column: string, value: any) => {
          state.filters[column] = value;
          seen.push({ table, op: 'update', filters: { ...state.filters }, values });
          return thenable;
        };
        thenable.select = () => ({ single: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) });
        return thenable;
      },
      insert(rows: any) {
        seen.push({ table, op: 'insert', rows });
        return Promise.resolve(script[table]?.insert ?? { data: rows, error: null });
      },
      maybeSingle() {
        seen.push({ table, op: 'maybeSingle', filters: { ...state.filters } });
        return Promise.resolve(script[table]?.maybeSingle ?? { data: null, error: null });
      },
      single() {
        return Promise.resolve(script[table]?.single ?? { data: null, error: null });
      },
    };
    return api;
  };
  return { db: { from }, seen };
}

const baseDeps = (overrides: any = {}) => ({
  db: makeDb({}).db,
  isMock: false,
  getMockBookings: () => [],
  getMockNotifications: () => [],
  setMockNotifications: () => {},
  addMockNotifications: () => {},
  resolveOwnerEmail: async () => 'owner@real.com',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Cross-tenant scoping
// ---------------------------------------------------------------------------

test('GET /api/bookings refuses to list every salon when no scope is given', async () => {
  const handler = createBookingsListHandler(baseDeps());
  const res = makeRes();
  await handler({ query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'owner_scope_required');
});

test('GET /api/bookings filters by the requested owner id', async () => {
  const { db, seen } = makeDb({
    bookings: { select: { data: [{ id: 'b1', owner_id: OWNER }], error: null } },
  });
  const handler = createBookingsListHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ query: { owner_id: OWNER } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  const query = seen.find((s) => s.table === 'bookings');
  assert.equal(query.filters.owner_id, OWNER, 'the query must be scoped to the owner');
});

test('GET /api/bookings rejects a malformed owner id instead of ignoring it', async () => {
  const handler = createBookingsListHandler(baseDeps());
  const res = makeRes();
  await handler({ query: { owner_id: 'apt-123' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_scope');
});

test('a subdomain scope is resolved to the owning profile', async () => {
  const { db } = makeDb({ profiles: { maybeSingle: { data: { id: OTHER }, error: null } } });
  const scope = await resolveOwnerScope({ db, isMock: false }, { subdomain: 'arts-by-uma' });
  assert.equal(scope.ownerId, OTHER);
});

// ---------------------------------------------------------------------------
// Honest errors
// ---------------------------------------------------------------------------

test('a database failure is reported, not masked as an empty booking list', async () => {
  const { db } = makeDb({
    bookings: { select: { data: null, error: { code: '42501', message: 'permission denied for table bookings' } } },
  });
  const handler = createBookingsListHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ query: { owner_id: OWNER } }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /permission denied/);
});

test('a hung bookings query answers 503 rather than hanging the dashboard', async () => {
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => new Promise(() => {}) }) }) }),
    }),
  };
  const handler = createBookingsListHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ query: { owner_id: OWNER } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'db_timeout');
});

test('GET /api/bookings/:id answers 404 (not 500) for an unknown booking', async () => {
  const { db } = makeDb({ bookings: { maybeSingle: { data: null, error: null } } });
  const handler = createBookingGetHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ params: { id: 'missing' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'not_found');
});

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

test('proposing a reschedule without a slot is rejected before touching the DB', async () => {
  const handler = createBookingUpdateHandler(baseDeps());
  const res = makeRes();
  await handler({ body: { id: 'b1', status: 'reschedule_proposed' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /proposed date and time/i);
});

test('confirming a proposed booking promotes the slot and clears the proposal', async () => {
  const existing = {
    id: 'b1',
    owner_id: OWNER,
    booking_date: '2026-10-02',
    time_slot: '11:30',
    proposed_date: '2026-10-05',
    proposed_time_slot: '16:00',
    customer_email: 'riya@example.com',
  };
  const { db, seen } = makeDb({
    bookings: {
      maybeSingle: { data: existing, error: null },
      update: { data: { ...existing, booking_date: '2026-10-05', time_slot: '16:00', proposed_date: null, proposed_time_slot: null, status: 'confirmed' }, error: null },
    },
  });
  const handler = createBookingUpdateHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { id: 'b1', status: 'confirmed' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.booking_date, '2026-10-05');
  assert.equal(res.body.data.proposed_date, null);
  const update = seen.find((s) => s.op === 'update');
  assert.equal(update.values.booking_date, '2026-10-05');
  assert.equal(update.values.proposed_date, null);
});

test('a failed update surfaces as an error instead of a fake success', async () => {
  const { db } = makeDb({
    bookings: {
      maybeSingle: { data: { id: 'b1', owner_id: OWNER }, error: null },
      update: { data: null, error: { code: '42501', message: 'permission denied' } },
    },
  });
  const handler = createBookingUpdateHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { id: 'b1', status: 'confirmed' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test('GET /api/notifications requires an email address', async () => {
  const handler = createNotificationsListHandler(baseDeps());
  const res = makeRes();
  await handler({ query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/notifications/read reports a failed update instead of claiming success', async () => {
  const { db } = makeDb({
    in_app_notifications: { update: { data: null, error: { code: '42501', message: 'permission denied' } } },
  });
  const handler = createNotificationsReadHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { email: 'owner@real.com' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /marked as read/i);
});

test('POST /api/notifications/read succeeds in mock mode and flips the rows', async () => {
  let stored = [{ user_email: 'owner@real.com', is_read: false }];
  const handler = createNotificationsReadHandler(
    baseDeps({
      isMock: true,
      getMockNotifications: () => stored,
      setMockNotifications: (rows: any[]) => {
        stored = rows;
      },
    })
  );
  const res = makeRes();
  await handler({ body: { email: 'owner@real.com' } }, res);
  assert.equal(res.body.success, true);
  assert.equal(stored[0].is_read, true);
});
