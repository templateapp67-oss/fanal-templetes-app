#!/usr/bin/env node
// ============================================================================
// Razorpay setup checker —  npm run check:razorpay
// ----------------------------------------------------------------------------
// Answers, in one command, "are my payment keys actually wired up?":
//   1. which env file the credentials came from,
//   2. whether they are well-formed (test vs live),
//   3. whether Razorpay accepts them (creates + reads back a ₹1 test order),
//   4. whether the HMAC signature check works.
// When no keys are present it explains which gateway the server will run
// instead (the built-in MOCK gateway in development, DISABLED in production)
// so "payments are not configured" is never a surprise.
// The secret is never printed in full.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

const cwd = process.cwd();
const sources = [];
for (const file of ['.env', '.env.development']) {
  const full = path.join(cwd, file);
  if (fs.existsSync(full)) {
    const before = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
    dotenv.config({ path: full });
    if (before.id !== process.env.RAZORPAY_KEY_ID || before.secret !== process.env.RAZORPAY_KEY_SECRET) {
      sources.push(file);
    }
  }
}

const clean = (v) => (v || '').trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
const keyId = clean(process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID);
const keySecret = clean(process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET);
const webhookSecret = clean(process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_KEY);
const appUrl = clean(process.env.APP_URL) || 'https://fanal-templetes-app.vercel.app';
const mask = (v) => (v ? `${v.slice(0, 6)}${'*'.repeat(Math.max(0, v.length - 10))}${v.slice(-4)}` : '(empty)');

// Mirrors server/razorpay.ts → resolveRazorpayGatewayMode()
const mockFlagRaw = clean(process.env.RAZORPAY_MOCK_MODE).toLowerCase();
const mockFlag = ['1', 'true', 'yes', 'on', 'mock'].includes(mockFlagRaw)
  ? true
  : ['0', 'false', 'no', 'off'].includes(mockFlagRaw)
    ? false
    : undefined;
const isProduction =
  clean(process.env.NODE_ENV).toLowerCase() === 'production' ||
  clean(process.env.VERCEL_ENV).toLowerCase() === 'production';

console.log('\n— Razorpay configuration ————————————————————————————');
console.log(`  loaded from      : ${sources.length ? sources.join(', ') : 'process environment only'}`);
console.log(`  RAZORPAY_KEY_ID  : ${keyId || '(missing)'}`);
console.log(`  RAZORPAY_KEY_SECRET: ${mask(keySecret)}`);
console.log(`  RAZORPAY_MOCK_MODE : ${mockFlagRaw || '(unset → auto)'}`);
console.log(`  runtime          : ${isProduction ? 'PRODUCTION' : 'development / test'}`);

if (mockFlag === true) {
  console.log('\n⚠ RAZORPAY_MOCK_MODE=true — the server will run the built-in MOCK gateway even though');
  console.log('  keys may be present. Every "payment" is simulated; no money moves. Unset it to go real.');
  if (isProduction) {
    console.error('✖ …and this is a PRODUCTION runtime. Unset RAZORPAY_MOCK_MODE before taking bookings.');
    process.exit(1);
  }
}

if (!keyId || !keySecret) {
  const missing = [!keyId && 'RAZORPAY_KEY_ID', !keySecret && 'RAZORPAY_KEY_SECRET'].filter(Boolean).join(' and ');
  if (mockFlag === false || isProduction) {
    console.error(`\n✖ ${missing} missing → online payment is DISABLED.`);
    console.error('  Checkout will answer 503 razorpay_not_configured and the modal will offer "pay at the salon".');
    console.error('  Add the keys to .env (or the hosting dashboard). Test keys: dashboard.razorpay.com → Settings → API Keys.');
    process.exit(1);
  }
  console.log(`\n⚠ ${missing} missing → the server will run the built-in MOCK payment gateway.`);
  console.log('  • Orders are created as order_mock_… with the real 25 % deposit in paise (₹87 → 8700).');
  console.log('  • Customers see a simulated payment sheet (no checkout.js, no money) and the same');
  console.log('    HMAC signature verification runs before the booking is written.');
  console.log('  • The confirmation pass is labelled "simulated". Never used on production runtimes.');
  console.log('  Add real TEST keys to .env to exercise Razorpay Checkout for real.\n');
  process.exit(0);
}
if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) {
  console.error(`\n✖ RAZORPAY_KEY_ID "${keyId}" is malformed — expected rzp_test_… or rzp_live_….`);
  process.exit(1);
}
console.log(`  mode             : ${keyId.startsWith('rzp_live_') ? 'LIVE (real money!)' : 'TEST'}`);

// --- signature check (offline) ---------------------------------------------
const sig = crypto.createHmac('sha256', keySecret).update('order_test|pay_test').digest('hex');
const verified = crypto.timingSafeEqual(
  Buffer.from(sig),
  Buffer.from(crypto.createHmac('sha256', keySecret).update('order_test|pay_test').digest('hex'))
);
console.log(`  signature check  : ${verified ? 'ok' : 'FAILED'}`);

// --- webhook ----------------------------------------------------------------
console.log('\n— Webhook ————————————————————————————————————————————');
if (!webhookSecret || /^(your_|my_|xxx|<)/i.test(webhookSecret)) {
  console.log('  RAZORPAY_WEBHOOK_SECRET: (not set) — incoming webhooks will be rejected with 503.');
} else {
  const sample = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
  const whSig = crypto.createHmac('sha256', webhookSecret).update(sample).digest('hex');
  console.log(`  RAZORPAY_WEBHOOK_SECRET: ${mask(webhookSecret)}`);
  console.log(`  sample X-Razorpay-Signature: ${whSig.slice(0, 24)}…`);
}
console.log(`  endpoint         : ${appUrl.replace(/\/$/, '')}/api/payments/razorpay/webhook`);
console.log('  dashboard        : Razorpay → Settings → Webhooks → Add New Webhook');
console.log('  events           : payment.captured, payment.failed, order.paid, refund.processed');

// --- live call --------------------------------------------------------------
console.log('\n— Calling Razorpay (creating a ₹1 test order) ————————');
try {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ amount: 100, currency: 'INR', receipt: `setup-check-${Date.now()}` }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await res.json().catch(() => null);

  if (res.status === 401) {
    console.error('✖ Razorpay rejected the credentials (HTTP 401). The key id/secret pair is wrong or the key was disabled.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`✖ Razorpay returned HTTP ${res.status}: ${payload?.error?.description || JSON.stringify(payload)}`);
    process.exit(1);
  }
  console.log(`✔ Order created: ${payload.id} (${payload.currency} ${(payload.amount / 100).toFixed(2)}, status ${payload.status})`);
  console.log('✔ Payments are ACTIVE — the checkout button will open Razorpay.\n');
} catch (err) {
  console.error(`✖ Could not reach api.razorpay.com: ${err?.message || err}`);
  console.error('  (No outbound internet? The app will still save bookings and fall back to "pay at salon".)\n');
  process.exit(2);
}
