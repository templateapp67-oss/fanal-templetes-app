// ============================================================================
// PART 2.1 ACCEPTANCE — Growth Partner LOGIN + authorization.
//
//   • Router: /growth-partner/login parsing + relationship to the area.
//   • Resolver: resolveGrowthPartnerLogin maps (session, backend role) to the
//     one state the login route renders; resolveGrowthPartnerGate maps the
//     area's state (both DENY inactive partners now).
//   • Auth wrappers: signIn / session-restore / signOut through injectable
//     fakes (Supabase Auth — no manual password storage).
//   • SSR: the login form fields, verifying/unauthorized/inactive/failure/mock
//     states; no partner data is ever rendered before the backend check.
//   • PGlite: the backend contract — a partner's OWN row decides (active →
//     granted, inactive → denied, normal user → unauthorized), regardless of
//     anything the frontend could claim.
//
//   The 10 requested cases:
//     1. Valid Growth Partner login → success.
//     2. Wrong password → rejected.
//     3. Unauthenticated → cannot access the partner area.
//     4. Normal user → cannot access the partner area.
//     5. Inactive Growth Partner → denied (account/data untouched).
//     6. Refresh → session preserved.
//     7. Logout → access removed.
//     8. URL manipulation / frontend role faking → cannot bypass authorization.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  GROWTH_PARTNER_LOGIN_PATH,
  growthPartnerLoginPath,
  isGrowthPartnerLoginPath,
  isGrowthPartnerPath,
} from '../src/lib/router';
import {
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  resolveGrowthPartnerGate,
} from '../src/lib/growthPartner';
import {
  loadGrowthPartnerSession,
  resolveGrowthPartnerLogin,
  signInGrowthPartner,
  signOutGrowthPartner,
  shouldRedirectToGrowthPartnerLogin,
  toGrowthPartnerLoginError,
  type GrowthPartnerAuthClient,
  type GrowthPartnerViewer,
} from '../src/lib/growthPartnerLogin';
import {
  GROWTH_PARTNER_LOGIN_ERROR_TITLE,
  GROWTH_PARTNER_LOGIN_MOCK_BODY,
  GROWTH_PARTNER_LOGIN_MOCK_TITLE,
  GROWTH_PARTNER_LOGIN_SESSION_TITLE,
  GROWTH_PARTNER_LOGIN_TITLE,
  GROWTH_PARTNER_LOGIN_PENDING_BODY,
  GROWTH_PARTNER_LOGIN_PENDING_TITLE,
  GROWTH_PARTNER_ADMIN_QUEUE_EMPTY,
  GROWTH_PARTNER_LOGIN_UNAUTHORIZED_BODY,
  GROWTH_PARTNER_LOGIN_UNAUTHORIZED_TITLE,
  GrowthPartnerLogin,
  GrowthPartnerLoginFailure,
  GrowthPartnerLoginForm,
  GrowthPartnerLoginInactive,
  GrowthPartnerLoginMockNotice,
  GrowthPartnerLoginPendingReview,
  GrowthPartnerLoginUnauthorized,
  GrowthPartnerLoginVerifying,
  GrowthPartnerAdminReviewPanel,
} from '../src/components/GrowthPartnerLogin';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);

// ---------------------------------------------------------------------------
// Injectable Supabase Auth fakes (same shape the real client satisfies).
// ---------------------------------------------------------------------------

function clientWith(overrides: Partial<GrowthPartnerAuthClient['auth']>): GrowthPartnerAuthClient {
  return {
    auth: {
      signInWithPassword: overrides.signInWithPassword ?? (async () => ({ data: {}, error: null })),
      signOut: overrides.signOut ?? (async () => ({ error: null })),
      getSession: overrides.getSession ?? (async () => ({ data: { session: null }, error: null })),
    },
  };
}

const sessionOf = (id: string, email: string) => ({
  data: {
    session: {
      user: { id, email },
      access_token: 'jwt',
    },
  },
  error: null,
});

const loginClientFor = (id: string, email: string): GrowthPartnerAuthClient =>
  clientWith({ signInWithPassword: async () => sessionOf(id, email) });

/** A client that ALREADY holds a persisted session (refresh path). */
const sessionClientFor = (id: string, email: string): GrowthPartnerAuthClient =>
  clientWith({ getSession: async () => sessionOf(id, email) });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

test('the growth partner login route lives inside the partner namespace', () => {
  assert.equal(GROWTH_PARTNER_LOGIN_PATH, '/growth-partner/login');
  assert.equal(growthPartnerLoginPath(), '/growth-partner/login');
  assert.equal(isGrowthPartnerLoginPath('/growth-partner/login'), true);
  assert.equal(isGrowthPartnerLoginPath('/growth-partner/login/'), true);
  assert.equal(isGrowthPartnerLoginPath('/GROWTH-PARTNER/LOGIN'), true);
  assert.equal(isGrowthPartnerLoginPath('/growth-partner'), false);
  assert.equal(isGrowthPartnerLoginPath('/growth-partner/dashboard'), false);
  // The login route is still part of the partner area namespace.
  assert.equal(isGrowthPartnerPath('/growth-partner/login'), true);
});

// ---------------------------------------------------------------------------
// Pure resolvers
// ---------------------------------------------------------------------------

const ROW_ACTIVE = {
  user_id: PARTNER_A,
  referral_code: CODE_A,
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};
const ROW_INACTIVE = { ...ROW_ACTIVE, user_id: PARTNER_B, referral_code: CODE_B, is_active: false };

const login = (patch: Record<string, any> = {}) =>
  resolveGrowthPartnerLogin({
    loading: false,
    isMockMode: false,
    userId: PARTNER_A,
    partnerRow: ROW_ACTIVE,
    loadError: null,
    ...patch,
  });

test('the login resolver maps (session, backend role) to exactly one state', () => {
  assert.equal(login({ isMockMode: true }), 'mock-mode');
  assert.equal(login({ loading: true }), 'loading');
  // 3. Unauthenticated → signed-out (login form), never the partner area.
  assert.equal(login({ userId: null }), 'signed-out');
  assert.equal(login({ userId: '' }), 'signed-out');
  // 4. Normal user (zero partner rows from RLS) → unauthorized.
  assert.equal(login({ partnerRow: null }), 'unauthorized');
  // A submitted-but-unapproved application is its own state, never a grant.
  assert.equal(login({ partnerRow: null, applicationStatus: 'pending' }), 'pending-review');
  // A decided application that produced no partner row is still unauthorized.
  assert.equal(login({ partnerRow: null, applicationStatus: 'approved' }), 'unauthorized');
  assert.equal(login({ partnerRow: null, applicationStatus: 'rejected' }), 'unauthorized');
  // An active partner row wins over any application status.
  assert.equal(login({ applicationStatus: 'pending' }), 'granted');
  // 5. Inactive partner → denied (not granted).
  assert.equal(login({ partnerRow: ROW_INACTIVE }), 'inactive');
  // 1. Active partner → granted.
  assert.equal(login(), 'granted');
  // Session expiry is distinguished from generic failures.
  assert.equal(login({ loadError: new Error('JWT expired') }), 'session-expired');
  assert.equal(login({ loadError: { status: 401 } }), 'session-expired');
  assert.equal(login({ loadError: new Error('fetch failed') }), 'error');
});

test('the area gate and the login resolver agree on inactive-partner denial', () => {
  const areaGate = resolveGrowthPartnerGate({
    userId: PARTNER_B,
    loading: false,
    isMockMode: false,
    partnerRow: ROW_INACTIVE,
    loadError: null,
  });
  assert.equal(areaGate, 'inactive');
  assert.notEqual(areaGate, 'ready');
  assert.equal(login({ userId: PARTNER_B, partnerRow: ROW_INACTIVE }), 'inactive');
});

test('only the unauthenticated state redirects the area to the login route (no loop)', () => {
  assert.equal(shouldRedirectToGrowthPartnerLogin('unauthenticated', '/growth-partner'), true);
  assert.equal(shouldRedirectToGrowthPartnerLogin('unauthenticated', '/growth-partner/login'), false);
  assert.equal(shouldRedirectToGrowthPartnerLogin('ready', '/growth-partner'), false);
  assert.equal(shouldRedirectToGrowthPartnerLogin('unauthorized', '/growth-partner'), false);
  assert.equal(shouldRedirectToGrowthPartnerLogin('inactive', '/growth-partner'), false);
  assert.equal(shouldRedirectToGrowthPartnerLogin('loading', '/growth-partner'), false);
});

// ---------------------------------------------------------------------------
// Auth wrappers (Supabase Auth through injectable fakes)
// ---------------------------------------------------------------------------

test('1. a valid Growth Partner login succeeds and yields the signed-in viewer', async () => {
  const viewer = await signInGrowthPartner(loginClientFor(PARTNER_A, 'anita@example.com'), {
    email: '  anita@example.com ',
    password: 'correct-horse-battery',
  });
  // isAdmin is part of the viewer contract: false for a normal partner, so the
  // sign-in and session-restore paths return the same shape.
  assert.deepEqual(viewer, { id: PARTNER_A, email: 'anita@example.com', isAdmin: false });
});

test('2. a wrong password is rejected with safe copy', async () => {
  const bad = clientWith({
    signInWithPassword: async () => ({ data: {}, error: { message: 'Invalid login credentials' } }),
  });
  await assert.rejects(
    signInGrowthPartner(bad, { email: 'anita@example.com', password: 'wrong' }),
    /Invalid email or password\. Please try again\./
  );
  // The safe mapper pins every auth failure shape to user-facing copy.
  assert.equal(
    toGrowthPartnerLoginError({ message: 'Invalid login credentials' }).message,
    'Invalid email or password. Please try again.'
  );
  assert.equal(toGrowthPartnerLoginError({ message: 'Email not confirmed' }).message, 'Please verify your email, then log in.');
  assert.equal(toGrowthPartnerLoginError({ message: 'Request rate limit reached' }).message, 'Too many attempts. Please wait a moment and try again.');
  assert.equal(toGrowthPartnerLoginError({ message: 'fetch failed' }).message, 'Network error. Check your connection and try again.');
  assert.equal(toGrowthPartnerLoginError({ message: 'anything else' }).message, 'Login failed. Please try again.');
});

test('6. a persisted session is restored on refresh and keeps the viewer signed in', async () => {
  const restored = await loadGrowthPartnerSession(sessionClientFor(PARTNER_A, 'anita@example.com'));
  // isAdmin is part of the viewer now: false unless the auth provider marks the
  // account as an admin (it only unlocks the local review queue).
  assert.deepEqual(restored, { id: PARTNER_A, email: 'anita@example.com', isAdmin: false });

  const adminSession: GrowthPartnerAuthClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({
        data: {
          session: {
            user: { id: PARTNER_A, email: 'admin@example.com', app_metadata: { is_admin: true } },
            access_token: 'jwt',
          },
        },
        error: null,
      }),
    },
  };
  assert.deepEqual(await loadGrowthPartnerSession(adminSession), {
    id: PARTNER_A,
    email: 'admin@example.com',
    isAdmin: true,
  });
  // No session → signed out.
  const none = await loadGrowthPartnerSession(clientWith({}));
  assert.equal(none, null);
});

test('7. logout removes the session, so the partner area becomes inaccessible', async () => {
  let signedOut = false;
  const client = clientWith({
    signOut: async () => {
      signedOut = true;
      return { error: null };
    },
    getSession: async () => ({ data: { session: null }, error: null }),
  });
  await signOutGrowthPartner(client);
  assert.equal(signedOut, true);
  assert.equal(await loadGrowthPartnerSession(client), null);
  // After logout the resolver lands on the signed-out (login) state.
  assert.equal(
    resolveGrowthPartnerLogin({
      loading: false,
      isMockMode: false,
      userId: null,
      partnerRow: null,
      loadError: null,
    }),
    'signed-out'
  );
});

// ---------------------------------------------------------------------------
// Backend contract (PGlite) — the DB decides, never the frontend
// ---------------------------------------------------------------------------

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
  `);
  await db.exec(MIGRATION);
  return db;
}

async function provision(db: any, userId: string, code: string, active: boolean) {
  return (
    await db.query('select public.provision_growth_partner($1::uuid, $2, $3) as result', [
      userId,
      code,
      active,
    ])
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

test('1. the backend grants an ACTIVE Growth Partner and denies everyone else', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A, true);
    await provision(db, PARTNER_B, CODE_B, false);

    // Active partner: own row, is_active=true → granted (and area-ready).
    const activeRow = await uiPartnerRow(db, PARTNER_A);
    assert.equal(activeRow.length, 1);
    assert.equal(activeRow[0].is_active, true);
    assert.equal(
      resolveGrowthPartnerLogin({
        loading: false,
        isMockMode: false,
        userId: PARTNER_A,
        partnerRow: activeRow[0],
        loadError: null,
      }),
      'granted'
    );
    assert.equal(
      resolveGrowthPartnerGate({
        userId: PARTNER_A,
        loading: false,
        isMockMode: false,
        partnerRow: activeRow[0],
        loadError: null,
      }),
      'ready'
    );

    // 4. Normal user: zero rows (RLS) → unauthorized, never granted.
    assert.equal((await uiPartnerRow(db, USER_1)).length, 0);
    assert.equal(
      resolveGrowthPartnerLogin({
        loading: false,
        isMockMode: false,
        userId: USER_1,
        partnerRow: null,
        loadError: null,
      }),
      'unauthorized'
    );

    // 5. Inactive partner: own row exists but is_active=false → denied.
    const inactiveRow = await uiPartnerRow(db, PARTNER_B);
    assert.equal(inactiveRow.length, 1);
    assert.equal(inactiveRow[0].is_active, false);
    assert.equal(
      resolveGrowthPartnerLogin({
        loading: false,
        isMockMode: false,
        userId: PARTNER_B,
        partnerRow: inactiveRow[0],
        loadError: null,
      }),
      'inactive'
    );
    // The account and its data are untouched — the row still exists.
    assert.equal(inactiveRow[0].referral_code, CODE_B);
  } finally {
    await db.close();
  }
});

test('8. authorization is decided ONLY by the backend row — nothing the frontend can set', async () => {
  const db = await setupDb();
  try {
    await provision(db, PARTNER_A, CODE_A, true);
    // A normal user has no partner row; there is no frontend input (role,
    // localStorage, URL, React state) that the resolver even accepts — the
    // only decision input is the backend row for that session's user id.
    const viewer: GrowthPartnerViewer = { id: USER_1, email: 'user@example.com' };
    const rows = await uiPartnerRow(db, viewer.id);
    assert.equal(rows.length, 0);
    assert.equal(
      resolveGrowthPartnerLogin({
        loading: false,
        isMockMode: false,
        userId: viewer.id,
        partnerRow: rows[0] ?? null,
        loadError: null,
      }),
      'unauthorized'
    );
    // The resolver has no role/query/localStorage parameters to fake.
    const src = readFileSync(new URL('../src/lib/growthPartnerLogin.ts', import.meta.url), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.doesNotMatch(codeOnly, /localStorage|URLSearchParams|searchParams|location\.search/i);
    assert.doesNotMatch(codeOnly, /user_metadata|\.role\b|role\s*===/i);
    assert.match(codeOnly, /fetchMyGrowthPartnerRow/);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Rendered states (react-dom/server, like the existing page tests)
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

test('3. an unauthenticated visitor sees the email/password login form, never partner data', () => {
  const html = render(
    React.createElement(GrowthPartnerLogin, {
      user: null,
      client: clientWith({}),
      navigate: () => {},
      onBack: () => {},
    })
  );
  assert.match(html, new RegExp(GROWTH_PARTNER_LOGIN_TITLE));
  assert.match(html, /growth-partner-login-email/);
  assert.match(html, /growth-partner-login-password/);
  assert.match(html, /type="password"/);
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /Your referral code/);
  assert.doesNotMatch(html, /ALPHA01/);
});

test('the login form renders its fields and submit button (reused gateway atoms)', () => {
  const html = render(
    React.createElement(GrowthPartnerLoginForm, {
      email: '',
      password: '',
      fieldErrors: {},
      formError: '',
      busy: false,
      onEmailChange: () => {},
      onPasswordChange: () => {},
      onSubmit: () => {},
    })
  );
  assert.match(html, /label[^>]*>Email</);
  assert.match(html, /label[^>]*>Password</);
  assert.match(html, /<input[^>]*type="email"/);
  assert.match(html, /<input[^>]*type="password"/);
  assert.match(html, /Sign in/);
});

test('the verifying state renders a status, not data', () => {
  const html = render(React.createElement(GrowthPartnerLoginVerifying, {}));
  assert.match(html, /role="status"/);
  assert.match(html, /Checking your Growth Partner access/);
});

test('4. a normal user gets the unauthorized state on the login route, never partner data', () => {
  const html = render(
    React.createElement(GrowthPartnerLoginUnauthorized, { onBack: () => {}, onSwitchAccount: () => {} })
  );
  assert.match(html, new RegExp(GROWTH_PARTNER_LOGIN_UNAUTHORIZED_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_LOGIN_UNAUTHORIZED_BODY));
  assert.match(html, /Sign in with a different account/);
  assert.doesNotMatch(html, /Your referral code/);
  assert.doesNotMatch(html, /ALPHA01/);
});

test('5. an inactive partner is denied with the shared paused copy, never partner data', () => {
  const html = render(React.createElement(GrowthPartnerLoginInactive, { onBack: () => {} }));
  assert.match(html, new RegExp(GROWTH_PARTNER_INACTIVE_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_INACTIVE_BODY));
  assert.match(html, /safe/);
  assert.doesNotMatch(html, /Your referral code/);
  assert.doesNotMatch(html, /ALPHA01/);
});

test('failure and mock states render actionable copy, never a blank screen', () => {
  const expired = render(
    React.createElement(GrowthPartnerLoginFailure, {
      title: GROWTH_PARTNER_LOGIN_SESSION_TITLE,
      body: 'Please sign in again to continue.',
      actionLabel: 'Sign in again',
      onAction: () => {},
    })
  );
  assert.match(expired, new RegExp(GROWTH_PARTNER_LOGIN_SESSION_TITLE));
  assert.match(expired, /Sign in again/);

  const error = render(
    React.createElement(GrowthPartnerLoginFailure, {
      title: GROWTH_PARTNER_LOGIN_ERROR_TITLE,
      body: 'Please try again.',
      actionLabel: 'Retry',
      onAction: () => {},
    })
  );
  assert.match(error, new RegExp(GROWTH_PARTNER_LOGIN_ERROR_TITLE));
  assert.match(error, /Retry/);

  const mock = render(React.createElement(GrowthPartnerLoginMockNotice, { onBack: () => {} }));
  assert.match(mock, new RegExp(GROWTH_PARTNER_LOGIN_MOCK_TITLE));
  assert.match(mock, new RegExp(GROWTH_PARTNER_LOGIN_MOCK_BODY));
});

// ---------------------------------------------------------------------------
// Static guarantees: no second auth system, no frontend role trust, no secrets
// ---------------------------------------------------------------------------

test('the growth partner login frontend never touches the service role or frontend role storage', () => {
  for (const file of [
    '../src/lib/growthPartnerLogin.ts',
    '../src/components/GrowthPartnerLogin.tsx',
  ]) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE|getSupabaseAdmin|supabaseAdmin/);
    assert.doesNotMatch(codeOnly, /localStorage|URLSearchParams|searchParams|location\.search/i);
    assert.doesNotMatch(codeOnly, /user_metadata|\.role\b|role\s*===/i);
  }
  // The only authorization primitive imported is the backend role fetch.
  const loginSrc = readFileSync(new URL('../src/lib/growthPartnerLogin.ts', import.meta.url), 'utf8');
  assert.match(loginSrc, /from '\.\/growthPartner'/);
  assert.match(loginSrc, /signInWithPassword/);
  const componentSrc = readFileSync(
    new URL('../src/components/GrowthPartnerLogin.tsx', import.meta.url),
    'utf8'
  );
  assert.match(componentSrc, /fetchMyGrowthPartnerRow/);
});

// ---------------------------------------------------------------------------
// Pending-review screen + the admin review queue (rendered states)
// ---------------------------------------------------------------------------

test('a submitted application renders "under review", never partner data or the form', () => {
  const html = render(
    React.createElement(GrowthPartnerLoginPendingReview, {
      submittedAt: '2026-09-12T04:29:32.256+00:00',
      onBack: () => {},
      onCheckAgain: () => {},
      onSwitchAccount: () => {},
    })
  );
  assert.match(html, new RegExp(GROWTH_PARTNER_LOGIN_PENDING_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_LOGIN_PENDING_BODY));
  assert.match(html, /Check again/);
  assert.match(html, /Submitted /);
  // Not the login form, not the partner area, not an access grant.
  assert.doesNotMatch(html, /growth-partner-login-password/);
  assert.doesNotMatch(html, /Your referral code/);
  assert.doesNotMatch(html, /ALPHA01/);
});

test('the pending screen survives an unparsable submitted date (no crash, no fake date)', () => {
  const html = render(
    React.createElement(GrowthPartnerLoginPendingReview, { submittedAt: 'not-a-date', onBack: () => {} })
  );
  assert.match(html, new RegExp(GROWTH_PARTNER_LOGIN_PENDING_TITLE));
  assert.doesNotMatch(html, /Submitted /);
});

const QUEUE_ROW = {
  id: 'c0000000-0000-4000-8000-000000000001',
  user_id: USER_1,
  applicant_name: 'Asha Sharma',
  applicant_email: 'asha@example.com',
  applicant_phone: '9876543210',
  status: 'pending' as const,
  kyc_status: 'submitted',
  kyc_document_type: 'pan',
  kyc_document_reference: 'ABCDE1234F',
  review_note: null,
  created_at: '2026-09-12T04:29:32.256+00:00',
  reviewed_at: null,
};

test('the admin queue lists applicants with the KYC reference and approve/reject actions', () => {
  const html = render(
    React.createElement(GrowthPartnerAdminReviewPanel, {
      rows: [QUEUE_ROW],
      busyId: null,
      error: '',
      onRefresh: () => {},
      onDecide: () => {},
    })
  );
  assert.match(html, /Asha Sharma/);
  assert.match(html, /asha@example\.com/);
  assert.match(html, /ABCDE1234F/);
  assert.match(html, /Approve/);
  assert.match(html, /Reject/);
  assert.match(html, /aria-label="Refresh application queue"/);
  assert.doesNotMatch(html, new RegExp(GROWTH_PARTNER_ADMIN_QUEUE_EMPTY));
});

test('the admin queue says so when nothing is waiting, and surfaces failures', () => {
  const empty = render(
    React.createElement(GrowthPartnerAdminReviewPanel, { rows: [], onRefresh: () => {}, onDecide: () => {} })
  );
  assert.match(empty, new RegExp(GROWTH_PARTNER_ADMIN_QUEUE_EMPTY));

  const failed = render(
    React.createElement(GrowthPartnerAdminReviewPanel, {
      rows: [],
      error: 'permission denied for function list_growth_partner_applications',
      onRefresh: () => {},
      onDecide: () => {},
    })
  );
  assert.match(failed, /permission denied for function/);
});
