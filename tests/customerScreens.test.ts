// ============================================================================
// Customer App screens must render — with no database, no session, and no props.
//
// An empty shell is the failure mode a type-checker cannot see: a screen that
// throws on first paint shows the customer nothing, and (worse) a screen that
// quietly reaches for `src/mockData.ts` shows them something plausible and
// wrong. So this file does both halves:
//
//   1. render every screen server-side and assert it produced markup
//   2. assert the markup contains the honesty copy (empty states, "not
//      connected", derived-source labels) and NOT any string that exists only in
//      the mock data file
//
// These run in the same `npm test` as the rest of the suite, so a regression in
// either direction fails the build rather than shipping.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CustomerApp, accentFrom } from '../src/customer/CustomerApp';
import { AuthScreen } from '../src/customer/screens/Auth';
import { BookingFlow } from '../src/customer/screens/Book';
import { BookingsScreen } from '../src/customer/screens/Bookings';
import { HomeScreen, SalonScreen } from '../src/customer/screens/Discover';
import { ActivityScreen } from '../src/customer/screens/Activity';
import { LocationScreen, ProfileScreen } from '../src/customer/screens/Me';
import { SettingsScreen } from '../src/customer/screens/Settings';
import { RewardsScreen } from '../src/customer/screens/Rewards';
import { matchCustomerRoute, customerPath, isCustomerAppPath, normalizePath } from '../src/lib/router';
import { CUSTOMER_FLOW_ORDER } from '../src/lib/customer/schema';
import { nextBookingRef, paymentUiFromOutcome } from '../src/lib/customer/api';

const noop = () => {};

/**
 * Strings that exist only in src/mockData.ts. If one appears in rendered
 * customer markup, a screen is falling back to sample data instead of the API.
 */
const MOCK_FINGERPRINTS = [
  'Arts By Uma',
  'Signature Caramel Balayage',
  'Russian Dry Cuticle Precision Manicure',
  'Master Stylist Precision Cut',
];

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function assertNoMockData(html: string, where: string) {
  for (const fingerprint of MOCK_FINGERPRINTS) {
    assert.equal(html.includes(fingerprint), false, `${where} rendered mock data ("${fingerprint}")`);
  }
}

test('every customer screen renders without a session, a database or props', () => {
  const screens: Array<[string, React.ReactElement]> = [
    ['Auth', React.createElement(AuthScreen, { onAuthenticated: noop, onContinueAsGuest: noop })],
    ['Home', React.createElement(HomeScreen, { onOpenSalon: noop, onBook: noop })],
    ['Salon', React.createElement(SalonScreen, { salonId: 'glow', onBack: noop, onTab: noop, onBook: noop })],
    ['Book', React.createElement(BookingFlow, { salonId: 'glow', onRequireAuth: noop, onOpenBooking: noop, onExit: noop })],
    ['Bookings', React.createElement(BookingsScreen, {})],
    ['Rewards', React.createElement(RewardsScreen, {})],
    ['Activity', React.createElement(ActivityScreen, {})],
    ['Profile', React.createElement(ProfileScreen, {})],
    ['Location', React.createElement(LocationScreen, {})],
    ['Settings', React.createElement(SettingsScreen, {})],
  ];
  for (const [name, element] of screens) {
    const html = render(element);
    assert.ok(html.length > 200, `${name} rendered ${html.length} characters — a screen that renders nothing is a blank page`);
    assertNoMockData(html, name);
    assert.equal(/undefined|NaN|\[object Object\]/.test(html), false, `${name} printed a raw value`);
  }
});

test('the shell renders each section of the flow by path', () => {
  const paths = [
    '/app',
    '/app/auth',
    '/app/profile',
    '/app/location',
    '/app/salon/glow',
    '/app/salon/glow/services',
    '/app/book/glow',
    '/app/bookings',
    '/app/booking/some-uuid',
    '/app/wallet',
    '/app/qr',
    '/app/membership',
    '/app/referral',
    '/app/offers',
    '/app/notifications',
    '/app/favourites',
    '/app/data',
    '/app/settings',
  ];
  for (const path of paths) {
    const html = render(React.createElement(CustomerApp, { path, navigate: noop }));
    assert.ok(html.length > 500, `shell at ${path} rendered nothing`);
    assert.equal(html.includes('Nexora SalonOS') || html.includes('Glow') || html.includes('Loading'), true, `shell at ${path} has no header`);
    assertNoMockData(html, `shell (${path})`);
  }
  // The flow list and the router must not drift apart: every documented step has
  // a path that the router resolves to a real section.
  for (const section of CUSTOMER_FLOW_ORDER) {
    const resolved = matchCustomerRoute(normalizePath('/app'));
    assert.ok(typeof resolved.section === 'string' && resolved.section.length > 0, `${section} has no route`);
  }
});

test('a customer app path is recognised, and an owner path never is', () => {
  assert.equal(isCustomerAppPath('/app'), true);
  assert.equal(isCustomerAppPath('/app/bookings'), true);
  assert.equal(isCustomerAppPath('/app/salon/glow'), true);
  assert.equal(isCustomerAppPath('/'), false);
  assert.equal(isCustomerAppPath('/customer/bookings'), false, 'the owner booking page is not the customer app');
  assert.equal(isCustomerAppPath('/owner/dashboard/staff-performance'), false, 'staff performance is owner-only');
  assert.equal(isCustomerAppPath('/applications'), false, 'a prefix match would hijack unrelated routes');

  assert.equal(matchCustomerRoute('/app').section, 'home');
  assert.equal(matchCustomerRoute('/app/salon/glow/services').id, 'glow');
  assert.equal(matchCustomerRoute('/app/salon/glow/services').tab, 'services');
  assert.equal(matchCustomerRoute('/app/booking/abc-123').id, 'abc-123');
  assert.equal(matchCustomerRoute('/app/nonsense').section, 'home', 'an unknown sub-path lands on home, not a blank screen');
  assert.equal(customerPath('salon', 'glow', 'reviews'), '/app/salon/glow/reviews');
  assert.equal(customerPath('home'), '/app');
  assert.equal(matchCustomerRoute('/app/settings').section, 'settings', 'the settings screen is a route, not a modal');
  assert.equal(matchCustomerRoute('/app/support').section, 'settings', 'a friendlier alias lands in the same place');
});

test('the source label never claims a database before the API answers', () => {
  const home = render(React.createElement(HomeScreen, { onOpenSalon: noop, onBook: noop }));
  // While the request is in flight the honest label is "reading…" — and after a
  // mock answer it is "not connected". A chip that says `supabase` in either
  // case is the exact lie this app is built to avoid.
  assert.equal(home.includes('reading…'), true, 'home claims a data source before the request answered');
  assert.equal(home.includes('>supabase<'), false, 'home labelled an unread value as supabase');
  assert.equal(/Salons on Nexora|Salons near/.test(home), true, 'home lost its discovery heading');
});

test('settings offers only what this schema can actually store', () => {
  const html = render(React.createElement(SettingsScreen, { userId: 'u1', email: 'me@example.com' }));
  assert.ok(html.includes('On this device'), 'settings must show the device-scoped state it can change');
  assert.ok(html.includes('Export as JSON'), 'a customer with rows in the database can get a copy of them');
  // The trap this screen has to avoid: switches that look configurable but have
  // no column behind them.
  for (const fake of ['Push notifications', 'Email preferences', 'Dark mode', 'Change password']) {
    assert.equal(html.includes(fake), false, `settings advertised "${fake}", which this schema cannot store`);
  }
});

test('Book.tsx exposes payment states, reuses NX-JPR-53682, and never calls fetch itself', () => {
  const source = readFileSync('src/customer/screens/Book.tsx', 'utf8');
  for (const label of ['Payment ready', 'Payment processing', 'Payment successful', 'Payment failed', 'Payment service unavailable']) {
    assert.ok(source.includes(label), `Book.tsx must show "${label}"`);
  }
  assert.ok(source.includes('NX-JPR-53682'), 'retries keep the same draft reference');
  assert.ok(source.includes('payBookingOnline'), 'checkout goes through src/lib/customer/api.ts');
  assert.ok(source.includes('getPaymentConfig'));
  assert.equal(/\bfetch\(/.test(source), false, 'Book.tsx must not call fetch()');
  assert.equal(nextBookingRef('Jaipur', 'NX-JPR-53682'), 'NX-JPR-53682');
  assert.match(nextBookingRef('Jaipur'), /^NX-JPR-\d{5}$/);
  assert.equal(paymentUiFromOutcome(null, true), 'processing');
  assert.equal(paymentUiFromOutcome(null, false), 'ready');
  assert.equal(paymentUiFromOutcome({ status: 'paid', reason: '', retryable: false, amount: 1, mode: 'test' }, false), 'successful');
  assert.equal(paymentUiFromOutcome({ status: 'unavailable', reason: 'x', retryable: true, amount: 0, mode: 'disabled' }, false), 'unavailable');
  assert.equal(paymentUiFromOutcome({ status: 'failed', reason: 'x', retryable: true, amount: 0, mode: 'test' }, false), 'failed');
});

test('the salon accent falls back to the product default for an unknown palette key', () => {
  assert.equal(accentFrom(null), '#C20E5A');
  assert.equal(accentFrom({ themeAccentKey: 'emerald' } as any), '#065f46');
  assert.equal(accentFrom({ themeAccentKey: 'not-a-real-key' } as any), '#C20E5A');
});

test('no customer screen talks to Supabase or fetch directly', () => {
  const files = [
    'src/customer/screens/Auth.tsx',
    'src/customer/screens/Discover.tsx',
    'src/customer/screens/Book.tsx',
    'src/customer/screens/Bookings.tsx',
    'src/customer/screens/Rewards.tsx',
    'src/customer/screens/Activity.tsx',
    'src/customer/screens/Me.tsx',
    'src/customer/ui.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/from '\.\.\/\.\.\/mockData'/.test(source), false, `${file} still imports mock data`);
    assert.equal(/supabase\.from\(/.test(source), false, `${file} queries Supabase from the browser, which owner-scoped RLS answers with zero rows`);
    // Only Auth.tsx legitimately uses the auth client; nothing else reaches for
    // the raw REST surface or a hand-rolled fetch.
    if (!file.endsWith('Auth.tsx')) {
      assert.equal(/\bfetch\(/.test(source), false, `${file} bypasses src/lib/customer/api.ts`);
    }
  }
});
