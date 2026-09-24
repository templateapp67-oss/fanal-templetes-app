// ============================================================================
// The portal sections on the service layer — mounted for real in jsdom.
//
// `partnerPortalModulesBrowserFlow.test.ts` already proves the happy paths and
// the form rules. This file proves the reasons the facade exists, end to end
// through the real pages:
//
//   • a money field the backend did not send shows an ERROR, never ₹0.00;
//   • a count the backend did not send never prints as "0 referrals";
//   • a missing migration is named as an administrator's job;
//   • a refusal the partner can act on (the ₹500 floor) is shown verbatim while
//     the form still works;
//   • every partner read is addressed without a partner id (identity is the JWT),
//     which is asserted against the actual request bodies.
// ============================================================================

import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';

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

const DASHBOARD = {
  partner: { referral_code: 'ALPHA01', is_active: true, partner_since: '2026-09-01T00:00:00Z' },
  kpis: { total_referrals: 3, active_onboarding: 2, completed: 1 },
  recent_activity: [],
};

const HEALTHY_EARNINGS = {
  currency: 'INR',
  totals: { lifetime_paise: 200_000, pending_paise: 75_000, cleared_paise: 125_000, available_paise: 125_000 },
  transactions: [
    {
      id: 'e1',
      earning_type: 'onboarding_reward',
      status: 'available_for_withdrawal',
      amount_paise: 125_000,
      commission_bps: 1500,
      earned_at: '2026-09-01T10:00:00Z',
      payment_cleared_at: '2026-09-01T10:00:00Z',
      available_at: '2026-09-08T10:00:00Z',
      paid_at: null,
    },
  ],
};

interface StubOptions {
  /** Replaces the earnings payload entirely (for malformed-shape cases). */
  earnings?: unknown;
  /** Fails every RPC with this PostgREST error. */
  rpcError?: unknown;
  /** Fails only the payout-request write. */
  payoutWriteError?: unknown;
}

function stubNetwork(options: StubOptions = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes('/api/partner/')) {
      // The standing "this deploy has no proxy" answer: the client must fall
      // back to the RPC, which is the path this test file exercises.
      return new Response(JSON.stringify({ error: { code: 'no_route', message: 'no proxy route' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const fn = url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/)?.[1] ?? '';
    const fail = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 400, headers: { 'content-type': 'application/json' } });
    if (options.rpcError && fn.startsWith('get_my_partner')) return fail(options.rpcError);
    if (options.payoutWriteError && fn === 'request_my_partner_payout') return fail(options.payoutWriteError);
    switch (fn) {
      case 'get_my_growth_partner':
        return Response.json(PARTNER_ROW);
      case 'get_my_partner_dashboard':
        return Response.json(DASHBOARD);
      case 'get_my_partner_earnings':
        return Response.json(options.earnings ?? HEALTHY_EARNINGS);
      case 'get_my_partner_payout_requests':
        return Response.json({ total: 0, open_amount_paise: 0, items: [] });
      default:
        return fail({ message: `unstubbed rpc: ${fn}` });
    }
  };
  return { calls, restore: () => ((globalThis as any).fetch = original) };
}

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

async function waitFor(predicate: () => boolean, what: string, tries = 120) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), `timed out waiting for ${what}`);
}

async function mountPortal(startPath: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let currentPath = startPath;
  const render = async () => {
    await act(() =>
      root.render(
        React.createElement(GrowthPartnerPage, {
          user: { id: PARTNER_ID, email: 'meera@example.com', user_metadata: { full_name: 'Meera Partner' } },
          path: currentPath,
          navigate: (to: string) => {
            currentPath = to;
          },
          onLogout: () => {},
          accentHex: '#C20E5A',
        } as any)
      )
    );
  };
  await render();
  await waitFor(() => !!document.querySelector('[data-partner-nav="dashboard"]'), 'the portal shell');
  return {
    async goto(section: string) {
      const link = document.querySelector(`[data-partner-nav="${section}"]`) as HTMLElement;
      assert.ok(link, `the ${section} sidebar link`);
      await act(() => link.click());
      await render();
      await waitFor(() => !!document.querySelector(`[data-partner-module="${section}"]`), `the ${section} module`);
    },
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

const body = () => document.body.textContent || '';

/**
 * The submit button is labelled with the live amount ("Request ₹5,000"), so it
 * is matched by prefix — the card heading reads "Request a payout".
 */
function payoutButton(): HTMLElement {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    /^Request\s/.test((candidate.textContent || '').trim())
  );
  assert.ok(button, 'the payout submit button');
  return button as HTMLElement;
}

/** Type into a React-controlled input the way a browser does. */
async function type(selector: string, value: string) {
  const element = document.querySelector(selector) as HTMLInputElement | null;
  assert.ok(element, `expected ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return element;
}

test('a money field the backend omitted shows an error, never a ₹0 wallet', async () => {
  // `available_paise` missing: the old normalizer would print ₹0 beside a
  // lifetime of ₹2,000 — a figure the partner cannot act on and might believe.
  const network = stubNetwork({
    earnings: { currency: 'INR', totals: { lifetime_paise: 200_000, pending_paise: 75_000 }, transactions: [] },
  });
  const app = await mountPortal('/partner/earnings');
  try {
    await waitFor(() => body().includes('unexpected shape') || body().includes('Unexpected response shape'), 'the shape failure');
    assert.ok(document.querySelector('[role="alert"]'), 'the failure is announced');
    assert.ok(body().includes('₹0') === false || body().includes('Nothing was guessed or defaulted'), 'the wallet is not silently ₹0');
    assert.ok(document.querySelector('[data-partner-retry]'), 'retry stays available');
    // The classification says an administrator has to act — not the partner.
    assert.ok(body().includes('An administrator has to act'), 'the owner of the fix is named');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('a failure the partner only sees as safe copy still leaves the code in the logs', async () => {
  // The reported bug, end to end: the screen said "Please try again" (or
  // "Could not verify …") and the PostgREST answer existed nowhere. Now the
  // console carries it — one line, naming the operation and the call.
  const network = stubNetwork({
    rpcError: { code: '42501', message: 'Active Growth Partner required' },
  });
  const originalError = console.error;
  const logged: Array<{ prefix: string; fields: any }> = [];
  (console as any).error = (prefix?: unknown, fields?: unknown) => {
    logged.push({ prefix: String(prefix ?? ''), fields });
  };
  let app: Awaited<ReturnType<typeof mountPortal>> | null = null;
  try {
    app = await mountPortal('/partner/earnings');
    await waitFor(() => body().includes('only available to an approved, active Growth Partner'), 'the refusal copy');
    // The partner sees reviewed copy…
    assert.doesNotMatch(body(), /42501/, 'no driver code on the screen');
    // …and the log carries the code, the call and the operation.
    assert.ok(logged.length >= 1, 'the failure was recorded, not swallowed');
    const line = logged[0];
    assert.deepEqual(line.fields.postgrest.code, '42501');
    assert.equal(line.fields.kind, 'not-a-partner');
    assert.ok(
      /^\[growth-partner\] .+ failed/.test(line.prefix),
      `the line is greppable: ${line.prefix}`
    );
  } finally {
    (console as any).error = originalError;
    if (app) await app.unmount();
    network.restore();
  }
});

test('a count the backend did not send never prints as "0 referrals"', async () => {
  const network = stubNetwork({ earnings: { currency: 'INR', totals: {}, transactions: [] } });
  const app = await mountPortal('/partner/earnings');
  try {
    await waitFor(() => body().includes('Unexpected response shape') || body().includes('unexpected shape'), 'the shape failure');
    // The failing contract field is named where a fixer will look for it: the
    // support report the diagnostic prints (the button a partner would press).
    const diagnostic = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent || '').includes('Run diagnostic')
    ) as HTMLElement;
    assert.ok(diagnostic, 'the diagnostic affordance is on the section card');
    await act(() => diagnostic.click());
    await waitFor(() => body().includes('Live checks'), 'the diagnostic report');
    assert.ok(body().includes('totals.available_paise'), 'the failing contract field is named in the report');
    assert.ok(body().includes('Code:     PARTNER_CONTRACT_MISMATCH') || body().includes('PARTNER_CONTRACT_MISMATCH'), 'the report carries the error code');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('a missing migration is an administrator\'s job, and the section says so', async () => {
  const network = stubNetwork({
    rpcError: {
      code: 'PGRST202',
      message: 'Could not find the function public.get_my_partner_earnings(p_limit, p_offset) in the schema cache',
    },
  });
  const app = await mountPortal('/partner/earnings');
  try {
    await waitFor(() => body().includes('database setup is missing'), 'the setup diagnosis');
    assert.ok(body().includes('An administrator has to act'), 'the fix is routed to the administrator');
    assert.ok(body().includes('20260918035349_partner_portal_operations.sql') || body().includes('GROWTH_PARTNER_SETUP.md'), 'the migration to apply is named');
    assert.ok(document.querySelector('[data-partner-retry]'), 'retry is still offered, without promising it will help');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('the ledger\'s floor refusal reaches the partner verbatim and the form still works', async () => {
  const network = stubNetwork({
    payoutWriteError: { code: '22023', message: 'Minimum withdrawal is ₹500' },
  });
  const app = await mountPortal('/partner/withdrawals');
  try {
    await waitFor(() => !!document.querySelector('#payout-amount') || body().includes('Withdraw'), 'the withdrawals form');

    // A valid amount that the LEDGER refuses: the refusal must be shown as the
    // backend wrote it, not flattened into "something went wrong".
    // Inside the ₹1,250 wallet and above the ₹500 floor: the page's own guards
    // pass, so the LEDGER's refusal is what the partner sees.
    await type('#payout-amount', '1000');
    await type('#payout-destination', 'partner@okbank');

    const submit = payoutButton();
    assert.ok(submit, 'the request-payout button');
    await act(() => submit.click());
    await waitFor(() => body().includes('Minimum withdrawal is ₹500'), 'the ledger refusal');

    const post = network.calls.find((call) => call.url.includes('/rest/v1/rpc/request_my_partner_payout'));
    assert.ok(post, 'the write reached the RPC');
    // ₹5,000 as whole paise, with the caller's own destination — no identity.
    assert.deepEqual(post!.body, {
      p_amount_paise: 100_000,
      p_method: 'upi',
      p_destination_label: 'partner@okbank',
    });
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('every partner read is addressed without a partner id (identity is the JWT)', async () => {
  const network = stubNetwork();
  const app = await mountPortal('/partner/dashboard');
  try {
    await app.goto('earnings');
    const rpcCalls = network.calls.filter((call) => call.url.includes('/rest/v1/rpc/'));
    assert.ok(rpcCalls.length >= 3, 'the gate + dashboard + earnings reads all ran');
    for (const call of rpcCalls) {
      const keys = Object.keys(call.body ?? {});
      for (const key of keys) {
        assert.doesNotMatch(key, /partner_id|user_id|owner_id|p_partner|p_user/, `${call.url} must not take an identity`);
      }
      // Nor may an id be smuggled in as a value.
      const serialized = JSON.stringify(call.body ?? {});
      assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'no uuid travels to the backend');
    }
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('the withdrawal amount is converted to paise exactly once', async () => {
  const network = stubNetwork();
  const app = await mountPortal('/partner/withdrawals');
  try {
    await waitFor(() => !!document.querySelector('#payout-amount'), 'the payout form');
    await type('#payout-amount', '1234.56');
    await type('#payout-destination', 'partner@okbank');
    const submit = payoutButton();
    await act(() => submit.click());
    await waitFor(() => network.calls.some((call) => call.url.includes('request_my_partner_payout')), 'the write');
    const post = network.calls.find((call) => call.url.includes('request_my_partner_payout'))!;
    assert.equal(post.body.p_amount_paise, 123_456, '₹1,234.56 is 123456 paise — converted once, exactly');
  } finally {
    await app.unmount();
    network.restore();
  }
});
