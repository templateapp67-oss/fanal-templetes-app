// ============================================================================
// Customer App — password recovery.
//
// WHY THIS FILE EXISTS
// --------------------
// The customer sign-in screen could create an account and sign into one, but
// there was no way back in after a forgotten password: no "forgot password"
// link, no reset request, no new-password form. A customer who forgot their
// password was locked out of their bookings, rewards and pass permanently — the
// #1 gap in the 2026-10-04 customer audit.
//
// The fix uses Supabase Auth's own reset flow, exactly as the partner portal and
// the onboarding app already do (`src/lib/partnerPortalAuth.ts`,
// `src/onboarding/lib/auth.ts`). No reset-token table, no custom email, no
// password stored anywhere in this app: `resetPasswordForEmail` sends the link,
// the link lands back on the customer auth route, the client exchanges the token
// for a recovery session and fires PASSWORD_RECOVERY, and `updateUser` sets the
// new password on that session.
//
// SECURITY RULES (the same three the partner portal holds itself to):
//   1. Requesting a reset always resolves to the SAME copy, whether or not the
//      address has an account. An enumeration oracle here would leak which
//      emails are registered.
//   2. Errors are translated to customer-readable text before they reach the
//      screen — GoTrue's raw strings ("Invalid email", "For security reasons…")
//      are not something a person can act on.
//   3. The strength check is UX only. Supabase Auth re-validates on
//      `updateUser`; nothing here is the last line of defence.
// ============================================================================

import { supabase, isMockSupabase } from '../supabaseClient.js';

/** The route the reset email must land on: the customer app's own auth screen. */
export const CUSTOMER_AUTH_PATH = '/app/auth';

/** Matches the sign-up rule on the same screen, so the two never disagree. */
export const CUSTOMER_PASSWORD_MIN_LENGTH = 6;

export const CUSTOMER_PASSWORD_WEAK_MESSAGE = `Use at least ${CUSTOMER_PASSWORD_MIN_LENGTH} characters for your password.`;
export const CUSTOMER_PASSWORD_MISMATCH_MESSAGE = 'The two passwords do not match.';

/** Shown for every valid address, whether or not an account exists. */
export const RESET_SENT_MESSAGE =
  'If an account uses that email, a password-reset link is on its way. The link expires, so use it soon.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The narrow slice of the Supabase client this flow touches, so a test can pass
 * a stub instead of a live client.
 */
export interface CustomerAuthClient {
  auth: {
    resetPasswordForEmail: (email: string, options?: { redirectTo?: string }) => Promise<{ data: any; error: any }>;
    updateUser?: (attributes: { password: string }) => Promise<{ data: any; error: any }>;
  };
}

/**
 * Absolute redirect target for the reset link. Supabase Auth appends the
 * recovery token to this URL; a relative value would be resolved against the
 * Auth server instead of this deployment, so the origin is included whenever one
 * is known.
 */
export function customerPasswordResetRedirectTo(origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  return base ? `${base}${CUSTOMER_AUTH_PATH}` : CUSTOMER_AUTH_PATH;
}

/**
 * GoTrue strings a customer cannot act on, mapped once. Anything unrecognised
 * falls back to generic copy rather than echoing the raw provider message.
 */
export function describeResetError(message: unknown): string {
  const text = String(message ?? '');
  if (/rate limit|too many requests|too_many_requests/i.test(text)) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  if (/invalid email|email.*invalid|unable to validate email/i.test(text)) {
    return 'Enter a valid email address.';
  }
  // GoTrue reports a dead recovery link several ways depending on version:
  // `session_not_found`, `Session not found`, `Refresh Token Not Found`,
  // `refresh_token_not_found`, or an outright `expired`. All of them mean the
  // same thing to the customer — ask for a new link.
  if (/session not found|session_not_found|expired|invalid recovery|refresh[ _]?token/i.test(text)) {
    return 'That reset link has expired. Request a new one and try again.';
  }
  if (/password.*short|length|too weak|weak password|should be at least/i.test(text)) {
    return CUSTOMER_PASSWORD_WEAK_MESSAGE;
  }
  if (/redirect_to|redirect url|not allowed/i.test(text)) {
    return 'Password reset is not configured for this deployment. Contact the salon.';
  }
  return 'We could not complete that. Please try again.';
}

/**
 * The shared browser client, used as the default for both calls below. Held in a
 * binding so an explicitly injected client can be told apart from it.
 */
const sharedClient = supabase as unknown as CustomerAuthClient;

const MOCK_MESSAGE =
  'Password reset needs the connected Supabase project. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.';

/**
 * The mock-deployment guard applies to the *shared* client only: with no
 * Supabase keys, `resetPasswordForEmail` would run against the placeholder
 * project and come back as a transport error no customer can act on, so the
 * same stance as the sign-in form holds — accounts are real database users,
 * there is nothing to reset against and no demo flow to fake. A caller that
 * injects its own Auth client has already asserted that client can send the
 * email, so it is used as given. Production always takes the default.
 */
function guardMockDeployment(client: CustomerAuthClient): void {
  if (client === sharedClient && isMockSupabase) throw new Error(MOCK_MESSAGE);
}

/**
 * Request a password-reset email.
 *
 * Resolves for any syntactically valid address — the caller shows
 * `RESET_SENT_MESSAGE` either way, so the response cannot be used to discover
 * which emails have accounts. Throws only on invalid input, an unconfigured
 * deployment, or a transport failure, always with safe copy.
 */
export async function sendCustomerPasswordReset(
  email: string,
  client: CustomerAuthClient = sharedClient,
): Promise<void> {
  const trimmed = String(email ?? '').trim();
  if (!EMAIL_RE.test(trimmed)) throw new Error('Enter a valid email address.');
  guardMockDeployment(client);
  if (typeof client.auth?.resetPasswordForEmail !== 'function') {
    throw new Error('Password reset is unavailable right now. Please try again later.');
  }
  const { error } = await client.auth.resetPasswordForEmail(trimmed, {
    redirectTo: customerPasswordResetRedirectTo(),
  });
  if (error) throw new Error(describeResetError(error.message || error));
}

/** Client-side strength + confirmation check (Auth re-validates server-side). */
export function validateCustomerNewPassword(
  password: unknown,
  confirm?: unknown,
): { ok: true } | { ok: false; message: string } {
  const value = String(password ?? '');
  if (value.length < CUSTOMER_PASSWORD_MIN_LENGTH) {
    return { ok: false, message: CUSTOMER_PASSWORD_WEAK_MESSAGE };
  }
  if (confirm !== undefined && value !== String(confirm ?? '')) {
    return { ok: false, message: CUSTOMER_PASSWORD_MISMATCH_MESSAGE };
  }
  return { ok: true };
}

/**
 * Set the new password inside a live PASSWORD_RECOVERY session.
 *
 * The recovery session is a real session (Supabase exchanged the token from the
 * link), so the caller is already authenticated and can be signed straight in
 * afterwards — no second email, no re-entry of the old password.
 */
export async function completeCustomerPasswordReset(
  password: string,
  confirm: string,
  client: CustomerAuthClient = sharedClient,
): Promise<void> {
  const check = validateCustomerNewPassword(password, confirm);
  if (check.ok === false) throw new Error(check.message);
  guardMockDeployment(client);
  if (typeof client.auth?.updateUser !== 'function') {
    throw new Error('Could not update the password. Please try again.');
  }
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(describeResetError(error.message || error));
}
