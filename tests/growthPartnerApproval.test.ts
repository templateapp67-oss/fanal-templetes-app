// ============================================================================
// Growth Partner application → KYC review → partner access (end to end).
//
// This is the ONLY user-facing path into the Growth Partner area since the
// approval flow became KYC-based: `/growth-partner/login` submits
// `submit_growth_partner_application`, a platform admin reviews it, and the
// review is what creates the `public.growth_partners` row that every dashboard
// RPC (`partner_dashboard_caller`) requires. Until now nothing pinned that
// chain — the migrations were only exercised up to `provision_growth_partner`
// (the admin SQL shortcut), so a broken review function was invisible.
//
// Runs the real migrations against PGlite in filename order:
//   20260911094853_growth_partner_signup_approval.sql   (applications table)
//   20260911101201_growth_partner_kyc_approval.sql      (KYC columns + RPCs)
//   20260912_growth_partner_onboarding.sql              (growth_partners + RPCs)
//   20260915_growth_partner_dashboard.sql               (dashboard RPCs)
//   20260918_partner_dashboard_inactive_guard.sql       (inactive guard)
//   20260919_growth_partner_approval_alignment.sql      (approval fix)
//
// Pinned behaviour:
//   • submission requires a name, a valid KYC document type and a reference
//   • review is admin-only (42501 for applicants, no EXECUTE for anon)
//   • approval creates an ACTIVE partner row with a code that satisfies the
//     `growth_partners_code_format` CHECK, so the area unlocks immediately
//   • rejection leaves the user without partner access
//   • re-approval is idempotent and never rotates an existing referral code
//   • a paused partner is denied by the dashboard backend (fail closed)
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';

const APPLICANT = 'c0000000-0000-4000-8000-000000000001';
const APPLICANT_2 = 'c0000000-0000-4000-8000-000000000002';
const ADMIN = 'c0000000-0000-4000-8000-000000000003';
/** Auth user with NO profiles row (a project without the sign-up trigger). */
const APPLICANT_NO_PROFILE = 'c0000000-0000-4000-8000-000000000004';

/**
 * The Growth Partner chain a fresh project applies, in filename order.
 *
 * 20260911092650 / 20260911092959 are deliberately NOT here: the first is a
 * `language sql` function over `gp.status`, so Postgres validates it at CREATE
 * time and it can only ever be applied to the older production growth_partners
 * generation — never to the table 20260912 creates. Test 12 pins that, and
 * 20260919 is what supplies get_my_growth_partner() for the committed schema.
 */
const MIGRATIONS = [
  '20260911094853_growth_partner_signup_approval.sql',
  '20260911101201_growth_partner_kyc_approval.sql',
  '20260912_growth_partner_onboarding.sql',
  '20260915_growth_partner_dashboard.sql',
  '20260916_part1_referral_hardening.sql',
  '20260917_part1b_link_atomicity.sql',
  '20260918_partner_dashboard_inactive_guard.sql',
  '20260919_growth_partner_area_contract_alignment.sql',
];

async function setup() {
  // `any`: PGlite types query rows as unknown[], and every read below asserts a
  // known shape (the same convention tests/growthPartner.test.ts uses).
  const db: any = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    -- Supabase's privileged API role. Default privileges below mirror what a
    -- Supabase project does, so functions created by the migrations are
    -- executable by service_role even when a migration revokes EXECUTE from
    -- public/anon/authenticated (the admin-only review RPC does exactly that).
    create role service_role;
    alter default privileges in schema public grant execute on functions to service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;

    -- Reused by the partner RPCs for display names.
    create table public.profiles(id uuid primary key, full_name text, subdomain text, salon_name text);
    create table public.services(id uuid primary key, owner_id uuid);

    -- Production defines private.is_admin() outside this repository (the
    -- approval RPCs and the applications RLS policy both call it). The harness
    -- pins the contract those callers rely on: true only for a platform admin,
    -- driven here by a per-request setting like a JWT claim would be.
    create schema private;
    create function private.is_admin() returns boolean language sql stable as
      $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
    grant usage on schema private to authenticated, anon;
    grant execute on function private.is_admin() to authenticated, anon;

    insert into auth.users(id) values
      ('${APPLICANT}'), ('${APPLICANT_2}'), ('${ADMIN}'), ('${APPLICANT_NO_PROFILE}');
    insert into public.profiles(id, full_name) values
      ('${APPLICANT}', 'Asha Sharma'), ('${APPLICANT_2}', 'Ravi Kumar'), ('${ADMIN}', 'Platform Admin');
  `);

  for (const file of MIGRATIONS) {
    await db.exec(
      readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    );
  }
  return db;
}

/** Call an RPC as a signed-in user; returns the parsed jsonb result. */
async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `select public.${fn}(${placeholders}) as result`;
  const res = await asUser(db, userId, sql, args);
  return res.rows[0].result;
}

/**
 * Same, but as the platform admin: service_role (the role an admin console /
 * SQL Editor call uses) with the admin claim set. The review RPC has no
 * EXECUTE grant for authenticated, so this is the only way in — which is the
 * point.
 */
async function rpcAsAdmin(db: any, adminId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [adminId]);
  await db.query("select set_config('app.is_admin', 'true', false)");
  await db.exec('set role service_role');
  try {
    const res = await db.query(`select public.${fn}(${placeholders}) as result`, args);
    return res.rows[0].result;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('app.is_admin', '', false)");
  }
}

async function captureError(promise: Promise<any>) {
  try {
    await promise;
  } catch (err: any) {
    return err;
  }
  assert.fail('expected the statement to fail, but it succeeded');
}

test('1. submission is rejected without a name, a valid document type or a reference', async () => {
  const db = await setup();
  try {
    const noName = await captureError(
      rpc(db, APPLICANT, 'submit_growth_partner_application', ['  ', '9876543210', 'pan', 'ABCDE1234F'])
    );
    assert.equal(noName.code, '22023');

    const badDocType = await captureError(
      rpc(db, APPLICANT, 'submit_growth_partner_application', ['Asha Sharma', '9876543210', 'selfie', 'ABCDE1234F'])
    );
    assert.equal(badDocType.code, '22023');

    const noReference = await captureError(
      rpc(db, APPLICANT, 'submit_growth_partner_application', ['Asha Sharma', '9876543210', 'pan', '   '])
    );
    assert.equal(noReference.code, '22023');

    const anonymous = await captureError(
      rpc(db, '', 'submit_growth_partner_application', ['Nobody', null, 'pan', 'ABCDE1234F'])
    );
    assert.equal(anonymous.code, '42501');
  } finally {
    await db.close();
  }
});

test('2. a valid submission is stored as pending + KYC submitted', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.kyc_status, 'submitted');
    assert.ok(submitted.id, 'the application id is returned for the admin review');

    // The applicant can read back their own application (RLS: own row only).
    const own = await asUser(
      db,
      APPLICANT,
      "select id, status, kyc_status from public.growth_partner_applications where user_id = auth.uid()"
    );
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].kyc_status, 'submitted');

    // Nobody else's application is visible.
    const other = await asUser(
      db,
      APPLICANT_2,
      "select id from public.growth_partner_applications where user_id = auth.uid()"
    );
    assert.equal(other.rows.length, 0);
  } finally {
    await db.close();
  }
});

test('3. review is admin-only: an applicant cannot approve themselves', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);

    const selfApproval = await captureError(
      rpc(db, APPLICANT, 'review_growth_partner_application', [submitted.id, true, null])
    );
    assert.equal(selfApproval.code, '42501');

    // Still no partner row, so the area stays locked.
    const partner = await asUser(
      db,
      APPLICANT,
      "select count(*)::int as n from public.growth_partners where user_id = auth.uid()"
    );
    assert.equal(partner.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('4. approval creates an active partner the dashboard RPCs accept', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);

    const reviewed = await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [
      submitted.id,
      true,
      'KYC verified',
    ]);
    assert.equal(reviewed.status, 'approved');
    assert.equal(reviewed.kyc_status, 'approved');

    // The partner row the whole area is gated on.
    const row = await db.query(
      'select user_id, referral_code, is_active from public.growth_partners where user_id = $1',
      [APPLICANT]
    );
    assert.equal(row.rows.length, 1, 'approval must create exactly one partner row');
    assert.equal(row.rows[0].is_active, true);
    assert.match(row.rows[0].referral_code, /^[A-Z0-9]{6,12}$/, 'code must satisfy growth_partners_code_format');

    // The new partner can immediately use the area: own row + dashboard RPC.
    const mine = await rpc(db, APPLICANT, 'get_my_growth_partner');
    assert.equal(mine.referral_code, row.rows[0].referral_code);
    assert.equal(mine.is_active, true);

    const dashboard = await rpc(db, APPLICANT, 'get_my_partner_dashboard');
    assert.equal(dashboard.partner.referral_code, row.rows[0].referral_code);
    assert.equal(dashboard.kpis.total_referrals, 0);

    // A non-partner is still denied by the same backend.
    const denied = await captureError(rpc(db, APPLICANT_2, 'get_my_partner_dashboard'));
    assert.equal(denied.code, '42501');
  } finally {
    await db.close();
  }
});

test('5. rejection grants no partner access and can be resubmitted', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);
    const reviewed = await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [
      submitted.id,
      false,
      'Document unreadable',
    ]);
    assert.equal(reviewed.status, 'rejected');
    assert.equal(reviewed.kyc_status, 'rejected');

    const partner = await asUser(
      db,
      APPLICANT,
      "select count(*)::int as n from public.growth_partners where user_id = auth.uid()"
    );
    assert.equal(partner.rows[0].n, 0);

    // The applicant may submit again, which reopens the application.
    const resubmitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'aadhaar',
      '1234-5678-9012',
    ]);
    assert.equal(resubmitted.status, 'pending');
    assert.equal(resubmitted.kyc_status, 'submitted');
  } finally {
    await db.close();
  }
});

test('6. approving twice is idempotent and keeps the referral code', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);
    await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [submitted.id, true, null]);
    const first = await db.query('select referral_code from public.growth_partners where user_id = $1', [
      APPLICANT,
    ]);

    const again = await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [
      submitted.id,
      true,
      're-run',
    ]);
    assert.equal(again.status, 'approved');

    const second = await db.query('select referral_code from public.growth_partners where user_id = $1', [
      APPLICANT,
    ]);
    assert.equal(second.rows.length, 1);
    assert.equal(
      second.rows[0].referral_code,
      first.rows[0].referral_code,
      'an approved partner keeps the code their referrals were linked with'
    );
  } finally {
    await db.close();
  }
});

test('7. a paused partner is denied the dashboard backend (fail closed)', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);
    await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [submitted.id, true, null]);
    await db.query('update public.growth_partners set is_active = false where user_id = $1', [APPLICANT]);

    const denied = await captureError(rpc(db, APPLICANT, 'get_my_partner_dashboard'));
    assert.equal(denied.code, '42501');
  } finally {
    await db.close();
  }
});

test('8. an applicant with no profiles row can still apply (no FK dead end)', async () => {
  const db = await setup();
  try {
    const before = await db.query('select count(*)::int as n from public.profiles where id = $1', [
      APPLICANT_NO_PROFILE,
    ]);
    assert.equal(before.rows[0].n, 0, 'the harness leaves this user without a profile');

    const submitted = await rpc(db, APPLICANT_NO_PROFILE, 'submit_growth_partner_application', [
      'Meera Iyer',
      '9812345678',
      'aadhaar',
      '1234-5678-9012',
    ]);
    assert.equal(submitted.kyc_status, 'submitted');

    const after = await db.query('select full_name from public.profiles where id = $1', [
      APPLICANT_NO_PROFILE,
    ]);
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].full_name, 'Meera Iyer');
  } finally {
    await db.close();
  }
});

test('9. the approval SQL only touches columns growth_partners actually has', async () => {
  const db = await setup();
  try {
    const columns = await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'growth_partners'
        order by column_name`
    );
    const actual = columns.rows.map((row: any) => row.column_name);
    assert.deepEqual(actual, ['created_at', 'is_active', 'referral_code', 'updated_at', 'user_id']);

    // The old body inserted partner_code/status and a 'REF-…' code that the
    // growth_partners_code_format CHECK would have rejected anyway.
    const defs = await db.query(
      `select p.proname, pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('review_growth_partner_application', 'submit_growth_partner_application')`
    );
    assert.ok(defs.rows.length >= 2, 'both approval functions must exist');
    for (const row of defs.rows) {
      assert.equal(row.def.includes('partner_code'), false, `${row.proname} must not use partner_code`);
      assert.equal(/'REF-'/.test(row.def), false, `${row.proname} must not mint REF- codes`);
    }

    // submit is SECURITY DEFINER, so it no longer depends on the caller's
    // table grants (the reason every submission used to fail with 42501).
    const security = await db.query(
      `select p.proname, p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'submit_growth_partner_application'
          and cardinality(p.proargtypes) = 4`
    );
    assert.equal(security.rows.length, 1);
    assert.equal(security.rows[0].prosecdef, true, 'submit must run as its owner');

    // …and `authenticated` is still not allowed to write the table directly.
    const grants = await db.query(
      `select has_table_privilege('authenticated', 'public.growth_partner_applications', 'UPDATE') as can_update,
              has_function_privilege('authenticated', 'public.review_growth_partner_application(uuid, boolean, text)', 'EXECUTE') as can_review`
    );
    assert.equal(grants.rows[0].can_update, false, 'no direct client writes to applications');
    assert.equal(grants.rows[0].can_review, false, 'review stays admin-only');
  } finally {
    await db.close();
  }
});

test('10. the fix migration is idempotent', async () => {
  const db = await setup();
  try {
    await db.exec(
      readFileSync(
        new URL('../supabase/migrations/20260919_growth_partner_area_contract_alignment.sql', import.meta.url),
        'utf8'
      )
    );

    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);
    const reviewed = await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [
      submitted.id,
      true,
      null,
    ]);
    assert.equal(reviewed.status, 'approved');
    assert.match(reviewed.referral_code, /^[A-Z0-9]{6,12}$/);
  } finally {
    await db.close();
  }
});

test('11. every RPC the Growth Partner area calls works for an approved partner', async () => {
  const db = await setup();
  try {
    const submitted = await rpc(db, APPLICANT, 'submit_growth_partner_application', [
      'Asha Sharma',
      '9876543210',
      'pan',
      'ABCDE1234F',
    ]);
    await rpcAsAdmin(db, ADMIN, 'review_growth_partner_application', [submitted.id, true, null]);

    // 1. the gate read (fetchMyGrowthPartnerRow)
    const row = await rpc(db, APPLICANT, 'get_my_growth_partner');
    assert.equal(row.user_id, APPLICANT);
    assert.equal(row.is_active, true);
    assert.match(row.referral_code, /^[A-Z0-9]{6,12}$/);

    // 2. dashboard section
    const dashboard = await rpc(db, APPLICANT, 'get_my_partner_dashboard');
    assert.equal(dashboard.partner.referral_code, row.referral_code);
    assert.equal(dashboard.kpis.total_referrals, 0);
    assert.deepEqual(dashboard.recent_activity, []);

    // 3. referrals + customers sections (same RPC, different filters)
    const referrals = await rpc(db, APPLICANT, 'get_my_partner_referrals', ['all', null, 20, 0]);
    assert.equal(referrals.total, 0);
    assert.deepEqual(referrals.rows, []);

    // 4. performance section
    const performance = await rpc(db, APPLICANT, 'get_my_partner_performance');
    assert.equal(performance.total_referrals, 0);
    assert.equal(performance.completed, 0);
    assert.ok(Array.isArray(performance.monthly), 'the monthly series is server-built');

    // A referred user now shows up in the partner's own numbers.
    await rpc(db, APPLICANT_2, 'link_my_growth_referral', [row.referral_code]);
    const after = await rpc(db, APPLICANT, 'get_my_partner_dashboard');
    assert.equal(after.kpis.total_referrals, 1);
    const afterPerformance = await rpc(db, APPLICANT, 'get_my_partner_performance');
    assert.equal(afterPerformance.total_referrals, 1);

    // The same reads stay closed for a non-partner.
    for (const fn of ['get_my_partner_dashboard', 'get_my_partner_performance']) {
      const denied = await captureError(rpc(db, ADMIN, fn));
      assert.equal(denied.code, '42501', `${fn} must deny a non-partner`);
    }
    const noRow = await rpc(db, ADMIN, 'get_my_growth_partner');
    assert.equal(noRow, null, 'a non-partner gets null, which the area renders as "Growth Partners only"');
  } finally {
    await db.close();
  }
});

test('12. the older "production" partner read cannot be applied to this schema', async () => {
  const db = await setup();
  try {
    // Documents why get_my_growth_partner() lives in 20260919: the 092650
    // version is a `language sql` body over gp.status, which Postgres resolves
    // at CREATE time — so it fails against the growth_partners this repository
    // ships, and re-adding it would break the area's first read again.
    const err = await captureError(
      db.exec(
        readFileSync(
          new URL(
            '../supabase/migrations/20260911092650_growth_partner_referred_users_production.sql',
            import.meta.url
          ),
          'utf8'
        )
      )
    );
    // 42703 = undefined column: the table exists (20260912 created it) but has
    // no `status` column, and a `language sql` body is resolved at CREATE time.
    assert.equal(err.code, '42703');
    assert.match(err.message, /status/);

    // The area's gate read still resolves to the 20260919 definition.
    const owner = await db.query(
      `select p.prosecdef, pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_my_growth_partner'`
    );
    assert.equal(owner.rows.length, 1);
    assert.ok(owner.rows[0].def.includes('is_active'), 'the gate read must use the committed column');
    // prosecdef false = SECURITY INVOKER (pg_get_functiondef omits the default),
    // so the SELECT-own-row RLS policy stays the access control.
    assert.equal(owner.rows[0].prosecdef, false, 'RLS must stay the access control');
  } finally {
    await db.close();
  }
});
