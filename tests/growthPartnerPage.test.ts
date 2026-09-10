// ============================================================================
// Growth Partner page (Phase 2) — route, gate, dashboard and RLS contract.
//
//   • Route helpers resolve /growth-partner/... per the app's router idioms.
//   • resolveGrowthPartnerGate maps auth + backend outcome to one page state.
//   • summarizeGrowthReferrals reduces a partner's OWN rows to dashboard counts.
//   • Server-rendered output pins every gate state, the dashboard contents
//     (real code + real counts, empty state) and the placeholder sections.
//   • PGlite replays the UI's EXACT database queries as Partner A / Partner B
//     and pins that each partner receives only their own rows — the page never
//     fetches all users and filters in React.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  GROWTH_PARTNER_PATH,
  GROWTH_PARTNER_SECTIONS,
  growthPartnerPath,
  isGrowthPartnerPath,
  matchGrowthPartnerRoute,
} from '../src/lib/router';
import {
  growthReferralStatusLabel,
  isSessionExpiredError,
  resolveGrowthPartnerGate,
  summarizeGrowthReferrals,
  type GrowthPartner,
  type GrowthReferralRow,
} from '../src/lib/growthPartner';
import {
  GROWTH_PARTNER_COMING_SOON_BODY,
  GROWTH_PARTNER_EMPTY_BODY,
  GROWTH_PARTNER_EMPTY_TITLE,
  GROWTH_PARTNER_MOCK_BODY,
  GROWTH_PARTNER_MOCK_TITLE,
  GROWTH_PARTNER_SECTION_LABELS,
  GROWTH_PARTNER_SESSION_BODY,
  GROWTH_PARTNER_SESSION_TITLE,
  GROWTH_PARTNER_SIGNIN_BODY,
  GROWTH_PARTNER_SIGNIN_TITLE,
  GROWTH_PARTNER_UNAUTHORIZED_BODY,
  GROWTH_PARTNER_UNAUTHORIZED_TITLE,
  GrowthPartnerComingSoon,
  GrowthPartnerDashboard,
  GrowthPartnerLoadError,
  GrowthPartnerLoading,
  GrowthPartnerMockNotice,
  GrowthPartnerPage,
  GrowthPartnerSectionTabs,
  GrowthPartnerSignInPrompt,
  GrowthPartnerUnauthorized,
  growthPartnerComingSoonTitle,
} from '../src/components/GrowthPartnerPage';

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test('growth partner routes resolve per the existing router conventions', () => {
  assert.equal(GROWTH_PARTNER_PATH, '/growth-partner');
  assert.deepEqual([...GROWTH_PARTNER_SECTIONS], ['dashboard', 'referrals', 'customers', 'performance', 'commission']);
  assert.equal(isGrowthPartnerPath('/growth-partner'), true);
  assert.equal(isGrowthPartnerPath('/growth-partner/referrals'), true);
  assert.equal(isGrowthPartnerPath('/growth-partner/'), true);
  assert.equal(isGrowthPartnerPath('/GROWTH-PARTNER/Commission'), true);
  assert.equal(isGrowthPartnerPath('/growth-partner-x'), false);
  assert.equal(isGrowthPartnerPath('/dashboard'), false);
  assert.equal(matchGrowthPartnerRoute('/growth-partner'), 'dashboard');
  assert.equal(matchGrowthPartnerRoute('/growth-partner/performance'), 'performance');
  assert.equal(matchGrowthPartnerRoute('/growth-partner/commission/'), 'commission');
  // Unknown sections fall back to the dashboard, never a blank screen.
  assert.equal(matchGrowthPartnerRoute('/growth-partner/payouts'), 'dashboard');
  assert.equal(matchGrowthPartnerRoute('/elsewhere'), 'dashboard');
  assert.equal(growthPartnerPath('dashboard'), '/growth-partner');
  assert.equal(growthPartnerPath('referrals'), '/growth-partner/referrals');
  assert.equal(growthPartnerPath('customers'), '/growth-partner/customers');
  assert.equal(growthPartnerPath('performance'), '/growth-partner/performance');
  assert.equal(growthPartnerPath('commission'), '/growth-partner/commission');
});

// ---------------------------------------------------------------------------
// Gate + summary logic
// ---------------------------------------------------------------------------

const PARTNER_ROW: GrowthPartner = {
  user_id: 'a0000000-0000-4000-8000-000000000001',
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const gate = (patch: Record<string, any> = {}) =>
  resolveGrowthPartnerGate({
    userId: 'user-1',
    loading: false,
    isMockMode: false,
    partnerRow: PARTNER_ROW,
    loadError: null,
    ...patch,
  });

test('the gate maps auth + backend outcome to exactly one page state', () => {
  assert.equal(gate({ loading: true }), 'loading');
  // 1. Unauthenticated users never reach the dashboard.
  assert.equal(gate({ userId: null }), 'unauthenticated');
  assert.equal(gate({ userId: '' }), 'unauthenticated');
  // 2. Signed-in non-partners (zero partner rows from RLS) are unauthorized.
  assert.equal(gate({ partnerRow: null }), 'unauthorized');
  // 3. Partners reach the dashboard.
  assert.equal(gate(), 'ready');
  // Deactivation is a status badge, not a lockout of the partner's own data.
  assert.equal(gate({ partnerRow: { ...PARTNER_ROW, is_active: false } }), 'ready');
  // Errors: session expiry is distinguished from generic failures.
  assert.equal(gate({ loadError: new Error('JWT expired') }), 'session-expired');
  assert.equal(gate({ loadError: { status: 401 } }), 'session-expired');
  assert.equal(gate({ loadError: new Error('fetch failed') }), 'error');
  // Mock preview shows a notice, never invented numbers.
  assert.equal(gate({ isMockMode: true }), 'mock-mode');
  // Loading wins while a request is in flight.
  assert.equal(gate({ loading: true, userId: null }), 'loading');
});

test('session-expiry detection covers Supabase/PostgREST failure shapes', () => {
  assert.equal(isSessionExpiredError(null), false);
  assert.equal(isSessionExpiredError(new Error('boom')), false);
  assert.equal(isSessionExpiredError(new Error('JWT expired')), true);
  assert.equal(isSessionExpiredError(new Error('invalid JWT: unable to parse')), true);
  assert.equal(isSessionExpiredError(new Error('Your session has expired. Please sign in again.')), true);
  assert.equal(isSessionExpiredError({ status: 401 }), true);
  assert.equal(isSessionExpiredError({ code: 'PGRST301' }), true);
});

test('referral summaries count total / onboarding / completed from partner rows', () => {
  const row = (status: GrowthReferralRow['status']): GrowthReferralRow => ({
    user_id: `u-${status}`,
    status,
    linked_at: '2026-09-02T00:00:00.000Z',
    template_started_at: null,
    template_completed_at: null,
  });
  assert.deepEqual(summarizeGrowthReferrals([]), { total: 0, onboarding: 0, completed: 0 });
  assert.deepEqual(summarizeGrowthReferrals([row('linked'), row('template_started'), row('template_completed')]), {
    total: 3,
    onboarding: 2,
    completed: 1,
  });
  assert.deepEqual(summarizeGrowthReferrals([row('template_completed')]), {
    total: 1,
    onboarding: 0,
    completed: 1,
  });
  assert.equal(growthReferralStatusLabel('linked'), 'Onboarding');
  assert.equal(growthReferralStatusLabel('template_started'), 'Template started');
  assert.equal(growthReferralStatusLabel('template_completed'), 'Completed');
});

// ---------------------------------------------------------------------------
// Rendered states (react-dom/server, like the My Bookings page tests)
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

test('unauthenticated visitors get a sign-in prompt, never dashboard content', () => {
  const html = render(React.createElement(GrowthPartnerSignInPrompt, { onRequireAuth: () => {} }));
  assert.match(html, new RegExp(GROWTH_PARTNER_SIGNIN_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_SIGNIN_BODY));
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /Your referral code/);
  assert.doesNotMatch(html, /Total referred/);
});

test('signed-in non-partners get an unauthorized state, never partner data', () => {
  const html = render(React.createElement(GrowthPartnerUnauthorized, { onBack: () => {} }));
  assert.match(html, new RegExp(GROWTH_PARTNER_UNAUTHORIZED_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_UNAUTHORIZED_BODY));
  assert.doesNotMatch(html, /Your referral code/);
  assert.doesNotMatch(html, /ALPHA01/);
});

test('loading, error, session-expired and mock states never render blank screens', () => {
  const loading = render(React.createElement(GrowthPartnerLoading, {}));
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading your partner area/);

  const error = render(
    React.createElement(GrowthPartnerLoadError, {
      title: 'Could not load the Growth Partner area',
      body: 'fetch failed',
      actionLabel: 'Retry',
      onAction: () => {},
    })
  );
  assert.match(error, /Could not load the Growth Partner area/);
  assert.match(error, /Retry/);

  const expired = render(
    React.createElement(GrowthPartnerLoadError, {
      title: GROWTH_PARTNER_SESSION_TITLE,
      body: GROWTH_PARTNER_SESSION_BODY,
      actionLabel: 'Sign in again',
      onAction: () => {},
    })
  );
  assert.match(expired, new RegExp(GROWTH_PARTNER_SESSION_TITLE));
  assert.match(expired, /Sign in again/);

  const mock = render(React.createElement(GrowthPartnerMockNotice, { onBack: () => {} }));
  assert.match(mock, new RegExp(GROWTH_PARTNER_MOCK_TITLE));
  assert.match(mock, new RegExp(GROWTH_PARTNER_MOCK_BODY));
});

test('the page container renders its loading state on first paint', () => {
  const html = render(
    React.createElement(GrowthPartnerPage, { user: { id: 'u-1' }, path: '/growth-partner' } as any)
  );
  assert.match(html, /Loading your partner area/);
});

const DASHBOARD_ROWS: GrowthReferralRow[] = [
  {
    user_id: 'b0000000-0000-4000-8000-000000000001',
    status: 'template_completed',
    linked_at: '2026-09-02T10:00:00.000Z',
    template_started_at: '2026-09-03T10:00:00.000Z',
    template_completed_at: '2026-09-04T10:00:00.000Z',
  },
  {
    user_id: 'b0000000-0000-4000-8000-000000000002',
    status: 'template_started',
    linked_at: '2026-09-05T10:00:00.000Z',
    template_started_at: '2026-09-06T10:00:00.000Z',
    template_completed_at: null,
  },
  {
    user_id: 'b0000000-0000-4000-8000-000000000003',
    status: 'linked',
    linked_at: '2026-09-07T10:00:00.000Z',
    template_started_at: null,
    template_completed_at: null,
  },
];

test('the dashboard shows the real referral code, profile, counts and referral rows', () => {
  const html = render(
    React.createElement(GrowthPartnerDashboard, {
      partner: PARTNER_ROW,
      referrals: DASHBOARD_ROWS,
      displayName: 'Partner Anita',
      email: 'anita@example.com',
    })
  );
  // 4. Correct referral code displayed, read-only (code element + copy, no input).
  assert.match(html, /ALPHA01/);
  assert.match(html, /Your referral code/);
  assert.match(html, /cannot be changed here/);
  assert.doesNotMatch(html, /<input/);
  // Profile information + status.
  assert.match(html, /Partner Anita/);
  assert.match(html, /anita@example\.com/);
  assert.match(html, /Active/);
  // 5. Counts from the partner's own rows: 3 total, 2 onboarding, 1 completed.
  assert.match(html, /Total referred/);
  assert.match(html, /Onboarding now/);
  assert.match(html, />3</);
  assert.match(html, />2</);
  assert.match(html, />1</);
  assert.match(html, /Completed/);
  // Referral rows carry status labels, never another partner's code.
  assert.match(html, /Template started/);
  assert.match(html, /Onboarding/);
  assert.doesNotMatch(html, /BETA002/);
});

test('an inactive partner sees a Paused status, not a lockout', () => {
  const html = render(
    React.createElement(GrowthPartnerDashboard, {
      partner: { ...PARTNER_ROW, is_active: false },
      referrals: DASHBOARD_ROWS,
      displayName: 'Partner Anita',
      email: 'anita@example.com',
    })
  );
  assert.match(html, /Paused/);
  assert.match(html, /currently paused/);
  assert.match(html, /ALPHA01/);
});

test('7. the empty state renders when the partner has no referrals', () => {
  const html = render(
    React.createElement(GrowthPartnerDashboard, {
      partner: PARTNER_ROW,
      referrals: [],
      displayName: 'Partner Anita',
      email: 'anita@example.com',
    })
  );
  assert.match(html, new RegExp(GROWTH_PARTNER_EMPTY_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_EMPTY_BODY));
  // Zero counts, still showing the partner's own code.
  assert.match(html, />0</);
  assert.match(html, /ALPHA01/);
});

test('future sections render explicit not-implemented placeholders', () => {
  for (const section of ['referrals', 'customers', 'performance', 'commission'] as const) {
    const html = render(React.createElement(GrowthPartnerComingSoon, { section }));
    assert.match(html, new RegExp(growthPartnerComingSoonTitle(section)));
    assert.match(html, new RegExp(GROWTH_PARTNER_COMING_SOON_BODY));
    assert.match(html, new RegExp(GROWTH_PARTNER_SECTION_LABELS[section]));
    // No fake functionality: no numbers, no tables, no forms.
    assert.doesNotMatch(html, /<table/);
    assert.doesNotMatch(html, /<form/);
  }
});

test('the section navigation lists all five modules with the active one marked', () => {
  const html = render(
    React.createElement(GrowthPartnerSectionTabs, { section: 'referrals', navigate: () => {} })
  );
  for (const label of ['Dashboard', 'Referrals', 'Customers', 'Performance', 'Commission']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /aria-current="page"/);
});

// ---------------------------------------------------------------------------
// Database contract: the UI's exact queries return only the caller's own rows
// ---------------------------------------------------------------------------

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const USER_2 = 'b0000000-0000-4000-8000-000000000002';
const USER_3 = 'b0000000-0000-4000-8000-000000000003';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);

async function setupPopulatedDb() {
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
      ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}'), ('${USER_2}'), ('${USER_3}');
  `);
  await db.exec(MIGRATION);
  // Partner A: two referrals (one completed, one started). Partner B: one linked.
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
  await asUser(db, USER_1, 'select public.link_my_growth_referral($1)', [CODE_A]);
  await asUser(db, USER_1, "select public.update_my_onboarding_progress('start_template')");
  await asUser(db, USER_1, "select public.update_my_onboarding_progress('complete_template')");
  await asUser(db, USER_2, 'select public.link_my_growth_referral($1)', [CODE_A]);
  await asUser(db, USER_2, "select public.update_my_onboarding_progress('start_template')");
  await asUser(db, USER_3, 'select public.link_my_growth_referral($1)', [CODE_B]);
  return db;
}

/** The page's partner-row query (fetchMyGrowthPartnerRow), run as `userId`. */
async function uiPartnerRow(db: any, userId: string) {
  const res = await asUser(
    db,
    userId,
    'select user_id, referral_code, is_active, created_at, updated_at from public.growth_partners'
  );
  return res.rows;
}

/** The page's referral-list query (fetchMyGrowthReferrals), run as `userId`. */
async function uiReferralRows(db: any, userId: string, partnerId: string) {
  const res = await asUser(
    db,
    userId,
    `select user_id, status, linked_at, template_started_at, template_completed_at, growth_partner_id
     from public.growth_onboarding where growth_partner_id = $1::uuid order by linked_at desc`,
    [partnerId]
  );
  return res.rows as GrowthReferralRow[];
}

test('5. referral rows and counts belong only to the authenticated Growth Partner', async () => {
  const db = await setupPopulatedDb();
  try {
    const partnerRows = await uiPartnerRow(db, PARTNER_A);
    assert.equal(partnerRows.length, 1);
    assert.equal(partnerRows[0].referral_code, CODE_A);

    const rows = await uiReferralRows(db, PARTNER_A, PARTNER_A);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.growth_partner_id === PARTNER_A));
    assert.deepEqual(
      rows.map((row) => row.user_id).sort(),
      [USER_1, USER_2]
    );
    // The dashboard reducer sees exactly Partner A's funnel.
    assert.deepEqual(summarizeGrowthReferrals(rows), { total: 2, onboarding: 1, completed: 1 });
  } finally {
    await db.close();
  }
});

test('6. Partner A cannot access Partner B referral data, even with an explicit filter', async () => {
  const db = await setupPopulatedDb();
  try {
    // Partner B sees only their own code and their own single referral.
    const partnerRows = await uiPartnerRow(db, PARTNER_B);
    assert.equal(partnerRows.length, 1);
    assert.equal(partnerRows[0].referral_code, CODE_B);
    const bRows = await uiReferralRows(db, PARTNER_B, PARTNER_B);
    assert.deepEqual(
      bRows.map((row) => row.user_id),
      [USER_3]
    );
    // Partner A asking for B's referrals by id gets zero rows (RLS, not React).
    assert.equal((await uiReferralRows(db, PARTNER_A, PARTNER_B)).length, 0);
    // A normal referred user sees no partner row at all → the unauthorized gate.
    assert.equal((await uiPartnerRow(db, USER_1)).length, 0);
  } finally {
    await db.close();
  }
});

test('the Growth Partner page never references the service role', () => {
  for (const file of ['../src/components/GrowthPartnerPage.tsx', '../src/lib/growthPartner.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE|getSupabaseAdmin|supabaseAdmin/);
  }
  const pageSrc = readFileSync(new URL('../src/components/GrowthPartnerPage.tsx', import.meta.url), 'utf8');
  assert.match(pageSrc, /from '\.\.\/lib\/growthPartner'/);
});
