// ============================================================================
// The /admin sign-in gate — DOM-level click verification.
//
// A staff member who opens /admin without a session sees the "Nexora Admin"
// card whose only control is the Sign in button. That button calls
// onRequireAuth, which opens the shared AuthModal — but the modal used to be
// rendered only in branches AFTER the /admin early return, so on /admin the
// click set state that mounted nothing and the panel was unreachable. This
// file mounts the REAL App at /admin and proves the wiring a staff member
// depends on:
//
//   • the sign-in card renders for an anonymous visitor;
//   • clicking Sign in opens a REAL auth form (email + password) — the exact
//     regression that dead-ended the admin panel;
//   • the form speaks to staff (no customer "appointment booking" copy, no
//     self-signup: staff accounts come from the Super Admin's onboarding link);
//   • signing in hands the session to the admin gate: get_my_admin_access()
//     is called and the Super Admin shell renders.
// ============================================================================

import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

// The real App reads sessionStorage during render (referral tracker); jsdom's
// window has it but the Node global is not defined by jsdomSetup. Expose it so
// the app code runs its real branch instead of the storage-failure fallback.
if (typeof (globalThis as { sessionStorage?: unknown }).sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
  });
}

/** GoTrue password-grant response for the stubbed auth endpoint. */
function passwordGrantResponse(email: string): string {
  return JSON.stringify({
    access_token: 'staff-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_token: 'staff-refresh-token',
    user: {
      id: 'staff-user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  });
}

async function mountApp(): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App));
  });
  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function wait(check: () => boolean, label: string) {
  for (let i = 0; i < 300 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), `admin sign-in flow did not reach: ${label}. Screen: ${document.body.textContent?.slice(0, 800)}`);
}

function button(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  assert.ok(input, selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

test('an anonymous visitor on /admin can open the sign-in form and reach the Super Admin shell', async () => {
  const originalFetch = globalThis.fetch;
  const rpcCalls: string[] = [];
  try {
    // The Supabase client points at 127.0.0.1:1 (jsdomSetup); every request is
    // answered here so the App, its auth observer and the admin gate all run
    // their real code against a stubbed transport.
    const stub = (async (input: any, init?: any) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname === '/auth/v1/token') {
        return new Response(passwordGrantResponse('admin@nexora.local'), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/rest/v1/rpc/get_my_admin_access') {
        rpcCalls.push('get_my_admin_access');
        return new Response(
          JSON.stringify({ is_admin: true, role: 'super_admin', work_area: null, can_manage_money: true }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      // Table selects (owner hydration, RLS diagnostics) expect arrays; RPCs
      // expect objects. Both succeed empty so the post-sign-in effects run
      // their real code without privileged data.
      const isTableSelect = url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/');
      return new Response(JSON.stringify(isTableSelect ? [] : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
    globalThis.fetch = stub;
    (dom.window as any).fetch = stub;

    dom.reconfigure({ url: 'http://localhost:3000/admin' });
    const { host, unmount } = await mountApp();

    try {
      // 1. The anonymous gate: the staff sign-in card, not a blank page.
      assert.match(host.textContent || '', /Nexora Admin/);
      assert.match(host.textContent || '', /Sign in with your staff account/);
      assert.equal(host.querySelector('input[name="auth-email"]'), null, 'no auth form before the click');

      // 2. THE REGRESSION: clicking Sign in must mount the auth form.
      const signIn = button(host, 'Sign in');
      assert.ok(signIn, 'the sign-in card has a Sign in button');
      await act(async () => {
        signIn!.click();
      });
      await wait(
        () => !!host.querySelector('input[name="auth-email"]') && !!host.querySelector('input[name="auth-password"]'),
        'email + password form after clicking Sign in'
      );

      // 3. Staff-facing copy: this is the admin panel, not the booking flow,
      //    and there is no self-signup (staff accounts are provisioned by the
      //    Super Admin through onboarding links).
      const modalText = host.textContent || '';
      assert.doesNotMatch(modalText, /appointment booking|Continue to booking/i);
      assert.doesNotMatch(modalText, /Create one|Don't have an account/i);

      // 4. Sign in: the session reaches the admin gate and the shell renders.
      await fill('input[name="auth-email"]', 'admin@nexora.local');
      await fill('input[name="auth-password"]', 'Admin#12345');
      const form = host.querySelector('form');
      assert.ok(form, 'auth form element');
      await act(async () => {
        form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      });

      await wait(() => rpcCalls.includes('get_my_admin_access'), 'get_my_admin_access called after sign-in');
      await wait(() => (host.textContent || '').includes('Super Admin'), 'Super Admin shell rendered');
      // The panel behind the gate is the real shell: role chip, staff nav and
      // the overview counters. (The modal's own exit animation cannot be
      // observed here — jsdom's no-op rAF never lets motion finish it — so its
      // close-on-success contract is covered by the AuthModal unit tests.)
      assert.match(host.textContent || '', /Team & roles/);
      assert.match(host.textContent || '', /Overview/);
    } finally {
      await unmount();
    }
  } finally {
    globalThis.fetch = originalFetch;
    (dom.window as any).fetch = originalFetch;
  }
});
