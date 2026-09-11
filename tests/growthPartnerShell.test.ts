// ============================================================================
// PART 2.2 ACCEPTANCE — Growth Partner Dashboard SHELL.
//
//   • Route: /growth-partner resolves to the dashboard; the login route and
//     the area are the SAME namespace, no duplicate route.
//   • Access matrix (backend-driven, no frontend trust):
//       active partner      → ready (shell renders)
//       normal user         → unauthorized (denied)
//       unauthenticated     → login redirect
//       inactive partner    → denied (account/data untouched)
//   • Shell: header (back + title + basic partner identity + logout action),
//     navigation area (section tabs) and a main content slot.
//   • Session lifecycle: refresh restores the session (dashboard stays);
//     logout clears it (dashboard becomes inaccessible → login).
//   • Responsive: the shell and navigation use the existing responsive
//     utilities (wrapping header row + horizontally scrolling tabs).
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GROWTH_PARTNER_LOGIN_PATH,
  GROWTH_PARTNER_PATH,
  GROWTH_PARTNER_SECTIONS,
  growthPartnerLoginPath,
  growthPartnerPath,
  isGrowthPartnerLoginPath,
  isGrowthPartnerPath,
  matchGrowthPartnerRoute,
} from '../src/lib/router';
import {
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  resolveGrowthPartnerGate,
} from '../src/lib/growthPartner';
import {
  loadGrowthPartnerSession,
  resolveGrowthPartnerLogin,
  shouldRedirectToGrowthPartnerLogin,
  signOutGrowthPartner,
  type GrowthPartnerAuthClient,
} from '../src/lib/growthPartnerLogin';
import {
  GROWTH_PARTNER_SECTION_LABELS,
  GROWTH_PARTNER_UNAUTHORIZED_BODY,
  GROWTH_PARTNER_UNAUTHORIZED_TITLE,
  GrowthPartnerInactive,
  GrowthPartnerPage,
  GrowthPartnerSectionTabs,
  GrowthPartnerShell,
  GrowthPartnerUnauthorized,
} from '../src/components/GrowthPartnerPage';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';

const ROW_ACTIVE = {
  user_id: PARTNER_A,
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};
const ROW_INACTIVE = { ...ROW_ACTIVE, user_id: PARTNER_B, referral_code: 'BETA002', is_active: false };

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ---------------------------------------------------------------------------
// 1. Route
// ---------------------------------------------------------------------------

test('1. /growth-partner is the dashboard route and the login route shares the namespace', () => {
  assert.equal(GROWTH_PARTNER_PATH, '/growth-partner');
  assert.equal(growthPartnerPath('dashboard'), '/growth-partner');
  assert.equal(matchGrowthPartnerRoute('/growth-partner'), 'dashboard');
  assert.equal(isGrowthPartnerPath('/growth-partner'), true);
  assert.equal(isGrowthPartnerPath('/growth-partner/dashboard'), true);
  assert.equal(isGrowthPartnerLoginPath(GROWTH_PARTNER_LOGIN_PATH), true);
  assert.equal(isGrowthPartnerPath(GROWTH_PARTNER_LOGIN_PATH), true);
  assert.equal(growthPartnerLoginPath(), '/growth-partner/login');
});

// ---------------------------------------------------------------------------
// 2. Access matrix (backend row → gate, never frontend state)
// ---------------------------------------------------------------------------

const gateFor = (patch: Record<string, any> = {}) =>
  resolveGrowthPartnerGate({
    userId: PARTNER_A,
    loading: false,
    isMockMode: false,
    partnerRow: ROW_ACTIVE,
    loadError: null,
    ...patch,
  });

test('access: active partner opens the dashboard, everyone else is denied', () => {
  // Active Growth Partner → ready (the shell renders).
  assert.equal(gateFor(), 'ready');
  // Normal user (RLS returns zero rows) → unauthorized.
  assert.equal(gateFor({ userId: USER_1, partnerRow: null }), 'unauthorized');
  // Unauthenticated → login (redirect target is the login route).
  assert.equal(gateFor({ userId: null }), 'unauthenticated');
  assert.equal(shouldRedirectToGrowthPartnerLogin('unauthenticated', GROWTH_PARTNER_PATH), true);
  assert.equal(shouldRedirectToGrowthPartnerLogin('unauthenticated', GROWTH_PARTNER_LOGIN_PATH), false);
  // Inactive partner → denied (never admitted).
  assert.equal(gateFor({ userId: PARTNER_B, partnerRow: ROW_INACTIVE }), 'inactive');
  // The login resolver agrees with the area gate.
  assert.equal(
    resolveGrowthPartnerLogin({
      loading: false,
      isMockMode: false,
      userId: PARTNER_B,
      partnerRow: ROW_INACTIVE,
      loadError: null,
    }),
    'inactive'
  );
});

// ---------------------------------------------------------------------------
// 3. The shell layout (header + title + identity + nav + main + logout)
// ---------------------------------------------------------------------------

test('the shell renders the header, partner title, identity, navigation and main content', () => {
  const html = render(
    React.createElement(GrowthPartnerShell, {
      section: 'dashboard',
      displayName: 'Partner Anita',
      navigate: () => {},
      onBack: () => {},
      onLogout: () => {},
    }, 'Main content area')
  );
  // Header + partner area title.
  assert.match(html, /Growth Partner/);
  assert.match(html, /<h1[^>]*>Growth Partner<\/h1>/);
  // Basic partner identity (no statistics).
  assert.match(html, /Partner Anita/);
  assert.match(html, /Signed in as/);
  // Navigation area: every section tab present, active one marked.
  for (const label of Object.values(GROWTH_PARTNER_SECTION_LABELS)) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /aria-current="page"/);
  // Logout action.
  assert.match(html, /Log out/);
  assert.match(html, /title="Log out"/);
  // Main content slot.
  assert.match(html, /Main content area/);
  // Back link.
  assert.match(html, /Back to dashboard/);
});

test('the shell never renders partner statistics or referral data', () => {
  const html = render(
    React.createElement(GrowthPartnerShell, {
      section: 'dashboard',
      displayName: 'Partner Anita',
    }, 'Content')
  );
  assert.doesNotMatch(html, /Total Referrals/);
  assert.doesNotMatch(html, /Active Onboarding/);
  assert.doesNotMatch(html, /ALPHA01/);
});

test('the logout action is only present for the authenticated shell (not denied states)', () => {
  const shell = render(
    React.createElement(GrowthPartnerShell, {
      section: 'dashboard',
      displayName: 'Partner Anita',
      onLogout: () => {},
    }, 'Content')
  );
  assert.match(shell, /Log out/);

  // A normal user's unauthorized card and an inactive partner's card have no
  // shell (and therefore no logout), and never show partner data.
  const unauthorized = render(React.createElement(GrowthPartnerUnauthorized, { onBack: () => {} }));
  assert.match(unauthorized, new RegExp(GROWTH_PARTNER_UNAUTHORIZED_TITLE));
  assert.match(unauthorized, new RegExp(GROWTH_PARTNER_UNAUTHORIZED_BODY));
  assert.doesNotMatch(unauthorized, /Log out/);
  assert.doesNotMatch(unauthorized, /Your referral code/);

  const inactive = render(React.createElement(GrowthPartnerInactive, { onBack: () => {} }));
  assert.match(inactive, new RegExp(GROWTH_PARTNER_INACTIVE_TITLE));
  assert.match(inactive, new RegExp(GROWTH_PARTNER_INACTIVE_BODY));
  assert.doesNotMatch(inactive, /Log out/);
  assert.doesNotMatch(inactive, /Your referral code/);
});

test('the page container renders a loading state on first paint, never a blank screen', () => {
  const html = render(
    React.createElement(GrowthPartnerPage, { user: { id: 'u-1' }, path: '/growth-partner' } as any)
  );
  assert.match(html, /Loading your partner area/);
});

// ---------------------------------------------------------------------------
// 4. Session lifecycle (refresh keeps access; logout removes it)
// ---------------------------------------------------------------------------

function sessionClient(sessionUserId: string | null): GrowthPartnerAuthClient {
  return {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({
        data: {
          session: sessionUserId
            ? { user: { id: sessionUserId, email: 'anita@example.com' } }
            : null,
        },
        error: null,
      }),
    },
  };
}

test('5. refresh restores the session and the dashboard stays accessible', async () => {
  const viewer = await loadGrowthPartnerSession(sessionClient(PARTNER_A));
  assert.deepEqual(viewer, { id: PARTNER_A, email: 'anita@example.com' });
  // The restored session plus the active backend row → ready (shell).
  assert.equal(
    resolveGrowthPartnerGate({
      userId: viewer?.id ?? null,
      loading: false,
      isMockMode: false,
      partnerRow: ROW_ACTIVE,
      loadError: null,
    }),
    'ready'
  );
});

test('6. logout clears the session and the dashboard becomes inaccessible', async () => {
  let signedOut = false;
  const client: GrowthPartnerAuthClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => {
        signedOut = true;
        return { error: null };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  };
  await signOutGrowthPartner(client);
  assert.equal(signedOut, true);
  const viewer = await loadGrowthPartnerSession(client);
  assert.equal(viewer, null);
  // No session → unauthenticated → redirect to the login route.
  assert.equal(
    resolveGrowthPartnerGate({
      userId: null,
      loading: false,
      isMockMode: false,
      partnerRow: null,
      loadError: null,
    }),
    'unauthenticated'
  );
  assert.equal(shouldRedirectToGrowthPartnerLogin('unauthenticated', GROWTH_PARTNER_PATH), true);
});

// ---------------------------------------------------------------------------
// 5. Responsive (desktop / tablet / mobile)
// ---------------------------------------------------------------------------

test('7. the shell uses the existing responsive utilities and never a fixed width', () => {
  const html = render(
    React.createElement(GrowthPartnerShell, {
      section: 'referrals',
      displayName: 'Partner Anita',
      navigate: () => {},
      onLogout: () => {},
    }, 'Content')
  );
  // Fluid container (max-width + padding), wrapping header row.
  assert.match(html, /max-w-6xl mx-auto px-4/);
  assert.match(html, /flex flex-wrap/);
  // The navigation area scrolls horizontally on narrow screens (tabs shrink-0).
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /shrink-0/);
  // No hard-coded pixel width that would break a mobile viewport.
  assert.doesNotMatch(html, /w-\[[0-9]+px\]/);

  // Tabs alone (the navigation area) render the same scrollable layout.
  const tabs = render(
    React.createElement(GrowthPartnerSectionTabs, { section: 'referrals', navigate: () => {} })
  );
  assert.match(tabs, /overflow-x-auto/);
  for (const label of ['Dashboard', 'Referrals', 'Customers', 'Performance', 'Commission', 'Profile']) {
    assert.match(tabs, new RegExp(label));
  }
});

// ---------------------------------------------------------------------------
// 6. Static: the shell reuses the single guard, never a second auth system
// ---------------------------------------------------------------------------

test('the shell and page share the single gate resolver and never reference the service role', () => {
  const src = readFileSync(new URL('../src/components/GrowthPartnerPage.tsx', import.meta.url), 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  // One gate, one row lookup — no second authorization guard.
  assert.match(src, /resolveGrowthPartnerGate/);
  assert.match(src, /fetchMyGrowthPartnerRow/);
  assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE|getSupabaseAdmin|supabaseAdmin/);
  // No frontend role/storage/URL trust in the page.
  assert.doesNotMatch(codeOnly, /localStorage|sessionStorage|URLSearchParams|searchParams/i);
  // The navigation is the single GROWTH_PARTNER_SECTIONS source.
  assert.match(src, /GROWTH_PARTNER_SECTIONS\.map/);
});
