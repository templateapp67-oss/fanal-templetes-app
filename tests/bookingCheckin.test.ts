// ============================================================================
// Owner check-in — server/bookingCheckin.ts
//
// What these tests defend, in order of how much it would hurt to lose:
//   1. Identity resolution. A pass code is resolved to bookings by the
//      decoded auth id, never by a client-supplied user_id; scope (owner) is
//      required in live mode.
//   2. One visit, one credit. The event lands on the booking's own metadata,
//      so a second check-in of the same row is a no-op with no new ledger rows.
//   3. Bonus rules run against resolved facts. Birthday needs the customer's
//      DOB + a wallet at this salon; referral needs a referrer the salon can
//      recognise from its own bookings + their wallet. When a fact is missing
//      the outcome is `skipped` with a reason — never a fabricated credit.
//   4. Ledger conventions. Bonus rows are `type: 'bonus'` on the customer's
//      (birthday) or referrer's (referral) wallet, mirrored by the wallet
//      balance update — and every failure path rolls back so a retry is safe.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBookingCheckinHandler } from '../server/bookingCheckin';
import { passCodeFor } from '../src/lib/customer/checkin';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // referralCodeFor(ME) → NX-AAAAAAAA
const REFERRER = '11111111-1111-4111-8111-111111111111'; // referralCodeFor → NX-11111111
const OTHER = '22222222-2222-4222-8222-222222222222';
const TODAY = '2026-09-08';
const NOW_MS = Date.UTC(2026, 8, 8, 5, 0, 0); // 2026-09-08 UTC

// ---------------------------------------------------------------------------
// Harness (PostgREST-style thenable builder, enough for this handler)
// ---------------------------------------------------------------------------

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

interface FakeDb {
  from(table: string): any;
  calls: Array<{ table: string; op: string; body: any; filters: any[] }>;
  rows: Record<string, any[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeDb(initial: Record<string, any[]>): FakeDb {
  const rows: Record<string, any[]> = {};
  for (const [key, list] of Object.entries(initial)) rows[key] = clone(list);
  const calls: FakeDb['calls'] = [];
  let seq = 0;

  function makeTable(table: string) {
    const filters: any[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let body: any = null;
    let limitN = Infinity;
    let wantSingle: 'none' | 'maybe' | 'exact' = 'none';

    const matches = (row: any) =>
      filters.every(([kind, column, value]) => {
        const actual = row?.[column];
        if (kind === 'eq') return String(actual) === String(value);
        if (kind === 'neq') return String(actual) !== String(value);
        if (kind === 'in') return (value as any[]).map(String).includes(String(actual));
        if (kind === 'limit') return true;
        return true;
      });

    let self: any;
    const builder = {
      select(_columns?: string, _options?: any) {
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
      limit(n: number) {
        limitN = n;
        return self;
      },
      maybeSingle() {
        wantSingle = 'maybe';
        return self;
      },
      single() {
        wantSingle = 'exact';
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
      then(resolve: any, reject?: any) {
        if (process.env.DEBUG_DB) console.error('[fake-db] then', table, op, JSON.stringify(filters));
        try {
          const tableRows = rows[table] || [];
          let result: any;
          if (op === 'insert') {
            const inserted: any[] = (Array.isArray(body) ? body : [body]).map((entry) => {
              const row = clone(entry);
              if (!row.id) row.id = `generated-${++seq}`;
              tableRows.push(row);
              return row;
            });
            result = { data: wantSingle === 'exact' || wantSingle === 'maybe' ? inserted[0] : inserted, error: null };
          } else if (op === 'update') {
            const hits = tableRows.filter(matches);
            for (const row of hits) Object.assign(row, clone(body));
            result = { data: (wantSingle === 'exact' || wantSingle === 'maybe' ? hits[0] : hits) ?? null, error: null };
          } else if (op === 'delete') {
            const hits = tableRows.filter(matches);
            result = { data: (wantSingle === 'exact' || wantSingle === 'maybe' ? hits[0] : hits) ?? null, error: null };
          } else {
            const hits = tableRows.filter(matches).slice(0, limitN === Infinity ? undefined : limitN);
            result = { data: wantSingle === 'exact' ? hits[0] : wantSingle === 'maybe' ? (hits[0] ?? null) : hits, error: null };
          }
          calls.push({ table, op, body, filters: clone(filters) });
          resolve(result);
        } catch (err) {
          reject ? reject(err) : undefined;
        }
      },
    };
    self = new Proxy(builder, {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        // A chained method the harness does not model: remember the call but
        // keep the chain alive so handler queries degrade to full scans rather
        // than throwing.
        return (...args: any[]) => {
          calls.push({ table, op, body, filters: clone([...filters, ['chain', prop, args]]) });
          return self;
        };
      },
      set() {
        return true;
      },
    });
    return self;
  }

  return {
    from: makeTable,
    calls,
    rows,
  };
}

function makeDeps(db: FakeDb, options: { isMock?: boolean; mockRows?: any[] } = {}) {
  const mockRows = options.mockRows || [];
  return {
    db,
    isMock: options.isMock === true,
    hasAdminClient: true,
    getMockBookings: () => mockRows,
    getMockNotifications: () => [],
    addMockNotifications: () => undefined,
    resolveOwnerEmail: async () => 'owner@salon.com',
    now: () => NOW_MS,
  };
}

function liveDeps(db: FakeDb) {
  return makeDeps(db, { isMock: false });
}

function mockDeps(rows: any[]) {
  return makeDeps(null as any, { isMock: true, mockRows: rows });
}

function bookingRow(overrides: Record<string, any> = {}): any {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    owner_id: OWNER,
    user_id: ME,
    customer_name: 'Ananya Iyer',
    customer_email: 'ananya@example.com',
    customer_phone: '+91 98765 43210',
    service_name: 'Hair Spa',
    service_id: '33333333-3333-4333-8333-333333333333',
    booking_date: TODAY,
    time_slot: '11:00',
    status: 'confirmed',
    total_amount: 1200,
    advance_paid_amount: 0,
    payment_status: 'pending',
    metadata: {},
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function walletRow(overrides: Record<string, any> = {}): any {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    owner_id: OWNER,
    name: 'Ananya Iyer',
    email: 'ananya@example.com',
    phone: '+91 98765 43210',
    points: 100,
    lifetime_points: 500,
    total_visits: 3,
    last_visit: '2026-08-01',
    ...overrides,
  };
}

const profileWithDob = (dob: string) => ({ id: ME, email: 'ananya@example.com', salon_name: null, date_of_birth: dob });

const configRow = (overrides: Record<string, any> = {}) => ({
  owner_id: OWNER,
  program_enabled: true,
  points_per_visit: 10,
  points_per_hundred_spent: 10,
  birthday_bonus_points: 250,
  referral_bonus_points: 100,
  ...overrides,
});

function bookingsFor(db: FakeDb): any[] {
  return db.rows.bookings;
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

test('mock mode: check-in by booking id records the event and reports planned credits honestly', async () => {
  const row = bookingRow({ status: 'pending', metadata: { customer_date_of_birth: '1990-09-08' } });
  const rows = [row];
  const deps = mockDeps(rows);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: row.id }, params: {}, query: {} },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'mock');
  assert.equal(res.body.duplicate, false);
  assert.equal(res.body.data.checkedInAt.slice(0, 10), TODAY);
  const credits = res.body.data.credits || [];
  assert.equal(credits.length, 1, 'birthday credit planned (demo row carries a DOB)');
  assert.equal(credits[0].status, 'planned');
  assert.equal(credits[0].points, 250);
  const stored = rows[0];
  assert.equal(stored.metadata.check_ins.length, 1);
  assert.equal(stored.metadata.checkin_credits.length, 1);

  // A second check-in is a no-op: same event count, no new snapshot rows.
  const res2 = makeRes();
  await createBookingCheckinHandler(deps as any)({ body: { booking_id: row.id }, params: {}, query: {} }, res2);
  assert.equal(res2.statusCode, 200, JSON.stringify(res2.body));
  assert.equal(res2.body.duplicate, true);
  assert.equal(rows[0].metadata.check_ins.length, 1);
});

test('mock mode: code path resolves the customer id and refuses junk codes', async () => {
  const today = bookingRow({ status: 'confirmed', user_id: ME });
  const yesterday = bookingRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', booking_date: '2026-09-07', status: 'completed', user_id: OTHER });
  const rows = [today, yesterday];
  const deps = mockDeps(rows);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)({ body: { code: passCodeFor(ME) }, params: {}, query: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.booking.id, today.id);

  const resJunk = makeRes();
  await createBookingCheckinHandler(deps as any)({ body: { code: 'not-a-pass' }, params: {}, query: {} }, resJunk);
  assert.equal(resJunk.statusCode, 400);
  assert.equal(resJunk.body.code, 'invalid_code');
});

// ---------------------------------------------------------------------------
// Live mode — booking id path
// ---------------------------------------------------------------------------

test('live: check-in credits birthday + referral bonuses once, through the existing ledger', async () => {
  const db = makeDb({
    bookings: [
      bookingRow({
        metadata: { referral_code: 'NX-11111111', stylist_name: 'Neha' },
        payment_status: 'paid_deposit',
        advance_paid_amount: 240,
      }),
      bookingRow({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        user_id: REFERRER,
        customer_email: 'ref@example.com',
        customer_phone: '+91 90000 00001',
        booking_date: '2026-09-01',
        status: 'completed',
        metadata: {},
      }),
    ],
    profiles: [profileWithDob('1990-09-08')],
    loyalty_config: [configRow()],
    clients: [
      walletRow(),
      walletRow({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        name: 'The Referrer',
        email: 'ref@example.com',
        phone: '+91 90000 00001',
        points: 40,
        lifetime_points: 200,
      }),
    ],
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
    res
  );
  if (res.statusCode !== 200 && process.env.DEBUG_DB) console.error('[debug]', JSON.stringify(res.body), '\nCALLS:', JSON.stringify(db.calls, null, 1));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const credits = res.body.data.credits || [];
  assert.equal(credits.length, 2, JSON.stringify(credits));
  const birthday = credits.find((c: any) => c.kind === 'birthday');
  const referral = credits.find((c: any) => c.kind === 'referral');
  assert.equal(birthday?.status, 'credited');
  assert.equal(birthday?.points, 250);
  assert.equal(referral?.status, 'credited');
  assert.equal(referral?.points, 100);

  const txInserts = db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert');
  assert.equal(txInserts.length, 2);
  assert.ok(txInserts.every((call) => call.body.type === 'bonus'));
  const birthdayTx = txInserts.find((call) => call.body.client_id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const referralTx = txInserts.find((call) => call.body.client_id === 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.ok(birthdayTx, 'birthday ledger row on the CUSTOMER wallet');
  assert.equal(birthdayTx!.body.points_change, 250);
  assert.ok(referralTx, 'referral ledger row on the REFERRER wallet');
  assert.equal(referralTx!.body.points_change, 100);
  assert.match(referralTx!.body.description, /^Referral bonus/);

  const wallet = db.rows.clients.find((c: any) => c.id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(wallet.points, 350, 'customer wallet +250');
  assert.equal(wallet.lifetime_points, 750);

  // Booking snapshot: one event + two credit kinds.
  const stored = bookingsFor(db)[0];
  assert.equal(stored.metadata.check_ins.length, 1);
  assert.deepEqual(
    stored.metadata.checkin_credits.map((c: any) => c.kind).sort(),
    ['birthday', 'referral']
  );

  // Second check-in: duplicate, no new ledger rows.
  const before = db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert').length;
  const res2 = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
    res2
  );
  assert.equal(res2.statusCode, 200, JSON.stringify(res2.body));
  assert.equal(res2.body.duplicate, true);
  const after = db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert').length;
  assert.equal(after, before, 'no second credit on a repeated check-in');
});

test('live: no birthday when the day is not the DOB; no referral when there is no code', async () => {
  const db = makeDb({
    bookings: [bookingRow({ metadata: {} })],
    profiles: [profileWithDob('1990-01-02')],
    loyalty_config: [configRow()],
    clients: [walletRow()],
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((res.body.data.credits || []).length, 0);
  assert.equal(db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert').length, 0);
  assert.equal(bookingsFor(db)[0].metadata.check_ins.length, 1, 'the arrival itself is still recorded');
});

test('live: a due birthday without a customer wallet is skipped with a reason, and the visit still records', async () => {
  const db = makeDb({
    bookings: [bookingRow({ metadata: {} })],
    profiles: [profileWithDob('1990-09-08')],
    loyalty_config: [configRow()],
    clients: [], // no wallet for ananya@example.com at this salon
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const credits = res.body.data.credits || [];
  assert.equal(credits.length, 1);
  assert.equal(credits[0].status, 'skipped');
  assert.match(credits[0].reason, /no rewards wallet/i);
  assert.equal(db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert').length, 0);
  assert.equal(bookingsFor(db)[0].metadata.check_ins.length, 1);
  assert.deepEqual(bookingsFor(db)[0].metadata.checkin_credits, [], 'nothing credited, nothing snapshotted');
});

test('live: a paused rewards program records the check-in but never invents bonuses', async () => {
  const db = makeDb({
    bookings: [bookingRow({ metadata: { referral_code: 'NX-11111111' } })],
    profiles: [profileWithDob('1990-09-08')],
    loyalty_config: [configRow({ program_enabled: false })],
    clients: [walletRow()],
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert').length, 0);
  assert.ok(res.body.data.credits.every((c: any) => c.status === 'skipped'));
});

// ---------------------------------------------------------------------------
// Live mode — code path + guards
// ---------------------------------------------------------------------------

test('live: code path checks in the customer\u2019s open booking for today and needs an owner scope', async () => {
  const db = makeDb({
    bookings: [
      bookingRow({ status: 'pending', time_slot: '10:00' }),
      bookingRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', booking_date: '2026-09-07', status: 'confirmed', user_id: OTHER }),
    ],
    profiles: [profileWithDob('1990-01-01')],
    loyalty_config: [configRow()],
    clients: [walletRow()],
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { code: passCodeFor(ME) }, params: {}, query: { owner_id: OWNER } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.booking.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

  // No owner scope in live mode: refused before any data is read.
  const resNoScope = makeRes();
  await createBookingCheckinHandler(deps as any)({ body: { code: passCodeFor(ME) }, params: {}, query: {} }, resNoScope);
  assert.equal(resNoScope.statusCode, 400);
  assert.equal(resNoScope.body.code, 'owner_scope_required');
});

test('live: no open booking today answers 404 with a clear message', async () => {
  const db = makeDb({
    bookings: [bookingRow({ booking_date: '2026-09-10', status: 'confirmed' })],
    profiles: [],
    loyalty_config: [configRow()],
    clients: [],
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { code: passCodeFor(ME) }, params: {}, query: { owner_id: OWNER } },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'no_visit_today');
});

test('live: a completed or non-today booking is refused for check-in', async () => {
  for (const overrides of [
    { status: 'completed', booking_date: TODAY },
    { status: 'confirmed', booking_date: '2026-09-09' },
  ]) {
    const db = makeDb({
      bookings: [bookingRow(overrides)],
      profiles: [],
      loyalty_config: [configRow()],
      clients: [],
      loyalty_point_transactions: [],
    });
    const deps = liveDeps(db);
    const res = makeRes();
    await createBookingCheckinHandler(deps as any)(
      { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
      res
    );
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'not_checkinable');
  }
});

test('live: a booking carrying its own referral code never credits the customer as their own referrer', async () => {
  const selfCode = `NX-${String(ME).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)}`;
  const db = makeDb({
    bookings: [bookingRow({ metadata: { referral_code: selfCode } })],
    profiles: [profileWithDob('1990-01-01')],
    loyalty_config: [configRow()],
    clients: [walletRow()],
    loyalty_point_transactions: [],
  });
  const deps = liveDeps(db);
  const res = makeRes();
  await createBookingCheckinHandler(deps as any)(
    { body: { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, params: {}, query: { owner_id: OWNER } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const referral = (res.body.data.credits || []).find((c: any) => c.kind === 'referral');
  assert.ok(referral, 'referral credit reported');
  assert.equal(referral.status, 'skipped');
  assert.match(referral.reason, /own referral code/);
  assert.equal(db.calls.filter((call) => call.table === 'loyalty_point_transactions' && call.op === 'insert').length, 0);
});
