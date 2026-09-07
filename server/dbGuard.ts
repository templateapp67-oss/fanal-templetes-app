// ============================================================================
// Database call guards — timeouts, retries and request ids.
//
// WHY: a Supabase/PostgREST call that never answers (DNS blackhole, project
// paused, connection pool exhausted, egress firewall) used to hang the booking
// handler forever. On a serverless platform the *platform* then kills the
// invocation and answers with its own HTML error page — no JSON, no `error`
// field — which the checkout could only report as the opaque
// "Server error (HTTP 500)". Locally reproduced: with a Supabase stub that
// never responds, POST /api/bookings/create hung for >20s with no reply.
//
// Every database call on a customer-facing path now runs through `runDb()`:
//   • hard timeout (default 8s) -> a typed, catchable error,
//   • one automatic retry for *transient* faults (network reset, 5xx, timeout),
//   • never throws out of the caller's control flow: it resolves to the same
//     `{ data, error }` shape Supabase uses, so handlers stay simple.
// ============================================================================

export class DbTimeoutError extends Error {
  readonly code = 'db_timeout';
  constructor(
    readonly label: string,
    readonly timeoutMs: number
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'DbTimeoutError';
  }
}

// Budgets are tuned so the API always answers with JSON *before* a serverless
// platform hits its own invocation limit (10s on several hosting free tiers)
// and replies with an un-parseable HTML error page.
/** Default budget for a single database round-trip. */
export const DEFAULT_DB_TIMEOUT_MS = Number(process.env.DB_TIMEOUT_MS || 6000);
/** Shorter budget for "nice to have" lookups (owner resolution, notifications). */
export const LOOKUP_DB_TIMEOUT_MS = Number(process.env.DB_LOOKUP_TIMEOUT_MS || 4000);
/** Hard ceiling for a whole API request before we answer 504 ourselves. */
export const API_REQUEST_TIMEOUT_MS = Number(process.env.API_REQUEST_TIMEOUT_MS || 9000);

export interface DbResult<T = any> {
  data: T | null;
  error: any;
  /** True when the value came from a timeout rather than the database. */
  timedOut?: boolean;
  /** How many attempts were made (1 = no retry). */
  attempts?: number;
  /** Wall-clock duration of the whole call, including retries. */
  durationMs?: number;
}

/**
 * Race a promise (or Supabase thenable) against a timeout.
 * Rejects with `DbTimeoutError` when the budget is exhausted.
 */
export function withDbTimeout<T>(
  work: PromiseLike<T>,
  label: string,
  timeoutMs: number = DEFAULT_DB_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DbTimeoutError(label, timeoutMs));
    }, timeoutMs);
    // NOTE: deliberately NOT unref()'d — the timer must keep the event loop
    // alive until the race settles, otherwise a short-lived process (tests, a
    // serverless invocation) can exit with the request still pending.

    Promise.resolve(work).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Faults that are worth retrying once (as opposed to a real data error). */
export function isTransientDbError(error: any): boolean {
  if (!error) return false;
  if (error instanceof DbTimeoutError) return true;
  const code = String(error.code ?? '');
  const message = String(error.message ?? error).toLowerCase();
  if (code === 'db_timeout' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED') return true;
  if (code === 'UND_ERR_SOCKET' || code === 'EAI_AGAIN' || code === 'ENOTFOUND') return true;
  // supabase-js surfaces network faults as `TypeError: fetch failed`
  if (message.includes('fetch failed') || message.includes('socket') || message.includes('network')) return true;
  if (message.includes('timeout') || message.includes('timed out')) return true;
  // PostgREST/Cloudflare gateway hiccups
  if (/\b(502|503|504)\b/.test(message) || message.includes('bad gateway') || message.includes('unavailable')) {
    return true;
  }
  return false;
}

export interface RunDbOptions {
  label: string;
  timeoutMs?: number;
  /** Retry a transient failure once (default true). */
  retry?: boolean;
  /** Delay before the retry (ms, default 250). */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute a Supabase query builder (or any thenable returning `{data, error}`)
 * with a timeout and one transient retry. NEVER throws — the timeout/exception
 * is normalized into the `error` field so callers keep a single code path.
 *
 * `build` is a *factory* because a Supabase query builder can only be awaited
 * once; a retry needs a fresh builder.
 */
export async function runDb<T = any>(
  build: () => PromiseLike<{ data: T | null; error: any }>,
  options: RunDbOptions
): Promise<DbResult<T>> {
  const { label, timeoutMs = DEFAULT_DB_TIMEOUT_MS, retry = true, retryDelayMs = 250 } = options;
  const startedAt = Date.now();
  const maxAttempts = retry ? 2 : 1;
  let lastError: any = null;
  let timedOut = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await withDbTimeout(build(), label, timeoutMs);
      const error = (result as any)?.error ?? null;
      if (error && isTransientDbError(error) && attempt < maxAttempts) {
        lastError = error;
        console.warn(`[DB] ${label} attempt ${attempt} failed transiently (${error.message || error}); retrying…`);
        await sleep(retryDelayMs);
        continue;
      }
      return {
        data: (result as any)?.data ?? null,
        error,
        timedOut: false,
        attempts: attempt,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      lastError = err;
      timedOut = err instanceof DbTimeoutError;
      if (isTransientDbError(err) && attempt < maxAttempts) {
        console.warn(`[DB] ${label} attempt ${attempt} threw (${err?.message || err}); retrying…`);
        await sleep(retryDelayMs);
        continue;
      }
      break;
    }
  }

  const normalized =
    lastError instanceof DbTimeoutError
      ? {
          code: 'db_timeout',
          message: `The database did not respond within ${timeoutMs}ms (${label}).`,
          details: lastError.message,
        }
      : {
          code: lastError?.code || 'db_unreachable',
          message: lastError?.message || String(lastError || 'Unknown database failure'),
          details: lastError?.details || lastError?.stack || undefined,
        };

  console.error(`[DB] ${label} failed after ${Date.now() - startedAt}ms:`, normalized.message);

  return {
    data: null,
    error: normalized,
    timedOut,
    attempts: maxAttempts,
    durationMs: Date.now() - startedAt,
  };
}

/** Short, sortable id used to correlate a customer-visible error with a log line. */
export function newRequestId(prefix = 'req'): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}${rand}`;
}

/**
 * Express middleware: guarantee that a route answers within `ms`, with JSON.
 * Without it, a stuck handler is killed by the hosting platform, which replies
 * with an HTML error page the SPA cannot parse ("Server error (HTTP 500)").
 */
export function withRequestTimeout(ms: number, message?: string) {
  return function requestTimeoutMiddleware(req: any, res: any, next: any) {
    if (res.headersSent) return next();
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      const requestId = res.locals?.requestId || newRequestId();
      console.error(`[API] ${req.method} ${req.originalUrl || req.url} exceeded ${ms}ms — answering 504 (${requestId}).`);
      res.status(504).json({
        success: false,
        code: 'request_timeout',
        requestId,
        error:
          message ||
          'The server took too long to respond. Nothing was charged. Please try again in a moment.',
      });
    }, ms);
    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}
