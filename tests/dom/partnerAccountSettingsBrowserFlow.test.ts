import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PartnerAccountSettingsPage } from '../../src/components/PartnerAccountSettingsPage';
import type { SecurityOverviewClient } from '../../src/lib/partnerAccountSecurity';

// ============================================================================
// The ACCOUNT SETTINGS page, driven like a browser: open the 2FA QR modal,
// verify a code, change email/password with validation, revoke other sessions
// and file a deactivation request — against a mock client that records the
// exact RPC/Auth calls.
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
const wait = async (check: () => boolean, message = 'UI settled', iterations = 100) => {
  for (let i = 0; i < iterations && !check(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.ok(check(), message);
};

const SESSIONS = [
  { id: 'sess-current', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0', ip: '10.0.0.1', created_at: '2026-09-18T09:00:00Z', updated_at: '2026-09-19T08:00:00Z', is_current: true },
  { id: 'sess-other', user_agent: 'Mozilla/5.0 (iPhone) Safari/605', ip: '10.0.0.2', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-19T07:00:00Z', is_current: false },
];
const EVENTS = [
  { id: 'ev-1', event_type: 'credentials_changed', detail: 'Password rotated from the account page.', created_at: '2026-09-19T06:00:00Z' },
];

function mockClient() {
  const calls: any[] = [];
  const enrolledFactors: Array<{ id: string; factor_type: string; status: string }> = [];
  let overview: any = {
    two_factor_enabled: false,
    sessions_available: true,
    sessions: SESSIONS,
    events: EVENTS,
    deactivation: null,
  };
  const client: any = {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ rpc: fn, args });
      if (fn === 'get_my_partner_security_overview') return { data: overview, error: null };
      if (fn === 'revoke_my_other_partner_sessions') {
        overview = { ...overview, sessions: overview.sessions.filter((s: any) => s.is_current) };
        return { data: 1, error: null };
      }
      if (fn === 'set_my_partner_two_factor') {
        overview = { ...overview, two_factor_enabled: args?.p_enabled === true };
        return { data: { two_factor_enabled: args?.p_enabled }, error: null };
      }
      if (fn === 'request_my_partner_account_deactivation') {
        overview = { ...overview, deactivation: { id: 'req-1', reason: args?.p_reason ?? null, status: 'pending', requested_at: '2026-09-19T09:00:00Z' } };
        return { data: { id: 'req-1', status: 'pending', requested_at: '2026-09-19T09:00:00Z' }, error: null };
      }
      if (fn === 'cancel_my_partner_account_deactivation') {
        overview = { ...overview, deactivation: null };
        return { data: { status: 'cancelled' }, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'meera@example.com' } }, error: null }),
      updateUser: async (attributes: any) => {
        calls.push({ auth: 'updateUser', attributes });
        return { data: { user: { id: 'u1' } }, error: null };
      },
      signInWithPassword: async (credentials: any) => {
        calls.push({ auth: 'signInWithPassword', credentials });
        if (credentials.password === 'WrongCurrent1') return { data: null, error: { message: 'Invalid login credentials' } };
        return { data: { user: { id: 'u1' } }, error: null };
      },
      mfa: {
        listFactors: async () => ({ data: { factors: enrolledFactors }, error: null }),
        enroll: async (attrs: any) => {
          calls.push({ mfa: 'enroll', attrs });
          enrolledFactors.push({ id: 'factor-1', factor_type: 'totp', status: 'unverified' });
          return {
            data: {
              id: 'factor-1',
              type: 'totp',
              totp: { qr_code: '', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Nexora:meera@example.com?secret=JBSWY3DPEHPK3PXP' },
            },
            error: null,
          };
        },
        challenge: async (attrs: any) => { calls.push({ mfa: 'challenge', attrs }); return { data: { id: 'ch-1' }, error: null }; },
        verify: async (attrs: any) => {
          calls.push({ mfa: 'verify', attrs });
          if (attrs.code === '000000') return { data: null, error: { message: 'Invalid TOTP code' } };
          const factor = enrolledFactors.find((f) => f.id === attrs.factorId);
          if (factor) factor.status = 'verified';
          return { data: { success: true }, error: null };
        },
        unenroll: async (attrs: any) => {
          calls.push({ mfa: 'unenroll', attrs });
          const idx = enrolledFactors.findIndex((f) => f.id === attrs.factorId);
          if (idx >= 0) enrolledFactors.splice(idx, 1);
          return { data: { id: attrs.factorId }, error: null };
        },
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

test('the account settings page renders sessions, the security log and validates the email form', async () => {
  const client = mockClient();
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.host.querySelector('[data-partner-account-settings]'), 'the page renders');
    // Sessions: two rows, the current one badged.
    assert.equal(ui.host.querySelectorAll('[data-account-session]').length, 2);
    assert.ok(ui.host.querySelector('[data-account-session="current"]')!.textContent!.includes('This device'));
    assert.ok(ui.host.textContent!.includes('10.0.0.2'), 'the other session shows its IP');
    assert.equal(ui.host.querySelectorAll('[data-account-session="other"]').length, 1);
    // Security log.
    assert.ok(ui.host.querySelector('[data-account-section="security-log"]')!.textContent!.includes('Password changed'));

    // Duplicate email (same as current) refuses with a visible message and a
    // disabled submit — the duplicate-submission guard.
    await change(ui.input('new-email')!, 'meera@example.com');
    assert.ok(ui.host.textContent!.includes('same as your current email'));
    assert.equal(ui.action('request-email-change')!.disabled, true, 'duplicate request is not even submittable');

    // A proper request goes through Auth and never through a profile RPC.
    await change(ui.input('new-email')!, 'new@example.com');
    await change(ui.input('confirm-email')!, 'new@example.com');
    await click(ui.action('request-email-change')!, 'request email change');
    await wait(() => client.calls.some((entry) => entry.auth === 'updateUser'));
    assert.deepEqual(client.calls.find((entry) => entry.auth === 'updateUser').attributes, { email: 'new@example.com' });
    assert.ok(client.calls.some((entry) => entry.rpc === 'log_my_partner_security_event'), 'the audit event is logged');
    await wait(() => !!ui.host.querySelector('[data-partner-toast="success"]'), 'the success toast appears');
  } finally {
    await ui.unmount();
  }
});

test('password change validates confirmation and verifies the current password', async () => {
  const client = mockClient();
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.host.querySelector('[data-partner-account-settings]'));

    // Mismatched confirmation is caught client-side: no auth calls at all.
    await change(ui.input('current-password')!, 'OldPass#1');
    await change(ui.input('new-password')!, 'NewPass#2026');
    await change(ui.input('confirm-password')!, 'Different1');
    await click(ui.action('change-password')!, 'submit mismatched');
    assert.match(ui.host.textContent!, /Passwords do not match/);
    assert.equal(client.calls.filter((entry) => entry.auth).length, 0, 'nothing sent on mismatch');

    // Wrong current password: the sign-in check refuses before update.
    await change(ui.input('confirm-password')!, 'NewPass#2026');
    await change(ui.input('current-password')!, 'WrongCurrent1');
    await click(ui.action('change-password')!, 'submit wrong current');
    await wait(() => client.calls.some((entry) => entry.auth === 'signInWithPassword'));
    assert.equal(client.calls.some((entry) => entry.auth === 'updateUser'), false, 'a refused current password never rotates');

    // The happy path rotates through Auth.
    await change(ui.input('current-password')!, 'OldPass#1');
    await click(ui.action('change-password')!, 'submit valid');
    await wait(() => client.calls.some((entry) => entry.auth === 'updateUser' && entry.attributes.password === 'NewPass#2026'));
  } finally {
    await ui.unmount();
  }
});

test('enabling 2FA shows the QR modal, verifies the code and flips the state', async () => {
  const client = mockClient();
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.action('enable-2fa'), 'the page with 2FA off');
    await click(ui.action('enable-2fa')!, 'enable 2fa');
    await wait(() => !!ui.host.querySelector('[data-account-modal]'), 'the setup modal opens');
    assert.ok(ui.host.querySelector('[data-account-totp-secret]')!.textContent!.includes('JBSWY3DPEHPK3PXP'), 'the manual key is shown');

    // A wrong code stays in the modal with an inline error and NO mirror write.
    await change(ui.input('totp-code')!, '000000');
    const btn = ui.action('verify-2fa')!;
    const form = btn.closest('form')!;
    (btn as any).addEventListener('click', () => process.stderr.write('\nBTN_CLICK'));
    form.addEventListener('submit', () => process.stderr.write('\nFORM_SUBMIT'));
    process.stderr.write('\nVALID=' + (form as any).checkValidity() + ' BTN_VALID=' + (btn as any).validity.valid + ' INPUT_VALID=' + (ui.input('totp-code') as any).validity.valid);
    await click(btn, 'verify wrong code');
    await wait(() => ui.host.textContent!.includes('did not match'), 'the inline code error: ' + JSON.stringify({ modal: !!ui.host.querySelector('[data-account-modal]'), calls: client.calls.filter((c) => c.mfa).map((c) => c.mfa), toasts: ui.host.querySelector('[data-partner-toast-center]')?.textContent }));
    assert.equal(client.calls.some((entry) => entry.rpc === 'set_my_partner_two_factor'), false);

    // The right code verifies and mirrors on.
    await change(ui.input('totp-code')!, '123456');
    await click(ui.action('verify-2fa')!, 'verify code');
    await wait(() => client.calls.some((entry) => entry.rpc === 'set_my_partner_two_factor'));
    const flow = client.calls.filter((entry) => entry.mfa).map((entry) => entry.mfa);
    assert.deepEqual(flow, ['enroll', 'challenge', 'verify', 'challenge', 'verify']);
    // The QR canvas fallback in jsdom is slow; allow a generous settle window.
    await wait(() => !!ui.action('disable-2fa'), 'the toggle flips to on', 400);

    // Disable: confirmation modal, then unenroll + mirror off.
    await click(ui.action('disable-2fa')!, 'disable 2fa');
    await wait(() => !!ui.action('confirm-disable-2fa'));
    await click(ui.action('confirm-disable-2fa')!, 'confirm disable');
    await wait(() => client.calls.some((entry) => entry.rpc === 'set_my_partner_two_factor' && entry.args.p_enabled === false));
    await wait(() => !!ui.action('enable-2fa'), 'back to off');
  } finally {
    await ui.unmount();
  }
});

test('revoke-sessions confirms, calls the RPC and drops the other rows from the list', async () => {
  const client = mockClient();
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.action('revoke-sessions'), 'the page renders');
    await click(ui.action('revoke-sessions')!, 'open revoke modal');
    await wait(() => !!ui.action('confirm-revoke-sessions'));
    await click(ui.action('confirm-revoke-sessions')!, 'confirm revoke');
    await wait(() => client.calls.some((entry) => entry.rpc === 'revoke_my_other_partner_sessions'));
    await wait(() => ui.host.querySelectorAll('[data-account-session]').length === 1, 'only the current session remains');
  } finally {
    await ui.unmount();
  }
});

test('the danger zone files a deactivation request and can cancel it', async () => {
  const client = mockClient();
  const ui = page(client);
  try {
    await ui.mount();
    await wait(() => !!ui.action('toggle-danger-zone'));
    await click(ui.action('toggle-danger-zone')!, 'open danger zone');
    await click(ui.action('request-deactivation')!, 'open the confirm modal');
    await wait(() => !!ui.action('confirm-deactivation'));
    await change(ui.input('deactivation-reason')!, 'Taking a break');
    await click(ui.action('confirm-deactivation')!, 'file the request');
    await wait(() => client.calls.some((entry) => entry.rpc === 'request_my_partner_account_deactivation'));
    assert.equal(client.calls.find((entry) => entry.rpc === 'request_my_partner_account_deactivation').args.p_reason, 'Taking a break');
    await wait(() => !!ui.host.querySelector('[data-account-deactivation="pending"]'), 'the pending banner appears');
    await wait(() => !!ui.host.querySelector('[data-account-deactivation-banner]'), 'the header banner appears');

    // Cancelling clears the pending state.
    await click(ui.action('cancel-deactivation')!, 'cancel the request');
    await wait(() => client.calls.some((entry) => entry.rpc === 'cancel_my_partner_account_deactivation'));
    // The refresh collapses the zone again; reopening shows the request action.
    await wait(() => !!ui.action('toggle-danger-zone'), 'the page re-renders');
    await click(ui.action('toggle-danger-zone')!, 'reopen danger zone');
    await wait(() => !!ui.action('request-deactivation'), 'the request button is back');
  } finally {
    await ui.unmount();
  }
});
