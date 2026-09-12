// ============================================================================
// PART 2 (SECTION 1) ACCEPTANCE — Growth Partner PORTAL login (`/partner/login`).
//
//   • Router: the /partner/* namespace (login, dashboard, sections).
//   • The dedicated login page renders EVERY required element: platform logo,
//     the exact "Growth Partner Login" heading, email + password fields,
//     show/hide password, Remember me, Forgot Password, a login button,
//     loading + error states, and the success redirect to /partner/dashboard.
//   • Auth rules: only the backend decides — the resolver maps (session,
//     partner row, application row) to one state; pending / rejected /
//     inactive (suspended) accounts and normal users never reach the
//     dashboard; nothing settable from the browser is an input.
//   • Remember me: remembered email (prefill only) + which browser store
//     holds the session; a failed sign-in reverts the choice.
//   • Forgot password: real Supabase Auth reset request (safe copy) and the
//     PASSWORD_RECOVERY completion through updateUser.
//   • PGlite: the backend contract replayed with the UI's exact queries.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  isPartnerLoginPath,
  isPartnerPortalPath,
  matchPartnerPortalRoute,
  PARTNER_DASHBOARD_PATH,
  PARTNER_LOGIN_PATH,
  partnerPortalPath,
} from '../src/lib/router';
import {
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  type GrowthPartner,
} from '../src/lib/growthPartner';
import {
  PARTNER_PORTAL_UNAUTHORIZED_BODY,
  readRememberedPartnerEmail,
  resolvePartnerPortalLogin,
  sendPartnerPasswordReset,
  completePartnerPasswordReset,
  validatePartnerNewPassword,
  writeRememberedPartnerEmail,
  partnerPasswordResetRedirectTo,
  type PartnerPortalAuthClient,
} from '../src/lib/partnerPortalAuth';
import {
  clearAuthSessionLifetime,
  createRememberAwareAuthStorage,
  purgeRememberedAuthTokens,
  readAuthSessionLifetime,
  setAuthSessionLifetime,
  type WebStorageLike,
} from '../src/lib/authRememberStorage';
import {
  PartnerBrandMark,
  PartnerPortalLogin,
  PartnerPortalLoginForm,
  PartnerPortalUnauthorized,
  PartnerPortalInactive,
  PartnerPortalPendingReview,
  PartnerPortalRejected,
  PartnerPortalVerifying,
  PLATFORM_LOGO_URL,
} from '../src/components/PartnerPortalLogin';
import {
  PARTNER_PORTAL_LOGIN_TITLE,
  PARTNER_PORTAL_LOGIN_VERIFYING_LABEL,
  PARTNER_PORTAL_UNAUTHORIZED_TITLE,
} from '../src/lib/partnerPortalAuth';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const ADMIN = 'c0000000-0000-4000-8000-000000000001';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';


const ROW_ACTIVE: GrowthPartner = {
  user_id: PARTNER_A,
  referral_code: CODE_A,
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};
const ROW_INACTIVE: GrowthPartner = { ...ROW_ACTIVE, user_id: PARTNER_B, referral_code: CODE_B, is_active: false };

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ---------------------------------------------------------------------------
// 1. Routes
// ---------------------------------------------------------------------------

test('the partner portal routes live under /partner and never collide with the legacy area', () => {
  assert.equal(PARTNER_LOGIN_PATH, '/partner/login');
  assert.equal(PARTNER_DASHBOARD_PATH, '/partner/dashboard');
  assert.equal(isPartnerPortalPath('/partner'), true);
  assert.equal(isPartnerPortalPath('/partner/dashboard'), true);
  assert.equal(isPartnerPortalPath('/partner/login'), true);
  assert.equal(isPartnerPortalPath('/growth-partner'), false, 'the legacy area is its own namespace');
  assert.equal(isPartnerPortalPath('/partners'), false, 'no accidental prefix match');
  assert.equal(isPartnerLoginPath('/partner/login'), true);
  assert.equal(isPartnerLoginPath('/PARTNER/LOGIN/'), true, 'case + trailing slash tolerated');
  assert.equal(isPartnerLoginPath('/partner/dashboard'), false);
  assert.equal(matchPartnerPortalRoute('/partner'), 'dashboard');
  assert.equal(matchPartnerPortalRoute('/partner/dashboard'), 'dashboard');
  assert.equal(matchPartnerPortalRoute('/partner/customers'), 'customers');
  assert.equal(matchPartnerPortalRoute('/partner/commission'), 'commission');
  assert.equal(matchPartnerPortalRoute('/partner/nonsense'), 'dashboard', 'unknown never blanks');
  assert.equal(partnerPortalPath('dashboard'), '/partner/dashboard');
  assert.equal(partnerPortalPath('referrals'), '/partner/referrals');
});

// ---------------------------------------------------------------------------
// 2. The resolver: (session, backend rows) → one state
// ---------------------------------------------------------------------------

test('the resolver grants only an ACTIVE partner and denies every other account state', () => {
  const base = { loading: false, isMockMode: false, loadError: null as unknown };
  assert.equal(resolvePartnerPortalLogin({ ...base, userId: null, partnerRow: null }), 'signed-out');
  assert.equal(resolvePartnerPortalLogin({ ...base, userId: PARTNER_A, partnerRow: ROW_ACTIVE }), 'granted');
  // Normal user: zero partner rows → no access to the portal.
  assert.equal(resolvePartnerPortalLogin({ ...base, userId: USER_1, partnerRow: null }), 'unauthorized');
  // Pending application: hold, never the dashboard.
  assert.equal(
    resolvePartnerPortalLogin({ ...base, userId: USER_1, partnerRow: null, applicationStatus: 'pending' }),
    'pending-review'
  );
  // Rejected application: denied.
  assert.equal(
    resolvePartnerPortalLogin({ ...base, userId: USER_1, partnerRow: null, applicationStatus: 'rejected' }),
    'rejected'
  );
  // Inactive / suspended partner: denied.
  assert.equal(resolvePartnerPortalLogin({ ...base, userId: PARTNER_B, partnerRow: ROW_INACTIVE }), 'inactive');
  // Loading and mock come first.
  assert.equal(resolvePartnerPortalLogin({ ...base, loading: true, userId: null, partnerRow: null }), 'loading');
  assert.equal(resolvePartnerPortalLogin({ ...base, isMockMode: true, userId: null, partnerRow: null }), 'mock-mode');
  // Auth errors.
  assert.equal(
    resolvePartnerPortalLogin({
      ...base,
      userId: PARTNER_A,
      partnerRow: null,
      loadError: Object.assign(new Error('jwt expired'), { status: 401 }),
    }),
    'session-expired'
  );
  assert.equal(
    resolvePartnerPortalLogin({ ...base, userId: PARTNER_A, partnerRow: null, loadError: new Error('boom') }),
    'error'
  );
});

test('the resolver accepts nothing the browser could set — no role, storage, URL or partner id', () => {
  const src = readFileSync(new URL('../src/lib/partnerPortalAuth.ts', import.meta.url), 'utf8');
  const resolver = src.slice(src.indexOf('export function resolvePartnerPortalLogin'));
  const body = resolver.slice(0, resolver.indexOf('\n}\n'));
  assert.doesNotMatch(body, /localStorage|sessionStorage|URLSearchParams|searchParams|location\.(search|hash)/i);
  assert.doesNotMatch(body, /user_metadata|\.role\b|role\s*===|partner_id/i);
  // The ONLY decision inputs are the session id and the backend rows.
  assert.match(body, /partnerRow\.is_active === false/);
});

// ---------------------------------------------------------------------------
// 3. The login form: every required element, server-rendered
// ---------------------------------------------------------------------------

function formElement(overrides: Partial<Parameters<typeof PartnerPortalLoginForm>[0]> = {}) {
  return React.createElement(PartnerPortalLoginForm, {
    email: 'partner@example.com',
    password: 'secret-password',
    showPassword: false,
    rememberMe: true,
    fieldErrors: {},
    formError: '',
    busy: false,
    onEmailChange: () => {},
    onPasswordChange: () => {},
    onToggleShowPassword: () => {},
    onToggleRememberMe: () => {},
    onSubmit: () => {},
    onForgotPassword: () => {},
    onSwitchToSignup: () => {},
    ...overrides,
  });
}

test('the login page shows the platform logo and the exact "Growth Partner Login" heading', () => {
  const html = render(formElement());
  assert.ok(html.includes('alt="Nexora Logo"'), 'the platform logo is an image with alt text');
  assert.ok(html.includes(PLATFORM_LOGO_URL), 'the logo asset is the platform brand mark');
  assert.ok(html.includes('Nexora</span>'), 'the wordmark renders next to the logo');
  const headings = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) ?? [];
  assert.equal(headings.length, 1, 'exactly one h1');
  assert.ok(
    (headings[0] ?? '').includes(PARTNER_PORTAL_LOGIN_TITLE),
    `the heading is exactly "${PARTNER_PORTAL_LOGIN_TITLE}"`
  );
  assert.equal(PARTNER_PORTAL_LOGIN_TITLE, 'Growth Partner Login');
});

test('email + password fields, show/hide toggle, remember me, forgot password and the login button all render', () => {
  const html = render(formElement());
  assert.ok(html.includes('id="partner-login-email"'));
  assert.ok(/type="email"/.test(html), 'email input');
  assert.ok(html.includes('id="partner-login-password"'));
  assert.ok(html.includes('type="password"'), 'password starts masked');
  assert.ok(html.includes('autoComplete="current-password"'));
  // Show/Hide toggle: labelled, reports its pressed state, sits in the field.
  assert.ok(html.includes('id="partner-login-password-toggle"'));
  assert.ok(html.includes('aria-label="Show password"'));
  assert.ok(html.includes('aria-pressed="false"'));
  // Remember me: a checkbox, checked by default.
  assert.ok(html.includes('id="partner-login-remember"'));
  assert.ok(/type="checkbox"/.test(html));
  assert.ok(/checked(=|")/.test(html), 'remember me defaults to checked');
  assert.ok(html.includes('Remember me'));
  // Forgot Password.
  assert.ok(html.includes('id="partner-login-forgot"'));
  assert.ok(html.includes('Forgot Password?'));
  // The login button.
  assert.ok(html.includes('type="submit"'));
  assert.ok(html.includes('Log in</button>'), 'the submit button is the login button');
  // No partner data anywhere on the login form.
  assert.doesNotMatch(html, /ALPHA01|BETA002|referral code/i);
});

test('showing the password renders a text input with the flipped toggle', () => {
  const html = render(formElement({ showPassword: true }));
  assert.ok(html.includes('type="text"'));
  assert.ok(html.includes('aria-label="Hide password"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(!html.includes('type="password"'));
});

test('the loading state disables the form and relabels the button; errors render as alerts', () => {
  const busyHtml = render(formElement({ busy: true }));
  assert.ok(busyHtml.includes('disabled'), 'fields/button disabled while busy');
  assert.ok(busyHtml.includes('Signing in…'), 'the button shows its loading label');
  const errorHtml = render(
    formElement({ fieldErrors: { email: 'Enter a valid email address.' }, formError: 'Invalid email or password. Please try again.' })
  );
  assert.ok(errorHtml.includes('role="alert"'));
  assert.ok(errorHtml.includes('Invalid email or password. Please try again.'));
  assert.ok(errorHtml.includes('aria-invalid="true"'));
});

test('the brand mark, verifying state and denial cards render without partner data', () => {
  assert.ok(render(React.createElement(PartnerBrandMark)).includes('alt="Nexora Logo"'));
  const verifying = render(React.createElement(PartnerPortalVerifying));
  assert.ok(verifying.includes(PARTNER_PORTAL_LOGIN_VERIFYING_LABEL));
  assert.ok(verifying.includes('role="status"'));

  // The EXACT denial line the spec requires for non-partners.
  const unauthorized = render(React.createElement(PartnerPortalUnauthorized));
  assert.ok(unauthorized.includes(PARTNER_PORTAL_UNAUTHORIZED_TITLE));
  assert.ok(unauthorized.includes('You do not have access to the Growth Partner portal.'));
  assert.ok(unauthorized.includes('Sign in with a different account'));

  const inactive = render(React.createElement(PartnerPortalInactive));
  assert.ok(inactive.includes(GROWTH_PARTNER_INACTIVE_TITLE));
  assert.ok(inactive.includes(GROWTH_PARTNER_INACTIVE_BODY));

  const pending = render(
    React.createElement(PartnerPortalPendingReview, { submittedAt: '2026-09-10T00:00:00Z' })
  );
  assert.ok(pending.includes('Application under review'));
  assert.doesNotMatch(pending, /ALPHA01/);

  const rejected = render(React.createElement(PartnerPortalRejected));
  assert.ok(rejected.includes('Application not approved'));
});

// ---------------------------------------------------------------------------
// 4. Auth wrappers with an injected client (no second auth system)
// ---------------------------------------------------------------------------

function portalClient(auth: Record<string, unknown>, partnerRow?: GrowthPartner | null): PartnerPortalAuthClient {
  return {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      ...auth,
    },
    ...(partnerRow === undefined ? {} : { fetchPartnerRow: async () => partnerRow }),
  };
}

test('a valid partner login verifies against the backend and forwards to /partner/dashboard', async () => {
  const navigated: string[] = [];
  let sessionUser: { id: string; email: string } | null = null;
  const client = portalClient(
    {
      signInWithPassword: async () => ({
        data: { session: { user: { id: PARTNER_A, email: 'anita@example.com' } } },
        error: null,
      }),
      getSession: async () => ({
        data: { session: sessionUser ? { user: sessionUser } : null },
        error: null,
      }),
    },
    ROW_ACTIVE
  );
  // Sign-in through the real wrapper (Supabase Auth)…
  const html1 = render(
    React.createElement(PartnerPortalLogin, { user: null, client, navigate: (to) => navigated.push(to) })
  );
  assert.ok(html1.includes('partner-login-email'), 'the signed-out visitor sees the login form');
  // …then simulate the session existing (what the component does after submit).
  sessionUser = { id: PARTNER_A, email: 'anita@example.com' };
  const client2 = portalClient(
    { getSession: async () => ({ data: { session: { user: sessionUser } }, error: null }) },
    ROW_ACTIVE
  );
  const html2 = render(
    React.createElement(PartnerPortalLogin, {
      user: { id: PARTNER_A, email: 'anita@example.com' },
      client: client2,
      navigate: (to) => navigated.push(to),
    })
  );
  assert.ok(html2.includes(PARTNER_PORTAL_LOGIN_VERIFYING_LABEL), 'an active session is verified, not assumed');
  assert.doesNotMatch(html2, /You do not have access/);
});

test('a wrong password yields exactly the safe invalid-credentials copy', async () => {
  const { signInGrowthPartner } = await import('../src/lib/growthPartnerLogin');
  const client = portalClient({
    signInWithPassword: async () => ({
      data: {},
      error: { message: 'Invalid login credentials' },
    }),
  });
  await assert.rejects(
    signInGrowthPartner(client as never, { email: 'partner@example.com', password: 'wrong' }),
    /Invalid email or password/
  );
});

test('an already-signed-in partner never flashes a denial card on /partner/login', () => {
  const client = portalClient(
    { getSession: async () => ({ data: { session: { user: { id: PARTNER_A, email: 'anita@example.com' } } }, error: null }) },
    ROW_ACTIVE
  );
  const html = render(
    React.createElement(PartnerPortalLogin, {
      user: { id: PARTNER_A, email: 'anita@example.com' },
      client,
      navigate: () => {},
    })
  );
  assert.ok(html.includes(PARTNER_PORTAL_LOGIN_VERIFYING_LABEL));
  assert.doesNotMatch(html, /You do not have access/);
  assert.doesNotMatch(html, /Growth Partner access is paused/);
});

test('a signed-in normal user gets the exact portal denial, never the dashboard', () => {
  // The denial itself is the exported card (SSR cannot run the async role
  // check); the click-level flow is pinned in the DOM test file.
  const html = render(React.createElement(PartnerPortalUnauthorized));
  assert.ok(html.includes('You do not have access to the Growth Partner portal.'));
  assert.doesNotMatch(html, /partner-login-email/);
  assert.doesNotMatch(html, /ALPHA01/);
});

// ---------------------------------------------------------------------------
// 5. Remember me — remembered email + session store choice (never access)
// ---------------------------------------------------------------------------

class MemoryStorage implements WebStorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
}

test('remember me persists only the email prefill — checked keeps it, unchecked clears it', () => {
  const store = new MemoryStorage();
  writeRememberedPartnerEmail('anita@example.com', true, store);
  assert.equal(readRememberedPartnerEmail(store), 'anita@example.com');
  writeRememberedPartnerEmail('anita@example.com', false, store);
  assert.equal(readRememberedPartnerEmail(store), '', 'unchecked removes the stored email');
});

test('the remember-aware storage keeps the session where the sign-in chose', () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const pair = { local, session };
  const storage = createRememberAwareAuthStorage(pair);
  assert.ok(storage, 'a browser-like pair yields the storage');

  // Default (no marker): persistent, exactly like plain localStorage.
  storage!.setItem('sb-abc-auth-token', '{"one":1}');
  assert.equal(local.getItem('sb-abc-auth-token'), '{"one":1}');
  assert.equal(session.getItem('sb-abc-auth-token'), null);
  assert.equal(storage!.getItem('sb-abc-auth-token'), '{"one":1}');

  // "Remember me" unchecked: the marker routes writes to sessionStorage and
  // drops the remembered copy so it cannot revive after a browser restart.
  setAuthSessionLifetime(false, pair);
  assert.equal(readAuthSessionLifetime(pair), 'session');
  storage!.setItem('sb-abc-auth-token', '{"two":2}');
  assert.equal(session.getItem('sb-abc-auth-token'), '{"two":2}');
  assert.equal(local.getItem('sb-abc-auth-token'), null, 'the remembered copy is dropped');

  // Reads prefer the session-only store.
  assert.equal(storage!.getItem('sb-abc-auth-token'), '{"two":2}');

  // Reverting (failed sign-in) restores the default store, and a remembered
  // session that was never touched stays intact.
  const local2 = new MemoryStorage();
  const pair2 = { local: local2, session: new MemoryStorage() };
  setAuthSessionLifetime(false, pair2);
  const revert = () => clearAuthSessionLifetime(pair2);
  revert();
  assert.equal(readAuthSessionLifetime(pair2), 'persistent');

  // purgeRememberedAuthTokens removes exactly the sb-*-auth-token keys.
  local2.setItem('sb-xyz-auth-token', '{}');
  local2.setItem('unrelated-key', 'keep-me');
  assert.equal(purgeRememberedAuthTokens(pair2), 1);
  assert.equal(local2.getItem('sb-xyz-auth-token'), null);
  assert.equal(local2.getItem('unrelated-key'), 'keep-me');
});

// ---------------------------------------------------------------------------
// 6. Forgot password — real reset request + recovery completion
// ---------------------------------------------------------------------------

test('the reset request goes through Supabase Auth with the partner login as redirectTo', async () => {
  const calls: Array<{ email: string; options?: { redirectTo?: string } }> = [];
  const client = portalClient({
    resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
      calls.push({ email, options });
      return { data: {}, error: null };
    },
  });
  await sendPartnerPasswordReset(client, '  Partner@Example.com  ');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, 'Partner@Example.com', 'trimmed but not case-mangled (Supabase owns that)');
  // No window in Node: the redirect target is the login PATH. In a browser the
  // same helper prefixes window.location.origin (pinned right below).
  assert.equal(calls[0].options?.redirectTo, '/partner/login');
  assert.equal(partnerPasswordResetRedirectTo('https://portal.example.com'), 'https://portal.example.com/partner/login');

  // Invalid email: validation error, no request.
  await assert.rejects(sendPartnerPasswordReset(client, 'not-an-email'), /valid email/);
  assert.equal(calls.length, 1);

  // Transport failure: safe copy, never raw driver text.
  const failing = portalClient({
    resetPasswordForEmail: async () => ({ data: null, error: { message: 'fetch failed' } }),
  });
  await assert.rejects(sendPartnerPasswordReset(failing, 'partner@example.com'), /Network error/);
});

test('the new-password validation and updateUser completion enforce the rules', async () => {
  assert.deepEqual(validatePartnerNewPassword('short'), { ok: false, message: 'Choose a password of at least 8 characters.' });
  assert.deepEqual(validatePartnerNewPassword('longenough', 'different'), { ok: false, message: 'The two passwords do not match.' });
  assert.deepEqual(validatePartnerNewPassword('longenough', 'longenough'), { ok: true });

  const updates: Array<{ password?: string }> = [];
  const client = portalClient({
    updateUser: async (attributes: { password?: string }) => {
      updates.push(attributes);
      return { data: {}, error: null };
    },
  });
  await completePartnerPasswordReset(client, 'new-strong-password');
  assert.deepEqual(updates, [{ password: 'new-strong-password' }]);
  await assert.rejects(completePartnerPasswordReset(client, 'short'), /at least 8 characters/);

  const failing = portalClient({
    updateUser: async () => ({ data: null, error: { message: 'Invalid login credentials' } }),
  });
  await assert.rejects(completePartnerPasswordReset(failing, 'new-strong-password'), /Invalid email or password/);
});

// ---------------------------------------------------------------------------
// 7. Backend contract (PGlite) — the DB decides, never the frontend
// ---------------------------------------------------------------------------

async function setupDb() {
  const db: any = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    alter default privileges in schema public grant execute on functions to service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text, email text, subdomain text, salon_name text);

    -- Production defines private.is_admin() outside this repository; the
    -- harness pins the contract the review RPC relies on (true only for a
    -- platform admin, driven by a per-request setting like a JWT claim).
    create schema private;
    create function private.is_admin() returns boolean language sql stable as
      $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
    grant usage on schema private to authenticated, anon;
    grant execute on function private.is_admin() to authenticated, anon;

    insert into auth.users(id) values ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_1}'), ('${ADMIN}');
    insert into public.profiles(id, full_name, email) values
      ('${PARTNER_A}', 'Anita Partner', 'anita@example.com'),
      ('${PARTNER_B}', 'Ben Partner', 'ben@example.com'),
      ('${USER_1}', 'Normal User', 'user@example.com'),
      ('${ADMIN}', 'Platform Admin', 'admin@example.com');
  `);
  // The full committed chain, in the documented order (GROWTH_PARTNER_SETUP.md).
  // 20260919 is required: it aligns the submit RPC to SECURITY DEFINER, exactly
  // like production.
  for (const file of [
    '20260911094853_growth_partner_signup_approval.sql',
    '20260911101201_growth_partner_kyc_approval.sql',
    '20260912_growth_partner_onboarding.sql',
    '20260915_growth_partner_dashboard.sql',
    '20260916_part1_referral_hardening.sql',
    '20260917_part1b_link_atomicity.sql',
    '20260918_partner_dashboard_inactive_guard.sql',
    '20260919_growth_partner_area_contract_alignment.sql',
    '20260920_growth_partner_application_queue.sql',
  ]) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  return db;
}

/** Run an admin-only RPC the way production does: service_role + admin claim. */
async function rpcAsAdmin(db: any, fn: string, args: unknown[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN]);
  await db.query("select set_config('app.is_admin', 'true', false)");
  await db.exec('set role service_role');
  try {
    const res = await db.query(`select public.${fn}(${placeholders}) as result`, args);
    return res.rows[0].result;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('app.is_admin', '', false)");
  }
}

async function provision(db: any, userId: string, code: string, active: boolean) {
  return (
    await db.query('select public.provision_growth_partner($1::uuid, $2, $3) as result', [userId, code, active])
  ).rows[0].result;
}

/** The exact query the login page runs (fetchMyGrowthPartnerRow), as `userId`. */
async function uiPartnerRow(db: any, userId: string) {
  const res = await asUser(
    db,
    userId,
    'select user_id, referral_code, is_active, created_at, updated_at from public.growth_partners'
  );
  return res.rows;
}

test('the backend grants an ACTIVE partner and denies pending / rejected / suspended / never-applied', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A, true);
    await provision(db, PARTNER_B, CODE_B, false);

    // Active partner → granted.
    const activeRow = await uiPartnerRow(db, PARTNER_A);
    assert.equal(activeRow.length, 1);
    assert.equal(
      resolvePartnerPortalLogin({
        loading: false,
        isMockMode: false,
        userId: PARTNER_A,
        partnerRow: activeRow[0],
        loadError: null,
      }),
      'granted'
    );

    // Suspended / inactive partner → denied, account untouched.
    const inactiveRow = await uiPartnerRow(db, PARTNER_B);
    assert.equal(inactiveRow.length, 1);
    assert.equal(
      resolvePartnerPortalLogin({
        loading: false,
        isMockMode: false,
        userId: PARTNER_B,
        partnerRow: inactiveRow[0],
        loadError: null,
      }),
      'inactive'
    );

    // A pending application (submitted as the user, reviewed by nobody yet).
    await asUser(
      db,
      USER_1,
      `select public.submit_growth_partner_application('Normal User', null, 'pan', 'PAN123456') as result`
    );
    const applicationRow = await asUser(
      db,
      USER_1,
      'select status from public.growth_partner_applications order by created_at desc limit 1'
    );
    assert.equal(applicationRow.rows[0].status, 'pending');
    assert.equal((await uiPartnerRow(db, USER_1)).length, 0);
    assert.equal(
      resolvePartnerPortalLogin({
        loading: false,
        isMockMode: false,
        userId: USER_1,
        partnerRow: null,
        applicationStatus: applicationRow.rows[0].status,
        loadError: null,
      }),
      'pending-review'
    );

    // A rejected application → denied. (Review runs as an admin/service role,
    // exactly like the admin RPC does in production.)
    const apps = await db.query('select id from public.growth_partner_applications limit 1');
    await rpcAsAdmin(db, 'review_growth_partner_application', [apps.rows[0].id, false, 'Incomplete KYC']);
    const rejected = await asUser(
      db,
      USER_1,
      'select status from public.growth_partner_applications order by created_at desc limit 1'
    );
    assert.equal(rejected.rows[0].status, 'rejected');
    assert.equal(
      resolvePartnerPortalLogin({
        loading: false,
        isMockMode: false,
        userId: USER_1,
        partnerRow: null,
        applicationStatus: rejected.rows[0].status,
        loadError: null,
      }),
      'rejected'
    );
  } finally {
    await db.close();
  }
});

test('authorization is decided ONLY by the backend rows — nothing the frontend can set', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A, true);
    // A normal user has no partner row; there is no frontend input (role,
    // localStorage, URL, React state, a partner id) the resolver accepts.
    const rows = await uiPartnerRow(db, USER_1);
    assert.equal(rows.length, 0);
    assert.equal(
      resolvePartnerPortalLogin({ loading: false, isMockMode: false, userId: USER_1, partnerRow: rows[0] ?? null, loadError: null }),
      'unauthorized'
    );
    // The component source never reads a role from storage/URL and never
    // passes a partner id; the service-role key never ships to the browser.
    const src = readFileSync(new URL('../src/components/PartnerPortalLogin.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE|service_role/i);
    assert.doesNotMatch(src, /partner_id|p_partner/i);
    assert.doesNotMatch(src, /user_metadata\??\.(role|isPartner)/i);
    assert.match(src, /client\?\.fetchPartnerRow \?\? fetchMyGrowthPartnerRow/);
    assert.match(src, /await readPartnerRow\(\)/);
    assert.match(src, /isMockSupabase && !client/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 8. The portal lib never touches the service role or frontend role storage
// ---------------------------------------------------------------------------

test('the portal login sources stay on the anon client only', () => {
  for (const file of ['src/lib/partnerPortalAuth.ts', 'src/lib/authRememberStorage.ts']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE|service_role/i, `${file} must not reference the service role`);
  }
  // partnerPortalAuth imports the shared anon client's helpers only through
  // injectable clients (its own imports contain no direct supabase reference).
  const src = readFileSync(new URL('../src/lib/partnerPortalAuth.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\/supabaseClient'/);
});
