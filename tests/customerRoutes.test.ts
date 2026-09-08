// ============================================================================
// The Customer App API (server/customerRoutes.ts).
//
// What these tests defend, in order of how much it would hurt to lose:
//
//   1. Identity. The customer is who the verified bearer token says they are.
//      No route accepts a `user_id`/`customer_id` parameter, and a foreign row
//      answers 404 — never 403 with the row's contents next to it.
//   2. No fabrication. With no Supabase credentials the API says so
//      (`mode:'mock'` + a notice) and returns empty payloads. It never returns
//      `src/mockData.ts` rows as if they were the salon's.
//   3. Write safety. A customer cannot write salon-owned columns (theme,
//      deposit policy, opening hours) into the shared `profiles` row, and cannot
//      move the salon's map pin by saving their own GPS fix there.
//   4. The transactional booking. Booking row + service lines are one unit: if
//      the lines fail, the booking is removed again, and the customer is told
//      which half survived.
//
// The fake `db` below is a thenable PostgREST builder — the handlers await
// `deps.db.from(t).select()…` through `runDb`, so this is enough to exercise
// real filtering, insertion and rollback without a database.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createMembershipsHandler,
  createBookingCreateHandler,
  createCancelHandler,
  createConnectionHandler,
  createMyBookingDetailHandler,
  createMyBookingsHandler,
  createProfileWriteHandler,
  createReviewWriteHandler,
  createSalonListHandler,
  createSlotsHandler,
  createBookingAdvanceHandler,
  createPaymentConfigHandler,
  createPaymentOrderHandler,
  createQrConfirmHandler,
  createQrVerifyHandler,
} from '../server/customerRoutes';
import { pickProfileUpdates, createPassHandler } from '../server/customerRoutes';
import { passCodeFor } from '../src/lib/customer/checkin';
import { normalizeGatewayPayment, createMockOrder, signMockPayment, _resetPaymentOrderCache } from '../server/razorpay';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SALON_SERVICE_ID = '33333333-3333-4333-8333-333333333333';
const STYLIST_ID = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeRes(body?: any) {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    locals: {},
    req: { headers: body?.headers || {}, user: undefined },
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

interface FakeDb {
  from(table: string): any;
  calls: Array<{ table: string; op: string; body: any; filters: any[] }>;
  rows: Record<string, any[]>;
}

function fakeDb(rows: Record<string, any[]>): FakeDb {
  const calls: FakeDb['calls'] = [];
  const unsupportedCalls: string[] = [];
  /**
   * Read a filter target the way PostgREST does, including the `jsonb->>key`
   * paths this app filters on (`metadata->>review_rating`). Without this the fake
   * would silently drop every jsonb filter and a rating query could never be
   * tested at all.
   */
  const readColumn = (row: any, column: string) => {
    const jsonPath = /^([a-zA-Z_]+)->>'?([a-zA-Z_]+)'?$/.exec(column);
    if (jsonPath) {
      const source = row?.[jsonPath[1]];
      const parsed = typeof source === 'string' ? (() => { try { return JSON.parse(source); } catch { return null; } })() : source;
      return parsed?.[jsonPath[2]];
    }
    return row?.[column];
  };

  const matches = (row: any, filters: any[]) =>
    filters.every((filter) => {
      const [kind, column, value] = filter;
      const actual = readColumn(row, column);
      if (kind === 'eq') return String(actual) === String(value);
      if (kind === 'neq') return String(actual) !== String(value);
      if (kind === 'in') return (value as any[]).map(String).includes(String(actual));
      if (kind === 'not') return actual !== null && actual !== undefined;
      if (kind === 'ilike') return String(actual ?? '').toLowerCase().includes(String(value).replace(/%/g, '').toLowerCase());
      return true;
    });

  const db: any = { calls, rows, from: (table: string) => makeTable(table) };

  function makeTable(table: string) {
    const filters: any[] = [];
    let op = 'select';
    let body: any = null;
    let single: 'none' | 'maybe' | 'exact' = 'none';
    let limitCount = Infinity;
    let selectColumns = '*';

    // Every chained method returns the PROXY below, not the raw builder. A method
    // that returned `builder` would drop the proxy and make the next unmodelled
    // filter (`gte`, `contains`, …) throw instead of no-opping — which quietly
    // turned real queries into "error" results in the handlers under test.
    let self: any;
    const chained: any = {
      select(columns: string = '*', options?: any) {
        selectColumns = columns;
        if (options?.head) single = 'none';
        return self;
      },
      insert(values: any) {
        op = 'insert';
        body = values;
        return self;
      },
      update(values: any) {
        op = 'update';
        body = values;
        return self;
      },
      delete() {
        op = 'delete';
        return self;
      },
      eq(column: string, value: any) {
        filters.push(['eq', column, value]);
        return self;
      },
      neq(column: string, value: any) {
        filters.push(['neq', column, value]);
        return self;
      },
      in(column: string, value: any[]) {
        filters.push(['in', column, value]);
        return self;
      },
      not(column: string, _op: string, _value: any) {
        filters.push(['not', column, _value]);
        return self;
      },
      ilike(column: string, value: any) {
        filters.push(['ilike', column, value]);
        return self;
      },
      or() {
        return self;
      },
      order() {
        return self;
      },
      limit(count: number) {
        limitCount = count;
        return self;
      },
      maybeSingle() {
        single = 'maybe';
        return self;
      },
      single() {
        single = 'exact';
        return self;
      },
      // Anything the handler chains that this fake has no opinion about
      // (`gte`, `overlaps`, `filter`, `contains`, …) is recorded and ignored.
      // The fake exists to assert on identity filters and on writes, not to be
      // a PostgREST clone: silently no-opping keeps that boundary honest.
      // The handler awaits the builder (that is what `runDb` does), so the
      // result is produced by `then`.
      async then(resolve: (value: any) => void, reject: (reason: any) => void) {
        try {
          resolve(execute());
        } catch (error) {
          reject(error);
        }
      },
    };

    // Every PostgREST filter the handler chains must return the builder, so any
    // method this fake does not model is recorded and no-opped rather than
    // throwing: the fake exists to assert on identity filters and on writes, not
    // to be a PostgREST clone.
    const proxy: any = new Proxy(chained, {
      get(target: any, prop: string | symbol) {
        if (prop in target || typeof prop === 'symbol') {
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (...args: any[]) => {
          unsupportedCalls.push(`${table}.${String(prop)}(${args.length})`);
          return proxy;
        };
      },
    });
    self = proxy;
    return proxy;

    function execute() {
      const table_ = rows[table] || (rows[table] = []);
      void unsupportedCalls;
      calls.push({ table, op, body: body === null ? null : JSON.parse(JSON.stringify(body)), filters: [...filters] });
      if (op === 'insert') {
        const incoming = Array.isArray(body) ? body : [body];
        const written = incoming.map((values, index) => ({
          id: values?.id || `${table}-${table_.length + index + 1}`,
          created_at: '2026-09-08T10:00:00.000Z',
          updated_at: '2026-09-08T10:00:00.000Z',
          ...values,
        }));
        table_.push(...written);
        if (single === 'exact') return { data: written[0], error: null };
        if (single === 'maybe') return { data: written[0] || null, error: null };
        return { data: written, error: null };
      }
      if (op === 'update') {
        const targets = table_.filter((row) => matches(row, filters));
        targets.forEach((row, index) => Object.assign(row, { ...body }, { id: row.id }));
        if (!targets.length && single === 'exact') {
          return { data: null, error: { code: 'PGRST116', message: 'no rows updated' } };
        }
        if (single === 'exact') return { data: targets[0], error: null };
        if (single === 'maybe') return { data: targets[0] || null, error: null };
        return { data: targets, error: null };
      }
      if (op === 'delete') {
        const keep = table_.filter((row) => !matches(row, filters));
        rows[table] = keep;
        table_.length = 0;
        table_.push(...keep);
        return { data: null, error: null };
      }
      const found = table_.filter((row) => matches(row, filters)).slice(0, limitCount);
      if (single === 'exact') return found.length ? { data: found[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      if (single === 'maybe') return { data: found[0] || null, error: null };
      return { data: found, error: null };
    }
  }

  return db;
}

function makeDeps(overrides: Record<string, any> = {}) {
  const db = overrides.db || fakeDb({});
  const notifications: any[] = [];
  const deps: any = {
    db,
    isMock: false,
    hasAdminClient: true,
    authenticateUser: async () => ({ ok: true, user: { id: ME, email: 'me@example.com' } }),
    getMockBookings: () => [],
    getMockNotifications: () => notifications,
    addMockNotifications: (batch: any[]) => notifications.push(...batch),
    resolveOwnerEmail: async () => 'owner@salon.com',
    now: () => Date.UTC(2026, 8, 19, 12, 0, 0), // 2026-09-19 17:30 IST
    discoveryLimit: 24,
    ...overrides,
    // The fake db always wins over an override's placeholder.
    ...(overrides.db ? {} : { db }),
  };
  return { deps, db, notifications };
}

const unauthenticated = {
  authenticateUser: async () => ({ ok: false, code: 'auth_required', error: 'Please sign in.' }),
};

async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const MOCK_GATEWAY_ENV = {
  RAZORPAY_KEY_ID: undefined,
  RAZORPAY_KEY_SECRET: undefined,
  VITE_RAZORPAY_KEY_ID: undefined,
  RAZORPAY_SECRET: undefined,
  RAZORPAY_MOCK_MODE: undefined,
  VERCEL_ENV: undefined,
  NODE_ENV: 'test',
};

const DISABLED_GATEWAY_ENV = {
  ...MOCK_GATEWAY_ENV,
  NODE_ENV: 'production',
  RAZORPAY_MOCK_MODE: 'false',
};

// ---------------------------------------------------------------------------
// 1 — identity
// ---------------------------------------------------------------------------

test('private customer routes refuse an anonymous caller before touching data', async () => {
  const { deps, db } = makeDeps(unauthenticated);
  db.rows.bookings = [{ id: 'b1', owner_id: OWNER, user_id: OTHER, customer_name: 'Someone else', booking_date: '2026-09-30', time_slot: '11:00', status: 'confirmed' }];

  for (const handler of [createMyBookingsHandler(deps), createMyBookingDetailHandler(deps), createProfileWriteHandler(deps)]) {
    const res = makeRes();
    await handler({ params: { id: 'b1' }, query: { user_id: OTHER }, body: { fullName: 'Hacker' } }, res);
    assert.equal(res.statusCode, 401, 'expected 401 for a signed-out caller');
    assert.equal(res.body.code, 'auth_required');
    assert.equal(res.body.data, undefined, 'a rejected request must not carry rows');
  }
  assert.equal(db.calls.length, 0, 'an unauthenticated request must not query the database at all');
});

test('another customer’s booking id answers not-found, not forbidden-with-details', async () => {
  const row = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: OWNER, user_id: OTHER, customer_name: 'Riya', booking_date: '2026-09-30', time_slot: '11:00', status: 'confirmed', total_amount: 1500 };
  const { deps, db } = makeDeps({ db: fakeDb({ bookings: [row] }) });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'not_found');
  assert.equal(JSON.stringify(res.body).includes('Riya'), false, 'the foreign customer’s name must not appear in the answer');
});

test('the customer list is filtered by the token, and a user_id query parameter is ignored', async () => {
  const rows = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', owner_id: OWNER, user_id: ME, customer_name: 'Me', booking_date: '2026-09-30', time_slot: '11:00', status: 'confirmed', total_amount: 900 },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', owner_id: OWNER, user_id: OTHER, customer_name: 'Them', booking_date: '2026-09-30', time_slot: '12:00', status: 'confirmed', total_amount: 900 },
  ];
  const { deps, db } = makeDeps({ db: fakeDb({ bookings: rows }) });
  const res = makeRes();
  await createMyBookingsHandler(deps)({ query: { user_id: OTHER, owner_id: OWNER }, params: {} }, res);
  assert.equal(res.body.success, true);
  const ids = (res.body.data || []).map((item: any) => item.id);
  assert.deepEqual(ids, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01']);
  // The handler may filter in SQL or in code, but it must never widen to the
  // id the caller asked for.
  const filters = db.calls.filter((call) => call.table === 'bookings').flatMap((call) => call.filters);
  const userIdFilters = filters.filter((filter: any[]) => filter[1] === 'user_id');
  assert.ok(userIdFilters.every((filter: any[]) => filter[2] === ME), 'any user_id filter must be the token id');
});

// ---------------------------------------------------------------------------
// 2 — nothing is invented when the database is not configured
// ---------------------------------------------------------------------------

test('mock mode answers empty + a notice instead of sample salons', async () => {
  const { deps } = makeDeps({ isMock: true });
  const res = makeRes();
  await createSalonListHandler(deps)({ query: { city: 'Bengaluru' }, params: {} }, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.mode, 'mock');
  assert.deepEqual(res.body.data, [], 'no fabricated salon rows');
  assert.match(res.body.notice || res.body.mapped ? JSON.stringify(res.body) : '', /not connected|Not connected|mock/i);
});

test('the connection report marks every table unreachable without credentials', async () => {
  const { deps } = makeDeps({ isMock: true });
  const res = makeRes();
  await createConnectionHandler(deps)({ query: {}, params: {} }, res);
  assert.equal(res.body.data.mode, 'mock');
  const entries = Object.values(res.body.data.tables as Record<string, any>);
  assert.ok(entries.length >= 10);
  assert.ok(entries.every((entry) => entry.exists === false), 'mock mode must not claim a table exists');
});

// ---------------------------------------------------------------------------
// 3 — what a customer may write
// ---------------------------------------------------------------------------

test('a customer profile write cannot touch salon-owned columns', () => {
  const { updates, dropped } = (pickProfileUpdates as any)({
    fullName: 'Ananya Sharma',
    phone: '+91 98765 00000',
    salon_name: 'Ananya Luxury Spa',
    theme_accent_key: 'obsidian',
    require_deposit: true,
    deposit_percentage: 80,
    working_hours: { monFri: '00:00-23:59' },
    role: 'owner',
    password: 'nope',
  });
  assert.deepEqual(updates, { full_name: 'Ananya Sharma', phone_number: '+91 98765 00000' });
  for (const key of ['salon_name', 'theme_accent_key', 'require_deposit', 'deposit_percentage', 'working_hours', 'role', 'password']) {
    assert.ok(dropped.includes(key), `${key} must be dropped, not renamed`);
  }
});

test('a customer cannot move a salon’s map pin by saving their own location', async () => {
  const db = fakeDb({
    profiles: [
      {
        id: ME,
        salon_name: 'Glow Studio', // a published salon row wearing the customer's id
        subdomain: 'glow',
        business_type: 'unisex_salons',
        city: 'Pune',
        latitude: 18.52,
        longitude: 73.85,
      },
    ],
  });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createProfileWriteHandler(deps)(
    { body: { fullName: 'Ananya Iyer', city: 'Bengaluru', latitude: 12.97, longitude: 77.59 }, params: {}, query: {} },
    res
  );
  assert.equal(res.body.success, true);
  const write = db.calls.find((call) => call.op === 'update' && call.table === 'profiles');
  assert.ok(write, 'a personal column must still be writable');
  assert.equal(write!.body.full_name, 'Ananya Iyer', 'who the person is belongs to the person');
  assert.equal(write!.body.city, undefined, 'city is on the salon public page, so the customer app cannot repaint it');
  assert.equal(write!.body.latitude, undefined, 'geo columns belong to the salon, not to whoever signs in on that row');
  assert.equal(write!.body.longitude, undefined);
  assert.match(res.body.notice || '', /public page.*city|Not written from the customer app/i);
  assert.equal(res.body.locationStored, false);
});

test('a non-salon profile row may store its own coordinates', async () => {
  const db = fakeDb({ profiles: [{ id: ME, salon_name: null, city: 'Pune' }] });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createProfileWriteHandler(deps)({ body: { latitude: 12.97, longitude: 77.59 }, params: {}, query: {} }, res);
  const write = db.calls.find((call) => call.op === 'update');
  assert.equal(write!.body.latitude, 12.97);
  assert.equal(write!.body.longitude, 77.59);
  assert.equal(res.body.locationStored, true);
});

// ---------------------------------------------------------------------------
// 4 — the transactional booking
// ---------------------------------------------------------------------------

/**
 * A salon with one service, one stylist and no bookings. `overrides` patches
 * individual rows (a schedule, a conflicting booking) so each test states only
 * the data its assertion is about.
 */
function bookingTables(overrides: Record<string, any> = {}) {
  return fakeDb({
    profiles: [
      {
        id: OWNER,
        salon_name: 'Glow Studio',
        subdomain: 'glow',
        city: 'Bengaluru',
        business_type: 'unisex_salons',
        require_deposit: false,
        deposit_percentage: 20,
        working_hours: null,
        ...overrides.profile,
      },
    ],
    services: [{ id: SALON_SERVICE_ID, owner_id: OWNER, name: 'Hair Spa', price: 1200, duration_minutes: 60, category: 'Hair', is_active: true, ...overrides.service }],
    stylists: [{ id: STYLIST_ID, owner_id: OWNER, name: 'Neha', role: 'Senior Stylist', status: 'Active', assigned_services: [SALON_SERVICE_ID], schedule: null, ...overrides.stylist }],
    bookings: Array.isArray(overrides.bookings) ? overrides.bookings : [],
    in_app_notifications: [],
    clients: [],
    loyalty_config: [],
    loyalty_point_transactions: [],
    loyalty_rewards: [],
    loyalty_redeemed_rewards: [],
  });
}

test('a booking is created, its service lines are written, and the answer is the re-read row', async () => {
  const db = bookingTables();
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createBookingCreateHandler(deps)(
    {
      params: {},
      query: {},
      body: {
        salonId: OWNER,
        date: '2026-09-30',
        time: '11:00',
        serviceIds: [SALON_SERVICE_ID],
        staffId: STYLIST_ID,
        customerName: 'Ananya',
        customerPhone: '+91 98765 00000',
        bookingType: 'salon',
        referralCode: 'nx-11111111',
      },
    },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.written.bookings, 1);
  assert.equal(res.body.data.written.serviceLines, 1);
  assert.equal(res.body.data.serviceLines[0].name, 'Hair Spa');
  assert.equal(res.body.data.booking.totalAmount, 1200);
  assert.equal(res.body.data.booking.referralCode, 'NX-11111111');
  const inserted = db.calls.find((call) => call.table === 'bookings' && call.op === 'insert');
  assert.equal(inserted!.body.user_id, ME, 'the row is stamped with the token id, never a posted one');
  assert.equal(inserted!.body.advance_paid_amount, 0, 'nothing is paid until the gateway says so');
  assert.equal(JSON.stringify(inserted!.body).includes('salon_name'), false);
});

test('a stylist who cannot be booked is refused, never quietly swapped for anyone available', async () => {
  const offDuty = bookingTables({ stylist: { status: 'Inactive' } });
  const { deps: offDutyDeps } = makeDeps({ db: offDuty });
  const res = makeRes();
  await createBookingCreateHandler(offDutyDeps)({
    params: {},
    query: {},
    body: { salonId: OWNER, date: '2026-09-30', time: '11:00', serviceIds: [SALON_SERVICE_ID], staffId: STYLIST_ID },
    headers: { authorization: 'Bearer mock-token' },
  }, res);
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'staff_unavailable');
  assert.ok(/stylist/i.test(res.body.error), 'the message names the stylist, not a generic failure');
  assert.equal(offDuty.calls.filter((call) => call.table === 'bookings' && call.op === 'insert').length, 0, 'nothing was booked');

  const foreign = bookingTables();
  const { deps: foreignDeps } = makeDeps({ db: foreign });
  const foreignRes = makeRes();
  await createBookingCreateHandler(foreignDeps)({
    params: {},
    query: {},
    body: { salonId: OWNER, date: '2026-09-30', time: '11:00', serviceIds: [SALON_SERVICE_ID], staffId: OTHER },
    headers: { authorization: 'Bearer mock-token' },
  }, foreignRes);
  assert.equal(foreignRes.statusCode, 400, 'a stylist id from another salon resolves to nobody here');
  assert.equal(foreignRes.body.code, 'staff_unavailable');

  // No stylist requested at all is a different thing entirely: a salon-wide booking.
  const anyStaff = bookingTables();
  const { deps: anyStaffDeps } = makeDeps({ db: anyStaff });
  const anyRes = makeRes();
  await createBookingCreateHandler(anyStaffDeps)({
    params: {},
    query: {},
    body: { salonId: OWNER, date: '2026-09-30', time: '11:00', serviceIds: [SALON_SERVICE_ID], staffId: '' },
    headers: { authorization: 'Bearer mock-token' },
  }, anyRes);
  assert.equal(anyRes.statusCode, 200, JSON.stringify(anyRes.body));
  assert.deepEqual(anyRes.body.data.booking.staffNames, [], 'the booking is recorded for the salon, not for a person');
  assert.equal(anyRes.body.data.serviceLines[0].staffId, '');
});

test('when the service lines cannot be written the booking is rolled back', async () => {
  const db = bookingTables();
  let failed = false;
  const wrapped: FakeDb = new Proxy(db, {
    get(target: any, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const builder = target.from(table);
          if (table !== 'bookings') return builder;
          const originalUpdate = builder.update;
          builder.update = (values: any) => {
            // The lines are written by the metadata update on the booking row.
            if (values && values.metadata && !failed) {
              failed = true;
              return {
                async then(resolve: any) {
                  resolve({ data: null, error: { code: '22P05', message: 'invalid input syntax for jsonb' } });
                },
              };
            }
            return originalUpdate.call(builder, values);
          };
          return builder;
        };
      }
      return target[prop];
    },
  });
  const { deps } = makeDeps({ db: wrapped as any });
  const res = makeRes();
  await createBookingCreateHandler(deps)(
    { params: {}, query: {}, body: { salonId: OWNER, date: '2026-09-30', time: '11:00', serviceIds: [SALON_SERVICE_ID], customerName: 'Ananya', customerPhone: '+91' } },
    res
  );
  assert.equal(res.statusCode >= 400, true, 'a half-written booking must not answer 200');
  assert.equal(res.body.success, false);
  const deleted = db.calls.find((call) => call.op === 'delete' && call.table === 'bookings');
  assert.ok(deleted, 'the parent booking must be removed again');
  assert.equal(res.body.data?.staleBookingId, undefined, 'a successful rollback promises nothing stale');
});

test('a slot that is already booked is refused before anything is inserted', async () => {
  const db = bookingTables({
    bookings: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06', owner_id: OWNER, user_id: OTHER, booking_date: '2026-09-30', time_slot: '11:00', status: 'confirmed', service_name: 'Hair Spa', customer_name: 'Riya', metadata: { staff_id: STYLIST_ID } },
    ],
  });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createBookingCreateHandler(deps)(
    { params: {}, query: {}, body: { salonId: OWNER, date: '2026-09-30', time: '11:00', serviceIds: [SALON_SERVICE_ID], staffId: STYLIST_ID, customerName: 'Ananya', customerPhone: '+91' } },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'slot_taken');
  assert.equal(db.calls.some((call) => call.op === 'insert' && call.table === 'bookings'), false, 'a rejected booking must leave no row');
});

test('availability is derived from the schedule minus real bookings, and never marked free by default', async () => {
  const db = bookingTables({
    bookings: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07', owner_id: OWNER, user_id: OTHER, booking_date: '2026-09-30', time_slot: '10:00', status: 'confirmed', service_name: 'Hair Spa', customer_name: 'Riya', metadata: { staff_id: STYLIST_ID } },
    ],
    // 2026-09-30 is a Wednesday; `stylists.schedule` is an array of day rows,
    // which is the shape the migration's jsonb actually holds.
    stylist: {
      schedule: [{ day: 'Wednesday', enabled: true, fromTime: '10:00', toTime: '13:00' }],
    },
  });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createSlotsHandler(deps)({ params: { idOrSubdomain: OWNER }, query: { date: '2026-09-30', service_ids: SALON_SERVICE_ID }, body: {} }, res);
  assert.equal(res.body.success, true, JSON.stringify(res.body));
  const slots = res.body.data.slots;
  assert.ok(slots.length >= 3, 'a three-hour window must offer several slots');
  const at10 = slots.find((slot: any) => slot.time === '10:00');
  const at11 = slots.find((slot: any) => slot.time === '11:00');
  assert.equal(at10?.available, false, 'the booked 10:00 slot must be unavailable');
  assert.equal(at10?.reason, 'booked');
  assert.equal(at11?.available, true);
  assert.equal(res.body.data.source, 'derived', 'slots have no table; the screen must be told');
});

// ---------------------------------------------------------------------------
// Cancellation, reviews and deposits
// ---------------------------------------------------------------------------

test('cancelling is decided by the shared rule, not by the client’s claim', async () => {
  const past = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09', owner_id: OWNER, user_id: ME, booking_date: '2026-09-01', time_slot: '10:00', status: 'confirmed', customer_name: 'Ananya' };
  const { deps, db } = makeDeps({ db: fakeDb({ bookings: [past] }) });
  const res = makeRes();
  await createCancelHandler(deps)({ body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09', force: true }, params: {}, query: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'not_cancellable');
  assert.equal(db.calls.some((call) => call.op === 'update'), false, 'a refused cancellation changes nothing');
});

test('a review is stored on the booking row and only for a completed visit', async () => {
  const db = fakeDb({
    bookings: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03', owner_id: OWNER, user_id: ME, booking_date: '2026-09-01', time_slot: '10:00', status: 'completed', service_name: 'Hair Spa', customer_name: 'Ananya', metadata: {} },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04', owner_id: OWNER, user_id: ME, booking_date: '2026-09-30', time_slot: '10:00', status: 'confirmed', service_name: 'Hair Spa', customer_name: 'Ananya', metadata: {} },
    ],
  });
  const { deps } = makeDeps({ db });
  const early = makeRes();
  await createReviewWriteHandler(deps)({ body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04', rating: 5, text: 'Great' }, params: {}, query: {} }, early);
  assert.equal(early.statusCode, 422, 'a review before the visit is completed is rejected');

  const late = makeRes();
  await createReviewWriteHandler(deps)({ body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03', rating: 4, text: 'Lovely, a bit loud.' }, params: {}, query: {} }, late);
  assert.equal(late.statusCode, 200, JSON.stringify(late.body));
  const written = db.rows.bookings.find((row: any) => row.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03')!;
  assert.equal(written.metadata.review_rating, 4);
  assert.equal(written.metadata.review_text, 'Lovely, a bit loud.');
  assert.ok(written.metadata.reviewed_at, 'the write is timestamped so the list can sort it');
});

test('the deposit endpoint refuses to record a payment it cannot verify', async () => {
  const db = fakeDb({ bookings: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05', owner_id: OWNER, user_id: ME, booking_date: '2026-09-30', time_slot: '11:00', status: 'pending', payment_status: 'pending', total_amount: 1000, metadata: { deposit_policy: { percentage: 20 } } }] });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createBookingAdvanceHandler(deps)({ params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05' }, body: {}, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'payment_reference_required');
  assert.equal(db.calls.some((call) => call.op === 'update'), false, 'no reference, no mark-as-paid');
});

test('a deposit cannot be recorded while the database is not configured', async () => {
  const { deps } = makeDeps({ isMock: true });
  const res = makeRes();
  await createBookingAdvanceHandler(deps)({ params: { id: 'b1' }, body: { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'sig' }, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'supabase_not_configured');
});

const depositSalonBody = {
  salonId: OWNER,
  date: '2026-09-30',
  time: '11:00',
  serviceIds: [SALON_SERVICE_ID],
  staffId: STYLIST_ID,
  customerName: 'Ananya',
  customerPhone: '+91 98765 00000',
  bookingType: 'salon',
  bookingRef: 'NX-JPR-53682',
  receipt: 'NX-JPR-53682',
  totalAmount: 1200,
  amount: 240,
  depositPercent: 20,
};

test('a deposit salon refuses to create a booking without a verified payment', async () => {
  const db = bookingTables({ profile: { require_deposit: true, deposit_percentage: 20 } });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createBookingCreateHandler(deps)(
    { params: {}, query: {}, body: { ...depositSalonBody, advance_paid_amount: 240 } },
    res
  );
  assert.equal(res.statusCode, 402, JSON.stringify(res.body));
  assert.equal(res.body.code, 'payment_required');
  assert.equal(res.body.depositDue, 240);
  assert.equal(db.calls.some((call) => call.table === 'bookings' && call.op === 'insert'), false, 'no unpaid row is invented');
});

test('a deposit salon creates a confirmed booking only after Razorpay reports the payment captured', async () => {
  await withEnvAsync(MOCK_GATEWAY_ENV, async () => {
    const db = bookingTables({ profile: { require_deposit: true, deposit_percentage: 20 } });
    const { deps } = makeDeps({ db });
    const order = createMockOrder({ amount: 240, receipt: 'NX-JPR-53682' });
    const signed = signMockPayment(order.id);
    const res = makeRes();
    await createBookingCreateHandler(deps)(
      {
        params: {},
        query: {},
        body: {
          ...depositSalonBody,
          payment: { ...signed, amount: 240, depositPercent: 20 },
        },
      },
      res
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const inserted = db.calls.find((call) => call.table === 'bookings' && call.op === 'insert');
    assert.ok(inserted, 'the paid booking is written');
    assert.equal(inserted!.body.advance_paid_amount, 240);
    assert.equal(inserted!.body.payment_status, 'paid_deposit');
    assert.equal(inserted!.body.status, 'confirmed');
    assert.equal(inserted!.body.payment_id, signed.razorpay_payment_id);
    assert.equal(res.body.data.depositDue, 0);
    assert.equal(res.body.data.paymentHandoff, 'razorpay_advance');
  });
});

test('a valid mock signature does not create the appointment when the payment is not captured', async () => {
  await withEnvAsync(MOCK_GATEWAY_ENV, async () => {
    const db = bookingTables({ profile: { require_deposit: true, deposit_percentage: 20 } });
    const order = createMockOrder({ amount: 240, receipt: 'NX-JPR-53682' });
    const signed = signMockPayment(order.id);
    const { deps } = makeDeps({
      db,
      gateway: {
        async fetchPayment() {
          return {
            id: signed.razorpay_payment_id,
            orderId: signed.razorpay_order_id,
            amountRupees: 240,
            amountPaidRupees: 0,
            status: 'authorized',
            currency: 'INR',
            captured: false,
            method: 'mock',
          };
        },
      },
    });
    const res = makeRes();
    await createBookingCreateHandler(deps)(
      {
        params: {},
        query: {},
        body: { ...depositSalonBody, payment: { ...signed, amount: 240 } },
      },
      res
    );
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'payment_not_captured');
    assert.equal(db.calls.some((call) => call.table === 'bookings' && call.op === 'insert'), false);
  });
});

test('a captured payment for the wrong deposit amount never creates the appointment', async () => {
  await withEnvAsync(MOCK_GATEWAY_ENV, async () => {
    const db = bookingTables({ profile: { require_deposit: true, deposit_percentage: 20 } });
    const { deps } = makeDeps({ db });
    const order = createMockOrder({ amount: 1, receipt: 'NX-JPR-53682' });
    const signed = signMockPayment(order.id);
    const res = makeRes();
    await createBookingCreateHandler(deps)(
      {
        params: {},
        query: {},
        body: { ...depositSalonBody, payment: { ...signed, amount: 240 } },
      },
      res
    );
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'payment_amount_mismatch');
    assert.equal(db.calls.some((call) => call.table === 'bookings' && call.op === 'insert'), false);
  });
});

test('a forged gateway signature never creates the appointment', async () => {
  await withEnvAsync(MOCK_GATEWAY_ENV, async () => {
    const db = bookingTables({ profile: { require_deposit: true, deposit_percentage: 20 } });
    const { deps } = makeDeps({ db });
    const res = makeRes();
    await createBookingCreateHandler(deps)(
      {
        params: {},
        query: {},
        body: {
          ...depositSalonBody,
          payment: {
            razorpay_order_id: 'order_mock_ABCDEFGHIJKLMN',
            razorpay_payment_id: 'pay_mock_forged',
            razorpay_signature: 'deadbeef',
            amount: 240,
          },
        },
      },
      res
    );
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'payment_unverified');
    assert.equal(db.calls.some((call) => call.table === 'bookings' && call.op === 'insert'), false);
  });
});

test('the same captured payment_id is idempotent — a second create returns the existing row', async () => {
  await withEnvAsync(MOCK_GATEWAY_ENV, async () => {
    const signed = signMockPayment('order_mock_ABCDEFGHIJKLMN');
    const db = bookingTables({
      profile: { require_deposit: true, deposit_percentage: 20 },
      bookings: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
          owner_id: OWNER,
          user_id: ME,
          booking_date: '2026-09-30',
          time_slot: '11:00',
          status: 'confirmed',
          payment_status: 'paid_deposit',
          payment_id: signed.razorpay_payment_id,
          total_amount: 1200,
          advance_paid_amount: 240,
          customer_name: 'Ananya',
          metadata: { booking_ref: 'NX-JPR-53682' },
        },
      ],
    });
    const { deps } = makeDeps({ db });
    const res = makeRes();
    await createBookingCreateHandler(deps)(
      {
        params: {},
        query: {},
        body: { ...depositSalonBody, payment: { ...signed, amount: 240 } },
      },
      res
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.written.bookings, 0);
    assert.match(res.body.notice || '', /already created/i);
    assert.equal(
      db.calls.filter((call) => call.table === 'bookings' && call.op === 'insert').length,
      0,
      'the captured payment must not mint a second row'
    );
  });
});

test('GET /api/customer/payments/config is never HTTP 500 when keys are missing', async () => {
  await withEnvAsync(DISABLED_GATEWAY_ENV, async () => {
    const { deps } = makeDeps();
    const res = makeRes();
    await createPaymentConfigHandler(deps)({ params: {}, query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.configured, false);
    assert.equal(res.body.data.configured, false);
    assert.equal(res.body.keyId, null);
    assert.notEqual(res.statusCode, 500);

    const anon = makeDeps(unauthenticated);
    const denied = makeRes();
    await createPaymentConfigHandler(anon.deps)({ params: {}, query: {}, headers: {} }, denied);
    assert.equal(denied.statusCode, 401);
    assert.notEqual(denied.statusCode, 500);
    assert.equal(anon.db.calls.length, 0);
  });
});

test('POST /api/customer/payments/order reuses the unpaid order for the same NX-JPR-53682 draft', async () => {
  await withEnvAsync(MOCK_GATEWAY_ENV, async () => {
    _resetPaymentOrderCache();
    const db = bookingTables({ profile: { require_deposit: true, deposit_percentage: 20 } });
    const { deps } = makeDeps({ db });
    const handler = createPaymentOrderHandler(deps);
    const first = makeRes();
    await handler({ params: {}, query: {}, body: depositSalonBody }, first);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.ok(first.body.order?.id);
    assert.equal(first.body.order.receipt, 'NX-JPR-53682');
    assert.equal(first.body.deposit.rupees, 240);

    const second = makeRes();
    await handler({ params: {}, query: {}, body: depositSalonBody }, second);
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.equal(second.body.order.id, first.body.order.id, 'retry must not mint a second chargeable order');
    assert.equal(second.body.reused, true);
    _resetPaymentOrderCache();
  });
});

// ---------------------------------------------------------------------------
// QR rewards: the customer reports, the gateway decides.
//
// This is the money rule the spec is emphatic about — "Do not allow the client to
// manually approve/credit its own rewards" — and it is the easiest thing in a
// rewards app to get wrong, because the tempting implementation is exactly the
// one that writes points from a form field. So these tests assert on the shape of
// what is WRITTEN: a recorded payment carries zero points and touches no wallet,
// and points appear only after the server has asked the gateway what was
// captured.
// ---------------------------------------------------------------------------

function qrTables(overrides: Record<string, any> = {}) {
  const pending = {
    id: 'qr-1',
    owner_id: OWNER,
    client_id: 'c1',
    type: 'qr_payment',
    date: '2026-09-19',
    points_change: 0,
    description: 'QR payment (awaiting verification) ₹750.00 ref:UPI-750',
  };
  return {
    profiles: [{ id: OWNER, salon_name: 'Glow Studio', subdomain: 'glow', business_type: 'Salon', currency: '₹' }],
    bookings: [{ id: 'bk-1', owner_id: OWNER, user_id: ME, customer_email: 'me@example.com', customer_phone: '+919999999999' }],
    clients: [{ id: 'c1', owner_id: OWNER, email: 'me@example.com', name: 'Ananya', points: 100, lifetime_points: 100, total_spent: 0, loyalty_tier: 'bronze' }],
    loyalty_config: [{ owner_id: OWNER, program_enabled: true, points_per_visit: 10, points_per_hundred_spent: 10 }],
    loyalty_point_transactions: [pending],
    ...overrides,
  };
}

function gatewayPayment(fields: Record<string, any> = {}) {
  return {
    id: 'pay_VERIFIED1',
    order_id: 'order_1',
    amount: 75000,
    amount_paid: 75000,
    status: 'captured',
    currency: 'INR',
    method: 'upi',
    ...fields,
  };
}

function gatewayStub(payload: any, options: { throws?: any } = {}) {
  const seen: string[] = [];
  const client = {
    seen,
    fetchPayment: async (paymentId: string) => {
      seen.push(paymentId);
      if (options.throws) throw options.throws;
      // Normalized exactly the way the real client does it, so a test that
      // asserts on `captured`/rupees is asserting on the same shape the server
      // will see in production.
      return normalizeGatewayPayment(payload);
    },
  };
  return client;
}

test('a recorded QR payment is a claim: zero points on the ledger and no wallet write', async () => {
  const db = fakeDb(qrTables({ loyalty_point_transactions: [] }));
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createQrConfirmHandler(deps)(
    { body: { salonId: OWNER, amount: 750, reference: 'UPI-NEW' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.payment.pointsCredited, 0, 'a form field must never produce points');
  assert.equal(res.body.data.payment.rewardStatus, 'awaiting_verification');
  assert.equal(res.body.data.wallet.points, 100, 'the wallet comes back exactly as it was');
  assert.equal(db.calls.some((call) => call.table === 'clients' && call.op === 'update'), false, 'recording a payment must not touch the balance');

  const inserted = db.calls.find((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert');
  assert.ok(inserted, 'the ledger row is written');
  assert.equal(inserted!.body.points_change, 0);
  assert.match(inserted!.body.description, /awaiting verification/);
  assert.match(inserted!.body.description, /₹750\.00/);
  assert.match(res.body.notice, /cannot add points to itself|verified/i);
});

test('verification credits from the GATEWAY amount, and only once', async () => {
  const rows = qrTables();
  const db = fakeDb(rows);
  const gateway = gatewayStub(gatewayPayment());
  const { deps } = makeDeps({ db, gateway });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-1', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.payment.rewardStatus, 'credited');
  // ₹750 at 10 points per ₹100 = 75 points, credited onto the existing 100.
  assert.equal(res.body.data.payment.pointsCredited, 75);
  assert.equal(res.body.data.verifiedAmount, 750);
  assert.equal(res.body.data.wallet.points, 175);
  assert.equal(gateway.seen[0], 'pay_VERIFIED1', 'the gateway lookup is what decides');
  const ledgerUpdate = db.calls.find((call) => call.table === 'loyalty_point_transactions' && call.op === 'update');
  assert.equal(ledgerUpdate!.body.points_change, 75);
  assert.match(ledgerUpdate!.body.description, /verified pay_VERIFIED1/);

  // The row in the fixture table is mutated by the fake, so a second call finds
  // points already on it and must not credit again.
  const again = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-1', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    again
  );
  assert.equal(again.body.success, true);
  assert.equal(again.body.data.alreadyVerified, true);
  assert.equal(again.body.data.payment.pointsCredited, 75, 'the original credit is reported, not doubled');
  assert.equal(
    db.calls.filter((call) => call.table === 'clients' && call.op === 'update').length,
    1,
    'a replayed verification must not double-credit the wallet'
  );
});

test('a payment the gateway has not captured earns nothing', async () => {
  const rows = qrTables();
  const db = fakeDb(rows);
  const { deps } = makeDeps({ db, gateway: gatewayStub(gatewayPayment({ status: 'created', amount_paid: 0 })) });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-1', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'payment_unverified');
  assert.equal(db.rows.loyalty_point_transactions[0].points_change, 0, 'the ledger row stays uncredited');
  assert.equal(db.calls.some((call) => call.table === 'clients' && call.op === 'update'), false);
});

test('the verified payment is the amount of record, not what was typed', async () => {
  // The customer logged ₹750 and the gateway agrees. Points come from the
  // gateway's number, so the only way to earn more is to pay more.
  const rows = qrTables();
  const db = fakeDb(rows);
  const { deps } = makeDeps({ db, gateway: gatewayStub(gatewayPayment({ amount: 150000, amount_paid: 150000 })) });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-1', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.verifiedAmount, 1500, 'the gateway number replaced the claim');
  assert.equal(res.body.data.payment.pointsCredited, 150, '150 points, not the 75 a smaller claim implied');
  assert.equal(res.body.data.wallet.points, 250);
});

test('a claim of MORE than the gateway was paid is refused, not credited', async () => {
  const rows = qrTables({
    loyalty_point_transactions: [
      { id: 'qr-2', owner_id: OWNER, client_id: 'c1', type: 'qr_payment', date: '2026-09-19', points_change: 0, description: 'QR payment (awaiting verification) ₹9000.00 ref:UPI-9000' },
    ],
  });
  const db = fakeDb(rows);
  const { deps } = makeDeps({ db, gateway: gatewayStub(gatewayPayment({ amount: 75000, amount_paid: 75000 })) });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-2', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'payment_amount_mismatch');
  assert.equal(rows.loyalty_point_transactions[0].points_change, 0);
  assert.equal(db.calls.some((call) => call.table === 'clients' && call.op === 'update'), false);
});

test('without a real gateway nothing is credited, and the entry survives', async () => {
  const rows = qrTables();
  const db = fakeDb(rows);
  const { deps } = makeDeps({ db, gateway: null });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-1', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'payments_disabled');
  assert.match(res.body.error, /salon must confirm|stays recorded/i);
  assert.equal(rows.loyalty_point_transactions[0].points_change, 0);
});

test("another customer's payment row is indistinguishable from a wrong id", async () => {
  const rows = qrTables({
    loyalty_point_transactions: [
      { id: 'qr-x', owner_id: OWNER, client_id: 'c-OTHER', type: 'qr_payment', date: '2026-09-19', points_change: 0, description: 'QR payment (awaiting verification) ₹750.00 ref:UPI-OTHER' },
    ],
  });
  const db = fakeDb(rows);
  const { deps } = makeDeps({ db, gateway: gatewayStub(gatewayPayment()) });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-x', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'not_found');
  assert.equal('data' in res.body, false, 'a foreign row is never described back');
});

test('a verified payment below the qualifying minimum is recorded and does not earn', async () => {
  const rows = qrTables({
    loyalty_point_transactions: [
      { id: 'qr-40', owner_id: OWNER, client_id: 'c1', type: 'qr_payment', date: '2026-09-19', points_change: 0, description: 'QR payment (below earning minimum) ₹40.00 ref:UPI-40' },
    ],
  });
  const db = fakeDb(rows);
  const { deps } = makeDeps({ db, gateway: gatewayStub(gatewayPayment({ amount: 4000, amount_paid: 4000 })) });
  const res = makeRes();
  await createQrVerifyHandler(deps)(
    { body: { paymentId: 'qr-40', razorpay_payment_id: 'pay_VERIFIED1' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'below_minimum');
  assert.match(res.body.error, /₹40/);
  assert.equal(db.rows.loyalty_point_transactions[0].points_change, 0, 'below the floor means no points, not a rejected payment');
  assert.equal(db.rows.loyalty_point_transactions[0].id, 'qr-40', 'the entry stays on the ledger for the salon to see');
  assert.equal(db.calls.some((call) => call.table === 'clients' && call.op === 'update'), false);
});

test('a duplicate QR record returns the original instead of writing twice', async () => {
  const db = fakeDb(qrTables());
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createQrConfirmHandler(deps)(
    { body: { salonId: OWNER, amount: 750, reference: 'UPI-750' }, headers: {}, user: { id: ME, email: 'me@example.com' } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.payment.id, 'qr-1', 'the existing entry is what comes back');
  assert.equal(db.calls.some((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert'), false, 'the same payment is not a second ledger row');
  assert.match(res.body.notice, /already recorded/i);
});

// ---------------------------------------------------------------------------
// Discovery: filters that answer with catalogue facts, not guesses.
// ---------------------------------------------------------------------------

const SALON_A = '55555555-5555-4555-8555-555555555555';
const SALON_B = '66666666-6666-4666-8666-666666666666';

function discoveryTables() {
  return {
    profiles: [
      {
        id: SALON_A,
        salon_name: 'Anchor Salon',
        subdomain: 'anchor',
        business_type: 'unisex_salons',
        city: 'Jaipur',
        latitude: 26.9,
        longitude: 75.8,
        working_hours: { monFri: '9:00 AM - 8:00 PM', saturday: '9:00 AM - 8:00 PM', sunday: 'closed' },
      },
      {
        id: SALON_B,
        salon_name: 'Border Salon',
        subdomain: 'border',
        business_type: 'unisex_salons',
        city: 'Jaipur',
        latitude: 26.95,
        longitude: 75.85,
        working_hours: null,
      },
    ],
    services: [
      { id: 's-a1', owner_id: SALON_A, name: 'Balayage', category: 'Hair', price: 300, duration_minutes: 60 },
      { id: 's-a2', owner_id: SALON_A, name: 'Cut', category: 'Hair', price: 900, duration_minutes: 30 },
      { id: 's-b1', owner_id: SALON_B, name: 'Manicure', category: 'Nails', price: 200, duration_minutes: 45 },
    ],
    loyalty_rewards: [{ id: 'r1', owner_id: SALON_A, title: '15% off hair', discount_value: 15, required_points: 200, is_active: true, reward_type: 'percentage_discount' }],
    bookings: [
      { id: 'bk1', owner_id: SALON_A, booking_date: '2026-09-15', status: 'completed', metadata: { review_rating: 5 } },
      { id: 'bk2', owner_id: SALON_A, booking_date: '2026-09-16', status: 'completed', metadata: { review_rating: 4 } },
    ],
  };
}

test('discovery filters on real prices, categories, offers and ratings', async () => {
  const db = fakeDb(discoveryTables());
  const { deps } = makeDeps({ db });

  const all = makeRes();
  await createSalonListHandler(deps)({ query: {}, params: {}, headers: {} }, all);
  assert.equal(all.statusCode, 200, JSON.stringify(all.body));
  const names = all.body.data.map((salon: any) => salon.name);
  assert.deepEqual(names, ['Anchor Salon', 'Border Salon'], 'both published salons list by default');
  const anchor = all.body.data[0];
  // Each fact is computed from a table, and the card is allowed to say it.
  assert.equal(anchor.serviceCount, 2);
  assert.equal(anchor.minServicePrice, 300, 'the cheapest published price, not a sample figure');
  assert.deepEqual(anchor.categories, ['Hair']);
  assert.equal(anchor.hasActiveOffers, true, 'one active loyalty_rewards row is what "has offers" means');
  assert.equal(anchor.recentBookings, 2, 'trending is a count of bookings, nothing mystical');
  assert.equal(anchor.rating.count, 2, 'ratings come from stored review rows');
  const border = all.body.data[1];
  assert.equal(border.hasActiveOffers, false);
  assert.equal(border.recentBookings, 0);
  assert.equal(border.openNow, null, 'no working hours means unknown, never "closed"');

  const cheap = makeRes();
  await createSalonListHandler(deps)({ query: { maxPrice: '500', category: 'Hair' }, params: {}, headers: {} }, cheap);
  assert.deepEqual(cheap.body.data.map((salon: any) => salon.name), ['Anchor Salon'], 'a Hair salon whose cheapest service is ₹300');

  const nailsOnly = makeRes();
  await createSalonListHandler(deps)({ query: { category: 'Nails' }, params: {}, headers: {} }, nailsOnly);
  assert.deepEqual(nailsOnly.body.data.map((salon: any) => salon.name), ['Border Salon'], 'the category filter follows the menu, not the salon name');

  const offerHunt = makeRes();
  await createSalonListHandler(deps)({ query: { offersOnly: 'true' }, params: {}, headers: {} }, offerHunt);
  assert.deepEqual(offerHunt.body.data.map((salon: any) => salon.name), ['Anchor Salon']);

  // Two stored ratings, 5 and 4: the average is exactly 4.5, so the bar at 4.5
  // clears and the bar at 5 does not. A rating filter that rounded up would let a
  // 4.5 salon pose as 5 stars.
  const at45 = makeRes();
  await createSalonListHandler(deps)({ query: { minRating: '4.5' }, params: {}, headers: {} }, at45);
  assert.deepEqual(at45.body.data.map((salon: any) => salon.name), ['Anchor Salon']);
  assert.equal(at45.body.data[0].rating.average, 4.5);
  assert.equal(at45.body.data[0].rating.count, 2);

  const at5 = makeRes();
  await createSalonListHandler(deps)({ query: { minRating: '5' }, params: {}, headers: {} }, at5);
  assert.equal(at5.body.data.length, 0, 'no salon here averages 5, and none is padded to it');

  const unrated = makeRes();
  await createSalonListHandler(deps)({ query: { minRating: '1' }, params: {}, headers: {} }, unrated);
  assert.equal(unrated.body.data.length, 1, 'a salon with no reviews is excluded by a rating bar, not scored 0 and kept');

  // The applied filters come back so a curl can prove what the answer means.
  const echo = makeRes();
  await createSalonListHandler(deps)({ query: { openNow: 'true', sort: 'trending', q: 'balayage' }, params: {}, headers: {} }, echo);
  assert.equal(echo.body.filtersApplied.openNow, true);
  assert.equal(echo.body.filtersApplied.sort, 'trending');
  assert.equal(echo.body.filtersApplied.q, 'balayage');
});

test('membership status is the salon’s program switch, with no invented expiry', async () => {
  const db = fakeDb({
    bookings: [{ id: 'bk1', owner_id: OWNER, user_id: ME, customer_email: 'me@example.com' }],
    clients: [{ id: 'c1', owner_id: OWNER, email: 'me@example.com', name: 'Ananya', points: 120, lifetime_points: 120, loyalty_tier: 'gold', created_at: '2026-01-05T00:00:00Z' }],
    loyalty_config: [{ owner_id: OWNER, program_enabled: false, tier_thresholds: { silver: 100, gold: 500, platinum: 1500 } }],
    profiles: [{ id: OWNER, salon_name: 'Glow Studio', subdomain: 'glow', business_type: 'unisex_salons', currency: '₹' }],
  });
  const { deps } = makeDeps({ db });
  const res = makeRes();
  await createMembershipsHandler(deps)({ query: {}, params: {}, headers: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [membership] = res.body.data;
  assert.equal(membership.tier, 'gold');
  assert.equal(membership.active, false, 'the salon switched the program off; the app must not present it as live');
  assert.equal(membership.startDate, '2026-01-05', 'the client row is the only start date this schema has');
  assert.equal(membership.endDate, null, 'no expiry column exists, so none is shown');
});

// ---------------------------------------------------------------------------
// Salon pass — GET /api/customer/me/pass
// ---------------------------------------------------------------------------
test('the salon pass is derived from the verified auth id and needs no storage', async () => {
  const { deps } = makeDeps({});
  const res = makeRes();
  await createPassHandler(deps)(
    { body: {}, params: {}, query: {} },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.success, 'pass answers success');
  const code = res.body.data?.code as string;
  assert.match(code, /^FANAL-[A-Za-z0-9_-]+$/, 'code shape FANAL-<payload>');
  assert.equal(res.body.data.code, passCodeFor(ME), 'the code is the deterministic code of the verified id');
});

test('the salon pass is refused without a verified identity', async () => {
  const { deps } = makeDeps({});
  const res = makeRes();
  await createPassHandler({ ...deps, ...unauthenticated })(
    { body: {}, params: {}, query: {} },
    res
  );
  assert.equal(res.statusCode, 401, JSON.stringify(res.body));
  assert.equal(res.body.code, 'auth_required');
});

// ---------------------------------------------------------------------------
// Date of birth — pickProfileUpdates (drives the birthday bonus rule)
// ---------------------------------------------------------------------------
test('dateOfBirth is a validated real-date column: stored, cleared, or refused', () => {
  const stored = pickProfileUpdates({ dateOfBirth: '1990-09-08', fullName: 'Ananya' });
  assert.equal(stored.updates.date_of_birth, '1990-09-08');
  assert.equal(stored.updates.full_name, 'Ananya');
  assert.deepEqual(stored.dropped, []);

  const cleared = pickProfileUpdates({ dateOfBirth: '', fullName: 'Ananya' });
  assert.equal(cleared.updates.date_of_birth, null, 'an empty string clears the date, it is never stored');

  const bad = pickProfileUpdates({ dateOfBirth: '08/09/1990' });
  assert.ok(bad.dropped.includes('dateOfBirth'), 'non-ISO dates are dropped, not stored');
  assert.equal(bad.updates.date_of_birth, undefined);

  const future = pickProfileUpdates({ dateOfBirth: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10) });
  assert.ok(future.dropped.includes('dateOfBirth'), 'a date in the future cannot be a date of birth');
});
