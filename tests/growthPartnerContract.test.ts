// ============================================================================
// Growth Partner area — frontend ↔ backend contract.
//
// Every other Growth Partner test pins one behaviour. This one pins the seam:
// it reads the RPC names straight out of the client modules, applies the real
// migration chain to PGlite, and requires that each call the UI can make
// resolves to a function that exists AND is executable by `authenticated`
// (and not by `anon`). A new `supabase.rpc('…')` in the client without a
// migration behind it fails here instead of failing in production with
// PGRST202 — which is exactly how the area's broken first read went unnoticed.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const CLIENT_MODULES = [
  '../src/lib/growthPartner.ts',
  '../src/lib/growthPartnerLogin.ts',
  '../src/onboarding/lib/flow.ts',
];

const MIGRATIONS = [
  '20260911094853_growth_partner_signup_approval.sql',
  '20260911101201_growth_partner_kyc_approval.sql',
  '20260912_growth_partner_onboarding.sql',
  '20260913_template_handoff.sql',
  '20260914_template_completion.sql',
  '20260915_growth_partner_dashboard.sql',
  '20260916_part1_referral_hardening.sql',
  '20260917_part1b_link_atomicity.sql',
  '20260918_partner_dashboard_inactive_guard.sql',
  '20260919_growth_partner_area_contract_alignment.sql',
  '20260920_growth_partner_application_queue.sql',
];

/** Every `rpc('<name>'` the Growth Partner client surface can issue. */
function clientRpcNames(): string[] {
  const names = new Set<string>();
  for (const file of CLIENT_MODULES) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) names.add(match[1]);
  }
  assert.ok(names.size >= 10, `expected the client surface to call many RPCs, found ${names.size}`);
  return [...names].sort();
}

async function setup() {
  const db: any = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    alter default privileges in schema public grant execute on functions to service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;

    create table public.profiles(
      id uuid primary key, full_name text, subdomain text, salon_name text, email text
    );
    create table public.services(id uuid primary key, owner_id uuid);

    create schema private;
    create function private.is_admin() returns boolean language sql stable as
      $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
    grant usage on schema private to authenticated, anon;
  `);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  return db;
}

test('every RPC the Growth Partner client calls exists and is callable by authenticated', async () => {
  const db = await setup();
  try {
    const names = clientRpcNames();
    for (const name of names) {
      const found = await db.query(
        `select p.oid::regprocedure::text as signature,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_can_call,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_call
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name]
      );
      assert.ok(found.rows.length > 0, `public.${name}() is called by the client but no migration creates it`);
      assert.ok(
        found.rows.some((row: any) => row.client_can_call),
        `public.${name}() exists but \`authenticated\` has no EXECUTE grant — the browser call would 42501`
      );
      assert.ok(
        found.rows.every((row: any) => !row.anon_can_call),
        `public.${name}() must not be executable by anon`
      );
    }
  } finally {
    await db.close();
  }
});

test('the admin-only functions are not reachable from a browser session', async () => {
  const db = await setup();
  try {
    for (const name of [
      'review_growth_partner_application',
      'provision_growth_partner',
      'provision_growth_partner_by_email',
      'list_growth_partner_applications',
    ]) {
      const granted = await db.query(
        `select has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_can_call
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name]
      );
      assert.ok(granted.rows.length > 0, `public.${name}() must exist`);
      assert.equal(
        granted.rows[0].client_can_call,
        false,
        `public.${name}() is admin-only and must have no EXECUTE for authenticated`
      );
    }
  } finally {
    await db.close();
  }
});

test('the area tables exist with row level security enabled', async () => {
  const db = await setup();
  try {
    for (const table of ['growth_partners', 'growth_onboarding', 'growth_partner_applications']) {
      const res = await db.query(
        `select c.relrowsecurity as rls,
                (select count(*)::int from pg_policies p
                  where p.schemaname = 'public' and p.tablename = $1) as policies
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`,
        [table]
      );
      assert.equal(res.rows.length, 1, `public.${table} must exist`);
      assert.equal(res.rows[0].rls, true, `public.${table} must have RLS enabled`);
      assert.ok(res.rows[0].policies > 0, `public.${table} must have at least one policy`);
    }

    // The partner row the whole area is gated on keeps one active-flag column.
    const columns = await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'growth_partners'`
    );
    const names = columns.rows.map((row: any) => row.column_name);
    assert.ok(names.includes('is_active'), 'growth_partners must expose is_active');
    assert.ok(names.includes('referral_code'), 'growth_partners must expose referral_code');
  } finally {
    await db.close();
  }
});

test('no client call passes a partner or user id (the backend derives the caller)', async () => {
  // The security model: every partner read is scoped to auth.uid() server-side,
  // so a call payload may never carry an identity to manipulate. Type
  // declarations of the stored rows are fine — only what is SENT matters.
  const calls: { file: string; fn: string; payload: string }[] = [];
  for (const file of CLIENT_MODULES) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'\s*,\s*\{([^{}]*)\}/g)) {
      calls.push({ file, fn: match[1], payload: match[2] });
    }
  }
  // Five of the client calls send an explicit payload; the rest take none.
  assert.ok(calls.length >= 5, `expected the payload-carrying calls, found ${calls.length}`);
  const fns = calls.map((call) => call.fn).sort();
  for (const expected of [
    'link_my_growth_referral',
    'submit_growth_partner_application',
    'update_my_onboarding_progress',
    'validate_growth_referral_code',
  ]) {
    assert.ok(fns.includes(expected), `${expected}() payload must be covered by this check`);
  }
  for (const call of calls) {
    assert.doesNotMatch(
      call.payload,
      /(growth_)?partner_id|user_id/,
      `${call.file} → ${call.fn}() must not send an identity: ${call.payload.trim()}`
    );
  }
});

const ADMIN_MODULE = '../src/lib/growthPartnerAdmin.ts';

test('the admin module only calls admin-only functions and never sends an identity', async () => {
  const src = readFileSync(new URL(ADMIN_MODULE, import.meta.url), 'utf8');
  const calls = [...src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'\s*,\s*\{([^{}]*)\}/g)].map(
    (match) => ({ fn: match[1], payload: match[2] })
  );
  const fns = [...new Set(calls.map((call) => call.fn))].sort();
  assert.deepEqual(fns, [
    'list_growth_partner_applications',
    'review_growth_partner_application',
  ], 'the admin module must only issue admin RPCs');

  const db = await setup();
  try {
    for (const fn of fns) {
      const priv = await db.query(
        `select has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_can_call,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_call,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as admin_can_call
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn]
      );
      assert.ok(priv.rows.length > 0, `public.${fn}() must exist in the committed chain`);
      assert.equal(priv.rows[0].client_can_call, false, `public.${fn}() must be unreachable from a browser session`);
      assert.equal(priv.rows[0].anon_can_call, false, `public.${fn}() must be unreachable anonymously`);
      assert.equal(priv.rows[0].admin_can_call, true, `public.${fn}() must stay usable by the admin role`);
    }
  } finally {
    await db.close();
  }

  // The reviewer's identity comes from auth.uid(); the payload must not carry one.
  for (const call of calls) {
    assert.doesNotMatch(
      call.payload,
      /(growth_)?partner_id|user_id|reviewed_by/,
      `${call.fn}() must not send an identity: ${call.payload.trim()}`
    );
  }
});
