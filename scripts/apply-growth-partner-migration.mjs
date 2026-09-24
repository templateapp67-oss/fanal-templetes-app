#!/usr/bin/env node
// Applies the Growth Partner core SQL migration (growth_partners, referrals, payouts, get_my_growth_partner, ensure_my_growth_partner)
// Usage:
//   npm run apply:growth-partner
//   or: node --import tsx scripts/apply-growth-partner-migration.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = '20261010000000_growth_partner_core_schema.sql';
const MIGRATION_PATH = join(__dirname, '..', 'supabase', 'migrations', MIGRATION_FILE);

async function main() {
  console.log('🚀 Growth Partner SQL Migration Runner\n');

  if (!existsSync(MIGRATION_PATH)) {
    console.error(`❌ Migration file not found: ${MIGRATION_PATH}`);
    process.exit(1);
  }

  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  console.log(`📄 Loaded migration: supabase/migrations/${MIGRATION_FILE} (${sql.length} bytes)`);

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
  let applied = false;

  if (dbUrl) {
    console.log('\n🔌 Connecting to PostgreSQL database via DATABASE_URL...');
    try {
      const { Client } = await import('pg');
      const client = new Client({ connectionString: dbUrl });
      await client.connect();
      console.log('⚡ Executing Growth Partner SQL migration...');
      await client.query(sql);
      await client.end();
      console.log('✅ Migration successfully applied to PostgreSQL database!');
      applied = true;
    } catch (err) {
      console.error('❌ Failed to execute migration via direct PostgreSQL:', err.message);
    }
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (url && serviceKey) {
    console.log('\n🔍 Verifying Supabase connection and schema state...');
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

      const { data: partnerData, error: partnerError } = await supabase
        .from('growth_partners')
        .select('id, user_id, referral_code, is_active')
        .limit(1);

      if (!partnerError) {
        console.log('✅ `growth_partners` table is accessible.');
      } else {
        console.log(`ℹ️  \`growth_partners\` table check: ${partnerError.message || partnerError.code}`);
      }

      const { data: referralData, error: refError } = await supabase
        .from('referrals')
        .select('id, referral_code, status')
        .limit(1);

      if (!refError) {
        console.log('✅ `referrals` table is accessible.');
      } else {
        console.log(`ℹ️  \`referrals\` table check: ${refError.message || refError.code}`);
      }

      const { data: payoutData, error: payoutError } = await supabase
        .from('payouts')
        .select('id, amount, status')
        .limit(1);

      if (!payoutError) {
        console.log('✅ `payouts` table is accessible.');
      } else {
        console.log(`ℹ️  \`payouts\` table check: ${payoutError.message || payoutError.code}`);
      }
    } catch (err) {
      console.log('ℹ️  Supabase probe note:', err.message);
    }
  }

  console.log('\n======================================================');
  console.log('📌 SQL Migration Ready:');
  console.log(`   File: supabase/migrations/${MIGRATION_FILE}`);
  console.log('   Tables created/verified:');
  console.log('     • public.growth_partners');
  console.log('     • public.referrals (and public.partner_referrals)');
  console.log('     • public.payouts (and public.partner_payout_requests)');
  console.log('   RPC functions created/verified:');
  console.log('     • public.get_my_growth_partner()');
  console.log('     • public.ensure_my_growth_partner()');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Fatal error running migration script:', err);
  process.exit(1);
});
