// ============================================================================
// G1 (screen level) — the customer sign-in screen had no way back in after a
// forgotten password. These tests mount the REAL `AuthScreen` in jsdom and
// drive real clicks and real input events, so what is pinned here is the
// wiring a customer actually touches:
//
//   1. sign-in mode offers "Forgot password?" and keeps its existing controls
//   2. that link swaps to a recovery form: an address, no password field
//   3. submitting it asks Supabase Auth for a link to `/app/auth` and shows the
//      enumeration-safe copy — the same copy whether or not the address exists
//   4. a reset form appears with a new password + confirmation and no email
//   5. an autofilled 6-character password is accepted (the stale-React-state
//      bug the other auth forms were fixed for must not return here)
//   6. the customer is signed in the moment the password is accepted, because
//      the recovery session is already a real session
//   7. every failure is reported inline in customer words
//   8. the ids the rest of the suite depends on did not move
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AuthScreen, describeAuthError } from '../../src/customer/screens/Auth';
import {
  CUSTOMER_AUTH_PATH,
  RESET_SENT_MESSAGE,
  customerPasswordResetRedirectTo,
} from '../../src/lib/customer/authRecovery';
import { customerPath } from '../../src/lib/router';
import { supabase } from '../../src/lib/supabaseClient';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

// ---------------------------------------------------------------------------
// Harness (same shape as tests/dom/passwordAutofillFix.test.ts)
// ---------------------------------------------------------------------------

const inputSetter = Object.getOwnPropertyDescriptor(
  dom.window.HTMLInputElement.prototype,
  'value'
)!.set!;

async function mount(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** Manual typing: native setter + the input event React listens for. */
async function type(host: HTMLElement, selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector);
  assert.ok(input, `${selector} exists`);
  await act(async () => {
    inputSetter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

/**
 * Password-manager autofill: writes the DOM value with NO event, so React state
 * stays stale exactly as it does in a browser. The submit handler must still
 * validate the visible value.
 */
async function autofill(host: HTMLElement, selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector);
  assert.ok(input, `${selector} exists`);
  await act(async () => {
    inputSetter.call(input, value);
    // Deliberately no event dispatch: that IS the autofill behaviour.
  });
  assert.equal(input.value, value, 'the DOM visibly holds the autofilled value');
}

async function click(host: HTMLElement, selector: string) {
  const button = host.querySelector<HTMLElement>(selector);
  assert.ok(button, `${selector} exists`);
  await act(async () => {
    button.click();
  });
}

const submitForm = async (host: HTMLElement, selector = 'form') =>
  act(async () => {
    host
      .querySelector(selector)!
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });

const wait = async (check: () => boolean, what: string, iterations = 120) => {
  for (let i = 0; i < iterations && !check(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  assert.ok(check(), `UI settled: ${what}`);
};

function stubSharedSupabaseAuth(stubs: Record<string, (...args: any[]) => Promise<any>>) {
  const originals: Record<string, any> = {};
  for (const key of Object.keys(stubs)) {
    originals[key] = (supabase.auth as any)[key];
    (supabase.auth as any)[key] = stubs[key];
  }
  return () => {
    for (const key of Object.keys(originals)) {
      (supabase.auth as any)[key] = originals[key];
    }
  };
}

function authScreen(props: Partial<React.ComponentProps<typeof AuthScreen>> = {}) {
  return React.createElement(AuthScreen, {
    onAuthenticated: () => {},
    onContinueAsGuest: () => {},
    ...props,
  } as any);
}

const text = (host: HTMLElement) => host.textContent ?? '';

// ---------------------------------------------------------------------------
// 1. Sign-in mode: the way in exists, and the old controls did not move
// ---------------------------------------------------------------------------

test('sign-in mode offers a forgot-password way in', async () => {
  const { host, close } = await mount(authScreen({ mode: 'login' }));
  try {
    assert.ok(host.querySelector('#auth-forgot-password-btn'), 'a Forgot password control is rendered');
    assert.match(text(host), /Forgot password\?/);
    assert.ok(host.querySelector('input[name="customer-email"]'), 'the email field is still there');
    assert.ok(host.querySelector('input[name="customer-password"]'), 'the password field is still there');
    assert.ok(host.querySelector('#auth-toggle-mode-btn'), 'create-an-account toggle is still there');
    assert.ok(host.querySelector('#auth-browse-guest-btn'), 'browse-as-guest is still there');
    assert.doesNotMatch(text(host), /Send reset link/);
    assert.doesNotMatch(text(host), /Save new password/);
  } finally {
    await close();
  }
});

test('sign-in keeps current-password autofill hints and never asks for a new one', async () => {
  const { host, close } = await mount(authScreen({ mode: 'login' }));
  try {
    assert.equal(
      host.querySelector<HTMLInputElement>('input[name="customer-password"]')!.getAttribute('autocomplete'),
      'current-password'
    );
    assert.equal(host.querySelector('input[name="customer-new-password"]'), null);
    assert.equal(host.querySelector('input[name="customer-new-password-confirm"]'), null);
  } finally {
    await close();
  }
});

test('sign-up mode still says Create account and hides the recovery link', async () => {
  const { host, close } = await mount(authScreen({ mode: 'signup' }));
  try {
    assert.match(text(host), /Create your account/);
    assert.match(text(host), /Create account/);
    assert.ok(host.querySelector('input[name="customer-full-name"]'));
    assert.ok(host.querySelector('input[name="customer-phone"]'));
    assert.equal(host.querySelector('#auth-forgot-password-btn'), null, 'recovery is offered from sign-in only');
    assert.equal(
      host.querySelector<HTMLInputElement>('input[name="customer-password"]')!.getAttribute('autocomplete'),
      'new-password'
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 2. The recovery form itself
// ---------------------------------------------------------------------------

test('clicking Forgot password swaps to a recovery form with no password field', async () => {
  const { host, close } = await mount(authScreen({ mode: 'login' }));
  try {
    await click(host, '#auth-forgot-password-btn');
    await wait(() => text(host).includes('Reset your password'), 'the recovery heading');

    assert.match(text(host), /Reset your password/);
    assert.match(text(host), /Send reset link/);
    assert.ok(host.querySelector('input[name="customer-email"]'), 'the address is still asked for');
    assert.equal(
      host.querySelector('input[name="customer-password"]'),
      null,
      'a customer who forgot their password must not be shown a password box'
    );
    assert.equal(host.querySelector('input[name="customer-full-name"]'), null, 'signup-only fields stay hidden');
    assert.equal(host.querySelector('#auth-toggle-mode-btn'), null, 'the login/signup toggle is replaced');
    assert.ok(host.querySelector('#auth-back-to-login-btn'), 'there is a way back to sign in');
  } finally {
    await close();
  }
});

test('back to sign in returns the password field and drops the recovery copy', async () => {
  const { host, close } = await mount(authScreen({ mode: 'login' }));
  try {
    await click(host, '#auth-forgot-password-btn');
    await wait(() => text(host).includes('Reset your password'), 'the recovery heading');
    await click(host, '#auth-back-to-login-btn');
    await wait(() => text(host).includes('Welcome back'), 'the sign-in heading');

    assert.ok(host.querySelector('input[name="customer-password"]'), 'the password field is back');
    assert.ok(host.querySelector('#auth-forgot-password-btn'), 'the way back in is offered again');
    assert.doesNotMatch(text(host), /Send reset link/);
  } finally {
    await close();
  }
});

test('an empty address is refused inline and Auth is never contacted', async () => {
  const calls: any[] = [];
  const restore = stubSharedSupabaseAuth({
    resetPasswordForEmail: async (...args: any[]) => {
      calls.push(args);
      return { data: {}, error: null };
    },
  });
  const { host, close } = await mount(authScreen({ mode: 'recover' }));
  try {
    await submitForm(host);
    await wait(() => text(host).includes('Enter a valid email address.'), 'the inline validation');
    assert.equal(calls.length, 0, 'no reset request for an empty address');
    assert.doesNotMatch(text(host), /If an account uses that email/);
  } finally {
    await close();
    restore();
  }
});

test('a valid address asks Supabase Auth for a link to the customer auth route', async () => {
  const calls: any[] = [];
  const restore = stubSharedSupabaseAuth({
    resetPasswordForEmail: async (...args: any[]) => {
      calls.push(args);
      return { data: {}, error: null };
    },
  });
  const { host, close } = await mount(authScreen({ mode: 'recover' }));
  try {
    await type(host, 'input[name="customer-email"]', 'booked@example.com');
    await submitForm(host);
    await wait(() => calls.length === 1, 'exactly one reset request');

    assert.equal(calls[0][0], 'booked@example.com');
    const redirectTo = String(calls[0][1]?.redirectTo ?? '');
    assert.ok(redirectTo.endsWith(CUSTOMER_AUTH_PATH), `redirectTo ${redirectTo} targets the customer auth route`);
    assert.ok(
      redirectTo.startsWith(dom.window.location.origin),
      'the link is absolute so Auth appends the token to this deployment'
    );
  } finally {
    await close();
    restore();
  }
});

test('the redirect target is the router auth path, not a hand-rolled duplicate', () => {
  assert.equal(CUSTOMER_AUTH_PATH, customerPath('auth'));
  assert.equal(customerPasswordResetRedirectTo(dom.window.location.origin), `${dom.window.location.origin}${customerPath('auth')}`);
});

test('the customer sees the same copy whether or not the address exists', async () => {
  const outcomes: string[] = [];
  // Supabase Auth answers success for unknown addresses on purpose; the screen
  // must not add its own hint either way.
  for (const result of [{ data: {}, error: null }, { data: null, error: null }]) {
    const restore = stubSharedSupabaseAuth({ resetPasswordForEmail: async () => result });
    const { host, close } = await mount(authScreen({ mode: 'recover' }));
    try {
      await type(host, 'input[name="customer-email"]', 'someone@example.com');
      await submitForm(host);
      await wait(() => text(host).includes('If an account uses that email'), 'the sent confirmation');
      outcomes.push(text(host));
    } finally {
      await close();
      restore();
    }
  }
  assert.equal(outcomes.length, 2);
  for (const shown of outcomes) {
    assert.ok(shown.includes(RESET_SENT_MESSAGE), 'the enumeration-safe message is shown');
    assert.ok(!/not found|does not exist|no account/i.test(shown), 'no hint about whether the address exists');
  }
});

test('the address field is cleared after the link is sent', async () => {
  const restore = stubSharedSupabaseAuth({
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
  });
  const { host, close } = await mount(authScreen({ mode: 'recover' }));
  try {
    await type(host, 'input[name="customer-email"]', 'booked@example.com');
    await submitForm(host);
    await wait(() => text(host).includes('If an account uses that email'), 'the sent confirmation');
    assert.equal(host.querySelector<HTMLInputElement>('input[name="customer-email"]')!.value, '');
  } finally {
    await close();
    restore();
  }
});

test('a rate-limited request is reported in customer words on the form', async () => {
  const restore = stubSharedSupabaseAuth({
    resetPasswordForEmail: async () => ({ data: null, error: { message: 'Auth rate limit exceeded' } }),
  });
  const { host, close } = await mount(authScreen({ mode: 'recover' }));
  try {
    await type(host, 'input[name="customer-email"]', 'booked@example.com');
    await submitForm(host);
    await wait(() => text(host).includes('Too many attempts just now'), 'the rate-limit copy');
    assert.ok(host.querySelector('[role="alert"]'), 'it is announced as an error');
    assert.doesNotMatch(text(host), /rate limit/i, 'the provider string is not echoed');
    assert.doesNotMatch(text(host), /If an account uses that email/, 'no false "link sent" claim');
  } finally {
    await close();
    restore();
  }
});

// ---------------------------------------------------------------------------
// 3. The reset form (reached from the link, via PASSWORD_RECOVERY)
// ---------------------------------------------------------------------------

test('reset mode asks for a new password twice and for no address at all', async () => {
  const { host, close } = await mount(authScreen({ mode: 'reset' }));
  try {
    assert.match(text(host), /Choose a new password/);
    assert.match(text(host), /Save new password/);
    assert.ok(host.querySelector('input[name="customer-new-password"]'));
    assert.ok(host.querySelector('input[name="customer-new-password-confirm"]'));
    assert.equal(
      host.querySelector('input[name="customer-email"]'),
      null,
      'the recovery session already knows who this is'
    );
    assert.equal(host.querySelector('input[name="customer-password"]'), null, 'no old-password box');
    assert.ok(host.querySelector('#auth-back-to-login-btn'), 'an expired link still has an escape');
  } finally {
    await close();
  }
});

test('reset mode marks both fields new-password so managers do not autofill the old one', async () => {
  const { host, close } = await mount(authScreen({ mode: 'reset' }));
  try {
    for (const name of ['customer-new-password', 'customer-new-password-confirm']) {
      assert.equal(
        host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.getAttribute('autocomplete'),
        'new-password',
        name
      );
      assert.equal(host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.type, 'password');
    }
  } finally {
    await close();
  }
});

test('an autofilled 6-character password is accepted despite stale React state', async () => {
  const updates: any[] = [];
  const restore = stubSharedSupabaseAuth({
    updateUser: async (args: any) => {
      updates.push(args);
      return { data: { user: { id: 'c-1', email: 'booked@example.com' } }, error: null };
    },
    getSession: async () => ({
      data: { session: { user: { id: 'c-1', email: 'booked@example.com' } } },
      error: null,
    }),
  });
  let authenticated: any = null;
  const { host, close } = await mount(authScreen({ mode: 'reset', onAuthenticated: (user: any) => { authenticated = user; } }));
  try {
    await autofill(host, 'input[name="customer-new-password"]', 'Abc12!');
    await autofill(host, 'input[name="customer-new-password-confirm"]', 'Abc12!');
    await submitForm(host);
    await wait(() => authenticated !== null, 'the customer is signed in');

    assert.equal(updates.length, 1, 'exactly one password update');
    assert.deepEqual(updates[0], { password: 'Abc12!' }, 'the visible value is what was sent');
    assert.deepEqual(authenticated, { id: 'c-1', email: 'booked@example.com' });
    assert.doesNotMatch(text(host), /at least 6 characters/);
  } finally {
    await close();
    restore();
  }
});

test('a typed password that clears 6 characters signs the customer straight in', async () => {
  const restore = stubSharedSupabaseAuth({
    updateUser: async () => ({ data: { user: { id: 'c-2' } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: 'c-2', email: 'new@example.com' } } }, error: null }),
  });
  let authenticated: any = null;
  const { host, close } = await mount(authScreen({ mode: 'reset', onAuthenticated: (user: any) => { authenticated = user; } }));
  try {
    await type(host, 'input[name="customer-new-password"]', 'Secret123');
    await type(host, 'input[name="customer-new-password-confirm"]', 'Secret123');
    await submitForm(host);
    await wait(() => authenticated !== null, 'no second email, no re-entry of the old password');
    assert.equal(authenticated.id, 'c-2');
  } finally {
    await close();
    restore();
  }
});

test('a mismatched confirmation is reported and Auth is not called', async () => {
  const updates: any[] = [];
  const restore = stubSharedSupabaseAuth({
    updateUser: async (args: any) => {
      updates.push(args);
      return { data: {}, error: null };
    },
  });
  const { host, close } = await mount(authScreen({ mode: 'reset' }));
  try {
    await type(host, 'input[name="customer-new-password"]', 'Secret123');
    await type(host, 'input[name="customer-new-password-confirm"]', 'Secret124');
    await submitForm(host);
    await wait(() => text(host).includes('The two passwords do not match.'), 'the mismatch copy');
    assert.equal(updates.length, 0);
    assert.ok(host.querySelector('[role="alert"]'));
  } finally {
    await close();
    restore();
  }
});

test('a too-short new password is refused with the same rule as sign-up', async () => {
  const updates: any[] = [];
  const restore = stubSharedSupabaseAuth({
    updateUser: async (args: any) => {
      updates.push(args);
      return { data: {}, error: null };
    },
  });
  const { host, close } = await mount(authScreen({ mode: 'reset' }));
  try {
    await type(host, 'input[name="customer-new-password"]', 'Ab1!');
    await type(host, 'input[name="customer-new-password-confirm"]', 'Ab1!');
    await submitForm(host);
    await wait(() => text(host).includes('Use at least 6 characters'), 'the length rule');
    assert.equal(updates.length, 0);
  } finally {
    await close();
    restore();
  }
});

test('an expired reset link tells the customer to request a new one', async () => {
  const restore = stubSharedSupabaseAuth({
    updateUser: async () => ({ data: null, error: { message: 'Session not found' } }),
  });
  const { host, close } = await mount(authScreen({ mode: 'reset' }));
  try {
    await type(host, 'input[name="customer-new-password"]', 'Secret123');
    await type(host, 'input[name="customer-new-password-confirm"]', 'Secret123');
    await submitForm(host);
    await wait(() => text(host).includes('That reset link has expired.'), 'the expired-link copy');
    assert.match(text(host), /Request a new one/);
    assert.ok(host.querySelector('#auth-back-to-login-btn'), 'and a way back to sign in');
  } finally {
    await close();
    restore();
  }
});

test('a recovery session that vanished before saving asks for a sign-in instead', async () => {
  const restore = stubSharedSupabaseAuth({
    updateUser: async () => ({ data: { user: { id: 'c-3' } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  });
  let authenticated: any = null;
  const { host, close } = await mount(authScreen({ mode: 'reset', onAuthenticated: (user: any) => { authenticated = user; } }));
  try {
    await type(host, 'input[name="customer-new-password"]', 'Secret123');
    await type(host, 'input[name="customer-new-password-confirm"]', 'Secret123');
    await submitForm(host);
    await wait(() => text(host).includes('Your session expired'), 'the expired-session copy');
    assert.equal(authenticated, null, 'the customer is not signed in on a missing session');
  } finally {
    await close();
    restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Error copy shared with the sign-in form
// ---------------------------------------------------------------------------

test('recovery copy passes through describeAuthError untouched', () => {
  for (const message of [
    'Enter a valid email address.',
    'Too many attempts just now. Wait a minute and try again.',
    'That reset link has expired. Request a new one and try again.',
    'Use at least 6 characters for your password.',
    'The two passwords do not match.',
    'Password reset is not configured for this deployment. Contact the salon.',
    'Your session expired. Sign in with your new password.',
  ]) {
    assert.equal(describeAuthError(message), message, message);
  }
});

test('browse as guest still works from every recovery mode', async () => {
  for (const mode of ['login', 'signup', 'recover', 'reset'] as const) {
    let guest = false;
    const { host, close } = await mount(authScreen({ mode, onContinueAsGuest: () => { guest = true; } }));
    try {
      await click(host, '#auth-browse-guest-btn');
      assert.equal(guest, true, `guest exit from ${mode}`);
    } finally {
      await close();
    }
  }
});
