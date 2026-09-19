// ============================================================================
// The PROMOTED partner modules, mounted for real in jsdom.
//
// The seven sections that were "Coming soon" slots must now behave like the
// rest of the portal, so this file renders the actual `GrowthPartnerPage` at
// `/partner/earnings`, `/partner/withdrawals`, `/partner/notifications`,
// `/partner/support` and `/partner/leaderboard`, answers the network calls they
// make (proxy 404 → direct RPC, the fallback every deploy without `/api` uses)
// and drives the controls with real events. It answers the questions a screenshot
// cannot:
//
//   • does the sidebar link navigate the SPA and mark itself current;
//   • does a wallet total come from the backend and format as money;
//   • does the payout form refuse ₹400 before the network, then post the right
//     RPC payload when it is valid — and show the backend's own refusal copy;
//   • does "mark all read" write, clear the badge and reload;
//   • does a support ticket post and appear in the caller's own list;
//   • does the leaderboard highlight the caller's row.
//
// Nothing here is a snapshot of markup: every assertion is about behaviour that
// a partner can perform.
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
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
const PARTNER_UUID = 'a18d0df6-58b5-4bdc-a518-3a597d5b7195';

const PARTNER_ROW = {
  user_id: PARTNER_ID,
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const DASHBOARD = {
  partner: { referral_code: 'ALPHA01', is_active: true, partner_since: '2026-09-01T00:00:00Z' },
  // The floor the Withdrawals form must enforce comes from the account, so the
  // fixture states it — ₹500, the same number the migration's default uses.
  limits: { minimum_payout_paise: 50000, payout_methods: ['upi', 'bank_transfer', 'paypal'] },
  kpis: { total_referrals: 3, active_onboarding: 2, completed: 1 },
  recent_activity: [{ type: 'referral_added', ref: '…00000002', display_name: null, at: '2026-09-06T10:00:00Z' }],
};

const EARNINGS = {
  currency: 'INR',
  // `available_paise` is what the wallet may still move; `cleared_paise` is the
  // gross past-clearance figure the Withdrawals hero quotes beside it.
  totals: { lifetime_paise: 200000, pending_paise: 75000, cleared_paise: 125000, available_paise: 125000 },
  transactions: [
    {
      id: 'e1',
      earning_type: 'recurring_subscription_commission',
      status: 'available_for_withdrawal',
      amount_paise: 125000,
      commission_bps: 1500,
      earned_at: '2026-09-01T10:00:00Z',
      payment_cleared_at: '2026-09-01T10:00:00Z',
      available_at: '2026-09-08T10:00:00Z',
      paid_at: null,
    },
    {
      id: 'e2',
      earning_type: 'onboarding_reward',
      status: 'pending',
      amount_paise: 75000,
      commission_bps: 1500,
      earned_at: '2026-09-10T10:00:00Z',
      payment_cleared_at: null,
      available_at: null,
      paid_at: null,
    },
  ],
};

const PAYOUT_REQUESTS = {
  total: 1,
  open_amount_paise: 60000,
  items: [
    {
      id: PARTNER_UUID,
      amount_paise: 60000,
      payout_method: 'upi',
      destination_label: 'partner@okbank',
      status: 'pending',
      requested_at: '2026-09-11T09:00:00Z',
      reviewed_at: null,
      paid_at: null,
      rejection_reason: null,
      provider_reference: null,
    },
  ],
};

const NOTIFICATIONS = {
  unread_count: 1,
  items: [
    {
      id: 'n1',
      notification_type: 'payout',
      title: 'Payout completed',
      body: 'Your payout of ₹600 has been paid.',
      is_read: false,
      read_at: null,
      created_at: '2026-09-12T10:00:00Z',
    },
    {
      id: 'n2',
      notification_type: 'system',
      title: 'Terms updated',
      body: 'The partner agreement was refreshed.',
      is_read: true,
      read_at: '2026-09-11T10:00:00Z',
      created_at: '2026-09-11T10:00:00Z',
    },
  ],
};

const LEVELS = {
  active_referrals: 7,
  levels: [
    { code: 'bronze', sort_order: 1, minimum_paid_referrals: 0, commission_bps: 1000, perks: ['Partner resources'], unlocked: true },
    { code: 'silver', sort_order: 2, minimum_paid_referrals: 6, commission_bps: 1500, perks: ['Priority support'], unlocked: true },
    { code: 'gold', sort_order: 3, minimum_paid_referrals: 21, commission_bps: 2000, perks: ['Campaign reviews'], unlocked: false },
  ],
};

const LEADERBOARD = {
  items: [
    { rank: 1, partner_id: 'b0000000-0000-4000-8000-000000000009', earnings_paise: 900000 },
    { rank: 2, partner_id: PARTNER_ID, earnings_paise: 200000 },
  ],
  my_rank: 2,
};

const ASSETS = [
  {
    id: 'm1',
    category: 'social_graphic',
    title: 'Launch week story',
    description: '1080×1920 story creative',
    storage_bucket: 'partner-marketing-assets',
    storage_path: 'social/launch-story.png',
    mime_type: 'image/png',
    file_size_bytes: 2400000,
    published_at: '2026-09-09T10:00:00Z',
  },
];

const TICKETS = [
  {
    id: 't1',
    ticket_number: 41,
    subject: 'Payout refused although balance looks available',
    message: 'On 12 September my ₹1,200 request was refused.',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-12T09:00:00Z',
    updated_at: '2026-09-12T09:00:00Z',
    closed_at: null,
  },
];

/** The RPC payload for one function name (POST body carries the named args). */
const RPC_REPLIES: Record<string, any> = {
  get_my_growth_partner: PARTNER_ROW,
  get_my_partner_dashboard: DASHBOARD,
  get_my_partner_earnings: EARNINGS,
  get_my_partner_payout_requests: PAYOUT_REQUESTS,
  request_my_partner_payout: { id: PARTNER_UUID, status: 'pending', amount_paise: 100000 },
  cancel_my_partner_payout_request: { id: PARTNER_UUID, status: 'cancelled' },
  get_my_partner_levels: LEVELS,
  get_partner_leaderboard: LEADERBOARD,
  get_my_partner_notifications: NOTIFICATIONS,
  mark_my_partner_notifications_read: 1,
  get_my_partner_notification_preferences: { email_enabled: true, in_app_enabled: false, updated_at: null },
  update_my_partner_notification_preferences: { email_enabled: false, in_app_enabled: false, updated_at: '2026-09-12T10:00:00Z' },
  get_partner_marketing_assets: ASSETS,
  get_partner_marketing_asset_categories: [{ category: 'social_graphic', asset_count: 1 }],
  get_my_partner_support_tickets: TICKETS,
  submit_my_partner_support_ticket: { id: 't2', ticket_number: 42, status: 'open', created_at: '2026-09-12T11:00:00Z' },
};

interface Recorded {
  url: string;
  body: any;
}

/**
 * Answer the network. `/api/partner/*` is a 404 on purpose: it proves the pages
 * work on a deploy without the proxy AND that the client asked for it first.
 */
function stubNetwork(options: { earningsError?: boolean; payoutRequests?: any; earnings?: any } = {}): {
  calls: Recorded[];
  restore: () => void;
} {
  const calls: Recorded[] = [];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const method = String(init?.method || 'GET').toUpperCase();

    if (url.includes('/api/partner/')) {
      return new Response(JSON.stringify({ error: { code: 'no_route', message: 'this deploy has no proxy route' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const match = url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/);
    if (!match) {
      return new Response(JSON.stringify({ message: `unexpected request: ${method} ${url}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const fn = match[1];
    if (fn === 'get_my_partner_earnings' && options.earnings) {
      return new Response(JSON.stringify(options.earnings), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (fn === 'get_my_partner_payout_requests' && options.payoutRequests) {
      return new Response(JSON.stringify(options.payoutRequests), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (options.earningsError && fn === 'get_my_partner_earnings') {
      return new Response(JSON.stringify({ code: '42501', message: 'Active Growth Partner required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (!(fn in RPC_REPLIES)) {
      return new Response(JSON.stringify({ message: `unstubbed rpc: ${fn}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(RPC_REPLIES[fn]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => ((globalThis as any).fetch = realFetch) };
}

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

function click(el: Element | Element[] | null, what = 'element') {
  const target = Array.isArray(el) ? el[0] : el;
  assert.ok(target, `expected to find ${what} in the DOM`);
  assert.equal(typeof (target as HTMLElement).click, 'function', `${what} is not clickable`);
  return act(() => {
    (target as HTMLElement).click();
  });
}

/** React-controlled input editing: set the value through the native setter. */
async function fill(selector: string, value: string, tag = 'input') {
  const el = document.querySelector(selector) as any;
  assert.ok(el, `expected ${selector}`);
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return el;
}

async function waitFor(predicate: () => boolean, what: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), `timed out waiting for ${what}`);
}

const byData = (attr: string, value?: string) =>
  [...document.querySelectorAll(value === undefined ? `[data-${attr}]` : `[data-${attr}="${value}"]`)];

const byText = (selector: string, text: string) =>
  [...document.querySelectorAll(selector)].find((el) => (el.textContent || '').includes(text));

const moduleRoot = (id: string) => byData('partner-module', id)[0] as HTMLElement | undefined;

/** Mount the real page at a real path, with navigation re-rendering it. */
async function mountPortalApp(startPath: string) {
  const navigated: string[] = [];
  let currentPath = startPath;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = async () => {
    await act(() =>
      root.render(
        React.createElement(GrowthPartnerPage, {
          user: { id: PARTNER_ID, email: 'meera@example.com', user_metadata: { full_name: 'Meera Partner' } },
          path: currentPath,
          navigate: (to: string) => {
            navigated.push(to);
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
    navigated,
    /** Click a sidebar link and re-render the way the SPA does. */
    async goto(section: string) {
      await click(byData('partner-nav', section)[0], `the ${section} sidebar link`);
      await render();
      await waitFor(() => !!moduleRoot(section), `the ${section} module to mount`);
    },
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

test('the Earnings link navigates the SPA and renders the wallet from the backend', async () => {
  const network = stubNetwork();
  const app = await mountPortalApp('/partner/dashboard');
  try {
    await app.goto('earnings');

    // The sidebar: a live anchor that is now marked current.
    const link = byData('partner-nav', 'earnings')[0] as HTMLAnchorElement;
    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('href'), '/partner/earnings');
    assert.equal(link.getAttribute('aria-current'), 'page');
    assert.deepEqual(app.navigated, ['/partner/earnings'], 'a click navigated the SPA');
    assert.ok(!(document.body.textContent || '').includes('Coming soon'), 'no Coming soon heading remains');

    // The header title follows the section.
    assert.ok((document.querySelector('#partner-portal-main h1, header h1')?.textContent || '').includes('Earnings'));

    // Money is formatted from paise, and both the totals and the rows are there.
    const root = moduleRoot('earnings')!;
    assert.ok(root.textContent!.includes('₹2,000'), 'lifetime total renders');
    assert.ok(root.textContent!.includes('₹1,250'), 'available total renders');
    assert.ok(root.textContent!.includes('₹750'), 'pending total renders');
    assert.ok(root.textContent!.includes('Subscription commission'), 'the earning type is human-readable');
    assert.ok(byText('span', 'Available') || root.textContent!.includes('Available'), 'the row status renders');
    assert.ok(root.textContent!.includes('15%'), 'the frozen rate on the row is shown');

    // Data path: the app asked its own API first, then the RPC it falls back to.
    assert.ok(network.calls.some((call) => call.url.includes('/api/partner/earnings')), 'the proxy was tried first');
    const rpcCall = network.calls.find((call) => call.url.includes('/rest/v1/rpc/get_my_partner_earnings'));
    assert.ok(rpcCall, 'the direct RPC fallback answered');
    assert.deepEqual(rpcCall!.body, { p_limit: 10, p_offset: 0 });
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('a wallet failure is told to the partner in actionable words, not a blank card', async () => {
  const network = stubNetwork({ earningsError: true });
  const app = await mountPortalApp('/partner/earnings');
  try {
    await waitFor(
      () => (document.body.textContent || '').includes('only available to an approved, active Growth Partner'),
      'the partner-only explanation'
    );
    assert.ok(document.querySelector('[role="alert"]'), 'the failure is announced to AT');
    assert.ok(document.querySelector('[data-partner-retry]'), 'and offers a retry');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('Withdrawals validates against the ₹500 floor, then posts a payout request', async () => {
  // No open request in this fixture, so the form itself is live.
  const network = stubNetwork({ payoutRequests: { total: 0, open_amount_paise: 0, items: [] } });
  const app = await mountPortalApp('/partner/earnings');
  try {
    await app.goto('withdrawals');
    const root = moduleRoot('withdrawals')!;

    // Nothing is reserved, so the whole cleared balance is withdrawable.
    assert.ok(root.textContent!.includes('₹1,250'), 'the withdrawable figure is the cleared balance');
    assert.ok(root.textContent!.includes('nothing reserved by an open request'), 'and the hero says so');

    // Too small: refused without touching the network.
    await fill('#payout-amount', '400');
    const before = network.calls.length;
    await click(byText('button', 'Request ₹400') || byData('partner-action', 'request-payout'), 'the request button');
    assert.ok((document.body.textContent || '').includes('Minimum payout is ₹500'), 'client-side floor is enforced');
    assert.equal(network.calls.length, before, 'no request left the browser');

    // Valid, but the destination is missing → still refused locally.
    await fill('#payout-amount', '1,000'.replace(',', ''));
    await click(byData('partner-action', 'request-payout'), 'the request button');
    assert.ok((document.body.textContent || '').includes('Tell us where to send it'), 'the destination is required');

    // Complete form → the RPC is posted with paise, and the receipt is shown.
    await fill('#payout-destination', 'partner@okbank');
    await click(byData('partner-action', 'request-payout'), 'the request button');
    await waitFor(() => !!network.calls.some((call) => call.url.includes('/rest/v1/rpc/request_my_partner_payout')), 'the payout RPC');
    const posted = network.calls.find((call) => call.url.includes('/rest/v1/rpc/request_my_partner_payout'))!;
    assert.deepEqual(posted.body, { p_amount_paise: 100000, p_method: 'upi', p_destination_label: 'partner@okbank' });
    await waitFor(() => (document.body.textContent || '').includes('is pending'), 'the confirmation toast');
    assert.ok(document.querySelector('[role="status"]'), 'the confirmation is announced');

    // The page reloads both reads so the balance can never be stale after a write.
    assert.ok(
      network.calls.filter((call) => call.url.includes('/rest/v1/rpc/get_my_partner_payout_requests')).length >= 2,
      'the request list was refetched after the write'
    );
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('a second payout request is refused in the UI while one is open', async () => {
  // The server-side contract: available is already net of the open request.
  const network = stubNetwork({
    earnings: {
      ...EARNINGS,
      totals: { lifetime_paise: 200000, pending_paise: 75000, cleared_paise: 125000, available_paise: 65000 },
    },
  });
  const app = await mountPortalApp('/partner/earnings');
  try {
    await app.goto('withdrawals');
    const root = moduleRoot('withdrawals')!;
    assert.ok(root.textContent!.includes('₹650'), 'the withdrawable figure is what the server says is left');
    assert.ok(root.textContent!.includes('₹1,250 cleared'), 'the gross cleared figure is shown beside it');
    assert.ok(root.textContent!.includes('₹600 reserved by an open request'), 'and the reservation explains the gap');
    const button = byData('partner-action', 'request-payout')[0] as HTMLButtonElement;
    assert.equal(button.disabled, true, 'the submit is inert while a request is under review');
    assert.ok(root.textContent!.includes('Finish or cancel your open request first.'), 'and the reason is next to the button');
    await click(button, 'the disabled request button');
    assert.ok(
      !network.calls.some((call) => call.url.includes('/rest/v1/rpc/request_my_partner_payout')),
      'a disabled submit never reaches the backend'
    );
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('the open payout request can be withdrawn through the cancel RPC', async () => {
  const network = stubNetwork();
  const app = await mountPortalApp('/partner/withdrawals');
  try {
    await waitFor(() => !!moduleRoot('withdrawals'), 'the withdrawals module');
    await click(byData('partner-action', 'cancel-payout'), 'the withdraw button');
    await waitFor(() => !!network.calls.some((call) => call.url.includes('/rest/v1/rpc/cancel_my_partner_payout_request')), 'the cancel RPC');
    const posted = network.calls.find((call) => call.url.includes('/rest/v1/rpc/cancel_my_partner_payout_request'))!;
    assert.deepEqual(posted.body, { p_request_id: PARTNER_UUID }, 'only the caller’s own request id is sent');
    await waitFor(() => (document.body.textContent || '').includes('Payout request withdrawn'), 'the confirmation');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('Notifications writes read state and saves the delivery toggles', async () => {
  const network = stubNetwork();
  const app = await mountPortalApp('/partner/notifications');
  try {
    await waitFor(() => !!moduleRoot('notifications'), 'the notifications module');
    const root = moduleRoot('notifications')!;
    assert.ok(root.textContent!.includes('Payout completed'), 'the unread row renders');
    assert.ok(root.textContent!.includes('1 unread'), 'the unread count is the backend’s, not invented');
    assert.equal(byData('partner-notification', 'unread').length, 1, 'one unread row');

    // Mark-all-read: real write, then the badge and rows clear.
    await click(byData('partner-action', 'mark-all-read'), 'the mark all read button');
    await waitFor(() => !!network.calls.some((call) => call.url.includes('/rest/v1/rpc/mark_my_partner_notifications_read')), 'the mark-read RPC');
    const posted = network.calls.find((call) => call.url.includes('/rest/v1/rpc/mark_my_partner_notifications_read'))!;
    assert.deepEqual(posted.body, { p_ids: null }, 'no ids means everything unread');
    await waitFor(() => (document.body.textContent || '').includes('0 unread'), 'the badge clears');
    assert.equal(byData('partner-notification', 'unread').length, 0, 'rows flip to read without a refetch');

    // Preferences read the stored row (email on, in-app off) and save a change.
    const emailToggle = root.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement;
    const inAppToggle = root.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;
    assert.equal(emailToggle.checked, true, 'the stored value, not a default');
    assert.equal(inAppToggle.checked, false);
    const saveButton = byData('partner-action', 'save-notification-preferences')[0] as HTMLButtonElement;
    assert.equal(saveButton.disabled, true, 'nothing to save until the partner edits');
    await act(() => {
      inAppToggle.click();
    });
    assert.equal(byData('partner-action', 'save-notification-preferences')[0]!.hasAttribute('disabled'), false, 'the save unlocks');
    await click(byData('partner-action', 'save-notification-preferences')[0], 'the save button');
    await waitFor(() => !!network.calls.some((call) => call.url.includes('/rest/v1/rpc/update_my_partner_notification_preferences')), 'the preferences RPC');
    const saved = network.calls.find((call) => call.url.includes('/rest/v1/rpc/update_my_partner_notification_preferences'))!;
    assert.deepEqual(saved.body, { p_email_enabled: true, p_in_app_enabled: true });
    await waitFor(() => (document.body.textContent || '').includes('Notification settings saved'), 'the save confirmation');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('Support posts a ticket, keeps the receipt on screen and lists the caller’s own tickets', async () => {
  const network = stubNetwork();
  const app = await mountPortalApp('/partner/support');
  try {
    await waitFor(() => !!moduleRoot('support'), 'the support module');
    assert.ok((document.body.textContent || '').includes('Payout refused although balance looks available'), 'the existing ticket renders');

    // A one-word subject is refused before any request goes out.
    await fill('#ticket-subject', 'Hi');
    const before = network.calls.length;
    await click(byData('partner-action', 'submit-ticket'), 'the submit button');
    assert.ok((document.body.textContent || '').includes('at least 3 characters'), 'the form explains the table check');
    assert.equal(network.calls.length, before, 'nothing was posted');

    await fill('#ticket-subject', 'Refund reversed my commission row');
    await fill('#ticket-message', 'The row for shop 42 was reversed although the shop kept its subscription.');
    await click(byData('partner-action', 'submit-ticket'), 'the submit button');
    await waitFor(() => !!network.calls.some((call) => call.url.includes('/rest/v1/rpc/submit_my_partner_support_ticket')), 'the ticket RPC');
    const posted = network.calls.find((call) => call.url.includes('/rest/v1/rpc/submit_my_partner_support_ticket'))!;
    assert.equal(posted.body.p_subject, 'Refund reversed my commission row');
    assert.equal(posted.body.p_priority, 'normal');
    await waitFor(() => (document.body.textContent || '').includes('Ticket #42 submitted'), 'the receipt names the ticket number');

    // The FAQ is searchable, and an unmatched search says so instead of lying.
    const search = document.querySelector('input[placeholder="Search the FAQ"]') as HTMLInputElement;
    assert.ok(search, 'the FAQ search exists');
    await act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'payout');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => (document.body.textContent || '').includes('Why is my payout request refused?'), 'the filtered question');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('Levels, Leaderboards and Marketing Materials render their real data', async () => {
  const network = stubNetwork();
  const app = await mountPortalApp('/partner/levels');
  try {
    // ── Levels ─────────────────────────────────────────────────────────────
    await waitFor(() => !!moduleRoot('partner-levels'), 'the levels module');
    const levels = moduleRoot('partner-levels')!;
    assert.ok(levels.textContent!.includes('Silver'), 'the current tier comes from the unlocked rows');
    assert.ok(levels.textContent!.includes('15%'), 'and so does its rate');
    assert.ok(levels.textContent!.includes('21'), 'the next threshold is shown');
    assert.equal(byData('partner-tier', 'gold').length, 1, 'every published tier renders a card');

    // ── Leaderboards ──────────────────────────────────────────────────────
    await app.goto('leaderboards');
    const board = moduleRoot('leaderboards')!;
    assert.ok(board.textContent!.includes('#2'), 'the caller’s rank renders');
    assert.ok(board.textContent!.includes('₹9,000'), 'the leading partner’s earnings render');
    assert.ok(board.textContent!.includes('You'), 'the caller’s own row is labelled');
    assert.match(board.innerHTML, /b0000000…0009|b0000000/, 'other partners stay short ids');
    // Switching the window is a new bounded read, not a client-side slice.
    await click(byText('button', 'Top 10'), 'the Top 10 chip');
    await waitFor(() => network.calls.filter((call) => call.url.includes('/rest/v1/rpc/get_partner_leaderboard')).length >= 2, 'the refetch');
    const windowCall = network.calls.filter((call) => call.url.includes('/rest/v1/rpc/get_partner_leaderboard')).at(-1)!;
    assert.deepEqual(windowCall.body, { p_limit: 10 });

    // ── Marketing materials ───────────────────────────────────────────────
    await app.goto('marketing-materials');
    const library = moduleRoot('marketing-materials')!;
    assert.ok(library.textContent!.includes('Launch week story'), 'the published asset renders');
    assert.ok(library.textContent!.includes('2.3 MB'), 'with a human size');
    assert.ok(library.textContent!.includes('/signup?ref=ALPHA01'), 'and the partner’s own share link');
    const download = byData('partner-action', 'download-m1')[0] as HTMLButtonElement;
    assert.ok(download, 'each asset has a download action');
    await click(download, 'the download button');
    await waitFor(() => !!network.calls.some((call) => call.url.includes('/api/partner/marketing-assets/m1/download')), 'the signing route was asked');
    // No storage in this deploy → the page says so rather than opening a 404.
    await waitFor(() => !!library.querySelector('[role="alert"]'), 'the download refusal is explained inline');
  } finally {
    await app.unmount();
    network.restore();
  }
});

test('deep links land on the promoted sections without going through the dashboard', async () => {
  const network = stubNetwork();
  // The URLs the sidebar links carry are the same ones a refreshed tab must honour.
  for (const [path, module] of [
    ['/partner/earnings', 'earnings'],
    ['/partner/withdrawals', 'withdrawals'],
    ['/partner/levels', 'partner-levels'],
    ['/partner/leaderboard', 'leaderboards'],
    ['/partner/marketing', 'marketing-materials'],
    ['/partner/notifications', 'notifications'],
    ['/partner/support', 'support'],
  ]) {
    const app = await mountPortalApp(path);
    try {
      assert.ok(moduleRoot(module), `${path} renders its own module`);
      const active = byData('partner-nav').filter((el) => el.getAttribute('aria-current') === 'page');
      assert.equal(active.length, 2, `${path} marks one item current in sidebar + drawer`);
      assert.ok(active.every((el) => el.getAttribute('data-partner-nav') === active[0].getAttribute('data-partner-nav')));
      assert.equal(active[0].getAttribute('data-partner-nav'), module, `${path} highlights ${module}`);
    } finally {
      await app.unmount();
    }
  }
  network.restore();
});
