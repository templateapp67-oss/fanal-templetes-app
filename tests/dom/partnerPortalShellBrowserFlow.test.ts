// ============================================================================
// Partner portal SHELL (PART 2.2) — DOM-level click verification.
//
// A real Chromium cannot be installed in this sandbox, so this file mounts the
// REAL GrowthPartnerPage (partner namespace) with react-dom/client into jsdom,
// dispatches REAL click/key events and answers the page's REAL Supabase REST
// calls with a stubbed fetch (the exact RPC routes the UI uses). It proves:
//
//   • /partner/dashboard boots through the real gate (get_my_growth_partner)
//     and renders the shell: sidebar + header + KPI content from the backend;
//   • sidebar navigation drives the SPA (My Referral Code → /partner/referral-code,
//     Referred Users, Referral Status → KPI chips + list RPC) and the URL map
//     matches the shell's menu;
//   • the mobile drawer works: hamburger opens, backdrop + Escape close, a nav
//     tap navigates AND closes the drawer;
//   • Logout fires the real logout action from the sidebar and the header;
//   • a partner share link (?ref=CODE) pre-fills the onboarding referral code
//     input via the same capture the app uses.
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';
import { PARTNER_DASHBOARD_PATH } from '../../src/lib/router';
import { readSharedReferralCode } from '../../src/onboarding/OnboardingApp';
import { ReferralScreen } from '../../src/onboarding/screens/ReferralScreen';
import type { PartnerDashboardData } from '../../src/lib/growthPartner';

// Close the jsdom window once the file is done. No process.exit(): it truncates
// the TAP stream and silently drops the last test's result.
after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

const PARTNER_ID = 'a0000000-0000-4000-8000-000000000001';

const PARTNER_ROW = {
  user_id: PARTNER_ID,
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const REFERRAL_ROWS = [
  {
    ref: '…00000001',
    display_name: 'User One',
    linked_at: '2026-09-04T10:00:00Z',
    status: 'template_completed',
    template_started_at: '2026-09-05T10:00:00Z',
    template_completed_at: '2026-09-06T10:00:00Z',
  },
  {
    ref: '…00000002',
    display_name: null,
    linked_at: '2026-09-06T10:00:00Z',
    status: 'template_started',
    template_started_at: '2026-09-07T10:00:00Z',
    template_completed_at: null,
  },
];

const REFERRAL_LIST = { total: 2, limit: 20, offset: 0, rows: REFERRAL_ROWS };

const DASHBOARD: PartnerDashboardData = {
  partner: { referral_code: 'ALPHA01', is_active: true, partner_since: '2026-09-01T00:00:00Z' },
  kpis: { total_referrals: 2, active_onboarding: 1, completed: 1 },
  recent_activity: [
    { type: 'referral_added', ref: '…00000002', display_name: null, at: '2026-09-06T10:00:00Z' },
  ],
};

/**
 * Answer the Supabase REST routes the page really calls. Every response is a
 * realistic PostgREST reply for the page's RPCs; anything unexpected fails the
 * request so a stray call can never silently pass.
 */
function stubSupabaseFetch(): () => void {
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input.url);
    const rpc =
      url.includes('/rest/v1/rpc/get_my_growth_partner')
        ? 'get_my_growth_partner'
        : url.includes('/rest/v1/rpc/get_my_partner_dashboard')
          ? 'get_my_partner_dashboard'
          : url.includes('/rest/v1/rpc/get_my_partner_referrals')
            ? 'get_my_partner_referrals'
            : null;
    if (!rpc) {
      return new Response(JSON.stringify({ message: `unexpected request: ${url}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const payload =
      rpc === 'get_my_growth_partner'
        ? PARTNER_ROW
        : rpc === 'get_my_partner_dashboard'
          ? DASHBOARD
          : REFERRAL_LIST;
    // The referrals RPC must receive its server-side params (p_status_filter
    // etc.) as a posted body — assert the real call shape.
    if (rpc === 'get_my_partner_referrals') {
      assert.ok(typeof init?.body === 'string' && init.body.length > 0, 'referrals RPC params are posted');
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => {
    (globalThis as any).fetch = realFetch;
  };
}

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

async function click(el: Element | null, what = 'element') {
  assert.ok(el, `expected to find ${what} in the DOM`);
  await act(() => {
    (el as HTMLElement).click();
  });
}

async function pressEscape() {
  await act(() => {
    document.dispatchEvent(
      new (globalThis as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });
}

/** Wait (bounded) until the predicate holds — effects resolve on their own. */
async function waitFor(predicate: () => boolean, what: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), `timed out waiting for ${what}`);
}

const byData = (attr: string, value: string) =>
  [...document.querySelectorAll(`[data-${attr}]`)].filter(
    (el) => el.getAttribute(`data-${attr}`) === value
  );

const byText = (selector: string, text: string) =>
  [...document.querySelectorAll(selector)].find((el) => (el.textContent || '').trim().includes(text));

/**
 * Mount the page as the app does: path + navigate wired together so a nav
 * click really re-renders the page at the new URL (an SPA, not a static prop).
 */
async function mountPortalApp(startPath: string, onLogout: () => void) {
  const navigated: string[] = [];
  let currentPath = startPath;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const renderAt = (path: string) =>
    React.createElement(GrowthPartnerPage, {
      user: { id: PARTNER_ID, email: 'meera@example.com', user_metadata: { full_name: 'Meera Partner' } },
      path,
      navigate: (to: string) => {
        navigated.push(to);
        currentPath = to;
      },
      onLogout,
      accentHex: '#C20E5A',
    } as any);
  const rerender = async () => {
    await act(() => root.render(renderAt(currentPath)));
  };
  await rerender();
  return {
    container,
    navigated,
    rerender,
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Full flow: boot /partner/dashboard through the real gate + RPCs
// ---------------------------------------------------------------------------

test('the dashboard boots through the real gate and renders the shell with backend data', async () => {
  const restoreFetch = stubSupabaseFetch();
  let loggedOut = 0;
  const app = await mountPortalApp(PARTNER_DASHBOARD_PATH, () => {
    loggedOut += 1;
  });
  try {
    await waitFor(() => !!document.querySelector('[data-partner-nav="dashboard"]'), 'the shell to render');

    // The shell: sidebar brand, header title, identity.
    assert.ok(byText('p', 'Nexora'), 'the sidebar brand renders');
    assert.ok(byText('h1', 'Dashboard'), 'the header title renders');
    const profileButton = document.querySelector('[data-partner-profile-button]');
    assert.ok(profileButton, 'the profile (avatar) button renders');
    assert.ok((profileButton!.textContent || '').includes('Meera Partner'), 'the partner name renders');
    assert.ok(
      (profileButton!.textContent || '').includes('a0000000…0001'),
      'the compact partner id renders next to the name'
    );
    assert.match(
      profileButton!.querySelector('span[title]')?.getAttribute('title') || '',
      /^Partner ID: a0000000-0000-4000-8000-000000000001$/,
      'the full partner id is available on the identity block'
    );
    assert.ok(document.querySelector('[data-partner-notifications]'), 'the notifications bell renders');
    assert.ok(document.querySelector('[data-partner-mobile-logo]'), 'the mobile header logo renders');

    // Backend KPIs (get_my_partner_dashboard) surface in the content.
    await waitFor(() => !!byText('*', 'Total Referrals'), 'the dashboard KPIs');
    assert.ok(byText('*', 'Completed Customers'), 'server counts render');

    // The menu: exactly the required live entries, active one marked.
    for (const [key, label] of [
      ['dashboard', 'Dashboard'],
      ['referral-code', 'My Referral Code'],
      ['referred-users', 'Referred Users'],
      ['referral-status', 'Referral Status'],
      ['profile', 'Profile'],
    ] as const) {
      const items = byData('partner-nav', key);
      assert.ok(items.length >= 2, `${label} renders in sidebar + drawer`);
    }
    const active = byData('partner-nav', 'dashboard').find((el) => el.getAttribute('aria-current') === 'page');
    assert.ok(active, 'Dashboard is the active section');

    // Future modules are visible slots with a Soon badge, never links.
    const earnings = byData('partner-planned', 'earnings');
    assert.ok(earnings.length >= 2, 'Earnings has a sidebar + drawer slot');
    assert.ok((earnings[0].textContent || '').includes('Soon'));
    assert.equal(earnings[0].querySelector('a,button'), null, 'a planned slot is not clickable');
  } finally {
    await app.unmount();
    restoreFetch();
  }
});

test('sidebar navigation drives the SPA: My Referral Code shows the code and the share link', async () => {
  const restoreFetch = stubSupabaseFetch();
  const app = await mountPortalApp(PARTNER_DASHBOARD_PATH, () => {});
  try {
    await waitFor(() => !!document.querySelector('[data-partner-nav="referral-code"]'), 'the shell to render');

    // Click "My Referral Code" in the desktop sidebar.
    await click(byData('partner-nav', 'referral-code')[0], 'the My Referral Code nav item');
    assert.deepEqual(
      app.navigated.slice(-1),
      ['/partner/referral-code'],
      'the nav item navigates to the canonical section URL'
    );
    // The app-level router would re-render at that URL — simulate it.
    await app.rerender();

    await waitFor(() => !!document.querySelector('[data-referral-code]'), 'the referral code page');
    const code = document.querySelector('[data-referral-code]');
    assert.equal(code?.getAttribute('data-referral-code'), 'ALPHA01', 'the partner row code is displayed');
    assert.ok(byText('h1', 'My Referral Code'), 'the header follows the section');
    const shareInput = document.querySelector('input[aria-label="Your referral link"]') as HTMLInputElement | null;
    assert.ok(shareInput, 'the share link input renders');
    assert.equal(shareInput!.value, 'http://localhost:3000/onboarding/referral?ref=ALPHA01');

    // Referred Users renders the real roll (rpc get_my_partner_referrals).
    await click(byData('partner-nav', 'referred-users')[0], 'the Referred Users nav item');
    await app.rerender();
    await waitFor(() => !!byText('h2', 'Referred Users'), 'the referred users page');
    assert.ok(byText('*', 'User One'), 'a referred user from the backend list renders');

    // Referral Status renders KPI chips + legend + the same list, filtered.
    await click(byData('partner-nav', 'referral-status')[0], 'the Referral Status nav item');
    await app.rerender();
    await waitFor(() => !!byText('h2', 'What each status means'), 'the referral status page');
    assert.ok(byText('*', 'In Progress'), 'the KPI chip renders');
    assert.ok(byText('*', 'Search by customer name') || !!document.querySelector('input[type="search"]'), 'the search box renders');
  } finally {
    await app.unmount();
    restoreFetch();
  }
});

test('the mobile drawer opens via the hamburger, closes via backdrop and Escape, and navigates', async () => {
  const restoreFetch = stubSupabaseFetch();
  const app = await mountPortalApp(PARTNER_DASHBOARD_PATH, () => {});
  try {
    await waitFor(() => !!document.querySelector('[data-partner-nav-toggle]'), 'the hamburger');
    const toggle = () => document.querySelector('[data-partner-nav-toggle]') as HTMLButtonElement | null;
    const drawer = () => document.querySelector('[data-partner-drawer]') as HTMLElement | null;

    assert.equal(toggle()!.getAttribute('aria-expanded'), 'false', 'drawer starts closed');
    assert.ok(drawer()!.className.includes('-translate-x-full'), 'closed drawer is off-canvas');
    assert.equal(document.querySelector('[data-partner-nav-backdrop]'), null, 'no backdrop while closed');

    // Open.
    await click(toggle(), 'the hamburger');
    assert.equal(toggle()!.getAttribute('aria-expanded'), 'true');
    assert.ok(drawer()!.className.includes('translate-x-0'), 'the drawer slides in');
    assert.ok(document.querySelector('[data-partner-nav-backdrop]'), 'the backdrop appears');

    // Escape closes.
    await pressEscape();
    assert.equal(toggle()!.getAttribute('aria-expanded'), 'false');
    assert.ok(drawer()!.className.includes('-translate-x-full'));
    assert.equal(document.querySelector('[data-partner-nav-backdrop]'), null, 'backdrop removed on close');

    // Reopen, then a nav tap inside the drawer navigates AND closes it.
    await click(toggle(), 'the hamburger');
    assert.equal(toggle()!.getAttribute('aria-expanded'), 'true');
    const drawerProfile = drawer()!.querySelector('[data-partner-nav="profile"]');
    await click(drawerProfile, 'the Profile item inside the drawer');
    assert.deepEqual(app.navigated.slice(-1), ['/partner/profile']);
    assert.equal(toggle()!.getAttribute('aria-expanded'), 'false', 'navigating closes the drawer');

    // The close (X) button works too.
    await click(toggle(), 'the hamburger');
    await click(document.querySelector('[data-partner-nav-close]'), 'the drawer close button');
    assert.equal(toggle()!.getAttribute('aria-expanded'), 'false');
  } finally {
    await app.unmount();
    restoreFetch();
  }
});

test('the profile dropdown opens, navigates to My Profile and logs out', async () => {
  const restoreFetch = stubSupabaseFetch();
  let loggedOut = 0;
  const app = await mountPortalApp(PARTNER_DASHBOARD_PATH, () => {
    loggedOut += 1;
  });
  try {
    await waitFor(() => !!document.querySelector('[data-partner-profile-button]'), 'the header to render');
    const button = () => document.querySelector('[data-partner-profile-button]') as HTMLButtonElement | null;
    assert.equal(button()!.getAttribute('aria-expanded'), 'false', 'dropdown starts closed');
    assert.equal(document.querySelector('[data-partner-profile-menu]'), null, 'no menu rendered while closed');

    // Open the dropdown from the avatar.
    await click(button(), 'the profile button');
    assert.equal(button()!.getAttribute('aria-expanded'), 'true');
    const menu = document.querySelector('[data-partner-profile-menu]');
    assert.ok(menu, 'the profile menu renders');
    // User card: real identity + the full partner id.
    assert.ok((menu!.textContent || '').includes('Meera Partner'), 'the name is in the user card');
    assert.ok((menu!.textContent || '').includes('meera@example.com'), 'the email is in the user card');
    assert.ok((menu!.textContent || '').includes(PARTNER_ID), 'the full partner id is in the user card');
    // Account Settings is an honest "Soon" slot, not a fake link.
    const settings = menu!.querySelector('[data-partner-menu-item="account-settings"]');
    assert.ok(settings, 'Account Settings has a slot');
    assert.equal(settings!.getAttribute('aria-disabled'), 'true');
    assert.equal(settings!.querySelector('a,button'), null, 'the planned slot is not clickable');
    assert.ok((settings!.textContent || '').includes('Soon'));

    // My Profile navigates to the profile section and closes the menu.
    await click(menu!.querySelector('[data-partner-menu-item="profile"]'), 'the My Profile item');
    assert.deepEqual(app.navigated.slice(-1), ['/partner/profile']);
    assert.equal(button()!.getAttribute('aria-expanded'), 'false', 'navigating closes the dropdown');

    // Reopen; the dropdown Logout runs the real action.
    await click(button(), 'the profile button');
    await click(
      document.querySelector('[data-partner-profile-menu] [data-partner-logout]'),
      'the dropdown logout'
    );
    assert.equal(loggedOut, 1);
    assert.equal(button()!.getAttribute('aria-expanded'), 'false', 'logging out closes the dropdown');

    // Backdrop and Escape close it too.
    await click(button(), 'the profile button');
    await click(document.querySelector('[data-partner-menu-backdrop]'), 'the menu backdrop');
    assert.equal(button()!.getAttribute('aria-expanded'), 'false');
    await click(button(), 'the profile button');
    await pressEscape();
    assert.equal(button()!.getAttribute('aria-expanded'), 'false');
  } finally {
    await app.unmount();
    restoreFetch();
  }
});

test('the notifications dropdown shows the real recent-activity feed', async () => {
  const restoreFetch = stubSupabaseFetch();
  const app = await mountPortalApp(PARTNER_DASHBOARD_PATH, () => {});
  try {
    await waitFor(() => !!document.querySelector('[data-partner-notifications]'), 'the bell');
    // Wait for the dashboard RPC (it feeds both the KPIs and the bell panel).
    await waitFor(() => !!byText('*', 'Total Referrals'), 'the dashboard data');

    const bell = () => document.querySelector('[data-partner-notifications]') as HTMLButtonElement | null;
    assert.equal(bell()!.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[data-partner-notifications-panel]'), null, 'no panel while closed');

    await click(bell(), 'the notifications bell');
    assert.equal(bell()!.getAttribute('aria-expanded'), 'true');
    const panel = document.querySelector('[data-partner-notifications-panel]');
    assert.ok(panel, 'the notifications panel renders');
    assert.ok((panel!.textContent || '').includes('Recent activity from your referrals'));
    // The feed is the backend's recent_activity — labels + masked refs, real data.
    assert.ok((panel!.textContent || '').includes('New referral added'), 'real activity label from the RPC');
    assert.ok((panel!.textContent || '').includes('Referred user …00000002'), 'the referred user (masked ref)');

    // Backdrop closes the dropdown.
    await click(document.querySelector('[data-partner-menu-backdrop]'), 'the menu backdrop');
    assert.equal(bell()!.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[data-partner-notifications-panel]'), null, 'panel removed on close');
  } finally {
    await app.unmount();
    restoreFetch();
  }
});

test('Logout fires the real logout action from both the sidebar and the header', async () => {
  const restoreFetch = stubSupabaseFetch();
  let loggedOut = 0;
  const app = await mountPortalApp(PARTNER_DASHBOARD_PATH, () => {
    loggedOut += 1;
  });
  try {
    await waitFor(() => !!document.querySelector('[data-partner-logout]'), 'the logout buttons');
    // Sidebar/footer logout (renders in sidebar + drawer) and the header icon.
    const logoutButtons = document.querySelectorAll('[data-partner-logout]');
    assert.ok(logoutButtons.length >= 3, 'logout in sidebar, drawer and header');
    await click(logoutButtons[0], 'the sidebar logout');
    assert.equal(loggedOut, 1);
    await click(document.querySelector('[data-partner-nav-toggle]'), 'the hamburger');
    await click(document.querySelector('[data-partner-drawer] [data-partner-logout]'), 'the drawer logout');
    assert.equal(loggedOut, 2);
    await click(document.querySelector('header [data-partner-logout]'), 'the header logout');
    assert.equal(loggedOut, 3);
  } finally {
    await app.unmount();
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// The share link pre-fills the onboarding referral screen
// ---------------------------------------------------------------------------

test('a partner share link (?ref=CODE) pre-fills the onboarding referral code input', async () => {
  // The app captures ?ref= once, before any login redirect drops the query.
  const initialUrl = window.location.href;
  window.history.replaceState(null, '', '/onboarding/referral?ref=ALPHA01');
  try {
    assert.equal(readSharedReferralCode(), 'ALPHA01', 'the ?ref parameter is captured');
    assert.equal(readSharedReferralCode(), 'ALPHA01', 'and it is a pure read — no consumption');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(() =>
      root.render(
        React.createElement(ReferralScreen, { email: 'newbie@example.com', initialCode: readSharedReferralCode() })
      )
    );
    try {
      const input = document.getElementById('onboarding-referral-code') as HTMLInputElement | null;
      assert.ok(input, 'the referral code input renders');
      assert.equal(input!.value, 'ALPHA01', 'the shared code pre-fills the input');

      // No link → no capture (the normal direct visit).
      window.history.replaceState(null, '', '/onboarding/referral');
      assert.equal(readSharedReferralCode(), '');
    } finally {
      await act(() => root.unmount());
      container.remove();
    }
  } finally {
    window.history.replaceState(null, '', initialUrl);
  }
});
