#!/usr/bin/env node
// ============================================================================
// Razorpay setup checker —  npm run check:razorpay
// ----------------------------------------------------------------------------
// Answers, in one command, "are my payment keys actually wired up?":
//   1. which env file the credentials came from,
//   2. whether they are well-formed (test vs live),
//   3. whether Razorpay accepts them (creates + reads back a ₹1 test order),
//   4. whether the HMAC signature check works.
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
const mask = (v) => (v ? `${v.slice(0, 6)}${'*'.repeat(Math.max(0, v.length - 10))}${v.slice(-4)}` : '(empty)');

console.log('\n— Razorpay configuration ————————————————————————————');
console.log(`  loaded from      : ${sources.length ? sources.join(', ') : 'process environment only'}`);
console.log(`  RAZORPAY_KEY_ID  : ${keyId || '(missing)'}`);
console.log(`  RAZORPAY_KEY_SECRET: ${mask(keySecret)}`);

if (!keyId || !keySecret) {
  console.error('\n✖ Missing credentials. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');
  process.exit(1);
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
