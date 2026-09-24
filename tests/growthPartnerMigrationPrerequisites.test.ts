// ============================================================================
// The two Growth Partner database defects the full-schema audit found, pinned
// so they cannot come back:
//
// 1. THE CHAIN COULD NOT APPLY ON A FRESH PROJECT.
//
//    `shop_attributions` and `partner_reward_milestones` are read (and
//    foreign-keyed, and seeded) by committed migrations, but no migration
//    created them — a scan of every `public.<relation>` reference in all of
//    `supabase/migrations` against every `create table` finds no creator for
//    either. `20261007` resolves
//    `partner_shop_daily_qualification.shop_attribution_id references
//    public.shop_attributions(id)` at APPLY time and then seeds
//    `partner_reward_milestones`, so the reward migrations failed outright on a
//    project built from this repository.
//
//    `2026100500_growth_partner_attribution_prerequisites.sql` supplies both,
//    `create table if not exists` so a project carrying the legacy tables (the
//    production path) is untouched. The test below replays bootstrap + chain +
//    that file + 20261007/08/09 + the PostgREST reload on a bare PGlite: it
//    fails on the old code and passes on the new one.
//
// 2. AN ADMIN COULD NOT READ THEIR OWN PARTNER ROW LOCALLY.
//
//    Admin-claimed requests run as `service_role` (server/localSupabase.ts
//    `roleFor`), and the local bootstrap granted that role EXECUTE on functions
//    but nothing on tables — unlike Supabase, which grants service_role the whole
//    data plane and BYPASSRLS. The visible symptoms were
//    `42501 permission denied for table "growth_partners"` on an admin table
//    read, and `42703` from `get_my_growth_partner()` for an admin: that
//    function probes `information_schema.columns` for `is_active`, and
//    information_schema only lists columns the CURRENT ROLE may read — with no
//    grant the probe answered false, the function took its legacy `gp.status`
//    branch, and the area answered 400 instead of the caller's row. The last
//    test below pins the fixed behaviour for an admin.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalDatabase, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';

const MIGRATION = (file: string) =>
  readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');

/** The prerequisite + the three reward migrations + the PostgREST reload. */
const AUDIT_FIXES = [
  '2026100500_growth_partner_attribution_prerequisites.sql',
  '20261007_growth_partner_premium_rewards_and_qr_commission.sql',
  '20261008_correct_growth_partner_commission_share.sql',
  '20261009_one_time_extra_onboarding_reward.sql',
  '20261013_reload_postgrest_schema_growth_partner.sql',
];

const PARTNER = '9c0f3d2a-1111-4222-8333-1a2b3c4d5e6f';

async function auditedDatabase() {
  const local = await createLocalDatabase();
  const db = local.db;
  // Exactly the apply order GROWTH_PARTNER_SETUP.md now documents.
  for (const file of AUDIT_FIXES) {
    if (!LOCAL_GROWTH_CHAIN.includes(file)) await db.exec(MIGRATION(file));
  }
  return { local, db };
}

test('the reward migrations apply on a project built only from this repository', async () => {
  const { db, local } = await auditedDatabase();
  try {
    // The prerequisite created the two tables no migration used to create…
    const tables = await db.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in ('shop_attributions','partner_reward_milestones')
        order by table_name`
    );
    assert.deepEqual(
      tables.rows.map((row: any) => row.table_name),
      ['partner_reward_milestones', 'shop_attributions']
    );

    // …20261007's foreign key resolves against shop_attributions…
    const fk = await db.query(
      `select 1 from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_class r on r.oid = c.confrelid
        where t.relname = 'partner_shop_daily_qualification'
          and r.relname = 'shop_attributions' and c.contype = 'f'`
    );
    assert.equal(fk.rows.length, 1, 'partner_shop_daily_qualification → shop_attributions FK');

    // …and its `on conflict (code) do update` seed found the unique key.
    const seeded = await db.query('select count(*)::int as n from public.partner_reward_milestones');
    assert.equal(seeded.rows[0].n, 7, 'seven seeded reward milestones');

    // The three RPCs the Rewards/Commission section calls now exist.
    const fns = await db.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('get_my_partner_reward_dashboard','get_my_partner_qr_commission','get_my_partner_onboarding_rewards')
        order by proname`
    );
    assert.deepEqual(fns.rows.map((row: any) => row.proname), [
      'get_my_partner_onboarding_rewards',
      'get_my_partner_qr_commission',
      'get_my_partner_reward_dashboard',
    ]);
  } finally {
    await local.close();
  }
});

test('the added files are re-runnable (the local gateway replays the chain on every boot)', async () => {
  const { db, local } = await auditedDatabase();
  try {
    // The gateway applies every chain file on each start, so a file that cannot
    // run twice breaks local boot. Both new files must survive a second pass.
    for (const file of AUDIT_FIXES) {
      await db.exec(MIGRATION(file));
    }
    const seeded = await db.query('select count(*)::int as n from public.partner_reward_milestones');
    assert.equal(seeded.rows[0].n, 7, 'the seed upserts in place, it does not duplicate');
  } finally {
    await local.close();
  }
});

test('the reload migration asks PostgREST for the schema cache it is about', async () => {
  const sql = MIGRATION('20261013_reload_postgrest_schema_growth_partner.sql');
  assert.match(sql, /notify\s+pgrst\s*,\s*'reload schema'/);
  // The migrations it exists for are the ones that never notify on their own.
  for (const file of [
    '20260909035237_partner_profile_settings.sql',
    '20260920_growth_partner_application_queue.sql',
    '20260921_public_partner_referral_codes.sql',
    '20261007_growth_partner_premium_rewards_and_qr_commission.sql',
    '20261008_correct_growth_partner_commission_share.sql',
  ]) {
    assert.doesNotMatch(MIGRATION(file), /notify\s+pgrst/, `${file} still has no notify of its own`);
  }
});

test('an admin reads their own partner row instead of 42703 (service_role parity)', async () => {
  const { db, local } = await auditedDatabase();
  try {
    await db.exec(
      `insert into auth.users(id, email, encrypted_password)
         values ('${PARTNER}', 'admin-parity@example.com', 'x')
         on conflict (id) do nothing;
       insert into public.growth_partners(user_id, referral_code, is_active)
         values ('${PARTNER}', 'NEXORATEST', true)
         on conflict (user_id) do nothing;`
    );

    // Pre-fix this raised `42703 column gp.status does not exist`, because the
    // information_schema probe was blind to the columns service_role could not
    // read. Admin == service_role in this gateway, exactly like the SQL Editor.
    const row = await local.asRequest({ sub: PARTNER, isAdmin: true }, async (conn) => {
      const result = await conn.query('select public.get_my_growth_partner() as row');
      return result.rows[0]?.row;
    });
    assert.ok(row, 'an admin gets their row, not an error');
    assert.equal(row.user_id, PARTNER);
    assert.equal(row.referral_code, 'NEXORATEST');
    assert.equal(row.is_active, true);

    // The direct read that answered 42501 before the grant fix.
    const read = await local.asRequest({ sub: PARTNER, isAdmin: true }, async (conn) =>
      conn.query('select user_id from public.growth_partners')
    );
    assert.equal(read.rows.length, 1);
    assert.equal(read.rows[0].user_id, PARTNER);
  } finally {
    await local.close();
  }
});
