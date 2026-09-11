// ============================================================================
// Onboarding App (Phase 3) — auth + referral-code gateway on the SHARED
// backend (same Supabase project/Auth/database/RPCs/RLS as the Template App).
//
//   • Router: /onboarding/... parsing + canonical URLs.
//   • Flow: validation, backend-phase mapping, backend-driven route
//     resolution, safe error mapping, duplicate-submission guard.
//   • Auth wrappers: Supabase calls through injectable fakes (signup, login,
//     forgot, logout, session restore, snapshot, referral link).
//   • SSR: every screen's fields/copy/states; the referral screen asks for
//     NOTHING but the code; the status screen performs NO handoff.
//   • PGlite: the backend contract the flow relies on (link persists,
//     invalid creates nothing, ownership immutable, direct writes denied).
//   • Secrets: no privileged key material in the onboarding frontend.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  ONBOARDING_PATH,
  ONBOARDING_SECTIONS,
  isOnboardingPath,
  matchOnboardingRoute,
  onboardingPath,
} from '../src/lib/router';
import {
  MIN_PASSWORD_LENGTH,
  OnboardingError,
  createSingleFlight,
  hasLinkedReferral,
  isValidEmail,
  phaseFromOnboardingState,
  resolveOnboardingRoute,
  toSafeAuthError,
  toSafeReferralError,
  validateLogin,
  validateSignup,
} from '../src/onboarding/lib/flow';
import {
  fetchOnboardingSnapshot,
  linkReferralCode,
  loadViewer,
  sendPasswordReset,
  signInWithEmail,
  signOutViewer,
  signUpWithEmail,
} from '../src/onboarding/lib/auth';
import { OnboardingApp } from '../src/onboarding/OnboardingApp';
import { SIGNUP_SUBTITLE, SIGNUP_TITLE, SignupScreen } from '../src/onboarding/screens/SignupScreen';
import { LOGIN_SUBTITLE, LOGIN_TITLE, LoginScreen } from '../src/onboarding/screens/LoginScreen';
import {
  FORGOT_SUBTITLE,
  FORGOT_SUCCESS,
  FORGOT_TITLE,
  ForgotPasswordScreen,
} from '../src/onboarding/screens/ForgotPasswordScreen';
import {
  REFERRAL_SUBTITLE,
  REFERRAL_TITLE,
  ReferralForm,
  ReferralScreen,
} from '../src/onboarding/screens/ReferralScreen';
import { STATUS_VERIFIED_TITLE, StatusScreen } from '../src/onboarding/screens/StatusScreen';

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test('onboarding routes resolve per the existing router conventions', () => {
  assert.equal(ONBOARDING_PATH, '/onboarding');
  assert.deepEqual([...ONBOARDING_SECTIONS], ['login', 'signup', 'forgot-password', 'referral', 'status']);
  assert.equal(isOnboardingPath('/onboarding'), true);
  assert.equal(isOnboardingPath('/onboarding/referral'), true);
  assert.equal(isOnboardingPath('/onboarding/'), true);
  assert.equal(isOnboardingPath('/ONBOARDING/Signup'), true);
  assert.equal(isOnboardingPath('/onboarding-x'), false);
  assert.equal(isOnboardingPath('/growth-partner'), false);
  assert.equal(matchOnboardingRoute('/onboarding'), 'login');
  assert.equal(matchOnboardingRoute('/onboarding/signup'), 'signup');
  assert.equal(matchOnboardingRoute('/onboarding/forgot-password'), 'forgot-password');
  assert.equal(matchOnboardingRoute('/onboarding/referral/'), 'referral');
  assert.equal(matchOnboardingRoute('/onboarding/status'), 'status');
  assert.equal(matchOnboardingRoute('/onboarding/business-details'), 'login');
  assert.equal(matchOnboardingRoute('/elsewhere'), 'login');
  assert.equal(onboardingPath('login'), '/onboarding/login');
  assert.equal(onboardingPath('signup'), '/onboarding/signup');
  assert.equal(onboardingPath('forgot-password'), '/onboarding/forgot-password');
  assert.equal(onboardingPath('referral'), '/onboarding/referral');
  assert.equal(onboardingPath('status'), '/onboarding/status');
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('email + signup validation enforces the gateway minimums', () => {
  assert.equal(isValidEmail('you@example.com'), true);
  assert.equal(isValidEmail('  spaced@example.com  '), true);
  for (const bad of ['', 'x', 'no-at-sign', 'a@b', '@x.com', 'a b@c.com']) {
    assert.equal(isValidEmail(bad), false);
  }
  assert.ok(MIN_PASSWORD_LENGTH >= 6);
  assert.deepEqual(validateSignup({ email: 'you@example.com', password: 'secret1', confirm: 'secret1' }), {
    ok: true,
    errors: {},
  });
  // Invalid email is rejected with a field error.
  const badEmail = validateSignup({ email: 'nope', password: 'secret1', confirm: 'secret1' });
  assert.equal(badEmail.ok, false);
  assert.match(badEmail.errors.email || '', /valid email/);
  // Mismatched passwords are rejected.
  const mismatch = validateSignup({ email: 'you@example.com', password: 'secret1', confirm: 'secret2' });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors.confirm || '', /do not match/);
  // Missing / short passwords are rejected.
  assert.equal(validateSignup({ email: 'you@example.com', password: '', confirm: '' }).ok, false);
  assert.equal(validateSignup({ email: 'you@example.com', password: '12345', confirm: '12345' }).ok, false);
  // Login requires both fields.
  assert.equal(validateLogin({ email: 'you@example.com', password: 'secret1' }).ok, true);
  assert.equal(validateLogin({ email: 'bad', password: 'secret1' }).ok, false);
  assert.equal(validateLogin({ email: 'you@example.com', password: '' }).ok, false);
});

// ---------------------------------------------------------------------------
// Backend phase mapping + backend-driven routing
// ---------------------------------------------------------------------------

test('backend statuses map to app phases, with the link as authoritative', () => {
  assert.equal(phaseFromOnboardingState({ status: 'not_started', linked: false }), 'pending');
  assert.equal(phaseFromOnboardingState({ status: 'linked', linked: true }), 'referral_added');
  assert.equal(phaseFromOnboardingState({ status: 'template_started', linked: true }), 'template_started');
  assert.equal(phaseFromOnboardingState({ status: 'template_completed', linked: true }), 'completed');
  // Unlinked always means pending, even if a status string ever disagrees.
  assert.equal(phaseFromOnboardingState({ status: 'linked', linked: false }), 'pending');
  assert.equal(hasLinkedReferral('pending'), false);
  assert.equal(hasLinkedReferral('referral_added'), true);
  assert.equal(hasLinkedReferral('template_started'), true);
  assert.equal(hasLinkedReferral('completed'), true);
});

test('unauthenticated users can use auth screens but never protected routes', () => {
  const route = (requested: any) => resolveOnboardingRoute({ hasSession: false, phase: 'pending', requested });
  assert.equal(route('login'), 'login');
  assert.equal(route('signup'), 'signup');
  assert.equal(route('forgot-password'), 'forgot-password');
  assert.equal(route('referral'), 'login');
  assert.equal(route('status'), 'login');
});

test('authenticated users with no referral are routed to the referral step', () => {
  const route = (requested: any) => resolveOnboardingRoute({ hasSession: true, phase: 'pending', requested });
  assert.equal(route('referral'), 'referral');
  // Signed-in users are never shown Sign Up / Login again…
  assert.equal(route('login'), 'referral');
  assert.equal(route('signup'), 'referral');
  assert.equal(route('forgot-password'), 'referral');
  // …and cannot jump ahead to status without a link.
  assert.equal(route('status'), 'referral');
});

test('authenticated users with a referral never see the referral screen', () => {
  for (const phase of ['referral_added', 'template_started', 'completed'] as const) {
    const route = (requested: any) => resolveOnboardingRoute({ hasSession: true, phase, requested });
    assert.equal(route('status'), 'status');
    assert.equal(route('referral'), 'status');
    assert.equal(route('login'), 'status');
    assert.equal(route('signup'), 'status');
    assert.equal(route('forgot-password'), 'status');
  }
});

// ---------------------------------------------------------------------------
// Duplicate-submission guard
// ---------------------------------------------------------------------------

test('duplicate referral submissions are prevented while one is in flight', async () => {
  const flight = createSingleFlight();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = flight.run(async () => {
    calls += 1;
    await gate;
    return 'linked';
  });
  assert.equal(flight.isBusy(), true);
  // A second tap while busy resolves null WITHOUT invoking the function.
  assert.equal(await flight.run(async () => 'duplicate'), null);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 'linked');
  assert.equal(flight.isBusy(), false);
  // Sequential submissions still work after the first settles.
  assert.equal(await flight.run(async () => 'again'), 'again');
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// Safe error mapping (no database internals reach the UI)
// ---------------------------------------------------------------------------

test('auth failures map to safe messages and never leak internals', () => {
  assert.equal(toSafeAuthError(new Error('Invalid login credentials')).message, 'Invalid email or password. Please try again.');
  assert.equal(toSafeAuthError(new Error('Invalid login credentials')).code, 'invalid-credentials');
  assert.equal(toSafeAuthError(new Error('Email not confirmed')).code, 'email-not-confirmed');
  assert.equal(toSafeAuthError(new Error('User already registered')).code, 'email-in-use');
  assert.equal(toSafeAuthError(new Error('Password should be at least 6 characters')).code, 'validation');
  assert.match(toSafeAuthError(new Error('over request rate limit')).message, /Too many attempts/);
  assert.equal(toSafeAuthError(new Error('Failed to fetch')).code, 'network');
  const leaked = toSafeAuthError(new Error('column "auth"."x" does not exist (42P01)'));
  assert.equal(leaked.code, 'unknown');
  assert.doesNotMatch(leaked.message, /column|42P01/);
  assert.match(toSafeAuthError(new Error('x'), 'signup').message, /Account creation failed/);
  assert.match(toSafeAuthError(new Error('x'), 'reset').message, /Password reset failed/);
});

test('referral failures map to safe messages with already-linked as a signal', () => {
  const invalid = toSafeReferralError(new Error('Referral linking failed (22023): Invalid or inactive referral code'));
  assert.equal(invalid.code, 'invalid-code');
  assert.equal(invalid.message, 'Invalid referral code. Please check and try again.');
  assert.equal(toSafeReferralError(new Error('You cannot use your own referral code')).code, 'invalid-code');
  const linked = toSafeReferralError(new Error('This account is already linked to a Growth Partner'));
  assert.equal(linked.code, 'already-linked');
  assert.equal(toSafeReferralError(new Error('Sign in required')).code, 'session');
  assert.equal(toSafeReferralError(new Error('JWT expired')).code, 'session');
  const leaked = toSafeReferralError(new Error('permission denied for table growth_onboarding (42501)'));
  assert.equal(leaked.code, 'unknown');
  assert.doesNotMatch(leaked.message, /permission denied|42501|growth_onboarding/);
});

// ---------------------------------------------------------------------------
// Supabase wrappers through injectable fakes
// ---------------------------------------------------------------------------

const ok = (data: any) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: new Error(message) });

function fakeAuth(overrides: Record<string, any> = {}) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const record = (method: string) => async (...args: any[]) => {
    calls.push({ method, args });
    const stub = overrides[method];
    if (typeof stub === 'function') return stub(...args);
    if (stub !== undefined) return stub;
    throw new Error(`unexpected auth call: ${method}`);
  };
  return {
    calls,
    auth: {
      signUp: record('signUp'),
      signInWithPassword: record('signInWithPassword'),
      resetPasswordForEmail: record('resetPasswordForEmail'),
      signOut: record('signOut'),
      getSession: record('getSession'),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  };
}

test('sign up succeeds with valid credentials and flags email confirmation', async () => {
  const { calls, auth } = fakeAuth({
    signUp: ok({ user: { id: 'u-1', email: 'you@example.com' }, session: { access_token: 't' } }),
  });
  const result = await signUpWithEmail({ auth, rpc: async () => ok(null) } as any, {
    email: '  you@example.com ',
    password: 'secret1',
    confirm: 'secret1',
  });
  assert.deepEqual(result, { viewer: { id: 'u-1', email: 'you@example.com' }, confirmationRequired: false });
  assert.equal(calls.length, 1);
  // Passwords go to Supabase Auth only — trimmed email, no manual storage.
  assert.deepEqual(calls[0].args[0], { email: 'you@example.com', password: 'secret1' });

  // User object without a session means "verify your email", not a login.
  const pending = fakeAuth({ signUp: ok({ user: { id: 'u-2', email: 'n@example.com' }, session: null }) });
  const confirmation = await signUpWithEmail({ auth: pending.auth, rpc: async () => ok(null) } as any, {
    email: 'n@example.com',
    password: 'secret1',
    confirm: 'secret1',
  });
  assert.equal(confirmation.confirmationRequired, true);
});

test('sign up rejects invalid email and mismatched passwords without calling Auth', async () => {
  const { calls, auth } = fakeAuth({ signUp: ok({}) });
  const client = { auth, rpc: async () => ok(null) } as any;
  await assert.rejects(
    signUpWithEmail(client, { email: 'bad', password: 'secret1', confirm: 'secret1' }),
    /valid email/
  );
  await assert.rejects(
    signUpWithEmail(client, { email: 'you@example.com', password: 'secret1', confirm: 'secret2' }),
    /do not match/
  );
  await assert.rejects(
    signUpWithEmail(client, { email: 'you@example.com', password: '12345', confirm: '12345' }),
    /at least 6/
  );
  assert.equal(calls.length, 0);
  const taken = fakeAuth({ signUp: fail('User already registered') });
  await assert.rejects(
    signUpWithEmail({ auth: taken.auth, rpc: async () => ok(null) } as any, {
      email: 'you@example.com',
      password: 'secret1',
      confirm: 'secret1',
    }),
    /already exists/
  );
});

test('login succeeds with valid credentials and rejects invalid ones safely', async () => {
  const { calls, auth } = fakeAuth({
    signInWithPassword: ok({ user: { id: 'u-1', email: 'you@example.com' }, session: { access_token: 't' } }),
  });
  const result = await signInWithEmail({ auth, rpc: async () => ok(null) } as any, {
    email: 'you@example.com',
    password: 'secret1',
  });
  assert.deepEqual(result, { viewer: { id: 'u-1', email: 'you@example.com' } });
  assert.deepEqual(calls[0].args[0], { email: 'you@example.com', password: 'secret1' });

  const bad = fakeAuth({ signInWithPassword: fail('Invalid login credentials') });
  const error = await signInWithEmail({ auth: bad.auth, rpc: async () => ok(null) } as any, {
    email: 'you@example.com',
    password: 'wrong',
  }).then(
    () => null,
    (err: Error) => err
  );
  assert.ok(error instanceof OnboardingError);
  assert.equal(error.code, 'invalid-credentials');
  assert.equal(error.message, 'Invalid email or password. Please try again.');
});

test('password reset sends via Supabase Auth with safe request/success/failure states', async () => {
  const { calls, auth } = fakeAuth({ resetPasswordForEmail: ok({}) });
  await sendPasswordReset({ auth, rpc: async () => ok(null) } as any, '  you@example.com ');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'you@example.com');

  // Invalid email never reaches the backend.
  const invalid = fakeAuth({ resetPasswordForEmail: ok({}) });
  await assert.rejects(
    sendPasswordReset({ auth: invalid.auth, rpc: async () => ok(null) } as any, 'bad'),
    /valid email/
  );
  assert.equal(invalid.calls.length, 0);

  // Transport failures surface a safe message.
  const down = fakeAuth({ resetPasswordForEmail: fail('Failed to fetch') });
  await assert.rejects(
    sendPasswordReset({ auth: down.auth, rpc: async () => ok(null) } as any, 'you@example.com'),
    /Network error/
  );
});

test('valid referral codes link through the backend RPC with a normalized code', async () => {
  const rpcCalls: any[] = [];
  const client = {
    auth: fakeAuth().auth,
    rpc: async (fn: string, args: any) => {
      rpcCalls.push([fn, args]);
      return ok({
        growth_partner_id: 'a0000000-0000-4000-8000-000000000001',
        referral_code: 'ALPHA01',
        partner_name: 'Partner Anita',
      });
    },
  } as any;
  const result = await linkReferralCode(client, '  alpha01 ');
  assert.deepEqual(result, { referralCode: 'ALPHA01', partnerName: 'Partner Anita' });
  // Exactly one call, to the secure link RPC — no partner id is ever supplied.
  assert.deepEqual(rpcCalls, [['link_my_growth_referral', { p_code: 'ALPHA01' }]]);
});

test('invalid referral codes are rejected with a safe message and no relationship', async () => {
  const client = {
    auth: fakeAuth().auth,
    rpc: async () => fail('Invalid or inactive referral code'),
  } as any;
  const error = await linkReferralCode(client, 'NOPE99').then(
    () => null,
    (err: Error) => err
  );
  assert.ok(error instanceof OnboardingError);
  assert.equal(error.code, 'invalid-code');
  assert.equal(error.message, 'Invalid referral code. Please check and try again.');

  // Empty input is caught before any backend call.
  let rpcCalls = 0;
  const counting = { auth: fakeAuth().auth, rpc: async () => (rpcCalls++, ok({})) } as any;
  await assert.rejects(linkReferralCode(counting, '   '), /Enter your referral code/);
  assert.equal(rpcCalls, 0);
});

test('logout signs out via Supabase Auth and protected routes then bounce to login', async () => {
  const { calls, auth } = fakeAuth({ signOut: { error: null } });
  await signOutViewer({ auth, rpc: async () => ok(null) } as any);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'signOut');
  // Even a failing transport still resolves logout locally (never traps).
  const down = fakeAuth({
    signOut: async () => {
      throw new Error('Failed to fetch');
    },
  });
  await signOutViewer({ auth: down.auth, rpc: async () => ok(null) } as any);
  // Signed-out routing for every protected + auth screen.
  for (const requested of ['referral', 'status'] as const) {
    assert.equal(resolveOnboardingRoute({ hasSession: false, phase: 'pending', requested }), 'login');
  }
});

test('sessions survive refresh via the persisted Supabase session', async () => {
  const { calls, auth } = fakeAuth({
    getSession: ok({ session: { user: { id: 'u-1', email: 'you@example.com' } } }),
  });
  const viewer = await loadViewer({ auth, rpc: async () => ok(null) } as any);
  assert.deepEqual(viewer, { id: 'u-1', email: 'you@example.com' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'getSession');

  const signedOut = fakeAuth({ getSession: ok({ session: null }) });
  assert.equal(await loadViewer({ auth: signedOut.auth, rpc: async () => ok(null) } as any), null);
});

test('the onboarding snapshot comes from backend RPCs, never local state', async () => {
  const rpcCalls: string[] = [];
  const client = {
    auth: fakeAuth().auth,
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      if (fn === 'get_my_onboarding_status') {
        return ok({ status: 'linked', linked: true, referral_code: 'ALPHA01', growth_partner_id: 'p-1' });
      }
      return ok({ growth_partner_id: 'p-1', referral_code: 'ALPHA01', partner_name: 'Partner Anita' });
    },
  } as any;
  assert.deepEqual(await fetchOnboardingSnapshot(client), {
    phase: 'referral_added',
    linked: true,
    referralCode: 'ALPHA01',
    partnerId: 'p-1',
    partnerName: 'Partner Anita',
  });
  assert.deepEqual(rpcCalls, ['get_my_onboarding_status', 'get_my_growth_referral']);

  const fresh = { auth: fakeAuth().auth, rpc: async () => ok(null) } as any;
  assert.equal((await fetchOnboardingSnapshot(fresh)).phase, 'pending');

  const expired = { auth: fakeAuth().auth, rpc: async () => fail('JWT expired') } as any;
  const error = await fetchOnboardingSnapshot(expired).then(
    () => null,
    (err: Error) => err
  );
  assert.ok(error instanceof OnboardingError);
  assert.equal(error.code, 'session');
});

// ---------------------------------------------------------------------------
// Rendered screens (react-dom/server)
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function countInputs(html: string): number {
  return (html.match(/<input/g) || []).length;
}

test('sign up renders email + password + confirm and nothing business-related', () => {
  const html = render(React.createElement(SignupScreen, {}));
  assert.match(html, new RegExp(SIGNUP_TITLE));
  assert.match(html, new RegExp(SIGNUP_SUBTITLE));
  assert.equal(countInputs(html), 3);
  assert.match(html, /type="email"/);
  assert.match(html, /Confirm password/);
  assert.match(html, /Log in/);
  assert.doesNotMatch(html, /business|salon|staff|phone|address|GST|payment/i);
});

test('login renders credentials, forgot password and a sign-up link', () => {
  const html = render(React.createElement(LoginScreen, {}));
  assert.match(html, new RegExp(LOGIN_TITLE));
  assert.match(html, new RegExp(LOGIN_SUBTITLE));
  assert.equal(countInputs(html), 2);
  assert.match(html, /Forgot password\?/);
  assert.match(html, /Create an account/);
});

test('forgot password renders the request state with safe copy', () => {
  const html = render(React.createElement(ForgotPasswordScreen, {}));
  assert.match(html, new RegExp(FORGOT_TITLE));
  assert.match(html, new RegExp(FORGOT_SUBTITLE));
  assert.equal(countInputs(html), 1);
  assert.match(html, /Send reset link/);
  assert.match(html, /Back to login/);
  assert.match(FORGOT_SUCCESS, /If an account exists/);
});

test('the referral screen asks ONLY for the referral code', () => {
  const html = render(React.createElement(ReferralScreen, { email: 'you@example.com' }));
  assert.match(html, new RegExp(REFERRAL_TITLE));
  assert.match(html, new RegExp(REFERRAL_SUBTITLE));
  assert.equal(countInputs(html), 1);
  assert.match(html, /Continue/);
  assert.match(html, /you@example\.com/);
  for (const forbidden of ['name=".*name"', 'business', 'address', 'phone', 'GST', 'staff', 'payment', 'website']) {
    assert.doesNotMatch(html.toLowerCase(), new RegExp(forbidden.toLowerCase()));
  }
});

test('the referral form disables Continue and shows progress while verifying', () => {
  const idle = render(
    React.createElement(ReferralForm, { code: '', busy: false, error: '', onCodeChange: () => {}, onSubmit: () => {} })
  );
  assert.match(idle, />Continue</);
  assert.doesNotMatch(idle, /disabled=""/);
  const busy = render(
    React.createElement(ReferralForm, {
      code: 'ALPHA01',
      busy: true,
      error: '',
      onCodeChange: () => {},
      onSubmit: () => {},
    })
  );
  assert.match(busy, /disabled=""/);
  assert.match(busy, /Verifying…/);
  const withError = render(
    React.createElement(ReferralForm, {
      code: 'NOPE99',
      busy: false,
      error: 'Invalid referral code. Please check and try again.',
      onCodeChange: () => {},
      onSubmit: () => {},
    })
  );
  assert.match(withError, /Invalid referral code\. Please check and try again\./);
});

test('the status screen confirms verification and performs no Template App handoff', () => {
  const html = render(
    React.createElement(StatusScreen, {
      phase: 'referral_added',
      referralCode: 'ALPHA01',
      partnerName: 'Partner Anita',
      email: 'you@example.com',
      onLogout: () => {},
    })
  );
  assert.match(html, /Referral code verified successfully\./);
  assert.match(html, /ALPHA01/);
  assert.match(html, /Partner Anita/);
  assert.match(html, /Sign out/);
  assert.doesNotMatch(html, /vercel\.app|handoff|template app|fanal-templetes/i);
  assert.match(html, new RegExp(STATUS_VERIFIED_TITLE));
});

test('boot, error and mock states render instead of blank screens', () => {
  const firstPaint = render(React.createElement(OnboardingApp, { path: '/onboarding', navigate: () => {} }));
  // Effects do not run in SSR: first paint is the loading state…
  assert.match(firstPaint, /Loading onboarding|needs a live connection/);
});

// ---------------------------------------------------------------------------
// Backend contract the flow relies on (PGlite + Phase 1 migration)
// ---------------------------------------------------------------------------

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);

async function setupDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id) values ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}');
    insert into public.profiles(id, full_name) values ('${PARTNER_A}', 'Partner Anita');
  `);
  await db.exec(MIGRATION);
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
  return db;
}

test('a valid code links through the RPC and persists the relationship + state', async () => {
  const db = await setupDb();
  try {
    // Before: no relationship, pending state.
    assert.equal((await asUser(db, USER_1, 'select public.get_my_growth_referral() as r')).rows[0].r, null);
    const before = (await asUser(db, USER_1, 'select public.get_my_onboarding_status() as s')).rows[0].s;
    assert.equal(before.status, 'not_started');
    assert.equal(before.linked, false);

    // The exact call the app makes: code only, no partner id parameter exists.
    const linked = (await asUser(db, USER_1, 'select public.link_my_growth_referral($1) as r', ['  alpha01 ']))
      .rows[0].r;
    assert.equal(linked.growth_partner_id, PARTNER_A);
    assert.equal(linked.referral_code, CODE_A);
    assert.equal(linked.status, 'linked');

    // After: relationship + status read back from the backend (routing truth).
    const rel = (await asUser(db, USER_1, 'select public.get_my_growth_referral() as r')).rows[0].r;
    assert.equal(rel.growth_partner_id, PARTNER_A);
    assert.equal(rel.partner_name, 'Partner Anita');
    const after = (await asUser(db, USER_1, 'select public.get_my_onboarding_status() as s')).rows[0].s;
    assert.equal(after.status, 'linked');
    assert.equal(after.linked, true);
  } finally {
    await db.close();
  }
});

test('an invalid code is rejected and creates no relationship', async () => {
  const db = await setupDb();
  try {
    await assert.rejects(
      asUser(db, USER_1, 'select public.link_my_growth_referral($1)', ['NOPE99']),
      /Invalid or inactive referral code/
    );
    assert.equal((await db.query('select * from public.growth_onboarding')).rows.length, 0);
    assert.equal((await asUser(db, USER_1, 'select public.get_my_growth_referral() as r')).rows[0].r, null);
  } finally {
    await db.close();
  }
});

test('the referral owner cannot be altered through frontend-style manipulation', async () => {
  const db = await setupDb();
  try {
    await asUser(db, USER_1, 'select public.link_my_growth_referral($1)', [CODE_A]);
    // Re-linking to another partner is refused; the owner is unchanged.
    await assert.rejects(
      asUser(db, USER_1, 'select public.link_my_growth_referral($1)', [CODE_B]),
      /already linked/
    );
    const rel = (await asUser(db, USER_1, 'select public.get_my_growth_referral() as r')).rows[0].r;
    assert.equal(rel.growth_partner_id, PARTNER_A);
    // Direct writes around the RPC are denied (no write grants for clients).
    await assert.rejects(
      asUser(
        db,
        USER_1,
        'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid',
        [PARTNER_B, USER_1]
      ),
      /permission denied|row-level security/i
    );
    await assert.rejects(
      asUser(db, USER_1, `insert into public.growth_onboarding(user_id, status) values ('${USER_1}', 'linked')`),
      /permission denied|row-level security/i
    );
    const row = (await db.query<any>('select * from public.growth_onboarding where user_id = $1::uuid', [USER_1]))
      .rows[0];
    assert.equal(row.growth_partner_id, PARTNER_A);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Secrets: the onboarding frontend must stay privilege-free
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';

function onboardingSources(): string[] {
  const root = new URL('../src/onboarding', import.meta.url);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full);
    }
  };
  const rootPath = fileURLToPath(root);
  walk(rootPath);
  walk(join(rootPath, 'lib'));
  walk(join(rootPath, 'screens'));
  return files;
}

test('no privileged Supabase key is exposed in the onboarding frontend', () => {
  const files = onboardingSources();
  assert.ok(files.length >= 8, `expected the onboarding sources, found ${files.length}`);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE|getSupabaseAdmin|supabaseAdmin|sb_secret/);
    // No hardcoded JWT-shaped secrets either.
    assert.doesNotMatch(codeOnly, /eyJhbGciOiJ9/);
  }
  // Supabase reaches onboarding screens only through the shared client / RPC lib.
  const appSrc = readFileSync(new URL('../src/onboarding/OnboardingApp.tsx', import.meta.url), 'utf8');
  assert.match(appSrc, /from '\.\.\/lib\/supabaseClient'/);
  const authSrc = readFileSync(new URL('../src/onboarding/lib/auth.ts', import.meta.url), 'utf8');
  assert.match(authSrc, /VITE_SUPABASE_URL|supabaseClient/);
  assert.doesNotMatch(authSrc.replace(/\/\*[\s\S]*?\*\//g, ''), /SUPABASE_SERVICE_ROLE_KEY/);
});
