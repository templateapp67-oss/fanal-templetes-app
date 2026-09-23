#!/usr/bin/env node
// ============================================================================
// Growth Partner dashboard (/partner/dashboard) — reproduce and diagnose one
// exact failure.
//
//   node --import tsx scripts/diagnose-partner-dashboard-access.mjs .env
//   node --import tsx scripts/diagnose-partner-dashboard-access.mjs .env \
//        --email you@example.com            (password from PARTNER_DIAG_PASSWORD)
//
// Why this exists
// ---------------
// "Could not load the Growth Partner area. Could not load this section. Please
// try again." is the screen's answer for at least five different causes, and a
// support ticket cannot be triaged from it. This script walks the SAME call
// sequence the dashboard walks, from the SAME anon key the browser uses, and
// classifies every answer with the SAME classifier the screen uses
// (`src/lib/partnerAreaFailure.ts`) — so the verdict here is the verdict the
// user sees, backed by the error codes.
//
// It answers the two questions a report like that always raises:
//   • is this an account-level permission problem?  (signed-in probe)
//   • is this an API outage / a missing migration?  (anonymous probe)
//
// Without credentials it still runs the anonymous probes: a *missing* function
// answers PGRST202, an existing one refuses with 42501 "Sign in required". That
// alone separates "the migration was never applied" from "the API is down",
// which is the difference between an administrator task and waiting.
//
// Safety: read-only. The only write it can reach is
// `ensure_my_growth_partner()` (the call the dashboard itself makes, which can
// create the CALLER's own partner row) — opt out with `--no-enroll`. No secret
// is ever printed: no keys, no tokens, no row values.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import {
  buildPartnerAreaSupportReport,
  classifyPartnerAreaFailure,
} from '../src/lib/partnerAreaFailure.ts';

const args = process.argv.slice(2);
const envPath = args.find((arg) => !arg.startsWith('--')) || '.env';
const readFlag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? '' : '';
};

if (!existsSync(envPath)) {
  console.error(
    `No env file at "${envPath}".\n` +
      'Run this from the project root with the file that holds VITE_SUPABASE_URL and\n' +
      'VITE_SUPABASE_ANON_KEY (usually .env), for example:\n' +
      '  npm run diagnose:partner-dashboard -- .env --email you@example.com'
  );
  process.exit(2);
}

const env = { ...parse(readFileSync(envPath, 'utf8')), ...process.env };
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
const email = readFlag('--email') || env.PARTNER_DIAG_EMAIL || '';
const password = env.PARTNER_DIAG_PASSWORD || readFlag('--password') || '';
const allowEnroll = !args.includes('--no-enroll');

if (!url || !anonKey) {
  console.error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (the same two values the\n' +
      'browser bundle uses). Without them the app runs in mock mode and shows\n' +
      '"Growth Partner area needs a live connection" instead of this error.'
  );
  process.exit(2);
}

/** The migrations that create the calls the dashboard gate makes, by function. */
const MIGRATION_FOR_FUNCTION = {
  get_my_growth_partner: '20260919_growth_partner_area_contract_alignment.sql',
  ensure_my_growth_partner: '20260922091000_direct_growth_partner_dashboard_access.sql',
  get_my_partner_dashboard: '20260915_growth_partner_dashboard.sql',
};

const results = [];
/** Failures in the order the dashboard would hit them (gate → enrollment → data). */
const failures = [];
function record(label, outcome, detail, failure = null) {
  results.push({ label, outcome, detail });
  if (outcome === 'fail' && failure) failures.push({ label, failure });
  const marker = outcome === 'pass' ? 'PASS' : outcome === 'fail' ? 'FAIL' : 'INFO';
  console.log(`${marker}  ${label}${detail ? `\n      ${detail}` : ''}`);
}

function verdictFor(error, context) {
  const failure = classifyPartnerAreaFailure(error);
  const migration = MIGRATION_FOR_FUNCTION[context];
  const hint =
    failure.kind === 'schema-missing' && migration
      ? `apply supabase/migrations/${migration} (see GROWTH_PARTNER_SETUP.md §3, order matters)`
      : failure.nextStep;
  return { failure, hint };
}

const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`\nGrowth Partner dashboard diagnosis — ${new URL(url).host}`);
console.log(`Env file: ${envPath}   Signed-in probe: ${email ? `yes (${email.replace(/^(.).*@/, '$1•••@')})` : 'no (anonymous only)'}\n`);

// --- 1. Reachability --------------------------------------------------------
{
  const { error } = await anon.from('growth_partners').select('user_id').limit(1);
  const { failure, hint } = verdictFor(error, 'growth_partners');
  record(
    'project reachable over HTTPS + REST',
    error ? 'fail' : 'pass',
    error ? `${failure.label} (${failure.code ?? 'no code'})${failure.safeDetail ? ` — ${failure.safeDetail}` : ''}` : 'answered',
    error ? failure : null
  );
}

// --- 2. Anonymous probes: does each function EXIST? -------------------------
// A missing function is PGRST202. An existing one refuses an anonymous caller
// (42501 "Sign in required") or, for a SECURITY DEFINER enrollment call,
// refuses too — either way the migration IS applied.
for (const [fn, payload] of [
  ['get_my_growth_partner', {}],
  ['ensure_my_growth_partner', {}],
  ['get_my_partner_dashboard', {}],
]) {
  const { error } = await anon.rpc(fn, payload);
  const { failure, hint } = verdictFor(error, fn);
  const missing = failure.kind === 'schema-missing';
  record(
    `function public.${fn}() is exposed`,
    missing ? 'fail' : 'pass',
    missing ? `PGRST202: not in the schema cache — ${hint}` : `present (${failure.label}: ${failure.safeDetail ?? 'refused as expected'})`,
    missing ? failure : null
  );
}

// --- 3. Signed-in probe: the exact gate sequence -----------------------------
let failing = null;
let sessionEmail = null;
if (email && password) {
  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signedIn, error: signInError } = await user.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn?.session) {
    const { failure, hint } = verdictFor(signInError ?? { message: 'no session returned' }, 'get_my_growth_partner');
    record('sign-in for the probe', 'fail', `${failure.label} — ${hint}`, failure);
    failing = failure;
  } else {
    sessionEmail = signedIn.user?.email ?? null;
    record('sign-in for the probe', 'pass', `signed in as ${(sessionEmail ?? '').replace(/^(.).*@/, '$1•••@')}`);

    // 3a. The gate's FIRST read.
    let partnerRow = null;
    {
      const { data, error } = await user.rpc('get_my_growth_partner');
      if (error) {
        const { failure, hint } = verdictFor(error, 'get_my_growth_partner');
        record('gate read: get_my_growth_partner()', 'fail', `${failure.label} — ${hint}`, failure);
        failing = failure;
      } else {
        partnerRow = data ?? null;
        record(
          'gate read: get_my_growth_partner()',
          'pass',
          partnerRow
            ? `returned the partner record (is_active = ${partnerRow.is_active === false ? 'false — access paused' : 'true'})`
            : 'returned NO partner record for this account — the gate then calls ensure_my_growth_partner()'
        );
      }
    }

    // 3b. The enrollment call the gate makes when the row is missing.
    if (partnerRow === null && failing === null) {
      if (!allowEnroll) {
        record('enrollment: ensure_my_growth_partner()', 'info', 'skipped (--no-enroll): it can create your partner record');
      } else {
        const { error } = await user.rpc('ensure_my_growth_partner');
        const { failure, hint } = verdictFor(error, 'ensure_my_growth_partner');
        record(
          'enrollment: ensure_my_growth_partner()',
          error ? 'fail' : 'pass',
          error ? `${failure.label} — ${hint}` : 'provisioned/returned the caller’s own partner record',
          error ? failure : null
        );
        if (error) failing = failure;
      }
    }

    // 3c. The dashboard read the page loads next.
    if (failing === null) {
      const { error } = await user.rpc('get_my_partner_dashboard');
      const { failure, hint } = verdictFor(error, 'get_my_partner_dashboard');
      record(
        'dashboard read: get_my_partner_dashboard()',
        error ? 'fail' : 'pass',
        error ? `${failure.label} — ${hint}` : 'returned the dashboard payload',
        error ? failure : null
      );
      if (error) failing = failure;
    }

    await user.auth.signOut().catch(() => {});
  }
} else {
  record(
    'signed-in probe (account-level permission check)',
    'info',
    'skipped — re-run with --email you@example.com (password via PARTNER_DIAG_PASSWORD) to test YOUR account'
  );
}

// --- 4. Verdict + the same report the screen shows ---------------------------
// The gate order decides which failure is the one the user actually saw.
const failure = failing ?? failures[0]?.failure ?? null;
console.log(
  failure
    ? `\nVERDICT: ${failure.label} — ${failure.scopeSentence}\nFix: ${failure.nextStep}`
    : '\nVERDICT: every check passed' +
        (email ? ' — the gate sequence completed for this account.' : '.') +
        (email ? '' : '\nRun the signed-in probe (--email …) to check this specific account as well.')
);

if (failure) console.log(
  '\n' +
    buildPartnerAreaSupportReport({
      failure,
      route: '/partner/dashboard',
      checkedAt: new Date().toISOString(),
      online: true,
      session: email ? { signedIn: Boolean(sessionEmail), email: sessionEmail } : null,
      projectHost: new URL(url).host,
      checks: results.map((entry) => ({
        id: entry.label,
        label: entry.label,
        status: entry.outcome === 'pass' ? 'pass' : entry.outcome === 'fail' ? 'fail' : 'skipped',
        detail: entry.detail,
      })),
    })
);

process.exit(failure ? 1 : 0);
