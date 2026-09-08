import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  validateBookingPayload,
  resolveBookingOwnerId,
  describeDbError,
  createBookingHandler,
} from '../server/bookingCreate';
import { authenticateBookingRequest } from '../server/bookingAuth';
import { sanitizeBookingRow } from '../server/bookingOps';
import { toBookingDetailView } from '../src/lib/bookingDetail';
import { toCustomerBookingCard } from '../src/lib/bookingTabs';

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
  hasAdminClient: true,
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

test('validateBookingPayload rejects impossible calendar dates, not just bad formatting', () => {
  for (const booking_date of ['2026-02-29', '2026-04-31', '2026-13-01']) {
    const bad = validateBookingPayload({ ...VALID_BOOKING, booking_date });
    assert.equal(bad.valid, false, booking_date);
    assert.ok(bad.fieldErrors.booking_date, booking_date);
  }
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
// Authentication gate + handler
// ============================================================================

test('booking auth rejects a missing bearer token with a JSON-safe 401 result', async () => {
  const result = await authenticateBookingRequest({ headers: {} }, Date.now() + 1000, true);
  assert.deepEqual(result, {
    ok: false,
    status: 401,
    code: 'auth_required',
    error: 'Please sign in or create an account before booking an appointment.',
  });
});

test('local/mock booking auth accepts only the explicit namespaced mock token', async () => {
  const rejected = await authenticateBookingRequest(
    { headers: { authorization: 'Bearer forged-user-id' } },
    Date.now() + 1000,
    true
  );
  assert.equal(rejected.ok, false);
  const accepted = await authenticateBookingRequest(
    { headers: { authorization: 'Bearer mock:customer-1' } },
    Date.now() + 1000,
    true
  );
  assert.deepEqual(accepted, { ok: true, user: { id: 'customer-1' } });
});

test('the handler authenticates before payment verification or database work', async () => {
  const { db, calls } = makeDb({});
  const handler = createBookingHandler(
    baseDeps({
      db,
      isMock: true,
      authenticateUser: async () => ({
        ok: false,
        status: 401,
        code: 'auth_required',
        error: 'Please sign in or create an account before booking an appointment.',
      }),
    })
  );
  const res = makeRes();
  await handler(
    {
      body: {
        booking: VALID_BOOKING,
        payment: { razorpay_payment_id: 'pay_should_not_be_verified', razorpay_signature: 'forged' },
      },
      headers: {},
    },
    res
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'auth_required');
  assert.equal(calls.length, 0, 'unauthenticated requests must not touch the database');
});

test('an authenticated customer can complete the normal mock booking path', async () => {
  const stored: any[] = [];
  const handler = createBookingHandler(
    baseDeps({
      isMock: true,
      addMockBooking: (row: any) => stored.push(row),
      authenticateUser: async () => ({ ok: true, user: { id: 'customer-1', email: 'customer@example.com' } }),
    })
  );
  const res = makeRes();
  await handler({ body: { booking: { ...VALID_BOOKING, customer_email: '' } }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].customer_email, 'customer@example.com');
  assert.equal(stored[0].user_id, null);
  assert.equal(stored[0].metadata.user_id, 'customer-1');
});

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

test('a live entrypoint without a service-role client answers JSON 503 before payment/database work', async () => {
  const handler = createBookingHandler(baseDeps({ isMock: false, hasAdminClient: false }));
  const res = makeRes();
  await handler({ body: { booking: VALID_BOOKING }, headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'supabase_not_configured');
  assert.equal(res.body.retryable, true);
  assert.equal(res.body.success, false);
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

test('an unverified payment claim cannot mark a booking paid when the gateway is unavailable', async () => {
  const previous = {
    id: process.env.RAZORPAY_KEY_ID,
    secret: process.env.RAZORPAY_KEY_SECRET,
    mock: process.env.RAZORPAY_MOCK_MODE,
  };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  // No keys + mock explicitly off = the gateway is DISABLED (what a
  // production deployment without credentials looks like).
  process.env.RAZORPAY_MOCK_MODE = 'false';
  try {
    const stored: any[] = [];
    const handler = createBookingHandler(baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r) }));
    const res = makeRes();
    await handler(
      {
        body: {
          booking: { ...VALID_BOOKING, payment_status: 'paid_deposit', advance_paid_amount: 188 },
          payment: { razorpay_order_id: 'order_unverified', razorpay_payment_id: 'pay_unverified', razorpay_signature: 'missing' },
        },
        headers: {},
      },
      res
    );
    assert.equal(res.body.success, true);
    assert.equal(res.body.paymentVerified, false);
    assert.equal(stored[0].payment_status, 'pending');
    assert.equal(stored[0].advance_paid_amount, 0);
  } finally {
    if (previous.id === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = previous.id;
    if (previous.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = previous.secret;
    if (previous.mock === undefined) delete process.env.RAZORPAY_MOCK_MODE;
    else process.env.RAZORPAY_MOCK_MODE = previous.mock;
  }
});

/** Run `fn` with RAZORPAY_* overridden, restoring the previous values after. */
async function withRazorpayEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const NO_KEYS_MOCK_ENV = {
  RAZORPAY_KEY_ID: undefined,
  RAZORPAY_KEY_SECRET: undefined,
  VITE_RAZORPAY_KEY_ID: undefined,
  RAZORPAY_MOCK_MODE: undefined,
  RAZORPAY_MOCK_SECRET: undefined,
  NODE_ENV: 'test',
  VERCEL_ENV: undefined,
};

test('mock gateway (no keys, non-production): a forged payment claim is rejected, nothing stored', async () => {
  await withRazorpayEnv(NO_KEYS_MOCK_ENV, async () => {
    const stored: any[] = [];
    const handler = createBookingHandler(baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r) }));
    const res = makeRes();
    await handler(
      {
        body: {
          booking: { ...VALID_BOOKING, payment_status: 'paid_deposit', advance_paid_amount: 188 },
          payment: { razorpay_order_id: 'order_mock_AAAAAAAAAAAAAA', razorpay_payment_id: 'pay_mock_forged', razorpay_signature: 'forged' },
        },
        headers: {},
      },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'payment_unverified');
    assert.equal(stored.length, 0);
  });
});

test('mock gateway: a payment signed by /mock-pay verifies and marks the booking paid_deposit (paymentMode=mock)', async () => {
  await withRazorpayEnv(NO_KEYS_MOCK_ENV, async () => {
    const { createMockOrder, signMockPayment } = await import('../server/razorpay');
    const order = createMockOrder({ amount: 87, receipt: 'NX-BLR-10001' });
    assert.equal(order.amount, 8700, '₹87 must become 8700 paise');
    const signed = signMockPayment(order.id);

    const stored: any[] = [];
    const handler = createBookingHandler(baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r) }));
    const res = makeRes();
    await handler(
      {
        body: {
          booking: { ...VALID_BOOKING, total_amount: 348, advance_paid_amount: 87, payment_status: 'pending', payment_id: 'NX-BLR-10001' },
          payment: signed,
        },
        headers: {},
      },
      res
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.paymentVerified, true);
    assert.equal(res.body.paymentMode, 'mock');
    assert.equal(stored[0].payment_status, 'paid_deposit');
    assert.equal(stored[0].advance_paid_amount, 87);
    assert.equal(stored[0].payment_id, signed.razorpay_payment_id);
  });
});

test('a mock-signed payment is refused once real Razorpay keys are configured', async () => {
  await withRazorpayEnv(
    { ...NO_KEYS_MOCK_ENV, RAZORPAY_KEY_ID: 'rzp_test_TIzKly1Z2NMnum', RAZORPAY_KEY_SECRET: 'test_secret_value_123' },
    async () => {
      const { createMockOrder, signMockPayment } = await import('../server/razorpay');
      const order = createMockOrder({ amount: 87 });
      const signed = signMockPayment(order.id);
      const stored: any[] = [];
      const handler = createBookingHandler(baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r) }));
      const res = makeRes();
      await handler({ body: { booking: VALID_BOOKING, payment: signed }, headers: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'payment_unverified');
      assert.equal(stored.length, 0);
    }
  );
});

function capturedGateway(overrides: Record<string, unknown> = {}) {
  return {
    async fetchPayment(paymentId: string) {
      return {
        id: paymentId,
        orderId: 'order_9',
        amountRupees: 188,
        amountPaidRupees: 188,
        status: 'captured',
        currency: 'INR',
        captured: true,
        method: 'card',
        ...overrides,
      };
    },
  };
}

test('a genuine Razorpay payment is paid_deposit only after capture and amount match', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_value_123';
  try {
    const signature = crypto
      .createHmac('sha256', 'test_secret_value_123')
      .update('order_9|pay_9')
      .digest('hex');
    const stored: any[] = [];
    const handler = createBookingHandler(
      baseDeps({ isMock: true, addMockBooking: (r: any) => stored.push(r), gateway: capturedGateway() })
    );
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
    assert.equal(stored[0].advance_paid_amount, 188, 'the stored advance is the gateway amount, not a client claim');
  } finally {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('a valid checkout signature is not paid when Razorpay has not captured the payment', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_value_123';
  try {
    const signature = crypto
      .createHmac('sha256', 'test_secret_value_123')
      .update('order_9|pay_9')
      .digest('hex');
    const stored: any[] = [];
    const handler = createBookingHandler(
      baseDeps({
        isMock: true,
        addMockBooking: (r: any) => stored.push(r),
        gateway: capturedGateway({ status: 'authorized', captured: false, amountPaidRupees: 0 }),
      })
    );
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
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'payment_not_captured');
    assert.equal(stored.length, 0, 'an authorized-but-uncaptured payment must not create a paid booking');
  } finally {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('a captured payment for the wrong amount is not marked paid', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_value_123';
  try {
    const signature = crypto
      .createHmac('sha256', 'test_secret_value_123')
      .update('order_9|pay_9')
      .digest('hex');
    const stored: any[] = [];
    const handler = createBookingHandler(
      baseDeps({
        isMock: true,
        addMockBooking: (r: any) => stored.push(r),
        gateway: capturedGateway({ amountRupees: 1, amountPaidRupees: 1 }),
      })
    );
    const res = makeRes();
    await handler(
      {
        body: {
          booking: { ...VALID_BOOKING, payment_status: 'pending', advance_paid_amount: 188 },
          payment: { razorpay_order_id: 'order_9', razorpay_payment_id: 'pay_9', razorpay_signature: signature },
        },
        headers: {},
      },
      res
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'payment_amount_mismatch');
    assert.equal(stored.length, 0);
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

// ============================================================================
// Display details for the customer's "My Bookings" cards.
//
// `bookings` has no salon or specialist column, so the cards read them from
// `metadata`. `sanitizeBookingRow` deliberately DROPS unknown top-level keys
// (that is what stops a renamed field from a newer build breaking the insert),
// so these two must travel inside `metadata` — routing them as top-level keys
// silently blanks the salon name and specialist on every card.
// ============================================================================

test('stylist_name and salon_name reach metadata instead of being dropped', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    stylist_name: 'Ananya',
    salon_name: 'Luxe Salon',
  });
  assert.equal(result.valid, true);
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  assert.equal(row.metadata.stylist_name, 'Ananya');
  assert.equal(row.metadata.salon_name, 'Luxe Salon');
  // The customer id fallback lives in the same object and must survive.
  assert.equal(row.metadata.user_id, 'mock-user-1');
});

test('omitting them leaves no metadata rather than an empty object', () => {
  const result = validateBookingPayload({ ...VALID_BOOKING });
  assert.equal(result.valid, true);
  assert.equal(result.value.metadata, undefined);
});

test('a caller-supplied metadata blob is not passed through wholesale', () => {
  // Otherwise a client could award itself a review for a visit that never
  // happened, or overwrite the verified customer id.
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    metadata: { review_rating: 5, user_id: 'someone-else', stylist_name: 'Injected' },
  });
  assert.equal(result.valid, true);
  assert.equal(result.value.metadata?.review_rating, undefined);
  assert.equal(result.value.metadata?.user_id, undefined);
  assert.equal(result.value.metadata?.stylist_name, undefined);
});

test('an unknown top-level key is still dropped after the metadata change', () => {
  const result = validateBookingPayload({ ...VALID_BOOKING });
  const row = sanitizeBookingRow({ ...result.value, some_column_from_a_newer_build: 'x' });
  assert.ok(!('some_column_from_a_newer_build' in row));
});

// ---------------------------------------------------------------------------
// Customer note and add-ons — the two detail-page fields with no column each
// ---------------------------------------------------------------------------

test('the customer note reaches the row that is inserted', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    notes: 'Sensitive scalp, please use the mild shampoo',
  });
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  assert.equal(row.notes, 'Sensitive scalp, please use the mild shampoo');
});

test('a long note is capped rather than stored verbatim', () => {
  const result = validateBookingPayload({ ...VALID_BOOKING, notes: 'x'.repeat(5000) });
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  assert.equal(row.notes.length, 500);
});

test('an empty or whitespace note is not stored', () => {
  for (const notes of ['', '   ']) {
    const result = validateBookingPayload({ ...VALID_BOOKING, notes });
    const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
    assert.ok(!('notes' in row), JSON.stringify(notes));
  }
});

test('add-ons survive sanitizeBookingRow, which keeps only shallow primitives', () => {
  // safeMetadataObject drops nested objects and arrays outright (the one
  // deliberate exception is the structured `metadata.services` key), so an
  // array of {name, price} objects would vanish here and the detail page would
  // show only the primary service. Pinning the round trip is what stops that
  // regressing for the legacy add-ons path.
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_addons: [
      { name: 'Head Massage', price: 300, duration: 15 },
      { name: 'Deep Conditioning', price: 500, duration: 20 },
    ],
  });
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  assert.equal(row.metadata.service_addons, 'Head Massage, Deep Conditioning');
});

test('a comma inside an add-on name cannot be read back as a separator', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_addons: [{ name: 'Cut, Blow and Style' }, { name: 'Head Massage' }],
  });
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  assert.equal(row.metadata.service_addons, 'Cut Blow and Style, Head Massage');
});

test('add-ons that are not usable produce no metadata key', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_addons: [{ price: 300 }, { name: '  ' }, null],
  });
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  assert.equal(row.metadata?.service_addons, undefined);
});

test('a persisted booking reads back as every service the customer picked', () => {
  // The full path: client payload -> validated value -> sanitized row -> the
  // view model the detail page renders.
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_name: 'Master Stylist Precision Cut',
    stylist_name: 'Ananya',
    salon_name: 'Luxe Salon',
    notes: 'Ring the bell',
    service_addons: [{ name: 'Head Massage', price: 300 }],
  });
  const stored = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  const view = toBookingDetailView({ row: stored });
  assert.deepEqual(view.services, ['Master Stylist Precision Cut', 'Head Massage']);
  assert.equal(view.staffName, 'Ananya');
  assert.equal(view.salonName, 'Luxe Salon');
  assert.equal(view.customerNote, 'Ring the bell');
});

// ---------------------------------------------------------------------------
// Structured multi-service lines — bookings.metadata.services
// ---------------------------------------------------------------------------

test('structured service lines are stored under metadata.services with a derived parent row', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_id: 'hs-1',
    service_name: 'Master Stylist Precision Cut',
    services: [
      { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
      { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
      { service_id: 'hs-4', name: 'Full Set Gel-X Nails', price: 2400, duration_minutes: 90 },
    ],
    total_amount: 8350,
    advance_paid_amount: 2088,
  });
  assert.ok(result.valid, result.errors.join(' '));
  const row = sanitizeBookingRow({ ...result.value, user_id: 'mock-user-1' });
  // Parent row follows the customer-app convention: first id + joined names.
  assert.equal(row.metadata.service_id, 'hs-1');
  assert.equal(
    row.service_name,
    'Master Stylist Precision Cut + Signature Caramel Balayage + Full Set Gel-X Nails'
  );
  assert.deepEqual(row.metadata.services, [
    { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
    { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
    { service_id: 'hs-4', name: 'Full Set Gel-X Nails', price: 2400, duration_minutes: 90 },
  ]);
  assert.equal(row.metadata.duration_minutes, 285);
});

test('the parent service_name is rebuilt from the lines when the scalar only names the primary', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_name: 'Master Stylist Precision Cut',
    service_id: 'hs-1',
    services: [
      { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
      { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
    ],
  });
  assert.ok(result.valid, result.errors.join(' '));
  assert.equal(result.value.service_name, 'Master Stylist Precision Cut + Signature Caramel Balayage');
  assert.equal(result.value.service_id, 'hs-1');
  assert.deepEqual(result.value.metadata.services, [
    { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
    { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
  ]);
  assert.equal(result.value.metadata.duration_minutes, 195);
});

test('services alone satisfy the service requirement when no service_name is sent', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_name: '',
    services: [{ service_id: 'hs-1', name: 'Hair Spa', price: 1200, duration_minutes: 60 }],
  });
  assert.ok(result.valid, result.errors.join(' '));
  assert.equal(result.value.service_name, 'Hair Spa');
});

test('service lines accept camelCase keys and unit_price, and drop unusable entries', () => {
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    services: [
      { serviceId: 'hs-1', service_name: 'Master Stylist Precision Cut', unit_price: 750, durationMinutes: 45 },
      // No id: kept by name, priced zero like the customer-app fallback path.
      { name: 'Head Massage', price: 300, duration_minutes: 15 },
      null,
      5,
      { name: '   ' },
    ],
  });
  assert.ok(result.valid, result.errors.join(' '));
  assert.deepEqual(result.value.metadata.services, [
    { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
    { service_id: '', name: 'Head Massage', price: 300, duration_minutes: 15 },
  ]);
  assert.equal(result.value.metadata.duration_minutes, 60);
});

test('a multi-service booking reads back as every service in detail and on the card', () => {
  // The full path: client payload -> validated value -> sanitized row -> the
  // view models the detail page and "My Bookings" cards render.
  const result = validateBookingPayload({
    ...VALID_BOOKING,
    service_name: 'Master Stylist Precision Cut',
    salon_name: 'Arts By Uma',
    stylist_name: 'Ananya',
    services: [
      { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
      { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
    ],
    total_amount: 5950,
    advance_paid_amount: 1488,
  });
  const stored = sanitizeBookingRow({ ...result.value, id: 'mock-bk-1', user_id: 'mock-user-1' });
  const view = toBookingDetailView({ row: stored });
  assert.deepEqual(view.services, ['Master Stylist Precision Cut', 'Signature Caramel Balayage']);
  const card = toCustomerBookingCard(stored, Date.now());
  assert.equal(card.serviceName, 'Master Stylist Precision Cut + Signature Caramel Balayage');
});

test('an authenticated mock booking with several services stores the structured lines', async () => {
  const stored: any[] = [];
  const handler = createBookingHandler(
    baseDeps({
      isMock: true,
      addMockBooking: (row: any) => stored.push(row),
      authenticateUser: async () => ({ ok: true, user: { id: 'customer-1' } }),
    })
  );
  const res = makeRes();
  await handler(
    {
      body: {
        booking: {
          ...VALID_BOOKING,
          services: [
            { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
            { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
          ],
          total_amount: 5950,
        },
        notifications: [],
      },
      headers: {},
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(stored.length, 1);
  const row = stored[0];
  assert.equal(row.service_name, 'Master Stylist Precision Cut + Signature Caramel Balayage');
  assert.equal(row.metadata.services.length, 2);
  assert.equal(row.metadata.services[1].price, 5200);
  assert.equal(row.metadata.duration_minutes, 195);
});
