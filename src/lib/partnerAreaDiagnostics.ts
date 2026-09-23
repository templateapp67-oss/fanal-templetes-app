// ============================================================================
// Growth Partner area — live diagnosis of a failed load.
//
// The user-visible question behind a broken `/partner/dashboard` is always one
// of three:
//
//   • "is this my browser / my connection?"          → checks 1–3
//   • "is this my account / a permission problem?"   → checks 4–6
//   • "is this the service being down or un-set-up?" → checks 4–6
//
// This module answers all three by ASKING the live service, from the signed-in
// browser session, and reports what each call actually said. It is the same
// sequence the area's gate performs (gate read → dashboard read), so the report
// describes the real failing call instead of a guess.
//
// Two rules it will not break:
//   1. It never mutates. `ensure_my_growth_partner()` is deliberately NOT
//      called (it can CREATE the caller's partner record); it is reported as
//      "not probed" with the reason, because a diagnostic must not change the
//      account it is diagnosing.
//   2. It never prints a token, key or row value. Only classified causes, error
//      codes and the allow-listed detail slice from `partnerAreaFailure.ts`.
// ============================================================================

import {
  buildPartnerAreaSupportReport,
  classifyPartnerAreaFailure,
  maskPartnerAreaEmail,
  readPartnerAreaErrorDetail,
  PARTNER_AREA_ENROLLMENT_MIGRATION,
  PARTNER_AREA_SETUP_DOC,
  type PartnerAreaFailure,
  type PartnerAreaReportCheck,
} from './partnerAreaFailure';
import { isMockSupabase, supabase, supabaseConfig } from './supabaseClient';

/** Every probe is bounded: a hanging request must not hang the screen. */
const PROBE_TIMEOUT_MS = 8000;

export interface PartnerAreaDiagnosticReport {
  checkedAt: string;
  route: string | null;
  online: boolean | null;
  session: { signedIn: boolean; email?: string | null; expiresAt?: string | null } | null;
  projectHost: string | null;
  failure: PartnerAreaFailure;
  checks: PartnerAreaReportCheck[];
}

function withTimeout<T>(work: PromiseLike<T>, ms = PROBE_TIMEOUT_MS, label = 'Request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`), { code: 'PROBE_TIMEOUT' }));
    }, ms);
    // Node keeps the event loop alive for a pending timer; the browser ignores
    // `unref`. Without this a test run would sit for PROBE_TIMEOUT_MS.
    (timer as unknown as { unref?: () => void }).unref?.();
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * The ONLY RPCs the diagnostic may call. Both are reads.
 *
 * `ensure_my_growth_partner()` is deliberately absent: it provisions the
 * caller's partner row, so probing it would change the account under test. The
 * guard below makes that structural — a future edit that tries to probe it
 * fails loudly instead of silently mutating a partner's account.
 */
export const PARTNER_AREA_READ_ONLY_PROBES = ['get_my_growth_partner', 'get_my_partner_dashboard'] as const;

/** The probe plan, exposed so a test can pin the read-only rule. */
export function findDiagnosticProbeFunctionNames(): string[] {
  return [...PARTNER_AREA_READ_ONLY_PROBES];
}

function probeRpc(fn: (typeof PARTNER_AREA_READ_ONLY_PROBES)[number], args: Record<string, unknown> = {}) {
  if (!PARTNER_AREA_READ_ONLY_PROBES.includes(fn)) {
    throw new Error(`${fn} is not a read-only diagnostic probe`);
  }
  return withTimeout(supabase.rpc(fn, args), PROBE_TIMEOUT_MS, `${fn} probe`);
}

function browserOnline(): boolean | null {
  if (typeof navigator === 'undefined') return null;
  const value = (navigator as Navigator).onLine;
  return typeof value === 'boolean' ? value : null;
}

/** One-line, allow-listed description of a probe failure. */
function describe(error: unknown): string {
  const failure = classifyPartnerAreaFailure(error);
  const { code, status } = readPartnerAreaErrorDetail(error);
  const suffix = [code, status ? `HTTP ${status}` : null].filter(Boolean).join(' · ');
  const detail = failure.safeDetail ? ` — ${failure.safeDetail}` : '';
  return `${failure.label}${suffix ? ` [${suffix}]` : ''}${detail}`;
}

/**
 * Probe the live service from the current browser session and classify what it
 * finds. Never throws; a probe that cannot run is reported as `skipped`.
 */
export async function runPartnerAreaDiagnostics(input: {
  error: unknown;
  route?: string | null;
  /**
   * The cause the caller already classified (the service layer does). Preferred
   * over re-classifying `error`: a caller that only kept a message string would
   * otherwise lose the contract field / error code the report needs.
   */
  failure?: PartnerAreaFailure | null;
}): Promise<PartnerAreaDiagnosticReport> {
  const online = browserOnline();
  const failure = input.failure ?? classifyPartnerAreaFailure(input.error, { online });
  const checks: PartnerAreaReportCheck[] = [];
  let session: PartnerAreaDiagnosticReport['session'] = null;

  // 1. Connection state — cheap, local, and decisive when false.
  checks.push(
    online === null
      ? { id: 'online', label: 'Browser connection state', status: 'skipped', detail: 'not reported by this browser' }
      : online
        ? { id: 'online', label: 'Browser reports a connection', status: 'pass' }
        : {
            id: 'online',
            label: 'Browser reports a connection',
            status: 'fail',
            detail: 'the browser says this device is offline — reconnect, then retry',
          }
  );

  // 2. Is this build even pointed at a project?
  if (isMockSupabase) {
    checks.push({
      id: 'project',
      label: 'Supabase project configured',
      status: 'fail',
      detail: `this build runs without a Supabase project (mock mode), so no real partner data can be read. ${
        supabaseConfig.issues[0] ?? 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
      }`,
    });
    return {
      checkedAt: new Date().toISOString(),
      route: input.route ?? null,
      online,
      session: null,
      projectHost: null,
      failure,
      checks: [
        ...checks,
        {
          id: 'live',
          label: 'Live checks',
          status: 'skipped',
          detail: 'no project to probe — every other check needs a live Supabase connection',
        },
      ],
    };
  }

  checks.push({
    id: 'project',
    label: 'Supabase project configured',
    status: 'pass',
    detail: `${supabaseConfig.urlHost ?? 'project host unknown'} (host only)`,
  });

  // 3. Session: present, and still accepted by the server.
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), PROBE_TIMEOUT_MS, 'Session lookup');
    const current = data?.session ?? null;
    session = {
      signedIn: !!current,
      email: current?.user?.email ?? null,
      expiresAt: current?.expires_at ? new Date(current.expires_at * 1000).toISOString() : null,
    };
    if (!current) {
      checks.push({
        id: 'session',
        label: 'Signed-in session',
        status: 'fail',
        detail: 'no session in this browser — sign in again',
      });
    } else {
      checks.push({
        id: 'session',
        label: 'Signed-in session',
        status: 'pass',
        detail: `${maskPartnerAreaEmail(session.email) ?? 'signed in'}${session.expiresAt ? `, token expires ${session.expiresAt}` : ''}`,
      });
      try {
        const { error } = await withTimeout(supabase.auth.getUser(), PROBE_TIMEOUT_MS, 'Session verification');
        checks.push(
          error
            ? {
                id: 'session-valid',
                label: 'Session accepted by the service',
                status: 'fail',
                detail: describe(error),
              }
            : { id: 'session-valid', label: 'Session accepted by the service', status: 'pass' }
        );
      } catch (error) {
        checks.push({ id: 'session-valid', label: 'Session accepted by the service', status: 'fail', detail: describe(error) });
      }
    }
  } catch (error) {
    checks.push({ id: 'session', label: 'Signed-in session', status: 'fail', detail: describe(error) });
  }

  // 4. Database reachability — a read that returns zero rows for a non-partner
  //    is a PASS: it proves PostgREST answered and RLS decided, rather than
  //    nothing answering at all.
  try {
    const { error, count } = await withTimeout(
      supabase.from('growth_partners').select('user_id', { count: 'exact', head: true }),
      PROBE_TIMEOUT_MS,
      'Partner table read'
    );
    checks.push(
      error
        ? { id: 'database', label: 'Partner database reachable', status: 'fail', detail: describe(error) }
        : {
            id: 'database',
            label: 'Partner database reachable',
            status: 'pass',
            detail: `answered (${count ?? 0} partner row${count === 1 ? '' : 's'} visible to this account)`,
          }
    );
  } catch (error) {
    checks.push({ id: 'database', label: 'Partner database reachable', status: 'fail', detail: describe(error) });
  }

  // 5. The gate read — the area's FIRST call, and the one most likely to be the
  //    failure the user saw.
  let partnerRowVisible = false;
  try {
    const { data, error } = await probeRpc('get_my_growth_partner');
    if (error) {
      checks.push({ id: 'gate-read', label: 'Gate read (get_my_growth_partner)', status: 'fail', detail: describe(error) });
    } else {
      const row = (data ?? null) as { is_active?: boolean } | null;
      partnerRowVisible = !!row;
      checks.push({
        id: 'gate-read',
        label: 'Gate read (get_my_growth_partner)',
        status: 'pass',
        detail: row
          ? `returned your partner record (${row.is_active === false ? 'INACTIVE' : 'active'})`
          : 'returned no partner record for this account',
      });
    }
  } catch (error) {
    checks.push({ id: 'gate-read', label: 'Gate read (get_my_growth_partner)', status: 'fail', detail: describe(error) });
  }

  // 6. The dashboard read — what the page's data sections call next.
  try {
    const { error } = await probeRpc('get_my_partner_dashboard');
    checks.push(
      error
        ? { id: 'dashboard-read', label: 'Dashboard read (get_my_partner_dashboard)', status: 'fail', detail: describe(error) }
        : { id: 'dashboard-read', label: 'Dashboard read (get_my_partner_dashboard)', status: 'pass' }
    );
  } catch (error) {
    checks.push({ id: 'dashboard-read', label: 'Dashboard read (get_my_partner_dashboard)', status: 'fail', detail: describe(error) });
  }

  // 7. Report the one call the diagnostic deliberately does not make, so the
  //    report never implies it was checked. This matters: for an account with
  //    no partner record the gate calls it, and its absence (PGRST202) is a
  //    common cause of the very error this report is explaining.
  checks.push({
    id: 'enrollment',
    label: 'Self-enrollment call (ensure_my_growth_partner)',
    status: 'skipped',
    detail: partnerRowVisible
      ? 'not probed — it can create a partner record, and this account already has one'
      : `not probed — it can create your partner record. If this account has no partner record yet and the area still failed, this call is the failing one; the migration that creates it is ${PARTNER_AREA_ENROLLMENT_MIGRATION} (${PARTNER_AREA_SETUP_DOC}).`,
  });

  // 8. The honest verdict on the standard advice, which is what the user tried.
  checks.push({
    id: 'retry-value',
    label: 'Would refreshing / clearing cache help?',
    status: failure.retryable ? 'warn' : 'fail',
    detail: failure.retryable
      ? 'this failure can clear on its own, so retrying is worth doing'
      : 'no — a retry, a hard refresh and clearing cache/cookies cannot change this cause',
  });

  return {
    checkedAt: new Date().toISOString(),
    route: input.route ?? null,
    online,
    session,
    projectHost: supabaseConfig.urlHost,
    failure,
    checks,
  };
}

/** The report text a user copies into a support ticket. */
export function buildPartnerAreaReportFromDiagnostics(report: PartnerAreaDiagnosticReport): string {
  return buildPartnerAreaSupportReport({
    failure: report.failure,
    route: report.route,
    checkedAt: report.checkedAt,
    online: report.online,
    session: report.session,
    projectHost: report.projectHost,
    checks: report.checks,
  });
}
