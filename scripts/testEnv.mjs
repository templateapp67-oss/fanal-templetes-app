// ============================================================================
// Test-run prelude (loaded with `node --import ./scripts/testEnv.mjs`).
//
// Keeps test-run configuration out of application code: it marks the process as
// a test run so boot-time environment notices (Supabase placeholder keys,
// Razorpay mock-mode summary) stay out of the test output. Those notices are
// about the developer environment, not about the code under test, and printing
// them once per test file buries real failures.
//
// Application behavior is unchanged while tests run; background timers are
// disposed after each file and known console noise is suppressed.
// Dev (`npm run dev`) and production never load this file.
// ============================================================================

import { register } from 'node:module';
import { after } from 'node:test';

// SDK refresh timers and jsdom windows may outlive the tests that created them.
// Clean them up only after the file's tests finish. --test-force-exit can cut
// off buffered worker reports, making a green run omit completed test cases.
const pendingTimers = new Set();
const originalClearTimeout = globalThis.clearTimeout;
const originalClearInterval = globalThis.clearInterval;
for (const name of ['setTimeout', 'setInterval']) {
  globalThis[name] = new Proxy(globalThis[name], {
    apply(target, receiver, args) {
      const timer = Reflect.apply(target, receiver, args);
      pendingTimers.add(timer);
      return timer;
    },
  });
}
function disposeTestResources() {
  for (const timer of pendingTimers) {
    originalClearTimeout(timer);
    originalClearInterval(timer);
  }
  pendingTimers.clear();
}
after(disposeTestResources);

try {
  register('./imageLoader.mjs', import.meta.url);
} catch {
  // Graceful fallback if module.register is not supported
}

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

// A dedicated marker rather than NODE_ENV: some tests deliberately set NODE_ENV
// themselves (e.g. the mock-gateway checkout test exercises a non-test runtime),
// and that must not bring the environment banners back into the output.
process.env.NEXORA_TEST_RUN = '1';

// ---------------------------------------------------------------------------
// Operational log noise.
//
// The suites deliberately drive failure and fallback paths — a rejected
// booking, a refused webhook, a save that falls back to the server route — and
// the application logs each one. Those logs are correct behaviour, but repeated
// across 1100+ tests they bury real failures. Only the known operational
// prefixes are filtered, and only during a test run: an unexpected log still
// prints, and dev/production logging is untouched because those never load this
// file. No application code is involved, so runtime behaviour cannot drift.
// ---------------------------------------------------------------------------
const QUIET_LOG_PREFIXES = [
  '[Nexora Sync Error]',
  '[Nexora Sync]',
  '[Bookings]',
  '[Razorpay]',
  '[Razorpay webhook]',
  '[owner-booking]',
  '[owner-appointment]',
  '[AutoSave]',
  '[Website save]',
  '[Site lookup]',
  '[MyBookings]',
  '[Customer]',
  '[Notifications]',
  '[API]',
  '[DB]',
];

const isKnownOperationalLog = (args) => {
  const first = args[0];
  return typeof first === 'string' && QUIET_LOG_PREFIXES.some((prefix) => first.startsWith(prefix));
};

for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    if (!isKnownOperationalLog(args)) original(...args);
  };
}
