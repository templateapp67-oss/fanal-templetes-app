// ============================================================================
// GET /api/health — one endpoint that answers "why is checkout failing?"
//
// The opaque "Server error (HTTP 500)" at checkout had two production causes
// that were invisible from the outside:
//   • the Supabase client threw at import time (URL set, anon key missing), so
//     the whole function crashed before any handler ran, and
//   • the database never answered, so the platform killed the invocation.
//
// `GET /api/health` reports the configuration; `GET /api/health?deep=1` also
// round-trips the database and reports whether an authenticated booking could actually
// be written right now (owner resolvable + bookings table reachable).
// Nothing secret is returned — keys are reported as booleans only.
// ============================================================================

import { runDb, LOOKUP_DB_TIMEOUT_MS } from './dbGuard.js';
import { safeDatabaseError } from './safeError.js';
import { describeRazorpayGateway } from './razorpay.js';
import { isWebhookConfigured } from './razorpayWebhook.js';

export interface HealthDeps {
  db: any;
  isMock: boolean;
  hasAdminClient: boolean;
  supabaseConfig: {
    mode: 'live' | 'mock';
    hasUrl: boolean;
    hasAnonKey: boolean;
    hasServiceKey: boolean;
    issues: string[];
    clientError: string | null;
    urlHost: string | null;
  };
  /** Which entrypoint answered — useful when only one of the two is deployed. */
  entrypoint: string;
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function createHealthHandler(deps: HealthDeps) {
  return async function health(req: any, res: any): Promise<void> {
    const deep = req.query?.deep === '1' || req.query?.deep === 'true';
    const gateway = describeRazorpayGateway();

    const checks: HealthCheck[] = [];
    const problems: string[] = [];

    // --- configuration --------------------------------------------------
    checks.push({
      name: 'supabase_config',
      ok: deps.isMock ? true : deps.supabaseConfig.issues.length === 0,
      detail: deps.isMock
        ? 'Running in mock mode (no Supabase configured) — bookings are stored in memory only.'
        : deps.supabaseConfig.issues.join(' ') || `Connected to ${deps.supabaseConfig.urlHost}.`,
    });
    if (deps.supabaseConfig.clientError) {
      problems.push(`Supabase client could not be created: ${deps.supabaseConfig.clientError}`);
    }
    // Mock mode is a legitimate state (preview/sandbox/CI) — the "no Supabase"
    // notes are informational there, not problems.
    if (!deps.isMock) {
      for (const issue of deps.supabaseConfig.issues) problems.push(issue);
    }

    checks.push({
      name: 'service_role_key',
      ok: deps.isMock ? true : deps.hasAdminClient,
      detail: deps.hasAdminClient
        ? 'Service-role client active — authenticated booking inserts bypass RLS.'
        : deps.isMock
          ? 'Not required in mock mode.'
          : 'SUPABASE_SERVICE_ROLE_KEY is missing: authenticated booking inserts will be rejected by Row Level Security.',
    });

    // live/test: real keys. mock: no keys on a non-production runtime, the
    // checkout runs against the simulated gateway (a legitimate dev/preview
    // state, reported ok). disabled: no keys in production → pay-at-salon.
    checks.push({
      name: 'razorpay',
      ok: gateway.ready,
      detail: `[${gateway.mode}] ${gateway.summary}`,
    });
    for (const warning of gateway.warnings) problems.push(`razorpay: ${warning}`);

    checks.push({
      name: 'razorpay_webhook',
      ok: isWebhookConfigured(),
      detail: isWebhookConfigured()
        ? 'Webhook signature verification ready.'
        : 'RAZORPAY_WEBHOOK_SECRET not set — incoming webhooks are rejected with 503.',
    });

    // --- deep checks (one round-trip each) --------------------------------
    if (deep && !deps.isMock) {
      const bookingsProbe = await runDb(
        () => deps.db.from('bookings').select('id').limit(1),
        {
          label: 'health: bookings table',
          timeoutMs: LOOKUP_DB_TIMEOUT_MS,
          deadlineAt: res.locals?.requestDeadlineAt,
          retry: false,
        }
      );
      const bookingsSafeError = bookingsProbe.error
        ? safeDatabaseError(bookingsProbe.error, 'The bookings table could not be checked.')
        : null;
      checks.push({
        name: 'bookings_table',
        ok: !bookingsProbe.error,
        detail: bookingsSafeError
          ? bookingsSafeError.message
          : `Reachable in ${bookingsProbe.durationMs}ms.`,
      });
      if (bookingsSafeError) problems.push(`bookings table: ${bookingsSafeError.message}`);

      const ownerProbe = await runDb(() => deps.db.from('profiles').select('id').limit(1), {
        label: 'health: profiles table',
        timeoutMs: LOOKUP_DB_TIMEOUT_MS,
        deadlineAt: res.locals?.requestDeadlineAt,
        retry: false,
      });
      const ownerCount = Array.isArray(ownerProbe.data) ? ownerProbe.data.length : 0;
      const ownerSafeError = ownerProbe.error
        ? safeDatabaseError(ownerProbe.error, 'The salon owner table could not be checked.')
        : null;
      checks.push({
        name: 'owner_resolvable',
        ok: !ownerProbe.error && ownerCount > 0,
        detail: ownerSafeError
          ? ownerSafeError.message
          : ownerCount > 0
            ? 'At least one salon profile exists, so authenticated bookings can be attached to an owner.'
            : 'No salon profiles exist yet — authenticated bookings will be rejected with owner_unresolved until a salon is published (or DEFAULT_OWNER_ID is set).',
      });
      if (ownerSafeError) {
        problems.push(`owner table: ${ownerSafeError.message}`);
      } else if (!ownerProbe.error && ownerCount === 0) {
        problems.push('No salon profile exists — authenticated bookings cannot resolve an owner_id.');
      }
    }

    const bookingReady =
      deps.isMock ||
      (checks.find((c) => c.name === 'supabase_config')?.ok === true &&
        checks.find((c) => c.name === 'service_role_key')?.ok === true &&
        (checks.find((c) => c.name === 'bookings_table')?.ok ?? true));

    res.json({
      status: problems.length === 0 ? 'ok' : 'degraded',
      app: 'Nexora Salon OS',
      entrypoint: deps.entrypoint,
      mode: deps.isMock ? 'mock' : 'live',
      /** live | test | mock | disabled — which payment gateway serves checkout. */
      paymentMode: gateway.mode,
      bookingReady,
      supabase: {
        host: deps.supabaseConfig.urlHost,
        hasUrl: deps.supabaseConfig.hasUrl,
        hasAnonKey: deps.supabaseConfig.hasAnonKey,
        hasServiceKey: deps.supabaseConfig.hasServiceKey,
        clientError: deps.supabaseConfig.clientError,
      },
      checks,
      problems,
      deep,
      timestamp: new Date().toISOString(),
    });
  };
}
