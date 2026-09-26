import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { referralCodeFromQuery } from '../src/lib/referralQuery';
import { normalizeGrowthReferralCode } from '../src/lib/growthPartner';
import { prepareSignupAttribution } from '../src/onboarding/lib/referralAttribution';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
const CODE_A = 'NEXORA-ORCHID47';
const CODE_B = 'NEXORA-CEDAR91';
const migration = readFileSync(new URL('../supabase/migrations/20261015000000_approved_referral_attribution.sql', import.meta.url), 'utf8');

test('two approved database codes attribute separately; bad, unapproved, disabled and organic signups do not', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb);
      create table public.growth_partners(id uuid default gen_random_uuid(), user_id uuid primary key, referral_code text unique, status text, is_active boolean, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
      create table public.growth_referral_attributions(token_hash text primary key, partner_id uuid, referral_code text, expires_at timestamptz default now()+interval '7 days', consumed_at timestamptz, consumed_by uuid, referral_id uuid);
      create table public.growth_onboarding(user_id uuid primary key, growth_partner_id uuid, referral_code text, linked_at timestamptz, status text);
      create function public.record_partner_referral_event(uuid,text,jsonb,timestamptz) returns void language sql as $$ select $$;`);
    await db.query('insert into public.growth_partners(user_id,referral_code,status,is_active) values($1,$2,$3,true),($4,$5,$3,true),($6,$7,$8,true)', [A,CODE_A,'approved',B,CODE_B,C,'NEXORA-PENDING42','pending']);
    await db.exec(migration);
    await db.exec('create trigger trg_signup_growth_referral after insert on auth.users for each row execute function public.consume_signup_growth_referral()');
    const capture = async (code: string, old: string | null = null) =>
      ((await db.query('select public.capture_growth_referral($1,$2) as value', [code, old])).rows[0] as any).value;
    const signup = async (id: string, token?: string) => {
      await db.query('insert into auth.users values($1,$2::jsonb)', [id, JSON.stringify(token ? { growth_referral_token: token } : {})]);
      return (await db.query('select growth_partner_id,referral_code from public.growth_onboarding where user_id=$1', [id])).rows[0] as any;
    };
    assert.equal(referralCodeFromQuery(`?ref=%20${CODE_A.toLowerCase()}%20`).trim().toUpperCase(), CODE_A);
    assert.equal(normalizeGrowthReferralCode(referralCodeFromQuery(`?referral=${CODE_B.toLowerCase()}`)), CODE_B);
    assert.equal(normalizeGrowthReferralCode(referralCodeFromQuery(`?code=${CODE_A.toLowerCase()}`)), CODE_A);
    const one = await capture(` ${CODE_A.toLowerCase()} `);
    const two = await capture(CODE_B, one.token);
    assert.equal(one.referral_code, CODE_A);
    assert.equal(two.referral_code, CODE_B);
    assert.notEqual(one.token, two.token, 'switching codes cannot reuse the previous partner capability');
    assert.equal((await signup('20000000-0000-4000-8000-000000000001', one.token)).growth_partner_id, A);
    assert.equal((await signup('20000000-0000-4000-8000-000000000002', two.token)).growth_partner_id, B);
    assert.equal(await signup('20000000-0000-4000-8000-000000000003'), undefined);
    assert.equal((await capture('NEXORA-UNKNOWN99')).valid, false);
    assert.equal((await capture('NEXORA-PENDING42')).valid, false);
    await db.query('update public.growth_partners set deleted_at=now() where user_id=$1', [A]);
    assert.equal((await capture(CODE_A)).valid, false);
    await db.query('update public.growth_partners set deleted_at=null where user_id=$1', [A]);
    const pending = await capture(CODE_B);
    await db.query('update public.growth_partners set is_active=false where user_id=$1', [B]);
    assert.equal((await capture(CODE_B)).valid, false);
    assert.equal(((await db.query('select public.prepare_growth_referral_signup($1) as value',[pending.token])).rows[0] as any).value.valid,false);
    assert.equal(await signup('20000000-0000-4000-8000-000000000004', pending.token), undefined);
    assert.equal(((await db.query('select growth_partner_id from public.growth_onboarding where user_id=$1',['20000000-0000-4000-8000-000000000001'])).rows[0] as any).growth_partner_id,A);
    await db.query('update public.growth_partners set is_active=true where user_id=$1',[B]);
    await db.exec(`create policy onboarding_read on public.growth_onboarding
      for select to authenticated using(user_id=auth.uid() or growth_partner_id=auth.uid());
      grant select on public.growth_onboarding to authenticated;`);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
    assert.deepEqual((await db.query('select referral_code from public.growth_onboarding')).rows.map((r:any)=>r.referral_code),[CODE_A]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[B]);
    assert.deepEqual((await db.query('select referral_code from public.growth_onboarding')).rows.map((r:any)=>r.referral_code),[CODE_B]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",['20000000-0000-4000-8000-000000000001']);
    assert.deepEqual((await db.query('select referral_code from public.growth_onboarding')).rows.map((r:any)=>r.referral_code),[CODE_A]);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('organic signup never prepares an old referral cookie', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('A cookie must not be read for organic signup'); }) as any;
  try { assert.equal(await prepareSignupAttribution(''), undefined); }
  finally { globalThis.fetch = original; }
});
