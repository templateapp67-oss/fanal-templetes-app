// ============================================================================
// Test-run prelude (loaded with `node --import ./scripts/testEnv.mjs`).
//
// Keeps test-run configuration out of application code: it marks the process as
// a test run so boot-time environment notices (Supabase placeholder keys,
// Razorpay mock-mode summary) stay out of the test output. Those notices are
// about the developer environment, not about the code under test, and printing
// them once per test file buries real failures.
//
// Nothing here changes behaviour — the same code paths run, the same values are
// returned; only the console noise is suppressed. Dev (`npm run dev`) and
// production are untouched because they never load this file.
// ============================================================================

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
