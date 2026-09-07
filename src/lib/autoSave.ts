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
// NOTE: `import type { ... } from './salonSync'` is type-only (erased at
// compile time), so this module stays a leaf of the runtime dependency graph
// even though the pipeline orchestrates salonSync.syncSalonToSupabase (the
// actual function is injected by the caller — see SalonSavePipelineOptions).
// ============================================================================

import type { SalonSyncPayload, SalonSyncResult } from './salonSync';

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
  const envelope: LocalDraftEnvelope = { ...state, savedAt: state.savedAt ?? Date.now() };
  return safeWriteLocalStorage(DRAFT_STORAGE_KEY, JSON.stringify(envelope));
}

/** Remove a previously cached draft (called after a successful cloud save). */
export function clearLocalDraft(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
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

  if (!fetchImpl) {
    const message = `${path} cannot be called: fetch() is unavailable in this environment.`;
    console.error('[Nexora Sync Error]:', message);
    return { ok: false, error: message };
  }

  try {
    const res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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

    const body: any = await res.json().catch(() => null);

    if (res.ok && body && body.success === true) {
      console.info(
        `[Nexora Sync] Server-side save succeeded via POST ${path} (HTTP ${res.status}) — ` +
          'the service-role upsert persisted the site state.'
      );
      return { ok: true, status: res.status, timestamp: typeof body.timestamp === 'number' ? body.timestamp : undefined };
    }

    const serverMessage =
      (body && typeof body.error === 'string' && body.error) ||
      (body ? `unexpected JSON body: ${JSON.stringify(body).slice(0, 200)}` : 'no JSON body');
    const message = `POST ${path} failed → HTTP ${res.status} ${res.statusText} | ${serverMessage}`;
    console.error('[Nexora Sync Error]:', message, {
      status: res.status,
      statusText: res.statusText,
      table: 'profiles + services + stylists + loyalty_config + loyalty_rewards (server-side upsert)',
      body: body ?? null,
    });
    return { ok: false, status: res.status, error: serverMessage };
  } catch (err) {
    const message = `POST ${path} network failure: ${describeError(err)}`;
    console.error('[Nexora Sync Error]:', message, { table: 'n/a (request never reached the server)' });
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
  const saveViaApi = options.saveViaApi ?? saveViaWebsiteApi;
  const writeDraft = options.writeDraft ?? writeLocalDraft;

  const draftState = {
    ownerId: payload.ownerId,
    profile: payload.profile,
    services: payload.services,
    stylists: payload.stylists,
    loyaltyConfig: payload.loyaltyConfig,
  };

  const storeLocalDraft = (): { draftWritten: boolean; error?: string } => {
    const result = writeDraft(draftState);
    if (result.ok) return { draftWritten: true };
    const error = result.error || 'unknown localStorage error';
    console.error('[Nexora Sync Error]:', `local draft write failed (key: ${DRAFT_STORAGE_KEY}): ${error}`);
    return { draftWritten: false, error };
  };

  // ---- 0) Unauthenticated / mock session → clean local draft, no error ----
  if (options.isMockMode || !options.authenticated) {
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
        'Saved as a local draft on this device — sign in to publish and sync to the cloud.',
    };
  }

  // ---- 1) Direct Supabase client sync ------------------------------------
  let cloud: SalonSyncResult;
  try {
    cloud = await sync(payload, { deleteRemoved: options.deleteRemoved });
  } catch (err) {
    // syncSalonToSupabase never throws — but a caller-injected sync could.
    // Never let a broken sync crash the whole save: degrade to local draft.
    const detail = describeError(err);
    console.error(
      '[Nexora Sync Error]:',
      `direct Supabase sync threw (tables: profiles, services, stylists, loyalty_config, loyalty_rewards): ${detail}`
    );
    cloud = { ok: false, errors: [`direct supabase sync threw: ${detail}`], blockedByAuth: false };
  }

  if (cloud.ok) {
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

  if (!onlyDataShapeFailures) {
    console.warn(
      '[Nexora Sync] Direct client sync failed (network/auth/RLS/schema) — ' +
        'falling back to POST /api/website/save (Supabase service role).'
    );
    const api = await saveViaApi(payload);
    if (api.ok) {
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
  } else {
    console.warn(
      '[Nexora Sync] Direct client sync failed with deterministic data errors — ' +
        'skipping the API fallback (it would fail identically) and caching locally.'
    );
  }

  // ---- 3) Last resort: cache the pending draft (progress never lost) -----
  const { draftWritten, error } = storeLocalDraft();
  console.error('[Nexora Sync Error]:', {
    stage: 'all cloud save paths failed — changes cached as a local draft',
    draftKey: DRAFT_STORAGE_KEY,
    tables: 'profiles, services, stylists, loyalty_config, loyalty_rewards',
    authBlocked: cloud.blockedByAuth ?? false,
    cloudErrors: cloud.errors,
    localError: error ?? null,
  });
  return {
    ok: draftWritten,
    target: 'local_draft',
    draftWritten,
    errors: [...cloud.errors, ...(error ? [`local storage: ${error}`] : [])],
    summary: draftWritten
      ? 'Cloud save failed — your changes are safely cached on this device as a local draft and will retry automatically.'
      : 'Save failed — the cloud is unreachable and local storage is unavailable.',
  };
}
