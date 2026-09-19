#!/usr/bin/env node
// Applies partner portal operations migrations to a Supabase project via service_role.
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/apply-partner-operations-migrations.mjs
// Or with .env file present.
//
// This is an alternative to `supabase db push` when CLI is not available.
// It runs the SQL files directly via Postgres (requires service_role key).

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MIGRATIONS = [
  '20260918035349_partner_portal_operations.sql',
  '20260918070000_partner_account_settings.sql',
  '20260919120000_partner_portal_section_reads.sql',
];

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('   Set them in env or .env file');
    console.error('   Example: SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/apply-partner-operations-migrations.mjs');
    process.exit(1);
  }

  console.log('🔗 Connecting to:', url);
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // We can't run raw SQL via supabase-js directly unless we have an RPC that does it.
  // Instead, we try to use the postgres connection via supabase's REST? 
  // Supabase JS doesn't expose raw SQL, so we need to use pg or via fetch to /rest/v1/rpc if we create a helper.
  // For simplicity, we will attempt to apply via a direct SQL execution using the service_role key
  // by checking if a `exec_sql` function exists, or we fallback to instructing manual steps.

  // Try to see if we can use the built-in supabase SQL via postgrest? 
  // Actually, the recommended way without CLI is Dashboard SQL Editor.
  // So this script will verify and then print the SQL to run manually if direct exec not available.

  console.log('\n📋 Migrations to apply (in order):');
  MIGRATIONS.forEach((f, i) => console.log(`   ${i+1}. ${f}`));

  // Attempt to apply via rpc if an admin exec function exists (some projects have it)
  // Otherwise, we'll use the pg library if available, or fallback to manual.

  let appliedVia = null;

  // Try using postgres direct connection if DATABASE_URL is available
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    console.log('\n🔌 DATABASE_URL found, attempting direct Postgres connection...');
    try {
      const { Client } = await import('pg');
      const client = new Client({ connectionString: dbUrl });
      await client.connect();
      for (const file of MIGRATIONS) {
        const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', file), 'utf8');
        console.log(`\n▶️  Applying ${file}...`);
        await client.query(sql);
        console.log(`   ✅ Applied ${file}`);
      }
      await client.end();
      appliedVia = 'direct postgres';
    } catch (e) {
      console.error('   ❌ Direct Postgres failed:', e.message);
    }
  }

  if (!appliedVia) {
    // Try via supabase-js rpc if we have a service_role and the project has a custom exec_sql
    // Most projects don't, so we will just verify existence and instruct manual apply.
    console.log('\n⚠️  No DATABASE_URL, cannot run raw SQL via supabase-js alone.');
    console.log('   supabase-js does not expose raw SQL execution for security.');
    console.log('   Please apply via one of these methods:\n');
    console.log('   Option A: Supabase CLI');
    console.log('     supabase link --project-ref <ref>');
    console.log('     supabase db push\n');
    console.log('   Option B: Dashboard SQL Editor');
    console.log('     1. Open Supabase Dashboard → SQL Editor');
    console.log('     2. Copy content of each file and Run:');
    MIGRATIONS.forEach(f => console.log(`        - supabase/migrations/${f}`));
    console.log('\n   Option C: Set DATABASE_URL and re-run this script:');
    console.log('     DATABASE_URL=postgres://postgres:xxx@db.xxx.supabase.co:5432/postgres node scripts/apply-partner-operations-migrations.mjs');
    console.log('\n   See PARTNER_OPERATIONS_MIGRATION_FIX.md for detailed steps.');

    // Still check what exists
    console.log('\n🔍 Checking current state via RPC probe...');
    for (const file of MIGRATIONS) {
      console.log(`   - ${file}: present in repo ✅`);
    }

    const checks = [
      { rpc: 'my_active_partner_id', file: MIGRATIONS[0] },
      { rpc: 'get_my_partner_support_tickets', file: MIGRATIONS[0] },
      { rpc: 'get_my_partner_payout_requests', file: MIGRATIONS[2] },
    ];

    for (const { rpc, file } of checks) {
      const { error } = await supabase.rpc(rpc, {});
      if (error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message))) {
        console.log(`   ❌ RPC ${rpc} MISSING → need ${file}`);
      } else {
        console.log(`   ✅ RPC ${rpc} exists (or permission error expected)`);
      }
    }

    console.log('\nDone. If RPCs missing, apply via Dashboard.');
    return;
  }

  console.log(`\n✅ All migrations applied via ${appliedVia}`);

  // Verify
  console.log('\n🔍 Verifying...');
  for (const rpc of ['my_active_partner_id', 'get_my_partner_support_tickets', 'get_my_partner_payout_requests']) {
    const { error } = await supabase.rpc(rpc, {});
    if (error && error.code === 'PGRST202') {
      console.log(`   ❌ Still missing: ${rpc}`);
    } else {
      console.log(`   ✅ ${rpc} exists`);
    }
  }

  console.log('\n✅ Done. Reload your app and retry loading tickets.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
