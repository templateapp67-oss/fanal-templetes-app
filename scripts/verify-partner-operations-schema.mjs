#!/usr/bin/env node
// Verifies partner operations schema is applied, via Supabase JS client if env set,
// or via PGlite local chain if LOCAL_SUPABASE=true or no env.
// Usage: node scripts/verify-partner-operations-schema.mjs
import { readFileSync } from 'fs';

const EXPECTED_TABLES = [
  'partner_earnings',
  'partner_payout_requests',
  'partner_level_definitions',
  'partner_notifications',
  'partner_notification_preferences',
  'partner_marketing_assets',
  'partner_support_tickets',
  'partner_support_attachments',
  'partner_account_settings',
];

const EXPECTED_RPCS = [
  'my_active_partner_id',
  'get_my_partner_earnings',
  'get_my_partner_payout_requests',
  'cancel_my_partner_payout_request',
  'get_my_partner_support_tickets',
  'submit_my_partner_support_ticket',
  'get_my_partner_notifications',
  'mark_my_partner_notifications_read',
  'get_my_partner_notification_preferences',
  'update_my_partner_notification_preferences',
  'get_partner_marketing_assets',
  'get_partner_marketing_asset_categories',
  'get_my_partner_levels',
  'get_partner_leaderboard',
  'request_my_partner_payout',
  'get_my_partner_account_settings',
  'save_my_partner_account_settings',
  'record_partner_subscription_commission',
  'release_partner_earnings',
  'admin_mark_partner_payout_paid',
];

async function checkViaSupabaseClient() {
  console.log('🔍 Checking via Supabase client (env vars)...');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || (!serviceKey && !anonKey)) {
    console.log('⚠️  No SUPABASE_URL + key found in env, skipping live check.');
    console.log('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to check cloud project.');
    return null;
  }

  // Dynamic import to avoid bundling issues
  const { createClient } = await import('@supabase/supabase-js');
  const key = serviceKey || anonKey;
  const client = createClient(url, key, { auth: { persistSession: false } });

  console.log(`   URL: ${url}`);
  console.log(`   Using ${serviceKey ? 'service_role' : 'anon'} key`);

  // Check tables via information_schema if service_role, else try rpc existence
  let tablesOk = 0;
  let rpcsOk = 0;

  for (const table of EXPECTED_TABLES) {
    const { error } = await client.from(table).select('id').limit(1);
    if (!error || error.code === 'PGRST116' || error.message?.includes('0 rows') || (error.code && error.code !== '42P01' && !error.message.includes('does not exist'))) {
      // Table exists (even if RLS denies, error would be permission, not 42P01)
      // Actually check for 42P01 = undefined_table
      if (error && (error.code === '42P01' || /does not exist/i.test(error.message))) {
        console.log(`   ❌ Table missing: ${table} — ${error.message}`);
      } else {
        tablesOk++;
        console.log(`   ✅ Table exists: ${table}`);
      }
    } else if (error && error.code === '42P01') {
      console.log(`   ❌ Table missing: ${table}`);
    } else {
      // Could be RLS permission denied, which means table exists
      tablesOk++;
      console.log(`   ✅ Table exists (RLS protected): ${table}`);
    }
  }

  for (const rpc of EXPECTED_RPCS) {
    const { error } = await client.rpc(rpc, {});
    // PGRST202 = function not found, 42501 = permission / active partner required (means exists)
    if (error) {
      if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message) || /does not exist/i.test(error.message)) {
        console.log(`   ❌ RPC missing: ${rpc} — ${error.message}`);
      } else {
        rpcsOk++;
        console.log(`   ✅ RPC exists: ${rpc} (error expected: ${error.code || error.message.slice(0,60)})`);
      }
    } else {
      rpcsOk++;
      console.log(`   ✅ RPC exists: ${rpc}`);
    }
  }

  console.log(`\n📊 Live project: ${tablesOk}/${EXPECTED_TABLES.length} tables, ${rpcsOk}/${EXPECTED_RPCS.length} RPCs`);
  return { tablesOk, rpcsOk };
}

async function checkViaPGlite() {
  console.log('\n🔍 Checking via local PGlite chain (LOCAL_GROWTH_CHAIN)...');
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const { LOCAL_GROWTH_CHAIN, LOCAL_DATABASE_BOOTSTRAP } = await import('../server/localSupabase.ts');

    const db = new PGlite();
    await db.exec(LOCAL_DATABASE_BOOTSTRAP);
    for (const file of LOCAL_GROWTH_CHAIN) {
      const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
      await db.exec(sql);
    }

    let tablesOk = 0;
    for (const table of EXPECTED_TABLES) {
      const res = await db.query(`select to_regclass('public.${table}') as exists`);
      if (res.rows[0].exists) {
        tablesOk++;
        console.log(`   ✅ Table exists: ${table}`);
      } else {
        console.log(`   ❌ Table missing: ${table}`);
      }
    }

    let rpcsOk = 0;
    for (const rpc of EXPECTED_RPCS) {
      const res = await db.query(`select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname=$1`, [rpc]);
      if (res.rows.length > 0) {
        rpcsOk++;
        console.log(`   ✅ RPC exists: ${rpc}`);
      } else {
        console.log(`   ❌ RPC missing: ${rpc}`);
      }
    }

    // Check RLS
    console.log('\n🔒 RLS checks:');
    for (const table of EXPECTED_TABLES) {
      const res = await db.query(`select relrowsecurity from pg_class where relname=$1 and relnamespace='public'::regnamespace`, [table]);
      if (res.rows[0]?.relrowsecurity) {
        console.log(`   ✅ RLS enabled: ${table}`);
      } else {
        console.log(`   ⚠️  RLS NOT enabled: ${table}`);
      }
    }

    await db.close();
    console.log(`\n📊 Local PGlite: ${tablesOk}/${EXPECTED_TABLES.length} tables, ${rpcsOk}/${EXPECTED_RPCS.length} RPCs`);
    return { tablesOk, rpcsOk };
  } catch (e) {
    console.error('Failed PGlite check:', e);
    return null;
  }
}

async function main() {
  console.log('=== Partner Operations Schema Verification ===\n');
  console.log('Expected migrations:');
  console.log(' - supabase/migrations/20260918035349_partner_portal_operations.sql');
  console.log(' - supabase/migrations/20260918070000_partner_account_settings.sql');
  console.log(' - supabase/migrations/20260919120000_partner_portal_section_reads.sql\n');

  const live = await checkViaSupabaseClient();
  const local = await checkViaPGlite();

  console.log('\n=== Summary ===');
  if (live) {
    if (live.tablesOk === EXPECTED_TABLES.length && live.rpcsOk === EXPECTED_RPCS.length) {
      console.log('✅ Live project: schema fully applied');
    } else {
      console.log('❌ Live project: schema INCOMPLETE');
      console.log('   Fix: supabase db push OR run SQL files in Dashboard SQL Editor');
      console.log('   See PARTNER_OPERATIONS_MIGRATION_FIX.md');
    }
  }
  if (local) {
    if (local.tablesOk === EXPECTED_TABLES.length && local.rpcsOk === EXPECTED_RPCS.length) {
      console.log('✅ Local PGlite chain: schema fully applied');
    } else {
      console.log('❌ Local chain incomplete — check server/localSupabase.ts LOCAL_GROWTH_CHAIN');
    }
  }

  if (!live && !local) {
    console.log('No checks succeeded. Ensure dependencies installed: npm install');
  }
}

main().catch(console.error);
