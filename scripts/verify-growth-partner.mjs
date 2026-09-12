#!/usr/bin/env node
// ============================================================================
// Growth Partner area — live setup verifier.
//
// Answers one question with evidence instead of guesswork: "is the Growth
// Partner area actually set up on this Supabase project?"
//
//   node scripts/verify-growth-partner.mjs [path/to/.env]
//   node scripts/verify-growth-partner.mjs .env --provision-email you@example.com
//
// Checks (read-only unless --provision-email is passed):
//   1. env: SUPABASE_URL + anon key + service-role key present and not
//      placeholders — without them the app runs in mock mode and the area
//      shows "Growth Partner area needs a live connection".
//   2. tables: growth_partners / growth_partner_applications /
//      growth_onboarding exist and are exposed over PostgREST.
//   3. schema generation: reports whether growth_partners carries is_active
//      (the schema this repository ships) or the older status/partner_code
//      shape, because the two need different function bodies.
//   4. functions the UI calls: get_my_growth_partner, get_my_partner_dashboard,
//      get_my_partner_referrals, get_my_partner_performance,
//      submit_growth_partner_application, review_growth_partner_application.
//      A missing function (PGRST202) means a migration was never applied.
//   5. fail-closed: an anonymous caller must NOT be able to read
//      get_my_growth_partner().
//   6. queue: pending applications + approved partners, so an admin can see
//      what needs reviewing (and with which SQL).
//
// Exit code 0 = every check passed, 1 = something is missing (each failure
// prints the exact next step).
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const envPath = args.find((arg) => !arg.startsWith('--')) || '.env';
const provisionEmailFlag = args.indexOf('--provision-email');
const provisionEmail = provisionEmailFlag >= 0 ? args[provisionEmailFlag + 1] : null;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

if (!existsSync(envPath)) {
  fail(
    `No env file at "${envPath}".\n` +
      'Next step: copy .env.example to .env (or run `npm run setup:env`) and fill in\n' +
      'SUPABASE_URL, SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY and\n' +
      'SUPABASE_SERVICE_ROLE_KEY, then re-run this script.'
  );
}

const env = parse(readFileSync(envPath, 'utf8'));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';

const isPlaceholder = (value) =>
  !value ||
  /placeholder|your_|^xxx|^</i.test(value) ||
  value === 'YOUR_SUPABASE_ANON_KEY' ||
  value === 'YOUR_SUPABASE_SERVICE_ROLE_KEY';

console.log(`Growth Partner setup check — ${envPath}\n`);

// --- 1. environment ---------------------------------------------------------
record(
  'SUPABASE_URL is set',
  !!url && !isPlaceholder(url),
  url && !isPlaceholder(url) ? new URL(url).host : 'missing or a placeholder — the app runs in mock mode'
);
record(
  'anon key is set (browser auth + the area reads)',
  !!anonKey && !isPlaceholder(anonKey),
  anonKey && !isPlaceholder(anonKey) ? 'present' : 'missing — sign-in and every area read fail'
);
record(
  'service-role key is set (admin provisioning)',
  !!serviceKey && !isPlaceholder(serviceKey),
  serviceKey && !isPlaceholder(serviceKey)
    ? 'present (server-side only — never ship it to the browser)'
    : 'missing — partner approval/provisioning cannot run'
);

if (!url || isPlaceholder(url) || !anonKey || isPlaceholder(anonKey)) {
  fail(
    '\nStopped: the Supabase connection is not configured, which is exactly why the\n' +
      'area shows "Growth Partner area needs a live connection".\n' +
      'See GROWTH_PARTNER_SETUP.md for the full order (env → migrations → approval).'
  );
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, anonKey, clientOptions);
const admin = createClient(url, serviceKey, clientOptions);

/** Classify a PostgREST error the way the checks need it. */
function classify(error) {
  const code = error?.code || '';
  const message = error?.message || String(error || '');
  if (code === 'PGRST202' || /could not find the function/i.test(message)) return 'missing-function';
  if (code === 'PGRST205' || /could not find the table/i.test(message)) return 'missing-table';
  if (code === 'PGRST204' || /could not find the .* in the schema cache/i.test(message)) return 'missing-column';
  if (code === '42501' || /permission denied|access required|sign in required/i.test(message)) return 'denied';
  return `error(${code || 'unknown'})`;
}

// --- 2. tables --------------------------------------------------------------
for (const table of ['growth_partners', 'growth_partner_applications', 'growth_onboarding']) {
  const { error } = await admin.from(table).select('*', { count: 'exact', head: true });
  const kind = error ? classify(error) : null;
  record(
    `table public.${table} exists`,
    kind !== 'missing-table',
    kind === 'missing-table'
      ? 'not found — apply the Growth Partner migrations (see GROWTH_PARTNER_SETUP.md)'
      : error
        ? `present, but not readable with this key (${kind})`
        : 'present'
  );
}

// --- 3. schema generation ---------------------------------------------------
{
  const { error } = await admin.from('growth_partners').select('is_active').limit(1);
  const kind = error ? classify(error) : null;
  record(
    'growth_partners uses the is_active column (this repository’s schema)',
    kind !== 'missing-column',
    kind === 'missing-column'
      ? 'this project carries the older status/partner_code generation — apply 20260919_growth_partner_area_contract_alignment.sql, which serves both'
      : 'is_active present — the dashboard RPCs and the area gate agree on one schema'
  );
}

// --- 4. the functions the UI calls -----------------------------------------
const FUNCTION_CHECKS = [
  ['get_my_growth_partner', {}, 'the area gate (fetchMyGrowthPartnerRow)'],
  ['get_my_partner_dashboard', {}, 'Dashboard section'],
  ['get_my_partner_referrals', { p_status_filter: 'all', p_limit: 1, p_offset: 0 }, 'Referrals + Customers sections'],
  ['get_my_partner_performance', {}, 'Performance section'],
  ['submit_growth_partner_application', { p_full_name: '', p_phone: null, p_kyc_document_type: '', p_kyc_document_reference: '' }, 'partner sign-up form'],
  ['review_growth_partner_application', { p_application_id: '00000000-0000-4000-8000-000000000000', p_approve: false }, 'admin KYC review'],
];

for (const [fn, payload, usedBy] of FUNCTION_CHECKS) {
  const { error } = await admin.rpc(fn, payload);
  const kind = error ? classify(error) : null;
  // Anything other than "function not found" means the function exists: a
  // validation error (22023), a denied admin call (42501) or a clean result are
  // all proof the migration was applied.
  record(
    `function public.${fn}() exists — ${usedBy}`,
    kind !== 'missing-function',
    kind === 'missing-function'
      ? 'PGRST202: not exposed — the migration that creates it was never applied'
      : error
        ? `present (${kind}: ${error.message?.slice(0, 90)})`
        : 'present'
  );
}

// --- 5. fail closed for anonymous callers ----------------------------------
{
  const { error } = await anon.rpc('get_my_growth_partner');
  const kind = error ? classify(error) : null;
  record(
    'anonymous callers cannot read get_my_growth_partner()',
    !!error && kind !== 'missing-function',
    error ? `denied as expected (${kind})` : 'NOT DENIED — RLS/grants on the area are wrong'
  );
}

// --- 6. application queue + approved partners ------------------------------
{
  const { data: pending, error: pendingError } = await admin
    .from('growth_partner_applications')
    .select('id, full_name, kyc_status, status, created_at')
    .in('status', ['pending'])
    .order('created_at', { ascending: true });
  if (!pendingError) {
    record(
      'pending applications read',
      true,
      pending.length === 0
        ? 'queue empty — nobody is waiting for a review'
        : `${pending.length} waiting: ${pending
            .slice(0, 5)
            .map((row) => `${row.full_name} (${row.kyc_status}, ${row.id})`)
            .join('; ')}${pending.length > 5 ? '; …' : ''}`
    );
  } else {
    record('pending applications read', false, classify(pendingError));
  }

  const { count, error: partnerError } = await admin
    .from('growth_partners')
    .select('user_id', { count: 'exact', head: true });
  record(
    'approved partners count',
    !partnerError,
    partnerError ? classify(partnerError) : `${count ?? 0} partner row(s) in growth_partners`
  );
}

// --- optional: provision a partner (documented admin shortcut) -------------
if (provisionEmail) {
  console.log(`\nProvisioning ${provisionEmail} …`);
  const { data, error } = await admin.rpc('provision_growth_partner_by_email', {
    p_email: provisionEmail,
  });
  if (error) {
    record(
      'provision_growth_partner_by_email',
      false,
      `${classify(error)}: ${error.message}\n      If the function is missing, apply 20260916_part1_referral_hardening.sql, or approve the\n      application instead: select public.review_growth_partner_application('<application id>', true);`
    );
  } else {
    record(
      'provision_growth_partner_by_email',
      true,
      `partner ready — referral code ${data?.referral_code}, is_active=${data?.is_active}`
    );
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('Fix the FAIL lines above; GROWTH_PARTNER_SETUP.md has the exact SQL and order.');
  process.exit(1);
}
console.log('The Growth Partner area is wired end to end on this project.');
