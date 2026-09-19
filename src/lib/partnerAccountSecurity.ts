import { safePartnerErrorMessage } from './partnerUiErrors';
import {
  requestGrowthPartnerEmailChange,
  type GrowthPartnerProfileClient,
} from './growthPartnerProfile';

// ============================================================================
// Partner ACCOUNT SECURITY — the data layer behind /partner/account-settings:
// change email (verification link via Auth), change password (verified against
// the current password), TOTP two-factor (QR enrollment through Supabase
// auth.mfa), active sessions + "log out everywhere else", the security log and
// the deactivation request flow.
//
// Same contract as the rest of the portal: every read/write derives the
// partner from the session server-side; this module never accepts or forwards
// a partner id for authorization. The client mirror RPCs
// (set_my_partner_two_factor) only record state the AUTH BACKEND verified.
// ============================================================================

export interface PartnerSecuritySession {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_current: boolean;
}

export interface PartnerSecurityEvent {
  id: string;
  event_type: string;
  detail: string | null;
  created_at: string;
}

export interface PartnerDeactivationRequest {
  id: string;
  reason: string | null;
  status: string;
  requested_at: string;
}

export interface PartnerSecurityOverview {
  two_factor_enabled: boolean;
  sessions_available: boolean;
  sessions: PartnerSecuritySession[];
  events: PartnerSecurityEvent[];
  deactivation: PartnerDeactivationRequest | null;
}

export type SecurityOverviewClient = GrowthPartnerProfileClient & {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};

export async function fetchPartnerSecurityOverview(client: SecurityOverviewClient): Promise<PartnerSecurityOverview> {
  const { data, error } = await client.rpc('get_my_partner_security_overview');
  if (error || !data) throw new Error(safePartnerErrorMessage(error, 'Could not load your security overview. Please retry.'));
  return {
    two_factor_enabled: data.two_factor_enabled === true,
    sessions_available: data.sessions_available !== false,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    events: Array.isArray(data.events) ? data.events : [],
    deactivation: data.deactivation ?? null,
  };
}

/** The event labels the security log renders (everything else falls through). */
export const PARTNER_SECURITY_EVENT_LABELS: Record<string, string> = {
  credentials_changed: 'Password changed',
  email_change_requested: 'Email change requested',
  two_factor_enabled: 'Two-factor authentication enabled',
  two_factor_disabled: 'Two-factor authentication disabled',
  sessions_revoked: 'Other sessions signed out',
  deactivation_requested: 'Account deactivation requested',
  deactivation_cancelled: 'Deactivation request cancelled',
  profile_updated: 'Profile updated',
};

/**
 * "Log out of all other sessions". The RPC refuses without a current session
 * id in the JWT (revoking "the others" must never guess which one to keep).
 */
export async function revokeOtherPartnerSessions(client: SecurityOverviewClient): Promise<number> {
  const { data, error } = await client.rpc('revoke_my_other_partner_sessions');
  if (error) {
    const message = String(error.message || '');
    if (/not available/i.test(message)) throw new Error('Session management is not available on this deployment.');
    if (/could not be identified/i.test(message)) throw new Error('Your session could not be identified. Sign in again and retry.');
    throw new Error(safePartnerErrorMessage(error, 'Could not sign out the other sessions. Please retry.'));
  }
  return typeof data === 'number' ? data : 0;
}

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP)
// ---------------------------------------------------------------------------

export interface TotpEnrollment {
  factorId: string;
  /** otpauth:// URI (drives the QR + the "enter manually" fallback). */
  uri: string;
  secret: string;
  /** Server-rendered QR (data URL) when the backend provides one. */
  qrDataUrl: string | null;
}

function mfaUnavailable(): Error {
  return new Error('Two-factor authentication requires a live Supabase Auth connection.');
}

function liveMfa(client: SecurityOverviewClient) {
  const mfa = client.auth?.mfa;
  if (!mfa?.enroll || !mfa?.challenge || !mfa?.verify || !mfa?.unenroll) throw mfaUnavailable();
  return mfa;
}

/** Factor list from the auth backend — the authoritative 2FA state. */
export async function listPartnerTwoFactorFactors(client: SecurityOverviewClient): Promise<any[]> {
  const mfa = client.auth?.mfa;
  if (!mfa?.listFactors) throw mfaUnavailable();
  const { data, error } = await mfa.listFactors();
  if (error) throw new Error(safePartnerErrorMessage(error, 'Could not read your authenticator status. Please retry.'));
  const factors = data?.factors;
  return Array.isArray(factors) ? factors : [];
}

export async function beginPartnerTwoFactorEnrollment(client: SecurityOverviewClient): Promise<TotpEnrollment> {
  const mfa = liveMfa(client);
  const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: 'Nexora Growth Partner' });
  if (error) {
    if (error.status === 501 || /not supported|unavailable/i.test(error.message || '')) throw mfaUnavailable();
    if (/already/i.test(error.message || '')) throw new Error('An authenticator is already enrolled. Disable it first to set up a new one.');
    throw new Error(safePartnerErrorMessage(error, 'Could not start two-factor setup. Please retry.'));
  }
  const totp = data?.totp ?? {};
  const uri = String(totp.uri || '');
  const secret = String(totp.secret || '');
  if (!data?.id || !uri || !secret) throw new Error('The authenticator setup could not be created. Please retry.');
  let qrDataUrl: string | null = null;
  const qr = String(totp.qr_code || '');
  if (qr.startsWith('data:')) qrDataUrl = qr;
  else if (qr) qrDataUrl = `data:image/svg+xml;utf-8,${qr}`;
  return { factorId: String(data.id), uri, secret, qrDataUrl };
}

export async function confirmPartnerTwoFactor(client: SecurityOverviewClient, factorId: string, code: string): Promise<void> {
  const mfa = liveMfa(client);
  const challenge = await mfa.challenge({ factorId });
  if (challenge.error || !challenge.data?.id) {
    throw new Error(safePartnerErrorMessage(challenge.error, 'Could not start the authenticator challenge. Please retry.'));
  }
  const verify = await mfa.verify({ factorId, challengeId: String(challenge.data.id), code });
  if (verify.error) {
    if (/invalid|code/i.test(verify.error.message || '')) throw new Error('That code did not match. Check your authenticator app and retry.');
    throw new Error(safePartnerErrorMessage(verify.error, 'Could not verify the code. Please retry.'));
  }
  // The AUTH backend verified possession — now mirror the state the page renders.
  const { error } = await client.rpc('set_my_partner_two_factor', { p_enabled: true, p_factor_id: factorId });
  if (error) throw new Error(safePartnerErrorMessage(error, 'Two-factor is verified, but saving the setting failed. Retry the toggle to sync it.'));
}

export async function disablePartnerTwoFactor(client: SecurityOverviewClient, factorId: string): Promise<void> {
  const mfa = liveMfa(client);
  const { error } = await mfa.unenroll({ factorId });
  if (error) {
    if (error.status === 501 || /not supported|unavailable/i.test(error.message || '')) throw mfaUnavailable();
    throw new Error(safePartnerErrorMessage(error, 'Could not disable the authenticator. Please retry.'));
  }
  const { error: mirrorError } = await client.rpc('set_my_partner_two_factor', { p_enabled: false, p_factor_id: factorId });
  if (mirrorError) throw new Error(safePartnerErrorMessage(mirrorError, 'The authenticator was removed, but saving the setting failed. Retry to sync it.'));
}

// ---------------------------------------------------------------------------
// Password change — the current password is verified the same way sign-in is
// (never against locally cached state), then updated through Auth.
// ---------------------------------------------------------------------------

function mapAuthError(error: any, fallback: string): Error {
  const message = String(error?.message || error?.error_description || '');
  if (/invalid login credentials/i.test(message)) return new Error('Your current password is not correct.');
  if (/at least \d+ characters|weak_password/i.test(message)) return new Error('New password must be at least 8 characters.');
  if (/same.*password|different/i.test(message)) return new Error('Choose a password different from the current one.');
  if (error?.status === 501 || /live Supabase Auth/i.test(message)) return new Error('Password changes require a live Supabase Auth connection.');
  if (/rate|too many/i.test(message)) return new Error('Too many attempts. Wait a moment and retry.');
  return new Error(fallback);
}

export async function changePartnerPassword(input: {
  currentPassword: string;
  newPassword: string;
  email: string;
}, client: SecurityOverviewClient): Promise<void> {
  const signIn = client.auth?.signInWithPassword;
  if (!signIn) throw new Error('Password changes require a live Supabase Auth connection.');
  // Verify possession first: a stolen tab cannot rotate the password.
  const check = await signIn({ email: input.email, password: input.currentPassword });
  if (check.error) throw mapAuthError(check.error, 'Your current password is not correct.');
  const update = await client.auth.updateUser({ password: input.newPassword });
  if (update.error) {
    if (/same|different/i.test(update.error.message || '')) throw new Error('Choose a password different from the current one.');
    if (/at least/i.test(update.error.message || '')) throw new Error('New password must be at least 8 characters.');
    throw mapAuthError(update.error, 'Could not update your password. Sign in again and retry.');
  }
}

// ---------------------------------------------------------------------------
// Email change — thin wrapper so the account page logs one security event and
// shares the exact same Auth contract as the profile page.
// ---------------------------------------------------------------------------

export async function requestPartnerEmailChange(input: {
  email: string;
  expectedUserId: string;
  currentEmail: string;
  logEvent?: boolean;
}, client: SecurityOverviewClient): Promise<void> {
  await requestGrowthPartnerEmailChange(input.email, input.expectedUserId, client, input.currentEmail);
  if (input.logEvent !== false) {
    // Best-effort audit trail; a failed log never blocks the Auth request.
    try {
      await client.rpc('log_my_partner_security_event', {
        p_type: 'email_change_requested',
        p_detail: 'Verification link requested for a new email address.',
      });
    } catch { /* the log is advisory */ }
  }
}

// ---------------------------------------------------------------------------
// Account deactivation — a REQUEST for review, never a destructive action.
// ---------------------------------------------------------------------------

export async function requestPartnerAccountDeactivation(reason: string, client: SecurityOverviewClient): Promise<PartnerDeactivationRequest> {
  const trimmed = String(reason || '').trim().slice(0, 500);
  const { data, error } = await client.rpc('request_my_partner_account_deactivation', { p_reason: trimmed || null });
  if (error) {
    if (/already pending/i.test(error.message || '')) throw new Error('A deactivation request is already pending review.');
    throw new Error(safePartnerErrorMessage(error, 'Could not request deactivation. Please retry.'));
  }
  return {
    id: String(data?.id || ''),
    reason: trimmed || null,
    status: String(data?.status || 'pending'),
    requested_at: String(data?.requested_at || new Date().toISOString()),
  };
}

export async function cancelPartnerAccountDeactivation(client: SecurityOverviewClient): Promise<void> {
  const { error } = await client.rpc('cancel_my_partner_account_deactivation');
  if (error) {
    if (/no pending/i.test(error.message || '')) throw new Error('There is no pending deactivation request to cancel.');
    throw new Error(safePartnerErrorMessage(error, 'Could not cancel the deactivation request. Please retry.'));
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Parse a session's user agent into a short "device · browser" label. */
export function describeSession(userAgent: string | null): string {
  const ua = String(userAgent || '').trim();
  if (!ua) return 'Unknown device';
  const browser =
    (/Edg\//.test(ua) && 'Edge') ||
    (/OPR\//.test(ua) && 'Opera') ||
    (/Chrome\//.test(ua) && !/Chromium/.test(ua) && 'Chrome') ||
    (/Chromium/.test(ua) && 'Chromium') ||
    (/Firefox\//.test(ua) && 'Firefox') ||
    (/Safari\//.test(ua) && 'Safari') ||
    'Browser';
  const device =
    (/iPhone/.test(ua) && 'iPhone') ||
    (/iPad/.test(ua) && 'iPad') ||
    (/Android/.test(ua) && 'Android device') ||
    (/Windows/.test(ua) && 'Windows PC') ||
    (/Mac OS X|Macintosh/.test(ua) && 'Mac') ||
    (/Linux/.test(ua) && 'Linux device') ||
    'Device';
  return `${device} · ${browser}`;
}
