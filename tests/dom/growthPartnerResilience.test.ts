import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';

// ============================================================================
// Growth Partner area — degraded backend payloads.
//
// The realistic "crash" is not an exception inside a fetch wrapper: it is a
// successful RPC whose payload is empty or missing keys (a rolling schema
// upgrade, a handler that answered `{}`, a row that lost a column). Before the
// hardening this threw during render — `dashboard.partner.is_active`,
// `list.rows.map`, `performance.monthly.map` — and React unmounted the whole
// tree into the ROOT ErrorBoundary ("Something went wrong"), taking the shell,
// the navigation and the referral code with it.
//
// These tests mount the real page against a stub backend that answers ONLY
// empty payloads and pin the outcome: the page stays up, the section states
// that it does not know ('—'), and the root fallback copy never appears.
// ============================================================================

after(() => dom.window.close());

const wait = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  assert.ok(check(), 'UI settled');
};

/** Answers every RPC the page calls; the answer body is configurable per RPC. */
function stubEmptyBackend(bodyFor: (rpc: string) => unknown) {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? '');
    const rpc = url.split('/').at(-1)?.split('?')[0] ?? '';
    const body = rpc === 'get_my_growth_partner'
      ? { user_id: 'partner-1', referral_code: 'NEXORA-TEST01', is_active: true, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }
      : bodyFor(rpc);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return () => { (globalThis as any).fetch = original; };
}

async function mount(path: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(GrowthPartnerPage, {
    user: { id: 'partner-1', email: 'meera@example.com' },
    path,
    navigate() {},
    onLogout() {},
  } as any)));
  return {
    host,
    rerender: async (next: string) => { await act(async () => root.render(React.createElement(GrowthPartnerPage, {
      user: { id: 'partner-1', email: 'meera@example.com' },
      path: next,
      navigate() {},
      onLogout() {},
    } as any))); },
    unmount: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

test('an empty dashboard payload renders honest unknowns — never the root error boundary', async () => {
  const restore = stubEmptyBackend(() => ({}));
  const app = await mount('/partner/dashboard');
  try {
    await wait(() => !!app.host.querySelector('[aria-label="Referral summary"]'));
    const text = app.host.textContent!;
    // The root ErrorBoundary copy would mean the whole tree was replaced.
    assert.doesNotMatch(text, /Something went wrong/);
    assert.doesNotMatch(text, /undefined|NaN/);
    // Counts the backend did not send are stated as unknown ('—').
    assert.match(app.host.querySelector('[aria-label="Referral summary"]')!.textContent!, /—/);
    // The partner card cannot invent a code, so it says so.
    assert.match(text, /Referral code not available\./);
    // No activity rows → the honest empty state, not a blank section.
    assert.match(text, /No referrals yet\./);
  } finally {
    await app.unmount();
    restore();
  }
});

test('a null referral page renders the empty state, not a crash', async () => {
  const restore = stubEmptyBackend((rpc) => (rpc === 'get_my_partner_referrals' ? null : {}));
  const app = await mount('/partner/referrals');
  try {
    await wait(() => !!app.host.querySelector('[aria-label="Referred users"]'));
    await wait(() => !!app.host.textContent?.includes('No referrals yet.'));
    assert.doesNotMatch(app.host.textContent!, /Something went wrong/);
    assert.doesNotMatch(app.host.textContent!, /undefined/);
    // The tab counts say 'unknown' too (the payload carried no status_counts).
    assert.match(app.host.querySelector('[role="tablist"]')!.textContent!, /—/);
  } finally {
    await app.unmount();
    restore();
  }
});

test('an empty performance payload keeps the section usable', async () => {
  const restore = stubEmptyBackend((rpc) => (rpc === 'get_my_partner_performance' ? {} : {}));
  const app = await mount('/partner/performance');
  try {
    await wait(() => !!app.host.querySelector('[aria-label="Performance summary"]'));
    const text = app.host.textContent!;
    assert.doesNotMatch(text, /Something went wrong/);
    assert.doesNotMatch(text, /undefined|NaN/);
    assert.match(text, /Completion Rate/);
    assert.match(text, /Monthly history is not available yet\./);
  } finally {
    await app.unmount();
    restore();
  }
});
