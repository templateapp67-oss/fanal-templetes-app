// ============================================================================
// Browser-side checkout (src/lib/razorpayCheckout.ts) driven with a fake fetch.
//
// These tests prove the sequence the booking modal relies on for BOTH the
// first attempt and "Retry Payment":
//   config → order (server derives 25 % in paise) → mock-pay | popup → verify
// and that every failure comes back as a typed outcome (never a throw) so the
// modal can keep the draft and offer a retry.
// ============================================================================

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { payAdvanceWithRazorpay, createAdvanceOrder, fetchRazorpayConfig } from '../src/lib/razorpayCheckout';

const MOCK_SECRET = 'nexora_mock_gateway_secret_not_for_production';

interface Call {
  url: string;
  body: any;
}

/** A fake server that behaves like the Express handlers in mock mode. */
function fakeMockServer(options: { failPayment?: boolean; failVerify?: boolean } = {}) {
  const calls: Call[] = [];
  const json = (status: number, payload: any) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.endsWith('/api/payments/razorpay/config')) {
      return json(200, { success: true, configured: true, mock: true, mode: 'mock', keyId: 'rzp_mock_nexoraSandbox', depositPercent: 25 });
    }
    if (url.endsWith('/api/payments/razorpay/order')) {
      const total = Number(body.totalAmount);
      const rupees = Math.round((total * Number(body.depositPercent || 25)) / 100);
      if (body.amount !== undefined && Math.abs(Number(body.amount) - rupees) > 0.5) {
        return json(400, { success: false, code: 'amount_mismatch', error: 'mismatch' });
      }
      return json(200, {
        success: true,
        mode: 'mock',
        mock: true,
        keyId: 'rzp_mock_nexoraSandbox',
        order: { id: `order_mock_${calls.length}abcdefghijk`, amount: rupees * 100, currency: 'INR', receipt: body.receipt },
        deposit: { rupees, paise: rupees * 100, percent: 25 },
      });
    }
    if (url.endsWith('/api/payments/razorpay/mock-pay')) {
      if (options.failPayment || body.outcome === 'failure') {
        return json(402, { success: false, mock: true, code: 'payment_failed', error: { description: 'Simulated payment failure (mock gateway).' } });
      }
      const paymentId = `pay_mock_${calls.length}xyz`;
      const signature = crypto.createHmac('sha256', MOCK_SECRET).update(`${body.order_id}|${paymentId}`).digest('hex');
      return json(200, { success: true, mock: true, razorpay_order_id: body.order_id, razorpay_payment_id: paymentId, razorpay_signature: signature });
    }
    if (url.endsWith('/api/payments/razorpay/verify')) {
      if (options.failVerify) return json(400, { success: false, verified: false, error: 'Payment signature verification failed.' });
      const expected = crypto
        .createHmac('sha256', MOCK_SECRET)
        .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
        .digest('hex');
      const verified = expected === body.razorpay_signature;
      return json(verified ? 200 : 400, { success: verified, verified, mode: 'mock', mock: true });
    }
    return json(404, { success: false, error: 'API route not found' });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

const DRAFT_INPUT = {
  totalAmount: 348,
  depositPercent: 25,
  amount: 87,
  receipt: 'NX-BLR-12345',
  description: '25% advance for Precision Cut on 2026-10-02 at 11:30',
  customer: { name: 'Riya Sharma', email: 'riya@example.com', contact: '9845012345' },
  salonName: 'Arts By Uma',
  notes: { booking_ref: 'NX-BLR-12345', slot: '2026-10-02 11:30' },
};

test('mock gateway: the full order → pay → verify sequence completes without checkout.js', async () => {
  const server = fakeMockServer();
  const outcome = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, fetchImpl: server.fetchImpl });

  assert.equal(outcome.status, 'paid', JSON.stringify(outcome));
  assert.equal(outcome.mode, 'mock');
  assert.equal(outcome.amount, 87);
  assert.match(outcome.orderId!, /^order_mock_/);
  assert.match(outcome.paymentId!, /^pay_mock_/);
  assert.equal(outcome.signature!.length, 64);

  const urls = server.calls.map((c) => c.url);
  assert.deepEqual(urls, [
    '/api/payments/razorpay/config',
    '/api/payments/razorpay/order',
    '/api/payments/razorpay/mock-pay',
    '/api/payments/razorpay/verify',
  ]);
  // The order request carries the total + percentage so the SERVER derives
  // the paise amount; the displayed amount rides along for the mismatch check.
  const orderCall = server.calls[1];
  assert.equal(orderCall.body.totalAmount, 348);
  assert.equal(orderCall.body.depositPercent, 25);
  assert.equal(orderCall.body.amount, 87);
  assert.equal(orderCall.body.receipt, 'NX-BLR-12345');
  assert.equal(orderCall.body.notes.booking_ref, 'NX-BLR-12345');
  assert.equal(orderCall.body.notes.salon, 'Arts By Uma');
  // verify is called with exactly the Razorpay field names
  const verifyCall = server.calls[3];
  assert.deepEqual(Object.keys(verifyCall.body).sort(), ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']);
});

test('a declined payment is a retryable "failed" outcome — and the retry creates a NEW order for the same draft', async () => {
  const server = fakeMockServer();
  const first = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, mockOutcome: 'failure', fetchImpl: server.fetchImpl });
  assert.equal(first.status, 'failed');
  assert.equal(first.retryable, true);
  assert.match(first.reason, /Simulated payment failure/);
  assert.match(first.orderId!, /^order_mock_/);
  assert.equal(server.calls.filter((c) => c.url.endsWith('/verify')).length, 0, 'nothing to verify after a decline');

  // "Retry Payment" = the SAME input again.
  const second = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, fetchImpl: server.fetchImpl });
  assert.equal(second.status, 'paid');
  assert.notEqual(second.orderId, first.orderId, 'a failed order is not reused');
  const orderCalls = server.calls.filter((c) => c.url.endsWith('/order'));
  assert.equal(orderCalls.length, 2);
  // Both orders were for the identical draft payload.
  assert.deepEqual(orderCalls[0].body, orderCalls[1].body);
});

test('a signature the server refuses is reported as failed/payment_unverified (never paid)', async () => {
  const server = fakeMockServer({ failVerify: true });
  const outcome = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, fetchImpl: server.fetchImpl });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'payment_unverified');
  assert.equal(outcome.retryable, true);
});

test('a disabled gateway (503 razorpay_not_configured) is an "unavailable" outcome the modal can degrade from', async () => {
  const fetchImpl = (async (input: any) => {
    const url = String(input);
    if (url.endsWith('/config')) {
      return new Response(JSON.stringify({ success: true, configured: false, mode: 'disabled', keyId: null, issues: ['RAZORPAY_KEY_ID is missing from the environment (.env).'] }), { status: 200 });
    }
    throw new Error('should not be called');
  }) as typeof fetch;
  const outcome = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, fetchImpl });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.code, 'razorpay_not_configured');
  assert.match(outcome.reason, /RAZORPAY_KEY_ID is missing/);
});

test('an order the server refuses with 503 unreachable degrades, a 400 does not', async () => {
  const make = (status: number, payload: any) =>
    (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/config')) {
        return new Response(JSON.stringify({ success: true, configured: true, mode: 'test', keyId: 'rzp_test_abc' }), { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status });
    }) as typeof fetch;

  const unreachable = await payAdvanceWithRazorpay({
    ...DRAFT_INPUT,
    fetchImpl: make(503, { success: false, code: 'razorpay_unreachable', error: 'Online payment is temporarily unreachable from the server.' }),
  });
  assert.equal(unreachable.status, 'unavailable');
  assert.equal(unreachable.code, 'razorpay_unreachable');

  const mismatch = await payAdvanceWithRazorpay({
    ...DRAFT_INPUT,
    fetchImpl: make(400, { success: false, code: 'amount_mismatch', error: 'The advance shown does not match.' }),
  });
  assert.equal(mismatch.status, 'failed');
  assert.equal(mismatch.code, 'amount_mismatch');
  assert.equal(mismatch.retryable, false, 'a 400 is not fixed by retrying the same payload');
});

test('network failures never throw — they come back as retryable failures', async () => {
  const fetchImpl = (async (input: any) => {
    const url = String(input);
    if (url.endsWith('/config')) {
      return new Response(JSON.stringify({ success: true, configured: true, mode: 'mock', mock: true, keyId: 'rzp_mock_nexoraSandbox' }), { status: 200 });
    }
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  const outcome = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, fetchImpl });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.retryable, true);
  assert.match(outcome.reason, /Failed to fetch/);
});

test('a zero deposit short-circuits before any network call', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;
  const outcome = await payAdvanceWithRazorpay({ ...DRAFT_INPUT, totalAmount: 0, amount: 0, fetchImpl });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(called, false);
});

test('fetchRazorpayConfig tolerates an unreachable config endpoint', async () => {
  const config = await fetchRazorpayConfig((async () => {
    throw new Error('offline');
  }) as typeof fetch);
  assert.equal(config.configured, false);
  assert.equal(config.mode, 'disabled');
  assert.deepEqual(config.issues, ['offline']);
});

test('createAdvanceOrder fills in the displayed amount from the total when omitted', async () => {
  const server = fakeMockServer();
  const created = await createAdvanceOrder({ ...DRAFT_INPUT, amount: undefined }, server.fetchImpl);
  assert.equal(created.ok, true);
  assert.equal(created.rupees, 87);
  assert.equal(created.order!.amount, 8700);
  assert.equal(server.calls[0].body.amount, 87);
});
