// ============================================================================
// Session freshness + refresh helpers for CLOUD WRITES.
//
// THE BUG THIS MODULE FIXES:
//   The Website Editor's "Save & Update Website" used the Supabase session as
//   it found it. When the tab had been open long enough for the access token to
//   expire (or sit inside supabase-js's 90s expiry margin) and the background
//   auto-refresh had not landed yet — a backgrounded tab, a sleeping laptop, a
//   revoked/rotated refresh token, a corporate proxy that dropped the refresh
//   call — the save request went out with a stale JWT. PostgREST/Postgres
//   answered 401/42501 ("JWT expired", "permission denied…") and the editor
//   could only show the red toast:
//
//     "Save failed: Database permission problem — please sign in again. If it
//      persists, confirm the Supabase schema, RLS policies and grants …"
//
//   Nothing was actually wrong with the RLS policies in that case: the request
//   simply was not authenticated any more. This module makes the save path
//   refresh the token BEFORE the write and once again when a write is rejected
//   for an auth-like reason, so a recoverable session is recovered silently
//   instead of being reported as a database-permission problem.
//
// CONTRACT:
//   • Every exported function is total: it never throws, it always returns a
//     structured result, and a missing/incomplete auth client (tests, mock
//     builds, a service-role client) simply reports `unavailable`.
//   • A refresh that fails while the current access token is STILL valid keeps
//     the valid token: the save is allowed to proceed and can still succeed.
//   • Only when the token is genuinely expired and the refresh failed does the
//     helper report failure, which callers surface as "please sign in again".
// ============================================================================

import { describeError } from './autoSave.js';

/**
 * Refresh this long before the token actually expires. supabase-js refreshes
 * inside its own 90s margin, but saves/retries can outlive a token that is
 * seconds from expiry (the RPC + the service-role fallback are two round
 * trips), so the save path is stricter than the SDK default.
 */
export const SESSION_REFRESH_MARGIN_MS = 120_000;

/** Why a session could not be produced. */
export type SessionFailureReason =
  | 'no-session' // nobody is signed in (or the session was cleared)
  | 'expired' // the access token is past its real expiry and refresh failed
  | 'refresh-failed' // refreshSession() errored/returned nothing and the token is dead
  | 'unavailable' // the client exposes no auth API (mock/tests/service-role)
  | 'error'; // reading the session itself threw

export interface SessionRefreshResult {
  /** True when a usable access token is available for a cloud write. */
  ok: boolean;
  /** The access token to send (fresh when `refreshed`, otherwise the current one). */
  accessToken: string | null;
  /** The signed-in user id, when known. */
  userId: string | null;
  /** Epoch ms at which the returned token expires (null when unknown). */
  expiresAt: number | null;
  /** True when this call actually replaced the token (refreshSession succeeded). */
  refreshed: boolean;
  reason?: SessionFailureReason;
  /** Exact underlying error, for the console only. */
  error?: string;
}

function failure(
  reason: SessionFailureReason,
  extra: Partial<SessionRefreshResult> = {},
  error?: unknown
): SessionRefreshResult {
  return {
    ok: false,
    accessToken: null,
    userId: null,
    expiresAt: null,
    refreshed: false,
    reason,
    ...extra,
    ...(error !== undefined ? { error: describeError(error) } : {}),
  };
}

function extractUserId(session: any): string | null {
  if (typeof session?.user?.id === 'string' && session.user.id) {
    return session.user.id;
  }
  if (typeof session?.access_token === 'string') {
    try {
      const parts = session.access_token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(
          typeof atob === 'function'
            ? atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
            : Buffer.from(parts[1], 'base64').toString('utf8')
        );
        if (typeof payload?.sub === 'string' && payload.sub) {
          return payload.sub;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function success(
  session: { access_token?: unknown; expires_at?: unknown; user?: { id?: unknown } | null },
  refreshed: boolean,
  error?: unknown
): SessionRefreshResult {
  return {
    ok: true,
    accessToken: typeof session.access_token === 'string' ? session.access_token : null,
    userId: extractUserId(session),
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at * 1000 : null,
    refreshed,
    ...(error !== undefined ? { error: describeError(error) } : {}),
  };
}

/** Epoch ms when the access token expires, or null when the session has none. */
export function sessionExpiresAt(session: any): number | null {
  const seconds = session?.expires_at;
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null;
}

/** True when the token is expired or will expire inside `marginMs`. */
export function isSessionExpiringSoon(
  session: any,
  marginMs: number = SESSION_REFRESH_MARGIN_MS
): boolean {
  const expiresAt = sessionExpiresAt(session);
  if (expiresAt === null) return false; // unknown expiry: let the server decide
  return expiresAt - Date.now() <= marginMs;
}

/** True only when the access token is past its real expiry (no margin). */
export function isSessionExpired(session: any): boolean {
  const expiresAt = sessionExpiresAt(session);
  if (expiresAt === null) return false;
  return expiresAt <= Date.now();
}

/**
 * Return a usable session for a cloud write, refreshing it first when it is
 * (or is about to become) stale.
 *
 * @param client  Anything exposing supabase-js's `auth` API — the real client,
 *                a browser client, or a test double. Missing APIs are reported
 *                as `unavailable` instead of throwing.
 * @param options.marginMs  Refresh when the token expires inside this window.
 * @param options.force     Refresh even when the token still looks fresh (used
 *                          when a write was rejected and the token may have
 *                          been revoked server-side).
 */
export async function ensureFreshSession(
  client: { auth?: any } | any,
  options: { marginMs?: number; force?: boolean } = {}
): Promise<SessionRefreshResult> {
  const marginMs = options.marginMs ?? SESSION_REFRESH_MARGIN_MS;
  const auth = client?.auth;
  if (!auth || typeof auth.getSession !== 'function') {
    return failure('unavailable');
  }

  let session: any = null;
  try {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    session = data?.session ?? null;
  } catch (err) {
    return failure('error', {}, err);
  }

  if (!session?.access_token) {
    return failure('no-session');
  }
  if (!options.force && !isSessionExpiringSoon(session, marginMs)) {
    return success(session, false);
  }
  if (typeof auth.refreshSession !== 'function') {
    // No way to refresh: keep a still-valid token, fail only a dead one.
    return isSessionExpired(session)
      ? failure('refresh-failed', {}, 'auth client exposes no refreshSession()')
      : success(session, false, 'auth client exposes no refreshSession()');
  }

  try {
    let res: any;
    if (session?.refresh_token) {
      try {
        res = await auth.refreshSession({ refresh_token: session.refresh_token });
      } catch {
        res = await auth.refreshSession();
      }
    } else {
      res = await auth.refreshSession();
    }
    const { data, error } = res || {};
    if (error) throw error;
    const next = data?.session ?? null;
    if (!next?.access_token) throw new Error('refreshSession returned no session');
    return success(next, true);
  } catch (err) {
    const stillValid = !isSessionExpired(session);
    if (stillValid) {
      // The refresh call failed (offline / blocked / rotated elsewhere) but the
      // token we hold is still inside its real lifetime: use it and let the
      // server decide, instead of failing a save that could have succeeded.
      return success(session, false, err);
    }
    return failure('expired', {}, err);
  }
}

/**
 * Force a token refresh (never using the cached token) — called after a write
 * was rejected as unauthenticated, before retrying that write exactly once.
 */
export function refreshSessionForSave(
  client: { auth?: any } | any
): Promise<SessionRefreshResult> {
  return ensureFreshSession(client, { force: true, marginMs: 0 });
}

/** Console remediation hint printed next to a session-refresh failure. */
export const SESSION_REFRESH_HINT =
  'Signing in again restores cloud sync; the pending changes stay in the local draft (nexora_draft_salon_data) until then.';
