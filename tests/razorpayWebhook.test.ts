import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  readWebhookSecret,
  isWebhookConfigured,
  verifyWebhookSignature,
  extractWebhookFacts,
  createRazorpayWebhookHandler,
  HANDLED_EVENTS,
} from '../server/razorpayWebhook';

const SECRET = 'C9EWXhp3cHnow4oUGIzeCTIXzbmswV3Y';
const BOOKING_REF = 'NX-JPR-40213';

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

/** Build a signed request exactly the way Razorpay does. */
function signedRequest(body: any, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { headers: { 'x-razorpay-signature': signature }, rawBody: raw, body };
}

const paymentCaptured = (overrides: any = {}) => ({
  entity: 'event',
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_RkAbc123456789',
        order_id: 'order_RkXyz987654321',
        amount: 18800,
        currency: 'INR',
        status: 'captured',
        notes: { booking_ref: BOOKING_REF },
        ...overrides,
      },
    },
  },
});

function makeDb(state: { bookings: any[]; failUpdate?: boolean; failSelect?: boolean }) {
  const updates: any[] = [];
  const notifications: any[] = [];
  return {
    updates,
    notifications,
    db: {
      from(table: string) {
        const api: any = {
          _filterIds: [] as string[],
          select() {
            return api;
          },
          in(_col: string, ids: string[]) {
            api._filterIds = ids;
            return api;
          },
          limit() {
            if (state.failSelect) return Promise.resolve({ data: null, error: { message: 'db down' } });
            const found = state.bookings.filter((b) => api._filterIds.includes(b.payment_id));
            return Promise.resolve({ data: found.slice(0, 1), error: null });
          },
          update(changes: any) {
            return {
              eq(_col: string, id: string) {
                updates.push({ id, changes });
                if (!state.failUpdate) {
                  const row = state.bookings.find((b) => b.id === id);
                  if (row) Object.assign(row, changes);
                }
                return Promise.resolve({ error: state.failUpdate ? { message: 'update denied' } : null });
              },
            };
          },
          insert(rows: any) {
            if (table === 'in_app_notifications') notifications.push(...(Array.isArray(rows) ? rows : [rows]));
            return Promise.resolve({ data: rows, error: null });
          },
        };
        return api;
      },
    },
  };
}

const deps = (over: any = {}) => ({
  db: makeDb({ bookings: [] }).db,
  isMock: false,
  getMockBookings: () => [],
  addMockNotifications: () => {},
  resolveOwnerEmail: async () => 'owner@salon.com',
  ...over,
});

/**
 * Set RAZORPAY_WEBHOOK_SECRET for the duration of an async body. It MUST await
 * `fn()` before restoring — an earlier sync version restored the variable at
 * the first await point, so the handler saw no secret and answered 503.
 */
async function withSecret<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const before = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (value === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
  else process.env.RAZORPAY_WEBHOOK_SECRET = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = before;
  }
}

// ============================================================================
// Secret loading + signature
// ============================================================================

test('readWebhookSecret strips quotes and detects placeholders', () => {
  assert.equal(readWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: ' "abc123" ' }), 'abc123');
  assert.equal(readWebhookSecret({}), '');
  assert.ok(!isWebhookConfigured({}));
  assert.ok(!isWebhookConfigured({ RAZORPAY_WEBHOOK_SECRET: 'YOUR_RAZORPAY_WEBHOOK_SECRET' }));
  assert.ok(isWebhookConfigured({ RAZORPAY_WEBHOOK_SECRET: SECRET }));
});

test('signature must be an HMAC over the RAW bytes, not the re-serialized body', () => {
  const body = paymentCaptured();
  const raw = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

  assert.ok(verifyWebhookSignature(raw, signature, SECRET));
  // Same JSON, different byte layout (pretty-printed) → must NOT verify.
  assert.ok(!verifyWebhookSignature(Buffer.from(JSON.stringify(body, null, 2)), signature, SECRET));
  assert.ok(!verifyWebhookSignature(raw, signature, 'other-secret'));
  assert.ok(!verifyWebhookSignature(raw, 'deadbeef', SECRET));
  assert.ok(!verifyWebhookSignature(raw, undefined, SECRET));
});

// ============================================================================
// Payload normalization
// ============================================================================

test('extractWebhookFacts normalizes payment.captured', () => {
  const facts = extractWebhookFacts(paymentCaptured());
  assert.equal(facts.event, 'payment.captured');
  assert.equal(facts.paymentId, 'pay_RkAbc123456789');
  assert.equal(facts.orderId, 'order_RkXyz987654321');
  assert.equal(facts.amount, 188); // paise → ₹
  assert.equal(facts.bookingRef, BOOKING_REF);
  assert.equal(facts.nextPaymentStatus, 'paid_deposit');
});

test('extractWebhookFacts maps failures, refunds and authorizations', () => {
  assert.equal(
    extractWebhookFacts({
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_1', error_description: 'card declined' } } },
    }).nextPaymentStatus,
    'failed'
  );
  assert.equal(
    extractWebhookFacts({ event: 'refund.processed', payload: { refund: { entity: { payment_id: 'pay_1', amount: 18800 } } } })
      .nextPaymentStatus,
    'refunded'
  );
  // Authorized only blocks the money — the booking must not flip to paid.
  assert.equal(
    extractWebhookFacts({ event: 'payment.authorized', payload: { payment: { entity: { id: 'pay_1' } } } })
      .nextPaymentStatus,
    null
  );
  assert.ok(HANDLED_EVENTS.has('order.paid'));
});

test('the order receipt is used when notes carry no booking reference', () => {
  const facts = extractWebhookFacts({
    event: 'order.paid',
    payload: { order: { entity: { id: 'order_1', amount: 50000, receipt: BOOKING_REF, notes: {} } } },
  });
  assert.equal(facts.bookingRef, BOOKING_REF);
  assert.equal(facts.amount, 500);
});

// ============================================================================
// Handler
// ============================================================================

test('webhook answers 503 when no secret is configured', async () => {
  await withSecret(undefined, async () => {
    const res = makeRes();
    await createRazorpayWebhookHandler(deps())(signedRequest(paymentCaptured()), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'webhook_not_configured');
  });
});

test('a forged signature is rejected with 400 and changes nothing', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({ bookings: [{ id: 'bk-1', payment_id: BOOKING_REF, payment_status: 'pending' }] });
    const res = makeRes();
    const req = signedRequest(paymentCaptured(), 'attacker-secret');
    await createRazorpayWebhookHandler(deps({ db: store.db }))(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(store.updates.length, 0);
  });
});

test('missing raw body is a 500 (we must never guess the bytes)', async () => {
  await withSecret(SECRET, async () => {
    const res = makeRes();
    await createRazorpayWebhookHandler(deps())(
      { headers: { 'x-razorpay-signature': 'x' }, body: paymentCaptured() },
      res
    );
    assert.equal(res.statusCode, 500);
  });
});

test('payment.captured marks the matching booking as paid and notifies the owner', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({
      bookings: [
        {
          id: 'bk-1',
          payment_id: BOOKING_REF,
          payment_status: 'pending',
          customer_name: 'Riya Sharma',
          customer_email: 'riya@example.com',
          service_name: 'Precision Cut',
          owner_id: 'owner-uuid',
        },
      ],
    });
    const res = makeRes();
    await createRazorpayWebhookHandler(deps({ db: store.db }))(signedRequest(paymentCaptured()), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.handled, true);
    assert.equal(res.body.updated, true);
    assert.deepEqual(store.updates[0].changes, {
      payment_status: 'paid_deposit',
      payment_id: 'pay_RkAbc123456789',
      advance_paid_amount: 188,
    });
    assert.equal(store.notifications.length, 2); // owner + customer
    assert.match(store.notifications[0].title, /Advance Payment Received/);
  });
});

test('replaying the same event is idempotent', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({ bookings: [{ id: 'bk-1', payment_id: BOOKING_REF, payment_status: 'pending' }] });
    const handler = createRazorpayWebhookHandler(deps({ db: store.db }));
    await handler(signedRequest(paymentCaptured()), makeRes());
    const second = makeRes();
    await handler(signedRequest(paymentCaptured()), second);

    assert.equal(second.statusCode, 200);
    assert.equal(second.body.updated, false);
    assert.equal(second.body.reason, 'already up to date');
    assert.equal(store.updates.length, 1, 'the row must only be written once');
  });
});

test('an unknown event is acknowledged with 200 so Razorpay stops retrying', async () => {
  await withSecret(SECRET, async () => {
    const res = makeRes();
    await createRazorpayWebhookHandler(deps())(signedRequest({ event: 'subscription.charged', payload: {} }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.handled, false);
  });
});

test('an event for an unknown booking is acknowledged, not retried', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({ bookings: [] });
    const res = makeRes();
    await createRazorpayWebhookHandler(deps({ db: store.db }))(signedRequest(paymentCaptured()), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updated, false);
    assert.equal(res.body.reason, 'booking not found');
  });
});

test('a database failure answers 500 so Razorpay retries later', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({ bookings: [{ id: 'bk-1', payment_id: BOOKING_REF, payment_status: 'pending' }], failUpdate: true });
    const res = makeRes();
    await createRazorpayWebhookHandler(deps({ db: store.db }))(signedRequest(paymentCaptured()), res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /update failed/i);
  });
});

test('refunds zero the advance and flip the status', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({
      bookings: [{ id: 'bk-1', payment_id: 'pay_RkAbc123456789', payment_status: 'paid_deposit', advance_paid_amount: 188 }],
    });
    const res = makeRes();
    await createRazorpayWebhookHandler(deps({ db: store.db }))(
      signedRequest({
        event: 'refund.processed',
        payload: { refund: { entity: { payment_id: 'pay_RkAbc123456789', amount: 18800 } } },
      }),
      res
    );
    assert.equal(res.body.updated, true);
    assert.deepEqual(store.updates[0].changes, { payment_status: 'refunded', advance_paid_amount: 0 });
  });
});

test('normalized bookings use paid_amount instead of the absent legacy advance column', async () => {
  await withSecret(SECRET, async () => {
    const store = makeDb({
      bookings: [{ id: 'bk-normalized', payment_id: BOOKING_REF, payment_status: 'pending', paid_amount: 0 }],
    });
    const handler = createRazorpayWebhookHandler(deps({ db: store.db }));
    const capture = makeRes();
    await handler(signedRequest(paymentCaptured()), capture);
    assert.equal(capture.statusCode, 200);
    assert.deepEqual(store.updates[0].changes, {
      payment_status: 'paid_deposit', payment_id: 'pay_RkAbc123456789', paid_amount: 188,
    });
    const refund = makeRes();
    await handler(signedRequest({ event: 'refund.processed', payload: {
      refund: { entity: { payment_id: 'pay_RkAbc123456789', amount: 18800 } },
    } }), refund);
    assert.equal(refund.statusCode, 200);
    assert.deepEqual(store.updates[1].changes, { payment_status: 'refunded', paid_amount: 0 });
  });
});

test('mock mode updates the in-memory booking without a database', async () => {
  await withSecret(SECRET, async () => {
    const bookings = [{ id: 'mock-1', payment_id: BOOKING_REF, payment_status: 'pending', customer_name: 'Riya' }];
    const notes: any[] = [];
    const res = makeRes();
    await createRazorpayWebhookHandler(
      deps({ isMock: true, getMockBookings: () => bookings, addMockNotifications: (r: any[]) => notes.push(...r) })
    )(signedRequest(paymentCaptured()), res);

    assert.equal(res.body.updated, true);
    assert.equal(bookings[0].payment_status, 'paid_deposit');
    assert.equal(bookings[0].payment_id, 'pay_RkAbc123456789');
    assert.equal(notes.length, 1);
  });
});
