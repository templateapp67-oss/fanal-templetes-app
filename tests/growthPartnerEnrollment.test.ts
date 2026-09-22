// ============================================================================
// Direct Growth Partner enrollment — real SQL, real database.
//
// The live symptom behind these tests: a signed-in account opens
// /partner/login or /partner/dashboard and reads
//
//   "Could not verify your Growth Partner access. Please try again."
//
// That page error is what the login screen renders when the verification read
// or the automatic enrollment throws. The enrollment RPC
// (public.ensure_my_growth_partner, migration 20260922091000) is the piece that
// lets an account provision itself, so its contract is verified here against
// the actual migration SQL through the local Postgres-compatible gateway —
// the same migration text that is applied to Supabase.
//
// Contract asserted:
//   1. a signed-in account with no partner row provisions itself;
//   2. it is idempotent (same referral code, exactly one row);
//   3. it can never touch another account (no user-id argument exists at all);
//   4. an administratively suspended partner is NOT reactivated;
//   5. an anonymous caller is refused, and the function is SECURITY DEFINER
//      with a pinned search_path (so it cannot be hijacked via search_path);
//   6. the dashboard read works immediately afterwards (the journey the
//      denial screen promises: enroll → dashboard).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';

test('the enrollment migration ships in the local gateway chain (the RPC the login page calls)', () => {
  assert.ok(
    LOCAL_GROWTH_CHAIN.includes('20260922091000_direct_growth_partner_dashboard_access.sql'),
    'ensure_my_growth_partner() must be loadable, or the login recovery path cannot be exercised'
  );
});

test('ensure_my_growth_partner() provisions the caller, is idempotent, never touches another account and never reactivates a suspended partner', async () => {
  const local = await createLocalDatabase();
  const db = local.db;

  const rpc = (actor: string | null, name: string, args: any[] = [], admin = false): Promise<any> =>
    local.asRequest({ sub: actor, isAdmin: admin }, async (conn) =>
      (await conn.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)).rows[0].r
    );

  const user = async (name: string) => {
    const id = randomUUID();
    await db.query(
      "insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'test-only',$3::jsonb)",
      [id, `${id}@example.com`, JSON.stringify({ full_name: name })]
    );
    return id;
  };

  const partnerRows = async (id: string) => {
    const result = await db.query('select user_id, referral_code, is_active from public.growth_partners where user_id=$1', [id]);
    return result.rows;
  };

  try {
    // 5 (first half). Anonymous: the EXECUTE grant is authenticated-only, so the
    // database refuses before the function body even runs.
    await assert.rejects(
      rpc(null, 'ensure_my_growth_partner'),
      /permission denied|Sign in required/i,
      'an anonymous caller must never be able to provision a partner row'
    );

    // 1. Provisioning: a brand-new signed-in account becomes an active partner.
    const partner = await user('Partner Anita');
    const first = await rpc(partner, 'ensure_my_growth_partner');
    assert.equal(first.user_id, partner);
    assert.match(String(first.referral_code), /^NEXORA-/, 'a usable referral code is issued');
    assert.equal(first.is_active, true);

    // 2. Idempotent: calling it again returns the same row, never a second one.
    const second = await rpc(partner, 'ensure_my_growth_partner');
    assert.deepEqual(second, first);
    assert.equal((await partnerRows(partner)).length, 1);

    // 3. It cannot be aimed at somebody else: the function takes no argument at
    //    all, so there is no user id (or partner id) to pass.
    const signature = await db.query(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ensure_my_growth_partner'`
    );
    assert.equal(signature.rows.length, 1, 'exactly one enrollment function exists');
    assert.equal(signature.rows[0].args, '', 'no arguments: the identity comes from auth.uid() only');

    const bystander = await user('Somebody Else');
    const stillMine = await rpc(partner, 'ensure_my_growth_partner');
    assert.equal(stillMine.user_id, partner);
    assert.equal((await partnerRows(bystander)).length, 0, 'a bystander account is untouched');

    // 4. Suspension is administrative and permanent until an admin lifts it:
    //    re-running enrollment must not flip the row back to active.
    await db.query('update public.growth_partners set is_active=false where user_id=$1', [partner]);
    const afterSuspension = await rpc(partner, 'ensure_my_growth_partner');
    assert.equal(afterSuspension.is_active, false, 'an inactive partner stays inactive');
    assert.equal(afterSuspension.referral_code, first.referral_code, 'the code is not rotated on a read');

    // 5 (second half). SECURITY DEFINER with a pinned search_path.
    const properties = await db.query(
      `select p.prosecdef as definer, p.proconfig as config, p.proacl as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ensure_my_growth_partner'`
    );
    assert.equal(properties.rows[0].definer, true, 'must be SECURITY DEFINER to provision its own row');
    assert.match(String(properties.rows[0].config), /search_path/, 'search_path must be pinned');

    // 6. The journey the denial screen promises: enroll, then the dashboard
    //    answers for that same caller. This is what a partner sees after the
    //    "Instantly Approve & Access" action.
    const fresh = await user('Partner Bala');
    await rpc(fresh, 'ensure_my_growth_partner');
    const dashboard = await rpc(fresh, 'get_my_partner_dashboard');
    assert.ok(dashboard && typeof dashboard === 'object', 'the dashboard RPC answers for the enrolled partner');
    assert.equal(Number(dashboard.kpis?.total_referrals ?? NaN), 0, 'a fresh partner starts at zero referrals');
    assert.equal(dashboard.partner?.is_active, true);
    assert.equal(dashboard.partner?.referral_code, (await partnerRows(fresh))[0].referral_code);
  } finally {
    await local.close();
  }
});
