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
