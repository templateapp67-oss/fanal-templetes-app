// ============================================================================
// Auto-save engine helpers.
//
// Shared primitives used by the debounced auto-save in App.tsx:
//   • SaveStatus           — one status vocabulary for the whole app
//                            (incl. 'saved_local' = SUCCESS (Local Draft))
//   • AUTOSAVE_DEBOUNCE_MS — debounce delay (1000–1500ms window)
//   • toDbId()             — deterministic, UUID-safe ids for Supabase rows
//   • describeError()      — exact, human-readable error extraction
//   • isRetriableError()   — network/transient vs deterministic DB failures
//   • withRetry()          — retry with exponential backoff + exact logging
//   • safeWriteLocalStorage() — quota-aware localStorage writes
//   • writeLocalDraft()    — the nexora_draft_salon_data recovery cache
//   • saveViaWebsiteApi()  — POST /api/website/save fallback (service role)
//   • runSalonSavePipeline() — client sync → API fallback → local draft
//
// NOTE: `import type { ... } from './salonSync.js'` is type-only (erased at
// compile time), so this module stays a leaf of the runtime dependency graph
// even though the pipeline orchestrates salonSync.syncSalonToSupabase (the
// actual function is injected by the caller — see SalonSavePipelineOptions).
// ============================================================================

import type { SalonSyncPayload, SalonSyncResult } from './salonSync.js';

/** Auto-save debounce delay. Kept inside the 1000–1500ms sweet spot so fast
 *  typing does not spam the API while edits still persist quickly. */
export const AUTOSAVE_DEBOUNCE_MS = 1200;

/** How long the "All changes saved" status stays visible before going idle. */
export const SAVE_STATUS_RESET_MS = 2500;

/** Total attempts (1 initial + retries) for a retriable save operation. */
export const SAVE_MAX_ATTEMPTS = 3;

/** Base delay for retry backoff (doubles per attempt, ±jitter). */
export const SAVE_RETRY_BASE_DELAY_MS = 600;

/**
 * One status vocabulary for the whole app:
 *   idle        — no save scheduled / in flight
 *   pending     — edits debounced, save runs ~1.2s after the last change
 *   saving      — save request in flight
 *   saved       — persisted to the cloud (direct sync or the service-role API)
 *   saved_local — SUCCESS (Local Draft): persisted to localStorage
 *                 `nexora_draft_salon_data` because the owner is
 *                 unauthenticated / on a local mock session, or because both
 *                 cloud paths failed. Progress is safe on the device; this is
 *                 a *success*, never a blocking "couldn't save" error.
 *   error       — even the local write failed (storage disabled etc.)
 */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'saved_local' | 'error';

/** Label the status pill shows for a successful local-draft save. */
export const LOCAL_DRAFT_STATUS_LABEL = 'SUCCESS (Local Draft)';

// ----------------------------------------------------------------------------
// Deterministic UUID mapping
// ----------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the value is already a valid UUID (any version). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Tiny, well-known 128-bit string hash (cyrb128). Deterministic across
 * sessions/browsers, which is all the DB id mapping needs.
 */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/**
 * Map an app-side record id to a UUID that Supabase's `uuid` primary keys
 * accept.
 *
 * The app uses friendly string ids (`hs-1`, `srv-1693…`, `rew-2`), while the
 * DB schema (`services.id`, `stylists.id`, `loyalty_rewards.id`) uses UUIDs.
 * Upserting a non-UUID id used to fail every save with
 * "invalid input syntax for type uuid". This function returns:
 *   • the id unchanged, when it is already a valid UUID (so rows hydrated
 *     from the DB round-trip unchanged), or
 *   • a deterministic UUID derived from `namespace + ':' + appId`, so the
 *     same logical record always maps to the same DB row across sessions —
 *     repeated saves upsert instead of duplicating.
 */
export function toDbId(appId: string, namespace: string): string {
  const key = appId || '';
  if (isUuid(key)) return key.toLowerCase();
  const [a, b, c, d] = cyrb128(`${namespace}:${key}`);
  // Format as a v4-looking UUID (version + RFC variant bits set).
  const part = `${hex8(a)}${hex8(b)}${hex8(c)}${hex8(d)}`;
  return [
    part.slice(0, 8),
    part.slice(8, 12),
    `4${part.slice(13, 16)}`, // version nibble
    `${((parseInt(part.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${part.slice(17, 20)}`, // variant
    part.slice(20, 32),
  ].join('-');
}

// ----------------------------------------------------------------------------
// Error description / classification
// ----------------------------------------------------------------------------

/**
 * Extract the most exact, useful message from an unknown error — including
 * Supabase/PostgREST error objects that carry code/details/hint, network
 * TypeErrors, and plain strings.
 */
export function describeError(err: unknown): string {
  if (err === null || err === undefined) return 'Unknown error';
  if (typeof err === 'string') return err || 'Unknown error';
  if (err instanceof Error || typeof err === 'object') {
    const e = err as Record<string, any>;
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message) parts.push(e.message);
    if (e.code) parts.push(`code: ${e.code}`);
    if (e.details) parts.push(`details: ${e.details}`);
    if (e.hint) parts.push(`hint: ${e.hint}`);
    if (e.status !== undefined && e.status !== null) parts.push(`status: ${e.status}`);
    if (parts.length) return parts.join(' | ');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Errors worth retrying: transient network / server / rate-limit problems. */
const RETRYABLE_PATTERNS: RegExp[] = [
  /network/i,
  /fetch failed|failed to fetch/i,
  /blocked by cors|cors policy/i,
  /timeout|timed out/i,
  /econn|socket|connection (refused|reset|closed|terminated)/i,
  /aborted|interrupted/i,
  /overloaded/i,
  /rate.?limit|too many requests/i,
  /service unavailable|internal server error|bad gateway|gateway timeout/i,
  /\b(408|429|500|502|503|504)\b/,
];

/** Deterministic database rejections — retrying these can never succeed. */
const NON_RETRYABLE_PATTERNS: RegExp[] = [
  /unique constraint|duplicate key/i,
  /violat(es|ing) foreign key/i,
  /invalid input syntax/i,
  /permission denied|row-level security/i,
  /unauthorized|forbidden|jwt|token/i,
  /does not exist/i,
];

export function isRetriableError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const status = (err as Record<string, any>).status;
    if (typeof status === 'number') {
      if (status === 408 || status === 429 || (status >= 500 && status <= 504)) return true;
      if (status >= 400 && status < 500) return false; // deterministic client error
    }
  }
  const message = describeError(err).toLowerCase();
  if (!message) return false;
  if (NON_RETRYABLE_PATTERNS.some((re) => re.test(message))) return false;
  return RETRYABLE_PATTERNS.some((re) => re.test(message));
}

export interface RetryOptions {
  /** Total attempts including the first one. Default 3. */
  maxAttempts?: number;
  /** Base backoff delay in ms; doubles each retry. Default 600. */
  baseDelayMs?: number;
  /** Label used in console logs, e.g. "cloud sync → save services". */
  label?: string;
  /** Injectable logger for tests. Defaults to console.error. */
  log?: (...args: unknown[]) => void;
}

/**
 * Run an async operation with retry + exponential backoff.
 *
 * Only *retriable* failures (network, 5xx, rate limits…) are retried; a
 * deterministic DB rejection (e.g. unique constraint) fails fast. Every
 * failed attempt is logged with the exact underlying error message so the
 * root cause is visible in the console.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? SAVE_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? SAVE_RETRY_BASE_DELAY_MS;
  const log = options.log ?? console.error;
  const label = options.label ?? 'operation';

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const description = describeError(err);
      if (attempt >= maxAttempts || !isRetriableError(err)) {
        log(`[AutoSave] ${label} failed on attempt ${attempt}/${maxAttempts}: ${description}`);
        throw err;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250;
      log(
        `[AutoSave] ${label} attempt ${attempt}/${maxAttempts} failed (${description}). Retrying in ${Math.round(delay)}ms…`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ----------------------------------------------------------------------------
// Quota-aware localStorage writes
// ----------------------------------------------------------------------------

export interface LocalStorageWriteResult {
  ok: boolean;
  /** True when the write succeeded only after stripping inline images. */
  degraded?: boolean;
  /** Exact error message when ok is false (or the original quota error when degraded). */
  error?: string;
}

const INLINE_IMAGE_RE = /"data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}"/gi;

/**
 * Write a string to localStorage without ever throwing.
 *
 * The salon profile stores uploaded images as data URLs (up to ~2MB each), so
 * the JSON payload can exceed the ~5MB browser quota — which used to make the
 * whole save flow throw ("Save failed"). On a quota error we retry once with
 * inline images stripped so the textual data still persists locally.
 */
export function safeWriteLocalStorage(key: string, value: string): LocalStorageWriteResult {
  if (typeof localStorage === 'undefined') {
    return { ok: false, error: 'localStorage is not available in this environment' };
  }
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    const description = describeError(err);
    try {
      const trimmed = value.replace(INLINE_IMAGE_RE, '"data:trimmed"');
      if (trimmed !== value) {
        localStorage.setItem(key, trimmed);
        return { ok: true, degraded: true, error: description };
      }
    } catch (secondErr) {
      return { ok: false, error: `${description}; retry also failed: ${describeError(secondErr)}` };
    }
    return { ok: false, error: description };
  }
}

// ----------------------------------------------------------------------------
// Toast-friendly summaries (full detail always goes to the console)
// ----------------------------------------------------------------------------

/**
 * Shorten a raw failure string into something readable for a toast, mapping
 * the most common root causes to actionable guidance. Full detail is always
 * logged to the console separately; this function only picks the right
 * owner-facing message per failure class.
 */
export function summarizeSaveError(detail: string): string {
  const d = (detail || '').toLowerCase();

  // 1) Deterministic domain problems — the exact action the owner must take.
  if (d.includes('subdomain') && (d.includes('duplicate key') || d.includes('unique constraint'))) {
    return 'This subdomain is already taken — please choose a different one.';
  }
  if (d.includes('invalid input syntax for type uuid')) {
    return 'Database rejected a record id (uuid mismatch).';
  }

  // 1b) The session itself is gone (expired/revoked access token, refresh token
  // rejected). Checked BEFORE the generic permission branch: a stale JWT is
  // reported by PostgREST as 401/42501 and must not be described as a broken
  // RLS policy. The save engine already tried a silent refresh + retry, so at
  // this point the owner genuinely has to sign in again — and their edits are
  // safe in the local draft.
  if (isSessionExpiryFailure(detail)) {
    return SESSION_EXPIRED_SAVE_MESSAGE;
  }

  // 2) Authentication / authorization problems: expired/invalid JWT or login,
  // missing table grants for the authenticated role (PostgREST: "permission
  // denied for table …", code 42501) or RLS policies rejecting the row
  // ("new row violates row-level security policy"). Re-signing in and
  // re-applying the schema/RLS/grants from supabase/migrations fixes these.
  if (
    d.includes('invalid jwt') ||
    d.includes('jwt expired') ||
    d.includes('token') ||
    d.includes('unauthorized') ||
    d.includes('forbidden') ||
    d.includes('not authenticated') ||
    d.includes('no active session') ||
    d.includes('row-level security') ||
    d.includes('permission denied') ||
    d.includes('42501') ||
    d.includes('42503') ||
    /\b(401|403)\b/.test(d)
  ) {
    return 'Database permission problem — please sign in again. If it persists, apply the Supabase schema, RLS policies and grants (supabase/migrations/20261010_salon_profile_rls_and_grants.sql, SUPABASE_SETUP.md §9).';
  }

  // 3) Missing schema/table — the SQL migrations were never applied to the
  // linked Supabase project (PostgREST: "relation … does not exist", 42P01).
  if (d.includes('does not exist') || d.includes('42p01') || d.includes('undefined table')) {
    return 'Database schema missing — apply supabase/migrations to your Supabase project (see SUPABASE_SETUP.md).';
  }

  // 3b) The server-side save fallback itself is absent on the deployed host
  // (older build without the /api/website/save route, or the API function
  // not deployed) — the platform answers 404, not Supabase.
  if (
    d.includes('404') &&
    (d.includes('api route not found') || d.includes('/api/website/save') || d.includes('not found'))
  ) {
    return 'The save API is not deployed on this host yet (HTTP 404) — redeploy the API (api/index.ts / server.ts). Your edits are kept on this device and retry automatically.';
  }

  // 4) Transient network/server problems — auto-retried with backoff; local
  // (device) persistence already succeeded, so no data is lost. Also covers
  // CORS aborts ("blocked by CORS policy") of cross-origin API calls.
  if (
    d.includes('fetch failed') ||
    d.includes('failed to fetch') ||
    d.includes('blocked by cors') ||
    d.includes('cors policy') ||
    d.includes('network') ||
    d.includes('timeout') ||
    d.includes('econn') ||
    d.includes('service unavailable') ||
    d.includes('bad gateway') ||
    d.includes('gateway timeout') ||
    /\b(408|429|500|502|503|504)\b/.test(d)
  ) {
    return 'Network error — could not reach the database or the save API (connection dropped, host not deployed, or CORS blocked the cross-origin call). Retrying automatically; your edits are kept on this device.';
  }

  // 5) Initial cloud hydration/load could not complete even after retries.
  if (d.includes('hydration') || d.includes('could not load')) {
    return 'Could not load your existing data from the cloud — your edits stay saved on this device and the sync keeps retrying. See the console for the exact reason.';
  }

  const trimmed = (detail || '').trim();
  if (!trimmed) return 'Unknown error';
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

/**
 * Owner-facing copy for a save rejected because the SESSION is gone (expired
 * or revoked access token, rejected refresh token) — as opposed to a broken
 * RLS policy or a missing GRANT, which no amount of refreshing can fix.
 * Deliberately says what happened, what is safe, and what to do next; never
 * the raw PostgREST/Postgres text.
 */
export const SESSION_EXPIRED_SAVE_MESSAGE =
  'Your session expired, so we could not publish to the cloud. Your edits are saved on this device — sign in again and press Save to publish them.';

/**
 * True when the error describes an EXPIRED / UNUSABLE SESSION — the one class
 * of auth failure a silent `refreshSession()` + retry can recover, and the one
 * that must never be blamed on RLS policies or missing grants.
 *
 * `isAuthLikeFailure` is deliberately broader (it also covers "permission
 * denied for table …" / "row-level security policy" — schema problems that a
 * refresh cannot fix); this predicate is the narrow one.
 */
export function isSessionExpiryFailure(detail: string): boolean {
  const d = (detail || '').toLowerCase();
  return (
    d.includes('jwt expired') ||
    d.includes('invalid jwt') ||
    d.includes('token has expired') ||
    d.includes('token expired') ||
    d.includes('expired token') ||
    d.includes('invalid_grant') ||
    d.includes('refresh token') ||
    d.includes('no active session') ||
    d.includes('not authenticated') ||
    d.includes('missing access token') ||
    d.includes('auth session missing') ||
    d.includes('session missing') ||
    d.includes('failed to fetch from auth') || // auth server unreachable during refresh
    /\b401\b/.test(d)
  );
}

/**
 * True when a cloud-operation error message describes an authentication or
 * authorization rejection (JWT/session, RLS, table grants) rather than a
 * network hiccup or a data-shape problem. Used to log the right remediation
 * hint next to the exact server error.
 */
export function isAuthLikeFailure(message: string): boolean {
  const m = (message || '').toLowerCase();
  return (
    m.includes('invalid jwt') ||
    m.includes('jwt expired') ||
    m.includes('token') ||
    m.includes('unauthorized') ||
    m.includes('forbidden') ||
    m.includes('not authenticated') ||
    m.includes('no active session') ||
    m.includes('row-level security') ||
    m.includes('permission denied') ||
    m.includes('42501') ||
    m.includes('42503') ||
    /\b(401|403)\b/.test(m)
  );
}

/** True when a cloud-operation error message says the table itself is absent. */
export function isSchemaLikeFailure(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('does not exist') || m.includes('42p01') || m.includes('undefined table');
}

// ----------------------------------------------------------------------------
// Save status → UI state
// ----------------------------------------------------------------------------

export interface SaveUiState {
  /** True while a save is scheduled (debounce countdown) or in flight. */
  busy: boolean;
  /** True when the last save attempt failed and nothing is in flight. */
  failed: boolean;
  /** Label for the status pill: "Saving…", "All changes saved" or "Save failed". */
  label: string;
  /** Clock time of the last successful save, when known. */
  savedAtLabel: string | null;
}

export function formatSavedAt(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Derive the editor's status-pill UI from a SaveStatus. 'pending' (edits are
 * debounced, the save runs ~1.2s after the last change) and 'saving' (request
 * in flight) both render as "Saving…"; a cloud success shows "All changes
 * saved" with the time of the last save; a local-draft success shows
 * "SUCCESS (Local Draft)"; a failed attempt (local write itself failed) shows
 * "Save failed".
 */
export function getSaveUiState(
  status: SaveStatus,
  options: { busyOverride?: boolean; lastSavedAt?: number | null } = {}
): SaveUiState {
  const busy = !!options.busyOverride || status === 'saving' || status === 'pending';
  const failed = status === 'error' && !busy;
  const localDraft = !busy && !failed && status === 'saved_local';
  const savedAtLabel =
    !busy && !failed && !localDraft && options.lastSavedAt
      ? formatSavedAt(options.lastSavedAt)
      : null;
  const label = busy
    ? 'Saving…'
    : failed
    ? 'Save failed'
    : localDraft
    ? LOCAL_DRAFT_STATUS_LABEL
    : savedAtLabel
    ? `All changes saved · ${savedAtLabel}`
    : 'All changes saved';
  return { busy, failed, label, savedAtLabel };
}

// ----------------------------------------------------------------------------
// Local draft cache (localStorage `nexora_draft_salon_data`)
// ----------------------------------------------------------------------------
/**
 * Where pending salon state is cached when the cloud cannot take it:
 *   • the owner is unauthenticated (no Supabase session),
 *   • the app runs a local / free-tier mock session (Supabase not configured),
 *   • BOTH cloud paths failed (direct client sync + POST /api/website/save).
 *
 * The cache is a recovery net, not the primary store: the primary
 * `nexora_salon_state_v1` write (salonStore.saveSalonState) always runs first.
 * A successful cloud save clears this cache (runSalonSavePipeline).
 */
export const DRAFT_STORAGE_KEY = 'nexora_draft_salon_data';

export interface LocalDraftEnvelope {
  ownerId: string;
  profile: unknown;
  services: unknown[];
  stylists: unknown[];
  loyaltyConfig: unknown;
  savedAt: number;
}

/**
 * Cache the full draft state under `nexora_draft_salon_data`. Never throws —
 * quota errors degrade (inline images stripped) or are reported via the
 * returned result, never by crashing the save flow.
 */
export function writeLocalDraft(
  state: Omit<LocalDraftEnvelope, 'savedAt'> & { savedAt?: number }
): LocalStorageWriteResult {
  const savedAt = state.savedAt ?? Date.now();
  const envelope: LocalDraftEnvelope = { ...state, savedAt };
  const serialized = JSON.stringify(envelope);
  console.info('[autoSave:writeLocalDraft] Writing local draft envelope to localStorage["' + DRAFT_STORAGE_KEY + '"]...', {
    ownerId: state.ownerId,
    servicesCount: Array.isArray(state.services) ? state.services.length : 0,
    stylistsCount: Array.isArray(state.stylists) ? state.stylists.length : 0,
    hasLoyalty: !!state.loyaltyConfig,
    payloadBytes: serialized.length,
  });
  const result = safeWriteLocalStorage(DRAFT_STORAGE_KEY, serialized);
  if (result.ok) {
    console.info('[autoSave:writeLocalDraft] Local draft write SUCCESS:', {
      degraded: result.degraded,
      savedAt,
    });
  } else {
    console.error('[autoSave:writeLocalDraft] Local draft write FAILED:', {
      error: result.error,
    });
  }
  return result;
}

/** Remove a previously cached draft (called after a successful cloud save). */
export function clearLocalDraft(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existed = localStorage.getItem(DRAFT_STORAGE_KEY) !== null;
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (existed) {
      console.info('[autoSave:clearLocalDraft] Cleared stale local draft cache (localStorage["' + DRAFT_STORAGE_KEY + '"]) after cloud success.');
    }
  } catch (err) {
    console.warn('[Nexora Sync] Failed to clear the local draft cache:', describeError(err));
  }
}

/** True when a pending draft is currently cached on this device. */
export function hasLocalDraft(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(DRAFT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read a previously cached draft (recovery / diagnostics helper). */
export function loadLocalDraft(): LocalDraftEnvelope | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LocalDraftEnvelope) : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Server-side save fallback: POST /api/website/save (service role)
// ----------------------------------------------------------------------------
export interface ApiSaveResult {
  ok: boolean;
  /** HTTP status when the server answered (undefined on pure network failure). */
  status?: number;
  /** Exact error: the server's message (HTTP failure) or the network error. */
  error?: string;
  /** Server-side persistence timestamp from { success: true, timestamp }. */
  timestamp?: number;
}

export interface WebsiteApiOptions {
  /** Injectable for tests. Defaults to the global fetch (same-origin call). */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  /** Endpoint path. Defaults to '/api/website/save'. */
  path?: string;
  /**
   * The owner's current Supabase access token (session.access_token).
   * Sent as `Authorization: Bearer <token>` so the server can verify the
   * caller is really payload.ownerId (the endpoint is the auth boundary —
   * the service role bypasses RLS). Omitted in mock mode.
   */
  accessToken?: string;
}

/**
 * Fallback persistence path: POST the full salon state to the trusted
 * Express/Vercel server, which upserts it with the Supabase ADMIN (service
 * role) client — SUPABASE_SERVICE_ROLE_KEY — bypassing RLS safely.
 *
 * Every failure is logged with the exact HTTP status so network traces are
 * visible in DevTools immediately; the function never throws.
 */
export async function saveViaWebsiteApi(
  payload: SalonSyncPayload,
  options: WebsiteApiOptions = {}
): Promise<ApiSaveResult> {
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
  const path = options.path ?? '/api/website/save';

  console.info('[autoSave:saveViaWebsiteApi] Dispatching server API fallback request...', {
    path,
    ownerId: payload.ownerId,
    subdomain: payload.profile?.subdomain,
    businessName: payload.profile?.businessName,
    servicesCount: Array.isArray(payload.services) ? payload.services.length : 0,
    stylistsCount: Array.isArray(payload.stylists) ? payload.stylists.length : 0,
    hasAuthToken: !!options.accessToken,
    tokenPrefix: options.accessToken ? options.accessToken.slice(0, 12) + '…' : 'none',
  });

  if (!fetchImpl) {
    const message = `${path} cannot be called: fetch() is unavailable in this environment.`;
    console.error('[autoSave:saveViaWebsiteApi] FAILED — fetch unavailable:', message);
    return { ok: false, error: message };
  }

  const startTime = Date.now();
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }
    const res = await fetchImpl(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        salonData: {
          ownerId: payload.ownerId,
          profile: payload.profile,
          services: payload.services,
          stylists: payload.stylists,
          loyaltyConfig: payload.loyaltyConfig,
        },
      }),
    });

    const elapsedMs = Date.now() - startTime;
    let body: any = null;
    try {
      const rawText = await res.text();
      if (rawText && rawText.trim()) {
        try {
          body = JSON.parse(rawText);
        } catch {
          body = null;
        }
      }
    } catch {
      body = null;
    }

    if (res.ok && (body?.success === true || res.status === 204 || (!body && res.status >= 200 && res.status < 300))) {
      console.info(
        `[autoSave:saveViaWebsiteApi] SUCCESS via POST ${path} (HTTP ${res.status}, ${elapsedMs}ms) — ` +
          'service-role upsert persisted site state.',
        {
          status: res.status,
          elapsedMs,
          body,
        }
      );
      return { ok: true, status: res.status, timestamp: typeof body?.timestamp === 'number' ? body.timestamp : Date.now() };
    }

    const serverMessage =
      (body && typeof body.error === 'string' && body.error) ||
      (body ? `unexpected JSON body: ${JSON.stringify(body).slice(0, 200)}` : 'no JSON body');
    const message = `POST ${path} failed → HTTP ${res.status} ${res.statusText} (${elapsedMs}ms) | ${serverMessage}`;
    console.error('[autoSave:saveViaWebsiteApi] FAILED response:', {
      message,
      status: res.status,
      statusText: res.statusText,
      elapsedMs,
      body: body ?? null,
      table: 'profiles + services + stylists + loyalty_config + loyalty_rewards (server-side upsert)',
    });
    return { ok: false, status: res.status, error: serverMessage };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const message = `POST ${path} network failure after ${elapsedMs}ms: ${describeError(err)}`;
    console.error('[autoSave:saveViaWebsiteApi] NETWORK EXCEPTION:', {
      message,
      elapsedMs,
      error: err,
    });
    return { ok: false, error: describeError(err) };
  }
}

// ----------------------------------------------------------------------------
// Full save pipeline: client sync → API fallback → local draft
// ----------------------------------------------------------------------------

/** Deterministic data problems the service-role server CANNOT fix either. */
const DATA_SHAPE_PATTERNS: RegExp[] = [
  /invalid input syntax/i,
  /duplicate key|unique constraint/i,
  /not null constraint|violat\w* null/i,
  /value too long|invalid text representation/i,
  /check constraint/i,
  /must be a valid uuid/i,
  /type \"uuid\"/i,
];

/**
 * True when an error message is a deterministic data-shape rejection (bad
 * uuid, duplicate subdomain, not-null violation…) — problems that would fail
 * identically on the service-role server, so the API fallback is skipped.
 * Auth/RLS, network and missing-schema errors are NOT data-shape problems:
 * the service-role key fixes the first class and the server logs the rest.
 */
export function isDataShapeFailure(message: string): boolean {
  return DATA_SHAPE_PATTERNS.some((re) => re.test(message || ''));
}

export interface SalonSaveOutcome {
  /** True when the owner's progress is safely persisted somewhere. */
  ok: boolean;
  /** Where the state was finally persisted: cloud, service-role API, or local draft. */
  target: 'cloud' | 'api' | 'local_draft';
  /** True when the pending draft cache (nexora_draft_salon_data) now holds it. */
  draftWritten: boolean;
  /** Exact per-operation cloud errors (empty on a clean cloud success). */
  errors: string[];
  /** One-line human-readable summary (toast material). */
  summary: string;
}

export interface SalonSavePipelineOptions {
  /** False until this account's complete workspace has loaded; never replace cloud state before that. */
  workspaceReady?: boolean;
  /** The salon state to persist (SalonSyncPayload from salonSync.ts). */
  payload: SalonSyncPayload;
  /** Enable destructive (deleted-row) cleanup — only after a successful hydrate. */
  deleteRemoved?: boolean;
  /** Direct client-side Supabase sync (salonSync.syncSalonToSupabase). */
  sync: (
    payload: SalonSyncPayload,
    options: { deleteRemoved?: boolean }
  ) => Promise<SalonSyncResult>;
  /** Server-side fallback. Defaults to saveViaWebsiteApi (POST /api/website/save). */
  saveViaApi?: (payload: SalonSyncPayload) => Promise<ApiSaveResult>;
  /** Local draft writer. Defaults to writeLocalDraft (nexora_draft_salon_data). */
  writeDraft?: (state: {
    ownerId: string;
    profile: unknown;
    services: unknown[];
    stylists: unknown[];
    loyaltyConfig: unknown;
  }) => LocalStorageWriteResult;
  /** True when Supabase is not configured (local mock session / free tier). */
  isMockMode?: boolean;
  /** True when the client holds a live, valid session for payload.ownerId. */
  authenticated?: boolean;
  /**
   * The owner's live Supabase access token (session.access_token), forwarded
   * to POST /api/website/save as `Authorization: Bearer <token>` so the
   * server can prove the caller is payload.ownerId (identity binding — the
   * service-role endpoint bypasses RLS and must authorize itself).
   */
  accessToken?: string;
  /**
   * Refresh the caller's Supabase session and return the new access token.
   *
   * Called when the DIRECT client sync was rejected for an auth-like reason
   * (expired/revoked JWT, RLS/grants) — the service-role fallback is a second
   * round trip, so it must use a token that is still valid when it arrives.
   * Omitted by callers that have no auth client (tests, server-side runs).
   */
  refreshSession?: () => Promise<{ accessToken?: string; ok?: boolean } | void>;
}

/**
 * Orchestrates the whole auto-save / manual-save persistence chain so the
 * owner's progress can NEVER be lost and the editor is NEVER blocked:
 *
 *   0. Unauthenticated / local mock session / free tier without a linked
 *      project → store the draft in localStorage `nexora_draft_salon_data`
 *      and report SUCCESS (Local Draft). No crash, no blocking UI error.
 *   1. Direct Supabase client sync (`syncSalonToSupabase`) — the normal path.
 *   2. If that fails on network / auth / RLS / missing-schema errors, fall
 *      back automatically to `POST /api/website/save`, which upserts with the
 *      service-role key (bypasses RLS). Deterministic data-shape rejections
 *      (bad uuid, duplicate subdomain…) skip the API — they'd fail identically
 *      server-side.
 *   3. If BOTH fail, cache the pending changes in the local draft store so
 *      progress is never lost. The caller maps this to the SUCCESS (Local
 *      Draft) status and suppresses duplicate error popups during background
 *      typing (full diagnostics always go to the console).
 *
 * This function never throws.
 */
export async function runSalonSavePipeline(
  options: SalonSavePipelineOptions
): Promise<SalonSaveOutcome> {
  const { payload } = options;
  const sync = options.sync;
  // Default fallback forwards the owner's access token so the server can
  // bind the request to owner_id; a caller-injected saveViaApi (tests /
  // custom backends) is used as-is with the plain payload signature.
  // The token is re-read from a closure variable so an auth-blocked direct
  // sync can retry the fallback with a freshly refreshed token.
  let apiAccessToken = options.accessToken;
  const saveViaApi =
    options.saveViaApi ??
    ((p: SalonSyncPayload) => saveViaWebsiteApi(p, { accessToken: apiAccessToken }));
  const writeDraft = options.writeDraft ?? writeLocalDraft;

  console.info('[autoSave:runSalonSavePipeline] INITIATED save pipeline:', {
    ownerId: payload.ownerId,
    subdomain: payload.profile?.subdomain,
    businessName: payload.profile?.businessName,
    isMockMode: options.isMockMode,
    authenticated: options.authenticated,
    workspaceReady: options.workspaceReady,
    hasAccessToken: !!apiAccessToken,
    deleteRemoved: options.deleteRemoved,
  });

  const draftState = {
    ownerId: payload.ownerId,
    profile: payload.profile,
    services: payload.services,
    stylists: payload.stylists,
    loyaltyConfig: payload.loyaltyConfig,
  };

  const storeLocalDraft = (): { draftWritten: boolean; error?: string } => {
    console.info('[autoSave:runSalonSavePipeline] Executing local draft fallback store...');
    const result = writeDraft(draftState);
    if (result.ok) {
      console.info('[autoSave:runSalonSavePipeline] Local draft successfully written.');
      return { draftWritten: true };
    }
    const error = result.error || 'unknown localStorage error';
    console.error('[autoSave:runSalonSavePipeline] Local draft write failed:', {
      key: DRAFT_STORAGE_KEY,
      error,
    });
    return { draftWritten: false, error };
  };

  // ---- 0) Unauthenticated / mock session → clean local draft, no error ----
  if (options.isMockMode || !options.authenticated || options.workspaceReady === false) {
    console.info('[autoSave:runSalonSavePipeline] Pipeline Step 0 (Mock or Unauthenticated Mode):', {
      isMockMode: options.isMockMode,
      authenticated: options.authenticated,
      workspaceReady: options.workspaceReady,
    });
    const { draftWritten, error } = storeLocalDraft();
    if (!draftWritten) {
      return {
        ok: false,
        target: 'local_draft',
        draftWritten: false,
        errors: [`local storage: ${error}`],
        summary: 'Local draft could not be written (storage unavailable).',
      };
    }
    console.info(
      `[Nexora Sync] No cloud session (unauthenticated owner or local/mock Supabase session) — ` +
        `draft stored in localStorage["${DRAFT_STORAGE_KEY}"]. Save status: ${LOCAL_DRAFT_STATUS_LABEL}.`
    );
    return {
      ok: true,
      target: 'local_draft',
      draftWritten: true,
      errors: [],
      summary:
        options.authenticated && options.workspaceReady === false
          ? 'Saved on this device while your existing workspace loads. Cloud data has not been replaced.'
          : 'Saved as a local draft on this device — sign in to publish and sync to the cloud.',
    };
  }

  // Refresh the caller's session once, returning the new access token (or null
  // when the hook is absent / fails). Never throws: a failed refresh must not
  // mask the original save error.
  let sessionRefreshed = false;
  const refreshOnce = async (): Promise<string | null> => {
    if (!options.refreshSession) return null;
    try {
      console.info('[autoSave:runSalonSavePipeline] Refreshing caller session token...');
      const refreshed = await options.refreshSession();
      const token = refreshed && typeof refreshed === 'object' ? refreshed.accessToken : undefined;
      if (typeof token === 'string' && token) {
        console.info('[autoSave:runSalonSavePipeline] Session token refreshed successfully.');
        return token;
      }
      console.warn(
        '[Nexora Sync] Session refresh did not return an access token — continuing with the current one.'
      );
      return null;
    } catch (err) {
      console.warn('[Nexora Sync] Session refresh failed:', describeError(err));
      return null;
    }
  };

  // ---- 1) Direct Supabase client sync ------------------------------------
  console.info('[autoSave:runSalonSavePipeline] Step 1: Executing direct Supabase client sync (RPC / tables)...');
  let cloud: SalonSyncResult;
  try {
    cloud = await sync(payload, { deleteRemoved: options.deleteRemoved });
    console.info('[autoSave:runSalonSavePipeline] Step 1 direct sync completed:', {
      ok: cloud.ok,
      blockedByAuth: cloud.blockedByAuth,
      errorsCount: cloud.errors?.length || 0,
      errors: cloud.errors,
    });
  } catch (err) {
    // syncSalonToSupabase never throws — but a caller-injected sync could.
    // Never let a broken sync crash the whole save: degrade to local draft.
    const detail = describeError(err);
    console.error(
      '[autoSave:runSalonSavePipeline] Step 1 direct sync threw exception:',
      detail
    );
    cloud = { ok: false, errors: [`direct supabase sync threw: ${detail}`], blockedByAuth: false };
  }

  // ---- 1b) Session-expiry recovery for the DIRECT (table) write -----------
  // A rejected JWT is the one failure a refresh can fix: PostgREST refuses the
  // statement before any policy is consulted, so the owner sees a database
  // error for what is really a stale session. Refresh once and retry the SAME
  // sync with the fresh token before degrading to the service-role fallback.
  // Deterministic RLS/GRANT rejections are deliberately NOT retried.
  if (
    !cloud.ok &&
    !sessionRefreshed &&
    options.refreshSession &&
    cloud.errors.some((e) => isSessionExpiryFailure(e))
  ) {
    console.info('[autoSave:runSalonSavePipeline] Step 1b: Session expiry detected in direct sync errors, attempting refresh + retry...');
    const token = await refreshOnce();
    if (token) {
      sessionRefreshed = true;
      apiAccessToken = token;
      console.info('[autoSave:runSalonSavePipeline] Retrying direct sync with refreshed token...');
      try {
        const retried = await sync(payload, { deleteRemoved: options.deleteRemoved });
        console.info('[autoSave:runSalonSavePipeline] Retried direct sync outcome:', {
          ok: retried.ok,
          blockedByAuth: retried.blockedByAuth,
          errors: retried.errors,
        });
        cloud = retried.ok
          ? retried
          : {
              ok: false,
              errors: [...cloud.errors, ...retried.errors],
              blockedByAuth: retried.blockedByAuth ?? cloud.blockedByAuth,
            };
      } catch (err) {
        const detail = describeError(err);
        console.error('[autoSave:runSalonSavePipeline] Retried direct sync threw:', detail);
        cloud = { ok: false, errors: [...cloud.errors, detail], blockedByAuth: cloud.blockedByAuth };
      }
    }
  }

  if (cloud.ok) {
    console.info('[autoSave:runSalonSavePipeline] Step 1 SUCCESS: Direct cloud sync succeeded. Clearing local draft cache.');
    clearLocalDraft(); // the cloud now holds the state — drop any stale draft
    return {
      ok: true,
      target: 'cloud',
      draftWritten: false,
      errors: [],
      summary: 'Saved to the cloud.',
    };
  }

  // ---- 2) Fallback: server-side save via the service-role API ------------
  const onlyDataShapeFailures =
    cloud.errors.length > 0 && cloud.errors.every((e) => isDataShapeFailure(e));
  // Kept for the returned diagnostics: the fallback's own failure (HTTP status
  // + server message) is otherwise only visible in the console, which made an
  // expired-token 401 on the fallback look like a database error in the toast.
  let apiFailure: string | null = null;

  if (!onlyDataShapeFailures) {
    console.warn(
      '[autoSave:runSalonSavePipeline] Step 2: Direct client sync failed — invoking server-side fallback POST /api/website/save...',
      {
        cloudErrors: cloud.errors,
        blockedByAuth: cloud.blockedByAuth,
      }
    );
    // An auth-blocked direct sync usually means the access token went stale.
    // The fallback verifies the caller's token against Supabase Auth before it
    // writes, so send it a FRESH token: refresh once here instead of letting a
    // recoverable session be reported as a permission problem. Failures are
    // non-fatal — the original token is simply kept.
    if (cloud.blockedByAuth && !sessionRefreshed) {
      console.info('[autoSave:runSalonSavePipeline] Refreshing session before calling API fallback...');
      const token = await refreshOnce();
      if (token) {
        apiAccessToken = token;
        sessionRefreshed = true;
        console.info('[autoSave:runSalonSavePipeline] Refreshed session token attached for API fallback.');
      }
    }
    const api = await saveViaApi(payload);
    console.info('[autoSave:runSalonSavePipeline] Step 2 API fallback result:', {
      ok: api.ok,
      status: api.status,
      error: api.error || null,
      timestamp: api.timestamp || null,
    });
    if (api.ok) {
      console.info('[autoSave:runSalonSavePipeline] Step 2 SUCCESS: Server API fallback succeeded. Clearing local draft cache.');
      clearLocalDraft();
      return {
        ok: true,
        target: 'api',
        draftWritten: false,
        errors: cloud.errors, // preserved for the console; the save itself succeeded
        summary: 'Saved via the server (service role) after the direct sync failed.',
      };
    }
    // api.error is already console-logged with the exact HTTP status.
    apiFailure = `POST /api/website/save failed (HTTP ${api.status ?? 'no response'}) | ${api.error ?? 'unknown error'}`;
  } else {
    console.warn(
      '[autoSave:runSalonSavePipeline] Direct client sync failed with deterministic data errors — skipping API fallback and caching locally.',
      {
        cloudErrors: cloud.errors,
      }
    );
  }

  // ---- 3) Last resort: cache the pending draft (progress never lost) -----
  console.warn('[autoSave:runSalonSavePipeline] Step 3: All cloud paths failed — caching pending draft to local storage...');
  const { draftWritten, error } = storeLocalDraft();
  console.error('[Nexora Sync Error]:', {
    stage: 'all cloud save paths failed — changes cached as a local draft',
    draftKey: DRAFT_STORAGE_KEY,
    tables: 'profiles, services, stylists, loyalty_config, loyalty_rewards',
    authBlocked: cloud.blockedByAuth ?? false,
    cloudErrors: cloud.errors,
    apiFailure,
    localError: error ?? null,
  });
  return {
    ok: draftWritten,
    target: 'local_draft',
    draftWritten,
    errors: [...cloud.errors, ...(apiFailure ? [apiFailure] : []), ...(error ? [`local storage: ${error}`] : [])],
    summary: draftWritten
      ? 'Cloud save failed — your changes are safely cached on this device as a local draft and will retry automatically.'
      : 'Save failed — the cloud is unreachable and local storage is unavailable.',
  };
}
