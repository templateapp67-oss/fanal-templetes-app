// ============================================================================
// G1 — the customer app had no way back in after a forgotten password.
//
// `src/customer/screens/Auth.tsx` could create an account and sign into one and
// nothing else: no "Forgot password?" link, no reset request, no new-password
// form. A customer who lost their password lost their bookings, rewards and
// pass permanently. That is the #1 gap in CUSTOMER_APP_GAP_AUDIT_VERIFIED.md.
//
// The fix rides Supabase Auth's own recovery flow (the one the partner portal
// and the onboarding app already use): `resetPasswordForEmail` sends a link to
// `/app/auth`, the browser client exchanges the token, PASSWORD_RECOVERY puts
// the screen in `reset` mode, and `updateUser` sets the new password on a
// session that is already real — so the customer is signed in immediately.
//
// These tests pin the parts that must not silently drift:
//   1. the reset link points at the customer auth route, absolutely
//   2. a reset request answers the SAME way whether or not the address has an
//      account — an enumeration oracle here would leak registered emails
//   3. GoTrue's raw provider strings never reach the customer
//   4. the strength + confirmation check matches the sign-up rule (6 chars)
//   5. nothing is sent to Auth when validation fails
//   6. an unconfigured deployment says so in customer words instead of
//      returning a transport error
//
// No migration, no RLS change, no new table: recovery is pure Supabase Auth.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CUSTOMER_AUTH_PATH,
  CUSTOMER_PASSWORD_MIN_LENGTH,
  CUSTOMER_PASSWORD_MISMATCH_MESSAGE,
  CUSTOMER_PASSWORD_WEAK_MESSAGE,
  RESET_SENT_MESSAGE,
  completeCustomerPasswordReset,
  customerPasswordResetRedirectTo,
  describeResetError,
  sendCustomerPasswordReset,
  validateCustomerNewPassword,
  type CustomerAuthClient,
} from '../src/lib/customer/authRecovery';
import { isMockSupabase } from '../src/lib/supabaseClient';

/** Stub Auth client recording every call, the way the flow's contract sees it. */
function stubAuthClient(options?: {
  resetResult?: { data?: any; error?: any };
  updateResult?: { data?: any; error?: any };
  omit?: ('resetPasswordForEmail' | 'updateUser')[];
}) {
  const calls: { method: string; args: any[] }[] = [];
  const auth: Record<string, any> = {
    resetPasswordForEmail: async (...args: any[]) => {
      calls.push({ method: 'resetPasswordForEmail', args });
      return options?.resetResult ?? { data: {}, error: null };
    },
    updateUser: async (...args: any[]) => {
      calls.push({ method: 'updateUser', args });
      return options?.updateResult ?? { data: { user: { id: 'c-1' } }, error: null };
    },
    getSession: async () => ({ data: { session: { user: { id: 'c-1', email: 'a@b.co' } } }, error: null }),
  };
  for (const key of options?.omit ?? []) delete auth[key];
  return { client: { auth } as unknown as CustomerAuthClient, calls };
}

async function rejects(fn: () => Promise<unknown>, message: string): Promise<Error> {
  try {
    await fn();
  } catch (err: any) {
    assert.equal(String(err?.message ?? err), message);
    return err;
  }
  assert.fail(`expected a rejection: ${message}`);
}

// ---------------------------------------------------------------------------
// 1. The link must land on the customer auth route, resolved absolutely
// ---------------------------------------------------------------------------

test('reset link targets the customer auth route, not the marketing site', () => {
  assert.equal(CUSTOMER_AUTH_PATH, '/app/auth');
  // Node has no window, so the originless form is the bare route.
  assert.equal(customerPasswordResetRedirectTo(), '/app/auth');
});

test('reset link is absolute when the deployment origin is known', () => {
  assert.equal(
    customerPasswordResetRedirectTo('https://salon.example.com'),
    'https://salon.example.com/app/auth'
  );
  assert.equal(
    customerPasswordResetRedirectTo('http://localhost:3000'),
    'http://localhost:3000/app/auth'
  );
});

test('redirect target keeps the trailing route even for an odd origin', () => {
  const target = customerPasswordResetRedirectTo('https://a.co');
  assert.ok(target.endsWith(CUSTOMER_AUTH_PATH), `expected ${target} to end with /app/auth`);
});

// ---------------------------------------------------------------------------
// 2. Enumeration safety — one address with an account, one without
// ---------------------------------------------------------------------------

test('a reset request resolves for an address that has an account', async () => {
  const { client, calls } = stubAuthClient();
  await sendCustomerPasswordReset('booked@example.com', client);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'booked@example.com');
});

test('a reset request resolves the same way for an address with no account', async () => {
  // Supabase Auth deliberately answers success for unknown addresses. Either
  // way the caller shows RESET_SENT_MESSAGE, so this form cannot be used to
  // discover which customers are registered.
  const { client, calls } = stubAuthClient({ resetResult: { data: null, error: null } });
  await sendCustomerPasswordReset('nobody@example.com', client);
  assert.equal(calls.length, 1);
});

test('both outcomes leave the caller with one identical message to show', async () => {
  const known = stubAuthClient();
  const unknown = stubAuthClient({ resetResult: { data: null, error: null } });

  const shownFor = async (email: string, client: CustomerAuthClient) => {
    await sendCustomerPasswordReset(email, client);
    return RESET_SENT_MESSAGE;
  };

  const [a, b] = await Promise.all([
    shownFor('booked@example.com', known.client),
    shownFor('nobody@example.com', unknown.client),
  ]);
  assert.equal(a, b);
  assert.match(a, /If an account uses that email/i);
  assert.ok(!/does not exist|not found|no account/i.test(a), 'the copy must not hint at existence');
});

test('the address is trimmed before it reaches Auth', async () => {
  const { client, calls } = stubAuthClient();
  await sendCustomerPasswordReset('  spaced@example.com  ', client);
  assert.equal(calls[0].args[0], 'spaced@example.com');
});

test('the redirect target travels with the request', async () => {
  const { client, calls } = stubAuthClient();
  await sendCustomerPasswordReset('booked@example.com', client);
  const options = calls[0].args[1];
  assert.equal(typeof options?.redirectTo, 'string');
  assert.ok(String(options.redirectTo).endsWith('/app/auth'));
});

test('an invalid address is refused without contacting Auth at all', async () => {
  for (const bad of ['', '   ', 'not-an-email', 'a@b', '@example.com', 'a b@example.com']) {
    const { client, calls } = stubAuthClient();
    await rejects(
      () => sendCustomerPasswordReset(bad, client),
      'Enter a valid email address.'
    );
    assert.equal(calls.length, 0, `Auth must not be called for ${JSON.stringify(bad)}`);
  }
});

test('a provider error becomes safe copy and never echoes the raw string', async () => {
  const { client } = stubAuthClient({
    resetResult: { data: null, error: { message: 'For security reasons, the redirect_to is not allowed' } },
  });
  const err = await rejects(() => sendCustomerPasswordReset('booked@example.com', client), describeResetError(
    'For security reasons, the redirect_to is not allowed'
  ));
  assert.ok(!/redirect_to/i.test(err.message), 'provider internals must not reach the customer');
});

test('a client without resetPasswordForEmail says recovery is unavailable', async () => {
  const { client, calls } = stubAuthClient({ omit: ['resetPasswordForEmail'] });
  await rejects(
    () => sendCustomerPasswordReset('booked@example.com', client),
    'Password reset is unavailable right now. Please try again later.'
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 3. Provider strings are translated once, in one place
// ---------------------------------------------------------------------------

test('describeResetError maps the GoTrue strings a customer cannot act on', () => {
  assert.equal(
    describeResetError('Auth rate limit exceeded'),
    'Too many attempts just now. Wait a minute and try again.'
  );
  assert.equal(describeResetError('too_many_requests'), 'Too many attempts just now. Wait a minute and try again.');
  assert.equal(describeResetError('Invalid email address'), 'Enter a valid email address.');
  assert.equal(
    describeResetError('session not found'),
    'That reset link has expired. Request a new one and try again.'
  );
  assert.equal(
    describeResetError('Refresh token not found'),
    'That reset link has expired. Request a new one and try again.'
  );
  assert.equal(describeResetError('Password is too weak'), CUSTOMER_PASSWORD_WEAK_MESSAGE);
  assert.equal(
    describeResetError('redirect_to is not allowed'),
    'Password reset is not configured for this deployment. Contact the salon.'
  );
});

test('describeResetError falls back to generic copy for anything unrecognised', () => {
  assert.equal(describeResetError('Something exploded upstream (HTTP 502)'), 'We could not complete that. Please try again.');
  assert.equal(describeResetError(''), 'We could not complete that. Please try again.');
  assert.equal(describeResetError(null), 'We could not complete that. Please try again.');
  assert.equal(describeResetError(undefined), 'We could not complete that. Please try again.');
  assert.equal(describeResetError({ code: 'PGRST116' }), 'We could not complete that. Please try again.');
});

// ---------------------------------------------------------------------------
// 4. Strength + confirmation, matching the sign-up rule on the same screen
// ---------------------------------------------------------------------------

test('the minimum length is the sign-up rule, so the two forms never disagree', () => {
  assert.equal(CUSTOMER_PASSWORD_MIN_LENGTH, 6);
  assert.equal(CUSTOMER_PASSWORD_WEAK_MESSAGE, 'Use at least 6 characters for your password.');
});

test('validateCustomerNewPassword accepts exactly 6 characters', () => {
  assert.deepEqual(validateCustomerNewPassword('Abc12!', 'Abc12!'), { ok: true });
});

test('validateCustomerNewPassword rejects fewer than 6 characters', () => {
  assert.deepEqual(validateCustomerNewPassword('Ab1!', 'Ab1!'), {
    ok: false,
    message: CUSTOMER_PASSWORD_WEAK_MESSAGE,
  });
});

test('validateCustomerNewPassword checks length before confirmation', () => {
  // A short password that also mismatches reports the length rule first, so the
  // customer fixes one thing at a time.
  assert.deepEqual(validateCustomerNewPassword('Ab1!', 'different'), {
    ok: false,
    message: CUSTOMER_PASSWORD_WEAK_MESSAGE,
  });
});

test('validateCustomerNewPassword rejects a mismatched confirmation', () => {
  assert.deepEqual(validateCustomerNewPassword('Secret123', 'Secret124'), {
    ok: false,
    message: CUSTOMER_PASSWORD_MISMATCH_MESSAGE,
  });
});

test('validateCustomerNewPassword treats missing and empty values as too short', () => {
  assert.equal(validateCustomerNewPassword(undefined, undefined).ok, false);
  assert.equal(validateCustomerNewPassword('', '').ok, false);
  assert.equal(validateCustomerNewPassword(null, null).ok, false);
});

test('validateCustomerNewPassword without a confirmation field only checks length', () => {
  assert.deepEqual(validateCustomerNewPassword('Secret123'), { ok: true });
});

// ---------------------------------------------------------------------------
// 5. Completing the reset inside the recovery session
// ---------------------------------------------------------------------------

test('a valid new password is sent to Auth exactly as validated', async () => {
  const { client, calls } = stubAuthClient();
  await completeCustomerPasswordReset('Secret123', 'Secret123', client);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'updateUser');
  assert.deepEqual(calls[0].args[0], { password: 'Secret123' });
});

test('a short password never reaches Auth', async () => {
  const { client, calls } = stubAuthClient();
  await rejects(
    () => completeCustomerPasswordReset('Ab1!', 'Ab1!', client),
    CUSTOMER_PASSWORD_WEAK_MESSAGE
  );
  assert.equal(calls.length, 0);
});

test('a mismatched confirmation never reaches Auth', async () => {
  const { client, calls } = stubAuthClient();
  await rejects(
    () => completeCustomerPasswordReset('Secret123', 'Secret124', client),
    CUSTOMER_PASSWORD_MISMATCH_MESSAGE
  );
  assert.equal(calls.length, 0);
});

test('an expired recovery session is reported as an expired link', async () => {
  const { client } = stubAuthClient({
    updateResult: { data: null, error: { message: 'Session not found' } },
  });
  await rejects(
    () => completeCustomerPasswordReset('Secret123', 'Secret123', client),
    'That reset link has expired. Request a new one and try again.'
  );
});

test('a client without updateUser reports the update could not be made', async () => {
  const { client, calls } = stubAuthClient({ omit: ['updateUser'] });
  await rejects(
    () => completeCustomerPasswordReset('Secret123', 'Secret123', client),
    'Could not update the password. Please try again.'
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 6. An unconfigured deployment explains itself
// ---------------------------------------------------------------------------

test('with no Supabase keys the flow refuses in customer words, not a transport error', async (t) => {
  if (!isMockSupabase) return t.skip('this run has a live Supabase configuration');
  const expected =
    'Password reset needs the connected Supabase project. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.';
  await rejects(() => sendCustomerPasswordReset('booked@example.com'), expected);
  await rejects(() => completeCustomerPasswordReset('Secret123', 'Secret123'), expected);
});

test('the mock refusal happens after input validation, so a bad address still says so', async (t) => {
  if (!isMockSupabase) return t.skip('this run has a live Supabase configuration');
  await rejects(() => sendCustomerPasswordReset('not-an-email'), 'Enter a valid email address.');
});
