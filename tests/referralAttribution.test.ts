import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createLocalDatabase } from '../server/localSupabase';
import { registerReferralAttributionRoutes } from '../server/referralAttribution';

// Real Postgres migrations + trigger, not a mocked attribution store.
test('attribution is validated anonymously, consumed on account creation and immutable', async () => {
  const local = await createLocalDatabase();
  const db = local.db;
  const user = async (token?: string, extra: object = {}) => {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values ($1,$2,'test-only',$3::jsonb)",
      [id, `${id}@example.com`, JSON.stringify({ growth_referral_token: token, ...extra })]);
    return id;
  };
  const capture = (code: string, token: string | null = null): Promise<any> => local.asRequest({ sub: null, isAdmin: false }, async conn =>
    (await conn.query('select public.capture_growth_referral($1,$2) as result', [code, token])).rows[0].result);
  const row = async (id: string) => (await db.query('select * from public.partner_referral_attribution where referred_user_id = $1', [id])).rows[0];
  try {
    const a = await user(), b = await user();
    await db.query("select public.provision_growth_partner($1, 'NEXORA-RAHUL25')", [a]);
    await db.query("select public.provision_growth_partner($1, 'NEXORA-OTHER25')", [b]);
    assert.deepEqual(await capture('unknown'), { valid: false });
    const first = await capture(' nexora-rahul25 ');
    assert.equal(first.valid, true);
    assert.equal(first.referral_code, 'NEXORA-RAHUL25');
    assert.match(first.token, /^[a-f0-9]{64}$/);
    assert.equal((await capture('NEXORA-OTHER25', first.token)).token, first.token, 'first touch wins');
    assert.equal((await capture('', first.token)).token, first.token, 'navigation restores existing capability');
    const id = await user(first.token, { partner_id: b, referral_code: 'NEXORA-OTHER25' });
    const linked = await row(id);
    assert.equal(linked.referred_user_id, id);
    assert.equal(linked.partner_id, a, 'untrusted partner metadata cannot override attribution');
    assert.equal(linked.referral_code, 'NEXORA-RAHUL25');
    assert.ok(linked.referred_at);
    const authRow = (await db.query('select email_confirmed_at from auth.users where id=$1', [id])).rows[0];
    assert.equal(authRow.email_confirmed_at, null, 'relationship exists even before email verification');
    assert.equal(await row(await user(first.token)), undefined, 'token is one-use');
    assert.equal(await row(await user('0'.repeat(64))), undefined, 'forged capability rejected');
    await db.query("update auth.users set raw_user_meta_data = $2::jsonb where id = $1", [id, JSON.stringify({ growth_referral_token: (await capture('NEXORA-OTHER25')).token })]);
    assert.equal((await row(id)).partner_id, a, 'metadata edits never change ownership');
    await assert.rejects(local.asRequest({ sub: id, isAdmin: false }, conn => conn.query('select * from public.growth_referral_attributions')), /permission denied/);
    await assert.rejects(local.asRequest({ sub: id, isAdmin: false }, conn => conn.query("update public.growth_onboarding set growth_partner_id=$1 where user_id=$2", [b,id])), /permission denied/);
    const expired = await capture('NEXORA-RAHUL25');
    await db.query("update public.growth_referral_attributions set expires_at=now()-interval '1 second' where token_hash=md5($1)", [expired.token]);
    assert.equal(await row(await user(expired.token)), undefined);
    const inactive = await capture('NEXORA-OTHER25');
    await db.query('update public.growth_partners set is_active=false where user_id=$1', [b]);
    assert.deepEqual(await capture('NEXORA-OTHER25'), { valid: false });
    assert.equal(await row(await user(inactive.token)), undefined);
    const rotated = await capture('NEXORA-RAHUL25');
    await db.query("select public.provision_growth_partner($1, 'NEXORA-NEWCODE')", [a]);
    await db.query("select public.provision_growth_partner($1, 'NEXORA-RAHUL25')", [b]);
    assert.equal(await row(await user(rotated.token)), undefined, 'rotation/reassignment cannot redirect old attribution');
    assert.equal((await row(id)).partner_id, a, 'permanent relationship survives rotation');
  } finally { await local.close(); }
});

test('cookie API protects capability, preserves expiry and fails safely', async () => {
  const app = express();
  app.use(express.json());
  const calls: any[] = [];
  const functions: string[] = [];
  const token = 'a'.repeat(64);
  let fail = false;
  registerReferralAttributionRoutes(app, async (_fn, args) => {
    calls.push(args); functions.push(_fn);
    return { error: fail ? new Error('SQL private.secret_table token=SECRET-CAPABILITY') : null, data: args.p_code === 'bad' ? { valid: false } : { valid: true, token, referral_code: 'NEXORA-RAHUL25', expires_at: '2027-01-01T00:00:00Z' } };
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const endpoint = `${origin}/api/referral-attribution`;
  try {
    let response = await fetch(endpoint, { method: 'POST', headers: { origin: origin.replace('http:', 'https:'), 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ code: 'nexora-rahul25' }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!;
    for (const pattern of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\//, /Expires=/]) assert.match(cookie, pattern);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).token, undefined, 'capture does not expose token');
    response = await fetch(endpoint, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal((await response.json()).token, token, 'signup preparation recovers cookie without URL or localStorage');
    assert.deepEqual(calls.at(-1), { p_token: token });
    assert.deepEqual(functions.slice(0, 2), ['capture_growth_referral', 'prepare_growth_referral_signup']);
    response = await fetch(endpoint, { headers: { origin: 'https://evil.example', cookie } });
    assert.equal(response.status, 403);
    const beforeInjection = calls.length;
    response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'NEXORA-RAHUL25', partner_id: 'forged-owner' }) });
    assert.equal(response.status, 400);
    assert.equal(calls.length, beforeInjection, 'partner ID injection is rejected before DB access');
    response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(response.status, 415);
    response = await fetch(endpoint, { headers: { cookie: 'nexora_referral=forged' } });
    assert.deepEqual(await response.json(), { valid: false, token: null });
    fail = true;
    response = await fetch(endpoint, { headers: { cookie } });
    assert.equal(response.status, 503);
    assert.match(response.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/);
    const failure = await response.json();
    assert.match(failure.error, /temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(failure), /SQL|secret_table|SECRET-CAPABILITY/);
    assert.equal(response.headers.get('set-cookie'), null, 'outage does not erase attribution');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
