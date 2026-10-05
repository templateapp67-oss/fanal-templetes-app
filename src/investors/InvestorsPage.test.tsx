// Run: node --import ./scripts/testEnv.mjs --import tsx --test src/investors/InvestorsPage.test.tsx
import '../../tests/dom/jsdomSetup';
import { dom } from '../../tests/dom/jsdomSetup';
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import InvestorsPage from './InvestorsPage';
import { InvestorsRoute } from './InvestorsRoute';

let root: Root | undefined;
const host = document.createElement('div');
document.body.append(host);
const render = async (element: React.ReactNode) => {
  root = createRoot(host);
  await act(async () => { root!.render(element); });
};
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  window.history.replaceState({}, '', '/');
});
after(() => { host.remove(); dom.window.close(); });

const normalized = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim();

test('renders exactly the requested seven sections in order, with images and valid local anchors', async () => {
  await render(<InvestorsPage />);
  assert.deepEqual([...host.querySelectorAll('main > section')].map(section => normalized(section.querySelector('h1,h2'))), [
    'Growth Partner.Revenue & rewards.',
    'Growth Partner Revenue & Commission Model',
    'First Onboarding Incentive',
    'Growth Partner Reward Framework',
    '10-Day Reward Calculation Formula',
    'Investor Relevance',
    'Investor Disclaimer',
  ]);
  assert.equal(host.querySelectorAll('h1').length, 1);
  assert.equal(host.querySelectorAll('img[alt]').length, 2);
  for (const anchor of host.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = anchor.getAttribute('href')!;
    assert.ok(href.startsWith('#'));
    assert.ok(host.querySelector(href), `Missing local anchor target ${href}`);
  }
});

test('preserves every reward, value, next-shop trigger and one-time/audit requirement', async () => {
  await render(<InvestorsPage />);
  const rows = [...host.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 7, 'No additional reward tiers');
  const expected = [
    ['25 shops', '2526 shops', 'T-shirt', '₹250'],
    ['50 shops', '5051 shops', 'Samsung Tablet', '₹10,000'],
    ['100 shops', '100101 shops', 'Branded HP Laptop', '₹50,000'],
    ['250 shops', '250251 shops', 'Electric Scooter', '₹80,000'],
    ['500 shops', '500501 shops', 'Latest iPhone', '₹1,20,000'],
    ['750 shops', '750751 shops', 'Royal Enfield 350 cc', '₹3,00,000'],
    ['1000 shops', '10001001 shops', 'SUV Car', '₹6,00,000'],
  ];
  assert.deepEqual(rows.map(row => [...row.querySelectorAll('th,td')].map(normalized)), expected);
  const text = normalized(host)!;
  for (const rule of [
    '1 active shop = ₹100/day verified collection.',
    'Growth Partner commission = 10% of actual verified collection.',
    'Commission settlement = every 7 days.',
    'First 15-day qualifying onboarding collection: ₹15,000 → Nexora 10% = ₹1,500 → Growth Partner one-time onboarding incentive = ₹150.',
    'Reward triggers on the NEXT shop after milestone completion:',
    "Reward eligibility requires audit of the previous 10 days' verified collection record.",
    'Each milestone reward is ONE TIME per Growth Partner ID.',
    'After 1000 shops, count continues; do not invent additional reward tiers.',
  ]) assert.ok(text.includes(rule), `Missing exact business rule: ${rule}`);
  assert.match(normalized(host.querySelector('#reward-calculation'))!, /Sum of actual verified collectionfrom the previous 10 days/);
  assert.match(normalized(host.querySelector('#investor-disclaimer'))!, /does not state investor returns, valuation, or revenue projections/);
});

test('page metadata and accessible viewport restore on unmount', async () => {
  document.title = 'Original title';
  const description = document.createElement('meta');
  description.name = 'description'; description.content = 'Original description';
  const viewport = document.createElement('meta');
  viewport.name = 'viewport'; viewport.content = 'width=device-width, maximum-scale=1';
  document.head.append(description, viewport);
  await render(<InvestorsPage />);
  assert.equal(document.title, 'HOME PAGE | Growth Partner | Nexora');
  assert.equal(viewport.content, 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  await act(async () => root?.unmount()); root = undefined;
  assert.equal(document.title, 'Original title');
  assert.equal(description.content, 'Original description');
  assert.equal(viewport.content, 'width=device-width, maximum-scale=1');
  description.remove(); viewport.remove();
});

test('only /investors is intercepted; existing paths keep the original application', async () => {
  window.history.replaceState({}, '', '/investors/?source=test');
  let originalMounts = 0;
  function OriginalApp() { originalMounts++; return <div data-original-app>Existing application</div>; }
  await render(<InvestorsRoute><OriginalApp /></InvestorsRoute>);
  assert.ok(host.querySelector('#investors-main'));
  assert.equal(originalMounts, 0, 'Existing app and its auth effects must not mount at /investors');
  for (const path of ['/', '/partner/dashboard', '/growth-partner', '/investors-other', '/investors/nested']) {
    await act(async () => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    assert.ok(host.querySelector('[data-original-app]'), `Original application missing at ${path}`);
    assert.equal(host.querySelector('#investors-main'), null);
  }
  await act(async () => {
    window.history.pushState({}, '', '/investors#reward-framework');
    window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.ok(host.querySelector('#investors-main'));
  assert.equal(host.querySelector('[data-original-app]'), null);
});
