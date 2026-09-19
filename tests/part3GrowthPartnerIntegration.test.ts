// ============================================================================
// PHASE 7 — PART 3 × GROWTH PARTNER CONNECTION
//
// PART 3 (owner/workspace provisioning, `20261002_owner_workspace_provisioning.sql`)
// had to be wired into an existing Growth Partner referral implementation. This
// suite verifies the eight connections on the LIVE normalized schema
// (`tests/liveSchemaFixture.ts` — the shape production actually has, where the
// PART 3 path is the one that completes) with the whole committed growth chain
// applied on top:
//
//   1 partner referral code generation
//   2 partner ownership of referral code
//   3 referred user mapping
//   4 signup attribution
//   5 referral status
//   6 partner dashboard visibility
//   7 conversion status
//   8 duplicate prevention
//
// and pins the boundary the task repeats: **there is one Growth Partner
// referral model**. No second table, no second code store, no second status
// enum, no second attribution path — asserted against `information_schema`,
// not against a comment.
//
// Nothing about the referral path is mocked: the real migrations, the real
// triggers, the real SECURITY DEFINER RPCs, the real RLS roles.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { asUser, liveSchemaDb } from './liveSchemaFixture';
import { LOCAL_GROWTH_CHAIN } from '../server/localSupabase';

const MIGRATION = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const PART3_MIGRATION = '20261002_owner_workspace_provisioning.sql';

/** Two 00001-shaped things the server-read fixture omits but production has. */
const PRODUCTION_GAPS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  -- Same default privilege the local gateway and a real project have: the
  -- admin/service key may execute the SECURITY DEFINER RPCs.
  alter default privileges in schema public grant execute on functions to service_role;

  -- private.is_admin() — the admin predicate the whole chain checks (see
  -- GROWTH_PARTNER_SETUP.md "Prerequisites").
  create schema if not exists private;
  create or replace function private.is_admin() returns boolean language sql stable as
    $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
  grant usage on schema private to authenticated, anon;
  grant execute on function private.is_admin() to authenticated, anon;

  -- The fixture models the columns the SERVER reads, and the growth chain FKs
  -- to profiles (growth_partner_applications.user_id, reviewed_by) and reads it
  -- for display names. Columns copied from 00001_init.sql.
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text, salon_name text, business_type text, email text, phone_number text,
    whatsapp text, owner_role text, subdomain text unique, city text,
    updated_at timestamptz not null default now()
  );
  alter table public.profiles enable row level security;
  grant select on public.profiles to authenticated;
  drop policy if exists profiles_select_owner on public.profiles;
  create policy profiles_select_owner on public.profiles for select using (id = auth.uid());

  -- auth.users columns GoTrue owns and the chain reads.
  alter table auth.users add column if not exists email text;
  alter table auth.users add column if not exists encrypted_password text;
  alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
  alter table auth.users add column if not exists banned_until timestamptz;
  alter table auth.users add column if not exists created_at timestamptz not null default now();
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
  alter table auth.users add column if not exists email_confirmed_at timestamptz;

  -- nexora_owner_salon_ids() filters s.deleted_at, so production has it.
  alter table public.salons add column if not exists deleted_at timestamptz;

  -- The local bootstrap and a real project both expose these to client roles.
  grant usage on schema auth to authenticated, anon;
`;

/** Live normalized schema + the committed growth chain + PART 3, as production. */
async function part3Db(): Promise<any> {
  const db = await liveSchemaDb();
  await db.exec(PRODUCTION_GAPS);
  for (const file of LOCAL_GROWTH_CHAIN) await db.exec(MIGRATION(file));
  await db.exec(MIGRATION(PART3_MIGRATION));
  return db;
}

// ---------------------------------------------------------------------------
// Actors and calls
// ---------------------------------------------------------------------------

const PARTNER_A = 'a0000000-0000-4000-8000-00000000000a';
const PARTNER_B = 'a0000000-0000-4000-8000-00000000000b';
const OWNER = 'b0000000-0000-4000-8000-00000000000c';
const OTHER_OWNER = 'b0000000-0000-4000-8000-00000000000d';
const NON_PARTNER = 'b0000000-0000-4000-8000-00000000000e';
const ADMIN = 'c0000000-0000-4000-8000-00000000000f';

/** Create a real auth account (the signup triggers run, like GoTrue's INSERT). */
async function account(db: any, id: string, email: string, meta: Record<string, unknown> = {}) {
  await db.query('insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values($1,$2,$3,$4::jsonb)', [
    id,
    email,
    'test-only',
    JSON.stringify(meta),
  ]);
  return id;
}

/** Call an RPC as a signed-in user (role `authenticated`). */
async function call(db: any, who: string, fn: string, args: any[] = []): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  const result = await asUser(db, who, `select public.${fn}(${placeholders}) as r`, args);
  return result.rows[0].r;
}

/** Call an RPC as an anonymous visitor (role `anon`). */
async function callAnon(db: any, fn: string, args: any[] = []): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  const result = await asUser(db, '', `select public.${fn}(${placeholders}) as r`, args);
  return result.rows[0].r;
}

/** Call an RPC the way the SQL Editor / service key does — role `service_role`. */
async function callAdmin(db: any, fn: string, args: any[] = [], actor = ADMIN): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
  await db.query("select set_config('app.is_admin', 'true', false)");
  await db.exec('reset role');
  await db.exec('set role service_role');
  try {
    return (await db.query(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('app.is_admin', 'false', false)");
  }
}

/** Provision a partner through the admin path and return {userId, code}. */
async function provision(db: any, id: string, code?: string) {
  const result = await callAdmin(db, 'provision_growth_partner', code === undefined ? [id] : [id, code, true]);
  assert.equal(result.user_id, id);
  return { userId: id, code: result.referral_code as string };
}

const attribution = async (db: any, userId: string) =>
  (await db.query('select * from public.growth_onboarding where user_id = $1', [userId])).rows[0];

const ledger = async (db: any, userId: string) =>
  (await db.query('select * from public.partner_referrals where referred_user_id = $1 order by created_at', [userId])).rows;

const partnerRow = async (db: any, userId: string) =>
  (await db.query('select * from public.growth_partners where user_id = $1', [userId])).rows[0];

/** The whole signup-from-a-share-link chain: capture -> account -> attribution. */
async function signUpFromLink(db: any, ownerId: string, email: string, code?: string, meta: Record<string, unknown> = {}) {
  let token: string | undefined;
  let captured: any = null;
  if (code) {
    captured = await callAnon(db, 'capture_growth_referral', [code, null]);
    token = captured.token;
  }
  await account(db, ownerId, email, { ...(token ? { growth_referral_token: token } : {}), ...meta });
  return { captured, token };
}

// ===========================================================================
// 1. Partner referral code generation
// ===========================================================================

test('7.1 a partner referral code is generated in one canonical store, in the canonical format', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'code.a@partner.example');
    await account(db, PARTNER_B, 'code.b@partner.example', { full_name: 'Partner B' });
    await account(db, NON_PARTNER, 'code.c@partner.example', { full_name: 'Partner C' });
    await account(db, ADMIN, 'code.admin@example.com', { full_name: 'Code Admin' });

    // Generation path 1: the admin helper with no code.
    const generated = await provision(db, PARTNER_A);
    assert.match(generated.code, /^NEXORA-[A-Z0-9]{12}$/, `auto-generated code: ${generated.code}`);
    assert.equal((await partnerRow(db, PARTNER_A)).is_active, true);

    // Asking again reuses the code — rotating it would break every link already
    // shared and every attribution already recorded against it.
    assert.equal((await provision(db, PARTNER_A)).code, generated.code);

    // Generation path 2: the partner application queue, approved by an admin.
    // It delegates to the same helper (20260919), so the code lands in the same
    // table with the same format — this is the assertion that would fail if a
    // second, legacy approval path ever wrote `partner_code`/`REF-…` again.
    const application = await call(db, PARTNER_B, 'submit_growth_partner_application', [
      'Partner B',
      '+919845000001',
      'pan',
      'KYC-REF-0001',
    ]);
    const reviewed = await callAdmin(db, 'review_growth_partner_application', [application.id, true, 'KYC verified']);
    assert.equal(reviewed.status, 'approved');
    assert.match(reviewed.referral_code, /^NEXORA-[A-Z0-9]{12}$/, `approved code: ${reviewed.referral_code}`);
    assert.deepEqual(
      Object.keys(await partnerRow(db, PARTNER_B)).sort(),
      ['created_at', 'id', 'is_active', 'referral_code', 'updated_at', 'user_id'],
      'the approved partner row is the canonical one — no legacy partner_code/status columns exist'
    );
    // Re-approval preserves the code.
    assert.equal((await callAdmin(db, 'review_growth_partner_application', [application.id, true, 're-checked'])).referral_code, reviewed.referral_code);

    // The format the database enforces is the format the app validates.
    for (const bad of ['SHORT', 'toolongcode123', 'ABC-DEF', 'NEXORA-ABC', 'nexora abc', 'NEXORA-' + 'A'.repeat(25)]) {
      await assert.rejects(
        callAdmin(db, 'provision_growth_partner', [NON_PARTNER, bad, true]),
        /Invalid referral code format/i,
        `rejected: ${bad}`
      );
    }
    // Lowercase input is normalized, not stored as a second identity.
    const normalized = await provision(db, NON_PARTNER, 'lowercase99');
    assert.equal(normalized.code, 'LOWERCASE99');
    assert.equal((await call(db, NON_PARTNER, 'validate_growth_referral_code', ['  lowercase99  '])).valid, true);

    // One store: the code lives in growth_partners.referral_code, and nowhere
    // else can generate or hold a partner's code.
    const codeColumns = (
      await db.query(`select table_name from information_schema.columns
        where table_schema='public' and column_name in ('referral_code','partner_code','referral_slug','code') order by table_name`)
    ).rows.map((row: any) => row.table_name);
    assert.deepEqual(codeColumns, ['growth_onboarding', 'growth_partners', 'growth_referral_attributions', 'partner_referral_attribution', 'partner_referrals']);
    const partners = (await db.query('select referral_code, is_active from public.growth_partners order by referral_code')).rows;
    assert.equal(partners.length, 3, 'one row per partner, created by the two admin paths only');
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 2. Partner ownership of referral code
// ===========================================================================

test('7.2 a code belongs to exactly one active partner and cannot be claimed or stolen', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'owner.a@partner.example');
    await account(db, PARTNER_B, 'owner.b@partner.example');
    const a = await provision(db, PARTNER_A, 'OWNERCODE1');
    const b = await provision(db, PARTNER_B);

    // Uniqueness: exact and case-insensitive.
    await assert.rejects(callAdmin(db, 'provision_growth_partner', [PARTNER_B, 'OWNERCODE1', true]), /already in use|duplicate key/i);
    await assert.rejects(callAdmin(db, 'provision_growth_partner', [PARTNER_B, 'ownercode1', true]), /already in use|duplicate key/i);
    assert.equal((await partnerRow(db, PARTNER_B)).referral_code, b.code, 'B keeps its own code');

    // The read resolves the code to validity only — never to a partner identity.
    // It is not public: an anonymous visitor has no EXECUTE grant, so the only
    // validation an unauthenticated browser can reach is the server endpoint's
    // `capture_growth_referral` (which is what the share link uses).
    const validation = await call(db, PARTNER_A, 'validate_growth_referral_code', [a.code]);
    assert.deepEqual(Object.keys(validation).sort(), ['referral_code', 'valid']);
    assert.equal(validation.valid, true);
    const grants = (
      await db.query(`select has_function_privilege('anon', 'public.validate_growth_referral_code(text)', 'EXECUTE') as anon_reads,
                             has_function_privilege('authenticated', 'public.validate_growth_referral_code(text)', 'EXECUTE') as auth_reads,
                             has_function_privilege('anon', 'public.capture_growth_referral(text,text)', 'EXECUTE') as anon_captures,
                             has_function_privilege('authenticated', 'public.provision_growth_partner(uuid,text,boolean)', 'EXECUTE') as auth_provisions`)
    ).rows[0];
    assert.deepEqual(grants, { anon_reads: false, auth_reads: true, anon_captures: true, auth_provisions: false });

    // A partner cannot refer themselves.
    await assert.rejects(call(db, PARTNER_A, 'link_my_growth_referral', [a.code]), /own referral code/i);

    // Ownership is what the attribution edge and the ledger point at:
    //   growth_onboarding.growth_partner_id -> growth_partners.user_id (RESTRICT)
    //   partner_referrals.partner_id        -> growth_partners.id
    const fks = (
      await db.query(`select c.conname, t.relname as target, a.attname as column
        from pg_constraint c
        join pg_class src on src.oid = c.conrelid
        join pg_class t on t.oid = c.confrelid
        join unnest(c.conkey) as k(attnum) on true
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.contype = 'f' and src.relname in ('growth_onboarding','partner_referrals')
          and t.relname in ('growth_partners')
        order by c.conname`)
    ).rows;
    assert.deepEqual(
      fks.map((row: any) => [row.column, row.target]),
      [
        ['growth_partner_id', 'growth_partners'],
        ['partner_id', 'growth_partners'],
      ]
    );

    // Deactivating a partner stops NEW referrals through that code, but the
    // partner stays the owner of the code and of the referrals already made.
    const { captured } = await signUpFromLink(db, OWNER, 'owned.owner@example.com', a.code);
    assert.equal(captured.valid, true);
    await callAdmin(db, 'provision_growth_partner', [PARTNER_A, a.code, false]);
    assert.equal((await call(db, OWNER, 'validate_growth_referral_code', [a.code])).valid, false, 'the authenticated read agrees');
    assert.equal((await callAnon(db, 'capture_growth_referral', [a.code, null])).valid, false, 'and the public capture path refuses it too');
    await assert.rejects(call(db, OWNER, 'link_my_growth_referral', [a.code]));
    assert.equal((await attribution(db, OWNER)).referral_code, a.code, 'the existing attribution still names the code');
    assert.equal((await ledger(db, OWNER))[0].partner_id, (await partnerRow(db, PARTNER_A)).id);
    assert.equal((await partnerRow(db, PARTNER_A)).referral_code, a.code, 'the code was not released or reassigned');
    assert.equal((await provision(db, PARTNER_A, a.code)).code, a.code, 'and only its own partner can re-activate it');

    // PART 3 provisioning never touches the partner's code.
    await call(db, PARTNER_A, 'ensure_owner_workspace');
    assert.equal((await partnerRow(db, PARTNER_A)).referral_code, a.code);
    assert.equal((await partnerRow(db, PARTNER_A)).is_active, true);
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 3. Referred user mapping
// ===========================================================================

test('7.3 the referred user is mapped once, by id, across click -> account -> ledger', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'map.a@partner.example');
    const partner = await provision(db, PARTNER_A, 'MAPPING01');

    const { captured } = await signUpFromLink(db, OWNER, 'mapped.owner@example.com', partner.code);
    const link = await attribution(db, OWNER);
    const rows = await ledger(db, OWNER);

    // The account is mapped by id, not by email/phone/name.
    assert.equal(link.user_id, OWNER);
    assert.equal(link.growth_partner_id, partner.userId);
    assert.equal(link.referral_code, partner.code);
    assert.ok(link.linked_at instanceof Date);

    // The anonymous click became the account's referral record: same id, one
    // row, promoted rather than duplicated.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, link.referral_id);
    assert.equal(rows[0].referred_user_id, OWNER);
    assert.equal(rows[0].partner_id, (await partnerRow(db, PARTNER_A)).id);

    // The capability row points at the same record and is spent exactly once.
    const capability = (await db.query('select * from public.growth_referral_attributions where token_hash = md5($1)', [captured.token])).rows[0];
    assert.equal(capability.consumed_by, OWNER);
    assert.ok(capability.consumed_at instanceof Date);
    assert.equal(capability.referral_id, link.referral_id);

    // A click that never became an account is a lead: recorded for the click
    // time, carrying no referred user, and invisible as a referral.
    await callAnon(db, 'capture_growth_referral', [partner.code, null]);
    const leads = (
      await db.query("select referred_user_id, status from public.partner_referrals where partner_id = $1 and referred_user_id is null", [
        (await partnerRow(db, PARTNER_A)).id,
      ])
    ).rows;
    assert.equal(leads.length, 1);
    assert.equal(leads[0].status, 'clicked');

    // Signing up without a capability attributes nothing.
    await account(db, OTHER_OWNER, 'unmapped.owner@example.com');
    const unmapped = await attribution(db, OTHER_OWNER);
    assert.equal(unmapped?.growth_partner_id ?? null, null);
    assert.deepEqual(await ledger(db, OTHER_OWNER), []);

    // An expired capability maps nothing either — it is not silently reused.
    const second = await callAnon(db, 'capture_growth_referral', [partner.code, null]);
    await db.query('update public.growth_referral_attributions set expires_at = now() - interval \'1 hour\' where token_hash = md5($1)', [second.token]);
    await account(db, NON_PARTNER, 'expired.owner@example.com', { growth_referral_token: second.token });
    assert.equal((await attribution(db, NON_PARTNER))?.growth_partner_id ?? null, null);
    assert.equal(
      (await db.query('select consumed_at from public.growth_referral_attributions where token_hash = md5($1)', [second.token])).rows[0].consumed_at,
      null
    );

    // The referred owner sees their own edge and nothing of the ledger.
    const ownEdge = await asUser(db, OWNER, 'select growth_partner_id, referral_code from public.growth_onboarding');
    assert.equal(ownEdge.rows.length, 1);
    const ownerLedger = await asUser(db, OWNER, 'select * from public.partner_referrals');
    assert.equal(ownerLedger.rows.length, 0, 'the ledger is the partner-facing record');
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 4. Signup attribution (through the PART 3 entry path)
// ===========================================================================

test('7.4 signup attribution survives the PART 3 workspace step byte-for-byte', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'signup.a@partner.example');
    const partner = await provision(db, PARTNER_A, 'SIGNUP001');
    const { captured } = await signUpFromLink(db, OWNER, 'signup.owner@example.com', partner.code, { full_name: 'Signup Owner' });
    assert.equal(captured.valid, true);

    const before = await attribution(db, OWNER);
    const ledgerBefore = await ledger(db, OWNER);
    assert.equal(before.status, 'linked');
    assert.ok(before.linked_at);

    // PART 3: the handoff boundary provisions the owner's workspace.
    const workspace = await call(db, OWNER, 'ensure_owner_workspace');
    assert.equal(workspace.provisioned, true);
    assert.ok(workspace.organization_id && workspace.salon_id && workspace.slug && workspace.name);

    // The referral row and its ledger row are untouched by provisioning.
    assert.deepEqual(await attribution(db, OWNER), before);
    assert.deepEqual(await ledger(db, OWNER), ledgerBefore);

    // The workspace is real and resolvable through the read path the app uses.
    const resolved = await call(db, OWNER, 'get_my_owner_workspace');
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.salon_id, workspace.salon_id);
    assert.equal(resolved.salon_count, 1);
    assert.equal(resolved.ambiguous, false);

    // Running it again is idempotent — still one workspace, still one referral.
    assert.equal((await call(db, OWNER, 'ensure_owner_workspace')).provisioned, false);
    assert.equal((await db.query('select count(*)::int n from public.salons where id = $1', [workspace.salon_id])).rows[0].n, 1);
    assert.deepEqual(await attribution(db, OWNER), before);

    // === and PART 3 introduced no second referral model ====================
    // (a) no referral-shaped column on any PART 3 table;
    const workspaceReferralColumns = (
      await db.query(`select table_name, column_name from information_schema.columns
        where table_schema='public' and table_name in ('organizations','organization_members','salons','services')
          and (column_name ilike '%referral%' or column_name ilike '%partner%' or column_name ilike '%growth%')`)
    ).rows;
    assert.deepEqual(workspaceReferralColumns, []);
    // (b) the whole schema gained no referral table since PHASE 6;
    const referralTables = (
      await db.query(`select table_name from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE'
          and (table_name ilike '%referral%' or table_name ilike '%partner%' or table_name ilike '%growth%')
        order by table_name`)
    ).rows.map((row: any) => row.table_name);
    // The growth chain now also includes the partner portal operations tables
    // (Earnings, Withdrawals, Marketing Materials, Partner Levels, Leaderboards,
    // Notifications, Support, Account Settings) which were missing from the
    // local gateway and caused "Your tickets could not load..." — they are NOT
    // a second referral model, they are the operational model that PART 3
    // consumes but does not write to.
    assert.deepEqual(referralTables, [
      'growth_onboarding',
      'growth_partner_applications',
      'growth_partners',
      'growth_referral_admin_audit',
      'growth_referral_attributions',
      'growth_referral_status_audit',
      'partner_account_settings',
      'partner_earnings',
      'partner_level_definitions',
      'partner_marketing_assets',
      'partner_notification_preferences',
      'partner_notifications',
      'partner_payout_requests',
      'partner_referral_events',
      'partner_referrals',
      'partner_support_attachments',
      'partner_support_tickets',
    ]);
    // (c) exactly one place stores the attribution edge, plus the single-use
    //     grant snapshot that the handoff already had.
    const edgeColumns = (
      await db.query(`select table_name from information_schema.columns
        where table_schema='public' and column_name='growth_partner_id' order by table_name`)
    ).rows.map((row: any) => row.table_name);
    assert.deepEqual(edgeColumns, ['growth_onboarding', 'template_handoffs']);
    // (d) PART 3 writes no growth/partner row of any kind.
    assert.equal((await db.query('select count(*)::int n from public.growth_partners')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from public.growth_onboarding')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from public.partner_referrals')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 5. Referral status
// ===========================================================================

test('7.5 referral status is the milestone-derived state machine, with admin dispositions only', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'status.a@partner.example');
    const partner = await provision(db, PARTNER_A, 'STATUS001');
    await signUpFromLink(db, OWNER, 'status.owner@example.com', partner.code);

    const statusOf = async () => {
      const list = await call(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0]);
      return list.rows[0];
    };

    // linked -> pending
    assert.equal((await statusOf()).referral_status, 'pending');
    assert.equal((await statusOf()).status, 'linked');
    assert.equal((await statusOf()).conversion_status, 'not_converted');

    // Handoff entry (the PART 3 boundary) -> active, on the same record.
    const handoff = await call(db, OWNER, 'create_template_handoff', ['state-7-5']);
    await call(db, OWNER, 'ensure_owner_workspace');
    await call(db, OWNER, 'exchange_template_handoff', [handoff.token]);
    const entered = await statusOf();
    assert.equal(entered.status, 'template_started');
    assert.equal(entered.referral_status, 'active');
    assert.ok(entered.template_started_at);
    assert.equal((await ledger(db, OWNER))[0].status, 'active', 'the ledger follows the milestone');

    // Milestones are forward-only and never re-timestamp.
    const startedAt = (await attribution(db, OWNER)).template_started_at;
    await call(db, OWNER, 'update_my_onboarding_progress', ['start_template']);
    assert.equal((await attribution(db, OWNER)).template_started_at.getTime(), startedAt.getTime());

    // Dispositions are admin-only, audited, and limited to the three values.
    await assert.rejects(call(db, PARTNER_A, 'admin_set_growth_referral_status', [OWNER, 'cancelled', 'partner tried']), /permission denied/i);
    await assert.rejects(callAdmin(db, 'admin_set_growth_referral_status', [OWNER, 'paused', 'invalid value']), /Unsupported referral disposition/i);
    await assert.rejects(callAdmin(db, 'admin_set_growth_referral_status', [OWNER, 'cancelled', 'x']), /audit reason/i);
    await callAdmin(db, 'admin_set_growth_referral_status', [OWNER, 'cancelled', 'Duplicate signup confirmed'], ADMIN);
    assert.equal((await statusOf()).referral_status, 'cancelled');
    assert.equal((await statusOf()).status, 'template_started', 'the milestone itself is not rewritten');
    const audit = (await db.query('select * from public.growth_referral_status_audit where referred_user_id = $1', [OWNER])).rows;
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].old_status, audit[0].new_status], ['active', 'cancelled']);
    assert.equal(audit[0].actor_id, ADMIN);
    // Clearing the disposition resumes the real milestone status.
    await callAdmin(db, 'admin_set_growth_referral_status', [OWNER, null, 'Reinstated after review'], ADMIN);
    assert.equal((await statusOf()).referral_status, 'active');
    assert.equal((await db.query('select count(*)::int n from public.growth_referral_status_audit where referred_user_id = $1', [OWNER])).rows[0].n, 2);

    // The client cannot set the disposition even by writing the column.
    await assert.rejects(
      asUser(db, OWNER, "update public.growth_onboarding set referral_status_override = 'rejected' where user_id = $1", [OWNER]),
      /permission denied/i
    );
    // And a partner cannot read another partner's referral status at all.
    await account(db, PARTNER_B, 'status.b@partner.example');
    await provision(db, PARTNER_B, 'STATUS002');
    assert.equal((await call(db, PARTNER_B, 'get_my_partner_referrals', ['all', null, 20, 0])).total, 0);
    assert.equal((await call(db, PARTNER_B, 'get_my_partner_referral_detail', [(await ledger(db, OWNER))[0].id])), null);
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 6. Partner dashboard visibility
// ===========================================================================

test('7.6 the partner dashboard shows the referred user, masked, scoped to the owning partner', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'dash.a@partner.example', { full_name: 'Dashboard Partner A' });
    await account(db, PARTNER_B, 'dash.b@partner.example', { full_name: 'Dashboard Partner B' });
    const partner = await provision(db, PARTNER_A, 'DASHBOARD1');
    await provision(db, PARTNER_B, 'DASHBOARD2');

    const email = 'visible.owner@example.com';
    await signUpFromLink(db, OWNER, email, partner.code, { full_name: 'Visible Owner' });
    await call(db, OWNER, 'ensure_owner_workspace');

    // The dashboard's own code block comes from the canonical row.
    const dashboard = await call(db, PARTNER_A, 'get_my_partner_dashboard');
    assert.equal(dashboard.partner.referral_code, partner.code);
    assert.equal(dashboard.partner.is_active, true);
    assert.equal(dashboard.totalReferrals, 1);
    assert.equal(dashboard.kpis.total_referrals, 1);
    assert.equal(dashboard.pendingReferrals, 1);
    assert.equal(dashboard.referral_status_counts.pending, 1);
    assert.equal(dashboard.referral_status_counts.converted, 0);
    assert.equal(dashboard.recent_activity[0].type, 'referral_added');
    assert.equal(dashboard.recent_activity[0].display_name, 'Visible Owner');
    assert.match(dashboard.recent_activity[0].ref, /^…[0-9a-f]{8}$/);

    // The list names the referral without exposing the account.
    const list = await call(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0]);
    assert.equal(list.total, 1);
    const row = list.rows[0];
    assert.equal(row.referral_id, (await attribution(db, OWNER)).referral_id);
    assert.equal(row.display_name, 'Visible Owner');
    assert.equal(row.referral_code, partner.code);
    assert.equal(row.masked_contact, 'vi***@example.com');
    assert.match(row.ref, /^…[0-9a-f]{8}$/);
    assert.ok(!row.ref.includes(OWNER), 'the raw user id is not exposed');
    const serialized = JSON.stringify({ dashboard, list });
    assert.ok(!serialized.includes(email), 'the raw email never reaches the partner client');
    assert.ok(!serialized.includes(OWNER), 'the raw user id never reaches the partner client');
    assert.ok(!serialized.includes('+91'), 'no contact number is present');

    // Filters are real server-side filters over the same rows.
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_referrals', ['pending', null, 20, 0])).total, 1);
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_referrals', ['converted', null, 20, 0])).total, 0);
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_referrals', ['all', 'visible.owner', 20, 0])).total, 1);
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_referrals', ['all', 'someone.else', 20, 0])).total, 0);
    await assert.rejects(call(db, PARTNER_A, 'get_my_partner_referrals', ['nonsense', null, 20, 0]), /Invalid referral filters/i);

    // Scoping: B sees none of it, and a non-partner sees nothing at all.
    const otherDashboard = await call(db, PARTNER_B, 'get_my_partner_dashboard');
    assert.equal(otherDashboard.totalReferrals, 0);
    assert.equal(otherDashboard.partner.referral_code, 'DASHBOARD2');
    assert.equal((await call(db, PARTNER_B, 'get_my_partner_referrals', ['all', null, 20, 0])).total, 0);
    await account(db, NON_PARTNER, 'not.a.partner@example.com');
    await assert.rejects(call(db, NON_PARTNER, 'get_my_partner_dashboard'), /Growth Partner access required/i);
    await assert.rejects(callAnon(db, 'get_my_partner_dashboard'));
    // A referral detail belongs to its partner and nobody else.
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_referral_detail', [row.referral_id])).referral_id, row.referral_id);
    assert.equal(await call(db, PARTNER_B, 'get_my_partner_referral_detail', [row.referral_id]), null);
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 7. Conversion status
// ===========================================================================

test('7.7 completing the PART 3 workspace path converts the referral, once, for the partner to see', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'conv.a@partner.example');
    const partner = await provision(db, PARTNER_A, 'CONVERT01');
    await signUpFromLink(db, OWNER, 'converting.owner@example.com', partner.code, { full_name: 'Converting Owner' });

    // The owner is in the funnel and has a workspace (PART 3).
    const handoff = await call(db, OWNER, 'create_template_handoff', ['state-7-7']);
    const workspace = await call(db, OWNER, 'ensure_owner_workspace');
    await call(db, OWNER, 'exchange_template_handoff', [handoff.token]);
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])).rows[0].referral_status, 'active');

    // The website is not finished yet, so completion must refuse and change nothing.
    const beforeAttempt = await attribution(db, OWNER);
    await assert.rejects(call(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/i);
    await assert.rejects(call(db, OWNER, 'update_my_onboarding_progress', ['complete_template']), /website setup is not complete yet/i);
    assert.deepEqual(await attribution(db, OWNER), beforeAttempt);

    // The editor's save writes an active service into the owner's own salon.
    await db.query('insert into public.services(id, salon_id, name, price_paise, duration_minutes, is_active) values(gen_random_uuid(), $1, $2, 50000, 45, true)', [
      workspace.salon_id,
      'Signature Cut',
    ]);

    // The verified completion event — the same RPC the editor calls after a save.
    const completed = await call(db, OWNER, 'complete_template_onboarding');
    assert.equal(completed.completed, true);
    assert.equal(completed.status, 'template_completed');
    assert.equal(completed.referral_code, partner.code, 'completion never touches referral ownership');
    assert.ok(completed.template_started_at && completed.template_completed_at);

    const conversion = await ledger(db, OWNER);
    assert.equal(conversion.length, 1, 'still one referral record');
    assert.equal(conversion[0].status, 'converted');
    assert.equal(conversion[0].conversion_status, 'converted');
    assert.equal(conversion[0].converted_at.toISOString(), new Date(completed.template_completed_at).toISOString());
    assert.equal(conversion[0].id, (await attribution(db, OWNER)).referral_id);

    // The partner sees the conversion through the existing dashboard.
    const dashboard = await call(db, PARTNER_A, 'get_my_partner_dashboard');
    assert.equal(dashboard.convertedReferrals, 1);
    assert.equal(dashboard.referral_status_counts.converted, 1);
    assert.equal(dashboard.referral_status_counts.active, 0);
    assert.equal(dashboard.kpis.completed, 1);
    const list = await call(db, PARTNER_A, 'get_my_partner_referrals', ['converted', null, 20, 0]);
    assert.equal(list.total, 1);
    assert.equal(list.rows[0].referral_status, 'converted');
    assert.equal(list.rows[0].conversion_status, 'converted');

    // Idempotent: a second save cannot double-count or re-timestamp.
    const again = await call(db, OWNER, 'complete_template_onboarding');
    assert.equal(again.completed, true);
    assert.equal(again.template_completed_at, completed.template_completed_at);
    const after = await ledger(db, OWNER);
    assert.equal(after.length, 1);
    assert.equal(after[0].converted_at.getTime(), conversion[0].converted_at.getTime());
    assert.equal((await call(db, PARTNER_A, 'get_my_partner_dashboard')).convertedReferrals, 1);

    // And the referral still cannot be re-pointed after conversion.
    await account(db, PARTNER_B, 'conv.b@partner.example');
    await provision(db, PARTNER_B, 'CONVERT02');
    await assert.rejects(call(db, OWNER, 'link_my_growth_referral', ['CONVERT02']), /already linked/i);
    assert.equal((await attribution(db, OWNER)).referral_code, partner.code);
  } finally {
    await db.close();
  }
});

// ===========================================================================
// 8. Duplicate prevention
// ===========================================================================

test('7.8 duplicates are impossible for a user, and a code may still serve many users', async () => {
  const db = await part3Db();
  try {
    await account(db, PARTNER_A, 'dupe.a@partner.example');
    const partner = await provision(db, PARTNER_A, 'DUPLICATE1');

    // --- one capability, one account --------------------------------------
    const { token } = await signUpFromLink(db, OWNER, 'first.owner@example.com', partner.code);
    await account(db, OTHER_OWNER, 'second.owner@example.com', { growth_referral_token: token });
    assert.equal((await attribution(db, OTHER_OWNER))?.growth_partner_id ?? null, null, 'a spent capability maps nobody else');
    assert.deepEqual(await ledger(db, OTHER_OWNER), []);
    assert.equal((await db.query('select count(*)::int n from public.growth_referral_attributions where token_hash = md5($1)', [token])).rows[0].n, 1);

    // --- one account, one referral record ---------------------------------
    await assert.rejects(
      db.query("insert into public.partner_referrals(partner_id, referral_code, referred_user_id, status, registered_at) values ($1,'DUPLICATE1',$2,'pending',now())", [
        (await partnerRow(db, PARTNER_A)).id,
        OWNER,
      ]),
      /duplicate key|unique/i,
      'a user cannot hold two referral records'
    );
    await assert.rejects(
      db.query("insert into public.growth_onboarding(user_id, growth_partner_id, referral_code, linked_at) values ($1,$2,'DUPLICATE1',now())", [OWNER, PARTNER_A]),
      /duplicate key|unique/i,
      'a user cannot hold two attribution edges'
    );
    await assert.rejects(
      asUser(db, OWNER, 'update public.growth_onboarding set growth_partner_id = $1, referral_code = \'DUPLICATE1\' where user_id = $2', [PARTNER_A, OWNER]),
      /immutable|permission denied/i,
      'and cannot re-point the one they hold'
    );

    // --- a code may serve many users (duplicates are per USER) -------------
    await signUpFromLink(db, NON_PARTNER, 'third.owner@example.com', partner.code);
    const rows = await call(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0]);
    assert.equal(rows.total, 2, 'two distinct referred accounts through one code');
    assert.equal(new Set(rows.rows.map((r: any) => r.referral_id)).size, 2, 'distinct referral records');
    assert.equal((await db.query('select count(*)::int n from public.growth_onboarding where growth_partner_id = $1', [PARTNER_A])).rows[0].n, 2);
    assert.equal((await db.query('select count(*)::int n from public.partner_referrals where referred_user_id is not null')).rows[0].n, 2);

    // --- the click ledger may repeat, and that is not a duplicate referral -
    // An anonymous visitor with no cookie gets a fresh capability per click;
    // none of those rows can ever count as a referral.
    await callAnon(db, 'capture_growth_referral', [partner.code, null]);
    await callAnon(db, 'capture_growth_referral', [partner.code, null]);
    const leads = (await db.query('select count(*)::int n from public.partner_referrals where referred_user_id is null')).rows[0].n;
    assert.equal(leads, 2);
    const dashboard = await call(db, PARTNER_A, 'get_my_partner_dashboard');
    assert.equal(dashboard.totalReferrals, 2, 'anonymous clicks never inflate the referral count');
    assert.equal(dashboard.kpis.total_referrals, 2);
    assert.equal((await db.query('select count(*)::int n from public.growth_referral_attributions where consumed_at is null')).rows[0].n, 2);

    // --- self-referral is refused in every layer ---------------------------
    await assert.rejects(
      db.query("insert into public.growth_onboarding(user_id, growth_partner_id, referral_code, linked_at) values ($1,$1,'DUPLICATE1',now())", [PARTNER_A]),
      /no_self_referral|You cannot refer yourself/i
    );
    const selfLedger = (await partnerRow(db, PARTNER_A)).id;
    await assert.rejects(
      db.query("insert into public.partner_referrals(partner_id, referral_code, referred_user_id, status, registered_at) values ($1,'DUPLICATE1',$2,'pending',now())", [
        selfLedger,
        PARTNER_A,
      ]),
      /cannot refer yourself/i
    );
  } finally {
    await db.close();
  }
});

// ===========================================================================
// Boundary: one model, and PART 3 is a consumer of it
// ===========================================================================

test('7.9 PART 3 consumes the referral model: no second table, code store, status enum or write path', async () => {
  const db = await part3Db();
  try {
    // The PART 3 migration itself creates no referral object. Read the file
    // that was actually applied.
    const part3 = MIGRATION(PART3_MIGRATION);
    assert.ok(!/create table[^;]*referral/i.test(part3), 'no referral table');
    assert.ok(!/referral_code|growth_partner|referral_status/i.test(part3.replace(/--.*$/gm, '')), 'no referral column or state');
    assert.ok(!/growth_onboarding|partner_referrals/.test(part3.replace(/--.*$/gm, '')), 'no write path into the referral tables');

    // The database agrees: the referral tables are exactly the committed chain,
    // every attribution edge still funnels through one table, and every writer
    // of that edge is a referral function (never a PART 3 one).
    const edgeWriters = (
      await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ 'growth_partner_id' and p.proname ilike '%owner%'`)
    ).rows.map((row: any) => row.proname);
    assert.deepEqual(edgeWriters, [], 'no owner/workspace function writes the attribution edge');

    const part3Functions = (
      await db.query(`select unnest(array['ensure_owner_workspace','get_my_owner_workspace','nexora_owner_salon_ids']) as fn`)
    ).rows.map((row: any) => row.fn);
    for (const fn of part3Functions) {
      assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = $1`, [fn])).rows[0].n, 1, `${fn} exists once`);
    }

    // And the ownership rule still holds after everything PART 3 did.
    await account(db, PARTNER_A, 'boundary.a@partner.example');
    const partner = await provision(db, PARTNER_A, 'BOUNDARY1');
    await signUpFromLink(db, OWNER, 'boundary.owner@example.com', partner.code);
    await call(db, OWNER, 'ensure_owner_workspace');
    await assert.rejects(call(db, OWNER, 'link_my_growth_referral', ['BOUNDARY1']), /already linked/i);
    assert.equal((await attribution(db, OWNER)).growth_partner_id, partner.userId);
    assert.equal((await ledger(db, OWNER)).length, 1);
  } finally {
    await db.close();
  }
});
