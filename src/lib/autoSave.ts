// ============================================================================
// Auto-save engine helpers.
//
// Shared primitives used by the debounced auto-save in App.tsx:
//   • SaveStatus           — one status vocabulary for the whole app
//   • AUTOSAVE_DEBOUNCE_MS — debounce delay (1000–1500ms window)
//   • toDbId()             — deterministic, UUID-safe ids for Supabase rows
//   • describeError()      — exact, human-readable error extraction
//   • isRetriableError()   — network/transient vs deterministic DB failures
//   • withRetry()          — retry with exponential backoff + exact logging
//   • safeWriteLocalStorage() — quota-aware localStorage writes
//
// Resilience additions (Nexora saving-error repair):
//   • NEXORA_DRAFT_KEY        — localStorage fallback so progress is never lost
//   • WEBSITE_SAVE_ENDPOINT   — POST /api/website/save (service-role bypass)
//   • postWebsiteSave()       — RLS-bypass fallback when direct sync fails
//   • persistSalonWithFallbacks() — direct → website-API → local-draft chain
//   • shouldShowSaveError()   — suppresses duplicate toasts/modals while typing
//   • logNexoraSyncError()    — one diagnostic prefix for every sync failure
// ============================================================================

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
 * localStorage key for the crash-safe offline draft.
 *
 * Written whenever the cloud is unreachable (unauthenticated, RLS rejection,
 * network failure, both cloud paths failing) so user progress is never lost —
 * even if the tab is closed before the next successful cloud sync.
 */
export const NEXORA_DRAFT_KEY = 'nexora_draft_salon_data';

/** Server-side RLS-bypass save endpoint (uses the service-role key). */
export const WEBSITE_SAVE_ENDPOINT = '/api/website/save';

/** How long identical auto-save errors are suppressed (no modal/toast spam). */
export const SAVE_ERROR_DEDUPE_MS = 30000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'saved-local' | 'error';

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
  if (d.includes('subdomain is already taken')) {
    return 'This subdomain is already taken — please choose a different one.';
  }
  if (d.includes('invalid input syntax for type uuid')) {
    return 'Database rejected a record id (uuid mismatch).';
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
    return 'Database permission problem — please sign in again. If it persists, confirm the Supabase schema, RLS policies and grants (supabase/migrations, SUPABASE_SETUP.md) are applied.';
  }

  // 3) Missing schema/table — the SQL migrations were never applied to the
  // linked Supabase project (PostgREST: "relation … does not exist", 42P01).
  if (d.includes('does not exist') || d.includes('42p01') || d.includes('undefined table')) {
    return 'Database schema missing — apply supabase/migrations to your Supabase project (see SUPABASE_SETUP.md).';
  }

  // 4) Transient network/server problems — auto-retried with backoff; local
  // (device) persistence already succeeded, so no data is lost.
  if (
    d.includes('fetch failed') ||
    d.includes('network') ||
    d.includes('timeout') ||
    d.includes('econn') ||
    d.includes('service unavailable') ||
    d.includes('bad gateway') ||
    d.includes('gateway timeout') ||
    /\b(408|429|500|502|503|504)\b/.test(d)
  ) {
    return 'Network error — could not reach the database. Retrying automatically; your edits are kept on this device.';
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

/**
 * True when a cloud failure should resolve to SUCCESS (Local Draft) instead of
 * a blocking UI error: auth/RLS/session problems and transient network/server
 * failures. The draft is already cached locally, and the next edit (or manual
 * retry) re-attempts the cloud automatically.
 *
 * Deterministic, user-actionable failures — duplicate subdomain, uuid mismatch,
 * missing schema — return false so the caller still surfaces the exact remedy.
 */
export function isSilentLocalDraftFailure(message: string): boolean {
  const m = (message || '').toLowerCase();
  // User-actionable: must stay visible.
  if (isSchemaLikeFailure(message)) return false;
  if (m.includes('duplicate key') || m.includes('unique constraint')) return false;
  if (m.includes('subdomain is already taken')) return false;
  if (m.includes('invalid input syntax')) return false;
  if (m.includes('violates foreign key') || m.includes('violating foreign key')) return false;
  // Auth/RLS/session → silent local draft (re-login / retry later).
  if (isAuthLikeFailure(message)) return true;
  // Transient network/server → silent local draft (auto-retried later).
  if (
    m.includes('fetch failed') ||
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('econn') ||
    m.includes('socket') ||
    m.includes('aborted') ||
    m.includes('service unavailable') ||
    m.includes('internal server error') ||
    m.includes('bad gateway') ||
    m.includes('gateway timeout') ||
    m.includes('overloaded') ||
    m.includes('rate limit') ||
    m.includes('too many requests') ||
    /\b(408|429|500|502|503|504)\b/.test(m)
  ) {
    return true;
  }
  // Website-API transport wrapper messages inherit the same rule.
  if (m.includes('website save api')) {
    return true;
  }
  // Unknown cloud errors default to silent during background typing — the
  // exact cause is always in the console, and no progress is lost.
  return true;
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
 * in flight) both render as "Saving…"; success shows "All changes saved" with
 * the time of the last save; 'saved-local' shows the offline-draft variant;
 * a failed attempt shows "Save failed".
 */
export function getSaveUiState(
  status: SaveStatus,
  options: { busyOverride?: boolean; lastSavedAt?: number | null } = {}
): SaveUiState {
  const busy = !!options.busyOverride || status === 'saving' || status === 'pending';
  const failed = status === 'error' && !busy;
  const savedAtLabel =
    !busy && !failed && options.lastSavedAt ? formatSavedAt(options.lastSavedAt) : null;
  if (busy) {
    return { busy, failed: false, label: 'Saving…', savedAtLabel: null };
  }
  if (failed) {
    return { busy, failed, label: 'Save failed', savedAtLabel: null };
  }
  if (status === 'saved-local') {
    return {
      busy,
      failed,
      label: savedAtLabel ? `Saved locally · ${savedAtLabel}` : 'Saved locally (offline draft)',
      savedAtLabel,
    };
  }
  return {
    busy,
    failed,
    label: savedAtLabel ? `All changes saved · ${savedAtLabel}` : 'All changes saved',
    savedAtLabel,
  };
}

// ----------------------------------------------------------------------------
// Nexora sync diagnostics — one grep-able prefix for every failure.
// ----------------------------------------------------------------------------

export interface NexoraSyncErrorDetails {
  table?: string;
  status?: number | string;
  code?: string | number;
  operation?: string;
  [key: string]: unknown;
}

/**
 * Log a sync failure with the table name, HTTP status, error code and the
 * exact message. Grep DevTools for "[Nexora Sync Error]" to trace any save.
 * Returns the extracted message so callers can collect per-table errors.
 */
export function logNexoraSyncError(
  table: string,
  err: unknown,
  extra?: NexoraSyncErrorDetails
): string {
  const e = (
    err && typeof err === 'object' ? (err as Record<string, any>) : {}
  ) as Record<string, any>;
  const message = describeError(err);
  const status = e.status ?? e.statusCode ?? extra?.status ?? 'unknown';
  const code = e.code ?? extra?.code ?? 'unknown';
  const operation = extra?.operation ? ` operation=${extra.operation}` : '';
  console.error('[Nexora Sync Error]:', `table=${table}${operation} status=${status} code=${code} message=${message}`, err);
  return message;
}

// ----------------------------------------------------------------------------
// Local-draft fallback (crash-safe, quota-aware).
// ----------------------------------------------------------------------------

/** Serializable snapshot cached under NEXORA_DRAFT_KEY. */
export interface NexoraDraftState {
  ownerId?: string | null;
  subdomain?: string;
  profile?: unknown;
  services?: unknown[];
  stylists?: unknown[];
  loyaltyConfig?: unknown;
  selectedTemplateId?: unknown;
  /** Extra website-save payload (team members, gallery, branches…). */
  extras?: Record<string, unknown>;
  /** When the draft was cached (Date.now()). */
  savedAt: number;
  /** Which leg of the fallback chain wrote this draft. */
  source: 'direct-sync-fallback' | 'website-api-fallback' | 'offline-draft' | 'manual' | 'auto';
}

export type NexoraDraftInput = Omit<NexoraDraftState, 'savedAt'> & { savedAt?: number };

/**
 * Cache the pending salon state in localStorage under NEXORA_DRAFT_KEY.
 * Never throws; quota-aware (retries once without inline images).
 */
export function saveLocalDraftState(draft: NexoraDraftInput): LocalStorageWriteResult {
  const payload: NexoraDraftState = {
    ...draft,
    savedAt: draft.savedAt ?? Date.now(),
  };
  try {
    return safeWriteLocalStorage(NEXORA_DRAFT_KEY, JSON.stringify(payload));
  } catch (err) {
    const message = describeError(err);
    console.error('[Nexora Sync Error]:', `table=localStorage operation=saveLocalDraft status=unknown code=LOCAL_WRITE_FAILED message=${message}`, err);
    return { ok: false, error: message };
  }
}

/** Read the cached offline draft, or null when none exists / unparseable. */
export function loadLocalDraftState(): NexoraDraftState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(NEXORA_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NexoraDraftState;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error('[Nexora Sync Error]:', 'table=localStorage operation=loadLocalDraft message=failed to parse cached draft', err);
    return null;
  }
}

/** Best-effort removal of the cached draft (called after a cloud success). */
export function clearLocalDraftState(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(NEXORA_DRAFT_KEY);
  } catch (err) {
    console.error('[Nexora Sync Error]:', 'table=localStorage operation=clearLocalDraft message=failed to clear cached draft', err);
  }
}

/** True when a cached offline draft exists. */
export function hasLocalDraft(): boolean {
  return loadLocalDraftState() !== null;
}

// ----------------------------------------------------------------------------
// Website-save API fallback (POST /api/website/save).
// ----------------------------------------------------------------------------

/** Payload accepted by POST /api/website/save. */
export interface WebsiteSavePayloadInput {
  owner_id?: string | null;
  ownerId?: string | null;
  subdomain?: string;
  profile?: any;
  services?: any[];
  stylists?: any[];
  loyaltyConfig?: any;
  selectedTemplateId?: any;
  teamMembers?: any[];
  team_members?: any[];
  photoGallery?: any[];
  photo_gallery?: any[];
  branches?: any[];
  salon_branches?: any[];
  [key: string]: any;
}

export interface WebsiteSaveResult {
  ok: boolean;
  timestamp?: number;
  error?: string;
  status?: number;
}

/**
 * POST the salon state to the service-role save endpoint, which bypasses RLS
 * safely on the server. Used automatically when the direct Supabase sync fails
 * with a network/auth/RLS error.
 */
export async function postWebsiteSave(
  salonData: WebsiteSavePayloadInput,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<WebsiteSaveResult> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl) {
    const message = 'fetch is not available in this environment';
    console.error('[Nexora Sync Error]:', `table=website-save-api operation=POST ${WEBSITE_SAVE_ENDPOINT} status=unknown code=FETCH_UNAVAILABLE message=${message}`);
    return { ok: false, error: message };
  }
  let res: Response;
  try {
    res = await fetchImpl(WEBSITE_SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ salonData }),
      signal: options.signal,
    });
  } catch (err) {
    const message = describeError(err);
    console.error('[Nexora Sync Error]:', `table=website-save-api operation=POST ${WEBSITE_SAVE_ENDPOINT} status=network code=FETCH_FAILED message=${message}`, err);
    return { ok: false, error: message };
  }

  // Non-JSON bodies (proxy/HTML error pages) must not crash res.json().
  const contentType = res.headers?.get?.('content-type') || '';
  let body: any = null;
  let rawText = '';
  try {
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      rawText = await res.text().catch(() => '');
    }
  } catch (err) {
    const message = describeError(err);
    console.error('[Nexora Sync Error]:', `table=website-save-api operation=POST ${WEBSITE_SAVE_ENDPOINT} status=${res.status} code=BAD_RESPONSE message=unparseable response body: ${message}`, err);
    return { ok: false, status: res.status, error: `HTTP ${res.status}: unparseable response` };
  }

  if (!res.ok) {
    const serverMessage =
      (body && (body.error || body.details || body.message)) ||
      (rawText ? rawText.slice(0, 300) : '') ||
      `HTTP ${res.status} ${res.statusText || ''}`.trim();
    const detail = `HTTP ${res.status}: ${serverMessage}`;
    console.error('[Nexora Sync Error]:', `table=website-save-api operation=POST ${WEBSITE_SAVE_ENDPOINT} status=${res.status} code=HTTP_${res.status} message=${serverMessage}`, body ?? rawText);
    return { ok: false, status: res.status, error: detail };
  }

  if (!contentType.includes('application/json')) {
    console.error('[Nexora Sync Error]:', `table=website-save-api operation=POST ${WEBSITE_SAVE_ENDPOINT} status=${res.status} code=NON_JSON message=expected application/json but received "${contentType}"`, rawText.slice(0, 400));
    return { ok: false, status: res.status, error: 'Save endpoint returned a non-JSON response' };
  }

  if (body && body.success === false) {
    const serverMessage = body.error || body.details || 'Save endpoint reported failure';
    console.error('[Nexora Sync Error]:', `table=website-save-api operation=POST ${WEBSITE_SAVE_ENDPOINT} status=${res.status} code=SUCCESS_FALSE message=${serverMessage}`, body);
    return { ok: false, status: res.status, error: serverMessage };
  }

  return { ok: true, timestamp: body?.timestamp ?? Date.now() };
}

// ----------------------------------------------------------------------------
// Duplicate-error suppression (no modal/toast spam while typing).
// ----------------------------------------------------------------------------

let lastSaveErrorSignature = '';
let lastSaveErrorAt = 0;

/**
 * True when this error should surface to the user. Manual saves always show;
 * background auto-saves suppress repeats of the identical error inside the
 * throttle window so typing never spams modals/toasts.
 */
export function shouldShowSaveError(
  detail: string,
  options: { source?: 'auto' | 'manual'; throttleMs?: number } = {}
): boolean {
  if (options.source === 'manual') return true;
  const now = Date.now();
  const signature = (detail || '').trim().slice(0, 400);
  const windowMs = options.throttleMs ?? SAVE_ERROR_DEDUPE_MS;
  if (signature && signature === lastSaveErrorSignature && now - lastSaveErrorAt < windowMs) {
    return false;
  }
  lastSaveErrorSignature = signature;
  lastSaveErrorAt = now;
  return true;
}

/** Reset the dedupe memory (tests / explicit retry button). */
export function resetSaveErrorDedupe(): void {
  lastSaveErrorSignature = '';
  lastSaveErrorAt = 0;
}

// ----------------------------------------------------------------------------
// Full fallback chain: direct Supabase → website API → local draft.
// ----------------------------------------------------------------------------

/**
 * Direct-sync callback. Injected (instead of imported) so this module never
 * circular-imports salonSync — callers pass `() => syncSalonToSupabase(...)`.
 */
export type DirectSyncFn = () => Promise<{
  ok: boolean;
  errors: string[];
  localDraft?: boolean;
  persisted?: 'cloud' | 'local-draft' | 'none';
}>;

export interface PersistWithFallbacksOptions {
  /** Salon state forwarded to POST /api/website/save and the local draft. */
  salonData: WebsiteSavePayloadInput;
  /** First attempt: direct Supabase client sync. */
  directSync: DirectSyncFn;
  source?: 'auto' | 'manual';
  fetchImpl?: typeof fetch;
}

export interface PersistWithFallbacksResult {
  outcome: 'cloud-direct' | 'cloud-api' | 'local-draft' | 'failed';
  /** True when the user-facing save succeeded (cloud OR silent local draft). */
  ok: boolean;
  saveStatus: SaveStatus;
  errors: string[];
  timestamp?: number;
  localDraft: boolean;
  /** True when the caller should surface an error toast/modal. */
  shouldNotifyError: boolean;
}

/**
 * Persist with automatic fallbacks:
 *   1. Try the direct Supabase client sync.
 *   2. On network/auth/RLS failure, POST to /api/website/save (service-role).
 *   3. If both cloud paths fail, cache the pending changes in localStorage.
 *
 * Auth/network failures resolve to SUCCESS (Local Draft) with no blocking UI
 * error; deterministic failures (duplicate subdomain, uuid mismatch, missing
 * schema) still surface the exact remedy — with duplicate suppression during
 * background typing — while the draft keeps the progress safe.
 */
export async function persistSalonWithFallbacks(
  options: PersistWithFallbacksOptions
): Promise<PersistWithFallbacksResult> {
  const source = options.source ?? 'auto';
  const salonData = options.salonData ?? {};

  // -- 1) Direct Supabase client sync -------------------------------------
  let directErrors: string[] = [];
  try {
    const direct = await options.directSync();
    if (direct.ok && !direct.localDraft) {
      clearLocalDraftState();
      return {
        outcome: 'cloud-direct',
        ok: true,
        saveStatus: 'saved',
        errors: [],
        timestamp: Date.now(),
        localDraft: false,
        shouldNotifyError: false,
      };
    }
    directErrors = Array.isArray(direct.errors) ? direct.errors : [];
    if (direct.ok && direct.localDraft) {
      // Direct layer already fell back to a draft (unauthenticated / mock).
      // Without an owner id the website API cannot help (it validates
      // owner_id), so settle as a local draft immediately.
      const ownerId =
        salonData.owner_id ?? salonData.ownerId ?? (salonData.profile as any)?.ownerId ?? null;
      if (!ownerId) {
        return {
          outcome: 'local-draft',
          ok: true,
          saveStatus: 'saved-local',
          errors: directErrors,
          timestamp: Date.now(),
          localDraft: true,
          shouldNotifyError: false,
        };
      }
      logNexoraSyncError(
        'direct-sync',
        directErrors.join(' · ') || 'direct sync fell back to a local draft',
        { operation: 'directSync-localDraft' }
      );
    } else {
      logNexoraSyncError('direct-sync', directErrors.join(' · ') || 'direct sync failed', {
        operation: 'directSync',
      });
    }
  } catch (err) {
    const message = describeError(err);
    directErrors = [message];
    logNexoraSyncError('direct-sync', err, { operation: 'directSync-throw' });
  }

  // -- 2) Website-save API fallback (service-role, bypasses RLS) -----------
  let apiError = '';
  let apiStatus: number | undefined;
  try {
    const api = await postWebsiteSave(salonData, { fetchImpl: options.fetchImpl });
    if (api.ok) {
      clearLocalDraftState();
      return {
        outcome: 'cloud-api',
        ok: true,
        saveStatus: 'saved',
        errors: [],
        timestamp: api.timestamp ?? Date.now(),
        localDraft: false,
        shouldNotifyError: false,
      };
    }
    apiError = api.error || 'website save API failed';
    apiStatus = api.status;
  } catch (err) {
    apiError = describeError(err);
    logNexoraSyncError('website-save-api', err, { operation: 'postWebsiteSave-throw' });
  }

  // -- 3) Local-draft fallback (progress is never lost) ---------------------
  const allErrors = [...directErrors];
  if (apiError) {
    allErrors.push(
      `website save API${apiStatus ? ` (HTTP ${apiStatus})` : ''}: ${apiError}`
    );
  }
  const joined = allErrors.join(' · ');
  const draftWrite = saveLocalDraftState({
    ownerId: (salonData.owner_id ?? salonData.ownerId ?? (salonData.profile as any)?.ownerId ?? null) as string | null,
    subdomain: salonData.subdomain ?? (salonData.profile as any)?.subdomain,
    profile: salonData.profile,
    services: salonData.services,
    stylists: salonData.stylists,
    loyaltyConfig: salonData.loyaltyConfig,
    selectedTemplateId: salonData.selectedTemplateId,
    extras: {
      teamMembers: salonData.teamMembers ?? salonData.team_members,
      photoGallery: salonData.photoGallery ?? salonData.photo_gallery,
      branches: salonData.branches ?? salonData.salon_branches,
    },
    source: source === 'manual' ? 'manual' : 'auto',
  });

  if (!draftWrite.ok) {
    const detail = [joined, `local draft: ${draftWrite.error}`].filter(Boolean).join(' · ');
    logNexoraSyncError('localStorage', draftWrite.error || 'local draft write failed', {
      operation: 'saveLocalDraft',
    });
    return {
      outcome: 'failed',
      ok: false,
      saveStatus: 'error',
      errors: [detail || 'Save failed'],
      localDraft: false,
      shouldNotifyError: shouldShowSaveError(detail || 'Save failed', { source }),
    };
  }

  if (draftWrite.degraded) {
    console.warn(
      '[AutoSave] Local draft saved without inline images (quota):',
      draftWrite.error
    );
  }

  // Silent local draft for auth/network; loud error for deterministic causes.
  if (isSilentLocalDraftFailure(joined)) {
    return {
      outcome: 'local-draft',
      ok: true,
      saveStatus: 'saved-local',
      errors: allErrors,
      timestamp: Date.now(),
      localDraft: true,
      shouldNotifyError: false,
    };
  }
  return {
    outcome: 'local-draft',
    ok: false,
    saveStatus: 'error',
    errors: allErrors,
    timestamp: Date.now(),
    localDraft: true,
    shouldNotifyError: shouldShowSaveError(joined || 'Save failed', { source }),
  };
}
