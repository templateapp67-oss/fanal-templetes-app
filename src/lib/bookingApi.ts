// ============================================================================
// Booking save client — POST /api/bookings/create with retries and a readable
// failure reason.
//
// WHY: the checkout used to show a dead end —
//     "We couldn't save your booking (Server error (HTTP 500))"
// — whenever the API answered anything that was not parseable JSON. That
// happens for exactly the failures the customer can do nothing about: a
// serverless cold start that crashed, a platform timeout page, a proxy 502.
// This module:
//   • retries transient faults (network error, 429, 5xx) before giving up,
//   • surfaces the server's `error` + `code` + `requestId` when present,
//   • falls back to the HTTP status *plus a snippet of the body* so an HTML
//     error page is still diagnosable instead of an opaque number,
//   • distinguishes "server said no" (never retry, show the reason) from
//     "we could not reach the server at all" (keep the local copy, warn).
// ============================================================================

/**
 * A single, non-discriminated shape: this project compiles without
 * `strictNullChecks`, where TypeScript cannot narrow a discriminated union, so
 * a flat result keeps every consumer type-safe.
 */
export interface BookingSaveOutcome {
  /** True only when the salon's database accepted the booking. */
  ok: boolean;
  /**
   * success  → stored.
   * rejected → the server understood and refused (4xx): show the reason.
   * server   → the server failed (5xx / unparseable): retried, still failing.
   * offline  → no HTTP response at all (offline, DNS, sandbox with no API).
   */
  kind: 'success' | 'rejected' | 'server' | 'offline';
  /** Human-readable failure reason (empty on success). */
  detail: string;
  /** Machine-readable server code, e.g. `owner_unresolved`, `db_timeout`. */
  code?: string;
  /** Server-side correlation id to quote in a support message. */
  requestId?: string;
  /** Whether trying again later could succeed. */
  retryable: boolean;
  status?: number;
  data?: any;
  attempts: number;
}

export interface PostBookingOptions {
  url?: string;
  /** Total attempts, including the first one. */
  maxAttempts?: number;
  /** Base delay between attempts (doubles each retry). */
  retryDelayMs?: number;
  /** Per-attempt network timeout. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Trim an HTML/text error body down to something readable in a toast. */
export function summarizeBody(text: string): string {
  const stripped = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return '';
  return stripped.length > 140 ? `${stripped.slice(0, 137)}…` : stripped;
}

/** True for failures that are worth retrying automatically. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function postBookingWithRetry(
  body: string,
  options: PostBookingOptions = {}
): Promise<BookingSaveOutcome> {
  const {
    url = '/api/bookings/create',
    maxAttempts = 3,
    retryDelayMs = 600,
    timeoutMs = 20000,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
    sleepImpl = defaultSleep,
  } = options;

  if (!fetchImpl) {
    return {
      ok: false,
      kind: 'offline',
      detail: 'No network client available.',
      retryable: true,
      attempts: 0,
    };
  }

  let lastFailure: BookingSaveOutcome = {
    ok: false,
    kind: 'offline',
    detail: 'The booking service could not be reached.',
    retryable: true,
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let controller: AbortController | null = null;
    let timer: any = null;
    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timer = setTimeout(() => controller?.abort(), timeoutMs);
      }

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller?.signal,
      });
      if (timer) clearTimeout(timer);

      const text = await response.text().catch(() => '');
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null; // HTML error page / truncated body
      }

      if (response.ok && (!json || json.success !== false)) {
        return {
          ok: true,
          kind: 'success',
          detail: '',
          retryable: false,
          status: response.status,
          data: json?.data ?? null,
          requestId: json?.requestId,
          attempts: attempt,
        };
      }

      const serverDetail: string =
        json?.error ||
        json?.notice ||
        (text && !json ? `HTTP ${response.status} ${response.statusText || ''} — ${summarizeBody(text)}`.trim() : '') ||
        `Server error (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''})`;

      const retryable = json?.retryable === true || isRetryableStatus(response.status);

      lastFailure = {
        ok: false,
        kind: response.status >= 500 || !json ? 'server' : 'rejected',
        detail: serverDetail,
        code: json?.code,
        requestId: json?.requestId,
        retryable,
        status: response.status,
        attempts: attempt,
      };

      // A 4xx is the customer's payload: retrying cannot change the answer.
      if (!retryable) return lastFailure;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      const aborted = err?.name === 'AbortError';
      lastFailure = {
        ok: false,
        kind: 'offline',
        detail: aborted
          ? `The booking service did not answer within ${Math.round(timeoutMs / 1000)}s.`
          : err?.message || 'Network request failed.',
        retryable: true,
        attempts: attempt,
      };
    }

    if (attempt < maxAttempts) {
      await sleepImpl(retryDelayMs * attempt);
    }
  }

  return lastFailure;
}
