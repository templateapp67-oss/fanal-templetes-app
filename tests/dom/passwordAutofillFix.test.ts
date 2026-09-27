// ============================================================================
// PERMANENT FIX — "Password must be at least 6 characters." while a 6+
// character password is visibly filled in.
//
// Root cause: several auth forms validated and submitted React component
// state, but browser autofill / password managers can write the DOM input
// value WITHOUT dispatching the React change events that keep state in sync.
// The user sees a 6+ character password while state still holds '' (or a
// stale short value) — so validation failed on a value the user never saw.
//
// The fix (in every auth form): on submit, read the actual submitted
// `<form>` controls via `new FormData(event.currentTarget)`, validate THAT
// password in strict order (exists → string → length >= minimum → confirm
// matches), sync React state from it, and send exactly the validated value
// to Supabase Auth.
//
// These tests pin that contract at every signup entry point:
//   1. onboarding SignupScreen            5. onboarding LoginScreen
//   2. main AuthModal (owner + customer)  6. onboarding SetPasswordScreen
//   3. customer AuthScreen                7. partner portal login + set-password
//   4. GrowthPartnerSignupForm (both      8. partner account change-password
//      partner routes share it)            9. forgot-password handlers (both)
//  10. whitespace preservation at DOM level + diagnostics leak audit
//
// Autofill is simulated the way a password manager writes it: the native
// input-value setter with NO event dispatched, so React state stays stale
// while the DOM shows the filled password. Only lengths are ever asserted —
// password content is never logged.
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SignupScreen } from '../../src/onboarding/screens/SignupScreen';
import { LoginScreen } from '../../src/onboarding/screens/LoginScreen';
import { ForgotPasswordScreen, FORGOT_SUCCESS } from '../../src/onboarding/screens/ForgotPasswordScreen';
import { SetPasswordScreen } from '../../src/onboarding/screens/SetPasswordScreen';
import {
  signUpWithEmail,
  type OnboardingSupabaseClient,
} from '../../src/onboarding/lib/auth';
import {
  MIN_PASSWORD_LENGTH,
  validateSignup,
} from '../../src/onboarding/lib/flow';
import { AuthModal } from '../../src/components/AuthModal';
import { AuthScreen } from '../../src/customer/screens/Auth';
import { GrowthPartnerSignupForm } from '../../src/components/GrowthPartnerLogin';
import { GrowthPartnerLogin } from '../../src/components/GrowthPartnerLogin';
import { PartnerPortalLogin } from '../../src/components/PartnerPortalLogin';
import { PartnerAccountSettingsPage } from '../../src/components/PartnerAccountSettingsPage';
import { supabase } from '../../src/lib/supabaseClient';
import { AUTH_PASSWORD_DIAG_TAG } from '../../src/lib/authPasswordDiagnostics';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const inputSetter = Object.getOwnPropertyDescriptor(
  dom.window.HTMLInputElement.prototype,
  'value'
)!.set!;
const selectSetter = Object.getOwnPropertyDescriptor(
  dom.window.HTMLSelectElement.prototype,
  'value'
)!.set!;

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
 * Browser / password-manager autofill: writes the DOM value with NO event, so
 * React state stays stale exactly as it does when autofill bypasses React's
 * change tracking. The submit handler must still validate the visible value.
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

async function selectOption(host: HTMLElement, selector: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(selector);
  assert.ok(select, `${selector} exists`);
  await act(async () => {
    selectSetter.call(select, value);
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
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

/** Fake onboarding client capturing the exact Supabase payload. */
function fakeOnboardingClient(overrides: Record<string, any> = {}) {
  const calls: { fn: string; args: any }[] = [];
  const auth: Record<string, any> = {
    signUp: async (args: any) => {
      calls.push({ fn: 'signUp', args });
      return overrides.signUp
        ? overrides.signUp(args)
        : { data: { user: { id: 'u-1', email: args.email }, session: null }, error: null };
    },
    signInWithPassword: async (args: any) => {
      calls.push({ fn: 'signInWithPassword', args });
      return overrides.signInWithPassword
        ? overrides.signInWithPassword(args)
        : {
            data: {
              user: { id: 'u-1', email: args.email },
              session: { access_token: 't', user: { id: 'u-1', email: args.email } },
            },
            error: null,
          };
    },
    updateUser: async (args: any) => {
      calls.push({ fn: 'updateUser', args });
      return overrides.updateUser
        ? overrides.updateUser(args)
        : { data: { user: { id: 'u-1' } }, error: null };
    },
    resetPasswordForEmail: async (...args: any[]) => {
      calls.push({ fn: 'resetPasswordForEmail', args });
      return { data: {}, error: null };
    },
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };
  return {
    client: { auth, rpc: async () => ({ data: null, error: null }) } as any,
    calls,
  };
}

/** Fake partner client capturing the exact Supabase payload. */
function fakePartnerClient(overrides: Record<string, any> = {}) {
  const calls: { fn: string; args: any }[] = [];
  const client: any = {
    auth: {
      signUp: async (args: any) => {
        calls.push({ fn: 'signUp', args });
        return (
          overrides.signUp?.(args) ?? {
            data: { user: { id: 'p-1', email: args.email }, session: null },
            error: null,
          }
        );
      },
      signInWithPassword: async (args: any) => {
        calls.push({ fn: 'signInWithPassword', args });
        return (
          overrides.signInWithPassword?.(args) ?? {
            data: {
              user: { id: 'p-1', email: args.email },
              session: { access_token: 't', user: { id: 'p-1', email: args.email } },
            },
            error: null,
          }
        );
      },
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      resetPasswordForEmail: async (email: string, opts: any) => {
        calls.push({ fn: 'resetPasswordForEmail', args: { email, opts } });
        return { data: {}, error: null };
      },
      updateUser: async (attrs: any) => {
        calls.push({ fn: 'updateUser', args: attrs });
        return { data: { user: { id: 'p-1' } }, error: null };
      },
    },
    fetchPartnerRow: async () => null,
    fetchApplicationRow: async () => null,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ fn: `rpc:${name}`, args });
      return { data: null, error: null };
    },
  };
  return { client, calls };
}

/** Temporarily stub the shared singleton's auth methods (AuthModal/customer Auth use it directly). */
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

// ---------------------------------------------------------------------------
// 1. Pure validation order: exists → string → length >= 6 → confirm matches
// ---------------------------------------------------------------------------

test('validateSignup: exactly 6 characters passes', () => {
  const result = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: 'Abc12!',
    confirm: 'Abc12!',
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.password, undefined);
});

test('validateSignup: 7+ characters passes', () => {
  const result = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: 'Secret123!',
    confirm: 'Secret123!',
  });
  assert.equal(result.ok, true);
});

test('validateSignup: fewer than 6 characters shows the exact length error', () => {
  const result = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: 'Ab1!',
    confirm: 'Ab1!',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.password, 'Password must be at least 6 characters.');
});

test('validateSignup: missing password reports existence before length', () => {
  const missing = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: '',
    confirm: '',
  });
  assert.equal(missing.errors.password, 'Enter a password.');
  const nonString = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: undefined as unknown as string,
    confirm: '',
  });
  assert.equal(nonString.errors.password, 'Enter a password.');
});

test('validateSignup: confirm mismatch reports the mismatch error', () => {
  const result = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: 'Secret123!',
    confirm: 'Secret123?',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.confirm, 'Passwords do not match.');
});

test('validateSignup: spaces and special characters are preserved, never trimmed', () => {
  // 7 visible characters including a space: must pass, not be trimmed to 6.
  const spaced = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: 'ab cd!@',
    confirm: 'ab cd!@',
  });
  assert.equal(spaced.ok, true);
  // Leading/trailing spaces count toward the length: 9 characters, not 5.
  const padded = validateSignup({
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: '  abcde  ',
    confirm: '  abcde  ',
  });
  assert.equal(padded.ok, true);
  // A 5-character password with surrounding spaces is 9 characters — still
  // passes WITHOUT trimming, proving length is measured on the raw value.
  assert.equal('  abcde  '.length, 9);
});

test('signUpWithEmail sends exactly the validated password value (spaces intact)', async () => {
  const { client, calls } = fakeOnboardingClient({
    signUp: async (args: any) => ({
      data: { user: { id: 'u-1', email: args.email }, session: { access_token: 't' } },
      error: null,
    }),
  });
  const exact = '  p@ss w0rd!  ';
  await signUpWithEmail(client as OnboardingSupabaseClient, {
    fullName: 'Uma Rao',
    email: 'owner@example.com',
    phone: '+919845077654',
    password: exact,
    confirm: exact,
  });
  const signUpCall = calls.find((c) => c.fn === 'signUp')!;
  assert.ok(signUpCall, 'Supabase signUp was called');
  assert.equal(signUpCall.args.password, exact, 'byte-identical password, untrimmed');
  assert.equal(signUpCall.args.password.length, exact.length, 'length-only check matches');
});

// ---------------------------------------------------------------------------
// 2. Onboarding SignupScreen
// ---------------------------------------------------------------------------

async function fillOnboardingSignup(host: HTMLElement, email: string, fillPassword: (id: string, value: string) => Promise<void>, password = 'Secret123!') {
  await type(host, '#onboarding-signup-full-name', 'Uma Rao');
  await type(host, '#onboarding-signup-email', email);
  await type(host, '#onboarding-signup-phone', '+91 98450 77654');
  await fillPassword('#onboarding-signup-password', password);
  await fillPassword('#onboarding-signup-confirm', password);
}

test('onboarding signup: manually typing exactly 6 characters passes', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(SignupScreen, { client }));
  try {
    await fillOnboardingSignup(host, 'six@example.com', (id, v) => type(host, id, v), 'Abc12!');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');
    const signUpCall = calls.find((c) => c.fn === 'signUp')!;
    assert.ok(signUpCall, 'Supabase signUp was called');
    assert.equal(signUpCall.args.password, 'Abc12!');
    assert.equal(signUpCall.args.password.length, MIN_PASSWORD_LENGTH);
  } finally {
    await close();
  }
});

test('onboarding signup: manually typing 7+ characters passes', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(SignupScreen, { client }));
  try {
    await fillOnboardingSignup(host, 'seven@example.com', (id, v) => type(host, id, v), 'Secret123!');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');
    assert.ok(calls.find((c) => c.fn === 'signUp'), 'Supabase signUp was called');
  } finally {
    await close();
  }
});

test('onboarding signup: fewer than 6 typed characters shows the length error, no signup call', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(SignupScreen, { client }));
  try {
    await fillOnboardingSignup(host, 'short@example.com', (id, v) => type(host, id, v), 'Ab1!');
    await submitForm(host);
    await wait(
      () => !!host.textContent?.includes('Password must be at least 6 characters.'),
      'the length error'
    );
    assert.equal(calls.filter((c) => c.fn === 'signUp').length, 0, 'Supabase signUp never called');
  } finally {
    await close();
  }
});

test('onboarding signup: autofilled 6+ character password passes (stale React state)', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(SignupScreen, { client }));
  try {
    // Password fields are filled DOM-only: React state still holds ''.
    await fillOnboardingSignup(host, 'autofill@example.com', (id, v) => autofill(host, id, v), 'Abc12!');
    // Sanity: the DOM visibly shows 6 characters while state is stale.
    assert.equal(
      host.querySelector<HTMLInputElement>('#onboarding-signup-password')!.value.length,
      6
    );
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');
    assert.doesNotMatch(host.textContent!, /Password must be at least 6 characters/);
    const signUpCall = calls.find((c) => c.fn === 'signUp')!;
    assert.ok(signUpCall, 'Supabase signUp was called');
    assert.equal(signUpCall.args.password, 'Abc12!', 'the validated DOM value is what was sent');
  } finally {
    await close();
  }
});

test('onboarding signup: confirm mismatch shows the mismatch error, no signup call', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(SignupScreen, { client }));
  try {
    await type(host, '#onboarding-signup-full-name', 'Uma Rao');
    await type(host, '#onboarding-signup-email', 'mismatch@example.com');
    await type(host, '#onboarding-signup-phone', '+91 98450 77654');
    await type(host, '#onboarding-signup-password', 'Secret123!');
    await type(host, '#onboarding-signup-confirm', 'Secret123?');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Passwords do not match.'), 'the mismatch error');
    assert.equal(calls.filter((c) => c.fn === 'signUp').length, 0, 'Supabase signUp never called');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 3. Main AuthModal signup (owner + customer)
// ---------------------------------------------------------------------------

test('AuthModal signup: manually typing exactly 6 characters passes and sends the validated value', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return {
        data: {
          user: { id: 'm-1', email: args.email, user_metadata: {} },
          session: { access_token: 't', user: { id: 'm-1', email: args.email } },
        },
        error: null,
      };
    },
  });
  let succeeded: any = null;
  let closed = 0;
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => { closed += 1; },
      initialMode: 'signup',
      purpose: 'customer',
      onSuccess: (user: any) => { succeeded = user; },
    })
  );
  try {
    assert.equal(
      host.querySelector<HTMLInputElement>('input[name="auth-password"]')!.getAttribute('autocomplete'),
      'new-password',
      'signup password uses the new-password autocomplete token'
    );
    await type(host, 'input[name="auth-full-name"]', 'Modal User');
    await type(host, 'input[name="auth-email"]', 'modal6@example.com');
    await type(host, 'input[name="auth-password"]', 'Abc12!');
    await submitForm(host);
    await wait(() => succeeded !== null, 'onSuccess fired');
    assert.equal(seen.length, 1, 'exactly one Supabase signUp');
    assert.equal(seen[0].password, 'Abc12!', 'the validated value is what was sent');
    assert.equal(seen[0].password.length, 6, 'length-only check matches');
    assert.equal(closed, 1, 'the modal closed on success');
  } finally {
    await close();
    restore();
  }
});

test('AuthModal signup: 7+ typed characters passes', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return {
        data: {
          user: { id: 'm-2', email: args.email, user_metadata: {} },
          session: { access_token: 't', user: { id: 'm-2', email: args.email } },
        },
        error: null,
      };
    },
  });
  let succeeded: any = null;
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => {},
      initialMode: 'signup',
      purpose: 'customer',
      onSuccess: (user: any) => { succeeded = user; },
    })
  );
  try {
    await type(host, 'input[name="auth-full-name"]', 'Modal User');
    await type(host, 'input[name="auth-email"]', 'modal7@example.com');
    await type(host, 'input[name="auth-password"]', 'Secret123!');
    await submitForm(host);
    await wait(() => succeeded !== null, 'onSuccess fired');
    assert.equal(seen[0].password, 'Secret123!');
  } finally {
    await close();
    restore();
  }
});

test('AuthModal signup: autofilled 6-character password passes (stale React state)', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return {
        data: {
          user: { id: 'm-3', email: args.email, user_metadata: {} },
          session: { access_token: 't', user: { id: 'm-3', email: args.email } },
        },
        error: null,
      };
    },
  });
  let succeeded: any = null;
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => {},
      initialMode: 'signup',
      purpose: 'customer',
      onSuccess: (user: any) => { succeeded = user; },
    })
  );
  try {
    await type(host, 'input[name="auth-full-name"]', 'Autofill User');
    await type(host, 'input[name="auth-email"]', 'modalfill@example.com');
    // DOM-only fill: React state still holds '' while 6 chars are visible.
    await autofill(host, 'input[name="auth-password"]', 'Abc12!');
    await submitForm(host);
    await wait(() => succeeded !== null, 'onSuccess fired');
    assert.doesNotMatch(host.textContent!, /Password must be at least 6 characters/);
    assert.equal(seen.length, 1, 'exactly one Supabase signUp');
    assert.equal(seen[0].password, 'Abc12!', 'the validated DOM value is what was sent');
  } finally {
    await close();
    restore();
  }
});

test('AuthModal signup: fewer than 6 typed characters shows the length error, no signup call', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return { data: null, error: null };
    },
  });
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => {},
      initialMode: 'signup',
      purpose: 'customer',
      onSuccess: () => {},
    })
  );
  try {
    await type(host, 'input[name="auth-full-name"]', 'Short User');
    await type(host, 'input[name="auth-email"]', 'modalshort@example.com');
    await type(host, 'input[name="auth-password"]', 'Ab1!');
    await submitForm(host);
    await wait(
      () => !!host.textContent?.includes('Password must be at least 6 characters.'),
      'the length error'
    );
    assert.equal(seen.length, 0, 'Supabase signUp never called');
  } finally {
    await close();
    restore();
  }
});

test('AuthModal owner signup: autofilled password reaches signup with business fields intact', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return {
        data: { user: { id: 'm-4', email: args.email, user_metadata: {} }, session: null },
        error: null,
      };
    },
  });
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => {},
      initialMode: 'signup',
      purpose: 'owner',
      onSuccess: () => {},
    })
  );
  try {
    await type(host, 'input[name="auth-full-name"]', 'Owner User');
    await type(host, 'input[name="auth-salon-name"]', 'Glow Studio');
    await type(host, 'input[name="auth-phone"]', '+919845077654');
    await type(host, 'input[name="auth-city"]', 'Mumbai');
    await type(host, 'input[name="auth-email"]', 'ownerfill@example.com');
    await autofill(host, 'input[name="auth-password"]', 'Owner123!');
    await submitForm(host);
    await wait(
      () => !!host.textContent?.includes('verify your email'),
      'the email-confirmation notice (signup reached Supabase)'
    );
    assert.doesNotMatch(host.textContent!, /Password must be at least 6 characters/);
    assert.equal(seen.length, 1, 'exactly one Supabase signUp');
    assert.equal(seen[0].password, 'Owner123!');
  } finally {
    await close();
    restore();
  }
});

test('AuthModal login: autofilled password is attempted as-is (no signup length rule on login)', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signInWithPassword: async (args: any) => {
      seen.push(args);
      return {
        data: {
          user: { id: 'm-5', email: args.email, user_metadata: {} },
          session: { access_token: 't' },
        },
        error: null,
      };
    },
  });
  let succeeded: any = null;
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => {},
      initialMode: 'login',
      purpose: 'owner',
      onSuccess: (user: any) => { succeeded = user; },
    })
  );
  try {
    assert.equal(
      host.querySelector<HTMLInputElement>('input[name="auth-password"]')!.getAttribute('autocomplete'),
      'current-password',
      'login password uses the current-password autocomplete token'
    );
    await type(host, 'input[name="auth-email"]', 'owner@example.com');
    await autofill(host, 'input[name="auth-password"]', 'typed-in-manager');
    await submitForm(host);
    await wait(() => succeeded !== null, 'onSuccess fired');
    assert.equal(seen.length, 1, 'exactly one sign-in attempt');
    assert.equal(seen[0].password, 'typed-in-manager', 'the visible value is what was sent');
  } finally {
    await close();
    restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Customer AuthScreen
// ---------------------------------------------------------------------------

test('customer signup: autofilled 6-character password passes (stale React state)', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return {
        data: {
          user: { id: 'c-1', email: args.email },
          session: { access_token: 't', user: { id: 'c-1', email: args.email } },
        },
        error: null,
      };
    },
  });
  let authenticated: any = null;
  const { host, close } = await mount(
    React.createElement(AuthScreen, {
      onAuthenticated: (user: any) => { authenticated = user; },
      onContinueAsGuest: () => {},
      mode: 'signup',
    })
  );
  try {
    await type(host, 'input[name="customer-full-name"]', 'Customer User');
    await type(host, 'input[name="customer-phone"]', '+919845077654');
    await type(host, 'input[name="customer-email"]', 'customerfill@example.com');
    await autofill(host, 'input[name="customer-password"]', 'Abc12!');
    await submitForm(host);
    await wait(() => authenticated !== null, 'onAuthenticated fired');
    assert.doesNotMatch(host.textContent!, /at least 6 characters/);
    assert.equal(seen.length, 1, 'exactly one Supabase signUp');
    assert.equal(seen[0].password, 'Abc12!', 'the validated DOM value is what was sent');
  } finally {
    await close();
    restore();
  }
});

test('customer signup: fewer than 6 typed characters shows the length error, no signup call', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return { data: null, error: null };
    },
  });
  const { host, close } = await mount(
    React.createElement(AuthScreen, {
      onAuthenticated: () => {},
      onContinueAsGuest: () => {},
      mode: 'signup',
    })
  );
  try {
    await type(host, 'input[name="customer-full-name"]', 'Short Customer');
    await type(host, 'input[name="customer-email"]', 'customershort@example.com');
    await type(host, 'input[name="customer-password"]', 'Ab1!');
    await submitForm(host);
    await wait(
      () => !!host.textContent?.includes('Use at least 6 characters for your password.'),
      'the length error'
    );
    assert.equal(seen.length, 0, 'Supabase signUp never called');
  } finally {
    await close();
    restore();
  }
});

// ---------------------------------------------------------------------------
// 5. GrowthPartnerSignupForm (shared by both partner signup routes)
// ---------------------------------------------------------------------------

test('growth-partner signup: autofilled 8-character password reaches onSubmit (stale React state)', async () => {
  let received: any = null;
  const { host, close } = await mount(
    React.createElement(GrowthPartnerSignupForm, {
      busy: false,
      formError: '',
      success: '',
      onSubmit: (input: any) => { received = input; },
      onBack: () => {},
    })
  );
  try {
    // Typed fields first; the manager fills the password last, right before
    // submit — any earlier and a later React render would reconcile it.
    await type(host, '#growth-partner-signup-name', 'Partner User');
    await type(host, '#growth-partner-signup-phone', '+919845077654');
    await type(host, '#growth-partner-signup-email', 'partner@example.com');
    await selectOption(host, '#growth-partner-kyc-type', 'pan');
    await type(host, '#growth-partner-kyc-reference', 'ABCDE1234F');
    await autofill(host, '#growth-partner-signup-password', 'Partner1');
    assert.equal(
      host.querySelector<HTMLInputElement>('#growth-partner-signup-password')!.value.length,
      8,
      'the DOM visibly holds 8 characters at submit time'
    );
    await submitForm(host);
    await wait(() => received !== null, 'onSubmit fired');
    assert.equal(received.password, 'Partner1', 'the validated DOM value is what was submitted');
    assert.equal(received.password.length, 8, 'length-only check matches');
  } finally {
    await close();
  }
});

test('growth-partner signup: typed 7-character password shows its length error, no submit', async () => {
  let received: any = null;
  const { host, close } = await mount(
    React.createElement(GrowthPartnerSignupForm, {
      busy: false,
      formError: '',
      success: '',
      onSubmit: (input: any) => { received = input; },
      onBack: () => {},
    })
  );
  try {
    await type(host, '#growth-partner-signup-name', 'Partner User');
    await type(host, '#growth-partner-signup-email', 'partnershort@example.com');
    await type(host, '#growth-partner-signup-password', 'Short12');
    await selectOption(host, '#growth-partner-kyc-type', 'pan');
    await type(host, '#growth-partner-kyc-reference', 'ABCDE1234F');
    await submitForm(host);
    await wait(
      () => !!host.textContent?.includes('Password must be at least 8 characters.'),
      'the partner length error'
    );
    assert.equal(received, null, 'onSubmit never fired');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 6. Onboarding LoginScreen + SetPasswordScreen
// ---------------------------------------------------------------------------

test('onboarding login: autofilled password is sent to sign-in (stale React state)', async () => {
  const { client, calls } = fakeOnboardingClient();
  let done = 0;
  const { host, close } = await mount(
    React.createElement(LoginScreen, { client, onDone: () => { done += 1; } })
  );
  try {
    await type(host, '#onboarding-login-email', 'owner@example.com');
    await autofill(host, '#onboarding-login-password', 'manager-filled-secret');
    await submitForm(host);
    await wait(() => done === 1, 'onDone fired');
    const signInCall = calls.find((c) => c.fn === 'signInWithPassword')!;
    assert.ok(signInCall, 'signInWithPassword was called');
    assert.equal(signInCall.args.password, 'manager-filled-secret');
  } finally {
    await close();
  }
});

test('set-password screen: autofilled values are validated and sent (stale React state)', async () => {
  const { client, calls } = fakeOnboardingClient();
  let done = 0;
  const { host, close } = await mount(
    React.createElement(SetPasswordScreen, { client, onDone: () => { done += 1; } })
  );
  try {
    await autofill(host, '#onboarding-reset-password', 'Abc12!');
    await autofill(host, '#onboarding-reset-confirm', 'Abc12!');
    await submitForm(host);
    await wait(() => done === 1, 'onDone fired');
    assert.doesNotMatch(host.textContent!, /Password must be at least 6 characters/);
    const updateCall = calls.find((c) => c.fn === 'updateUser')!;
    assert.ok(updateCall, 'updateUser was called');
    assert.equal(updateCall.args.password, 'Abc12!');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 7. Partner portal login container + legacy growth-partner login container
// ---------------------------------------------------------------------------

test('partner portal login: autofilled password is sent to sign-in (stale React state)', async () => {
  (dom.window as any).localStorage.clear();
  (dom.window as any).sessionStorage.clear();
  const { client, calls } = fakePartnerClient();
  const { host, close } = await mount(React.createElement(PartnerPortalLogin, { client }));
  try {
    await wait(() => !!host.querySelector('#partner-login-password'), 'the login form renders');
    await type(host, '#partner-login-email', 'partner@example.com');
    await autofill(host, '#partner-login-password', 'manager-filled-secret');
    await submitForm(host);
    await wait(
      () => calls.some((c) => c.fn === 'signInWithPassword'),
      'signInWithPassword was called'
    );
    const signInCall = calls.find((c) => c.fn === 'signInWithPassword')!;
    assert.equal(signInCall.args.password, 'manager-filled-secret');
    assert.equal(signInCall.args.email, 'partner@example.com');
  } finally {
    await close();
  }
});

test('growth-partner login: autofilled password is sent to sign-in (stale React state)', async () => {
  const { client, calls } = fakePartnerClient();
  const { host, close } = await mount(React.createElement(GrowthPartnerLogin, { client }));
  try {
    await wait(() => !!host.querySelector('#growth-partner-login-password'), 'the login form renders');
    await type(host, '#growth-partner-login-email', 'partner@example.com');
    await autofill(host, '#growth-partner-login-password', 'manager-filled-secret');
    await submitForm(host);
    await wait(
      () => calls.some((c) => c.fn === 'signInWithPassword'),
      'signInWithPassword was called'
    );
    const signInCall = calls.find((c) => c.fn === 'signInWithPassword')!;
    assert.equal(signInCall.args.password, 'manager-filled-secret');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 8. Partner account change-password section
// ---------------------------------------------------------------------------

function mockSecurityClient() {
  const calls: any[] = [];
  const client: any = {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ rpc: fn, args });
      if (fn === 'get_my_partner_security_overview') {
        return {
          data: {
            two_factor_enabled: false,
            sessions_available: true,
            sessions: [],
            events: [],
            deactivation: null,
          },
          error: null,
        };
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
        return { data: { user: { id: 'u1' } }, error: null };
      },
      mfa: {
        listFactors: async () => ({ data: { factors: [] }, error: null }),
      },
    },
  };
  return client;
}

test('partner change-password: autofilled values are validated and sent (stale React state)', async () => {
  const client = mockSecurityClient();
  const { host, close } = await mount(
    React.createElement(PartnerAccountSettingsPage, {
      client,
      email: 'meera@example.com',
      expectedUserId: 'u1',
      displayName: 'Meera Partner',
      navigate: () => {},
    })
  );
  try {
    await wait(() => !!host.querySelector('[data-partner-account-settings]'), 'the page renders');
    const section = '[data-account-section="change-password"]';
    // DOM-only fills: React state still holds '' for all three fields.
    await autofill(host, `${section} [data-account-field="current-password"]`, 'OldPass#1');
    await autofill(host, `${section} [data-account-field="new-password"]`, 'NewPass#2026');
    await autofill(host, `${section} [data-account-field="confirm-password"]`, 'NewPass#2026');
    await submitForm(host, `${section}`);
    await wait(
      () =>
        client.calls.some(
          (entry: any) => entry.auth === 'updateUser' && entry.attributes.password === 'NewPass#2026'
        ),
      'updateUser received the autofilled new password'
    );
    const verifyCall = client.calls.find((entry: any) => entry.auth === 'signInWithPassword');
    assert.ok(verifyCall, 'the current password was verified first');
    assert.equal(verifyCall.credentials.password, 'OldPass#1');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 9. Forgot-password handlers (no stale-state reset requests)
// ---------------------------------------------------------------------------

test('onboarding forgot-password: autofilled email is sent (stale React state)', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(ForgotPasswordScreen, { client }));
  try {
    // DOM-only fill: React state still holds '' while the email is visible.
    await autofill(host, '#onboarding-forgot-email', 'owner@example.com');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes(FORGOT_SUCCESS), 'the sent confirmation');
    const resetCall = calls.find((c) => c.fn === 'resetPasswordForEmail')!;
    assert.ok(resetCall, 'resetPasswordForEmail was called');
    assert.equal(resetCall.args[0], 'owner@example.com', 'the visible email is what was sent');
  } finally {
    await close();
  }
});

test('onboarding forgot-password: invalid email shows the field error, no reset call', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(ForgotPasswordScreen, { client }));
  try {
    await type(host, '#onboarding-forgot-email', 'not-an-email');
    await submitForm(host);
    await wait(
      () => !!host.textContent?.includes('Enter a valid email address.'),
      'the field error'
    );
    assert.equal(
      calls.filter((c) => c.fn === 'resetPasswordForEmail').length,
      0,
      'no reset email requested'
    );
  } finally {
    await close();
  }
});

test('partner portal forgot-password: autofilled email is sent (stale React state)', async () => {
  (dom.window as any).localStorage.clear();
  (dom.window as any).sessionStorage.clear();
  const { client, calls } = fakePartnerClient();
  const { host, close } = await mount(React.createElement(PartnerPortalLogin, { client }));
  try {
    await wait(() => !!host.querySelector('#partner-login-forgot'), 'the login form renders');
    await act(async () => {
      host.querySelector<HTMLElement>('#partner-login-forgot')!.click();
    });
    await wait(() => !!host.querySelector('#partner-forgot-email'), 'the forgot form renders');
    // DOM-only fill: React state still holds '' while the email is visible.
    await autofill(host, '#partner-forgot-email', 'partner@example.com');
    await submitForm(host);
    await wait(
      () => calls.some((c) => c.fn === 'resetPasswordForEmail'),
      'resetPasswordForEmail was called'
    );
    const resetCall = calls.find((c) => c.fn === 'resetPasswordForEmail')!;
    assert.equal(resetCall.args.email, 'partner@example.com', 'the visible email is what was sent');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// 10. Whitespace at DOM level + diagnostics leak audit
// ---------------------------------------------------------------------------

test('onboarding signup: typed password with surrounding spaces passes byte-identical', async () => {
  const { client, calls } = fakeOnboardingClient();
  const { host, close } = await mount(React.createElement(SignupScreen, { client }));
  try {
    await type(host, '#onboarding-signup-full-name', 'Uma Rao');
    await type(host, '#onboarding-signup-email', 'spaced@example.com');
    await type(host, '#onboarding-signup-phone', '+91 98450 77654');
    // 9 characters with significant surrounding whitespace: must pass as-is.
    await type(host, '#onboarding-signup-password', '  abcde  ');
    await type(host, '#onboarding-signup-confirm', '  abcde  ');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');
    const signUpCall = calls.find((c) => c.fn === 'signUp')!;
    assert.ok(signUpCall, 'Supabase signUp was called');
    assert.equal(signUpCall.args.password, '  abcde  ', 'sent byte-identical, untrimmed');
    assert.equal(signUpCall.args.password.length, 9, 'length-only check matches');
  } finally {
    await close();
  }
});

test('diagnostics audit: submit-time logs carry lengths only, never password content', async () => {
  const seen: any[] = [];
  const restore = stubSharedSupabaseAuth({
    signUp: async (args: any) => {
      seen.push(args);
      return {
        data: {
          user: { id: 'd-1', email: args.email, user_metadata: {} },
          session: { access_token: 't', user: { id: 'd-1', email: args.email } },
        },
        error: null,
      };
    },
  });
  const captured: unknown[][] = [];
  const originalDebug = console.debug;
  console.debug = (...args: unknown[]) => {
    captured.push(args);
  };
  let succeeded: any = null;
  const { host, close } = await mount(
    React.createElement(AuthModal, {
      isOpen: true,
      onClose: () => {},
      initialMode: 'signup',
      purpose: 'customer',
      onSuccess: (user: any) => { succeeded = user; },
    })
  );
  try {
    await type(host, 'input[name="auth-full-name"]', 'Diag User');
    await type(host, 'input[name="auth-email"]', 'diag@example.com');
    await type(host, 'input[name="auth-password"]', 'Abc12!');
    await submitForm(host);
    await wait(() => succeeded !== null, 'onSuccess fired');
  } finally {
    await close();
    restore();
    console.debug = originalDebug;
  }
  const diagLines = captured.filter((args) => args[0] === AUTH_PASSWORD_DIAG_TAG);
  assert.ok(diagLines.length >= 1, 'a length diagnostic was emitted on submit');
  const report = (diagLines[0] as any[])[2] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(report).sort(),
    ['match', 'stateLength', 'submittedLength'],
    'the report carries numbers/booleans only'
  );
  assert.equal(report.submittedLength, 6, 'the submitted length was tracked');
  assert.equal(report.match, true, 'typed input keeps state and DOM in agreement');
  for (const args of captured) {
    assert.doesNotMatch(JSON.stringify(args), /Abc12/, 'no password content in any debug log');
  }
});
