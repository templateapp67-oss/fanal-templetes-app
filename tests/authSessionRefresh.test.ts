import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Session freshness for cloud saves (src/lib/authSession.ts).
 *
 * The reported editor failure — "Save failed: Database permission problem —
 * please sign in again" — is what a SAVE looks like when the Supabase access
 * token went stale while the tab sat in the background: PostgREST rejects the
 * write with 401/42501 before any RLS policy is even consulted. These tests
 * pin the helper that makes the save path refresh such a session silently.
 */

const {
  SESSION_REFRESH_MARGIN_MS,
  ensureFreshSession,
  refreshSessionForSave,
  isSessionExpiringSoon,
  isSessionExpired,
} = await import('../src/lib/authSession');
const { isSessionExpiryFailure, isAuthLikeFailure, summarizeSaveError, SESSION_EXPIRED_SAVE_MESSAGE } =
  await import('../src/lib/autoSave');

const NOW = Date.now();
const seconds = (ms: number) => Math.floor((NOW + ms) / 1000);

function session(overrides: Record<string, any> = {}) {
  return {
    access_token: 'access-token-old',
    refresh_token: 'refresh-token',
    expires_at: seconds(60 * 60 * 1000), // valid for an hour
    user: { id: '10000000-0000-4000-8000-000000000001' },
    ...overrides,
  };
}

/** Minimal supabase-js-like auth surface, with call counters. */
function fakeAuth(options: {
  session?: any;
  getSessionError?: any;
  refresh?: any;
  refreshError?: any;
  refreshThrows?: any;
}) {
  const calls = { getSession: 0, refreshSession: 0 };
  let current = options.session ?? null;
  const auth = {
    async getSession() {
      calls.getSession++;
      if (options.getSessionError) return { data: { session: null }, error: options.getSessionError };
      return { data: { session: current }, error: null };
    },
    async refreshSession() {
      calls.refreshSession++;
      if (options.refreshThrows) throw options.refreshThrows;
      if (options.refreshError) return { data: { session: null }, error: options.refreshError };
      current = options.refresh ?? null;
      return { data: { session: current }, error: null };
    },
  };
  return { client: { auth }, calls };
}

test('a session that is still fresh is used as-is (no refresh round trip)', async () => {
  const { client, calls } = fakeAuth({ session: session() });
  const result = await ensureFreshSession(client);
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, false);
  assert.equal(result.accessToken, 'access-token-old');
  assert.equal(result.userId, '10000000-0000-4000-8000-000000000001');
  assert.equal(calls.refreshSession, 0);
});

test('a token inside the expiry margin is refreshed BEFORE the write', async () => {
  const soon = session({ expires_at: seconds(SESSION_REFRESH_MARGIN_MS - 5_000) });
  const { client, calls } = fakeAuth({ session: soon, refresh: session({ access_token: 'access-token-fresh' }) });
  const result = await ensureFreshSession(client);
  assert.equal(calls.refreshSession, 1);
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.equal(result.accessToken, 'access-token-fresh');
});

test('an already-expired token is refreshed and the new token returned', async () => {
  const { client } = fakeAuth({
    session: session({ expires_at: seconds(-60_000) }),
    refresh: session({ access_token: 'access-token-fresh' }),
  });
  const result = await ensureFreshSession(client);
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.equal(result.accessToken, 'access-token-fresh');
});

test('a failed refresh keeps a still-valid token instead of blocking the save', async () => {
  // Refresh calls can fail for reasons that do not invalidate the current
  // token (offline blip, cross-tab lock, proxy). The write must still go out.
  const { client } = fakeAuth({
    session: session({ expires_at: seconds(30_000) }),
    refreshError: new Error('Failed to fetch from auth server'),
  });
  const result = await ensureFreshSession(client);
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, false);
  assert.equal(result.accessToken, 'access-token-old');
  assert.match(result.error ?? '', /Failed to fetch/);
});

test('a failed refresh on a genuinely expired token reports a session failure', async () => {
  const { client } = fakeAuth({
    session: session({ expires_at: seconds(-1) }),
    refreshError: new Error('Invalid Refresh Token: Refresh Token Not Found'),
  });
  const result = await ensureFreshSession(client);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
  assert.match(result.error ?? '', /Refresh Token/);
});

test('no session, a missing auth API and a throwing getSession are reported, never thrown', async () => {
  const empty = fakeAuth({ session: null });
  const noSession = await ensureFreshSession(empty.client);
  assert.equal(noSession.ok, false);
  assert.equal(noSession.reason, 'no-session');

  const unavailable = await ensureFreshSession({ rpc: async () => ({}) } as any);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, 'unavailable');

  const throwing = await ensureFreshSession({
    auth: {
      getSession: async () => {
        throw new Error('navigator.locks unavailable');
      },
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
  } as any);
  assert.equal(throwing.ok, false);
  assert.equal(throwing.reason, 'error');
  assert.match(throwing.error ?? '', /navigator\.locks/);
});

test('refreshSessionForSave forces a refresh even when the token looks fresh', async () => {
  const { client, calls } = fakeAuth({ session: session(), refresh: session({ access_token: 'access-token-fresh' }) });
  const result = await refreshSessionForSave(client);
  assert.equal(calls.refreshSession, 1);
  assert.equal(result.refreshed, true);
  assert.equal(result.accessToken, 'access-token-fresh');
});

test('expiry helpers answer from the token metadata', () => {
  assert.equal(isSessionExpiringSoon(session({ expires_at: seconds(1_000) })), true);
  assert.equal(isSessionExpiringSoon(session({ expires_at: seconds(60 * 60 * 1000) })), false);
  assert.equal(isSessionExpiringSoon({ access_token: 'x' }), false); // unknown expiry
  assert.equal(isSessionExpired(session({ expires_at: seconds(-1) })), true);
  assert.equal(isSessionExpired(session({ expires_at: seconds(30_000) })), false);
});

test('session expiry is distinguished from RLS/grant permission errors', () => {
  // Recoverable by refreshing / signing in again:
  for (const message of [
    'save salon profile: JWT expired | code: 403',
    '{"message":"JWT expired","code":"PGRST301"}',
    'Invalid Refresh Token: Refresh Token Not Found',
    'cloud sync skipped (no active session — sign in again to save to the cloud)',
    'Failed to fetch from auth server',
    'POST /api/website/save failed → HTTP 401 Unauthorized',
  ]) {
    assert.equal(isSessionExpiryFailure(message), true, `expected a session failure: ${message}`);
  }
  // Deterministic schema/permission problems — refreshing changes nothing:
  for (const message of [
    'save salon profile: permission denied for table profiles | code: 42501',
    'save stylists: new row violates row-level security policy on "stylists" | code: 42501',
    'save services: relation "public.services" does not exist | code: 42P01',
  ]) {
    assert.equal(isSessionExpiryFailure(message), false, `must NOT be a session failure: ${message}`);
  }
  // The permission/RLS ones stay "auth-like" so the console still prints the
  // grants/RLS remediation hint.
  for (const message of [
    'save salon profile: permission denied for table profiles | code: 42501',
    'save stylists: new row violates row-level security policy on "stylists" | code: 42501',
  ]) {
    assert.equal(isAuthLikeFailure(message), true, `still auth-like for remediation hints: ${message}`);
  }
});

test('the toast copy explains what happened instead of blaming the database', () => {
  const sessionToast = summarizeSaveError('save salon profile: JWT expired | code: 403');
  assert.equal(sessionToast, SESSION_EXPIRED_SAVE_MESSAGE);
  assert.match(sessionToast, /sign in again/i);
  assert.match(sessionToast, /saved on this device/i);

  const grantsToast = summarizeSaveError('save salon profile: permission denied for table profiles | code: 42501');
  assert.match(grantsToast, /permission problem/i);
  assert.match(grantsToast, /20261010_salon_profile_rls_and_grants\.sql/);
});
