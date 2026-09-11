// ============================================================================
// PART 2.4 ACCEPTANCE — Growth Partner REFERRED USERS section.
//
//   • `/growth-partner/referrals` lists the AUTHENTICATED partner's own
//     referred users from the existing backend relationship (no new system).
//   • The backend derives the partner from auth.uid() — get_my_partner_referrals
//     takes NO partner_id / user_id / query authority; the frontend passes only
//     server-side filter/search/pagination arguments.
//   • Only display names + funnel dates + status are disclosed; emails, phones,
//     full ids and financial data never leave the backend.
//   • The 10 cases:
//       1. active partner sees own referred users
//       2. partner with no referrals sees the empty state
//       3. partner A cannot see partner B's users
//       4. URL/query partner manipulation cannot bypass security
//       5. normal user cannot access the referred-user page
//       6. data comes from the real backend
//       7. loading state
//       8. backend error state
//       9. refresh returns correct (fresh, backend) data
//      10. existing referral functionality unchanged
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  PARTNER_SECTION_ERROR_MESSAGE,
  toSafePartnerSectionError,
  type PartnerReferralList,
} from '../src/lib/growthPartner';
import { matchGrowthPartnerRoute } from '../src/lib/router';
import {
  GROWTH_PARTNER_NO_REFERRALS_BODY,
  GROWTH_PARTNER_NO_REFERRALS_TITLE,
  GrowthPartnerReferrals,
} from '../src/components/GrowthPartnerSections';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const USER_2 = 'b0000000-0000-4000-8000-000000000002';
const USER_3 = 'b0000000-0000-4000-8000-000000000003';
const USER_4 = 'b0000000-0000-4000-8000-000000000004';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const GROWTH_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);
const DASHBOARD_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260915_growth_partner_dashboard.sql', import.meta.url),
  'utf8'
);

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

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
    create table public.profiles(id uuid primary key, full_name text, email text, phone text);
    insert into auth.users(id) values
      ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}'), ('${USER_2}'), ('${USER_3}'), ('${USER_4}');
  `);
  await db.exec(GROWTH_MIGRATION);
  await db.exec(DASHBOARD_MIGRATION);
  return db;
}

async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}

async function provision(db: any, userId: string, code: string) {
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [userId, code]);
}

// Partner A → USER_1, USER_2, USER_3 (completed / started / linked).
// Partner B → USER_4 (linked). Profiles carry email/phone to prove they
// are never disclosed.
async function setupPopulatedDb() {
  const db = await setupDb();
  await provision(db, PARTNER_A, CODE_A);
  await provision(db, PARTNER_B, CODE_B);
  await asUser(db, USER_1, 'select public.link_my_growth_referral($1)', [CODE_A]);
  await asUser(db, USER_1, "select public.update_my_onboarding_progress('start_template')");
  await asUser(db, USER_1, "select public.update_my_onboarding_progress('complete_template')");
  await asUser(db, USER_2, 'select public.link_my_growth_referral($1)', [CODE_A]);
  await asUser(db, USER_2, "select public.update_my_onboarding_progress('start_template')");
  await asUser(db, USER_3, 'select public.link_my_growth_referral($1)', [CODE_A]);
  await asUser(db, USER_4, 'select public.link_my_growth_referral($1)', [CODE_B]);
  await db.query(
    `insert into public.profiles(id, full_name, email, phone) values
     ($1::uuid, 'Asha Sharma', 'asha@example.com', '+91 90000 00001'),
     ($2::uuid, 'Rohan Verma', 'rohan@example.com', '+91 90000 00002'),
     ($3::uuid, 'Meera Iyer', 'meera@example.com', '+91 90000 00003'),
     ($4::uuid, 'Bala Krishnan', 'bala@example.com', '+91 90000 00004')`,
    [USER_1, USER_2, USER_3, USER_4]
  );
  return db;
}

// ---------------------------------------------------------------------------
// 1 + 6. Active partner sees own referred users (real backend data)
// ---------------------------------------------------------------------------

test('1/6. an active partner sees their own referred users from the backend', async () => {
  const db = await setupPopulatedDb();
  try {
    const list = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    assert.equal(list.total, 3);
    const names = list.rows.map((row) => row.display_name).sort();
    assert.deepEqual(names, ['Asha Sharma', 'Meera Iyer', 'Rohan Verma']);
    // Referral/join date + onboarding status come from the same rows.
    assert.ok(list.rows.every((row) => row.linked_at));
    const statuses = list.rows.map((row) => row.status).sort();
    assert.deepEqual(statuses, ['linked', 'template_completed', 'template_started']);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Empty state
// ---------------------------------------------------------------------------

test('2. a partner with no referrals gets the empty state, never fake users', async () => {
  const db = await setupPopulatedDb();
  try {
    // Partner B has one referral; give an empty state to a fresh partner C.
    await db.query(`insert into auth.users(id) values ('c0000000-0000-4000-8000-000000000001')`);
    await provision(db, 'c0000000-0000-4000-8000-000000000001', 'EMPTY01');
    const list = (await rpc(db, 'c0000000-0000-4000-8000-000000000001', 'get_my_partner_referrals', [
      'all',
      null,
      20,
      0,
    ])) as PartnerReferralList;
    assert.deepEqual(list, { total: 0, limit: 20, offset: 0, rows: [] });

    const html = render(
      React.createElement(GrowthPartnerReferrals, {
        list,
        loading: false,
        error: null,
        filter: 'all',
        onFilterChange: () => {},
        onPage: () => {},
        onRetry: () => {},
      })
    );
    assert.match(html, new RegExp(GROWTH_PARTNER_NO_REFERRALS_TITLE));
    assert.match(html, new RegExp(GROWTH_PARTNER_NO_REFERRALS_BODY));
    assert.doesNotMatch(html, /Asha Sharma|Rohan Verma|Meera Iyer|Bala Krishnan/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Partner isolation
// ---------------------------------------------------------------------------

test('3. partner A cannot see partner B users (and vice versa)', async () => {
  const db = await setupPopulatedDb();
  try {
    const a = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    assert.ok(a.rows.every((row) => row.display_name !== 'Bala Krishnan'));

    const b = (await rpc(db, PARTNER_B, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    assert.equal(b.total, 1);
    assert.equal(b.rows[0].display_name, 'Bala Krishnan');
    assert.ok(b.rows.every((row) => row.display_name !== 'Asha Sharma'));
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 4. URL/query partner manipulation cannot bypass security
// ---------------------------------------------------------------------------

test('4. no partner/user id can be passed by URL, query or body to reach another partner', async () => {
  const db = await setupPopulatedDb();
  try {
    // The RPC signature accepts ONLY status/search/limit/offset — any attempt
    // to force a partner id is a different call with no such parameter.
    // (Extra args would fail here; we assert the code contract instead.)
    const dashboardSrc = stripComments(DASHBOARD_MIGRATION);
    assert.doesNotMatch(dashboardSrc, /p_partner|p_user_id|p_actor|p_email/);
    assert.match(
      dashboardSrc,
      /create or replace function public\.get_my_partner_referrals\(\s*p_status_filter text[^)]*p_search text[^)]*p_limit int[^)]*p_offset int[^)]*\)/
    );
    assert.match(dashboardSrc, /actor uuid := auth\.uid\(\)|v_partner public\.growth_partners%rowtype := public\.partner_dashboard_caller\(\)/);
    assert.match(dashboardSrc, /growth_partner_id = v_partner\.user_id/);

    // Client: the wrapper passes only the four sanctioned arguments.
    const clientSrc = stripComments(readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8'));
    const call = clientSrc.match(/supabase\.rpc\('get_my_partner_referrals', \{[\s\S]*?\}\);/)?.[0] ?? '';
    assert.match(call, /p_status_filter/);
    assert.match(call, /p_search/);
    assert.match(call, /p_limit/);
    assert.match(call, /p_offset/);
    assert.doesNotMatch(call, /partner_id|user_id/);

    // Route: the router reads ONLY window.location.pathname — the query string
    // never reaches the route matcher, so a `?partner_id=…` suffix cannot
    // change or leak the section. (The router parses query params ONLY for the
    // separate Template Handoff feature — never for the Growth Partner area.)
    assert.equal(matchGrowthPartnerRoute('/growth-partner/referrals'), 'referrals');
    const routerSrc = stripComments(readFileSync(new URL('../src/lib/router.ts', import.meta.url), 'utf8'));
    assert.match(routerSrc, /window\.location\.pathname/);
    const gpMatcher = routerSrc.match(/export function matchGrowthPartnerRoute\([\s\S]*?\n}/)?.[0] ?? '';
    const gpPath = routerSrc.match(/export function isGrowthPartnerPath\([\s\S]*?\n}/)?.[0] ?? '';
    assert.doesNotMatch(gpMatcher, /search|URLSearchParams|query/i);
    assert.doesNotMatch(gpPath, /search|URLSearchParams|query/i);
    // The page/component never read query params for authorization either.
    const pageSrc = stripComments(readFileSync(new URL('../src/components/GrowthPartnerPage.tsx', import.meta.url), 'utf8'));
    assert.doesNotMatch(pageSrc, /partner_id|user_id|URLSearchParams|searchParams/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Normal user cannot access the referred-user page
// ---------------------------------------------------------------------------

test('5. a normal user fails closed on the referrals RPC and is denied at the gate', async () => {
  const db = await setupPopulatedDb();
  try {
    await assert.rejects(rpc(db, USER_1, 'get_my_partner_referrals', ['all', null, 20, 0]), /Growth Partner access required/);
    await assert.rejects(asUser(db, '', 'select public.get_my_partner_referrals()'), /permission denied/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Loading state
// ---------------------------------------------------------------------------

test('7. the list renders a loading state and never misleading rows while loading', () => {
  const html = render(
    React.createElement(GrowthPartnerReferrals, {
      list: null,
      loading: true,
      error: null,
      filter: 'all',
      onFilterChange: () => {},
      onPage: () => {},
      onRetry: () => {},
    })
  );
  assert.match(html, /role="status"/);
  assert.match(html, /Loading your referrals/);
  assert.doesNotMatch(html, /Asha Sharma/);
  assert.doesNotMatch(html, /<table/);
});

// ---------------------------------------------------------------------------
// 8. Backend error state
// ---------------------------------------------------------------------------

test('8. backend errors surface a safe retry state, never raw database text', () => {
  const raw = new Error('relation "public.growth_onboarding" does not exist (SQLSTATE 42P01)');
  assert.equal(toSafePartnerSectionError(raw).message, PARTNER_SECTION_ERROR_MESSAGE);

  const html = render(
    React.createElement(GrowthPartnerReferrals, {
      list: null,
      loading: false,
      error: PARTNER_SECTION_ERROR_MESSAGE,
      filter: 'all',
      onFilterChange: () => {},
      onPage: () => {},
      onRetry: () => {},
    })
  );
  assert.match(html, /Something went wrong/);
  assert.match(html, new RegExp(PARTNER_SECTION_ERROR_MESSAGE));
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /SQLSTATE|relation|growth_onboarding/);
});

// ---------------------------------------------------------------------------
// 9. Refresh returns correct data (fresh backend read)
// ---------------------------------------------------------------------------

test('9. refresh re-fetches from the backend and the affordance exists', async () => {
  const db = await setupPopulatedDb();
  try {
    const first = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    // A refresh performs the SAME backend call — data comes from the DB again,
    // not from cached frontend state.
    const second = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    assert.deepEqual(first, second);
    assert.equal(second.total, 3);

    // The UI exposes a Refresh action wired to the retry callback.
    const html = render(
      React.createElement(GrowthPartnerReferrals, {
        list: second,
        loading: false,
        error: null,
        filter: 'all',
        onFilterChange: () => {},
        onPage: () => {},
        onRetry: () => {},
      })
    );
    assert.match(html, /Refresh/);
    assert.match(html, /aria-label="Refresh referrals"/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Disclosure: only permitted fields leave the backend
// ---------------------------------------------------------------------------

test('disclosure: names, dates and status only — never emails, phones, ids or secrets', async () => {
  const db = await setupPopulatedDb();
  try {
    const list = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    for (const row of list.rows) {
      assert.deepEqual(Object.keys(row).sort(), [
        'display_name',
        'linked_at',
        'ref',
        'status',
        'template_completed_at',
        'template_started_at',
      ]);
      assert.match(row.ref, /^…[0-9a-f]{8}$/);
    }
    const serialized = JSON.stringify(list);
    assert.doesNotMatch(serialized, /asha@example\.com|rohan@example\.com|\+91 90000/);
    assert.doesNotMatch(serialized, /b0000000-0000-4000-8000-00000000000/);
    assert.doesNotMatch(serialized, /password|token|secret|api_?key/i);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 10. Existing referral functionality unchanged (regression pin)
// ---------------------------------------------------------------------------

test('10. the existing referral-link relationship is untouched by the list reads', async () => {
  const db = await setupPopulatedDb();
  try {
    // Reading the list must not alter the underlying relationship rows.
    await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0]);
    const rows = (await db.query('select user_id, growth_partner_id, referral_code from public.growth_onboarding order by user_id')).rows;
    assert.equal(rows.length, 4);
    const byUser = new Map(rows.map((r: any) => [r.user_id, r]));
    assert.equal(byUser.get(USER_1).growth_partner_id, PARTNER_A);
    assert.equal(byUser.get(USER_1).referral_code, CODE_A);
    assert.equal(byUser.get(USER_4).growth_partner_id, PARTNER_B);
    assert.equal(byUser.get(USER_4).referral_code, CODE_B);
    // Linking is still immutable (existing behavior preserved).
    await assert.rejects(asUser(db, USER_1, 'select public.link_my_growth_referral($1)', [CODE_B]), /already linked/);
  } finally {
    await db.close();
  }
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}
