import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadViewer,
  signInWithEmail,
  signOutViewer,
  type OnboardingSupabaseClient,
} from '../src/onboarding/lib/auth';
import { OnboardingError, toSafeAuthError } from '../src/onboarding/lib/flow';
import { observeAuthSession } from '../src/lib/restoreAuthSession';

// ============================================================================
// PHASE 3 — LOGIN
//
// The checklist, each item exercised rather than asserted from reading:
//   email/password login · session creation · session refresh ·
//   getSession/getUser behaviour · wrong password · invalid credentials ·
//   unverified email · expired token · network error · rate limit · logout ·
//   login again
//
// Plus the invariant the phase exists for: **logging in must never reprovision
// an existing account as a fresh one.** Login is a read-only operation; it
// creates no user, no profile row and no organization/membership/salon.
// ============================================================================

const OK_SESSION = {
  access_token: 'access.jwt.sig',
  refresh_token: 'refresh-token-1',
  expires_in: 3600,
  user: { id: 'u-1', email: 'owner@example.com' },
};

/** A client that records every call it receives. */
function makeClient(overrides: Record<string, any> = {}) {
  const calls: Array<{ kind: string; args?: any }> = [];
  const client: any = {
    calls,
    auth: {
      signUp: async (args: any) => {
        calls.push({ kind: 'signUp', args });
        return overrides.signUp?.(args) ?? { data: { user: OK_SESSION.user, session: OK_SESSION }, error: null };
      },
      signInWithPassword: async (args: any) => {
        calls.push({ kind: 'signInWithPassword', args });
        return overrides.signIn?.(args) ?? { data: { user: OK_SESSION.user, session: OK_SESSION }, error: null };
      },
      signOut: async () => {
        calls.push({ kind: 'signOut' });
        return overrides.signOut?.() ?? { error: null };
      },
      getSession: async () => {
        calls.push({ kind: 'getSession' });
        return overrides.getSession?.() ?? { data: { session: OK_SESSION }, error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async (fn: string, args?: any) => {
      calls.push({ kind: 'rpc', args: { fn, ...(args || {}) } });
      return overrides.rpc?.(fn, args) ?? { data: null, error: null };
    },
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['insert', 'upsert', 'update', 'delete']) {
        builder[op] = (row: any) => {
          calls.push({ kind: `table:${table}:${op}`, args: row });
          return { select: async () => ({ data: null, error: null }), then: (f: any) => f({ data: null, error: null }) };
        };
      }
      builder.select = () => {
        calls.push({ kind: `table:${table}:select` });
        const q: any = {};
        q.eq = () => q;
        q.maybeSingle = async () => ({ data: null, error: null });
        q.single = async () => ({ data: null, error: null });
        return q;
      };
      return builder;
    },
  };
  return client as OnboardingSupabaseClient & { calls: Array<{ kind: string; args?: any }> };
}

const CREDENTIALS = { email: 'owner@example.com', password: 'Secret123!' };

// ---------------------------------------------------------------------------
// 1. email/password login + session creation
// ---------------------------------------------------------------------------

test('email + password login returns the viewer and reaches Supabase Auth only', async () => {
  const client = makeClient();
  const { viewer } = await signInWithEmail(client, CREDENTIALS);
  assert.deepEqual(viewer, { id: 'u-1', email: 'owner@example.com' });
  assert.deepEqual(
    client.calls.map((call) => call.kind),
    ['signInWithPassword'],
    'login must be exactly one auth call — no rpc, no table write'
  );
  assert.deepEqual(client.calls[0].args, { email: 'owner@example.com', password: 'Secret123!' });
});

test('a login response carrying a user but no session is refused', async () => {
  // GoTrue's shape when confirmation is required — a user object alone is not
  // a login, and treating it as one would show an owner a dashboard they
  // cannot actually read.
  const client = makeClient({
    signIn: async () => ({ data: { user: OK_SESSION.user, session: null }, error: null }),
  });
  await assert.rejects(signInWithEmail(client, CREDENTIALS), (error: any) => {
    assert.equal(error.code, 'unknown');
    assert.match(error.message, /Login failed/);
    return true;
  });
});

test('input is validated before any request is sent', async () => {
  const client = makeClient();
  await assert.rejects(signInWithEmail(client, { email: 'not-an-email', password: 'x' }));
  await assert.rejects(signInWithEmail(client, { email: 'owner@example.com', password: '' }));
  assert.equal(client.calls.length, 0, 'an invalid form must not reach the network');
});

// ---------------------------------------------------------------------------
// 2. getSession / getUser behaviour (refresh + restore)
// ---------------------------------------------------------------------------

test('loadViewer restores a persisted session', async () => {
  const client = makeClient();
  assert.deepEqual(await loadViewer(client), { id: 'u-1', email: 'owner@example.com' });
});

test('loadViewer resolves null when signed out, and throws when the read fails', async () => {
  const signedOut = makeClient({ getSession: async () => ({ data: { session: null }, error: null }) });
  assert.equal(await loadViewer(signedOut), null, 'signed out is a normal state, not an error');

  const broken = makeClient({
    getSession: async () => ({ data: null, error: { message: 'Invalid Refresh Token' } }),
  });
  await assert.rejects(loadViewer(broken), (error: any) => {
    assert.equal(error.code, 'session', 'a dead refresh token is a session problem, not a login failure');
    assert.match(error.message, /session expired/i);
    return true;
  });
});

test('the restore observer publishes refresh events and never logs the owner out on a late read', async () => {
  const events: Array<{ user: any; status: string; error?: string }> = [];
  let emit: (event: string, session: any) => void = () => {};
  let getSessionImpl: () => Promise<any> = async () => ({ data: { session: OK_SESSION }, error: null });
  const auth = {
    onAuthStateChange: (cb: any) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getSession: () => getSessionImpl(),
  };

  const observer = observeAuthSession(auth, (state) => events.push(state));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(events.at(-1)?.status, 'ready');
  assert.equal(events.at(-1)?.user?.id, 'u-1');

  // Session refresh: TOKEN_REFRESHED carries a session and must republish it.
  const refreshed = { ...OK_SESSION, access_token: 'access.jwt.sig.2' };
  emit('TOKEN_REFRESHED', refreshed);
  assert.equal(events.at(-1)?.status, 'ready');
  assert.equal(events.at(-1)?.user?.id, 'u-1');

  // Sign out clears the user.
  emit('SIGNED_OUT', null);
  assert.equal(events.at(-1)?.user, null);
  assert.equal(events.at(-1)?.status, 'ready');

  // A slow startup read that fails must NOT wipe a session a newer event
  // already published (the revision guard).
  let resolveLate: (value: any) => void = () => {};
  getSessionImpl = () => new Promise((resolve) => { resolveLate = resolve; });
  void observer.retry();
  emit('SIGNED_IN', OK_SESSION);                       // newer event wins
  assert.equal(events.at(-1)?.user?.id, 'u-1');
  resolveLate({ data: null, error: { message: 'Invalid Refresh Token' } });  // stale read lands
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(events.at(-1)?.user?.id, 'u-1', 'a stale failed read must not log the owner out');

  observer.dispose();
  const countAfterDispose = events.length;
  emit('SIGNED_IN', OK_SESSION);
  assert.equal(events.length, countAfterDispose, 'dispose unsubscribes');
});

// ---------------------------------------------------------------------------
// 3. Failure modes — the exact GoTrue wording, mapped to safe copy
// ---------------------------------------------------------------------------

const CASES: Array<[string, string, RegExp]> = [
  ['wrong password', 'Invalid login credentials', /Invalid email or password/],
  ['invalid credentials', 'invalid email or password', /Invalid email or password/],
  ['unverified email', 'Email not confirmed', /verify your email/i],
  ['unverified email (code form)', 'email_not_confirmed', /verify your email/i],
  ['expired token', 'Invalid Refresh Token', /session expired/i],
  ['expired token (getUser)', 'Sign in required', /session expired/i],
  ['expired token (jwt)', 'JWT expired', /session expired/i],
  ['expired token (code)', 'refresh_token_not_found', /session expired/i],
  ['network error', 'Failed to fetch', /Network error/],
  ['rate limit', 'For security purposes, you can only request this after 60 seconds.', /Too many attempts/],
  ['rate limit (short)', 'over request rate limit', /Too many attempts/],
  ['existing account', 'User already registered', /already exists/i],
  ['banned', 'User is banned', /suspended/i],
];

test('every login failure maps to safe, actionable copy', () => {
  for (const [name, raw, expected] of CASES) {
    const mapped = toSafeAuthError(new Error(raw), 'login');
    assert.match(mapped.message, expected, `${name}: "${raw}" -> "${mapped.message}"`);
    assert.ok(mapped instanceof OnboardingError);
  }
});

test('the expired-token class is distinct from wrong-password', () => {
  // The point of the fix: an owner whose tab sat overnight was previously told
  // "Login failed. Please try again." and sent back to a form that would fail
  // identically. They are now told to sign in again.
  assert.equal(toSafeAuthError(new Error('Invalid Refresh Token'), 'login').code, 'session');
  assert.equal(toSafeAuthError(new Error('Invalid login credentials'), 'login').code, 'invalid-credentials');
  assert.notEqual(
    toSafeAuthError(new Error('Invalid Refresh Token'), 'login').message,
    toSafeAuthError(new Error('Invalid login credentials'), 'login').message
  );
});

test('signInWithEmail surfaces the mapped error, not GoTrue text', async () => {
  for (const [name, raw] of [['wrong password', 'Invalid login credentials'], ['unverified', 'Email not confirmed']]) {
    const client = makeClient({ signIn: async () => ({ data: null, error: { message: raw } }) });
    await assert.rejects(signInWithEmail(client, CREDENTIALS), (error: any) => {
      assert.doesNotMatch(error.message, new RegExp(raw, 'i'), `${name}: raw GoTrue text leaked`);
      return true;
    });
  }
});

test('internal database text is never shown to the owner', async () => {
  const secret = 'column "auth"."refresh_tokens" does not exist (42P01)';
  const client = makeClient({ signIn: async () => ({ data: null, error: { message: secret } }) });
  await assert.rejects(signInWithEmail(client, CREDENTIALS), (error: any) => {
    assert.doesNotMatch(error.message, /column|42P01|refresh_tokens/);
    assert.match(error.message, /Login failed/);
    return true;
  });
});

test('a network failure during login is reported as a network error and can be retried', async () => {
  let attempt = 0;
  const client = makeClient({
    signIn: async () => {
      attempt += 1;
      if (attempt === 1) return { data: null, error: { message: 'Failed to fetch' } };
      return { data: { user: OK_SESSION.user, session: OK_SESSION }, error: null };
    },
  });
  await assert.rejects(signInWithEmail(client, CREDENTIALS), (error: any) => {
    assert.equal(error.code, 'network');
    return true;
  });
  // Retrying the same credentials succeeds — nothing was latched.
  const retried = await signInWithEmail(client, CREDENTIALS);
  assert.equal(retried.viewer.id, 'u-1');
  assert.equal(client.calls.filter((c) => c.kind === 'signInWithPassword').length, 2);
});

// ---------------------------------------------------------------------------
// 4. logout, then login again
// ---------------------------------------------------------------------------

test('logout clears the session and swallows a transport blip', async () => {
  const client = makeClient();
  await signOutViewer(client);
  assert.deepEqual(client.calls.map((c) => c.kind), ['signOut']);

  // A failed signOut request must not trap the owner in the app — the local
  // logout is the goal and the auth event is what clears the UI.
  const flaky = makeClient({
    signOut: async () => {
      throw new Error('Failed to fetch');
    },
  });
  await assert.doesNotReject(signOutViewer(flaky));
});

test('login again after logout restores the same account without reprovisioning', async () => {
  let signedIn = false;
  const client = makeClient({
    signIn: async () => {
      signedIn = true;
      return { data: { user: OK_SESSION.user, session: OK_SESSION }, error: null };
    },
    getSession: async () => ({ data: { session: signedIn ? OK_SESSION : null }, error: null }),
  });

  await signInWithEmail(client, CREDENTIALS);
  signedIn = true;
  assert.deepEqual(await loadViewer(client), { id: 'u-1', email: 'owner@example.com' }, 'signed in');
  await signOutViewer(client);
  signedIn = false;
  assert.equal(await loadViewer(client), null, 'signed out');

  signedIn = true;
  const again = await signInWithEmail(client, CREDENTIALS);
  assert.equal(again.viewer.id, 'u-1', 'the same account comes back');
  assert.deepEqual(await loadViewer(client), { id: 'u-1', email: 'owner@example.com' });

  const kinds = client.calls.map((c) => c.kind);
  assert.deepEqual(
    kinds.filter((k) => k === 'rpc' || k.startsWith('table:')),
    [],
    `login/logout must never write or provision; got ${JSON.stringify(kinds)}`
  );
});

// ---------------------------------------------------------------------------
// 5. THE INVARIANT — no reprovisioning of an existing account on login
// ---------------------------------------------------------------------------

test('signing in provisions nothing: no ensure_owner_workspace, no profile write', async () => {
  const client = makeClient();
  await signInWithEmail(client, CREDENTIALS);
  await loadViewer(client);

  const provisioning = client.calls.filter(
    (call) =>
      call.kind === 'rpc' &&
      ['ensure_owner_workspace', 'save_owner_editor_state', 'complete_template_handoff'].includes(call.args.fn)
  );
  assert.deepEqual(provisioning, [], 'login must not create an organization, membership or salon');

  const writes = client.calls.filter((call) => call.kind.startsWith('table:'));
  assert.deepEqual(writes, [], 'login must not write to profiles or any other table');

  const signUps = client.calls.filter((call) => call.kind === 'signUp');
  assert.deepEqual(signUps, [], 'login must not create an auth user');
});

test('the source contract: login paths never call signUp or ensure_owner_workspace', () => {
  const loginScreen = readFileSync(new URL('../src/onboarding/screens/LoginScreen.tsx', import.meta.url), 'utf8');
  assert.match(loginScreen, /signInWithEmail/, 'the login screen signs in');
  assert.doesNotMatch(loginScreen, /signUpWithEmail|ensure_owner_workspace/, 'and does nothing else');

  const auth = readFileSync(new URL('../src/onboarding/lib/auth.ts', import.meta.url), 'utf8');
  const signIn = auth.slice(auth.indexOf('export async function signInWithEmail'));
  const body = signIn.slice(0, signIn.indexOf('\n}\n') + 2);
  assert.doesNotMatch(body, /signUp|ensure_owner_workspace|\.from\(|rpc\(/,
    'signInWithEmail must touch only client.auth.signInWithPassword');

  // Provisioning has exactly one call site, at the handoff boundary.
  const callSites = ['src/components/TemplateHandoffPage.tsx', 'src/lib/ownerEditorState.ts', 'src/lib/ownerWorkspace.ts']
    .map((path) => [path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')] as const);
  for (const [path, source] of callSites) {
    assert.doesNotMatch(source, /signInWithPassword/, `${path} is not a login path`);
  }
});

test('the main app modal writes nothing without a real session', () => {
  // With confirmation required, GoTrue answers a duplicate-email signUp with
  // the EXISTING user and no session, and does not say whether the address was
  // taken. A user object is therefore not proof of ownership, so the modal
  // must gate its stored-profile and `profiles` writes on `data.session`.
  const modal = readFileSync(new URL('../src/components/AuthModal.tsx', import.meta.url), 'utf8');
  const signup = modal.slice(modal.indexOf("if (mode === 'signup')"));
  const sessionGuard = signup.indexOf('if (!data.session)');
  const storedProfile = signup.indexOf('setStoredAuthenticatedProfile(');
  const upsert = signup.indexOf(".from('profiles')");
  assert.ok(sessionGuard > -1, 'the session guard exists');
  assert.ok(storedProfile > sessionGuard, 'the stored-profile write is after the session guard');
  assert.ok(upsert > sessionGuard, 'the profiles upsert is after the session guard');
  // The guard must return, not fall through.
  const guardBody = signup.slice(sessionGuard, sessionGuard + 260);
  assert.match(guardBody, /return;/);
});

test('the main app modal maps auth errors instead of showing GoTrue text', () => {
  const modal = readFileSync(new URL('../src/components/AuthModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /toSafeAuthError\(/, 'errors are mapped');
  assert.doesNotMatch(
    modal,
    /setError\(err\.message/,
    'raw error text must not be rendered to the customer'
  );
});

test('both login forms are single-flight (a double click sends one request)', () => {
  for (const path of [
    '../src/onboarding/screens/LoginScreen.tsx',
    '../src/onboarding/screens/SignupScreen.tsx',
    '../src/components/AuthModal.tsx',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /createSingleFlight/, `${path} must use the ref-backed single-flight guard`);
    assert.match(source, /useRef\(createSingleFlight\(\)\)/, `${path} must hold it in a ref, not state`);
  }
});
