import {
  isSessionExpiredError,
  type GrowthPartner,
} from './growthPartner';
import {
  toGrowthPartnerLoginError,
  type GrowthPartnerAuthClient,
} from './growthPartnerLogin';
import { PARTNER_LOGIN_PATH } from './router';
import {
  clearAuthSessionLifetime,
  purgeRememberedAuthTokens,
  setAuthSessionLifetime,
  type AuthStoragePair,
  type WebStorageLike,
} from './authRememberStorage';

// ============================================================================
// Growth Partner PORTAL login (PART 2) — the dedicated `/partner/login` route.
//
// Authentication and authorization reuse the same machinery as the rest of the
// platform, with no second auth system:
//
//   • Sign-in is Supabase Auth `signInWithPassword` (no manual password
//     storage). Password reset is Supabase Auth `resetPasswordForEmail` +
//     `updateUser` (the PASSWORD_RECOVERY event supplies the session).
//   • Authorization is decided ONLY by the caller's own `growth_partners` row
//     (RLS SELECT-own-row) plus their own KYC application row: an ACTIVE row
//     grants, a paused row denies, a pending application holds, a rejected
//     application denies, and a normal user gets zero rows → no access.
//
// NOTHING the browser could set (a role flag, a stored value, a URL/query
// parameter, a manually supplied partner id, React state) is an input to the
// resolver below — the localStorage/sessionStorage helpers in this file only
// carry the "Remember me" preference (which email to prefill and which browser
// store holds the session), never access.
// ============================================================================

/** The exact heading the PART 2 login page must show. */
export const PARTNER_PORTAL_LOGIN_TITLE = 'Growth Partner Login';
export const PARTNER_PORTAL_LOGIN_SUBTITLE =
  'Sign in with your Growth Partner account to open your partner dashboard.';
export const PARTNER_PORTAL_LOGIN_VERIFYING_LABEL = 'Checking your Growth Partner access…';
export const PARTNER_PORTAL_LOGIN_MOCK_TITLE = 'Growth Partner Login needs a live connection';
export const PARTNER_PORTAL_LOGIN_MOCK_BODY =
  'Signing in needs Supabase Auth, which is not connected in this preview. No demo numbers are shown.';

/** The exact denial copy required for non-partners on `/partner/*`. */
export const PARTNER_PORTAL_UNAUTHORIZED_TITLE = 'Growth Partners only';
export const PARTNER_PORTAL_UNAUTHORIZED_BODY = 'You do not have access to the Growth Partner portal.';
export const PARTNER_PORTAL_UNAUTHORIZED_HINT =
  'If you were invited as a Growth Partner, sign in with that account.';

export const PARTNER_PORTAL_PENDING_TITLE = 'Application under review';
export const PARTNER_PORTAL_PENDING_BODY =
  'Your Growth Partner application is with our team. You will get access here as soon as it is approved.';

export const PARTNER_PORTAL_REJECTED_TITLE = 'Application not approved';
export const PARTNER_PORTAL_REJECTED_BODY =
  'Your Growth Partner application was not approved, so the partner portal stays closed for this account.';

export const PARTNER_PORTAL_SESSION_TITLE = 'Your session expired';
export const PARTNER_PORTAL_SESSION_BODY = 'Please sign in again to continue.';

export const PARTNER_PORTAL_ERROR_TITLE = 'Could not verify your Growth Partner access';
export const PARTNER_PORTAL_ERROR_BODY = 'Please try again.';

export const PARTNER_RESET_REQUESTED_MESSAGE =
  'If that email has a Growth Partner account, a password reset link is on its way. Please check your inbox.';
export const PARTNER_PASSWORD_MIN_LENGTH = 8;
export const PARTNER_PASSWORD_WEAK_MESSAGE = `Choose a password of at least ${PARTNER_PASSWORD_MIN_LENGTH} characters.`;
export const PARTNER_PASSWORD_MISMATCH_MESSAGE = 'The two passwords do not match.';
export const PARTNER_PASSWORD_UPDATED_MESSAGE = 'Password updated. Opening your partner dashboard…';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Client shape
// ---------------------------------------------------------------------------

/**
 * Structural Supabase Auth client for the portal login flow (the real
 * `supabase` satisfies this; so do test fakes). Extends the shared
 * Growth Partner client with the two methods the password-reset flow needs,
 * plus the auth-event subscription that surfaces PASSWORD_RECOVERY.
 */
export interface PartnerPortalAuthClient extends GrowthPartnerAuthClient {
  auth: GrowthPartnerAuthClient['auth'] & {
    resetPasswordForEmail?: (
      email: string,
      options?: { redirectTo?: string }
    ) => Promise<{ data: any; error: any }>;
    updateUser?: (attributes: { password?: string }) => Promise<{ data: any; error: any }>;
    onAuthStateChange?: (
      callback: (event: string, session: any) => void
    ) => { data: { subscription: { unsubscribe: () => void } } };
  };
}

// ---------------------------------------------------------------------------
// "Remember me" — remembered EMAIL (prefill only; never authorization)
// ---------------------------------------------------------------------------

/** localStorage key for the remembered email (only written when remembered). */
export const PARTNER_REMEMBERED_EMAIL_KEY = 'partner-portal.remembered-email';

/** Read the remembered login email (empty string when none). */
export function readRememberedPartnerEmail(
  store?: WebStorageLike | null
): string {
  const target = store ?? defaultLocalStorage();
  try {
    return String(target?.getItem(PARTNER_REMEMBERED_EMAIL_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Store or clear the remembered email: kept in localStorage when "Remember me"
 * is checked, removed (and kept out of storage entirely) when unchecked. The
 * value is only ever a prefill — the account that signs in is decided by the
 * credentials, and access by the backend.
 */
export function writeRememberedPartnerEmail(
  email: string,
  remember: boolean,
  store?: WebStorageLike | null
): void {
  const target = store ?? defaultLocalStorage();
  if (!target) return;
  try {
    if (remember) {
      target.setItem(PARTNER_REMEMBERED_EMAIL_KEY, String(email ?? '').trim());
    } else {
      target.removeItem(PARTNER_REMEMBERED_EMAIL_KEY);
    }
  } catch {
    // A locked store must not break sign-in.
  }
}

function defaultLocalStorage(): WebStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply the "Remember me" choice to the SESSION stores (see
 * authRememberStorage.ts) and return a revert function for a failed sign-in.
 */
export function beginPartnerSessionLifetime(remember: boolean, pair?: AuthStoragePair): () => void {
  setAuthSessionLifetime(remember, pair);
  return () => clearAuthSessionLifetime(pair);
}

/** After a successful "do not remember" sign-in, drop older remembered sessions. */
export function finishPartnerSessionLifetime(remember: boolean, pair?: AuthStoragePair): void {
  if (!remember) purgeRememberedAuthTokens(pair);
  clearAuthSessionLifetime(pair);
}

// ---------------------------------------------------------------------------
// Login resolver (pure — the ONLY thing that decides portal access)
// ---------------------------------------------------------------------------

/** The one state the login route renders for a given (session, backend) pair. */
export type PartnerPortalLoginState =
  | 'loading'
  | 'mock-mode'
  | 'signed-out'
  | 'unauthorized'
  | 'pending-review'
  | 'rejected'
  | 'inactive'
  | 'session-expired'
  | 'error'
  | 'granted';

/**
 * Pure resolver (exported for tests): maps (session, backend role, backend
 * application) to the single state the login route renders.
 *
 *   • `partnerRow === null` after a successful lookup means "signed in but not
 *     a partner". Their own application row then separates pending (hold),
 *     rejected (deny) and never-applied (unauthorized).
 *   • a partner row with `is_active === false` is DENIED (inactive/suspended),
 *     never silently admitted — the account and its data stay untouched.
 *
 * There is deliberately no parameter here for a role, a stored value, a URL
 * fragment or a partner id: nothing the browser could set can change the
 * outcome.
 */
export function resolvePartnerPortalLogin(input: {
  loading: boolean;
  isMockMode: boolean;
  userId: string | null;
  partnerRow: GrowthPartner | null;
  /** Status of the caller's own KYC application, when they have one. */
  applicationStatus?: string | null;
  loadError: unknown;
}): PartnerPortalLoginState {
  if (input.isMockMode) return 'mock-mode';
  if (input.loading) return 'loading';
  if (!input.userId) return 'signed-out';
  if (input.loadError) return isSessionExpiredError(input.loadError) ? 'session-expired' : 'error';
  if (!input.partnerRow) {
    if (input.applicationStatus === 'pending') return 'pending-review';
    if (input.applicationStatus === 'rejected') return 'rejected';
    return 'unauthorized';
  }
  if (input.partnerRow.is_active === false) return 'inactive';
  return 'granted';
}

// ---------------------------------------------------------------------------
// Forgot password (Supabase Auth reset; no custom reset tables)
// ---------------------------------------------------------------------------

/**
 * Where the reset email's link must land the partner: the dedicated login
 * route. Supabase Auth appends the recovery token, the client's
 * detectSessionInUrl establishes the recovery session and fires
 * PASSWORD_RECOVERY, and the login page then asks for the new password.
 */
export function partnerPasswordResetRedirectTo(origin?: string): string {
  const base =
    origin ??
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  return base ? `${base}${PARTNER_LOGIN_PATH}` : PARTNER_LOGIN_PATH;
}

/**
 * Request a password-reset email through Supabase Auth. Always resolves to
 * the same success copy for any valid email — account existence is never
 * revealed. Throws only for invalid input or transport failures, always with
 * safe copy.
 */
export async function sendPartnerPasswordReset(
  client: PartnerPortalAuthClient,
  email: string
): Promise<void> {
  const trimmed = String(email ?? '').trim();
  if (!EMAIL_RE.test(trimmed)) {
    throw new Error('Enter a valid email address.');
  }
  if (!client.auth.resetPasswordForEmail) {
    throw new Error('Password reset is unavailable right now. Please try again later.');
  }
  const { error } = await client.auth.resetPasswordForEmail(trimmed, {
    redirectTo: partnerPasswordResetRedirectTo(),
  });
  if (error) throw toGrowthPartnerLoginError(error);
}

/** Client-side strength check (the backend re-validates; this is UX only). */
export function validatePartnerNewPassword(
  password: unknown,
  confirm?: unknown
): { ok: true } | { ok: false; message: string } {
  const value = String(password ?? '');
  if (value.length < PARTNER_PASSWORD_MIN_LENGTH) {
    return { ok: false, message: PARTNER_PASSWORD_WEAK_MESSAGE };
  }
  if (confirm !== undefined && value !== String(confirm ?? '')) {
    return { ok: false, message: PARTNER_PASSWORD_MISMATCH_MESSAGE };
  }
  return { ok: true };
}

/**
 * Complete the password reset during a PASSWORD_RECOVERY session: set the new
 * password through Supabase Auth (`updateUser`). The recovery session is a
 * real session, so the role verification then proceeds exactly like a sign-in.
 */
export async function completePartnerPasswordReset(
  client: PartnerPortalAuthClient,
  password: string
): Promise<void> {
  const check = validatePartnerNewPassword(password);
  if (check.ok === false) throw new Error(check.message);
  if (!client.auth.updateUser) {
    throw new Error('Could not update the password. Please try again.');
  }
  const { error } = await client.auth.updateUser({ password });
  if (error) throw toGrowthPartnerLoginError(error);
}
