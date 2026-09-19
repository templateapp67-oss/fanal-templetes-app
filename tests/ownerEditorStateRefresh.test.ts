import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The editor's cloud write must survive a stale session.
 *
 * writeOwnerEditorState() (src/lib/ownerEditorState.ts) now
 *   1. refreshes an expired / about-to-expire token BEFORE the RPC, and
 *   2. when the RPC is still rejected as unauthenticated, refreshes once more
 *      and retries the SAME transaction before reporting a failure.
 *
 * Without this the owner saw "Database permission problem — please sign in
 * again. If it persists, confirm the Supabase schema, RLS policies and
 * grants…" for a session that a silent refresh fixes.
 */

const { saveOwnerEditorState } = await import('../src/lib/ownerEditorState');

const OWNER = '10000000-0000-4000-8000-000000000001';
const now = Date.now();

const PAYLOAD: any = {
  ownerId: OWNER,
  profile: { ownerId: OWNER, businessName: 'Arts By Uma', subdomain: 'arts-by-uma' },
  services: [],
  stylists: [],
  loyaltyConfig: { programEnabled: true, rewards: [] },
};

function jwtExpiredError() {
  return { message: 'JWT expired', code: 'PGRST301', status: 401 };
}

/**
 * Fake Supabase client. `rpcResults` is consumed one per call; the auth API
 * mirrors supabase-js closely enough for the refresh logic.
 */
function fakeClient(options: {
  rpcResults: Array<{ error?: any }>;
  expiresAt?: number;
  refresh?: { token?: string; error?: any };
}) {
  const calls = { rpc: 0, names: [] as string[], getSession: 0, refreshSession: 0 };
  let session: any = {
    access_token: 'stale-token',
    refresh_token: 'refresh-token',
    expires_at: options.expiresAt ?? Math.floor(now / 1000) - 60, // expired by default
    user: { id: OWNER },
  };
  const client: any = {
    auth: {
      async getSession() {
        calls.getSession++;
        return { data: { session }, error: null };
      },
      async refreshSession() {
        calls.refreshSession++;
        if (options.refresh?.error) return { data: { session: null }, error: options.refresh.error };
        session = { ...session, access_token: options.refresh?.token ?? 'fresh-token', expires_at: Math.floor(now / 1000) + 3600 };
        return { data: { session }, error: null };
      },
    },
    async rpc(name: string) {
      calls.rpc++;
      calls.names.push(name);
      const next = options.rpcResults.shift() ?? { error: null };
      return { data: null, error: next.error ?? null };
    },
  };
  return { client, calls };
}

test('a stale token is refreshed before the RPC and the save succeeds first try', async () => {
  const { client, calls } = fakeClient({
    rpcResults: [{ error: null }],
    expiresAt: Math.floor(now / 1000) - 60,
    refresh: { token: 'fresh-token' },
  });

  const result = await saveOwnerEditorState(client, PAYLOAD);

  assert.equal(result.ok, true);
  assert.deepEqual(calls.names, ['save_owner_editor_state']);
  assert.equal(calls.refreshSession, 1, 'the pre-flight must refresh an expired token');
});

test('an auth-rejected RPC is refreshed and retried once, then reported as saved', async () => {
  const { client, calls } = fakeClient({
    rpcResults: [{ error: jwtExpiredError() }, { error: null }],
    expiresAt: Math.floor(now / 1000) + 30, // inside the refresh margin
    refresh: { token: 'fresh-token' },
  });

  const result = await saveOwnerEditorState(client, PAYLOAD);

  assert.equal(result.ok, true);
  assert.deepEqual(calls.names, ['save_owner_editor_state', 'save_owner_editor_state']);
  assert.equal(calls.refreshSession, 2, 'pre-flight + reactive refresh');
});

test('when the refresh fails and the token is dead, the original auth error is surfaced (no false success)', async () => {
  const { client, calls } = fakeClient({
    rpcResults: [{ error: jwtExpiredError() }],
    expiresAt: Math.floor(now / 1000) - 1,
    refresh: { error: new Error('Invalid Refresh Token: Refresh Token Not Found') },
  });

  const result = await saveOwnerEditorState(client, PAYLOAD);

  assert.equal(result.ok, false);
  assert.equal(result.blockedByAuth, true);
  assert.match(result.errors[0], /JWT expired/);
  assert.equal(calls.names.length, 1, 'a failed refresh must not blindly resend the write');
});

test('a deterministic RLS/grant rejection is NOT retried (refreshing cannot fix it)', async () => {
  const { client, calls } = fakeClient({
    rpcResults: [{ error: { message: 'permission denied for table profiles', code: '42501', status: 403 } }],
    expiresAt: Math.floor(now / 1000) + 60 * 60, // session is perfectly valid
  });

  const result = await saveOwnerEditorState(client, PAYLOAD);

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /permission denied for table profiles/);
  assert.equal(result.blockedByAuth, true, 'still classified for the console remediation hint');
  assert.equal(calls.names.length, 1);
  assert.equal(calls.refreshSession, 0);
});

test('a client without an auth API (mock/tests/service-role) still saves normally', async () => {
  const calls: string[] = [];
  const client: any = {
    async rpc(name: string) {
      calls.push(name);
      return { data: null, error: null };
    },
  };

  const result = await saveOwnerEditorState(client, PAYLOAD);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['save_owner_editor_state']);
});

test('the workspace retry still runs for the missing-salon failure after a refresh', async () => {
  const calls: string[] = [];
  let saved = 0;
  const client: any = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 't', expires_at: Math.floor(now / 1000) + 3600, user: { id: OWNER } } }, error: null };
      },
      async refreshSession() {
        return { data: { session: null }, error: new Error('no refresh needed') };
      },
    },
    async rpc(name: string, args?: any) {
      calls.push(name);
      if (name === 'save_owner_editor_state') {
        saved++;
        if (saved === 1) return { data: null, error: { message: 'Select a salon owned by this account', code: '42501' } };
        return { data: null, error: null };
      }
      if (name === 'ensure_owner_workspace') {
        return { data: { salon_id: '20000000-0000-4000-8000-000000000001', salon_count: 1 }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const result = await saveOwnerEditorState(client, PAYLOAD);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['save_owner_editor_state', 'ensure_owner_workspace', 'save_owner_editor_state']);
});
