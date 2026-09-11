// ============================================================================
// Phase 4 — secure one-time Onboarding → Template App handoff.
//
//   • PGlite (Phase 1 + handoff migrations): create/exchange lifecycle,
//     single-use atomicity, expiry, destination, cross-user rejection,
//     banned accounts, referral gating, template_started entry event,
//     admin-only purge, idempotent re-apply.
//   • Pure units: handoff URL/state/env builders, safe error mapping,
//     RPC wrapper contracts, URL cleanup.
//   • SSR: handoff page states, StatusScreen continue action.
//   • Static guards: no wildcard CORS, no privileged keys in browser code,
//     App branch order, migration atomicity markers.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  TEMPLATE_HANDOFF_PATH,
  isOnboardingPath,
  isTemplateHandoffPath,
  matchTemplateHandoffQuery,
} from '../src/lib/router';
import { OnboardingError } from '../src/onboarding/lib/flow';
import {
  buildOnboardingLoginUrl,
  buildTemplateHandoffUrl,
  createTemplateHandoff,
  exchangeTemplateHandoff,
  handoffStateMatches,
  isEnteredOnboardingStatus,
  newHandoffState,
  onboardingAppBaseUrl,
  stripHandoffQuery,
  templateAppBaseUrl,
  toSafeHandoffError,
} from '../src/onboarding/lib/handoff';
import { StatusScreen } from '../src/onboarding/screens/StatusScreen';
import {
  HANDOFF_SUCCESS_BODY,
  HANDOFF_SUCCESS_TITLE,
  HANDOFF_VERIFYING_BODY,
  HANDOFF_VERIFYING_TITLE,
  TemplateHandoffPage,
  TemplateHandoffScreen,
} from '../src/components/TemplateHandoffPage';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const USER_2 = 'b0000000-0000-4000-8000-000000000002';
const USER_X = 'b0000000-0000-4000-8000-000000000009';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const PHASE1 = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);
const HANDOFF_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260913_template_handoff.sql', import.meta.url),
  'utf8'
);

async function setupDb() {
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
    insert into auth.users(id) values
      ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}'), ('${USER_2}'), ('${USER_X}');
  `);
  await db.exec(PHASE1);
  await db.exec(HANDOFF_MIGRATION);
  await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
  await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
  return db;
}

async function linkUser(db: any, userId: string, code: string) {
  await asUser(db, userId, 'select public.link_my_growth_referral($1)', [code]);
}

async function createHandoff(db: any, userId: string, state = 'st-1') {
  const res = await asUser(db, userId, 'select public.create_template_handoff($1) as r', [state]);
  return res.rows[0].r;
}

async function exchangeHandoff(db: any, userId: string, token: string) {
  const res = await asUser(db, userId, 'select public.exchange_template_handoff($1) as r', [token]);
  return res.rows[0].r;
}

// ---------------------------------------------------------------------------
// Creation lifecycle
// ---------------------------------------------------------------------------

test('an authenticated, referral-linked user can create a handoff', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const handoff = await createHandoff(db, USER_1);
    // Opaque 64-hex token (244-bit), 5-minute expiry, fixed destination.
    assert.match(handoff.token, /^[0-9a-f]{64}$/);
    assert.equal(handoff.destination, 'template-app');
    const ttlMs = Date.parse(handoff.expires_at) - Date.now();
    assert.ok(ttlMs > 4 * 60 * 1000 && ttlMs <= 5 * 60 * 1000 + 15000, `ttl was ${ttlMs}ms`);
    // Server-side record: hash only (never the raw token), owned by caller.
    const row = (await db.query<any>('select * from public.template_handoffs')).rows[0];
    assert.equal(row.user_id, USER_1);
    assert.equal(row.growth_partner_id, PARTNER_A);
    assert.equal(row.destination, 'template-app');
    assert.equal(row.consumed_at, null);
    assert.match(row.token_hash, /^[0-9a-f]{32}$/);
    assert.notEqual(row.token_hash, handoff.token);
    // Tokens are unpredictable across grants (no user/time/code derivation).
    const second = await createHandoff(db, USER_1);
    assert.notEqual(second.token, handoff.token);
    assert.doesNotMatch(second.token, /ALPHA01|b0000000/i);
  } finally {
    await db.close();
  }
});

test('unauthenticated users cannot create a handoff', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    await assert.rejects(
      asUser(db, '', 'select public.create_template_handoff()'),
      /permission denied for function/
    );
    await db.exec('set role authenticated');
    try {
      await assert.rejects(db.query('select public.create_template_handoff()'), /Sign in required/);
    } finally {
      await db.exec('reset role');
    }
    assert.equal((await db.query<any>('select * from public.template_handoffs')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('users without a verified referral cannot create a handoff', async () => {
  const db = await setupDb();
  try {
    await assert.rejects(createHandoff(db, USER_2), /verified referral is required/);
    assert.equal((await db.query<any>('select * from public.template_handoffs')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('a user cannot create a handoff for another user; only one stays active', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    await linkUser(db, USER_2, CODE_B);
    // The RPC takes no user id — every grant belongs to its caller.
    const first = await createHandoff(db, USER_1);
    const rows = (await db.query<any>('select user_id from public.template_handoffs')).rows;
    assert.deepEqual(
      rows.map((r: any) => r.user_id),
      [USER_1]
    );
    // A second grant supersedes the first (no pile-up from double-clicks).
    const second = await createHandoff(db, USER_1);
    assert.equal((await db.query<any>('select * from public.template_handoffs')).rows.length, 1);
    await assert.rejects(exchangeHandoff(db, USER_1, first.token), /Invalid onboarding session/);
    const ok = await exchangeHandoff(db, USER_1, second.token);
    assert.equal(ok.user_id, USER_1);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Exchange lifecycle
// ---------------------------------------------------------------------------

test('invalid tokens are rejected and consume nothing', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const real = await createHandoff(db, USER_1);
    await assert.rejects(exchangeHandoff(db, USER_1, 'f'.repeat(64)), /Invalid onboarding session/);
    await assert.rejects(exchangeHandoff(db, USER_1, ''), /Invalid onboarding session/);
    await assert.rejects(exchangeHandoff(db, USER_1, 'not-hex!'), /Invalid onboarding session/);
    // The real grant is untouched by the bad attempts.
    const row = (await db.query<any>('select consumed_at from public.template_handoffs')).rows[0];
    assert.equal(row.consumed_at, null);
    assert.equal((await exchangeHandoff(db, USER_1, real.token)).user_id, USER_1);
  } finally {
    await db.close();
  }
});

test('a referral code alone cannot authenticate the handoff', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    await createHandoff(db, USER_1);
    // The code is application data, never an auth credential.
    await assert.rejects(exchangeHandoff(db, USER_1, CODE_A), /Invalid onboarding session/);
    await assert.rejects(exchangeHandoff(db, USER_1, `?ref=${CODE_A}`), /Invalid onboarding session/);
  } finally {
    await db.close();
  }
});

test('expired tokens are rejected with the recovery message', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const token = 'e'.repeat(64);
    const hash = (await db.query<any>(`select public.template_handoff_hash($1) as h`, [token])).rows[0].h;
    await db.query<any>(
      `insert into public.template_handoffs(token_hash, user_id, growth_partner_id, destination, expires_at)
       values ($1, $2::uuid, $3::uuid, 'template-app', now() - interval '1 minute')`,
      [hash, USER_1, PARTNER_A]
    );
    await assert.rejects(
      exchangeHandoff(db, USER_1, token),
      /Your onboarding session has expired\. Please return to the onboarding app and try again\./
    );
  } finally {
    await db.close();
  }
});

test('consumed tokens are rejected and never reusable', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const handoff = await createHandoff(db, USER_1);
    assert.equal((await exchangeHandoff(db, USER_1, handoff.token)).user_id, USER_1);
    await assert.rejects(
      exchangeHandoff(db, USER_1, handoff.token),
      /This onboarding session has already been used\./
    );
    await assert.rejects(
      exchangeHandoff(db, USER_1, handoff.token),
      /This onboarding session has already been used\./
    );
  } finally {
    await db.close();
  }
});

test('the same token cannot be consumed twice, even concurrently', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const handoff = await createHandoff(db, USER_1);
    const outcomes = await Promise.allSettled([
      exchangeHandoff(db, USER_1, handoff.token),
      exchangeHandoff(db, USER_1, handoff.token),
    ]);
    const won = outcomes.filter((o) => o.status === 'fulfilled');
    const lost = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.match(String(lost[0].reason?.message || lost[0].reason), /already been used/);
    // The migration pins the atomicity mechanism itself (lock + predicate).
    assert.match(HANDOFF_MIGRATION, /for update/);
    assert.match(HANDOFF_MIGRATION, /consumed_at is null/);
  } finally {
    await db.close();
  }
});

test('a wrong destination is rejected', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const hash = (await db.query<any>(`select public.template_handoff_hash($1) as h`, ['d'.repeat(64)])).rows[0].h;
    await db.query<any>(
      `insert into public.template_handoffs(token_hash, user_id, growth_partner_id, destination, expires_at)
       values ($1, $2::uuid, $3::uuid, 'evil-app', now() + interval '5 minutes')`,
      [hash, USER_1, PARTNER_A]
    );
    await assert.rejects(exchangeHandoff(db, USER_1, 'd'.repeat(64)), /Invalid onboarding session/);
  } finally {
    await db.close();
  }
});

test('cross-user handoff is impossible and does not burn the grant', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    await linkUser(db, USER_X, CODE_B);
    const handoff = await createHandoff(db, USER_1);
    // Indistinguishable from a bad token (no oracle for another user's grant).
    await assert.rejects(exchangeHandoff(db, USER_X, handoff.token), /Invalid onboarding session/);
    // Nothing about USER_X changed, and USER_1's grant still works.
    const other = (await asUser(db, USER_X, 'select public.get_my_onboarding_status() as s')).rows[0].s;
    assert.equal(other.status, 'linked');
    const row = (await db.query<any>('select consumed_at from public.template_handoffs')).rows[0];
    assert.equal(row.consumed_at, null);
    assert.equal((await exchangeHandoff(db, USER_1, handoff.token)).user_id, USER_1);
  } finally {
    await db.close();
  }
});

test('banned accounts cannot exchange', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const handoff = await createHandoff(db, USER_1);
    await db.exec('alter table auth.users add column banned_until timestamptz');
    await db.query<any>(`update auth.users set banned_until = now() + interval '1 hour' where id = $1::uuid`, [USER_1]);
    await assert.rejects(
      exchangeHandoff(db, USER_1, handoff.token),
      /Your account cannot continue at this time\./
    );
    await db.query<any>(`update auth.users set banned_until = null where id = $1::uuid`, [USER_1]);
    assert.equal((await exchangeHandoff(db, USER_1, handoff.token)).user_id, USER_1);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Entry event: referral_added → template_started (never completion/regress)
// ---------------------------------------------------------------------------

test('a successful exchange records template_started exactly once', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const handoff = await createHandoff(db, USER_1);
    const result = await exchangeHandoff(db, USER_1, handoff.token);
    assert.equal(result.onboarding_status, 'template_started');
    assert.ok(result.template_started_at);
    assert.equal(result.referral_code, CODE_A);
    const status = (await asUser(db, USER_1, 'select public.get_my_onboarding_status() as s')).rows[0].s;
    assert.equal(status.status, 'template_started');
    // A LATER grant (re-entry) does not rewrite the first entry timestamp.
    const second = await createHandoff(db, USER_1);
    const again = await exchangeHandoff(db, USER_1, second.token);
    assert.equal(again.template_started_at, result.template_started_at);
    assert.notEqual(again.onboarding_status, 'template_completed');
  } finally {
    await db.close();
  }
});

test('exchange never regresses or rewrites users already past entry', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    await asUser(db, USER_1, "select public.update_my_onboarding_progress('start_template')");
    await asUser(db, USER_1, "select public.update_my_onboarding_progress('complete_template')");
    const before = (await asUser(db, USER_1, 'select public.get_my_onboarding_status() as s')).rows[0].s;
    const handoff = await createHandoff(db, USER_1);
    const result = await exchangeHandoff(db, USER_1, handoff.token);
    assert.equal(result.onboarding_status, 'template_completed');
    const after = (await asUser(db, USER_1, 'select public.get_my_onboarding_status() as s')).rows[0].s;
    assert.equal(after.status, 'template_completed');
    assert.equal(after.template_started_at, before.template_started_at);
    assert.equal(after.template_completed_at, before.template_completed_at);
  } finally {
    await db.close();
  }
});

test('handoff rows are RPC-only: direct client reads/writes are denied', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    await createHandoff(db, USER_1);
    await assert.rejects(asUser(db, USER_1, 'select * from public.template_handoffs'), /permission denied/);
    await assert.rejects(asUser(db, '', 'select * from public.template_handoffs'), /permission denied/);
    await assert.rejects(
      asUser(db, USER_1, `update public.template_handoffs set consumed_at = null where user_id = '${USER_1}'`),
      /permission denied/
    );
    await assert.rejects(
      asUser(db, USER_1, 'select public.template_handoff_hash($1)', ['x']),
      /permission denied for function/
    );
    await assert.rejects(
      asUser(db, USER_1, 'select public.purge_expired_template_handoffs()'),
      /permission denied for function/
    );
    // The admin purge works and only removes long-expired rows.
    const removed = (await db.query<any>('select public.purge_expired_template_handoffs() as n')).rows[0].n;
    assert.equal(removed, 0);
    assert.equal((await db.query<any>('select * from public.template_handoffs')).rows.length, 1);
  } finally {
    await db.close();
  }
});

test('the handoff migration is idempotent and preserves live grants', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    const handoff = await createHandoff(db, USER_1);
    const before = (await db.query<any>('select * from public.template_handoffs')).rows;
    await db.exec(HANDOFF_MIGRATION);
    await db.exec(HANDOFF_MIGRATION);
    assert.deepEqual((await db.query<any>('select * from public.template_handoffs')).rows, before);
    assert.equal((await exchangeHandoff(db, USER_1, handoff.token)).user_id, USER_1);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// End-to-end: onboarding → handoff URL → exchange → template_started
// ---------------------------------------------------------------------------

test('complete flow: link → create → URL → exchange → enter with template_started', async () => {
  const db = await setupDb();
  try {
    await linkUser(db, USER_1, CODE_A);
    // 1. Onboarding App mints the grant (state bound, single call).
    const created = await createHandoff(db, USER_1, '9f'.repeat(16));
    // 2. Redirect URL carries ONLY the opaque token + state.
    const url = buildTemplateHandoffUrl('https://fanal-templetes-app.vercel.app', created.token, '9f'.repeat(16));
    assert.match(url, /^https:\/\/fanal-templetes-app\.vercel\.app\/onboarding\/handoff\?token=[0-9a-f]{64}&state=(9f)+$/);
    assert.doesNotMatch(url, /access_token|refresh_token|password|service|ref=|user_id|email|partner/i);
    // 3. Template App parses, validates state, exchanges as its own session.
    const parsed = matchTemplateHandoffQuery(url.slice(url.indexOf('?')));
    assert.equal(parsed.token, created.token);
    assert.ok(handoffStateMatches('9f'.repeat(16), parsed.state));
    const result = await exchangeHandoff(db, USER_1, parsed.token);
    assert.equal(result.user_id, USER_1);
    assert.equal(result.onboarding_status, 'template_started');
    // 4. Post-entry: URL is cleanable to the plain route; grant is spent.
    assert.equal(stripHandoffQuery(url), 'https://fanal-templetes-app.vercel.app/onboarding/handoff');
    await assert.rejects(exchangeHandoff(db, USER_1, parsed.token), /already been used/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// URL / env / state helpers
// ---------------------------------------------------------------------------

test('handoff routes parse per the existing router conventions', () => {
  assert.equal(TEMPLATE_HANDOFF_PATH, '/onboarding/handoff');
  assert.equal(isTemplateHandoffPath('/onboarding/handoff'), true);
  assert.equal(isTemplateHandoffPath('/onboarding/handoff/'), true);
  assert.equal(isTemplateHandoffPath('/ONBOARDING/HANDOFF'), true);
  assert.equal(isTemplateHandoffPath('/onboarding/login'), false);
  assert.equal(isTemplateHandoffPath('/onboarding'), false);
  // Overlap is real: the App must match the handoff BEFORE the onboarding app.
  assert.equal(isOnboardingPath('/onboarding/handoff'), true);
  assert.deepEqual(matchTemplateHandoffQuery('?token=abc&state=xyz'), { token: 'abc', state: 'xyz' });
  assert.deepEqual(matchTemplateHandoffQuery(''), { token: '', state: '' });
  // Identity-ish params are ignored entirely — never trusted, never returned.
  const hostile = matchTemplateHandoffQuery('?ref=ALPHA01&user_id=u&email=a@b.c&partner_id=p');
  assert.deepEqual(hostile, { token: '', state: '' });
  assert.deepEqual(Object.keys(hostile).sort(), ['state', 'token']);
});

test('no long-lived credentials ever enter the handoff URL', () => {
  const url = buildTemplateHandoffUrl('https://fanal-templetes-app.vercel.app/', 't'.repeat(64), 's'.repeat(32));
  assert.equal(
    url,
    `https://fanal-templetes-app.vercel.app/onboarding/handoff?token=${'t'.repeat(64)}&state=${'s'.repeat(32)}`
  );
  assert.doesNotMatch(url, /access_token|refresh_token|id_token|password|secret|service_role|apikey/i);
  // Relative fallback (no base known) keeps the same shape.
  assert.equal(buildTemplateHandoffUrl('', 'tok', 'st'), '/onboarding/handoff?token=tok&state=st');
  assert.equal(
    buildOnboardingLoginUrl('https://fanal-templetes-app.vercel.app'),
    'https://fanal-templetes-app.vercel.app/onboarding/login'
  );
  assert.doesNotMatch(buildOnboardingLoginUrl('https://x.example'), /token/);
});

test('the token is stripped from the URL after successful processing', () => {
  assert.equal(
    stripHandoffQuery('https://app.example/onboarding/handoff?token=aaa&state=bbb'),
    'https://app.example/onboarding/handoff'
  );
  assert.equal(
    stripHandoffQuery('https://app.example/onboarding/handoff?token=aaa&next=%2F&state=bbb#top'),
    'https://app.example/onboarding/handoff?next=%2F#top'
  );
  assert.equal(stripHandoffQuery('https://app.example/other?a=1'), 'https://app.example/other?a=1');
  assert.equal(stripHandoffQuery('/onboarding/handoff'), '/onboarding/handoff');
  // The component applies this via replaceState (never lingering in history).
  const src = readFileSync(new URL('../src/components/TemplateHandoffPage.tsx', import.meta.url), 'utf8');
  assert.match(src, /history\.replaceState/);
  assert.match(src, /replaceState\(\{\}, '', '\/'\)/);
});

test('base URLs come from env with a same-origin default and strict validation', () => {
  assert.equal(
    templateAppBaseUrl({ envVar: 'https://fanal-templetes-app.vercel.app/' }),
    'https://fanal-templetes-app.vercel.app'
  );
  assert.equal(
    templateAppBaseUrl({ envVar: '', origin: 'https://preview.example:3000' }),
    'https://preview.example:3000'
  );
  assert.equal(templateAppBaseUrl({ envVar: '', origin: '' }), '');
  assert.throws(() => templateAppBaseUrl({ envVar: 'javascript:alert(1)' }), /misconfigured/);
  assert.throws(() => templateAppBaseUrl({ envVar: 'data:text/plain,hi' }), /misconfigured/);
  assert.equal(
    onboardingAppBaseUrl({ envVar: 'https://onb.example/', origin: 'https://other.example' }),
    'https://onb.example'
  );
  assert.equal(onboardingAppBaseUrl({ envVar: '', origin: 'https://same.example' }), 'https://same.example');
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(example, /VITE_TEMPLATE_APP_URL="https:\/\/fanal-templetes-app\.vercel\.app"/);
});

test('handoff state is unpredictable and compared strictly', () => {
  const a = newHandoffState();
  const b = newHandoffState();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.equal(handoffStateMatches(a, a), true);
  assert.equal(handoffStateMatches(a, b), false);
  assert.equal(handoffStateMatches(a, `${a}00`), false);
  assert.equal(handoffStateMatches(null, a), false);
  assert.equal(handoffStateMatches(a, null), false);
  assert.equal(handoffStateMatches('', ''), false);
});

test('entered-status detection covers entry without completion', () => {
  assert.equal(isEnteredOnboardingStatus('template_started'), true);
  assert.equal(isEnteredOnboardingStatus('template_completed'), true);
  assert.equal(isEnteredOnboardingStatus('linked'), false);
  assert.equal(isEnteredOnboardingStatus('not_started'), false);
  assert.equal(isEnteredOnboardingStatus(null), false);
});

// ---------------------------------------------------------------------------
// RPC wrapper contracts (injectable fakes)
// ---------------------------------------------------------------------------

const ok = (data: any) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: new Error(message) });

test('the create wrapper calls the mint RPC once with state only', async () => {
  const calls: any[] = [];
  const client = { rpc: async (fn: string, args: any) => (calls.push([fn, args]), ok({ token: 't', expires_at: 'e' })) };
  assert.deepEqual(await createTemplateHandoff(client as any, 'st'), { token: 't', expiresAt: 'e' });
  assert.deepEqual(calls, [['create_template_handoff', { p_state: 'st' }]]);
  // No user id, partner id or code is ever supplied by the frontend.
  assert.doesNotMatch(JSON.stringify(calls), /user_id|partner|referral|ALPHA/i);
  let rpcCalls = 0;
  await assert.rejects(
    createTemplateHandoff({ rpc: async () => (rpcCalls++, ok({})) } as any, ''),
    /Something went wrong/
  );
  assert.equal(rpcCalls, 0);
  await assert.rejects(
    createTemplateHandoff({ rpc: async () => fail('A verified referral is required') } as any, 'st'),
    /verified referral/
  );
});

test('the exchange wrapper sends only the trimmed token', async () => {
  const calls: any[] = [];
  const client = {
    rpc: async (fn: string, args: any) => (
      calls.push([fn, args]),
      ok({ user_id: 'u', referral_code: 'ALPHA01', onboarding_status: 'template_started', template_started_at: 't' })
    ),
  };
  const result = await exchangeTemplateHandoff(client as any, '  tok  ');
  assert.equal(result.userId, 'u');
  assert.equal(result.onboardingStatus, 'template_started');
  assert.deepEqual(calls, [['exchange_template_handoff', { p_token: 'tok' }]]);
  let rpcCalls = 0;
  await assert.rejects(
    exchangeTemplateHandoff({ rpc: async () => (rpcCalls++, ok({})) } as any, '   '),
    /Invalid onboarding session/
  );
  assert.equal(rpcCalls, 0);
});

test('handoff failures map to the exact safe messages without leaking internals', () => {
  const cases: Array<[string, string, string]> = [
    ['This onboarding session has already been used.', 'handoff-used', 'This onboarding session has already been used.'],
    [
      'Your onboarding session has expired. Please return to the onboarding app and try again.',
      'handoff-expired',
      'Your onboarding session has expired. Please return to the onboarding app and try again.',
    ],
    ['Your account cannot continue at this time.', 'handoff-forbidden', 'Your account cannot continue at this time.'],
    ['Invalid onboarding session.', 'invalid-handoff', 'Invalid onboarding session.'],
    ['Sign in required', 'session', 'Your session expired. Please sign in again.'],
    ['permission denied for function exchange_template_handoff', 'session', 'Your session expired. Please sign in again.'],
  ];
  for (const [input, code, message] of cases) {
    const mapped = toSafeHandoffError(new Error(input));
    assert.ok(mapped instanceof OnboardingError);
    assert.equal(mapped.code, code);
    assert.equal(mapped.message, message);
  }
  const leaked = toSafeHandoffError(new Error('update public.template_handoffs failed (42P01): nope'));
  assert.equal(leaked.code, 'unknown');
  assert.equal(leaked.message, 'Something went wrong. Please try again.');
  assert.doesNotMatch(leaked.message, /template_handoffs|42P01/);
});

// ---------------------------------------------------------------------------
// Rendered UI
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

test('the status screen offers the Template App handoff with busy + error states', () => {
  const plain = render(React.createElement(StatusScreen, { phase: 'referral_added' }));
  assert.doesNotMatch(plain, /Continue to Template App/);
  const withHandoff = render(
    React.createElement(StatusScreen, { phase: 'referral_added', onContinueToTemplateApp: () => {} })
  );
  assert.match(withHandoff, /Continue to Template App/);
  assert.match(withHandoff, /only be used once and expires in 5 minutes/);
  const busy = render(
    React.createElement(StatusScreen, {
      phase: 'referral_added',
      onContinueToTemplateApp: () => {},
      handoffBusy: true,
    })
  );
  assert.match(busy, /Preparing secure handoff…/);
  assert.match(busy, /disabled=""/);
  const failed = render(
    React.createElement(StatusScreen, {
      phase: 'referral_added',
      onContinueToTemplateApp: () => {},
      handoffError: 'Something went wrong. Please try again.',
    })
  );
  assert.match(failed, /Something went wrong\. Please try again\./);
});

test('the handoff page renders verifying, success and every failure state', () => {
  const verifying = render(
    React.createElement(TemplateHandoffScreen, {
      status: 'verifying',
      message: '',
      showRetry: false,
      onRetry: () => {},
      onBackToOnboarding: () => {},
    })
  );
  assert.match(verifying, new RegExp(HANDOFF_VERIFYING_TITLE));
  assert.match(verifying, new RegExp(HANDOFF_VERIFYING_BODY));
  const success = render(
    React.createElement(TemplateHandoffScreen, {
      status: 'success',
      message: '',
      showRetry: false,
      onRetry: () => {},
      onBackToOnboarding: () => {},
    })
  );
  assert.match(success, new RegExp(HANDOFF_SUCCESS_TITLE));
  assert.match(success, new RegExp(HANDOFF_SUCCESS_BODY));
  const failures: Array<[string, string, boolean]> = [
    ['invalid', 'Invalid onboarding session.', false],
    ['expired', 'Your onboarding session has expired. Please return to the onboarding app and try again.', false],
    ['used', 'This onboarding session has already been used.', false],
    ['forbidden', 'Your account cannot continue at this time.', false],
    ['session', 'Your session expired. Please sign in again.', true],
    ['error', 'Something went wrong. Please try again.', true],
  ];
  for (const [status, message, retry] of failures) {
    const html = render(
      React.createElement(TemplateHandoffScreen, {
        status: status as any,
        message,
        showRetry: retry,
        onRetry: () => {},
        onBackToOnboarding: () => {},
      })
    );
    assert.match(html, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, /Back to Onboarding App/);
    if (retry) assert.match(html, /Try again/);
    else assert.doesNotMatch(html, /Try again/);
    // Failure screens never echo tokens, ids or diagnostics.
    assert.doesNotMatch(html, /token=|eyJ|42P01|42501|stack/i);
  }
});

test('the handoff container first-paints its verifying state', () => {
  const html = render(React.createElement(TemplateHandoffPage, { navigate: () => {} }));
  assert.match(html, new RegExp(HANDOFF_VERIFYING_TITLE));
  assert.doesNotMatch(html, /token=/);
});

// ---------------------------------------------------------------------------
// Static guards: branch order, CORS, secrets, migration shape
// ---------------------------------------------------------------------------

test('the App renders the handoff page before the onboarding surface', () => {
  const src = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const handoffBranch = src.indexOf('return <TemplateHandoffPage');
  const onboardingBranch = src.indexOf('return <OnboardingApp');
  const customerBranch = src.indexOf('if (isCustomerApp)');
  assert.ok(handoffBranch >= 0 && onboardingBranch >= 0 && customerBranch >= 0);
  assert.ok(handoffBranch < onboardingBranch, 'handoff must win over the /onboarding prefix branch');
  assert.match(src, /<TemplateHandoffPage navigate=\{navigate\} \/>/);
  // Existing surfaces are untouched by the insertion.
  assert.match(src, /<OnboardingApp path=\{path\} navigate=\{navigate\} \/>/);
  assert.match(src, /<CustomerApp/);
});

test('CORS stays restricted: no wildcard origin on authenticated endpoints', () => {
  const cors = readFileSync(new URL('../server/cors.ts', import.meta.url), 'utf8');
  const codeOnly = cors
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  // No `Access-Control-Allow-Origin: *` anywhere in the middleware…
  assert.doesNotMatch(codeOnly, /Allow-Origin['"]?\s*,\s*['"]\*/);
  assert.doesNotMatch(codeOnly, /origin\s*:\s*['"]\*/);
  // …origins are echoed per-request with Vary, and only under /api.
  assert.match(codeOnly, /Access-Control-Allow-Origin['"]?,\s*origin/);
  assert.match(codeOnly, /Vary['"]?,\s*['"]Origin/);
  assert.match(codeOnly, /startsWith\('\/api'\)/);
  // The handoff adds no HTTP endpoint, so no CORS widening was needed at all.
  for (const entry of ['../server.ts', '../api/index.ts']) {
    const entrySrc = readFileSync(new URL(entry, import.meta.url), 'utf8');
    assert.doesNotMatch(
      entrySrc.replace(/\/\*[\s\S]*?\*\//g, ''),
      /handoff/i
    );
  }
});

function browserSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url))) {
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(join(dir, entry));
    }
  };
  const root = new URL('../src/onboarding', import.meta.url).pathname;
  walk(root);
  walk(join(root, 'lib'));
  walk(join(root, 'screens'));
  files.push(new URL('../src/components/TemplateHandoffPage.tsx', import.meta.url).pathname);
  return files;
}

test('no privileged Supabase key is exposed in handoff browser code', () => {
  const files = browserSources();
  assert.ok(files.length >= 10, `expected the handoff sources, found ${files.length}`);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE|getSupabaseAdmin|supabaseAdmin|sb_secret/);
    assert.doesNotMatch(codeOnly, /eyJhbGciOiJ9/);
    // Tokens in code are opaque handoff values or test fixtures — never JWTs.
    assert.doesNotMatch(codeOnly, /refresh_token|access_token\s*[:=]/i);
  }
});

test('the handoff migration keeps RLS closed and creates only new objects', () => {
  assert.match(HANDOFF_MIGRATION, /create table if not exists public\.template_handoffs/);
  assert.match(HANDOFF_MIGRATION, /alter table public\.template_handoffs enable row level security/);
  assert.match(
    HANDOFF_MIGRATION,
    /revoke all on table public\.template_handoffs from public, anon, authenticated/
  );
  assert.doesNotMatch(HANDOFF_MIGRATION, /create policy/i);
  assert.doesNotMatch(HANDOFF_MIGRATION, /drop table|drop column|alter table public\.(profiles|salons|bookings|growth_onboarding|growth_partners)/i);
  assert.match(HANDOFF_MIGRATION, /grant execute on function public\.create_template_handoff\(text\) to authenticated/);
  assert.match(HANDOFF_MIGRATION, /grant execute on function public\.exchange_template_handoff\(text\) to authenticated/);
  assert.match(
    HANDOFF_MIGRATION,
    /revoke all on function public\.purge_expired_template_handoffs\(\) from public, anon, authenticated/
  );
});
