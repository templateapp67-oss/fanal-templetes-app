// ============================================================================
// PHASE 6 — REFERRAL ATTRIBUTION.
//
// 6.1 REUSE CURRENT DATABASE
//   Traced before creating anything: the referral domain already has canonical
//   tables, so this phase creates NO table and adds NO migration. The first
//   test pins that fact against the live schema (information_schema), the
//   committed migrations and the forbidden "parallel schema" names, so a future
//   `owner_referrals_v2` / `new_referrals` / `referral_system_new` fails here.
//
// 6.2 ATTRIBUTION LOCK
//   What happens AFTER a code validates: the attribution is written server-side
//   by exactly three functions, and a later `?ref=PARTNER-B` cannot overwrite it.
//   The tests below drive the real chain (PGlite + the committed migrations)
//   with the attacks a browser, a tampered Auth row or a privileged caller can
//   attempt, and assert the authoritative row never moves.
//
// The persistence half (refresh / logout / login / browser restart) lives in
// tests/dom/referralAttributionPersistence.test.ts, which drives the real
// components; the restart-and-reopen case is pinned here as well because it is
// a database property, not a UI one.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalDatabase } from '../server/localSupabase';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url));

type Ctx = { local: any; db: any };

async function boot(dataDir?: string) {
  const local = await createLocalDatabase(dataDir);
  return { local, db: local.db } as Ctx;
}

const as = (ctx: Ctx, sub: string | null, fn: string, args: any[] = [], admin = false): Promise<any> =>
  ctx.local.asRequest({ sub, isAdmin: admin }, async (conn: any) =>
    (await conn.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)).rows[0].r);

/** A real auth account. `token` is the capability the browser would have carried. */
async function account(ctx: Ctx, email: string, token?: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  await ctx.db.query(
    'insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values($1,$2,$3,$4::jsonb)',
    [id, email, 'test-only', JSON.stringify({ ...(token ? { growth_referral_token: token } : {}), ...extra })]
  );
  return id;
}

async function partner(ctx: Ctx, code: string, active = true) {
  const id = await account(ctx, `${code.toLowerCase()}@partner.example`);
  await ctx.db.query('select public.provision_growth_partner($1,$2,$3)', [id, code, active]);
  return id;
}

const attribution = async (ctx: Ctx, userId: string) =>
  (await ctx.db.query('select growth_partner_id, referral_code, status, linked_at from public.growth_onboarding where user_id=$1', [userId])).rows[0];

const ledger = async (ctx: Ctx, userId: string) =>
  (await ctx.db.query('select id, partner_id, referral_code, status, registered_at from public.partner_referrals where referred_user_id=$1 order by created_at', [userId])).rows;

// ---------------------------------------------------------------------------
// 6.1 — the existing database already holds this domain.
// ---------------------------------------------------------------------------

test('6.1. the referral domain reuses the canonical tables; no parallel schema exists', async () => {
  const ctx = await boot();
  try {
    const tables: string[] = (
      await ctx.db.query(
        `select table_name from information_schema.tables
          where table_schema='public' and table_type='BASE TABLE'
            and (table_name like '%referral%' or table_name like '%partner%' or table_name like '%growth%')
          order by table_name`
      )
    ).rows.map((row: any) => row.table_name);

    // The exact canonical set. A new "referral" table — under any name — fails here.
    // The canonical referral set plus the partner OPERATIONS tables the later
    // phases added (earnings, payouts, tickets, account settings, security
    // log, deactivation requests) — they are the operational model the portal
    // consumes, never a second referral store.
    //
    // Two names joined the chain in the full-schema audit, both explained where
    // they are created:
    //   * `partner_settings` — the partner PROFILE row (date of birth, area,
    //     notification flag) behind get_partner_profile()/save_partner_profile()
    //     in 20260909035237. It holds no referral or attribution state.
    //   * `partner_reward_milestones` — the premium-reward CATALOGUE (code,
    //     shop thresholds, maximum value in paise) that 20261007 seeds and
    //     20261007/20261008 read. It is a price list, not an attribution store;
    //     its creator is 2026100500_growth_partner_attribution_prerequisites.sql,
    //     which had to exist because six committed migrations reference
    //     `shop_attributions`/`partner_reward_milestones` and no migration ever
    //     created them.
    assert.deepEqual(tables, [
      'growth_onboarding',
      'growth_partner_applications',
      'growth_partners',
      'growth_referral_admin_audit',
      'growth_referral_attributions',
      'growth_referral_status_audit',
      'partner_account_settings',
      'partner_deactivation_requests',
      'partner_earnings',
      'partner_level_definitions',
      'partner_marketing_assets',
      'partner_notification_preferences',
      'partner_notifications',
      'partner_payout_requests',
      'partner_referral_events',
      'partner_referrals',
      'partner_reward_milestones',
      'partner_security_events',
      'partner_settings',
      'partner_support_attachments',
      'partner_support_tickets',
    ]);

    // The remaining name in the domain is a read-only projection, not a store.
    const views = (
      await ctx.db.query(`select c.relname, c.reloptions, pg_get_viewdef(c.oid, true) as definition
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='v' and c.relname like '%referral%'`)
    ).rows;
    assert.deepEqual(views.map((row: any) => row.relname), ['partner_referral_attribution']);
    assert.deepEqual(views[0].reloptions, ['security_invoker=true'], 'the projection is not a privilege bypass');
    assert.match(views[0].definition, /growth_onboarding/, 'the projection reads the authoritative table');
    await assert.rejects(
      ctx.local.asRequest({ sub: null, isAdmin: false }, (conn: any) => conn.query('select * from public.partner_referral_attribution')),
      /permission denied/i
    );

    // The three names 6.1 forbids are absent, and so is every "_v2"-style twin.
    for (const forbidden of ['owner_referrals_v2', 'new_referrals', 'referral_system_new']) {
      assert.ok(!tables.includes(forbidden), `${forbidden} must not exist`);
    }
    assert.ok(!tables.some((name) => /(_v2|_new|_legacy|_tmp|_copy)$/.test(name)), 'no parallel/replacement table');

    // One canonical home per concern — the mapping the requested names resolve to.
    const columns = async (sql: string) => (await ctx.db.query(sql)).rows.map((row: any) => row.table_name);
    assert.deepEqual(
      await columns(`select table_name from information_schema.columns where table_schema='public' and column_name='growth_partner_id' order by table_name`),
      ['growth_onboarding', 'shop_attributions', 'template_handoffs'],
      'growth_onboarding is the ONE owner→partner attribution edge (template_handoffs only snapshots it for a single-use grant); shop_attributions is the partner→SALON edge created by 2026100500, a different concern that never attributes an OWNER'
    );
    assert.deepEqual(
      await columns(`select table_name from information_schema.columns where table_schema='public' and column_name='referred_user_id' order by table_name`),
      ['growth_referral_admin_audit', 'growth_referral_status_audit', 'partner_referral_attribution', 'partner_referrals']
    );
    assert.deepEqual(
      await columns(`select table_name from information_schema.columns where table_schema='public' and column_name='referral_code' order by table_name`),
      ['growth_onboarding', 'growth_partners', 'growth_referral_attributions', 'partner_referral_attribution', 'partner_referrals']
    );

    // The invariants that make one attribution per account possible at all.
    const indexNames = async () => (
      await ctx.db.query(`select indexname from pg_indexes where schemaname='public' and tablename in
        ('growth_partners','growth_onboarding','partner_referrals','growth_referral_attributions') order by indexname`)
    ).rows.map((row: any) => row.indexname);
    for (const required of [
      'growth_partners_code_case_insensitive_key',
      'growth_partners_referral_code_key',
      'growth_partners_id_key',
      'growth_onboarding_referral_id_key',
      'partner_referrals_referred_user_key',
      'growth_referral_attributions_referral_id_key',
    ]) {
      assert.ok((await indexNames()).includes(required), `${required} exists`);
    }

    // Anonymous callers have no table privileges at all; an authenticated owner
    // can read but never write the attribution.
    const grants = (
      await ctx.db.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants
        where table_schema='public' and grantee in ('anon','authenticated')
          and table_name in ('growth_partners','growth_onboarding','partner_referrals','growth_referral_attributions','growth_referral_admin_audit')`)
    ).rows;
    assert.deepEqual(grants.filter((row: any) => row.grantee === 'anon'), [], 'anon has no table grants');
    assert.deepEqual(
      [...new Set(grants.filter((row: any) => row.grantee === 'authenticated').map((row: any) => row.privilege_type))],
      ['SELECT'],
      'authenticated is read-only on the referral domain'
    );
    assert.deepEqual(
      grants.filter((row: any) => row.table_name === 'growth_referral_admin_audit'),
      [],
      'the admin audit trail is not even readable by clients'
    );

    // Every referral-domain table is RLS-protected.
    const rls = (
      await ctx.db.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and relname in ('growth_partners','growth_onboarding','partner_referrals','partner_referral_events','growth_referral_attributions','growth_referral_admin_audit')`)
    ).rows;
    assert.equal(rls.length, 6);
    assert.ok(rls.every((row: any) => row.relrowsecurity === true), 'RLS enabled on every referral table');
  } finally {
    await ctx.local.close();
  }
});

test('6.1. no committed migration creates a parallel referral table (this phase adds none)', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql'));
  const created = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const match of sql.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      created.add(match[1]);
    }
  }
  const referralDomain = [...created].filter((name) => /referral|partner|growth/.test(name)).sort();
  // Canonical Growth Partner attribution + the unrelated look-alikes that must
  // NOT be mistaken for it: `partner_settings` (partner profile),
  // `partner_reward_milestones` (the reward price list seeded by 20261007) and
  // `referrals` (the per-salon customer loyalty ledger).
  assert.deepEqual(referralDomain, [
    'growth_onboarding',
    'growth_partner_applications',
    'growth_partners',
    'growth_referral_admin_audit',
    'growth_referral_attributions',
    'growth_referral_status_audit',
    'partner_account_settings',
    'partner_deactivation_requests',
    'partner_earnings',
    'partner_level_definitions',
    'partner_marketing_assets',
    'partner_notification_preferences',
    'partner_notifications',
    'partner_payout_requests',
    'partner_referral_events',
    'partner_referrals',
    'partner_reward_milestones',
    'partner_security_events',
    'partner_settings',
    'partner_shop_daily_qualification',
    'partner_shop_onboarding_rewards',
    'partner_support_attachments',
    'partner_support_tickets',
    'referrals',
  ]);
  for (const forbidden of ['owner_referrals_v2', 'new_referrals', 'referral_system_new']) {
    assert.ok(!created.has(forbidden), `${forbidden} is never created`);
  }
  // The chain this repository applies locally is exactly the committed referral
  // chain — no extra referral migration was introduced by PHASE 6.
  const chain = readFileSync(fileURLToPath(new URL('../server/localSupabase.ts', import.meta.url)), 'utf8');
  const chainReferral = [...chain.matchAll(/'(\d{8}[a-z0-9_]*\.sql)'/g)].map((match) => match[1]).filter((name) => /referral|partner|growth/.test(name));
  assert.ok(chainReferral.includes('20260928_partner_referrals_table.sql'), 'the canonical ledger migration is applied');
  assert.ok(!chainReferral.some((name) => /_v2|_new\.sql/.test(name)), 'no parallel referral migration is applied');
});

// ---------------------------------------------------------------------------
// 6.2 — a later ?ref=PARTNER-B cannot overwrite PARTNER-A.
// ---------------------------------------------------------------------------

test('6.2. opening ?ref=PARTNER-B after being attributed to PARTNER-A changes nothing', async () => {
  const ctx = await boot();
  try {
    const partnerA = await partner(ctx, 'NEXORA-PARTNERA');
    const partnerB = await partner(ctx, 'NEXORA-PARTNERB');

    // The legitimate path: an anonymous visitor's capability, consumed by the
    // real signup trigger (as request level, exactly like the HTTP endpoint).
    const capability = await as(ctx, null, 'capture_growth_referral', ['NEXORA-PARTNERA', null]);
    const owner = await account(ctx, 'owner@example.com', capability.token);

    const before = await attribution(ctx, owner);
    assert.equal(before.growth_partner_id, partnerA);
    assert.equal(before.referral_code, 'NEXORA-PARTNERA');
    const ledgerBefore = await ledger(ctx, owner);
    assert.equal(ledgerBefore.length, 1);
    assert.equal(ledgerBefore[0].partner_id, (await ctx.db.query('select id from public.growth_partners where user_id=$1', [partnerA])).rows[0].id);

    // --- the scenario from the spec: the owner later opens ?ref=PARTNER-B ----
    const second = await as(ctx, null, 'capture_growth_referral', ['NEXORA-PARTNERB', null]);
    assert.equal(second.valid, true, 'B is a real code, so the click itself is captured');

    // 1. Linking to B is refused; the authoritative row does not move.
    await assert.rejects(as(ctx, owner, 'link_my_growth_referral', ['NEXORA-PARTNERB']), /already linked/i);
    await assert.rejects(as(ctx, owner, 'link_my_growth_referral', ['NEXORA-PARTNERA']), /already linked/i);
    assert.deepEqual(await attribution(ctx, owner), before, 'the attribution is byte-identical');
    assert.deepEqual(await ledger(ctx, owner), ledgerBefore, 'the ledger row is byte-identical');

    // 2. The click is an anonymous lead, not an attribution: it has no account,
    //    and B's own reads cannot see it as a referral.
    const click = (
      await ctx.db.query("select referred_user_id, status from public.partner_referrals where referral_code='NEXORA-PARTNERB' and referred_user_id is null")
    ).rows;
    assert.equal(click.length, 1);
    assert.equal(click[0].status, 'clicked');

    const bDashboard = await as(ctx, partnerB, 'get_my_partner_dashboard');
    assert.equal(bDashboard.kpis.total_referrals, 0, 'a click on B\'s link is not a referral');
    assert.equal(bDashboard.totalReferrals, 0);
    const bList = await as(ctx, partnerB, 'get_my_partner_referrals', ['all', null, 20, 0]);
    assert.equal(bList.total, 0, 'B\'s referral list stays empty');
    assert.equal(bList.status_counts.all, 0);

    // 3. The capability B issued cannot be consumed by the existing account
    //    either: consumption happens only inside the signup trigger.
    await ctx.db.query('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [
      owner,
      JSON.stringify({ growth_referral_token: second.token, partner_id: partnerB, referral_code: 'NEXORA-PARTNERB' }),
    ]);
    assert.deepEqual(await attribution(ctx, owner), before, 'tampered metadata cannot re-attribute an existing account');
    assert.deepEqual(await ledger(ctx, owner), ledgerBefore);

    // 4. A's dashboard still owns exactly that one referral.
    const aList = await as(ctx, partnerA, 'get_my_partner_referrals', ['all', null, 20, 0]);
    assert.equal(aList.total, 1);
    assert.equal(aList.rows[0].referral_code, 'NEXORA-PARTNERA');
  } finally {
    await ctx.local.close();
  }
});

test('6.2. only an audited administrator correction can reassign an attribution', async () => {
  const ctx = await boot();
  try {
    const partnerA = await partner(ctx, 'NEXORA-PARTNERA');
    const partnerB = await partner(ctx, 'NEXORA-PARTNERB');
    await partner(ctx, 'NEXORA-PARTNERC', false); // inactive — must stay unusable
    const capability = await as(ctx, null, 'capture_growth_referral', ['NEXORA-PARTNERA', null]);
    const owner = await account(ctx, 'owner@example.com', capability.token);
    const before = await attribution(ctx, owner);
    const ledgerBefore = await ledger(ctx, owner);
    const ledgerId = ledgerBefore[0].id;

    // No client role can reach the privileged path, and it is not even granted.
    for (const [label, sub, admin] of [['anonymous', null, false], ['owner', owner, false], ['partner B', partnerB, false]] as const) {
      await assert.rejects(
        as(ctx, sub, 'admin_correct_growth_referral', [owner, 'NEXORA-PARTNERB', 'reassign'], admin),
        /permission denied/i,
        `${label} cannot call admin_correct_growth_referral`
      );
    }
    assert.deepEqual(await attribution(ctx, owner), before);

    // An administrator still needs an audit reason and a real, usable target.
    await assert.rejects(as(ctx, partnerA, 'admin_correct_growth_referral', [owner, 'NEXORA-PARTNERB', ''], true), /audit reason/i);
    await assert.rejects(as(ctx, partnerA, 'admin_correct_growth_referral', [owner, 'NOPE99', 'valid reason'], true), /Invalid referral code or self referral/i);
    await assert.rejects(as(ctx, partnerA, 'admin_correct_growth_referral', [owner, 'NEXORA-PARTNERC', 'valid reason'], true), /Invalid referral code or self referral/i);
    assert.deepEqual(await attribution(ctx, owner), before, 'every rejected correction is a no-op');

    // Re-correcting to the attribution that is already stored is a silent no-op
    // — never a rewrite, and never an audit row.
    assert.equal(await as(ctx, partnerA, 'admin_correct_growth_referral', [owner, 'NEXORA-PARTNERA', 'same partner again'], true), '');
    assert.deepEqual(await attribution(ctx, owner), before);
    assert.deepEqual(await ledger(ctx, owner), ledgerBefore, 'ledger untouched');
    assert.equal((await ctx.db.query('select count(*)::int n from public.growth_referral_admin_audit where referred_user_id=$1', [owner])).rows[0].n, 0);

    // The deliberate, audited reassignment.
    await as(ctx, partnerA, 'admin_correct_growth_referral', [owner, 'NEXORA-PARTNERB', 'Verified support correction'], true);
    const corrected = await attribution(ctx, owner);
    assert.equal(corrected.growth_partner_id, partnerB);
    assert.equal(corrected.referral_code, 'NEXORA-PARTNERB');
    assert.equal(corrected.linked_at.getTime(), before.linked_at.getTime(), 'the original link instant is preserved');

    const after = await ledger(ctx, owner);
    assert.equal(after.length, 1, 'the same ledger row is corrected, never duplicated');
    assert.equal(after[0].id, ledgerId);
    assert.equal(after[0].partner_id, (await ctx.db.query('select id from public.growth_partners where user_id=$1', [partnerB])).rows[0].id);

    const audit = (await ctx.db.query('select * from public.growth_referral_admin_audit where referred_user_id=$1', [owner])).rows;
    assert.equal(audit.length, 1, 'exactly one audit record per correction');
    assert.equal(audit[0].old_partner_id, partnerA);
    assert.equal(audit[0].new_partner_id, partnerB);
    assert.equal(audit[0].old_referral_code, 'NEXORA-PARTNERA');
    assert.equal(audit[0].new_referral_code, 'NEXORA-PARTNERB');
    assert.equal(audit[0].actor_id, partnerA);
    assert.equal(audit[0].reason, 'Verified support correction');

    // The correction is the ONLY thing that moved: the old partner is no longer
    // attributed, the new one is, and the same account keeps one identity.
    assert.equal((await ctx.db.query('select count(*)::int n from public.growth_onboarding where growth_partner_id=$1', [partnerA])).rows[0].n, 0);
    assert.equal((await ctx.db.query('select count(*)::int n from public.growth_onboarding where growth_partner_id=$1', [partnerB])).rows[0].n, 1);
    assert.equal((await ledger(ctx, owner)).length, 1);
  } finally {
    await ctx.local.close();
  }
});

test('6.2. no client write path can set, replace or delete an attribution', async () => {
  const ctx = await boot();
  try {
    const partnerA = await partner(ctx, 'NEXORA-PARTNERA');
    const partnerB = await partner(ctx, 'NEXORA-PARTNERB');
    const capability = await as(ctx, null, 'capture_growth_referral', ['NEXORA-PARTNERA', null]);
    const owner = await account(ctx, 'owner@example.com', capability.token);
    const before = await attribution(ctx, owner);

    const attempts: [string, string, any[]][] = [
      ['update the attribution edge', 'update public.growth_onboarding set growth_partner_id=$1 where user_id=$2', [partnerB, owner]],
      ['change the stored code', "update public.growth_onboarding set referral_code='NEXORA-PARTNERB' where user_id=$1", [owner]],
      ['insert a second attribution', 'insert into public.growth_onboarding(user_id, growth_partner_id, referral_code) values ($1,$2,$3)', [owner, partnerB, 'NEXORA-PARTNERB']],
      ['delete the attribution', 'delete from public.growth_onboarding where user_id=$1', [owner]],
      ['rewrite the ledger', 'update public.partner_referrals set partner_id=(select id from public.growth_partners where user_id=$1) where referred_user_id=$2', [partnerB, owner]],
      ['insert a ledger row', "insert into public.partner_referrals(partner_id, referral_code, referred_user_id, status, registered_at) values ((select id from public.growth_partners where user_id=$1),'NEXORA-PARTNERB',$2,'pending',now())", [partnerB, owner]],
      ['delete the ledger row', 'delete from public.partner_referrals where referred_user_id=$1', [owner]],
      ['read the admin audit', 'select * from public.growth_referral_admin_audit', []],
      ['read the capability ledger', 'select * from public.growth_referral_attributions', []],
    ];
    for (const [label, sql, args] of attempts) {
      await assert.rejects(
        ctx.local.asRequest({ sub: owner, isAdmin: false }, (conn: any) => conn.query(sql, args)),
        /permission denied/i,
        `owner cannot ${label}`
      );
    }
    await assert.rejects(
      ctx.local.asRequest({ sub: null, isAdmin: false }, (conn: any) => conn.query('select * from public.growth_onboarding')),
      /permission denied/i,
      'anonymous callers cannot read the attribution edge'
    );

    // A milestone call is the one write an owner may make — and it cannot move ownership.
    await as(ctx, owner, 'update_my_onboarding_progress', ['start_template']);
    const after = await attribution(ctx, owner);
    assert.equal(after.growth_partner_id, before.growth_partner_id);
    assert.equal(after.referral_code, before.referral_code);
    assert.equal(after.status, 'template_started');

    // The one-time handoff snapshots the attribution and fails closed if it moved.
    const handoff = await as(ctx, owner, 'create_template_handoff', ['state-12345678']);
    const snapshot = (await ctx.db.query('select growth_partner_id from public.template_handoffs where user_id=$1', [owner])).rows[0];
    assert.equal(snapshot.growth_partner_id, partnerA, 'the grant snapshots the live attribution');
    await as(ctx, partnerA, 'admin_correct_growth_referral', [owner, 'NEXORA-PARTNERB', 'corrected after the grant'], true);
    await assert.rejects(
      as(ctx, owner, 'exchange_template_handoff', [handoff.token]),
      /cannot continue/i,
      'a grant minted for the old partner cannot be redeemed after a reassignment'
    );
    assert.equal((await ctx.db.query('select growth_partner_id from public.growth_onboarding where user_id=$1', [owner])).rows[0].growth_partner_id, partnerB);
  } finally {
    await ctx.local.close();
  }
});

test('6.2. concurrent link attempts resolve to at most one attribution', async () => {
  const ctx = await boot();
  try {
    const partnerA = await partner(ctx, 'NEXORA-PARTNERA');
    const partnerB = await partner(ctx, 'NEXORA-PARTNERB');
    const owner = await account(ctx, 'owner@example.com');

    const results = await Promise.allSettled([
      as(ctx, owner, 'link_my_growth_referral', ['NEXORA-PARTNERA']),
      as(ctx, owner, 'link_my_growth_referral', ['NEXORA-PARTNERB']),
      as(ctx, owner, 'link_my_growth_referral', ['NEXORA-PARTNERA']),
    ]);
    const succeeded = results.filter((result) => result.status === 'fulfilled');
    assert.equal(succeeded.length, 1, 'exactly one racer wins');

    const row = await attribution(ctx, owner);
    const winner = row.growth_partner_id;
    assert.equal(row.referral_code, winner === partnerA ? 'NEXORA-PARTNERA' : 'NEXORA-PARTNERB');
    assert.equal((await ledger(ctx, owner)).length, 1, 'one ledger row, never two');

    // Whatever happens afterwards, the winner is fixed.
    await assert.rejects(as(ctx, owner, 'link_my_growth_referral', [winner === partnerA ? 'NEXORA-PARTNERB' : 'NEXORA-PARTNERA']), /already linked/i);
    assert.deepEqual(await attribution(ctx, owner), row);
  } finally {
    await ctx.local.close();
  }
});

// ---------------------------------------------------------------------------
// Persistence across a real database restart (the server half of
// "browser restart"), and the lifecycle properties that keep the row safe.
// ---------------------------------------------------------------------------

test('the attribution is a server-side row that survives a database restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'referral-persistence-'));
  try {
    const first = await boot(dataDir);
    const partnerA = await partner(first, 'NEXORA-PARTNERA');
    const capability = await as(first, null, 'capture_growth_referral', ['NEXORA-PARTNERA', null]);
    const owner = await account(first, 'owner@example.com', capability.token);
    const before = await attribution(first, owner);
    const ledgerBefore = await ledger(first, owner);
    await first.local.close();

    // Re-open the same disk-backed database: nothing is carried in memory.
    const second = await boot(dataDir);
    try {
      const after = await attribution(second, owner);
      assert.equal(after.growth_partner_id, before.growth_partner_id);
      assert.equal(after.referral_code, before.referral_code);
      assert.equal(after.status, before.status);
      assert.equal(after.linked_at.getTime(), before.linked_at.getTime(), 'the same server instant');
      assert.deepEqual(await ledger(second, owner), ledgerBefore);

      // The same RPC the client routes on answers from the reopened database.
      const status = await as(second, owner, 'get_my_onboarding_status');
      assert.equal(status.linked, true);
      assert.equal(status.referral_code, 'NEXORA-PARTNERA');
      assert.equal(status.growth_partner_id, partnerA);
    } finally {
      await second.local.close();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('attribution history is protected: the partner row cannot be deleted, the owner can close their account', async () => {
  const ctx = await boot();
  try {
    await partner(ctx, 'NEXORA-PARTNERA');
    const partnerA = (await ctx.db.query("select user_id from public.growth_partners where referral_code='NEXORA-PARTNERA'")).rows[0].user_id;
    const capability = await as(ctx, null, 'capture_growth_referral', ['NEXORA-PARTNERA', null]);
    const owner = await account(ctx, 'owner@example.com', capability.token);

    // Deleting a partner who has attributed referrals is refused, so the
    // attribution can never be silently orphaned or expired by an account delete.
    await assert.rejects(ctx.db.query('delete from auth.users where id=$1', [partnerA]), /RESTRICT|foreign key/i);
    assert.equal((await attribution(ctx, owner)).referral_code, 'NEXORA-PARTNERA');

    // Deleting the OWNER's account is a real erasure: the relationship goes with it.
    await ctx.db.query('delete from auth.users where id=$1', [owner]);
    assert.equal((await ctx.db.query('select count(*)::int n from public.growth_onboarding where user_id=$1', [owner])).rows[0].n, 0);
    assert.equal((await ledger(ctx, owner)).length, 0);
  } finally {
    await ctx.local.close();
  }
});
