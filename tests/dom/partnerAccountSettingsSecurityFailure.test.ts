import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PartnerAccountSettingsPage } from '../../src/components/PartnerAccountSettingsPage';
import type { SecurityOverviewClient } from '../../src/lib/partnerAccountSecurity';

// ============================================================================
// The ACCOUNT SETTINGS failure path, driven like a browser.
//
// The bug: the page fetched the security overview once and, when that single
// RPC rejected, replaced the WHOLE route with an error card — so Change Email,
// Change Password, 2FA, Sessions and the Danger Zone disappeared with it, and
// "Retry" re-ran a fetch with no attempt accounting.
//
// These tests pin the contract that replaced it:
//   • one failed read degrades ONE section, never the route;
//   • the retry control re-fetches and the page heals;
//   • transient failures are retried automatically before the error is shown.
// ============================================================================

after(() => dom.window.close());

const change = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  assert.ok(el);
  await act(async () => {
    const proto = el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const click = async (el: Element | undefined | null, label?: string) => {
  assert.ok(el, label || 'element');
  await act(async () => { (el as HTMLElement).click(); });
};
const wait = async (check: () => boolean, message = 'UI settled', iterations = 400) => {
  for (let i = 0; i < iterations && !check(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.ok(check(), message);
};

const SESSIONS = [
  { id: 'sess-current', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0', ip: '10.0.0.1', created_at: '2026-09-18T09:00:00Z', updated_at: '2026-09-19T08:00:00Z', is_current: true },
  { id: 'sess-other', user_agent: 'Mozilla/5.0 (iPhone) Safari/605', ip: '10.0.0.2', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-19T07:00:00Z', is_current: false },
];

/** A client whose overview RPC fails a fixed number of times, then succeeds. */
function failingClient(options: { failTimes?: number; error?: any; throws?: boolean } = {}) {
  const calls: any[] = [];
  const overview = {
    two_factor_enabled: false,
    sessions_available: true,
    sessions: SESSIONS,
    events: [{ id: 'ev-1', event_type: 'credentials_changed', detail: 'Password rotated.', created_at: '2026-09-19T06:00:00Z' }],
    deactivation: null,
  };
  let failuresLeft = options.failTimes ?? 1;
  const client: any = {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ rpc: fn, args });
      if (fn === 'get_my_partner_security_overview') {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          if (options.throws) throw new Error('fetch failed');
          return { data: null, error: options.error ?? { code: 'PGRST202', message: 'Could not find the function public.get_my_partner_security_overview() in the schema cache' } };
        }
        return { data: overview, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'meera@example.com' } }, error: null }),
      updateUser: async (attributes: any) => {
        calls.push({ auth: 'updateUser', attributes });
        return { data: { user: { id: 'u1' } }, error: null };
      },
      signInWithPassword: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      mfa: {
        listFactors: async () => ({ data: { factors: [] }, error: null }),
        enroll: async () => ({ data: { id: 'factor-1', totp: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Nexora:meera@example.com?secret=JBSWY3DPEHPK3PXP', qr_code: '' } }, error: null }),
        challenge: async () => ({ data: { id: 'ch-1' }, error: null }),
        verify: async () => ({ data: { success: true }, error: null }),
        unenroll: async () => ({ data: { id: 'factor-1' }, error: null }),
      },
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  return client as SecurityOverviewClient & { calls: any[] };
}

function page(client: SecurityOverviewClient) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const mount = async () => {
    await act(async () => root.render(React.createElement(PartnerAccountSettingsPage, {
      client,
      email: 'meera@example.com',
      expectedUserId: 'u1',
      displayName: 'Meera Partner',
      navigate: () => {},
    })));
  };
  const input = (field: string) => host.querySelector(`[data-account-field="${field}"]`) as HTMLInputElement | null;
  const action = (name: string) => host.querySelector(`[data-account-action="${name}"]`) as HTMLButtonElement | null;
  const unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  return { host, mount, input, action, unmount };
}

test('a failed security overview degrades that section only — the rest of Account Settings stays usable', async () => {
  const client = failingClient({ failTimes: 99, error: { code: 'PGRST202', message: 'Could not find the function public.get_my_partner_security_overview() in the schema cache' } });
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.host.querySelector('[data-partner-account-settings]'), 'the page renders');
    await wait(() => !!ui.host.querySelector('[data-account-overview-error]'), 'the failure is shown');

    // The route still renders every section that does NOT depend on the read.
    assert.ok(ui.host.querySelector('[data-account-section="change-email"]'), 'change email survives');
    assert.ok(ui.input('new-email'), 'the new-email input is live');
    assert.ok(ui.host.querySelector('[data-account-section="change-password"]'), 'change password survives');
    assert.ok(ui.action('toggle-danger-zone'), 'the danger zone survives');
    assert.ok(ui.host.querySelector('[data-account-section="sessions"]'), 'the sessions section survives');

    // The email form still works end to end (it never needed the overview).
    await change(ui.input('new-email')!, 'new@example.com');
    await change(ui.input('confirm-email')!, 'new@example.com');
    await click(ui.action('request-email-change')!, 'request email change');
    await wait(() => client.calls.some((entry) => entry.auth === 'updateUser'), 'the email change still goes through Auth');

    // Honest copy: raw Postgres/PostgREST text never reaches the surface.
    const notice = ui.host.querySelector('[data-account-overview-error]')!.textContent!;
    assert.doesNotMatch(notice, /schema cache|PostgREST|PGRST/i);
    assert.match(notice, /security overview/i);
    assert.ok(ui.action('retry-security-overview'), 'a retry control is offered');

    // No invented state: an unknown 2FA status is never shown as "2FA off".
    assert.equal(ui.host.querySelector('[data-account-2fa-state]')?.getAttribute('data-account-2fa-state'), 'unknown');
    assert.doesNotMatch(ui.host.textContent!, /2FA off/);
    assert.equal(ui.host.querySelector('[data-account-session-count]'), null, 'no session count is invented');
    assert.ok(ui.host.querySelector('[data-account-sessions-unavailable]'), 'the sessions list says it could not load');
  } finally {
    await ui.unmount();
  }
});

test('a partner-scoped refusal says so, and the page still renders', async () => {
  const client = failingClient({ failTimes: 99, error: { code: '42501', message: 'Active Growth Partner required' } });
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.host.querySelector('[data-account-overview-error]'), 'the failure is shown');
    const notice = ui.host.querySelector('[data-account-overview-error]')!;
    assert.equal(notice.getAttribute('data-account-overview-error-kind'), 'forbidden');
    assert.doesNotMatch(notice.textContent!, /Active Growth Partner required/);
    assert.ok(ui.host.querySelector('[data-account-section="change-password"]'), 'the page still renders');
  } finally {
    await ui.unmount();
  }
});

test('Retry re-fetches the overview and the page heals itself', async () => {
  const client = failingClient({ failTimes: 1, error: { code: '42501', message: 'Active Growth Partner required' } });
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.host.querySelector('[data-account-overview-error]'), 'the failure is shown');
    const attemptsBefore = client.calls.filter((entry) => entry.rpc === 'get_my_partner_security_overview').length;

    await click(ui.action('retry-security-overview')!, 'press retry');

    await wait(() => client.calls.filter((entry) => entry.rpc === 'get_my_partner_security_overview').length > attemptsBefore, 'retry re-fetches');
    await wait(() => ui.host.querySelectorAll('[data-account-session]').length === 2, 'the sessions render after the retry');
    await wait(() => !ui.host.querySelector('[data-account-overview-error]'), 'the error clears');
    assert.equal(ui.host.querySelector('[data-account-2fa-state]')?.getAttribute('data-account-2fa-state'), 'off');
    assert.ok(ui.host.textContent!.includes('Password changed'), 'the security log renders');
  } finally {
    await ui.unmount();
  }
});

test('a transient failure is retried automatically before the error is shown', async () => {
  const client = failingClient({ failTimes: 1, throws: true });
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => ui.host.querySelectorAll('[data-account-session]').length === 2, 'the automatic retry recovers');
    assert.equal(ui.host.querySelector('[data-account-overview-error]'), null, 'no error is shown for a transient blip');
    assert.equal(
      client.calls.filter((entry) => entry.rpc === 'get_my_partner_security_overview').length,
      2,
      'exactly one automatic retry'
    );
  } finally {
    await ui.unmount();
  }
});
