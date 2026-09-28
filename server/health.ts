// ============================================================================
// GET /api/health — one endpoint that answers "why is checkout failing?"
//
// The opaque "Server error (HTTP 500)" at checkout had two production causes
// that were invisible from the outside:
//   • the Supabase client threw at import time (URL set, anon key missing), so
//     the whole function crashed before any handler ran, and
//   • the database never answered, so the platform killed the invocation.
//
// `GET /api/health` reports the configuration PLUS one lightweight round-trip
// that proves the configured API key is actually ACCEPTED by the project —
// config presence checks alone stayed green while every query was refused
// with code 401/PGRST301 (the production "database is not configured"
// incident: health answered ok while /api/site failed for every slug).
// `GET /api/health?deep=1` also round-trips the bookings/profiles tables and
// reports whether an authenticated booking could actually
// be written right now (owner resolvable + bookings table reachable).
// Nothing secret is returned — keys are reported as booleans only, and database
// failures surface as their Postgres/PostgREST error CODE plus a sanitized
// message, never as key material.
// ============================================================================

import { runDb, LOOKUP_DB_TIMEOUT_MS } from './dbGuard.js';
import { isCredentialRejection } from './safeError.js';
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

/**
 * Turn a failed database probe into an operator-actionable check detail.
 * Includes the raw error CODE (safe: Postgres/PostgREST codes carry no
 * secrets) and, when present, a short sanitized message — never a key.
 * `keyName` is the environment variable whose key the probe presented, so the
 * fix ("re-copy this key from the project and redeploy") is unambiguous.
 */
export function describeProbeFailure(error: any, keyName: string, host: string | null): { detail: string; problem: string } {
  const code = String(error?.code ?? '').trim() || 'unknown';
  const raw = String(error?.message ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const suffix = raw ? ` — ${raw}` : '';
  if (isCredentialRejection(error)) {
    return {
      detail:
        `The database refused this deployment's API key (code ${code})${suffix}. ` +
        `The ${keyName} configured here is not accepted by ${host || 'the Supabase project'}: ` +
        're-copy SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from that project (Project Settings → API), keep SUPABASE_URL in sync, then redeploy.',
      problem: `database access rejected (code ${code}) — update ${keyName} for ${host || 'the Supabase project'} and redeploy`,
    };
  }
  if (code === '42501') {
    return {
      detail: `Permission denied by the database (code 42501)${suffix}. The configured key lacks access to this table (missing grants, or a non-service key blocked by Row Level Security).`,
      problem: `database permission denied (code 42501) — check table grants and ${keyName}`,
    };
  }
  return {
    detail: `Database probe failed (code ${code})${suffix}`,
    problem: `database probe failed (code ${code})`,
  };
}

/** Which key a probe through `db` presented: admin client ⇒ service role. */
function probeKeyName(hasAdminClient: boolean): string {
  return hasAdminClient ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY';
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

    // --- lightweight credential probe (always, except deep/mocked) --------
    // Presence checks above cannot see a WRONG key: a deployment whose
    // SUPABASE_SERVICE_ROLE_KEY belongs to another project (or was rotated
    // away) reported health "ok" while every single query was refused with
    // 401/PGRST301 — and every public site answered "database is not
    // configured". One head-only round-trip proves the key is ACCEPTED.
    // Skipped when ?deep=1 (its bookings probe below covers the same ground).
    if (!deep && !deps.isMock && deps.supabaseConfig.mode !== 'mock') {
      const accessProbe = await runDb(
        // GET (not head:true): a HEAD response carries no body, so supabase-js
        // can only report {message:''} with no code for it — the exact
        // artifact that made the old connection report say "unreadable" and
        // would hide a 401/PGRST301 rejection behind "code unknown".
        () => deps.db.from('profiles').select('id').limit(1),
        {
          label: 'health: api key acceptance probe',
          timeoutMs: LOOKUP_DB_TIMEOUT_MS,
          deadlineAt: res.locals?.requestDeadlineAt,
          retry: false,
        }
      );
      if (accessProbe.error) {
        const described = describeProbeFailure(accessProbe.error, probeKeyName(deps.hasAdminClient), deps.supabaseConfig.urlHost);
        checks.push({ name: 'database_access', ok: false, detail: described.detail });
        problems.push(described.problem);
      } else {
        checks.push({
          name: 'database_access',
          ok: true,
          detail: `Project reachable and the configured API key was accepted (${accessProbe.durationMs ?? 0}ms).`,
        });
      }
    }

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
    if (deep && !deps.isMock && deps.supabaseConfig.mode !== 'mock') {
      const keyName = probeKeyName(deps.hasAdminClient);
      const bookingsProbe = await runDb(
        () => deps.db.from('bookings').select('id').limit(1),
        {
          label: 'health: bookings table',
          timeoutMs: LOOKUP_DB_TIMEOUT_MS,
          deadlineAt: res.locals?.requestDeadlineAt,
          retry: false,
        }
      );
      if (bookingsProbe.error) {
        const described = describeProbeFailure(bookingsProbe.error, keyName, deps.supabaseConfig.urlHost);
        checks.push({ name: 'bookings_table', ok: false, detail: described.detail });
        problems.push(`bookings table: ${described.problem}`);
      } else {
        checks.push({ name: 'bookings_table', ok: true, detail: `Reachable in ${bookingsProbe.durationMs}ms.` });
      }

      const ownerProbe = await runDb(() => deps.db.from('profiles').select('id').limit(1), {
        label: 'health: profiles table',
        timeoutMs: LOOKUP_DB_TIMEOUT_MS,
        deadlineAt: res.locals?.requestDeadlineAt,
        retry: false,
      });
      const ownerCount = Array.isArray(ownerProbe.data) ? ownerProbe.data.length : 0;
      if (ownerProbe.error) {
        const described = describeProbeFailure(ownerProbe.error, keyName, deps.supabaseConfig.urlHost);
        checks.push({ name: 'owner_resolvable', ok: false, detail: described.detail });
        problems.push(`owner table: ${described.problem}`);
      } else {
        checks.push({
          name: 'owner_resolvable',
          ok: ownerCount > 0,
          detail:
            ownerCount > 0
              ? 'At least one salon profile exists, so authenticated bookings can be attached to an owner.'
              : 'No salon profiles exist yet — authenticated bookings will be rejected with owner_unresolved until a salon is published (or DEFAULT_OWNER_ID is set).',
        });
        if (ownerCount === 0) {
          problems.push('No salon profile exists — authenticated bookings cannot resolve an owner_id.');
        }
      }
    }

    const bookingReady =
      deps.isMock ||
      (checks.find((c) => c.name === 'supabase_config')?.ok === true &&
        checks.find((c) => c.name === 'service_role_key')?.ok === true &&
        (checks.find((c) => c.name === 'database_access')?.ok ?? true) &&
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
