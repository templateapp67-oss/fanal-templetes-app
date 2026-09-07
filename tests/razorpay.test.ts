import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  readRazorpayCredentials,
  getRazorpayConfigIssues,
  isRazorpayConfigured,
  createRazorpayClient,
  verifyRazorpaySignature,
  toPaise,
  handleRazorpayConfig,
  handleCreateRazorpayOrder,
  handleVerifyRazorpayPayment,
} from '../server/razorpay';

const KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
const KEY_SECRET = 'test_secret_value_123';

/** Minimal express-like res double. */
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

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ============================================================================
// Credentials are read from the environment (the .env loading bug)
// ============================================================================

test('readRazorpayCredentials strips quotes and whitespace copied from .env', () => {
  const creds = readRazorpayCredentials({
    RAZORPAY_KEY_ID: ' "rzp_test_TIzKly1Z2NMnum" ',
    RAZORPAY_KEY_SECRET: "'9SehLfvRW6eVtHXtFXzL2Ovm'",
  });
  assert.equal(creds.keyId, 'rzp_test_TIzKly1Z2NMnum');
  assert.equal(creds.keySecret, '9SehLfvRW6eVtHXtFXzL2Ovm');
});

test('readRazorpayCredentials accepts the VITE_/alias variable names', () => {
  const creds = readRazorpayCredentials({ VITE_RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_SECRET: KEY_SECRET });
  assert.equal(creds.keyId, KEY_ID);
  assert.equal(creds.keySecret, KEY_SECRET);
});

test('missing / placeholder credentials are reported, never treated as configured', () => {
  assert.deepEqual(getRazorpayConfigIssues({}).length, 2);
  assert.ok(getRazorpayConfigIssues({ RAZORPAY_KEY_ID: KEY_ID })[0].includes('RAZORPAY_KEY_SECRET'));
  assert.ok(
    getRazorpayConfigIssues({ RAZORPAY_KEY_ID: 'YOUR_RAZORPAY_KEY_ID', RAZORPAY_KEY_SECRET: KEY_SECRET })[0].includes(
      'placeholder'
    )
  );
  assert.ok(
    getRazorpayConfigIssues({ RAZORPAY_KEY_ID: 'not-a-key', RAZORPAY_KEY_SECRET: KEY_SECRET })[0].includes('malformed')
  );
  assert.ok(isRazorpayConfigured({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }));
});

test('createRazorpayClient returns null (instead of throwing) when unconfigured', () => {
  assert.equal(createRazorpayClient({}), null);
  const client = createRazorpayClient({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET });
  assert.ok(client);
  assert.equal(client!.keyId, KEY_ID);
});

test('createOrder rejects sub-₹1 amounts before calling the gateway', async () => {
  const client = createRazorpayClient({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET })!;
  await assert.rejects(() => client.createOrder({ amount: 0.5 }), /at least ₹1/);
});

test('toPaise converts rupees to integer paise', () => {
  assert.equal(toPaise(1), 100);
  assert.equal(toPaise(1187.5), 118750);
  assert.equal(toPaise(1300.004), 130000);
});

// ============================================================================
// Signature verification — a payment is only trusted after this passes
// ============================================================================

test('verifyRazorpaySignature accepts a genuine signature and rejects tampering', () => {
  const orderId = 'order_MnO123456789';
  const paymentId = 'pay_MnO987654321';
  const signature = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

  assert.ok(verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: KEY_SECRET }));
  assert.ok(!verifyRazorpaySignature({ orderId, paymentId, signature: 'deadbeef', keySecret: KEY_SECRET }));
  assert.ok(!verifyRazorpaySignature({ orderId, paymentId: 'pay_other', signature, keySecret: KEY_SECRET }));
  assert.ok(!verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: 'wrong-secret' }));
  assert.ok(!verifyRazorpaySignature({ orderId: '', paymentId, signature, keySecret: KEY_SECRET }));
});

// ============================================================================
// HTTP handlers
// ============================================================================

test('GET config reports configured=false with reasons and never leaks the secret', () => {
  withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, VITE_RAZORPAY_KEY_ID: undefined }, () => {
    const res = makeRes();
    handleRazorpayConfig({}, res);
    assert.equal(res.body.configured, false);
    assert.equal(res.body.keyId, null);
    assert.ok(res.body.issues.length > 0);
    assert.ok(!JSON.stringify(res.body).includes(KEY_SECRET));
  });
});

test('GET config exposes only the public key id in test mode', () => {
  withEnv({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, () => {
    const res = makeRes();
    handleRazorpayConfig({}, res);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.keyId, KEY_ID);
    assert.equal(res.body.mode, 'test');
    assert.ok(!JSON.stringify(res.body).includes(KEY_SECRET));
  });
});

test('order endpoint answers 400 for a missing/invalid amount (never a 500)', async () => {
  await withEnv({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
    const res = makeRes();
    await handleCreateRazorpayOrder({ body: { amount: 'abc' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /positive payment amount/i);
  });
});

test('order endpoint answers 503 (not 500) when the keys are missing', async () => {
  await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, VITE_RAZORPAY_KEY_ID: undefined }, async () => {
    const res = makeRes();
    await handleCreateRazorpayOrder({ body: { amount: 500 } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'razorpay_not_configured');
    assert.ok(Array.isArray(res.body.issues));
  });
});

test('verify endpoint rejects incomplete payloads and bad signatures', () => {
  withEnv({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, () => {
    const missing = makeRes();
    handleVerifyRazorpayPayment({ body: { razorpay_order_id: 'order_1' } }, missing);
    assert.equal(missing.statusCode, 400);

    const bad = makeRes();
    handleVerifyRazorpayPayment(
      { body: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'nope' } },
      bad
    );
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.verified, false);

    const signature = crypto.createHmac('sha256', KEY_SECRET).update('order_1|pay_1').digest('hex');
    const ok = makeRes();
    handleVerifyRazorpayPayment(
      { body: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: signature } },
      ok
    );
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.verified, true);
  });
});
