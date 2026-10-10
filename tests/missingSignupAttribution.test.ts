import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const repair = readFileSync(new URL('../supabase/migrations/20261010020012_restore_missing_signup_attribution.sql', import.meta.url), 'utf8');

test('missing attribution repair works on the deployed core schema without status and preserves newer RPCs', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
      create table public.growth_partners(user_id uuid primary key references auth.users(id),
        referral_code text unique, is_active boolean, deleted_at timestamptz, banned_at timestamptz);
      create table public.growth_onboarding(user_id uuid primary key references auth.users(id),
        growth_partner_id uuid references public.growth_partners(user_id), referral_code text,
        linked_at timestamptz, status text default 'not_started');
    `);
    await db.exec(repair);
    await db.exec(repair);
    const partner = randomUUID();
    await db.query('insert into auth.users(id) values ($1)', [partner]);
    await db.query("insert into growth_partners values ($1,'888359D8',true,null,null)", [partner]);
    const capture = async (code: string, token: string | null = null) =>
      (await db.query<{ result: any }>('select capture_growth_referral($1,$2) result', [code, token])).rows[0].result;
    const prepare = async (token: string) =>
      (await db.query<{ result: any }>('select prepare_growth_referral_signup($1) result', [token])).rows[0].result;
    const signup = async (token: string) => {
      const id = randomUUID();
      await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [id, JSON.stringify({ growth_referral_token: token })]);
      return (await db.query<{ growth_partner_id: string }>('select * from growth_onboarding where user_id=$1', [id])).rows[0];
    };
    const captured = await capture(' 888359d8 ');
    assert.equal(captured.valid, true);
    assert.equal(captured.referral_code, '888359D8');
    assert.match(captured.token, /^[a-f0-9]{64}$/);
    assert.equal((await capture('888359D8', captured.token)).token, captured.token);
    assert.equal((await prepare(captured.token)).valid, true);
    assert.equal((await signup(captured.token)).growth_partner_id, partner);
    assert.equal((await prepare(captured.token)).valid, false);
    assert.equal(await signup(captured.token), undefined, 'one-use token cannot attribute a second signup');
    assert.equal(await signup('a'.repeat(64)), undefined, 'unbacked token is never attributed');
    assert.equal((await capture('UNKNOWN1')).valid, false);
    const expired = await capture('888359D8');
    await db.query("update growth_referral_attributions set expires_at=now()-interval '1 second' where token_hash=md5($1)", [expired.token]);
    assert.equal((await prepare(expired.token)).valid, false);
    const banned = await capture('888359D8');
    await db.exec('update growth_partners set banned_at=now()');
    assert.equal((await capture('888359D8')).valid, false);
    assert.equal((await prepare(banned.token)).valid, false);
    assert.equal(await signup(banned.token), undefined);
    await db.exec('update growth_partners set banned_at=null; alter table growth_partners add column status text default \'pending\'');
    assert.equal((await capture('888359D8')).valid, false, 'newer schema retains approval eligibility');
    await db.exec("update growth_partners set status='approved'");
    assert.equal((await capture('888359D8')).valid, true);
    await db.exec("set role anon");
    assert.equal((await capture('888359D8')).valid, true, 'anonymous API can call the capability RPC');
    await assert.rejects(db.query('select * from growth_referral_attributions'), /permission denied/);
    await db.exec('reset role');
    const before = (await db.query("select pg_get_functiondef('capture_growth_referral(text,text)'::regprocedure) definition")).rows;
    await db.exec(repair);
    assert.deepEqual((await db.query("select pg_get_functiondef('capture_growth_referral(text,text)'::regprocedure) definition")).rows, before);
    assert.equal((await db.query<{ count: number }>("select count(*)::int count from pg_trigger where tgname='trg_signup_growth_referral'")).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
