// ============================================================================
// Global header navigation — Growth Partner entry.
//
//   • The header's view switcher exposes the Growth Partner area next to the
//     other surfaces, for signed-in and signed-out visitors alike (the page
//     itself decides sign-in / partner-only / ready).
//   • The entry is highlighted (and marked `aria-current="page"`) only while
//     the Growth Partner view is the current one.
//   • Clicking it goes through the same routing as every other entry:
//     `setCurrentView('growthPartner')` → `/growth-partner`, which the router
//     resolves back to the dashboard section on refresh/deep links.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header } from '../src/components/Header';
import {
  GROWTH_PARTNER_PATH,
  isGrowthPartnerPath,
  matchGrowthPartnerRoute,
} from '../src/lib/router';
import type { AppView } from '../src/types';

function renderHeader(currentView: AppView): string {
  return renderToStaticMarkup(
    React.createElement(Header, {
      currentView,
      setCurrentView: () => {},
      salonName: 'Test Salon',
      user: { id: 'u1', email: 'owner@testsalon.com' },
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

function growthPartnerButton(html: string): string {
  const found = buttonChunks(html).find((button) => button.includes('Growth Partner'));
  assert.ok(found, 'the header must render a Growth Partner entry');
  return found;
}

function navMarkup(html: string): string {
  const start = html.indexOf('<nav');
  const end = html.indexOf('</nav>');
  assert.ok(start >= 0 && end > start, 'the header must render its navigation');
  return html.slice(start, end);
}

test('1. the header nav renders a Growth Partner entry', () => {
  const html = renderHeader('landing');
  const nav = navMarkup(html);
  assert.ok(nav.includes('Growth Partner'), 'the entry must live inside the view switcher');
  assert.equal(growthPartnerButton(html).includes('handshake'), true);
});

test('2. the entry sits with the other surfaces and keeps their order', () => {
  const labels = ['Home', 'Explore Templates', 'SaaS Dashboard', 'Growth Partner', 'My Bookings'];
  const nav = navMarkup(renderHeader('landing'));
  let last = -1;
  for (const label of labels) {
    const at = nav.indexOf(label);
    assert.ok(at > last, `"${label}" must appear after the previous entry in the nav`);
    last = at;
  }
});

test('3. the entry is highlighted only on the growthPartner view', () => {
  const active = growthPartnerButton(renderHeader('growthPartner'));
  assert.equal(active.includes('bg-[#C20E5A]'), true, 'active entry uses the accent pill');
  assert.equal(active.includes('aria-current="page"'), true);

  for (const view of ['landing', 'dashboard', 'bookings'] as AppView[]) {
    const inactive = growthPartnerButton(renderHeader(view));
    assert.equal(inactive.includes('bg-[#C20E5A]'), false, `${view} must not highlight the entry`);
    assert.equal(inactive.includes('aria-current'), false);
  }
});

test('4. the entry is shown to signed-out visitors too', () => {
  const html = renderToStaticMarkup(
    React.createElement(Header, {
      currentView: 'landing',
      setCurrentView: () => {},
      salonName: 'Test Salon',
      user: null,
      setUser: () => {},
      profile: { ownerName: '', ownerPhotoUrl: '' } as any,
      onProfileSaved: () => {},
      openAuth: () => {},
    } as any),
  );
  assert.ok(navMarkup(html).includes('Growth Partner'));
});

test('5. clicking the entry routes to the Growth Partner area', () => {
  const header = readFileSync('src/components/Header.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  assert.ok(
    header.includes("onClick={() => setCurrentView('growthPartner')}"),
    'the entry must switch the view to growthPartner',
  );
  assert.ok(app.includes('navigate(GROWTH_PARTNER_PATH)'), 'that view must push the area route');
  assert.ok(
    app.includes("currentView === 'growthPartner'") && app.includes('<GrowthPartnerPage'),
    'that view must mount the Growth Partner page',
  );
  assert.equal(GROWTH_PARTNER_PATH, '/growth-partner');
  assert.equal(isGrowthPartnerPath(GROWTH_PARTNER_PATH), true);
  assert.equal(matchGrowthPartnerRoute(GROWTH_PARTNER_PATH), 'dashboard');
});
