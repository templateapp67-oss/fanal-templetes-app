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
  handleMockRazorpayPayment,
  resolveRazorpayGatewayMode,
  resolveOrderAmount,
  describeRazorpayGateway,
  createMockOrder,
  signMockPayment,
  isMockOrderId,
  MOCK_KEY_ID,
  _resetPaymentOrderCache,
} from '../server/razorpay';
import { computeAdvanceDeposit } from '../src/lib/advanceDeposit';

const KEY_ID = 'rzp_test_TIzKly1Z2NMnum';
const KEY_SECRET = 'test_secret_value_123';

/** Environment with NO credentials, mock mode on auto, non-production. */
const NO_KEYS_DEV = {
  RAZORPAY_KEY_ID: undefined,
  RAZORPAY_KEY_SECRET: undefined,
  VITE_RAZORPAY_KEY_ID: undefined,
  RAZORPAY_MOCK_MODE: undefined,
  RAZORPAY_MOCK_SECRET: undefined,
  NODE_ENV: 'test',
  VERCEL_ENV: undefined,
};
/** Environment with NO credentials on a production runtime → disabled. */
const NO_KEYS_PROD = { ...NO_KEYS_DEV, NODE_ENV: 'production' };
/** Real test keys. */
const REAL_KEYS = { ...NO_KEYS_DEV, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET };

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

async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
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

// ============================================================================
// Gateway mode resolution — the "mock instead of a hard blocking error" rule
// ============================================================================

test('gateway mode: real keys → test/live by prefix, regardless of NODE_ENV', () => {
  assert.equal(resolveRazorpayGatewayMode(REAL_KEYS), 'test');
  assert.equal(resolveRazorpayGatewayMode({ ...REAL_KEYS, NODE_ENV: 'production' }), 'test');
  assert.equal(
    resolveRazorpayGatewayMode({ ...REAL_KEYS, RAZORPAY_KEY_ID: 'rzp_live_ABCDEFGHIJKLMN' }),
    'live'
  );
});

test('gateway mode: missing keys fall back to the MOCK gateway in development/test …', () => {
  assert.equal(resolveRazorpayGatewayMode(NO_KEYS_DEV), 'mock');
  assert.equal(resolveRazorpayGatewayMode({ ...NO_KEYS_DEV, NODE_ENV: 'development' }), 'mock');
  assert.equal(resolveRazorpayGatewayMode({ ...NO_KEYS_DEV, NODE_ENV: undefined }), 'mock');
  // placeholder values from .env.example count as "missing"
  assert.equal(
    resolveRazorpayGatewayMode({ ...NO_KEYS_DEV, RAZORPAY_KEY_ID: 'rzp_test_XXXXXXXXXXXXXX', RAZORPAY_KEY_SECRET: 'YOUR_RAZORPAY_KEY_SECRET' }),
    'mock'
  );
});

test('… but are DISABLED on a production runtime unless RAZORPAY_MOCK_MODE=true is explicit', () => {
  assert.equal(resolveRazorpayGatewayMode(NO_KEYS_PROD), 'disabled');
  assert.equal(resolveRazorpayGatewayMode({ ...NO_KEYS_DEV, VERCEL_ENV: 'production' }), 'disabled');
  assert.equal(resolveRazorpayGatewayMode({ ...NO_KEYS_PROD, RAZORPAY_MOCK_MODE: 'true' }), 'mock');
  // and the explicit opt-out wins in development too
  assert.equal(resolveRazorpayGatewayMode({ ...NO_KEYS_DEV, RAZORPAY_MOCK_MODE: 'false' }), 'disabled');
  // RAZORPAY_MOCK_MODE=true forces the simulator even when real keys exist
  assert.equal(resolveRazorpayGatewayMode({ ...REAL_KEYS, RAZORPAY_MOCK_MODE: 'true' }), 'mock');
});

test('describeRazorpayGateway warns loudly when the mock gateway runs in production', () => {
  const prodMock = describeRazorpayGateway({ ...NO_KEYS_PROD, RAZORPAY_MOCK_MODE: 'true' });
  assert.equal(prodMock.mode, 'mock');
  assert.ok(prodMock.ready);
  assert.equal(prodMock.warnings.length, 1);
  assert.match(prodMock.warnings[0], /PRODUCTION/);

  const devMock = describeRazorpayGateway(NO_KEYS_DEV);
  assert.equal(devMock.mode, 'mock');
  assert.equal(devMock.warnings.length, 0);
  assert.match(devMock.summary, /MOCK payment gateway active/);

  const disabled = describeRazorpayGateway(NO_KEYS_PROD);
  assert.equal(disabled.mode, 'disabled');
  assert.ok(!disabled.ready);
  assert.match(disabled.summary, /DISABLED/);

  const real = describeRazorpayGateway(REAL_KEYS);
  assert.equal(real.mode, 'test');
  assert.match(real.summary, /Gateway ready \(TEST key rzp_test_TIz/);
  assert.ok(!real.summary.includes(KEY_SECRET));
});

// ============================================================================
// Client construction
// ============================================================================

test('createRazorpayClient returns null (instead of throwing) when the gateway is disabled', () => {
  assert.equal(createRazorpayClient(NO_KEYS_PROD), null);
  assert.equal(createRazorpayClient({ ...NO_KEYS_DEV, RAZORPAY_MOCK_MODE: 'false' }), null);
  const client = createRazorpayClient(REAL_KEYS);
  assert.ok(client);
  assert.equal(client!.keyId, KEY_ID);
  assert.equal(client!.mode, 'test');
});

test('createRazorpayClient returns the mock client when no keys exist outside production', async () => {
  const client = createRazorpayClient(NO_KEYS_DEV);
  assert.ok(client);
  assert.equal(client!.mode, 'mock');
  assert.equal(client!.keyId, MOCK_KEY_ID);
  const order = await client!.createOrder({ amount: 87, receipt: 'NX-BLR-12345', notes: { booking_ref: 'NX-BLR-12345' } });
  assert.ok(isMockOrderId(order.id), `mock order ids must be recognisable: ${order.id}`);
  assert.equal(order.amount, 8700);
  assert.equal(order.currency, 'INR');
  assert.equal(order.receipt, 'NX-BLR-12345');
  assert.equal(order.status, 'created');
  // and its signatures verify with the mock secret, not a real one
  const signed = signMockPayment(order.id, NO_KEYS_DEV);
  assert.ok(client!.verifyPaymentSignature({ orderId: signed.razorpay_order_id, paymentId: signed.razorpay_payment_id, signature: signed.razorpay_signature }));
  assert.ok(!client!.verifyPaymentSignature({ orderId: signed.razorpay_order_id, paymentId: signed.razorpay_payment_id, signature: 'forged' }));
});

test('createOrder rejects sub-₹1 amounts before calling the gateway (real and mock)', async () => {
  const client = createRazorpayClient(REAL_KEYS)!;
  await assert.rejects(() => client.createOrder({ amount: 0.5 }), /at least ₹1/);
  assert.throws(() => createMockOrder({ amount: 0.5 }), /at least ₹1/);
});

test('toPaise converts rupees to integer paise', () => {
  assert.equal(toPaise(1), 100);
  assert.equal(toPaise(1187.5), 118750);
  assert.equal(toPaise(1300.004), 130000);
});

// ============================================================================
// 25 % advance — the amount the button shows IS the amount the order carries
// ============================================================================

test('computeAdvanceDeposit: ₹348 total → ₹87 advance → 8700 paise', () => {
  assert.deepEqual(computeAdvanceDeposit(348), { rupees: 87, paise: 8700, percent: 25 });
  assert.deepEqual(computeAdvanceDeposit(750), { rupees: 188, paise: 18800, percent: 25 }); // rounds half up
  assert.deepEqual(computeAdvanceDeposit(1187.5), { rupees: 297, paise: 29700, percent: 25 });
  assert.deepEqual(computeAdvanceDeposit(0), { rupees: 0, paise: 0, percent: 25 });
  assert.deepEqual(computeAdvanceDeposit(NaN), { rupees: 0, paise: 0, percent: 25 });
  assert.deepEqual(computeAdvanceDeposit(1000, 20), { rupees: 200, paise: 20000, percent: 20 });
});

test('resolveOrderAmount derives the advance from totalAmount server-side', () => {
  const r = resolveOrderAmount({ totalAmount: 348 });
  assert.equal(r.ok, true);
  assert.equal(r.rupees, 87);
  assert.equal(r.paise, 8700);
  assert.equal(r.percent, 25);
  assert.equal(r.total, 348);

  // a custom percentage is honoured
  const custom = resolveOrderAmount({ totalAmount: 1000, depositPercent: 20 });
  assert.equal(custom.rupees, 200);
  assert.equal(custom.paise, 20000);

  // the displayed amount must agree with the derived one
  assert.equal(resolveOrderAmount({ totalAmount: 348, amount: 87 }).ok, true);
  const mismatch = resolveOrderAmount({ totalAmount: 348, amount: 50 });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'amount_mismatch');
  assert.equal(mismatch.status, 400);

  // legacy `{ amount }` contract still works
  const legacy = resolveOrderAmount({ amount: 188 });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.paise, 18800);
  assert.equal(legacy.percent, null);

  assert.equal(resolveOrderAmount({ totalAmount: 0 }).ok, false);
  assert.equal(resolveOrderAmount({ totalAmount: 100, depositPercent: 0 }).ok, false);
  assert.equal(resolveOrderAmount({ amount: 'abc' }).ok, false);
  assert.equal(resolveOrderAmount({}).ok, false);
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

test('verifyRazorpaySignature uses the secret of the ACTIVE gateway when none is passed', () => {
  withEnv(REAL_KEYS, () => {
    const signature = crypto.createHmac('sha256', KEY_SECRET).update('order_1|pay_1').digest('hex');
    assert.ok(verifyRazorpaySignature({ orderId: 'order_1', paymentId: 'pay_1', signature }));
  });
  withEnv(NO_KEYS_DEV, () => {
    const signed = signMockPayment('order_mock_ABCDEFGHIJKLMN');
    assert.ok(verifyRazorpaySignature({ orderId: signed.razorpay_order_id, paymentId: signed.razorpay_payment_id, signature: signed.razorpay_signature }));
  });
  withEnv(NO_KEYS_PROD, () => {
    const signed = signMockPayment('order_mock_ABCDEFGHIJKLMN');
    // disabled gateway → no secret → nothing verifies
    assert.ok(!verifyRazorpaySignature({ orderId: signed.razorpay_order_id, paymentId: signed.razorpay_payment_id, signature: signed.razorpay_signature }));
  });
});

// ============================================================================
// HTTP handlers
// ============================================================================

test('GET config reports configured=false with reasons (disabled) and never leaks the secret', () => {
  withEnv(NO_KEYS_PROD, () => {
    const res = makeRes();
    handleRazorpayConfig({}, res);
    assert.equal(res.body.configured, false);
    assert.equal(res.body.mode, 'disabled');
    assert.equal(res.body.keyId, null);
    assert.ok(res.body.issues.length > 0);
    assert.ok(!JSON.stringify(res.body).includes(KEY_SECRET));
  });
});

test('GET config exposes only the public key id in test mode', () => {
  withEnv(REAL_KEYS, () => {
    const res = makeRes();
    handleRazorpayConfig({}, res);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.keyId, KEY_ID);
    assert.equal(res.body.mode, 'test');
    assert.equal(res.body.mock, false);
    assert.equal(res.body.depositPercent, 25);
    assert.ok(!JSON.stringify(res.body).includes(KEY_SECRET));
  });
});

test('GET config announces the mock gateway (configured=true, mock=true) when keys are missing in dev', () => {
  withEnv(NO_KEYS_DEV, () => {
    const res = makeRes();
    handleRazorpayConfig({}, res);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.mock, true);
    assert.equal(res.body.mode, 'mock');
    assert.equal(res.body.keyId, MOCK_KEY_ID);
    assert.match(res.body.notice, /simulated/i);
  });
});

test('order endpoint answers 400 for a missing/invalid amount (never a 500)', async () => {
  await withEnvAsync(REAL_KEYS, async () => {
    const res = makeRes();
    await handleCreateRazorpayOrder({ body: { amount: 'abc' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /positive payment amount/i);

    const mismatch = makeRes();
    await handleCreateRazorpayOrder({ body: { totalAmount: 348, amount: 12 } }, mismatch);
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.body.code, 'amount_mismatch');
  });
});

test('order endpoint answers 503 (not 500) when the gateway is disabled', async () => {
  await withEnvAsync(NO_KEYS_PROD, async () => {
    const res = makeRes();
    await handleCreateRazorpayOrder({ body: { totalAmount: 348 } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'razorpay_not_configured');
    assert.ok(Array.isArray(res.body.issues));
  });
});

test('order endpoint reuses an unpaid order when the same receipt is retried', async () => {
  await withEnvAsync(NO_KEYS_DEV, async () => {
    _resetPaymentOrderCache();
    const first = makeRes();
    await handleCreateRazorpayOrder(
      { body: { totalAmount: 348, depositPercent: 25, amount: 87, receipt: 'NX-JPR-53682' } },
      first
    );
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    const second = makeRes();
    await handleCreateRazorpayOrder(
      { body: { totalAmount: 348, depositPercent: 25, amount: 87, receipt: 'NX-JPR-53682' } },
      second
    );
    assert.equal(second.body.order.id, first.body.order.id);
    assert.equal(second.body.reused, true);
    _resetPaymentOrderCache();
  });
});

test('order endpoint creates a MOCK order with the 25 % advance in integer paise when keys are missing in dev', async () => {
  await withEnvAsync(NO_KEYS_DEV, async () => {
    const res = makeRes();
    await handleCreateRazorpayOrder(
      { body: { totalAmount: 348, depositPercent: 25, amount: 87, receipt: 'NX-BLR-12345', notes: { booking_ref: 'NX-BLR-12345' } } },
      res
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.mode, 'mock');
    assert.equal(res.body.mock, true);
    assert.equal(res.body.keyId, MOCK_KEY_ID);
    assert.ok(isMockOrderId(res.body.order.id));
    assert.equal(res.body.order.amount, 8700);
    assert.equal(res.body.order.currency, 'INR');
    assert.equal(res.body.order.receipt, 'NX-BLR-12345');
    assert.deepEqual(res.body.deposit, { rupees: 87, paise: 8700, percent: 25 });
  });
});

test('order endpoint sends the real Razorpay API the 25 % advance in integer paise', async () => {
  await withEnvAsync(REAL_KEYS, async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: any = null;
    let sentAuth = '';
    globalThis.fetch = (async (url: any, init?: any) => {
      assert.match(String(url), /api\.razorpay\.com\/v1\/orders$/);
      sentBody = JSON.parse(init.body);
      sentAuth = init.headers.Authorization;
      return new Response(
        JSON.stringify({ id: 'order_real_1', entity: 'order', amount: sentBody.amount, currency: sentBody.currency, receipt: sentBody.receipt, status: 'created' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;
    try {
      const res = makeRes();
      await handleCreateRazorpayOrder({ body: { totalAmount: 348, receipt: 'NX-BLR-12345' } }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(sentBody.amount, 8700, 'Razorpay must receive integer paise');
      assert.equal(sentBody.currency, 'INR');
      assert.equal(sentBody.payment_capture, 1);
      assert.equal(sentBody.notes.total_amount, '348');
      assert.equal(sentBody.notes.deposit_percent, '25');
      assert.equal(sentBody.notes.advance_amount, '87');
      assert.equal(sentAuth, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
      assert.equal(res.body.order.id, 'order_real_1');
      assert.equal(res.body.mode, 'test');
      assert.equal(res.body.mock, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('verify endpoint rejects incomplete payloads and bad signatures', () => {
  withEnv(REAL_KEYS, () => {
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
    assert.equal(ok.body.mode, 'test');
    assert.equal(ok.body.mock, false);
  });
});

test('verify endpoint answers 503 when the gateway is disabled', () => {
  withEnv(NO_KEYS_PROD, () => {
    const res = makeRes();
    handleVerifyRazorpayPayment(
      { body: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'x' } },
      res
    );
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'razorpay_not_configured');
  });
});

// ============================================================================
// Mock gateway end-to-end: order → mock-pay → verify
// ============================================================================

test('mock-pay issues a signed payment for a mock order, and verify accepts exactly that triple', async () => {
  await withEnvAsync(NO_KEYS_DEV, async () => {
    const orderRes = makeRes();
    await handleCreateRazorpayOrder({ body: { totalAmount: 348 } }, orderRes);
    const orderId = orderRes.body.order.id;

    const payRes = makeRes();
    handleMockRazorpayPayment({ body: { order_id: orderId } }, payRes);
    assert.equal(payRes.statusCode, 200, JSON.stringify(payRes.body));
    assert.equal(payRes.body.mock, true);
    assert.equal(payRes.body.razorpay_order_id, orderId);
    assert.match(payRes.body.razorpay_payment_id, /^pay_mock_/);
    assert.match(payRes.body.razorpay_signature, /^[0-9a-f]{64}$/);

    const verifyRes = makeRes();
    handleVerifyRazorpayPayment(
      {
        body: {
          razorpay_order_id: payRes.body.razorpay_order_id,
          razorpay_payment_id: payRes.body.razorpay_payment_id,
          razorpay_signature: payRes.body.razorpay_signature,
        },
      },
      verifyRes
    );
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.body.verified, true);
    assert.equal(verifyRes.body.mode, 'mock');
    assert.equal(verifyRes.body.mock, true);

    // tampering with the payment id breaks the signature
    const tampered = makeRes();
    handleVerifyRazorpayPayment(
      {
        body: {
          razorpay_order_id: payRes.body.razorpay_order_id,
          razorpay_payment_id: 'pay_mock_someoneelse',
          razorpay_signature: payRes.body.razorpay_signature,
        },
      },
      tampered
    );
    assert.equal(tampered.statusCode, 400);
    assert.equal(tampered.body.verified, false);
  });
});

test('mock-pay can simulate a declined payment so the retry path is testable', () => {
  withEnv(NO_KEYS_DEV, () => {
    const res = makeRes();
    handleMockRazorpayPayment({ body: { order_id: 'order_mock_ABCDEFGHIJKLMN', outcome: 'failure' } }, res);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'payment_failed');
    assert.match(res.body.error.description, /Simulated payment failure/);
  });
});

test('mock-pay refuses non-mock order ids', () => {
  withEnv(NO_KEYS_DEV, () => {
    const res = makeRes();
    handleMockRazorpayPayment({ body: { order_id: 'order_real_1' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'invalid_mock_order');
  });
});

test('mock-pay is a 404 whenever the mock gateway is not the active mode', () => {
  withEnv(REAL_KEYS, () => {
    const res = makeRes();
    handleMockRazorpayPayment({ body: { order_id: 'order_mock_ABCDEFGHIJKLMN' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'mock_gateway_disabled');
  });
  withEnv(NO_KEYS_PROD, () => {
    const res = makeRes();
    handleMockRazorpayPayment({ body: { order_id: 'order_mock_ABCDEFGHIJKLMN' } }, res);
    assert.equal(res.statusCode, 404);
  });
});

test('a mock-signed triple never verifies against the REAL gateway', () => {
  const signed = withEnv(NO_KEYS_DEV, () => signMockPayment('order_mock_ABCDEFGHIJKLMN'));
  withEnv(REAL_KEYS, () => {
    const res = makeRes();
    handleVerifyRazorpayPayment({ body: signed }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.verified, false);
  });
});
