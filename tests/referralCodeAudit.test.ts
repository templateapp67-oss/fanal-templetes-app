// ============================================================================
// PHASE 4 — REFERRAL CODE AUDIT
//
// 4.2 REFERRAL NORMALIZATION: trim · case · max length · allowed characters ·
//     empty values · malformed values.
//
// The rule this file enforces: client validation may improve UX, but the
// AUTHORITATIVE validation is server-side/database-side. So the assertions run
// the real migrations in PGlite and compare the client helpers against what the
// database actually does — a client rule that drifts from the database fails
// here instead of failing for one owner in production.
//
// Two independent referral systems exist in this codebase and are audited
// separately, because they have different formats and must not be conflated:
//
//   A. Growth Partner referral (the onboarding funnel)
//      growth_partners.referral_code, '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$'
//      canonical form: public.growth_normalize_code = upper(btrim(coalesce(...)))
//   B. Customer referral (booking rewards)
//      bookings.metadata.referral_code, '^NX-[A-Z0-9]{4,8}$'
//      canonical form: normalizeReferralCode (src/lib/customer/schema.ts)
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  normalizeGrowthReferralCode,
  isGrowthReferralCodeFormat,
} from '../src/lib/growthPartner';
import { normalizeReferralCode, isReferralCode } from '../src/lib/customer/schema';
import { DEFAULT_PUBLIC_ONBOARDING_ORIGIN, partnerReferralShareLink, publicOnboardingOrigin } from '../src/lib/partnerReferralLink';
import {
  referralCodeFromQuery,
  REFERRAL_QUERY_PARAMS,
  MAX_REFERRAL_QUERY_LENGTH,
} from '../src/lib/referralQuery';
import { asUser } from './liveSchemaFixture';

const migration = (name: string) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const PARTNER_A = 'a0000000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'a0000000-0000-4000-8000-0000000000a2';
const VISITOR = 'b0000000-0000-4000-8000-0000000000b1';
const CODE_A = 'ALPHA01';

/**
 * The real onboarding migrations, in order. `20260921` drops and re-adds
 * `growth_partners_code_format` with the wider public-code pattern, so it must
 * run after `20260912` which creates it.
 */
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
    insert into auth.users(id) values ('${PARTNER_A}'), ('${PARTNER_B}'), ('${VISITOR}');
  `);
  await db.exec(migration('20260912_growth_partner_onboarding.sql'));
  await db.exec(migration('20260921_public_partner_referral_codes.sql'));
  await db.exec(migration('20261004_referral_code_normalization.sql'));
  return db;
}

async function provision(db: any, userId: string, code: string, active = true) {
  const res = await db.query('select public.provision_growth_partner($1::uuid, $2, $3) as result', [
    userId,
    code,
    active,
  ]);
  return (res.rows[0] as { result: unknown }).result;
}

/** Deterministic, collision-free visitor ids (uuid v4 shape). */
let visitorSeq = 0;
function nextVisitor(): string {
  visitorSeq += 1;
  return `e0000000-0000-4000-8000-${String(visitorSeq).padStart(12, '0')}`;
}

async function newVisitor(db: any): Promise<string> {
  const id = nextVisitor();
  await db.exec(`insert into auth.users(id) values ('${id}')`);
  return id;
}

/** Call an RPC the way an authenticated owner would, and surface the failure. */
async function asVisitor(db: any, fn: string, args: unknown[]) {
  try {
    const res = await asUser(db, VISITOR, `select public.${fn}($1::text) as result`, args);
    return { ok: true as const, result: (res.rows[0] as { result: any }).result };
  } catch (error: any) {
    return { ok: false as const, message: String(error?.message || error), code: String(error?.code || '') };
  }
}

// ---------------------------------------------------------------------------
// 4.2a — the database's canonical normalizer
// ---------------------------------------------------------------------------

test('the database normalizer is trim + uppercase, and NULL becomes empty', async () => {
  const db = await setupDb();
  const cases: [unknown, string][] = [
    ['ALPHA01', 'ALPHA01'],
    ['alpha01', 'ALPHA01'],
    ['  alpha01  ', 'ALPHA01'],
    ['\tAlpha01\n', 'ALPHA01'],
    ['NEXORA-abc123', 'NEXORA-ABC123'],
    ['', ''],
    ['   ', ''],
    [null, ''],
  ];
  for (const [input, expected] of cases) {
    const res = await db.query('select public.growth_normalize_code($1::text) as n', [input]);
    assert.equal((res.rows[0] as { n: string }).n, expected, `normalize(${JSON.stringify(input)})`);
  }
});

test('the client normalizer agrees with the database normalizer on every input', async () => {
  const db = await setupDb();
  const inputs = [
    'ALPHA01',
    'alpha01',
    '  alpha01  ',
    '\tAlpha01\n',
    'NEXORA-abc123',
    'nexora-ABC123',
    '',
    '   ',
    'ABC',
    'ABCDEFGHIJKLM',
    'ALPHA-01',
    'a b/c',
    'A'.repeat(200),
    undefined,
    null,
    42,
  ];
  for (const input of inputs) {
    const res = await db.query('select public.growth_normalize_code($1::text) as n', [input as any]);
    const fromDb = (res.rows[0] as { n: string }).n;
    assert.equal(
      normalizeGrowthReferralCode(input),
      fromDb,
      `client and database disagree for ${JSON.stringify(input)}`
    );
  }
});

// ---------------------------------------------------------------------------
// 4.2b — allowed characters, length, malformed values: the DB CHECK is
//        authoritative, and the client mirror is compared against the LIVE
//        constraint text so the two cannot drift silently.
// ---------------------------------------------------------------------------

test('the client format check is the database CHECK constraint, read live', async () => {
  const db = await setupDb();
  const res = await db.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'growth_partners_code_format'`
  );
  const def = String((res.rows[0] as { def: string }).def);
  // The constraint is the authority; pull its pattern out rather than restating
  // it here, so a migration change is what fails this test.
  const match = def.match(/~ '([^']+)'/);
  assert.ok(match, `the CHECK carries a regex: ${def}`);
  const dbPattern = new RegExp(match![1]);

  const cases: [string, boolean][] = [
    ['ALPHA01', true], // 7 alphanumerics — legacy form
    ['ABCDEF', true], // 6 — the minimum
    ['ABCDEFGHIJKL', true], // 12 — the maximum
    ['NEXORA-ABCD', true], // public form, 4 after the prefix
    ['NEXORA-ABCDEFGHIJKLMNOPQRSTUVWX', true], // 24 after the prefix
    ['ABC', false], // too short
    ['ABCDEFGHIJKLM', false], // 13 — one over the maximum
    ['NEXORA-ABC', false], // 3 after the prefix — too short
    ['NEXORA-ABCDEFGHIJKLMNOPQRSTUVWXY', false], // 25 — too long
    ['ALPHA-01', false], // legacy form allows no dash
    ['ALPHA 01', false], // no spaces
    ['ALPHA_01', false], // no underscore
    ['<script>', false],
    ['', false],
    ['   ', false],
  ];
  for (const [input, expected] of cases) {
    assert.equal(dbPattern.test(normalizeGrowthReferralCode(input)), expected, `DB CHECK on ${JSON.stringify(input)}`);
    assert.equal(isGrowthReferralCodeFormat(input), expected, `client mirror on ${JSON.stringify(input)}`);
  }
});

test('the database refuses to STORE a malformed code, whatever the client sent', async () => {
  const db = await setupDb();
  assert.ok(await provision(db, PARTNER_A, CODE_A), 'a well-formed code provisions');

  for (const bad of ['ABC', 'ABCDEFGHIJKLM', 'ALPHA-01', 'ALPHA 01', '<script>alert(1)</script>']) {
    await assert.rejects(
      () => provision(db, PARTNER_B, bad),
      // The RPC's own format guard fires before the table CHECK for most of
      // these; either way the write must not land.
      /Invalid referral code format|growth_partners_code_format|check constraint|null value/i,
      `storing ${JSON.stringify(bad)} must fail at the database`
    );
  }
});

test('a blank code is not stored blank — provisioning generates a public code', async () => {
  const db = await setupDb();
  // '' and space-only mean "no code supplied", which auto-generates one. A
  // tab-only value takes the explicit-code branch instead (provision_growth_
  // partner tests for emptiness with a space-only btrim, not the canonical
  // normalizer) and is then rejected by the format check — recorded in the
  // audit, admin-only path, safe outcome.
  for (const [index, blank] of ['', '   '].entries()) {
    const partner = `a0000000-0000-4000-8000-0000000001${index}${index}`;
    await db.exec(`insert into auth.users(id) values ('${partner}')`);
    const result: any = await provision(db, partner, blank);
    assert.match(
      String(result?.referral_code),
      /^NEXORA-[A-Z0-9]{4,24}$/,
      `${JSON.stringify(blank)} yields a generated public code, never a blank one`
    );
  }

  // A tab-only value is treated as an EXPLICIT code, because
  // provision_growth_partner tests for "no code supplied" with a space-only
  // btrim rather than the canonical normalizer. It is then rejected by the
  // format check — a safe outcome on an admin-only RPC (EXECUTE is revoked
  // from authenticated and anon). Recorded rather than changed.
  const tabPartner = 'a0000000-0000-4000-8000-000000000199';
  await db.exec(`insert into auth.users(id) values ('${tabPartner}')`);
  await assert.rejects(() => provision(db, tabPartner, '\t'), /Invalid referral code format/i);
});

test('two partners cannot hold codes differing only by case', async () => {
  const db = await setupDb();
  assert.ok(await provision(db, PARTNER_A, CODE_A));
  // 'alpha01' normalises to the same upper() key, so the unique index on
  // upper(referral_code) must reject it — otherwise a lookup by normalised code
  // could resolve to two different partners.
  await assert.rejects(
    () => provision(db, PARTNER_B, 'alpha01'),
    /already in use|growth_partners_code_case_insensitive_key|duplicate key/i
  );
});

// ---------------------------------------------------------------------------
// 4.2c — linking: the authoritative path normalises, so case and surrounding
//        whitespace cannot change WHO an owner is attributed to.
// ---------------------------------------------------------------------------

test('linking is case- and whitespace-insensitive at the database', async () => {
  const db = await setupDb();
  const provisioned: any = await provision(db, PARTNER_A, CODE_A);

  for (const typed of ['ALPHA01', 'alpha01', '  alpha01  ', 'Alpha01', '\tALPHA01\n']) {
    // A fresh visitor each time: ownership is immutable, so one link per user.
    const visitor = await newVisitor(db);
    const linked = await asUser(
      db,
      visitor,
      'select public.link_my_growth_referral($1::text) as result',
      [typed]
    );
    const result = (linked.rows[0] as { result: any }).result;
    assert.equal(result.growth_partner_id, provisioned.user_id ?? PARTNER_A, `${JSON.stringify(typed)} links to the same partner`);
    assert.equal(result.referral_code, CODE_A, 'and stores the CANONICAL form, not what was typed');
  }
});

test('empty, whitespace-only and malformed codes link nothing', async () => {
  const db = await setupDb();
  await provision(db, PARTNER_A, CODE_A);

  for (const bad of ['', '   ', 'ABC', 'ABCDEFGHIJKLM', 'ALPHA-01', '<script>alert(1)</script>', 'A'.repeat(200)]) {
    const visitor = await newVisitor(db);
    const outcome = await asVisitorAs(db, visitor, bad);
    assert.equal(outcome.ok, false, `${JSON.stringify(bad)} must be rejected`);
    assert.match(outcome.message, /Invalid referral code|invalid referral code/i, `${JSON.stringify(bad)}: safe message`);
  }

  // Nothing was written for any of them.
  const rows = await db.query(
    `select count(*)::int as n from public.growth_onboarding where growth_partner_id is not null`
  );
  assert.equal((rows.rows[0] as { n: number }).n, 0, 'no attribution row was created by a rejected code');
});

async function asVisitorAs(db: any, userId: string, code: string) {
  try {
    const res = await asUser(db, userId, 'select public.link_my_growth_referral($1::text) as result', [code]);
    return { ok: true as const, result: (res.rows[0] as { result: any }).result };
  } catch (error: any) {
    return { ok: false as const, message: String(error?.message || error) };
  }
}

test('an unknown but well-formed code links nothing and leaks no partner identity', async () => {
  const db = await setupDb();
  await provision(db, PARTNER_A, CODE_A);
  const outcome = await asVisitor(db, 'link_my_growth_referral', ['ZZZZZZZ']);
  assert.equal(outcome.ok, false);
  assert.match(
    outcome.ok ? '' : outcome.message,
    /Invalid or inactive referral code/i,
    'an unknown code reads exactly like an inactive one'
  );
});

test('validate_growth_referral_code normalises before it looks the code up', async () => {
  const db = await setupDb();
  await provision(db, PARTNER_A, CODE_A);
  for (const typed of ['ALPHA01', 'alpha01', '  Alpha01  ']) {
    const res = await asUser(
      db,
      VISITOR,
      'select public.validate_growth_referral_code($1::text) as result',
      [typed]
    );
    const result = (res.rows[0] as { result: any }).result;
    assert.equal(result.valid, true, `${JSON.stringify(typed)} validates`);
    assert.equal(result.referral_code, CODE_A, 'and returns the canonical code');
  }
  const bad = await asUser(
    db,
    VISITOR,
    'select public.validate_growth_referral_code($1::text) as result',
    ['nope']
  );
  const badResult = (bad.rows[0] as { result: any }).result;
  assert.equal(badResult.valid, false);
  assert.equal(badResult.referral_code, null, 'an invalid code returns no code at all');
});

test('validation and linking are not callable by an anonymous visitor', async () => {
  const db = await setupDb();
  for (const fn of ['validate_growth_referral_code', 'link_my_growth_referral']) {
    const res = await db.query(
      `select has_function_privilege('anon', 'public.${fn}(text)', 'EXECUTE') as allowed`
    );
    assert.equal((res.rows[0] as { allowed: boolean }).allowed, false, `${fn} is not granted to anon`);
  }
});

// ---------------------------------------------------------------------------
// 4.2d — the customer referral system is a DIFFERENT format and must not be
//        normalised with the partner rules.
// ---------------------------------------------------------------------------

test('the customer referral code has its own format and its own normalizer', () => {
  const cases: [string, string][] = [
    ['NX-AB12CD34', 'NX-AB12CD34'],
    ['nx-ab12cd34', 'NX-AB12CD34'],
    ['  NX-AB12  ', 'NX-AB12'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeReferralCode(input), expected);
    assert.equal(isReferralCode(input), true);
  }
  // A partner code is NOT a customer code, and vice versa. Conflating the two
  // systems would credit the wrong party.
  for (const wrong of ['NEXORA-ABC123', 'ALPHA01', 'NX-ABC', 'NX-ABCDEFGHI', '', '   ', '<script>']) {
    assert.equal(normalizeReferralCode(wrong), '', `${JSON.stringify(wrong)} is not a customer code`);
    assert.equal(isReferralCode(wrong), false);
  }
  // ...and a customer code is not a partner code either.
  assert.equal(isGrowthReferralCodeFormat('NX-AB12CD34'), false);
});

// ---------------------------------------------------------------------------
// 4.1 — the link a partner shares carries the canonical form.
// ---------------------------------------------------------------------------

test('a generated share link carries the canonical code form', () => {
  assert.equal(
    partnerReferralShareLink('ALPHA01', 'https://app.example'),
    'https://app.example/signup?ref=ALPHA01'
  );
  assert.equal(
    partnerReferralShareLink('  alpha01  ', 'https://app.example'),
    'https://app.example/signup?ref=ALPHA01',
    'a lowercase code is emitted in canonical form, so the recipient sees what will be stored'
  );
  assert.equal(
    partnerReferralShareLink('NEXORA-abc123', 'https://app.example'),
    'https://app.example/signup?ref=NEXORA-ABC123'
  );
  assert.equal(partnerReferralShareLink('', 'https://app.example'), '', 'no code, no link');
  assert.equal(partnerReferralShareLink('   ', 'https://app.example'), '', 'a blank code is not a code');
  assert.equal(partnerReferralShareLink('ALPHA01', ''), '', 'no origin, no link');
});

test('AI Studio preview hosts never leak into public referral links', () => {
  const preview = 'https://ais-dev-wjwddzam65uesfat5wh54a-616909335986.asia-southeast1.run.app';
  assert.equal(publicOnboardingOrigin(preview), DEFAULT_PUBLIC_ONBOARDING_ORIGIN);
  assert.equal(
    partnerReferralShareLink('NEXORA-3E038732', preview),
    `${DEFAULT_PUBLIC_ONBOARDING_ORIGIN}/signup?ref=NEXORA-3E038732`
  );
});


// ---------------------------------------------------------------------------
// 4.1 — every way a code can arrive in a URL funnels through one reader.
// ---------------------------------------------------------------------------

test('the query reader accepts ref, referral and code aliases', () => {
  assert.deepEqual([...REFERRAL_QUERY_PARAMS], ['ref', 'referral', 'code'], 'aliases stay ordered and explicit');
  assert.equal(referralCodeFromQuery('?ref=ALPHA01'), 'ALPHA01', '?ref= (what a share link emits)');
  assert.equal(referralCodeFromQuery('?referral=ALPHA01'), 'ALPHA01', '?referral= (typed by hand)');
  assert.equal(referralCodeFromQuery('?referral=%20alpha01%20'), 'alpha01', 'surrounding whitespace is trimmed');
  assert.equal(referralCodeFromQuery('?code=ALPHA01'), 'ALPHA01', '?code= legacy alias');
  assert.equal(referralCodeFromQuery('?ref=ALPHA01&referral=OTHER1'), 'ALPHA01', 'ref wins when both are present');
  assert.equal(referralCodeFromQuery('?invite=ALPHA01&campaign=x'), '', 'unrecognized parameters are ignored');
  assert.equal(referralCodeFromQuery('?ref='), '', 'an empty value is not a code');
  assert.equal(referralCodeFromQuery('?ref=%20%20'), '', 'whitespace alone is not a code');
  assert.equal(referralCodeFromQuery(''), '', 'no query at all');
  assert.equal(referralCodeFromQuery(undefined), '', 'a missing query is not an error');
  assert.equal(referralCodeFromQuery('not a query string'), '', 'garbage is not an error either');
});

test('an over-long value is dropped, never truncated into a different code', () => {
  const long = 'A'.repeat(MAX_REFERRAL_QUERY_LENGTH + 1);
  assert.equal(referralCodeFromQuery(`?ref=${long}`), '', 'one over the cap is dropped whole');
  assert.equal(
    referralCodeFromQuery(`?ref=${'A'.repeat(MAX_REFERRAL_QUERY_LENGTH)}`),
    'A'.repeat(MAX_REFERRAL_QUERY_LENGTH),
    'exactly at the cap is kept'
  );
  // The important half: the dropped value is NOT replaced by the other
  // parameter, which would attribute the owner to a different referral.
  assert.equal(referralCodeFromQuery(`?ref=${long}&referral=GOOD01`), '');
});

test('the reader never invents a code from unrelated parameters', () => {
  for (const query of [
    '?utm_source=partner&utm_medium=ref',
    '?redirect=/onboarding/referral',
    '?referrer=ALPHA01',
    '?rc=ALPHA01',
    '?reference=ALPHA01',
  ]) {
    assert.equal(referralCodeFromQuery(query), '', query);
  }
});
