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
} from '../server/customerRoutes';
import { pickProfileUpdates } from '../server/customerRoutes';

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
  const matches = (row: any, filters: any[]) =>
    filters.every((filter) => {
      const [kind, column, value] = filter;
      if (kind === 'eq') return String(row[column]) === String(value);
      if (kind === 'neq') return String(row[column]) !== String(value);
      if (kind === 'in') return (value as any[]).map(String).includes(String(row[column]));
      if (kind === 'not') return row[column] !== null && row[column] !== undefined;
      if (kind === 'ilike') return String(row[column] ?? '').toLowerCase().includes(String(value).replace(/%/g, '').toLowerCase());
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

    const builder: any = {
      select(columns: string = '*', options?: any) {
        selectColumns = columns;
        if (options?.head) single = 'none';
        return builder;
      },
      insert(values: any) {
        op = 'insert';
        body = values;
        return builder;
      },
      update(values: any) {
        op = 'update';
        body = values;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(column: string, value: any) {
        filters.push(['eq', column, value]);
        return builder;
      },
      neq(column: string, value: any) {
        filters.push(['neq', column, value]);
        return builder;
      },
      in(column: string, value: any[]) {
        filters.push(['in', column, value]);
        return builder;
      },
      not(column: string, _op: string, _value: any) {
        filters.push(['not', column, _value]);
        return builder;
      },
      ilike(column: string, value: any) {
        filters.push(['ilike', column, value]);
        return builder;
      },
      or() {
        return builder;
      },
      order() {
        return builder;
      },
      limit(count: number) {
        limitCount = count;
        return builder;
      },
      maybeSingle() {
        single = 'maybe';
        return builder;
      },
      single() {
        single = 'exact';
        return builder;
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
    return new Proxy(builder, {
      get(target: any, prop: string | symbol) {
        if (prop in target || typeof prop === 'symbol') return target[prop];
        return (...args: any[]) => {
          unsupportedCalls.push(`${table}.${String(prop)}(${args.length})`);
          return target;
        };
      },
    });

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
  await createProfileWriteHandler(deps)({ body: { city: 'Bengaluru', latitude: 12.97, longitude: 77.59 }, params: {}, query: {} }, res);
  assert.equal(res.body.success, true);
  const write = db.calls.find((call) => call.op === 'update' && call.table === 'profiles');
  assert.ok(write, 'the city change should still be written');
  assert.equal(write!.body.city, 'Bengaluru');
  assert.equal(write!.body.latitude, undefined, 'geo columns belong to the salon, not to whoever signs in on that row');
  assert.equal(write!.body.longitude, undefined);
  assert.match(res.body.notice || '', /latitude|Not writable/i);
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
