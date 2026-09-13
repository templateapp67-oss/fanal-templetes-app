import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginScreen } from '../../src/onboarding/screens/LoginScreen';
import { SignupScreen } from '../../src/onboarding/screens/SignupScreen';

after(() => dom.window.close());

// ============================================================================
// PHASE 2.3 + PHASE 3 — the browser-only half of signup recovery and login:
//
//   * a double click on LOG IN must reach Supabase Auth once
//   * an owner whose account already exists must not dead-end on the sign-up
//     form (they cannot log in yet if confirmation is required)
//   * wrong password / unverified email / expired session each get their own
//     copy, and a wrong password can be retried successfully
// ============================================================================

const store = new Map<string, string>();
before(() => {
  const shim = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).sessionStorage = shim;
  Object.defineProperty(dom.window, 'sessionStorage', {
    value: shim,
    writable: true,
    configurable: true,
  });
});

const wait = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  assert.ok(check(), `UI settled: ${what}`);
};

function fakeClient(overrides: Record<string, any> = {}) {
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
      return overrides.signIn
        ? overrides.signIn(args)
        : { data: { user: { id: 'u-1', email: args.email }, session: {} }, error: null };
    },
    resend: async (args: any) => {
      calls.push({ fn: 'resend', args });
      return { data: {}, error: null };
    },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };
  return { client: { auth, rpc: async () => ({ data: null, error: null }) } as any, calls };
}

const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;

async function mount(Component: any, props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Component, props)));
  return {
    host,
    text: () => host.textContent || '',
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function fillField(host: HTMLElement, id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
  assert.ok(input, `${id} exists`);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

const submitForm = async (host: HTMLElement) =>
  act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });

/** Two submit events inside one task — the double-click case. */
const doubleSubmit = async (host: HTMLElement) =>
  act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });

// The pending-confirmation marker survives a mount by design (that is the
// refresh case in onboardingSignupBrowserFlow). These cases each start cold.
const clearPending = () => store.clear();

const fillSignup = async (host: HTMLElement, email = 'retry@example.com') => {
  await fillField(host, 'onboarding-signup-full-name', 'Uma Rao');
  await fillField(host, 'onboarding-signup-email', email);
  await fillField(host, 'onboarding-signup-phone', '+91 98450 77654');
  await fillField(host, 'onboarding-signup-password', 'Secret123!');
  await fillField(host, 'onboarding-signup-confirm', 'Secret123!');
};

const fillLogin = async (host: HTMLElement, password = 'Secret123!') => {
  await fillField(host, 'onboarding-login-email', 'owner@example.com');
  await fillField(host, 'onboarding-login-password', password);
};

// ---------------------------------------------------------------------------
// 2.3 — signup recovery
// ---------------------------------------------------------------------------

test('signup: an address that already exists recovers instead of dead-ending', async () => {
  // A network retry whose first attempt actually landed. Supabase refuses the
  // second signUp, so nothing is duplicated — but the owner is mid-confirmation
  // and cannot log in, so a bare error would strand them.
  const { client, calls } = fakeClient({
    signUp: async () => ({ data: null, error: { message: 'User already registered' } }),
  });
  clearPending();
  const screen = await mount(SignupScreen, { client });
  try {
    await fillSignup(screen.host);
    await submitForm(screen.host);
    await wait(() => /Verify your email to continue/.test(screen.text()), 'inbox screen');
    assert.equal(calls.filter((c) => c.fn === 'signUp').length, 1);
    // Both escapes are present: resend the confirmation, or log in.
    assert.ok(screen.host.querySelector('#onboarding-signup-resend'), 'resend action offered');
    assert.match(screen.text(), /Log in/);
  } finally {
    await screen.close();
  }
});

test('signup: the recovery path does not create a second account', async () => {
  const { client, calls } = fakeClient({
    signUp: async () => ({ data: null, error: { message: 'User already registered' } }),
  });
  clearPending();
  const screen = await mount(SignupScreen, { client });
  try {
    await fillSignup(screen.host);
    await doubleSubmit(screen.host);
    await wait(() => /Verify your email to continue/.test(screen.text()), 'inbox screen');
    assert.equal(
      calls.filter((c) => c.fn === 'signUp').length,
      1,
      'a double click sends exactly one signUp — no duplicate auth user'
    );
  } finally {
    await screen.close();
  }
});

test('signup: a genuinely different failure still shows its message', async () => {
  // Positive control for the recovery branch above — the routing is specific to
  // "account already exists", not to every error.
  const { client } = fakeClient({
    signUp: async () => ({ data: null, error: { message: 'Failed to fetch' } }),
  });
  clearPending();
  const screen = await mount(SignupScreen, { client });
  try {
    await fillSignup(screen.host);
    await submitForm(screen.host);
    await wait(() => /Network error/.test(screen.text()), 'network message');
    assert.ok(screen.host.querySelector('#onboarding-signup-email'), 'still on the sign-up form');
    assert.ok(!screen.host.querySelector('#onboarding-signup-resend'));
  } finally {
    await screen.close();
  }
});

// ---------------------------------------------------------------------------
// PHASE 3 — login
// ---------------------------------------------------------------------------

test('login: a double click reaches Supabase Auth once and then completes', async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let done = 0;
  const { client, calls } = fakeClient({
    signIn: async (args: any) => {
      await gate;
      return { data: { user: { id: 'u-1', email: args.email }, session: {} }, error: null };
    },
  });
  const screen = await mount(LoginScreen, { client, onDone: () => { done += 1; } });
  try {
    await fillLogin(screen.host);
    await doubleSubmit(screen.host);
    assert.equal(calls.filter((c) => c.fn === 'signInWithPassword').length, 1, 'exactly one login');
    release!();
    await wait(() => done === 1, 'onDone fired');
  } finally {
    await screen.close();
  }
});

test('login: a wrong password shows safe copy and the form can be retried', async () => {
  let attempt = 0;
  let done = 0;
  const { client, calls } = fakeClient({
    signIn: async (args: any) => {
      attempt += 1;
      if (attempt === 1) return { data: null, error: { message: 'Invalid login credentials' } };
      return { data: { user: { id: 'u-1', email: args.email }, session: {} }, error: null };
    },
  });
  const screen = await mount(LoginScreen, { client, onDone: () => { done += 1; } });
  try {
    await fillLogin(screen.host, 'WrongOne!');
    await submitForm(screen.host);
    await wait(() => /Invalid email or password/.test(screen.text()), 'wrong-password copy');
    assert.doesNotMatch(screen.text(), /Invalid login credentials/i, 'raw GoTrue text is not shown');

    await fillLogin(screen.host, 'Secret123!');
    await submitForm(screen.host);
    await wait(() => done === 1, 'the retry succeeds');
    assert.equal(calls.filter((c) => c.fn === 'signInWithPassword').length, 2);
  } finally {
    await screen.close();
  }
});

test('login: an unverified account is told to verify, not that the password was wrong', async () => {
  const { client } = fakeClient({
    signIn: async () => ({ data: null, error: { message: 'Email not confirmed' } }),
  });
  const screen = await mount(LoginScreen, { client });
  try {
    await fillLogin(screen.host);
    await submitForm(screen.host);
    await wait(() => /verify your email/i.test(screen.text()), 'verify-your-email copy');
  } finally {
    await screen.close();
  }
});

test('login: an expired session is told to sign in again', async () => {
  const { client } = fakeClient({
    signIn: async () => ({ data: null, error: { message: 'Invalid Refresh Token' } }),
  });
  const screen = await mount(LoginScreen, { client });
  try {
    await fillLogin(screen.host);
    await submitForm(screen.host);
    await wait(() => /session expired/i.test(screen.text()), 'session-expired copy');
    assert.doesNotMatch(screen.text(), /Login failed\. Please try again/, 'not the generic message');
  } finally {
    await screen.close();
  }
});

test('login: a rate-limited owner is asked to wait', async () => {
  const { client } = fakeClient({
    signIn: async () => ({
      data: null,
      error: { message: 'For security purposes, you can only request this after 60 seconds.' },
    }),
  });
  const screen = await mount(LoginScreen, { client });
  try {
    await fillLogin(screen.host);
    await submitForm(screen.host);
    await wait(() => /Too many attempts/.test(screen.text()), 'rate-limit copy');
  } finally {
    await screen.close();
  }
});

test('login: an empty password never reaches the network', async () => {
  const { client, calls } = fakeClient();
  const screen = await mount(LoginScreen, { client });
  try {
    await fillLogin(screen.host, '');
    await submitForm(screen.host);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls.length, 0, 'client-side validation short-circuits');
  } finally {
    await screen.close();
  }
});

test('login: the button locks while a request is in flight', async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client } = fakeClient({
    signIn: async (args: any) => {
      await gate;
      return { data: { user: { id: 'u-1', email: args.email }, session: {} }, error: null };
    },
  });
  const screen = await mount(LoginScreen, { client });
  try {
    await fillLogin(screen.host);
    await act(async () => {
      screen.host
        .querySelector('form')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await wait(
      () => /Logging in/.test(screen.text()),
      'busy label'
    );
    const email = screen.host.querySelector<HTMLInputElement>('#onboarding-login-email')!;
    const password = screen.host.querySelector<HTMLInputElement>('#onboarding-login-password')!;
    assert.equal(email.disabled, true, 'email locked mid-flight');
    assert.equal(password.disabled, true, 'password locked mid-flight');
    release!();
  } finally {
    await screen.close();
  }
});
