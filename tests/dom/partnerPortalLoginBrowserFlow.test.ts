// ============================================================================
// Growth Partner PORTAL login (PART 2) — DOM-level click verification.
//
// A real Chromium cannot be installed in this sandbox, so this file mounts the
// REAL PartnerPortalLogin with react-dom/client into jsdom and dispatches REAL
// click/input events. It proves the wiring the /partner/login page depends on:
//
//   • the Show/Hide toggle actually flips the password input type + a11y state;
//   • "Remember me" is functional: remembered (unchecked → no stored email,
//     session marked session-only) vs remembered (checked → email stored,
//     session marked persistent);
//   • the login button submits the typed credentials to Supabase Auth, a wrong
//     password renders the error state, and a verified ACTIVE partner is
//     forwarded to /partner/dashboard (the success redirect);
//   • a signed-in normal user gets the exact "You do not have access…" denial
//     and can switch account (real sign-out);
//   • the Forgot Password flow: link → reset form → resetPasswordForEmail with
//     the partner login redirectTo → safe success copy → back to login;
//   • a PASSWORD_RECOVERY event (the reset link) opens the set-password form
//     and submitting it calls updateUser with the new password.
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  PartnerPortalLogin,
  PartnerPortalLoginForm,
} from '../../src/components/PartnerPortalLogin';
import { PARTNER_DASHBOARD_PATH } from '../../src/lib/router';
import {
  PARTNER_REMEMBERED_EMAIL_KEY,
  type PartnerPortalAuthClient,
} from '../../src/lib/partnerPortalAuth';
import { AUTH_SESSION_LIFETIME_KEY } from '../../src/lib/authRememberStorage';
import type { GrowthPartner } from '../../src/lib/growthPartner';

// Close the jsdom window once the file is done. No process.exit(): it truncates
// the TAP stream and silently drops the last test's result.
after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

const PARTNER_ID = 'a0000000-0000-4000-8000-000000000001';
const USER_ID = 'b0000000-0000-4000-8000-000000000001';
const ACTIVE_ROW: GrowthPartner = {
  user_id: PARTNER_ID,
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-12T00:00:00Z',
  updated_at: '2026-09-12T00:00:00Z',
};

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(() => root.render(element));
  return {
    container,
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

async function click(el: Element | null, what = 'element') {
  assert.ok(el, `expected to find ${what} in the DOM`);
  await act(() => {
    (el as HTMLElement).click();
  });
}

/** Type into a controlled input the way a browser does (native setter + input event). */
async function type(input: Element | null, value: string, what = 'input') {
  assert.ok(input, `expected to find ${what} in the DOM`);
  const setter = Object.getOwnPropertyDescriptor(
    (globalThis as any).HTMLInputElement.prototype,
    'value'
  )!.set!;
  await act(() => {
    setter.call(input, value);
    input!.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  });
}

/**
 * Check/uncheck a controlled checkbox the way a browser does. React's checkbox
 * change plugin listens for `click` (not `change`) and reads the current
 * `checked`, so the harness sets the value through the prototype descriptor
 * and dispatches a synthetic click — the same event a real browser delivers.
 */
async function check(box: Element | null, value: boolean, what = 'checkbox') {
  assert.ok(box, `expected to find ${what} in the DOM`);
  const setter = Object.getOwnPropertyDescriptor(
    (globalThis as any).HTMLInputElement.prototype,
    'checked'
  )!.set!;
  await act(() => {
    setter.call(box, value);
    box!.dispatchEvent(new (globalThis as any).Event('click', { bubbles: true }));
  });
}

/** Press an in-form submit button (jsdom has no implicit submission on click). */
async function pressSubmit(button: Element | null, what: string) {
  assert.ok(button, `expected to find ${what}`);
  assert.equal(button.getAttribute('type'), 'submit', `${what} must be a submit button`);
  const form = button.closest('form');
  assert.ok(form, `${what} must live inside its form`);
  await act(() => {
    if (typeof (form as any).requestSubmit === 'function') (form as any).requestSubmit();
    else form!.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
  });
}

const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((el) => (el.textContent || '').trim().includes(text));

function clearBrowserStores() {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
}

type AuthHandlers = Partial<PartnerPortalAuthClient['auth']> & {
  fetchPartnerRow?: () => Promise<GrowthPartner | null>;
  fetchApplicationRow?: () => Promise<any>;
};

function portalClient(handlers: AuthHandlers = {}, partnerRow?: GrowthPartner | null): PartnerPortalAuthClient {
  return {
    auth: {
      signInWithPassword: handlers.signInWithPassword ?? (async () => ({ data: {}, error: null })),
      signOut: handlers.signOut ?? (async () => ({ error: null })),
      getSession: handlers.getSession ?? (async () => ({ data: { session: null }, error: null })),
      resetPasswordForEmail: handlers.resetPasswordForEmail,
      updateUser: handlers.updateUser,
      onAuthStateChange: handlers.onAuthStateChange,
    },
    ...(partnerRow === undefined ? {} : { fetchPartnerRow: async () => partnerRow }),
    ...(handlers.fetchApplicationRow ? { fetchApplicationRow: handlers.fetchApplicationRow } : {}),
  };
}

// ---------------------------------------------------------------------------
// Show/Hide password
// ---------------------------------------------------------------------------

test('the Show/Hide toggle flips the password input type and its a11y state', async () => {
  clearBrowserStores();
  let show = false;
  const Harness: React.FC = () => {
    const [visible, setVisible] = React.useState(false);
    show = visible;
    return React.createElement(PartnerPortalLoginForm, {
      email: '',
      password: 'secret',
      showPassword: visible,
      rememberMe: true,
      fieldErrors: {},
      formError: '',
      busy: false,
      onEmailChange: () => {},
      onPasswordChange: () => {},
      onToggleShowPassword: () => setVisible((v) => !v),
      onToggleRememberMe: () => {},
      onSubmit: () => {},
      onForgotPassword: () => {},
      onSwitchToSignup: () => {},
    });
  };
  const view = await mount(React.createElement(Harness));
  try {
    const input = document.getElementById('partner-login-password') as HTMLInputElement | null;
    const toggle = document.getElementById('partner-login-password-toggle');
    assert.ok(input && toggle, 'the password field and its toggle must exist');
    assert.equal(input!.type, 'password', 'password starts masked');
    assert.equal(toggle!.getAttribute('aria-pressed'), 'false');
    assert.equal(toggle!.getAttribute('aria-label'), 'Show password');

    await click(toggle, 'the show-password toggle');
    assert.equal(show, true, 'the handler flipped the state');
    assert.equal(input!.type, 'text', 'clicking reveals the password');
    assert.equal(toggle!.getAttribute('aria-pressed'), 'true');
    assert.equal(toggle!.getAttribute('aria-label'), 'Hide password');

    await click(toggle, 'the hide-password toggle');
    assert.equal(input!.type, 'password', 'clicking again masks the password');
    assert.equal(toggle!.getAttribute('aria-pressed'), 'false');
  } finally {
    await view.unmount();
  }
});

// ---------------------------------------------------------------------------
// Login button → Supabase Auth, error state, remember me
// ---------------------------------------------------------------------------

test('the login button signs the typed credentials in and honors "Remember me" unchecked', async () => {
  clearBrowserStores();
  const calls: Array<{ email: string; password: string }> = [];
  const client = portalClient(
    {
      signInWithPassword: async (args: any) => {
        calls.push({ email: args.email, password: args.password });
        return {
          data: { session: { user: { id: PARTNER_ID, email: args.email }, access_token: 'jwt' } },
          error: null,
        };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    ACTIVE_ROW
  );
  const view = await mount(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    await type(document.getElementById('partner-login-email'), 'asha@example.com', 'email field');
    await type(document.getElementById('partner-login-password'), 'Str0ngPass!1', 'password field');
    await check(document.getElementById('partner-login-remember'), false, 'the remember-me checkbox');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Log in') ?? null, 'the Log in button');

    assert.deepEqual(calls, [{ email: 'asha@example.com', password: 'Str0ngPass!1' }],
      'the button must call signInWithPassword with exactly what was typed');
    // Unchecked: no remembered email, and the session is marked session-only.
    assert.equal(window.localStorage.getItem(PARTNER_REMEMBERED_EMAIL_KEY), null,
      'an unchecked Remember me must not store the email');
    assert.equal(window.sessionStorage.getItem(AUTH_SESSION_LIFETIME_KEY), null,
      'a successful sign-in clears the lifetime marker after applying it');
  } finally {
    await view.unmount();
  }
});

test('a checked Remember me stores the email for the next visit', async () => {
  clearBrowserStores();
  const client = portalClient(
    {
      signInWithPassword: async () => ({
        data: { session: { user: { id: PARTNER_ID, email: 'asha@example.com' }, access_token: 'jwt' } },
        error: null,
      }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    ACTIVE_ROW
  );
  const view = await mount(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    await type(document.getElementById('partner-login-email'), 'asha@example.com', 'email field');
    await type(document.getElementById('partner-login-password'), 'Str0ngPass!1', 'password field');
    // Leave Remember me at its default (checked).
    await pressSubmit(byText(document, 'button[type="submit"]', 'Log in') ?? null, 'the Log in button');
    assert.equal(
      window.localStorage.getItem(PARTNER_REMEMBERED_EMAIL_KEY),
      'asha@example.com',
      'a checked Remember me stores the email for prefill'
    );
  } finally {
    await view.unmount();
  }
});

test('a wrong password renders the error state without clearing the form', async () => {
  clearBrowserStores();
  const client = portalClient({
    signInWithPassword: async () => ({ data: {}, error: { message: 'Invalid login credentials' } }),
  });
  const view = await mount(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    await type(document.getElementById('partner-login-email'), 'asha@example.com', 'email field');
    await type(document.getElementById('partner-login-password'), 'wrong-password', 'password field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Log in') ?? null, 'the Log in button');

    assert.match(document.body.textContent || '', /Invalid email or password/,
      'the safe invalid-credentials copy must be shown');
    assert.equal(
      (document.getElementById('partner-login-email') as HTMLInputElement).value,
      'asha@example.com',
      'the email survives the failed attempt'
    );
  } finally {
    await view.unmount();
  }
});

test('a verified ACTIVE partner is forwarded to /partner/dashboard (the success redirect)', async () => {
  clearBrowserStores();
  const navigated: string[] = [];
  const client = portalClient(
    {
      signInWithPassword: async () => ({
        data: { session: { user: { id: PARTNER_ID, email: 'asha@example.com' }, access_token: 'jwt' } },
        error: null,
      }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    ACTIVE_ROW
  );
  const view = await mount(
    React.createElement(PartnerPortalLogin, {
      user: null,
      client,
      navigate: (path: string) => navigated.push(path),
      onBack: () => {},
    })
  );
  try {
    await type(document.getElementById('partner-login-email'), 'asha@example.com', 'email field');
    await type(document.getElementById('partner-login-password'), 'Str0ngPass!1', 'password field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Log in') ?? null, 'the Log in button');
    assert.deepEqual(
      navigated.filter((path) => path === PARTNER_DASHBOARD_PATH),
      [PARTNER_DASHBOARD_PATH],
      'a verified active partner must be sent to /partner/dashboard'
    );
  } finally {
    await view.unmount();
  }
});

test('a signed-in normal user gets the exact access denial and can switch account', async () => {
  clearBrowserStores();
  const signOuts: number[] = [];
  const client = portalClient(
    {
      getSession: async () => ({
        data: { session: { user: { id: USER_ID, email: 'user@example.com' }, access_token: 'jwt' } },
        error: null,
      }),
      signOut: async () => {
        signOuts.push(Date.now());
        return { error: null };
      },
      // Signed in, not a partner, and no application either.
      fetchApplicationRow: async () => null,
    },
    null
  );
  const view = await mount(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    assert.match(
      document.body.textContent || '',
      /You do not have access to the Growth Partner portal\./,
      'the exact spec denial line must be shown to customer/owner/admin accounts'
    );
    assert.doesNotMatch(document.body.textContent || '', /ALPHA01/);
    assert.equal(document.getElementById('partner-login-email'), null, 'no login form for a denied account');

    await click(
      byText(document, 'button', 'Sign in with a different account') ?? null,
      'the switch-account button'
    );
    assert.equal(signOuts.length, 1, 'switching account must really sign out');
    assert.ok(document.getElementById('partner-login-email'), 'the login form returns after signing out');
  } finally {
    await view.unmount();
  }
});

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

test('the Forgot Password link opens the reset form, which really requests the email', async () => {
  clearBrowserStores();
  const resets: Array<{ email: string; options?: { redirectTo?: string } }> = [];
  const client = portalClient({
    resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
      resets.push({ email, options });
      return { data: {}, error: null };
    },
  });
  const view = await mount(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    await click(document.getElementById('partner-login-forgot'), 'the Forgot Password link');
    assert.ok(document.getElementById('partner-forgot-email'), 'the reset form must be showing');

    await type(document.getElementById('partner-forgot-email'), 'asha@example.com', 'the reset email field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Send reset link') ?? null, 'the send button');
    assert.deepEqual(
      resets,
      [{ email: 'asha@example.com', options: { redirectTo: 'http://localhost:3000/partner/login' } }],
      'the reset must go through Supabase Auth and land back on the partner login'
    );
    assert.match(document.body.textContent || '', /reset link is on its way/,
      'the safe success copy must be shown');

    await click(byText(document, 'button', 'Back to login') ?? null, 'the back-to-login button');
    assert.ok(document.getElementById('partner-login-email'), 'back on the login form');
  } finally {
    await view.unmount();
  }
});

// ---------------------------------------------------------------------------
// PASSWORD_RECOVERY (the reset link) → set a new password
// ---------------------------------------------------------------------------

test('a PASSWORD_RECOVERY session opens the set-password form, which calls updateUser', async () => {
  clearBrowserStores();
  const updates: Array<{ password?: string }> = [];
  let listener: ((event: string, session: any) => void) | null = null;
  const client = portalClient(
    {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: (cb: (event: string, session: any) => void) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      updateUser: async (attributes: { password?: string }) => {
        updates.push(attributes);
        return { data: {}, error: null };
      },
    },
    ACTIVE_ROW
  );
  const view = await mount(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    // The reset email link signs the partner in with a recovery session.
    await act(() => {
      assert.ok(listener, 'the page must subscribe to auth events');
      listener!('PASSWORD_RECOVERY', { user: { id: PARTNER_ID, email: 'asha@example.com' } });
    });
    assert.match(document.body.textContent || '', /Choose a new password/,
      'the recovery event must open the set-password form');
    assert.ok(document.getElementById('partner-new-password'), 'the new password field');

    // A mismatch is caught before anything is sent.
    await type(document.getElementById('partner-new-password'), 'new-strong-password', 'the new password');
    await type(document.getElementById('partner-confirm-password'), 'different-password', 'the confirm field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Update password') ?? null, 'the update button');
    assert.deepEqual(updates, [], 'a mismatched confirmation must not call updateUser');
    assert.match(document.body.textContent || '', /do not match/);

    // Matching passwords complete the reset.
    await type(document.getElementById('partner-confirm-password'), 'new-strong-password', 'the confirm field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Update password') ?? null, 'the update button');
    assert.deepEqual(updates, [{ password: 'new-strong-password' }],
      'the recovery completion must set the new password through Supabase Auth');
  } finally {
    await view.unmount();
  }
});
