// ============================================================================
// END-TO-END HTTP integration tests for the booking + Razorpay surfaces.
// ----------------------------------------------------------------------------
// The unit suites (bookingCreate.test.ts, razorpayWebhook.test.ts, …) call the
// Express *handlers* directly and construct `req.body` by hand. That is great
// for logic but can never prove the two most failure-prone wiring points of the
// live checkout:
//   1. that `express.json({ verify })` actually stashes the RAW body bytes the
//      Razorpay webhook signature must be computed over, and
//   2. that the real HTTP endpoints answer the documented JSON / status codes
//      (authenticated bookings, unauthenticated rejection, missing optional fields, forged vs
//      genuine webhook signatures).
//
// This file boots the real serverless app (api/index.ts) on an ephemeral port
// and exercises it with real HTTP requests + real body parsing, which is
// exactly the path the deployed checkout runs.
// ============================================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { test, before, after } from 'node:test';
import type { TestContext } from 'node:test';
import app from '../api/index';

let server: http.Server;
let base: string;
/** 'mock' | 'live' — read from /api/health at boot. */
let mode: string = 'mock';

/**
 * The webhook-updates-a-booking cases mutate the app's in-memory mock store,
 * so they are only meaningful when the app is running without a real Supabase.
 * Against a live database they would create real rows / depend on an owner
 * being resolvable, so skip them there (the wiring they exercise is identical
 * to the mock store path in server/razorpayWebhook.ts).
 */
function skipUnlessMock(t: TestContext): void {
  if (mode === 'mock') return;
  t.skip(`requires mock mode (app reports mode="${mode}")`);
}

/** Minimal, otherwise-valid booking used by most scenarios. */
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
  payment_status: 'pending',
};

interface HttpResponse {
  status: number;
  body: any;
  text: string;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(mode === 'mock' ? { authorization: 'Bearer mock:e2e-customer' } : {}),
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

function signRazorpayWebhook(payload: unknown, secret: string): { raw: Buffer; signature: string } {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

// The webhook secret is loaded (from .env.development) by api/index.ts at
// import time. Re-read it the same way the handler does.
function currentWebhookSecret(): string {
  const v = process.env.RAZORPAY_WEBHOOK_SECRET;
  return typeof v === 'string' ? v.trim().replace(/^['"]|['"]$/g, '') : '';
}

before(async () => {
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
});

// ============================================================================
// Booking creation over real HTTP
// ============================================================================

test('health endpoint is reachable and reports the run mode', async () => {
  const r = await request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.ok(['mock', 'live'].includes(r.body.mode));
});

test('the serverless entrypoint also handles a rewrite that strips the /api prefix', async () => {
  const r = await request('GET', '/health');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'ok');
});

test('POST /api/bookings/create rejects an unauthenticated caller before payment or persistence', async (t) => {
  skipUnlessMock(t);
  const before = await request('GET', '/api/bookings');
  const r = await request(
    'POST',
    '/api/bookings/create',
    {
      booking: VALID_BOOKING,
      payment: {
        razorpay_order_id: 'order_guest_should_not_verify',
        razorpay_payment_id: 'pay_guest_should_not_verify',
        razorpay_signature: 'forged',
      },
    },
    { authorization: '' }
  );
  assert.equal(r.status, 401, r.text);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, 'auth_required');
  const after = await request('GET', '/api/bookings');
  assert.equal((after.body.data || []).length, (before.body.data || []).length, 'guest rejection must not write a booking');
});

test('POST /api/bookings/create stores an authenticated booking (no owner id sent)', async (t) => {
  skipUnlessMock(t);
  const r = await request('POST', '/api/bookings/create', {
    booking: VALID_BOOKING,
    notifications: [{ user_email: 'owner@salon.com', title: 'New booking', message: 'A guest booked.' }],
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.success, true);
  assert.equal(r.body.paymentVerified, false);
  // Template (non-uuid) service ids must never reach Postgres as invalid FK.
  assert.equal(r.body.data.service_id, null);
  assert.equal(r.body.data.service_name, VALID_BOOKING.service_name);
  assert.equal(r.body.data.metadata.service_id, VALID_BOOKING.service_id);
});

test('POST /api/bookings/create accepts a booking missing every optional field', async (t) => {
  skipUnlessMock(t);
  // Only the required fields; no email, no payment, no notification payload.
  const minimal = {
    customer_name: 'Ankit',
    customer_phone: '9876543210',
    service_name: 'Cut & Style',
    booking_date: '2026-11-01',
    time_slot: '10:00',
  };
  const r = await request('POST', '/api/bookings/create', { booking: minimal });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.success, true);
  assert.equal(r.body.data.customer_email, null);
  assert.equal(r.body.data.booking_type, undefined);
});

test('POST /api/bookings/create rejects an incomplete payload with HTTP 400', async () => {
  const r = await request('POST', '/api/bookings/create', { booking: { customer_name: '' } });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, 'invalid_booking');
  assert.ok(r.body.fieldErrors.customer_name, 'fieldErrors should name the missing field');
});

test('POST /api/bookings/create rejects a malformed date with HTTP 400 (never 500)', async () => {
  const r = await request('POST', '/api/bookings/create', {
    booking: { ...VALID_BOOKING, booking_date: '02/10/2026' },
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.code, 'invalid_booking');
  assert.ok(r.body.fieldErrors.booking_date);
});

// ============================================================================
// Razorpay config + order initialization
// ============================================================================

test('GET /api/payments/razorpay/config returns the public key id (never the secret)', async () => {
  const r = await request('GET', '/api/payments/razorpay/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  const cfg = r.body;
  if (cfg.configured) {
    assert.match(cfg.keyId, /^rzp_(test|live)_/);
    assert.ok(!('keySecret' in cfg), 'the secret must never be exposed');
    assert.ok(!('secret' in cfg));
  }
});

test('POST /api/payments/razorpay/order rejects an invalid amount with HTTP 400', async () => {
  const r = await request('POST', '/api/payments/razorpay/order', { amount: 0 });
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
});

test('POST /api/payments/razorpay/order initializes an order with the gateway', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Intercept ONLY the outbound Razorpay call so the test never touches the
    // network; every other URL (incl. the local server below) is delegated to
    // the real fetch so the request() helper keeps working.
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (!url.includes('api.razorpay.com')) {
        return originalFetch(input as any, init as any);
      }
      assert.match(url, /api\.razorpay\.com\/v1\/orders$/);
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return new Response(
        JSON.stringify({
          id: 'order_e2e_test_001',
          entity: 'order',
          amount: body.amount,
          amount_paid: 0,
          amount_due: body.amount,
          currency: body.currency,
          receipt: body.receipt,
          status: 'created',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    const r = await request('POST', '/api/payments/razorpay/order', {
      amount: 188,
      currency: 'INR',
      receipt: 'NX-E2E-ORDER',
    });
    // A healthy deployment is configured (test keys present); if keys are not
    // configured the endpoint must answer a clean 503, never a 500.
    assert.ok(r.status === 200 || r.status === 503, r.text);
    if (r.status === 200) {
      assert.equal(r.body.success, true);
      assert.equal(r.body.order.id, 'order_e2e_test_001');
      assert.equal(r.body.order.amount, 18800); // ₹ → paise
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// Razorpay webhook over real HTTP (RAW body signature)
// ============================================================================

test('webhook rejects a forged signature with HTTP 400 and never 500', async () => {
  const payload = {
    entity: 'event',
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_forged', order_id: 'order_forged', amount: 18800, currency: 'INR' } } },
  };
  const { raw } = signRazorpayWebhook(payload, 'definitely-not-the-secret');
  const r = await requestRaw('/api/payments/razorpay/webhook', raw, { 'x-razorpay-signature': 'deadbeef' });
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
});

test('webhook rejects a request with no signature header', async () => {
  const payload = { entity: 'event', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } };
  const { raw } = signRazorpayWebhook(payload, currentWebhookSecret() || 'x');
  const r = await requestRaw('/api/payments/razorpay/webhook', raw);
  assert.equal(r.status, 400, r.text);
});

test('webhook accepts a genuine HMAC over the RAW bytes and updates the booking', async (t) => {
  skipUnlessMock(t);
  const secret = currentWebhookSecret();
  if (!secret) return; // cannot verify signatures without a configured secret

  const bookingRef = `NX-E2E-HOOK-${Date.now()}`;
  // 1. Persist a pending booking whose payment_id matches what the event reports.
  const created = await request('POST', '/api/bookings/create', {
    booking: { ...VALID_BOOKING, payment_id: bookingRef, payment_status: 'pending', advance_paid_amount: 0 },
  });
  assert.equal(created.status, 200, created.text);

  const event = {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_${bookingRef}`,
          order_id: 'order_e2e_hook',
          amount: 18800, // ₹188.00 in paise
          currency: 'INR',
          status: 'captured',
          notes: { booking_ref: bookingRef },
        },
      },
    },
  };
  const { raw, signature } = signRazorpayWebhook(event, secret);
  const r = await requestRaw('/api/payments/razorpay/webhook', raw, { 'x-razorpay-signature': signature });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.success, true);
  assert.equal(r.body.handled, true);
  assert.equal(r.body.updated, true);

  // 2. The booking should now read paid_deposit with the amount recorded.
  const list = await request('GET', '/api/bookings');
  const row = (list.body.data || []).find((b: any) => b.payment_id === `pay_${bookingRef}`);
  assert.ok(row, 'the booking row should exist');
  assert.equal(row.payment_status, 'paid_deposit');
  assert.equal(row.advance_paid_amount, 188);
});

test('webhook delivery is idempotent on real HTTP', async (t) => {
  skipUnlessMock(t);
  const secret = currentWebhookSecret();
  if (!secret) return;

  const bookingRef = `NX-E2E-IDEM-${Date.now()}`;
  const created = await request('POST', '/api/bookings/create', {
    booking: { ...VALID_BOOKING, payment_id: bookingRef, payment_status: 'pending', advance_paid_amount: 0 },
  });
  assert.equal(created.status, 200, created.text);

  const event = {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_${bookingRef}`,
          order_id: 'order_e2e_idem',
          amount: 18800,
          currency: 'INR',
          notes: { booking_ref: bookingRef },
        },
      },
    },
  };
  const { raw, signature } = signRazorpayWebhook(event, secret);
  const headers = { 'x-razorpay-signature': signature };
  const first = await requestRaw('/api/payments/razorpay/webhook', raw, headers);
  const second = await requestRaw('/api/payments/razorpay/webhook', raw, headers);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.updated, false, 'a replay must be a no-op');
  assert.equal(second.body.reason, 'already up to date');
});

test('webhook payment.failed flips a matching booking to failed', async (t) => {
  skipUnlessMock(t);
  const secret = currentWebhookSecret();
  if (!secret) return;

  const bookingRef = `NX-E2E-FAIL-${Date.now()}`;
  const created = await request('POST', '/api/bookings/create', {
    booking: { ...VALID_BOOKING, payment_id: bookingRef, payment_status: 'pending', advance_paid_amount: 0 },
  });
  assert.equal(created.status, 200, created.text);

  const event = {
    entity: 'event',
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: `pay_${bookingRef}`,
          order_id: 'order_e2e_fail',
          amount: 18800,
          currency: 'INR',
          error_description: 'Your card was declined.',
          notes: { booking_ref: bookingRef },
        },
      },
    },
  };
  const { raw, signature } = signRazorpayWebhook(event, secret);
  const r = await requestRaw('/api/payments/razorpay/webhook', raw, { 'x-razorpay-signature': signature });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.updated, true);

  // payment.failed does NOT rewrite payment_id (unlike a capture) — the row is
  // still addressed by its original booking reference.
  const list = await request('GET', '/api/bookings');
  const row = (list.body.data || []).find((b: any) => b.payment_id === bookingRef);
  assert.ok(row);
  assert.equal(row.payment_status, 'failed');
});

/** POST raw bytes (exactly how Razorpay sends them) to an endpoint. */
async function requestRaw(
  path: string,
  rawBody: Buffer,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
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

// ============================================================================
// Diagnostics + tenant-scoping over real HTTP (added with the "opaque HTTP 500"
// fix). These assert the contract the salon operator relies on when checkout
// misbehaves in production.
// ============================================================================

test('GET /api/health reports configuration checks and booking readiness', async () => {
  const r = await request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.checks), 'health must list individual checks');
  assert.ok(r.body.checks.some((c: any) => c.name === 'supabase_config'));
  assert.ok(r.body.checks.some((c: any) => c.name === 'service_role_key'));
  assert.ok(r.body.checks.some((c: any) => c.name === 'razorpay'));
  assert.equal(typeof r.body.bookingReady, 'boolean');
  // Keys must never be echoed back, only their presence.
  assert.equal(typeof r.body.supabase.hasServiceKey, 'boolean');
  const serialized = JSON.stringify(r.body);
  for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_ANON_KEY, process.env.RAZORPAY_KEY_SECRET]) {
    if (secret && secret.length > 8) {
      assert.equal(serialized.includes(secret), false, 'health must never echo a secret value');
    }
  }
});

test('GET /api/health?deep=1 stays JSON and does not leak secrets', async () => {
  const r = await request('GET', '/api/health?deep=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.deep, true);
  assert.ok(['ok', 'degraded'].includes(r.body.status));
});

test('GET /api/bookings never returns another salon\'s data without a scope', async (t) => {
  const r = await request('GET', '/api/bookings');
  if (mode === 'mock') {
    // Mock mode has no tenants; it may answer with the in-memory list.
    assert.equal(r.status, 200);
    return;
  }
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'owner_scope_required');
});

test('GET /api/notifications without an email is a 400, not an empty success', async () => {
  const r = await request('GET', '/api/notifications');
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
});

test('POST /api/bookings/update rejects a reschedule with no proposed slot', async () => {
  const r = await request('POST', '/api/bookings/update', { id: 'whatever', status: 'reschedule_proposed' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /proposed date and time/i);
});

test('a booking failure answer always carries success:false, code and requestId', async () => {
  const r = await request('POST', '/api/bookings/create', { booking: { customer_name: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, 'invalid_booking');
  assert.match(r.body.requestId, /^bk_/);
});

test('an unknown /api route answers JSON 404 (never an HTML page)', async () => {
  const r = await request('GET', '/api/definitely-not-a-route');
  assert.equal(r.status, 404);
  assert.equal(r.body.success, false);
});

test('a malformed JSON body is a 400 with JSON, not a 500', async () => {
  const res = await fetch(`${base}/api/bookings/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"booking": {',
  });
  const text = await res.text();
  assert.equal(res.status, 400);
  assert.match(text, /^\{/, 'the body must be JSON');
});
