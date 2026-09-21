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

function success(
  session: { access_token?: unknown; expires_at?: unknown; user?: { id?: unknown } | null },
  refreshed: boolean,
  error?: unknown
): SessionRefreshResult {
  return {
    ok: true,
    accessToken: typeof session.access_token === 'string' ? session.access_token : null,
    userId: typeof session.user?.id === 'string' ? session.user.id : null,
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
    const { data, error } = await auth.refreshSession();
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

// ============================================================================
// Environment & Client Connection Diagnostic Utility
// Checks NEXT_PUBLIC_SUPABASE_*, VITE_SUPABASE_*, and client connection state
// to identify configuration mismatches or credential leakage on Vercel/production.
// ============================================================================

export interface AuthEnvDiagnostics {
  timestamp: string;
  isBrowser: boolean;
  isVercel: boolean;
  vercelEnv: string | null;
  runtimeOrigin: string | null;
  envVars: {
    nextPublicSupabaseUrl: string | null;
    nextPublicSupabaseAnonKey: string | null; // masked
    viteSupabaseUrl: string | null;
    viteSupabaseAnonKey: string | null; // masked
    supabaseUrl: string | null;
    supabaseAnonKey: string | null; // masked
    hasServiceRoleKeyLeaked: boolean;
  };
  clientState: {
    clientProvided: boolean;
    clientUrl: string | null;
    clientKeyMasked: string | null;
    isPlaceholder: boolean;
    isMock: boolean;
    authEndpoint: string | null;
  };
  sessionState: {
    hasActiveSession: boolean;
    userId: string | null;
    expiresAt: string | null;
    isExpired: boolean;
    isExpiringSoon: boolean;
  };
  anomalies: string[];
}

/** Safely inspect an environment variable across Vite and Node/Next runtime formats. */
function safeReadEnv(key: string): string | null {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv && typeof metaEnv[key] === 'string' && metaEnv[key]) {
      return metaEnv[key].trim();
    }
  } catch {
    // import.meta not available
  }

  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string' && process.env[key]) {
      return process.env[key].trim();
    }
  } catch {
    // process not available
  }

  try {
    const nextData = (globalThis as any)?.__NEXT_DATA__?.env;
    if (nextData && typeof nextData[key] === 'string' && nextData[key]) {
      return nextData[key].trim();
    }
  } catch {
    // __NEXT_DATA__ not available
  }

  return null;
}

/** Mask a sensitive token/key showing only length and boundary characters. */
export function maskSecret(val: string | null | undefined): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (str.length <= 8) return `[length: ${str.length}]`;
  return `${str.slice(0, 6)}...${str.slice(-4)} (len: ${str.length})`;
}

/** Detect if running under a Vercel environment or hostname. */
function detectVercelEnvironment(): { isVercel: boolean; vercelEnv: string | null } {
  const vercelFlag = safeReadEnv('VERCEL') === '1' || safeReadEnv('VERCEL') === 'true';
  const vercelEnv = safeReadEnv('VERCEL_ENV') || safeReadEnv('NEXT_PUBLIC_VERCEL_ENV');
  const isVercelHost =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('vercel'));
  return {
    isVercel: vercelFlag || isVercelHost || !!vercelEnv,
    vercelEnv: vercelEnv || (isVercelHost ? 'preview/production' : null),
  };
}

/**
 * Diagnoses environment variable configuration vs. actual Supabase client connection state.
 * Identifies:
 *  - NEXT_PUBLIC_ vs VITE_ variable mismatches
 *  - Service role secret leakage to client
 *  - Placeholder/localhost URLs deployed on Vercel
 *  - Stale/expired auth session states
 */
export async function diagnoseAuthEnvironment(client?: any): Promise<AuthEnvDiagnostics> {
  const isBrowser = typeof window !== 'undefined';
  const { isVercel, vercelEnv } = detectVercelEnvironment();
  const runtimeOrigin = isBrowser ? window.location.origin : null;

  const nextPublicUrl = safeReadEnv('NEXT_PUBLIC_SUPABASE_URL');
  const nextPublicAnonKey = safeReadEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') || safeReadEnv('NEXT_PUBLIC_SUPABASE_KEY');
  const viteUrl = safeReadEnv('VITE_SUPABASE_URL');
  const viteAnonKey = safeReadEnv('VITE_SUPABASE_ANON_KEY');
  const rawUrl = safeReadEnv('SUPABASE_URL');
  const rawAnonKey = safeReadEnv('SUPABASE_ANON_KEY') || safeReadEnv('SUPABASE_KEY');

  // Check if service role key is accessible in browser runtime
  const leakedServiceRole = isBrowser
    ? !!(
        safeReadEnv('SUPABASE_SERVICE_ROLE_KEY') ||
        safeReadEnv('VITE_SUPABASE_SERVICE_ROLE_KEY') ||
        safeReadEnv('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')
      )
    : false;

  // Inspect Client State
  const clientProvided = !!client;
  const clientUrl = client?.supabaseUrl || client?.restUrl?.replace(/\/rest\/v1\/?$/, '') || client?.auth?.url || null;
  const clientKey = client?.supabaseKey || client?.auth?.headers?.apikey || null;
  const isPlaceholder =
    !clientUrl ||
    clientUrl.includes('placeholder-project') ||
    clientUrl.includes('placeholder') ||
    (typeof clientKey === 'string' && clientKey.includes('placeholder'));
  const isMock = !clientUrl || isPlaceholder || clientUrl.includes('127.0.0.1:3000') || clientUrl.includes('localhost:3000');

  // Inspect Session State
  let sessionState = {
    hasActiveSession: false,
    userId: null as string | null,
    expiresAt: null as string | null,
    isExpired: false,
    isExpiringSoon: false,
  };

  if (client?.auth && typeof client.auth.getSession === 'function') {
    try {
      const { data } = await client.auth.getSession();
      const session = data?.session;
      if (session) {
        const expMs = sessionExpiresAt(session);
        sessionState = {
          hasActiveSession: !!session.access_token,
          userId: session.user?.id ?? null,
          expiresAt: expMs ? new Date(expMs).toISOString() : null,
          isExpired: isSessionExpired(session),
          isExpiringSoon: isSessionExpiringSoon(session),
        };
      }
    } catch {
      // Session fetch error
    }
  }

  // Detect Anomalies
  const anomalies: string[] = [];

  if (leakedServiceRole) {
    anomalies.push('SECURITY ALERT: SUPABASE_SERVICE_ROLE_KEY is detected in browser client environment!');
  }

  if (isVercel) {
    if (!nextPublicUrl && !viteUrl && !rawUrl) {
      anomalies.push('Vercel deployment is missing Supabase URL environment variable (NEXT_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL).');
    }
    if (!nextPublicAnonKey && !viteAnonKey && !rawAnonKey) {
      anomalies.push('Vercel deployment is missing Supabase Anon Key environment variable (NEXT_PUBLIC_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY).');
    }
    if (clientUrl && (clientUrl.includes('127.0.0.1') || clientUrl.includes('localhost'))) {
      anomalies.push(`Vercel deployment is connecting to a localhost/internal URL (${clientUrl}) instead of a cloud Supabase instance.`);
    }
  }

  if (nextPublicUrl && viteUrl && nextPublicUrl !== viteUrl) {
    anomalies.push(`URL Mismatch: NEXT_PUBLIC_SUPABASE_URL (${nextPublicUrl}) does not match VITE_SUPABASE_URL (${viteUrl}).`);
  }

  if (nextPublicAnonKey && viteAnonKey && nextPublicAnonKey !== viteAnonKey) {
    anomalies.push('Key Mismatch: NEXT_PUBLIC_SUPABASE_ANON_KEY does not match VITE_SUPABASE_ANON_KEY.');
  }

  if (clientUrl && (nextPublicUrl || viteUrl)) {
    const expectedUrl = nextPublicUrl || viteUrl;
    if (expectedUrl && !clientUrl.includes(expectedUrl.replace(/^https?:\/\//, ''))) {
      anomalies.push(`Client Connection Mismatch: Client is initialized with "${clientUrl}", but environment declares "${expectedUrl}".`);
    }
  }

  if (sessionState.isExpired) {
    anomalies.push('Active session token is expired. User must refresh or re-authenticate.');
  }

  return {
    timestamp: new Date().toISOString(),
    isBrowser,
    isVercel,
    vercelEnv,
    runtimeOrigin,
    envVars: {
      nextPublicSupabaseUrl: nextPublicUrl,
      nextPublicSupabaseAnonKey: maskSecret(nextPublicAnonKey),
      viteSupabaseUrl: viteUrl,
      viteSupabaseAnonKey: maskSecret(viteAnonKey),
      supabaseUrl: rawUrl,
      supabaseAnonKey: maskSecret(rawAnonKey),
      hasServiceRoleKeyLeaked: leakedServiceRole,
    },
    clientState: {
      clientProvided,
      clientUrl,
      clientKeyMasked: maskSecret(clientKey),
      isPlaceholder,
      isMock,
      authEndpoint: client?.auth?.url || (clientUrl ? `${clientUrl}/auth/v1` : null),
    },
    sessionState,
    anomalies,
  };
}

/**
 * Formats and logs the environment and client connection diagnostics to the console.
 */
export async function logAuthEnvironmentDiagnostics(
  client?: any,
  options: { label?: string; forceLogAnomaliesOnly?: boolean } = {}
): Promise<AuthEnvDiagnostics> {
  const diag = await diagnoseAuthEnvironment(client);
  const header = options.label || 'Auth Environment & Client Connection Diagnostics';

  if (diag.anomalies.length > 0 || !options.forceLogAnomaliesOnly) {
    console.group(`[Nexora Diagnostics] === ${header} ===`);
    console.info('Runtime Context:', {
      timestamp: diag.timestamp,
      isBrowser: diag.isBrowser,
      isVercel: diag.isVercel,
      vercelEnv: diag.vercelEnv,
      origin: diag.runtimeOrigin,
    });
    console.info('Configured Environment Variables:', diag.envVars);
    console.info('Supabase Client Connection State:', diag.clientState);
    console.info('Active Auth Session State:', diag.sessionState);

    if (diag.anomalies.length > 0) {
      console.warn('[Nexora Diagnostics] Detected Anomalies / Potential Issues:', diag.anomalies);
    } else {
      console.info('[Nexora Diagnostics] All environment variables and client connection parameters match cleanly.');
    }
    console.groupEnd();
  }

  return diag;
}
