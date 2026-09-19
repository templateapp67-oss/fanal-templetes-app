#!/usr/bin/env node
// ============================================================================
// Diagnoses the /partner/account-settings error
// "Could not load your security overview. Please retry."
//
// The page's security overview is ONE rpc call:
//     supabase.rpc('get_my_partner_security_overview')   (no arguments)
// so the failure is always one of four things, and this script tells you which:
//
//   1. the security migration is not applied  → PGRST202 (function not found)
//   2. PostgREST's schema cache is stale      → PGRST202 (same symptom, the
//      migration IS applied — fixed by `notify pgrst, 'reload schema';`,
//      see 20260919130100_reload_postgrest_schema_partner_security.sql)
//   3. the caller has no ACTIVE growth_partners row → 42501 "Active Growth
//      Partner required" (pending / rejected / deactivated application)
//   4. the request carried no usable JWT      → 401 / PGRST301
//
// Usage:
//   node --import tsx scripts/diagnose-partner-security-overview.mjs
//   npm run diagnose:partner-security
//
// With SUPABASE_URL + a key in the environment it checks the live project;
// otherwise it checks the local PGlite chain the dev server uses.
// ============================================================================

const SECURITY_RPCS = [
  'get_my_partner_security_overview',
  'revoke_my_other_partner_sessions',
  'set_my_partner_two_factor',
  'request_my_partner_account_deactivation',
  'cancel_my_partner_account_deactivation',
  'log_my_partner_security_event',
];

const SECURITY_TABLES = ['partner_account_settings', 'partner_security_events', 'partner_deactivation_requests'];

/** The codes the browser sees, and what each one means for this page. */
function explain(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  if (code === 'PGRST202' || /could not find the function|schema cache/i.test(message)) {
    return 'MISSING FROM THE SCHEMA CACHE — apply supabase/migrations/20260919130000_partner_account_security_settings.sql, then run `notify pgrst, \'reload schema\';` (20260919130100 does exactly that).';
  }
  if (code === '42501' || /active growth partner required|permission denied/i.test(message)) {
    return 'CALLER IS NOT AN ACTIVE PARTNER — the RPC executed and refused on authorization (pending/rejected/deactivated application, or the EXECUTE grant is missing).';
  }
  if (code === 'PGRST301' || code === '401' || /jwt|no api key|unauthorized/i.test(message)) {
    return 'NO USABLE JWT — the request reached PostgREST without a signed-in session, so the page cannot read the overview.';
  }
  if (/network|fetch failed|timeout|connection/i.test(message)) {
    return 'TRANSPORT FAILURE — the request never reached the backend (network/DNS/offline).';
  }
  if (code === '42883' || /does not exist/i.test(message)) {
    return 'FUNCTION DOES NOT EXIST IN THIS DATABASE — the security migration is not applied.';
  }
  return 'UNCLASSIFIED — the page shows the generic retry copy for this one.';
}

function ok(line) { console.log(`   ✅ ${line}`); }
function bad(line) { console.log(`   ❌ ${line}`); }
function warn(line) { console.log(`   ⚠️  ${line}`); }

async function checkLive() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || (!serviceKey && !anonKey)) return null;

  const { createClient } = await import('@supabase/supabase-js');
  const key = serviceKey || anonKey;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`🔍 Live project: ${url}`);
  console.log(`   key: ${serviceKey ? 'service_role' : 'anon'} (an anon-key check can only see what a signed-out browser sees)`);

  console.log('\n   Tables:');
  for (const table of SECURITY_TABLES) {
    const { error } = await client.from(table).select('id').limit(1);
    if (error && (error.code === '42P01' || /does not exist/i.test(error.message || ''))) bad(`${table} — MISSING`);
    else if (error) ok(`${table} — present (${error.code || error.message.slice(0, 60)})`);
    else ok(`${table} — present`);
  }

  console.log('\n   Security RPCs:');
  let callable = 0;
  for (const rpc of SECURITY_RPCS) {
    const { error } = await client.rpc(rpc, {});
    if (!error) { ok(`${rpc} — callable`); callable += 1; continue; }
    if (error.code === 'PGRST202' || /could not find the function|schema cache|does not exist/i.test(error.message || '')) {
      bad(`${rpc} — ${explain(error)}`);
    } else {
      ok(`${rpc} — installed (${error.code || error.message.slice(0, 60)})`);
      callable += 1;
    }
  }
  console.log(`\n📊 ${callable}/${SECURITY_RPCS.length} security RPCs reachable, ${SECURITY_TABLES.length} tables checked.`);
  if (callable < SECURITY_RPCS.length) {
    console.log('   Next step: apply the security migration, then reload the schema cache');
    console.log("   (SQL editor: notify pgrst, 'reload schema';)");
  }
  return { callable };
}

async function checkLocal() {
  console.log('\n🔍 Local PGlite chain (the same migrations `npm run dev` applies):');
  const { createLocalDatabase } = await import('../server/localSupabase.ts');
  const local = await createLocalDatabase();
  try {
    for (const table of SECURITY_TABLES) {
      const found = await local.db.query('select to_regclass($1) as present', [`public.${table}`]);
      if (found.rows[0]?.present) ok(`${table} — present`);
      else bad(`${table} — MISSING`);
    }
    for (const rpc of SECURITY_RPCS) {
      const found = await local.db.query(
        `select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [rpc],
      );
      if (found.rows.length) ok(`${rpc} — installed`);
      else bad(`${rpc} — MISSING`);
    }
    // The real call, as an ACTIVE partner sees it.
    const partner = await local.db.query(
      `select gp.user_id from public.growth_partners gp limit 1`,
    );
    const row = partner.rows[0];
    if (!row) {
      warn('no growth_partners row locally — sign up a partner and approve it to exercise the RPC');
      return;
    }
    const overview = await local.asRequest({ sub: row.user_id, isAdmin: false }, (db) =>
      db.query('select public.get_my_partner_security_overview() as result'),
    );
    ok(`get_my_partner_security_overview() returned ${Object.keys(overview.rows[0]?.result || {}).length} keys for an active partner`);
  } finally {
    await local.close();
  }
}

const live = await checkLive();
if (!live) {
  warn('No SUPABASE_URL + key in the environment — checking the local chain instead.');
  console.log('   (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to check a hosted project)');
}
await checkLocal();
console.log('\nIf the page still shows the error while everything above is green, the cause is');
console.log("the caller's session, not the schema: the component now shows the classified");
console.log('reason (session / forbidden / unavailable / network) in the error card itself.');
