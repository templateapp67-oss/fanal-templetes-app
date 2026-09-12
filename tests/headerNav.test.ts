// ============================================================================
// Global header navigation — Growth Partner entry.
//
//   • The header's view switcher exposes the Growth Partner area next to the
//     other surfaces, for signed-in and signed-out visitors alike (the page
//     itself decides sign-in / partner-only / ready).
//   • It is reachable at every width: the desktop pill row (`lg` and up) and
//     the mobile menu below `lg` are rendered from the same entry list, so a
//     narrow viewport cannot silently drop a surface.
//   • The entry is highlighted (and marked `aria-current="page"`) only while
//     the Growth Partner view is the current one.
//   • Clicking it goes through the same routing as every other entry:
//     `setCurrentView('growthPartner')` → `/partner/dashboard` (the PART 2
//     canonical portal route; the legacy `/growth-partner` alias keeps
//     working), which the router resolves back to the dashboard section on
//     refresh/deep links.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HEADER_NAV_ENTRIES, Header, isHeaderNavEntryActive } from '../src/components/Header';
import {
  GROWTH_PARTNER_PATH,
  isGrowthPartnerPath,
  isPartnerLoginPath,
  isPartnerPortalPath,
  matchGrowthPartnerRoute,
  matchPartnerPortalRoute,
  PARTNER_DASHBOARD_PATH,
  PARTNER_LOGIN_PATH,
  partnerPortalPath,
} from '../src/lib/router';
import type { AppView } from '../src/types';

const GROWTH_PARTNER_VIEWS: AppView[] = [
  'landing',
  'wizard',
  'preview',
  'dashboard',
  'staffPerformance',
  'staffCommission',
  'growthPartner',
  'bookings',
  'bookingDetail',
];

function renderHeader(currentView: AppView, user: any = { id: 'u1', email: 'owner@testsalon.com' }): string {
  return renderToStaticMarkup(
    React.createElement(Header, {
      currentView,
      setCurrentView: () => {},
      salonName: 'Test Salon',
      user,
      setUser: () => {},
      profile: { ownerName: 'Test Owner', ownerPhotoUrl: '' } as any,
      onProfileSaved: () => {},
      openAuth: () => {},
    } as any),
  );
}

/** Buttons do not nest, so splitting on the opening tag isolates each one. */
function buttonChunks(html: string): string[] {
  return html
    .split('<button')
    .slice(1)
    .map((chunk) => chunk.split('</button>')[0]);
}

function buttonsFor(html: string, label: string): string[] {
  const found = buttonChunks(html).filter((button) => button.includes(label));
  assert.ok(found.length > 0, `the header must render a "${label}" entry`);
  return found;
}

/** The desktop pill row: the first `<nav>` in the header. */
function desktopNav(html: string): string {
  const start = html.indexOf('<nav');
  const end = html.indexOf('</nav>');
  assert.ok(start >= 0 && end > start, 'the header must render its navigation');
  return html.slice(start, end);
}

/** The collapsible menu shown below the `lg` breakpoint. */
function mobileMenu(html: string): string {
  const start = html.indexOf('id="global-nav-mobile"');
  assert.ok(start >= 0, 'the header must render the mobile menu');
  return html.slice(start, html.indexOf('</header>'));
}

test('1. the shared entry list carries the Growth Partner area', () => {
  const labels = HEADER_NAV_ENTRIES.map((entry) => entry.label);
  assert.deepEqual(labels, [
    'Home',
    'Explore Templates',
    'SaaS Dashboard',
    'Growth Partner',
    'My Bookings',
  ]);

  const entry = HEADER_NAV_ENTRIES.find((item) => item.view === 'growthPartner');
  assert.ok(entry, 'an entry must switch to the growthPartner view');
  assert.equal(entry.label, 'Growth Partner');
  assert.equal(entry.icon, 'handshake');
});

test('2. only the Growth Partner view activates the entry', () => {
  const entry = HEADER_NAV_ENTRIES.find((item) => item.view === 'growthPartner');
  assert.ok(entry);
  for (const view of GROWTH_PARTNER_VIEWS) {
    assert.equal(
      isHeaderNavEntryActive(entry, view),
      view === 'growthPartner',
      `${view} must not activate the Growth Partner entry`,
    );
  }
  // The other surfaces keep their own active states.
  const dashboard = HEADER_NAV_ENTRIES.find((item) => item.view === 'dashboard');
  assert.ok(dashboard && isHeaderNavEntryActive(dashboard, 'staffCommission'));
});

test('3. both layouts render the entry, in the same order', () => {
  const html = renderHeader('landing');
  const nav = desktopNav(html);
  const menu = mobileMenu(html);

  assert.ok(nav.includes('Growth Partner'), 'the desktop nav must show the entry');
  assert.ok(nav.includes('handshake'), 'the desktop nav must use the handshake icon');
  assert.ok(menu.includes('Growth Partner'), 'the mobile menu must show the entry');
  assert.ok(menu.includes('handshake'), 'the mobile menu must use the handshake icon');

  const labels = HEADER_NAV_ENTRIES.map((entry) => entry.label);
  for (const block of [nav, menu]) {
    let last = -1;
    for (const label of labels) {
      const at = block.indexOf(label);
      assert.ok(at > last, `"${label}" must follow the previous entry`);
      last = at;
    }
  }
});

test('4. the entry is highlighted only on the growthPartner view', () => {
  const active = buttonsFor(renderHeader('growthPartner'), 'Growth Partner');
  assert.equal(active.length, 2, 'desktop nav + mobile menu');
  for (const button of active) {
    assert.equal(button.includes('bg-[#C20E5A]'), true, 'active entry uses the accent pill');
    assert.equal(button.includes('aria-current="page"'), true);
  }

  for (const view of ['landing', 'dashboard', 'bookings'] as AppView[]) {
    for (const button of buttonsFor(renderHeader(view), 'Growth Partner')) {
      assert.equal(button.includes('bg-[#C20E5A]'), false, `${view} must not highlight the entry`);
      assert.equal(button.includes('aria-current'), false);
    }
  }
});

test('5. the entry is shown to signed-out visitors too', () => {
  const html = renderHeader('landing', null);
  assert.ok(desktopNav(html).includes('Growth Partner'));
  assert.ok(mobileMenu(html).includes('Growth Partner'));
});

test('6. the mobile menu starts closed and its trigger is wired to it', () => {
  const html = renderHeader('landing');
  const menu = mobileMenu(html);
  const wrapperClass = /class="([^"]*)"/.exec(menu)?.[1] ?? '';
  assert.ok(wrapperClass.includes('lg:hidden'), 'the menu is hidden from `lg` upwards');
  assert.ok(/(^|\s)hidden(\s|")/.test(`${wrapperClass} `), 'the closed menu must be display:none');
  assert.equal(wrapperClass.includes('block'), false, 'a closed menu must not be displayed');

  assert.ok(html.includes('aria-expanded="false"'), 'the trigger reports the closed menu');
  assert.ok(html.includes('aria-controls="global-nav-mobile"'));
  assert.ok(html.includes('lg:hidden w-10 h-10'), 'the trigger must stay below the lg breakpoint');
  // The desktop row stays hidden below `lg`, so the menu is the only way in there.
  assert.ok(desktopNav(html).includes('hidden lg:flex'));
});

test('7. clicking the entry routes to the Growth Partner area', () => {
  const header = readFileSync('src/components/Header.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  assert.ok(header.includes('setCurrentView(entry.view)'), 'entries switch the app view');
  // PART 2: the header entry pushes the canonical /partner/dashboard portal
  // route; the legacy /growth-partner namespace keeps working as an alias.
  assert.ok(app.includes('navigate(PARTNER_DASHBOARD_PATH)'), 'that view must push the canonical portal route');
  assert.ok(
    app.includes("currentView === 'growthPartner'") && app.includes('<GrowthPartnerPage'),
    'that view must mount the Growth Partner page',
  );
  assert.equal(GROWTH_PARTNER_PATH, '/growth-partner');
  assert.equal(isGrowthPartnerPath(GROWTH_PARTNER_PATH), true);
  assert.equal(matchGrowthPartnerRoute(GROWTH_PARTNER_PATH), 'dashboard');
});

test('7b. the /partner/* portal routes resolve to the same area', () => {
  assert.equal(PARTNER_LOGIN_PATH, '/partner/login');
  assert.equal(PARTNER_DASHBOARD_PATH, '/partner/dashboard');
  assert.equal(isPartnerPortalPath('/partner'), true);
  assert.equal(isPartnerPortalPath('/partner/dashboard'), true);
  assert.equal(isPartnerPortalPath('/partner/login'), true);
  assert.equal(isPartnerPortalPath('/partners'), false, 'no prefix accidents');
  assert.equal(isPartnerLoginPath('/partner/login'), true);
  assert.equal(isPartnerLoginPath('/partner/dashboard'), false);
  assert.equal(matchPartnerPortalRoute('/partner'), 'dashboard');
  assert.equal(matchPartnerPortalRoute('/partner/dashboard'), 'dashboard');
  assert.equal(matchPartnerPortalRoute('/partner/referrals'), 'referrals');
  assert.equal(matchPartnerPortalRoute('/partner/performance'), 'performance');
  assert.equal(matchPartnerPortalRoute('/partner/unknown-section'), 'dashboard', 'never a blank screen');
  assert.equal(partnerPortalPath('dashboard'), '/partner/dashboard');
  assert.equal(partnerPortalPath('referrals'), '/partner/referrals');
});
