import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SignupScreen } from '../../src/onboarding/screens/SignupScreen';
import {
  resendSignupConfirmation,
  signUpWithEmail,
} from '../../src/onboarding/lib/auth';

after(() => dom.window.close());

// ============================================================================
// PHASE 2 — owner signup, the parts only a browser can prove:
//
//   * double submission: a second submit landing before React re-renders must
//     not reach Supabase Auth twice (the disabled button alone cannot stop it)
//   * email verification: the "check your inbox" screen, its resend action and
//     the emailRedirectTo that brings a confirmed account back into the funnel
//   * refresh behaviour: a reload of the inbox screen must not drop the owner
//     back onto a blank sign-up form
//
// Auth itself is a fake client here — tests/onboardingApp.test.ts pins the
// request shape, and tests/dom/onboardingJourneyBrowserFlow.test.ts runs the
// same screen against real GoTrue-shaped HTTP and real PostgreSQL.
// ============================================================================

const store = new Map<string, string>();
before(() => {
  // jsdomSetup does not expose sessionStorage; the signup screen degrades
  // without it, so give it a real one to test the refresh path against.
  const shim = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).sessionStorage = shim;
  // jsdom exposes window.sessionStorage as a getter-only accessor, so it needs
  // defineProperty rather than assignment. The component reads the unqualified
  // identifier, which resolves to globalThis.
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
    resend: async (args: any) => {
      calls.push({ fn: 'resend', args });
      return overrides.resend ? overrides.resend(args) : { data: {}, error: null };
    },
    signInWithPassword: async (args: any) => {
      calls.push({ fn: 'signInWithPassword', args });
      return { data: null, error: null };
    },
    resetPasswordForEmail: async (args: any) => {
      calls.push({ fn: 'resetPasswordForEmail', args });
      return { data: {}, error: null };
    },
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };
  return { client: { auth, rpc: async () => ({ data: null, error: null }) } as any, calls };
}

async function mountScreen(props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(SignupScreen, props)));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;

async function fillField(host: HTMLElement, id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
  assert.ok(input, `${id} exists`);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function fillValidForm(host: HTMLElement, email = 'owner@example.com') {
  await fillField(host, 'onboarding-signup-full-name', 'Uma Rao');
  await fillField(host, 'onboarding-signup-email', email);
  await fillField(host, 'onboarding-signup-phone', '+91 98450 77654');
  await fillField(host, 'onboarding-signup-password', 'Secret123!');
  await fillField(host, 'onboarding-signup-confirm', 'Secret123!');
}

const submitForm = async (host: HTMLElement) =>
  act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });

test('a second submit before React re-renders cannot reach Supabase Auth twice', async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client, calls } = fakeClient({
    signUp: async (args: any) => {
      await gate;
      return { data: { user: { id: 'u-1', email: args.email }, session: {} }, error: null };
    },
  });
  const { host, close } = await mountScreen({ client });
  try {
    await fillValidForm(host);
    // Two submit events in the same task: `busy` is still false for the second
    // one because React has not re-rendered yet. Only the ref guard stops it.
    await act(async () => {
      const form = host.querySelector('form')!;
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.filter((c) => c.fn === 'signUp').length, 1, 'exactly one signUp');
    release!();
    await wait(() => !host.textContent!.includes('Creating account…'), 'the busy state cleared');
    assert.equal(calls.filter((c) => c.fn === 'signUp').length, 1, 'still exactly one signUp');
  } finally {
    await close();
  }
});

test('an in-flight submit shows the busy state and the fields lock', async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client } = fakeClient({ signUp: async () => { await gate; return { data: null, error: new Error('boom') }; } });
  const { host, close } = await mountScreen({ client });
  try {
    await fillValidForm(host);
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Creating account…'), 'the busy label');
    const button = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    assert.equal(button.disabled, true, 'the submit button is disabled');
    for (const input of host.querySelectorAll('input')) {
      assert.equal(input.disabled, true, `${input.id} is disabled while busy`);
    }
    release!();
    await wait(() => !!host.textContent?.includes('Account creation failed'), 'the safe error copy');
    assert.equal((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
  } finally {
    await close();
  }
});

test('a user with no session lands on the inbox screen, not a login', async () => {
  store.clear();
  const { client, calls } = fakeClient();
  const { host, close } = await mountScreen({ client });
  try {
    await fillValidForm(host, 'pending@example.com');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');
    assert.match(host.textContent!, /pending@example\.com/, 'the screen names the address to verify');

    // The confirmation link must bring the owner back into the funnel.
    const signUpCall = calls.find((c) => c.fn === 'signUp')!;
    assert.equal(
      signUpCall.args.options.emailRedirectTo,
      'http://localhost:3000/onboarding/login'
    );
    // Identity metadata for handle_new_user(); no partner id, ever.
    assert.deepEqual(signUpCall.args.options.data, {
      full_name: 'Uma Rao',
      phone_number: '+919845077654',
      phone: '+919845077654',
      salon_name: '',
      city: '',
      referral_code: null,
    });
  } finally {
    await close();
  }
});

test('refreshing the inbox screen keeps it up instead of showing a blank form', async () => {
  store.clear();
  const { client } = fakeClient();
  const first = await mountScreen({ client });
  await fillValidForm(first.host, 'refresh@example.com');
  await submitForm(first.host);
  await wait(() => !!first.host.textContent?.includes('Check your inbox'), 'the confirmation screen');
  await first.close();

  // Remounting is what a page refresh does: all component state is gone.
  const second = await mountScreen({ client });
  try {
    assert.match(second.host.textContent!, /Check your inbox/, 'the inbox screen survives a refresh');
    assert.match(second.host.textContent!, /refresh@example\.com/);
    assert.equal(second.host.querySelector('form'), null, 'no sign-up form is offered again');
  } finally {
    await second.close();
    store.clear();
  }
});

test('resend re-requests the confirmation mail for the same address only', async () => {
  store.clear();
  const { client, calls } = fakeClient();
  const { host, close } = await mountScreen({ client });
  try {
    await fillValidForm(host, 'resend@example.com');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');

    const resend = host.querySelector<HTMLButtonElement>('#onboarding-signup-resend')!;
    assert.ok(resend, 'the resend action exists');
    await act(async () => resend.click());
    await wait(() => !!host.textContent?.includes('Confirmation email resent'), 'the resend notice');

    const resendCall = calls.find((c) => c.fn === 'resend')!;
    assert.deepEqual(resendCall.args, {
      type: 'signup',
      email: 'resend@example.com',
      options: { emailRedirectTo: 'http://localhost:3000/onboarding/login' },
    });
  } finally {
    await close();
    store.clear();
  }
});

test('a failed resend surfaces safe copy and can be retried', async () => {
  store.clear();
  let mode: 'ok' | 'limited' = 'limited';
  const { client, calls } = fakeClient({
    resend: async () =>
      mode === 'limited'
        ? { data: null, error: { message: 'For security purposes, you can only request this after 60 seconds.' } }
        : { data: {}, error: null },
  });
  const { host, close } = await mountScreen({ client });
  try {
    await fillValidForm(host, 'limited@example.com');
    await submitForm(host);
    await wait(() => !!host.textContent?.includes('Check your inbox'), 'the confirmation screen');
    const resend = () => host.querySelector<HTMLButtonElement>('#onboarding-signup-resend')!;
    await act(async () => resend().click());
    await wait(() => !!host.textContent?.includes('Too many attempts'), 'the rate-limit copy');
    assert.doesNotMatch(host.textContent!, /security purposes|60 seconds/);
    mode = 'ok';
    await act(async () => resend().click());
    await wait(() => !!host.textContent?.includes('Confirmation email resent'), 'the retry succeeded');
    assert.equal(calls.filter((c) => c.fn === 'resend').length, 2);
  } finally {
    await close();
    store.clear();
  }
});

test('resendSignupConfirmation refuses a bad address and a client without resend', async () => {
  await assert.rejects(resendSignupConfirmation({ auth: {} } as any, 'nope'), /valid email/);
  await assert.rejects(
    resendSignupConfirmation({ auth: {} } as any, 'owner@example.com'),
    /cannot be resent right now/
  );
});

test('a signed-in session clears the pending marker and calls onDone', async () => {
  store.clear();
  const { client } = fakeClient({
    signUp: async (args: any) => ({
      data: { user: { id: 'u-9', email: args.email }, session: { access_token: 't' } },
      error: null,
    }),
  });
  let done = 0;
  const { host, close } = await mountScreen({ client, onDone: () => { done += 1; } });
  try {
    await fillValidForm(host, 'autoconfirmed@example.com');
    await submitForm(host);
    await wait(() => done === 1, 'onDone fired');
    assert.equal(store.size, 0, 'no pending-confirmation marker is left behind');
  } finally {
    await close();
    store.clear();
  }
});

test('signUpWithEmail still short-circuits on validation before touching Auth', async () => {
  const { client, calls } = fakeClient();
  await assert.rejects(
    signUpWithEmail(client, {
      fullName: '',
      email: 'owner@example.com',
      phone: '+919845077654',
      password: 'Secret123!',
      confirm: 'Secret123!',
    }),
    /full name/i
  );
  assert.equal(calls.length, 0, 'Supabase Auth was never called');
});
