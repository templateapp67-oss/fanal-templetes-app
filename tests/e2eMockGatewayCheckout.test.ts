// ============================================================================
// END-TO-END HTTP: the complete 25 % advance checkout against the MOCK gateway.
// ----------------------------------------------------------------------------
// This is the exact sequence the booking modal runs when RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET are absent in a development/test environment — the
// situation that used to dead-end at "the secure payment and booking service is
// not configured. No appointment was created.":
//
//   GET  /api/payments/razorpay/config      → mode=mock
//   POST /api/payments/razorpay/order       → order_mock_…, 8700 paise for ₹348
//   POST /api/payments/razorpay/mock-pay    → signed payment triple
//   POST /api/payments/razorpay/verify      → verified
//   POST /api/bookings/create { payment }   → paid_deposit booking, paymentMode=mock
//
// plus the failure → "Retry Payment" path (same unpaid order for the same draft) and
// the guard that a forged triple never becomes a paid booking.
//
// The env is forced BEFORE api/index.ts is imported so this file is
// independent of whatever .env.development contains.
// ============================================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { test, before, after } from 'node:test';
import type { TestContext } from 'node:test';

const SAVED = {
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  VITE_RAZORPAY_KEY_ID: process.env.VITE_RAZORPAY_KEY_ID,
  RAZORPAY_MOCK_MODE: process.env.RAZORPAY_MOCK_MODE,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

// Force the mock gateway for this process. The .env loader never overwrites
// an existing variable, so setting them here (even to '') wins.
process.env.RAZORPAY_MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL_ENV;

let app: any;
let server: http.Server;
let base: string;
let mode: string = 'mock';

function skipUnlessMock(t: TestContext): void {
  if (mode === 'mock') return;
  t.skip(`requires mock booking store (app reports mode="${mode}")`);
}

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer mock:e2e-mock-gateway-customer',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}

const DRAFT = {
  ref: 'NX-BLR-88001',
  total: 348,
  booking: {
    customer_name: 'Riya Sharma',
    customer_phone: '9845012345',
    customer_email: 'riya@example.com',
    service_id: 'hs-2',
    service_name: 'Classic Layered Cut',
    stylist_name: 'Uma',
    salon_name: 'Arts By Uma',
    service_addons: [{ name: 'Head Massage', price: 48 }],
    booking_date: '2026-10-02',
    time_slot: '11:30',
    total_amount: 348,
    advance_paid_amount: 87,
    status: 'pending',
    payment_status: 'paid_deposit',
    booking_type: 'salon',
  },
};

before(async () => {
  app = (await import('../api/index')).default;
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  base = `http://127.0.0.1:${addr.port}`;
  try {
    const res = await fetch(`${base}/api/health`);
    const json: any = await res.json();
    if (json && (json.mode === 'mock' || json.mode === 'live')) mode = json.mode;
  } catch {
    // keep default
  }
});

after(() => {
  server?.close();
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('health reports paymentMode=mock and the razorpay check passes (mock is a legitimate dev state)', async () => {
  const r = await request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.paymentMode, 'mock');
  const check = r.body.checks.find((c: any) => c.name === 'razorpay');
  assert.ok(check);
  assert.equal(check.ok, true);
  assert.match(check.detail, /^\[mock\]/);
});

test('config announces the mock gateway instead of "not configured"', async () => {
  const r = await request('GET', '/api/payments/razorpay/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.equal(r.body.mode, 'mock');
  assert.equal(r.body.mock, true);
  assert.match(r.body.keyId, /^rzp_mock_/);
  assert.equal(r.body.depositPercent, 25);
});

test('full checkout: order (₹87 = 8700 paise) → mock-pay → verify → paid_deposit booking', async (t) => {
  skipUnlessMock(t);

  // 1. order — the server derives 25 % of ₹348 itself
  const order = await request('POST', '/api/payments/razorpay/order', {
    totalAmount: DRAFT.total,
    depositPercent: 25,
    amount: 87,
    currency: 'INR',
    receipt: DRAFT.ref,
    notes: { booking_ref: DRAFT.ref, slot: '2026-10-02 11:30', stylist: 'Uma' },
  });
  assert.equal(order.status, 200, order.text);
  assert.equal(order.body.mode, 'mock');
  assert.match(order.body.order.id, /^order_mock_/);
  assert.equal(order.body.order.amount, 8700);
  assert.equal(order.body.order.currency, 'INR');
  assert.equal(order.body.order.receipt, DRAFT.ref);
  assert.deepEqual(order.body.deposit, { rupees: 87, paise: 8700, percent: 25 });

  // 2. "checkout" — the mock gateway signs a payment for that order
  const pay = await request('POST', '/api/payments/razorpay/mock-pay', { order_id: order.body.order.id });
  assert.equal(pay.status, 200, pay.text);
  assert.equal(pay.body.razorpay_order_id, order.body.order.id);
  assert.match(pay.body.razorpay_payment_id, /^pay_mock_/);

  const triple = {
    razorpay_order_id: pay.body.razorpay_order_id,
    razorpay_payment_id: pay.body.razorpay_payment_id,
    razorpay_signature: pay.body.razorpay_signature,
  };

  // 3. verify
  const verify = await request('POST', '/api/payments/razorpay/verify', triple);
  assert.equal(verify.status, 200, verify.text);
  assert.equal(verify.body.verified, true);
  assert.equal(verify.body.mode, 'mock');

  // 4. booking — the server re-verifies the signature before marking it paid
  const created = await request('POST', '/api/bookings/create', {
    subdomain: 'arts-by-uma',
    payment: triple,
    booking: { ...DRAFT.booking, payment_id: triple.razorpay_payment_id },
    notifications: [{ user_email: 'owner@salon.com', title: 'New Booking Request', message: '25% Advance Paid: ₹87 (TEST — simulated)' }],
  });
  assert.equal(created.status, 200, created.text);
  assert.equal(created.body.success, true);
  assert.equal(created.body.paymentVerified, true);
  assert.equal(created.body.paymentMode, 'mock');
  assert.equal(created.body.data.payment_status, 'paid_deposit');
  assert.equal(created.body.data.advance_paid_amount, 87);
  assert.equal(created.body.data.total_amount, 348);
  assert.equal(created.body.data.payment_id, triple.razorpay_payment_id);
  assert.equal(created.body.data.time_slot, '11:30');
  assert.equal(created.body.data.metadata.stylist_name, 'Uma');
  assert.equal(created.body.data.metadata.service_addons, 'Head Massage');
});

test('retry path: a simulated decline leaves nothing booked; the retry reuses the unpaid order for the same draft and succeeds', async (t) => {
  skipUnlessMock(t);
  const ref = 'NX-BLR-88002';
  const before = await request('GET', '/api/bookings');
  const countBefore = (before.body.data || []).length;

  // attempt 1 — declined
  const order1 = await request('POST', '/api/payments/razorpay/order', { totalAmount: 348, receipt: ref });
  assert.equal(order1.status, 200, order1.text);
  const declined = await request('POST', '/api/payments/razorpay/mock-pay', { order_id: order1.body.order.id, outcome: 'failure' });
  assert.equal(declined.status, 402);
  assert.equal(declined.body.code, 'payment_failed');
  // the modal never posts a booking after a decline
  const mid = await request('GET', '/api/bookings');
  assert.equal((mid.body.data || []).length, countBefore, 'a declined payment must not create an appointment');

  // attempt 2 — "Retry Payment": same draft (same receipt / total), unpaid order reused
  const order2 = await request('POST', '/api/payments/razorpay/order', { totalAmount: 348, receipt: ref });
  assert.equal(order2.status, 200, order2.text);
  assert.equal(order2.body.order.id, order1.body.order.id, 'retry must not mint a second chargeable order');
  assert.equal(order2.body.reused, true);
  assert.equal(order2.body.order.amount, order1.body.order.amount, 'the retry charges the identical deposit');
  assert.equal(order2.body.order.receipt, ref);

  const pay = await request('POST', '/api/payments/razorpay/mock-pay', { order_id: order2.body.order.id });
  assert.equal(pay.status, 200, pay.text);
  const triple = {
    razorpay_order_id: pay.body.razorpay_order_id,
    razorpay_payment_id: pay.body.razorpay_payment_id,
    razorpay_signature: pay.body.razorpay_signature,
  };
  const created = await request('POST', '/api/bookings/create', {
    payment: triple,
    booking: { ...DRAFT.booking, payment_id: triple.razorpay_payment_id },
  });
  assert.equal(created.status, 200, created.text);
  assert.equal(created.body.paymentVerified, true);
  assert.equal(created.body.data.payment_status, 'paid_deposit');

  const after = await request('GET', '/api/bookings');
  assert.equal((after.body.data || []).length, countBefore + 1, 'exactly one booking for the retried draft');
});

test('a forged signature is rejected by /verify AND by /bookings/create — nothing is stored', async (t) => {
  skipUnlessMock(t);
  const order = await request('POST', '/api/payments/razorpay/order', { totalAmount: 348 });
  const forged = {
    razorpay_order_id: order.body.order.id,
    razorpay_payment_id: 'pay_mock_forgedforged',
    razorpay_signature: 'deadbeef'.repeat(8),
  };
  const verify = await request('POST', '/api/payments/razorpay/verify', forged);
  assert.equal(verify.status, 400);
  assert.equal(verify.body.verified, false);

  const before = await request('GET', '/api/bookings');
  const created = await request('POST', '/api/bookings/create', { payment: forged, booking: DRAFT.booking });
  assert.equal(created.status, 400, created.text);
  assert.equal(created.body.code, 'payment_unverified');
  const after = await request('GET', '/api/bookings');
  assert.equal((after.body.data || []).length, (before.body.data || []).length);
});

test('an order whose displayed amount disagrees with 25 % of the total is refused (never silently charged)', async () => {
  const r = await request('POST', '/api/payments/razorpay/order', { totalAmount: 348, amount: 50 });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'amount_mismatch');
});

test('mock-pay refuses an order id it did not issue', async () => {
  const r = await request('POST', '/api/payments/razorpay/mock-pay', { order_id: 'order_Real123456789' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid_mock_order');
});
