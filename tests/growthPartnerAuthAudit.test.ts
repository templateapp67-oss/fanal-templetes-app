// ============================================================================
// E2E-A AUDIT — auth + Growth Partner access + referral code + relationship.
//
// Focuses on the wiring defects this audit found and fixed:
//   1. A signed-in partner deep-linking to /growth-partner/login must NOT
//      flash the "unauthorized" card before the backend role check resolves
//      (verifying starts as soon as a session user is seeded).
//   2. The login route's authorization read must use the SAME injected client
//      as its auth actions (client.fetchPartnerRow), not a hard-wired global.
//   3. In mock/demo mode (no Supabase) the login route must not fire a role
//      read against the placeholder host.
// Plus a compact re-pin of the five audit areas against the real migration.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  resolveGrowthPartnerLogin,
  signInGrowthPartner,
  loadGrowthPartnerSession,
  signOutGrowthPartner,
  type GrowthPartnerAuthClient,
} from '../src/lib/growthPartnerLogin';
import { resolveGrowthPartnerGate } from '../src/lib/growthPartner';
import { GrowthPartnerLogin } from '../src/components/GrowthPartnerLogin';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);

const ROW_ACTIVE = {
  user_id: PARTNER_A,
  referral_code: CODE_A,
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};
const ROW_INACTIVE = { ...ROW_ACTIVE, user_id: PARTNER_B, referral_code: CODE_B, is_active: false };

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function sessionOf(id: string, email: string) {
  return { data: { session: { user: { id, email } } }, error: null };
}

function clientWith(auth: Partial<GrowthPartnerAuthClient['auth']>, fetchPartnerRow?: GrowthPartnerAuthClient['fetchPartnerRow']): GrowthPartnerAuthClient {
  return {
    auth: {
      signInWithPassword: auth.signInWithPassword ?? (async () => ({ data: {}, error: null })),
      signOut: auth.signOut ?? (async () => ({ error: null })),
      getSession: auth.getSession ?? (async () => ({ data: { session: null }, error: null })),
    },
    fetchPartnerRow,
  };
}

// ---------------------------------------------------------------------------
// Fix 1: no "unauthorized" flash for an already-signed-in partner
// ---------------------------------------------------------------------------

test('an already-signed-in partner never flashes the unauthorized card on the login route', () => {
  const client = clientWith(
    { getSession: async () => sessionOf(PARTNER_A, 'anita@example.com') },
    async () => ROW_ACTIVE
  );
  const html = render(
    React.createElement(GrowthPartnerLogin, {
      user: { id: PARTNER_A, email: 'anita@example.com' },
      client,
      navigate: () => {},
      onBack: () => {},
    })
  );
  // First paint must be the verifying state, NOT the denial card.
  assert.match(html, /Checking your Growth Partner access/);
  assert.doesNotMatch(html, /Growth Partners only/);
  assert.doesNotMatch(html, /Growth Partner access is paused/);
});

test('a signed-out visitor still lands directly on the login form', () => {
  const html = render(
    React.createElement(GrowthPartnerLogin, {
      user: null,
      client: clientWith({}),
      navigate: () => {},
      onBack: () => {},
    })
  );
  assert.match(html, /growth-partner-login-email/);
  assert.match(html, /growth-partner-login-password/);
  assert.doesNotMatch(html, /Checking your Growth Partner access/);
});

// ---------------------------------------------------------------------------
// Fix 2 + 3: role read through the injected client; no mock-mode placeholder call
// ---------------------------------------------------------------------------

test('the login route reads the role through the same injected client as auth', () => {
  const src = readFileSync(new URL('../src/components/GrowthPartnerLogin.tsx', import.meta.url), 'utf8');
  // The component binds the role read to client.fetchPartnerRow (fallback
  // fetchMyGrowthPartnerRow) — not a hard-wired global call.
  assert.match(src, /client\?\.fetchPartnerRow \?\? fetchMyGrowthPartnerRow/);
  assert.match(src, /await readPartnerRow\(\)/);
  // The role effect skips the placeholder-host read in mock mode (no client).
  assert.match(src, /isMockSupabase && !client/);

  const lib = readFileSync(new URL('../src/lib/growthPartnerLogin.ts', import.meta.url), 'utf8');
  assert.match(lib, /fetchPartnerRow\?: \(\) => Promise<GrowthPartner \| null>/);
});

// ---------------------------------------------------------------------------
// Compact re-pin of the five audit areas (existing suites cover the depth)
// ---------------------------------------------------------------------------

test('auth: valid login yields the viewer; wrong password is rejected; logout clears; refresh restores', async () => {
  const good = clientWith({ signInWithPassword: async () => sessionOf(PARTNER_A, 'anita@example.com') });
  const viewer = await signInGrowthPartner(good, { email: 'anita@example.com', password: 'pw' });
  // isAdmin is part of the viewer contract: false unless the auth provider
  // marks the account as an admin (it only unlocks the local review queue).
  assert.deepEqual(viewer, { id: PARTNER_A, email: 'anita@example.com', isAdmin: false });

  const bad = clientWith({ signInWithPassword: async () => ({ data: {}, error: { message: 'Invalid login credentials' } }) });
  await assert.rejects(signInGrowthPartner(bad, { email: 'x@x.com', password: 'nope' }), /Invalid email or password/);

  let signedOut = false;
  const logout = clientWith({ signOut: async () => { signedOut = true; return { error: null }; } });
  await signOutGrowthPartner(logout);
  assert.equal(signedOut, true);

  const restored = await loadGrowthPartnerSession(clientWith({ getSession: async () => sessionOf(PARTNER_A, 'anita@example.com') }));
  assert.deepEqual(restored, { id: PARTNER_A, email: 'anita@example.com', isAdmin: false });
});

test('access: active allowed, normal denied, inactive denied (pure resolvers agree)', () => {
  assert.equal(
    resolveGrowthPartnerGate({ userId: PARTNER_A, loading: false, isMockMode: false, partnerRow: ROW_ACTIVE, loadError: null }),
    'ready'
  );
  assert.equal(
    resolveGrowthPartnerGate({ userId: USER_1, loading: false, isMockMode: false, partnerRow: null, loadError: null }),
    'unauthorized'
  );
  assert.equal(
    resolveGrowthPartnerGate({ userId: PARTNER_B, loading: false, isMockMode: false, partnerRow: ROW_INACTIVE, loadError: null }),
    'inactive'
  );
  assert.equal(
    resolveGrowthPartnerLogin({ loading: false, isMockMode: false, userId: PARTNER_A, partnerRow: ROW_ACTIVE, loadError: null }),
    'granted'
  );
});

test('referral code + ownership: RLS scopes each partner to their own row only', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id) values ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}');
  `);
  await db.exec(MIGRATION);
  try {
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);

    const readOwn = async (uid: string) =>
      (await asUser(db, uid, 'select referral_code from public.growth_partners')).rows;

    // Partner A sees Code A; Partner B sees Code B.
    assert.deepEqual((await readOwn(PARTNER_A)).map((r: any) => r.referral_code), [CODE_A]);
    assert.deepEqual((await readOwn(PARTNER_B)).map((r: any) => r.referral_code), [CODE_B]);
    // A normal user sees nothing.
    assert.equal((await readOwn(USER_1)).length, 0);

    // Cross-requesting by user_id still yields zero rows (RLS, not a filter).
    const cross = await asUser(
      db,
      PARTNER_A,
      'select referral_code from public.growth_partners where user_id = $1::uuid',
      [PARTNER_B]
    );
    assert.equal(cross.rows.length, 0);

    // Ownership is immutable: a normal client cannot change the link.
    const steal = await (async () => {
      try {
        await asUser(db, USER_1, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_1]);
        return null;
      } catch (e: any) {
        return e;
      }
    })();
    assert.ok(steal);
    assert.match(steal.message, /permission denied|row-level security/i);
  } finally {
    await db.close();
  }
});

test('referral linking: valid code links correctly; invalid/inactive rejected; already-linked unchanged', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id) values ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}');
  `);
  await db.exec(MIGRATION);
  try {
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query('select public.provision_growth_partner($1::uuid, $2, false)', [PARTNER_B, CODE_B]);

    const rpc = (uid: string, fn: string, args: any[] = []) => {
      const ph = args.map((_, i) => `$${i + 1}`).join(', ');
      return asUser(db, uid, `select public.${fn}(${ph}) as result`, args).then((r: any) => r.rows[0].result);
    };

    const linked = await rpc(USER_1, 'link_my_growth_referral', ['alpha01']);
    assert.equal(linked.growth_partner_id, PARTNER_A);
    assert.equal(linked.referral_code, CODE_A);

    await assert.rejects(rpc(USER_1, 'link_my_growth_referral', [CODE_A]), /already linked/);
    await assert.rejects(rpc(USER_1, 'link_my_growth_referral', ['NOPE99']), /Invalid or inactive/);
    await assert.rejects(rpc(USER_1, 'link_my_growth_referral', [CODE_B]), /Invalid or inactive/);

    // The relationship stayed on Partner A after every failed attempt.
    assert.equal((await rpc(USER_1, 'get_my_growth_referral')).growth_partner_id, PARTNER_A);
  } finally {
    await db.close();
  }
});
