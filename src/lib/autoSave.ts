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

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

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
 * the most common root causes to actionable guidance.
 */
export function summarizeSaveError(detail: string): string {
  const d = (detail || '').toLowerCase();
  if (d.includes('subdomain') && (d.includes('duplicate key') || d.includes('unique constraint'))) {
    return 'This subdomain is already taken — please choose a different one.';
  }
  if (d.includes('invalid input syntax for type uuid')) {
    return 'Database rejected a record id (uuid mismatch).';
  }
  if (d.includes('row-level security') || d.includes('permission denied')) {
    return 'Database permission denied — please sign in again.';
  }
  if (d.includes('fetch failed') || d.includes('network') || d.includes('timeout')) {
    return 'Network error — could not reach the server.';
  }
  if (d.includes('hydration') || d.includes('could not load')) {
    return 'Could not load your existing data before saving — see console for details.';
  }
  const trimmed = (detail || '').trim();
  if (!trimmed) return 'Unknown error';
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
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
 * the time of the last save; a failed attempt shows "Save failed".
 */
export function getSaveUiState(
  status: SaveStatus,
  options: { busyOverride?: boolean; lastSavedAt?: number | null } = {}
): SaveUiState {
  const busy = !!options.busyOverride || status === 'saving' || status === 'pending';
  const failed = status === 'error' && !busy;
  const savedAtLabel =
    !busy && !failed && options.lastSavedAt ? formatSavedAt(options.lastSavedAt) : null;
  const label = busy
    ? 'Saving…'
    : failed
    ? 'Save failed'
    : savedAtLabel
    ? `All changes saved · ${savedAtLabel}`
    : 'All changes saved';
  return { busy, failed, label, savedAtLabel };
}
