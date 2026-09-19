#!/usr/bin/env node
// Verifies payout requests / withdrawals schema specifically
import { createLocalDatabase } from '../server/localSupabase.ts';

const REQUIRED_TABLES = [
  'partner_earnings',
  'partner_payout_requests',
  'partner_level_definitions',
];

const REQUIRED_RPCS = [
  'get_my_partner_earnings',
  'get_my_partner_payout_requests',
  'request_my_partner_payout',
  'cancel_my_partner_payout_request',
  'my_active_partner_id',
];

async function main() {
  console.log('=== Withdrawals Page Schema Verification ===\n');
  console.log('Migrations required:');
  console.log(' - 20260918035349_partner_portal_operations.sql');
  console.log(' - 20260919120000_partner_portal_section_reads.sql\n');

  const local = await createLocalDatabase();
  const db = local.db;

  console.log('Checking tables...');
  for (const t of REQUIRED_TABLES) {
    const res = await db.query(`select to_regclass('public.${t}') as exists`);
    console.log(res.rows[0].exists ? `✅ ${t}` : `❌ MISSING ${t}`);
  }

  console.log('\nChecking RPCs for withdrawals...');
  for (const rpc of REQUIRED_RPCS) {
    const res = await db.query(`select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname=$1`, [rpc]);
    console.log(res.rows.length ? `✅ ${rpc}()` : `❌ MISSING ${rpc}()`);
  }

  console.log('\nChecking RLS policies for payout requests...');
  const policies = await db.query(`
    select polname from pg_policy where polrelid='public.partner_payout_requests'::regclass order by polname
  `);
  console.log(`Found ${policies.rows.length} policies:`);
  policies.rows.forEach(r => console.log(` - ${r.polname}`));

  console.log('\nChecking grants for authenticated role...');
  const grants = await db.query(`
    select table_name, privilege_type from information_schema.role_table_grants
    where grantee='authenticated' and table_name in ('partner_earnings','partner_payout_requests')
    order by table_name, privilege_type
  `);
  grants.rows.forEach(r => console.log(` - ${r.table_name}: ${r.privilege_type}`));

  console.log('\nSimulating withdrawals page load for a partner...');
  // Create a test partner
  const userRes = await db.query(`insert into auth.users(id,email,encrypted_password,email_confirmed_at) values (gen_random_uuid(), 'withdraw@test.example', 'test', now()) returning id`);
  const userId = userRes.rows[0].id;
  await db.query(`insert into public.growth_partners(user_id, referral_code, is_active) values ($1, 'WITHDRAW1', true)`, [userId]);
  const partnerId = (await db.query(`select id from public.growth_partners where user_id=$1`, [userId])).rows[0].id;

  // Add a referral and earning
  const referred = await db.query(`insert into auth.users(id,email,encrypted_password,email_confirmed_at) values (gen_random_uuid(), 'referred@test.example', 'test', now()) returning id`);
  const refId = (await db.query(`insert into public.partner_referrals(partner_id, referral_code, referred_user_id, status, registered_at, first_clicked_at) values ($1, 'WITHDRAW1', $2, 'active', now(), now()) returning id`, [partnerId, referred.rows[0].id])).rows[0].id;
  await db.query(`select public.record_partner_subscription_commission($1, $2, $3, now())`, [refId, 'inv-withdraw-test', 1000000]);
  // Release after 8 days
  await local.asRequest({ sub: null, isAdmin: true }, async (conn) => {
    await conn.query(`select public.release_partner_earnings(now() + interval '8 days')`);
  });

  // Now call the RPCs as that user (simulating frontend)
  const earnings = await local.asRequest({ sub: userId, isAdmin: false }, async (conn) => {
    const r = await conn.query(`select public.get_my_partner_earnings(1,0) as data`);
    return r.rows[0].data;
  });
  console.log(`\n✅ get_my_partner_earnings: available_paise=${earnings.totals.available_paise}, lifetime=${earnings.totals.lifetime_paise}`);

  const payouts = await local.asRequest({ sub: userId, isAdmin: false }, async (conn) => {
    const r = await conn.query(`select public.get_my_partner_payout_requests(10,0) as data`);
    return r.rows[0].data;
  });
  console.log(`✅ get_my_partner_payout_requests: total=${payouts.total}, open_amount=${payouts.open_amount_paise}`);

  // Request a payout
  const payoutReq = await local.asRequest({ sub: userId, isAdmin: false }, async (conn) => {
    const r = await conn.query(`select public.request_my_partner_payout(60000, 'upi', 'partner@okbank') as data`);
    return r.rows[0].data;
  });
  console.log(`✅ request_my_partner_payout: id=${payoutReq.id.slice(0,8)}..., status=${payoutReq.status}, amount=${payoutReq.amount_paise}`);

  // Cancel it
  const cancelled = await local.asRequest({ sub: userId, isAdmin: false }, async (conn) => {
    const r = await conn.query(`select public.cancel_my_partner_payout_request($1::uuid) as data`, [payoutReq.id]);
    return r.rows[0].data;
  });
  console.log(`✅ cancel_my_partner_payout_request: status=${cancelled.status}`);

  await local.close();

  console.log('\n=== ✅ Withdrawals schema fully functional ===');
  console.log('Frontend will now load:');
  console.log(' - Balance via get_my_partner_earnings');
  console.log(' - Payout list via get_my_partner_payout_requests');
  console.log(' - Request/cancel via request_my_partner_payout / cancel_my_partner_payout_request');
  console.log('\nIf you see "Your payout requests could not load..." in UI,');
  console.log('apply migrations via:');
  console.log('  npx supabase db push');
  console.log('or SQL Editor with files:');
  console.log('  supabase/migrations/20260918035349_partner_portal_operations.sql');
  console.log('  supabase/migrations/20260919120000_partner_portal_section_reads.sql');
}

main().catch(e => { console.error(e); process.exit(1); });
