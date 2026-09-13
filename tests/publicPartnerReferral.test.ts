import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_A = 'b0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000002';
const USER_C = 'b0000000-0000-4000-8000-000000000003';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const BASE = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);
const HARDENING = readFileSync(
  new URL('../supabase/migrations/20260916_part1_referral_hardening.sql', import.meta.url),
  'utf8'
);
const ATOMICITY = readFileSync(
  new URL('../supabase/migrations/20260917_part1b_link_atomicity.sql', import.meta.url),
  'utf8'
);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id, email) values
      ('${PARTNER_A}', 'anita@example.com'), ('${PARTNER_B}', 'bala@example.com'),
      ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com'), ('${USER_C}', 'c@example.com');
    insert into public.profiles(id, full_name) values
      ('${PARTNER_A}', 'Partner Anita'), ('${PARTNER_B}', 'Partner Bala');
  `);
  await db.exec(BASE);
  await db.exec(HARDENING);
  await db.exec(ATOMICITY);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921_public_partner_referral_codes.sql', import.meta.url), 'utf8'));
  return db;
}

/** Call an RPC as an authenticated user; returns the parsed jsonb result. */
async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}


import { isGrowthReferralCodeFormat } from '../src/lib/growthPartner';
import { matchPartnerPortalRoute, partnerPortalPath, isOnboardingPath, matchOnboardingRoute } from '../src/lib/router';

test('public referral routes and format accept branded and legacy codes', () => {
  assert.equal(matchPartnerPortalRoute('/partner/referral'), 'referral-code');
  assert.equal(matchPartnerPortalRoute('/partner/referral-code'), 'referral-code');
  assert.equal(partnerPortalPath('referral-code'), '/partner/referral');
  assert.equal(isOnboardingPath('/signup'), true);
  assert.equal(matchOnboardingRoute('/signup'), 'signup');
  for (const code of [' nexora-rahul25 ', 'ALPHA01']) assert.equal(isGrowthReferralCodeFormat(code), true);
  assert.equal(isGrowthReferralCodeFormat(PARTNER_A), false);
});

test('public codes: generation, stability, normalization, unique ownership and admin-only rotation', async () => {
  const db = await setup();
  try {
    const provision = async (id: string, code: string | null = null) =>
      (await db.query<any>('select public.provision_growth_partner($1::uuid, $2) as result', [id, code])).rows[0].result;
    const first = await provision(PARTNER_A);
    assert.match(first.referral_code, /^NEXORA-[A-Z0-9]{12}$/);
    assert.equal((await provision(PARTNER_A)).referral_code, first.referral_code);
    assert.notEqual((await provision(PARTNER_B)).referral_code, first.referral_code);
    assert.equal((await provision(PARTNER_A, ' nexora-rahul25 ')).referral_code, 'NEXORA-RAHUL25');
    await assert.rejects(provision(PARTNER_B, 'nexora-rahul25'), /already in use/);
    assert.deepEqual(await rpc(db, USER_A, 'validate_growth_referral_code', [' nexora-rahul25 ']), { valid: true, referral_code: 'NEXORA-RAHUL25' });
    const linked = await rpc(db, USER_A, 'link_my_growth_referral', ['nexora-rahul25']);
    assert.equal(linked.growth_partner_id, PARTNER_A);
    await assert.rejects(rpc(db, PARTNER_A, 'provision_growth_partner', [PARTNER_A, 'NEXORA-HACK01']), /permission denied/);
    await provision(PARTNER_A, 'NEXORA-NEWCODE');
    const row = (await db.query<any>('select growth_partner_id, referral_code from public.growth_onboarding where user_id = $1', [USER_A])).rows[0];
    assert.equal(row.growth_partner_id, PARTNER_A);
    assert.equal(row.referral_code, 'NEXORA-RAHUL25');
  } finally { await db.close(); }
});
