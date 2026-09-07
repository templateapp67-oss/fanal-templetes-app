import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  validateBookingPayload,
  resolveBookingOwnerId,
  describeDbError,
  createBookingHandler,
} from '../server/bookingCreate';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const OTHER_OWNER = '3f0d9a2e-5c4b-4a1d-8b7e-11223344aabb';

const VALID_BOOKING = {
  customer_name: 'Riya Sharma',
  customer_phone: '9845012345',
  customer_email: 'riya@example.com',
  service_id: 'hs-1',
  service_name: 'Master Stylist Precision Cut',
  booking_date: '2026-10-02',
  time_slot: '11:30',
  total_amount: 750,
  advance_paid_amount: 188,
  status: 'pending',
  payment_status: 'paid_deposit',
  payment_id: 'NX-BLR-12345',
};

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

/**
 * Chainable Supabase-client double. `tables` maps a table name to the result
 * of the terminal call, so a test can make an insert fail with a real
 * Postgres error shape.
 */
function makeDb(tables: Record<string, any>) {
  const calls: any[] = [];
  const builder = (table: string) => {
    const state: any = { table, filters: {} as Record<string, any>, op: 'select' };
    const api: any = {
      select() {
        return api;
      },
      insert(rows: any) {
        state.op = 'insert';
        state.rows = rows;
        calls.push({ table, op: 'insert', rows });
        const spec = tables[table] ?? {};
        const result = spec.insert ?? { data: Array.isArray(rows) ? rows[0] : rows, error: null };
        // `insert()` is awaited directly for notifications, and
        // `.select().single()` for bookings — support both.
        return Object.assign(Promise.resolve(result), {
          select: () => ({ single: async () => result, maybeSingle: async () => result }),
        });
      },
      eq(column: string, value: any) {
        state.filters[column] = value;
        return api;
      },
      limit(n: number) {
        const spec = tables[table] ?? {};
        calls.push({ table, op: 'limit', n });
        return Promise.resolve(spec.list ?? { data: [], error: null });
      },
      async maybeSingle() {
        const spec = tables[table] ?? {};
        calls.push({ table, op: 'maybeSingle', filters: { ...state.filters } });
        if (typeof spec.lookup === 'function') return spec.lookup(state.filters);
        return { data: null, error: null };
      },
      async single() {
        const spec = tables[table] ?? {};
        return spec.insert ?? { data: null, error: null };
      },
    };
    return api;
  };
  return { db: { from: builder }, calls };
}

const baseDeps = (overrides: any = {}) => ({
  db: makeDb({}).db,
  isMock: false,
  addMockBooking: () => {},
  addMockNotifications: () => {},
  resolveOwnerEmail: async () => 'owner@salon.com',
  ...overrides,
});

// ============================================================================
// validateBookingPayload — bad details must become a readable 400, not a 500
// ============================================================================

test('validateBookingPayload accepts a complete booking and normalizes it', () => {
  const result = validateBookingPayload(VALID_BOOKING);
  assert.ok(result.valid, result.errors.join(' '));
  assert.equal(result.value.customer_phone, '+919845012345');
  assert.equal(result.value.total_amount, 750);
  assert.equal(result.value.status, 'pending');
});

test('validateBookingPayload reports every missing required field', () => {
  const result = validateBookingPayload({});
  assert.ok(!result.valid);
  assert.ok(result.fieldErrors.customer_name);
  assert.ok(result.fieldErrors.customer_phone);
  assert.ok(result.fieldErrors.service_name);
  assert.ok(result.fieldErrors.booking_date);
  assert.ok(result.fieldErrors.time_slot);
});

test('validateBookingPayload catches malformed dates, emails and amounts', () => {
  const bad = validateBookingPayload({
    ...VALID_BOOKING,
    booking_date: '02-10-2026',
    customer_email: 'not-an-email',
    total_amount: 'free',
  });
  assert.ok(!bad.valid);
  assert.ok(bad.fieldErrors.booking_date);
  assert.ok(bad.fieldErrors.customer_email);
  assert.ok(bad.fieldErrors.total_amount);
});

test('validateBookingPayload rejects an advance larger than the total', () => {
  const bad = validateBookingPayload({ ...VALID_BOOKING, total_amount: 500, advance_paid_amount: 900 });
  assert.ok(!bad.valid);
  assert.match(bad.fieldErrors.advance_paid_amount, /greater than the total/);
});

test('validateBookingPayload falls back to schema defaults for unknown enums', () => {
  const result = validateBookingPayload({ ...VALID_BOOKING, status: 'weird', payment_status: 'weird' });
  assert.ok(result.valid);
  assert.equal(result.value.status, 'pending');
  assert.equal(result.value.payment_status, 'pending');
});

// ============================================================================
// resolveBookingOwnerId — bookings.owner_id is NOT NULL (the 500's root cause)
// ============================================================================

test('owner id comes from the payload when it is a uuid', async () => {
  const { db } = makeDb({});
  const res = await resolveBookingOwnerId({ db, isMock: false, explicitOwnerId: OWNER });
  assert.deepEqual(res, { ownerId: OWNER, source: 'payload' });
});

test('a non-uuid owner id from a template preview falls through to the subdomain lookup', async () => {
  const { db } = makeDb({
    profiles: { lookup: (f: any) => ({ data: f.subdomain === 'arts-by-uma' ? { id: OWNER } : null, error: null }) },
  });
  const res = await resolveBookingOwnerId({
    db,
    isMock: false,
    explicitOwnerId: 'owner@salon.com',
    subdomain: 'arts-by-uma',
  });
  assert.deepEqual(res, { ownerId: OWNER, source: 'subdomain' });
});

test('owner id is resolved from the notification owner email when there is no subdomain', async () => {
  const { db } = makeDb({
    profiles: { lookup: (f: any) => ({ data: f.email === 'hello@artsbyuma.com' ? { id: OWNER } : null, error: null }) },
  });
  const res = await resolveBookingOwnerId({ db, isMock: false, ownerEmail: 'hello@artsbyuma.com' });
  assert.deepEqual(res, { ownerId: OWNER, source: 'owner-email' });
});

test('DEFAULT_OWNER_ID is used when nothing else matches', async () => {
  const { db } = makeDb({ profiles: { lookup: () => ({ data: null, error: null }) } });
  const res = await resolveBookingOwnerId({
    db,
    isMock: false,
    subdomain: 'unknown-salon',
    env: { DEFAULT_OWNER_ID: OWNER } as any,
  });
  assert.deepEqual(res, { ownerId: OWNER, source: 'env' });
});

test('a single-salon deployment resolves its only profile', async () => {
  const { db } = makeDb({
    profiles: { lookup: () => ({ data: null, error: null }), list: { data: [{ id: OWNER }], error: null } },
  });
  const res = await resolveBookingOwnerId({ db, isMock: false, env: {} as any });
  assert.deepEqual(res, { ownerId: OWNER, source: 'sole-profile' });
});

test('multiple profiles without a hint stay unresolved instead of guessing', async () => {
  const { db } = makeDb({
    profiles: { lookup: () => ({ data: null, error: null }), list: { data: [{ id: OWNER }, { id: OTHER_OWNER }], error: null } },
  });
  const res = await resolveBookingOwnerId({ db, isMock: false, env: {} as any });
  assert.deepEqual(res, { ownerId: null, source: 'unresolved' });
});

// ============================================================================
// describeDbError — Postgres codes become actionable HTTP answers
// ============================================================================

test('describeDbError maps known Postgres failures away from a bare 500', () => {
  assert.equal(describeDbError({ code: '23502', message: 'null value in column "owner_id"' }).status, 422);
  assert.equal(describeDbError({ code: '23503', message: 'fk violation' }).status, 422);
  assert.equal(describeDbError({ code: '22P02', message: 'invalid input syntax for type date' }).status, 400);
  assert.equal(describeDbError({ code: '42501', message: 'permission denied' }).status, 500);
  assert.match(describeDbError({ code: '42501', message: 'permission denied' }).message, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(describeDbError({ message: 'boom' }).status, 500);
});

test('describeDbError maps a duplicate key to 409 instead of a 500', () => {
  const mapped = describeDbError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "bookings_payment_id_key"',
  });
  assert.equal(mapped.status, 409);
  assert.match(mapped.message, /already exists/);
});

// ============================================================================
// The handler
// ============================================================================

test('handler answers 400 with field errors for an incomplete booking', async () => {
  const handler = createBookingHandler(baseDeps());
  const res = makeRes();
  await handler({ body: { booking: { customer_name: '' } }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_booking');
  assert.ok(res.body.fieldErrors.customer_name);
});

test('handler answers 400 when no booking object is sent at all', async () => {
  const handler = createBookingHandler(baseDeps());
  const res = makeRes();
  await handler({ body: {}, headers: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('handler answers 422 (not 500) when the salon has no owner account', async () => {
  const { db } = makeDb({
    profiles: { lookup: () => ({ data: null, error: null }), list: { data: [], error: null } },
  });
  const handler = createBookingHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { booking: VALID_BOOKING }, headers: {} }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'owner_unresolved');
});

test('handler stores the booking and returns the row in live mode', async () => {
  const { db, calls } = makeDb({
    profiles: { lookup: () => ({ data: { id: OWNER }, error: null }) },
    bookings: { insert: { data: { id: 'bk-1', owner_id: OWNER, ...VALID_BOOKING }, error: null } },
    in_app_notifications: { insert: { data: null, error: null } },
  });
  const handler = createBookingHandler(baseDeps({ db }));
  const res = makeRes();
  await handler(
    {
      body: {
        booking: { ...VALID_BOOKING, owner_id: null },
        notifications: [{ user_email: 'hello@artsbyuma.com', title: 'New Booking', message: 'x' }],
      },
      headers: {},
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.id, 'bk-1');

  const bookingInsert = calls.find((c) => c.table === 'bookings' && c.op === 'insert');
  assert.ok(bookingInsert, 'a booking row must be inserted');
  assert.equal(bookingInsert.rows[0].owner_id, OWNER, 'the NOT NULL owner_id must be filled in');
  assert.equal(bookingInsert.rows[0].service_id, null, 'template service ids are not uuids and must be nulled');
  assert.ok(calls.some((c) => c.table === 'in_app_notifications' && c.op === 'insert'));
});

test('a failed notification insert never fails an accepted booking', async () => {
  const { db } = makeDb({
    profiles: { lookup: () => ({ data: null, error: null }), list: { data: [{ id: OWNER }], error: null } },
    bookings: { insert: { data: { id: 'bk-2', owner_id: OWNER }, error: null } },
    in_app_notifications: { insert: { data: null, error: { message: 'notif table missing' } } },
  });
  const handler = createBookingHandler(baseDeps({ db }));
  const res = makeRes();
  await handler(
    { body: { booking: VALID_BOOKING, notifications: [{ title: 'x', message: 'y' }] }, headers: {} },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

test('a NOT NULL violation surfaces as a readable 422 instead of HTTP 500', async () => {
  const { db } = makeDb({
    profiles: { lookup: () => ({ data: null, error: null }), list: { data: [{ id: OWNER }], error: null } },
    bookings: {
      insert: {
        data: null,
        error: { code: '23502', message: 'null value in column "customer_name" violates not-null constraint' },
      },
    },
  });
  const handler = createBookingHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { booking: VALID_BOOKING }, headers: {} }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /required booking field/i);
});

test('a duplicate-key violation surfaces as a readable 409 instead of HTTP 500', async () => {
  const { db } = makeDb({
    profiles: { lookup: () => ({ data: null, error: null }), list: { data: [{ id: OWNER }], error: null } },
    bookings: {
      insert: {
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "bookings_payment_id_key"',
        },
      },
    },
  });
  const handler = createBookingHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { booking: VALID_BOOKING }, headers: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, '23505');
  assert.match(res.body.error, /already exists/);
});

test('mock mode keeps working without a database', async () => {
  const stored: any[] = [];
  const notes: any[] = [];
  const handler = createBookingHandler(
    baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r), addMockNotifications: (r: any[]) => notes.push(...r) })
  );
  const res = makeRes();
  await handler({ body: { booking: VALID_BOOKING, notifications: [{ title: 't', message: 'm' }] }, headers: {} }, res);
  assert.equal(res.body.success, true);
  assert.equal(stored.length, 1);
  assert.equal(notes.length, 1);
});

test('an unverifiable Razorpay payment is rejected before anything is stored', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_value_123';
  try {
    const stored: any[] = [];
    const handler = createBookingHandler(baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r) }));
    const res = makeRes();
    await handler(
      {
        body: {
          booking: VALID_BOOKING,
          payment: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' },
        },
        headers: {},
      },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'payment_unverified');
    assert.equal(stored.length, 0);
  } finally {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('a genuine Razorpay payment marks the booking as paid_deposit', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_value_123';
  try {
    const signature = crypto
      .createHmac('sha256', 'test_secret_value_123')
      .update('order_9|pay_9')
      .digest('hex');
    const stored: any[] = [];
    const handler = createBookingHandler(baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r) }));
    const res = makeRes();
    await handler(
      {
        body: {
          booking: { ...VALID_BOOKING, payment_status: 'pending' },
          payment: { razorpay_order_id: 'order_9', razorpay_payment_id: 'pay_9', razorpay_signature: signature },
        },
        headers: {},
      },
      res
    );
    assert.equal(res.body.success, true);
    assert.equal(res.body.paymentVerified, true);
    assert.equal(stored[0].payment_status, 'paid_deposit');
    assert.equal(stored[0].payment_id, 'pay_9');
  } finally {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('the tenant host is used to resolve the owner when the client sends none', async () => {
  const seen: any[] = [];
  const { db } = makeDb({
    profiles: {
      lookup: (f: any) => {
        seen.push(f);
        return { data: f.subdomain === 'glamour-lounge' ? { id: OWNER } : null, error: null };
      },
    },
    bookings: { insert: { data: { id: 'bk-3', owner_id: OWNER }, error: null } },
  });
  const handler = createBookingHandler(baseDeps({ db }));
  const res = makeRes();
  await handler({ body: { booking: VALID_BOOKING }, headers: { host: 'glamour-lounge.nexora.in' } }, res);
  assert.equal(res.body.success, true);
  assert.ok(seen.some((f) => f.subdomain === 'glamour-lounge'));
});
