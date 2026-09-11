// ============================================================================
// PART 2.3 ACCEPTANCE — Growth Partner REFERRAL CODE section.
//
//   • The referral code comes ONLY from the caller's own growth_partners row
//     (SELECT-own-row RLS) — never a hardcoded/mock/frontend-generated value,
//     never another partner's code, never a partner_id/user_id from the URL.
//   • Copy: the shared clipboard helper writes exactly the code and reports
//     failure gracefully (no fake "Copied").
//   • States: success (code + Copy), empty ("Referral code not available."),
//     error (safe message, never raw DB text).
//   • The 8 cases:
//       1. active partner sees the correct code
//       2. normal user cannot access the section
//       3. partner A cannot retrieve partner B's code
//       4. the code is loaded from the backend/database
//       5. copy copies the correct value
//       6. missing-code state
//       7. backend error state
//       8. refresh still shows the correct code
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  copyReferralCodeToClipboard,
  GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE,
  PARTNER_SECTION_ERROR_MESSAGE,
  resolveGrowthPartnerGate,
  toSafePartnerSectionError,
} from '../src/lib/growthPartner';
import {
  GROWTH_PARTNER_UNAUTHORIZED_BODY,
  GROWTH_PARTNER_UNAUTHORIZED_TITLE,
  GrowthPartnerUnauthorized,
} from '../src/components/GrowthPartnerPage';
import { ReferralCodeCard, SectionError } from '../src/components/GrowthPartnerSections';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ---------------------------------------------------------------------------
// PGlite fixture — the production auth contract + the base growth migration.
// ---------------------------------------------------------------------------

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
    insert into auth.users(id) values ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}');
  `);
  await db.exec(MIGRATION);
  return db;
}

async function provision(db: any, userId: string, code: string, active = true) {
  return (
    await db.query('select public.provision_growth_partner($1::uuid, $2, $3) as result', [
      userId,
      code,
      active,
    ])
  ).rows[0].result;
}

/**
 * The exact query the page's gate runs (fetchMyGrowthPartnerRow) to resolve
 * the caller's own referral code — RLS SELECT-own-row, no filter parameters.
 */
async function uiPartnerRow(db: any, userId: string) {
  const res = await asUser(
    db,
    userId,
    'select user_id, referral_code, is_active, created_at, updated_at from public.growth_partners'
  );
  return res.rows as Array<{ user_id: string; referral_code: string; is_active: boolean }>;
}

// ---------------------------------------------------------------------------
// 1 + 4. Active partner sees the correct code, loaded from the database.
// ---------------------------------------------------------------------------

test('1/4. an active partner sees only their own backend referral code', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A);
    const rows = await uiPartnerRow(db, PARTNER_A);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, PARTNER_A);
    assert.equal(rows[0].referral_code, CODE_A);
    assert.equal(rows[0].is_active, true);

    // The gate admits this row, so the dashboard (and its code card) render.
    assert.equal(
      resolveGrowthPartnerGate({
        userId: PARTNER_A,
        loading: false,
        isMockMode: false,
        partnerRow: rows[0] as any,
        loadError: null,
      }),
      'ready'
    );

    // The presentational card renders the code + a Copy affordance.
    const html = render(React.createElement(ReferralCodeCard, { code: rows[0].referral_code }));
    assert.match(html, new RegExp(CODE_A));
    assert.match(html, /Copy/);
    assert.match(html, /Your referral code/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Normal user cannot access the section.
// ---------------------------------------------------------------------------

test('2. a normal authenticated user gets zero rows and is denied, never shown a code', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A);
    // RLS returns no partner row for a non-partner → the section is unreachable.
    const rows = await uiPartnerRow(db, USER_1);
    assert.equal(rows.length, 0);
    assert.equal(
      resolveGrowthPartnerGate({
        userId: USER_1,
        loading: false,
        isMockMode: false,
        partnerRow: null,
        loadError: null,
      }),
      'unauthorized'
    );

    // The denied state renders a safe message, never a referral code.
    const html = render(React.createElement(GrowthPartnerUnauthorized, { onBack: () => {} }));
    assert.match(html, new RegExp(GROWTH_PARTNER_UNAUTHORIZED_TITLE));
    assert.match(html, new RegExp(GROWTH_PARTNER_UNAUTHORIZED_BODY));
    assert.doesNotMatch(html, new RegExp(CODE_A));
    assert.doesNotMatch(html, /Your referral code/);
    assert.doesNotMatch(html, /Copy/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Partner A cannot retrieve Partner B's code.
// ---------------------------------------------------------------------------

test('3. partner A cannot retrieve partner B code, even with an explicit user_id filter', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B);

    // Each partner's SELECT sees ONLY their own row (RLS, not a query filter).
    const aRows = await uiPartnerRow(db, PARTNER_A);
    assert.deepEqual(aRows.map((r) => r.referral_code), [CODE_A]);
    const bRows = await uiPartnerRow(db, PARTNER_B);
    assert.deepEqual(bRows.map((r) => r.referral_code), [CODE_B]);

    // Partner A asking for B's row by user_id gets ZERO rows — the RLS policy
    // (`user_id = auth.uid()`) discards the foreign row before any filter.
    const cross = await asUser(
      db,
      PARTNER_A,
      'select referral_code from public.growth_partners where user_id = $1::uuid',
      [PARTNER_B]
    );
    assert.equal(cross.rows.length, 0);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Copy copies the correct value; failure is handled gracefully.
// ---------------------------------------------------------------------------

test('5. the clipboard helper writes exactly the referral code and never fakes success', async () => {
  let captured: string | null = null;
  const fake = {
    clipboard: {
      writeText: async (text: string) => {
        captured = text;
      },
    },
  };

  assert.equal(await copyReferralCodeToClipboard(CODE_A, fake), true);
  assert.equal(captured, CODE_A);

  // Whitespace is trimmed — only the code travels.
  assert.equal(await copyReferralCodeToClipboard(`  ${CODE_B}  `, fake), true);
  assert.equal(captured, CODE_B);

  // Rejected write → false (UI keeps "Copy", no fake "Copied").
  const failing = {
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  };
  assert.equal(await copyReferralCodeToClipboard(CODE_A, failing), false);

  // No clipboard API → false, never throws.
  assert.equal(await copyReferralCodeToClipboard(CODE_A, {}), false);
  assert.equal(await copyReferralCodeToClipboard(CODE_A, null), false);

  // Empty/missing code → false (nothing to copy).
  assert.equal(await copyReferralCodeToClipboard('', fake), false);
  assert.equal(await copyReferralCodeToClipboard(null, fake), false);
  assert.equal(await copyReferralCodeToClipboard(undefined, fake), false);
});

test('5. the rendered card carries a Copy button bound to the displayed code', () => {
  const html = render(React.createElement(ReferralCodeCard, { code: CODE_A }));
  assert.match(html, new RegExp(CODE_A));
  assert.match(html, /<code[^>]*>ALPHA01<\/code>/);
  assert.match(html, />Copy<\/button>/);
  // Initial state is "Copy", not "Copied".
  assert.doesNotMatch(html, />Copied</);
  // The code is read-only (display only — no input).
  assert.doesNotMatch(html, /<input/);
});

// ---------------------------------------------------------------------------
// 6. Missing-code state.
// ---------------------------------------------------------------------------

test('6. a missing code shows the safe empty state and never invents a code', () => {
  for (const missing of [null, '', '   ', undefined]) {
    const html = render(React.createElement(ReferralCodeCard, { code: missing as any }));
    assert.match(html, new RegExp(GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE));
    assert.doesNotMatch(html, /<code/);
    assert.doesNotMatch(html, />Copy<\/button>/);
  }
});

// ---------------------------------------------------------------------------
// 7. Backend error state.
// ---------------------------------------------------------------------------

test('7. backend errors surface a safe message, never raw database text', () => {
  // Raw backend errors are mapped to the generic section copy.
  const raw = new Error('relation "public.growth_partners" does not exist (SQLSTATE 42P01)');
  assert.equal(toSafePartnerSectionError(raw).message, PARTNER_SECTION_ERROR_MESSAGE);
  // Only the backend's own safe messages pass through.
  assert.equal(
    toSafePartnerSectionError(new Error('Growth Partner access required')).message,
    'Growth Partner access required'
  );

  const html = render(React.createElement(SectionError, { message: PARTNER_SECTION_ERROR_MESSAGE, onRetry: () => {} }));
  assert.match(html, /Something went wrong/);
  assert.match(html, new RegExp(PARTNER_SECTION_ERROR_MESSAGE));
  assert.match(html, /Retry/);
  // No SQL/schema identifiers leak into the UI.
  assert.doesNotMatch(html, /SQLSTATE|relation|growth_partners/);
});

// ---------------------------------------------------------------------------
// 8. Refresh still displays the correct code.
// ---------------------------------------------------------------------------

test('8. the code is stable across repeated backend reads (refresh)', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A);

    // First "page load" and a "refresh" run the SAME own-row query.
    const first = await uiPartnerRow(db, PARTNER_A);
    const refresh = await uiPartnerRow(db, PARTNER_A);
    assert.equal(first.length, 1);
    assert.deepEqual(first, refresh);
    assert.equal(refresh[0].referral_code, CODE_A);

    // The re-read still admits the partner (dashboard remains accessible).
    assert.equal(
      resolveGrowthPartnerGate({
        userId: PARTNER_A,
        loading: false,
        isMockMode: false,
        partnerRow: refresh[0] as any,
        loadError: null,
      }),
      'ready'
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Static: no hardcoded code, no frontend authority, single backend source.
// ---------------------------------------------------------------------------

test('the referral-code section never hardcodes a code or accepts a partner/user id', () => {
  const sections = readFileSync(
    new URL('../src/components/GrowthPartnerSections.tsx', import.meta.url),
    'utf8'
  );
  const codeOnly = sections.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  // The card renders only its `code` prop — no literal code, no id selection.
  assert.doesNotMatch(codeOnly, /ALPHA01|BETA002|'CODE|referral_code\s*=/);
  assert.doesNotMatch(codeOnly, /\.eq\(|partner_id|user_id/);

  const lib = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  // The own-row fetch takes no parameters (RLS derives identity from the JWT).
  const fetchSrc = libCode.match(/export async function fetchMyGrowthPartnerRow\([\s\S]*?\n}/)?.[0] ?? '';
  assert.doesNotMatch(fetchSrc, /\.eq\(/);
  assert.doesNotMatch(fetchSrc, /partner_id|user_id\s*[:=]/);
  // No frontend code generation, no localStorage/URL authority.
  assert.doesNotMatch(libCode, /localStorage|sessionStorage|URLSearchParams|searchParams/i);
  assert.match(libCode, /GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE = 'Referral code not available\.'/);
});
