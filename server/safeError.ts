// ============================================================================
// Safe JSON error responses shared by the Express and Vercel entrypoints.
//
// Route handlers log the detailed exception on the server, but the browser
// must never receive a raw database, auth, filesystem, or provider message.
// Raw exception text can contain SQL details, internal URLs, or credentials and
// makes serverless failures look like HTML FUNCTION_INVOCATION_FAILED pages.
// ============================================================================

import { isTransientDbError } from './dbGuard';

export interface SafeErrorInfo {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Detect when a Supabase / PostgREST query failed because the target table
 * does not exist in the database or schema cache.
 */
export function isMissingTableError(error: any, table?: string): boolean {
  if (!error) return false;
  const msg = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  // Postgres 42P01: undefined_table
  // PostgREST PGRST205: relation does not exist
  if (code === '42P01' || code === 'PGRST205') return true;
  if (
    msg.includes('in the schema cache') ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('could not find the table') ||
    (msg.includes('table') && msg.includes('does not exist'))
  ) {
    if (table) {
      const target = table.toLowerCase();
      return msg.includes(target) || !msg.includes('table');
    }
    return true;
  }
  return false;
}

function errorCode(error: any): string {
  return typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : 'unexpected_error';
}

function numericStatus(error: any): number | null {
  const value = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(value) && value >= 400 && value < 600 ? value : null;
}

/** Convert an unexpected exception into a small, stable, non-sensitive answer. */
export function classifySafeError(error: any, context = 'request'): SafeErrorInfo {
  const code = errorCode(error);
  const lowerCode = code.toLowerCase();
  const status = numericStatus(error);
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const transient =
    lowerCode === 'db_timeout' ||
    lowerCode === 'db_unreachable' ||
    lowerCode === 'auth_unavailable' ||
    isTransientDbError(error) ||
    /\b(fetch failed|network|timed? ?out|econn|enotfound|unavailable|bad gateway)\b/i.test(message);

  if (lowerCode === 'auth_required' || status === 401 || status === 403) {
    return {
      status: 401,
      code: 'auth_required',
      message: 'Please sign in again before continuing.',
      retryable: false,
    };
  }

  if (lowerCode === 'supabase_not_configured') {
    return {
      status: 503,
      code,
      message: 'The service is not configured on this server. Please try again later.',
      retryable: true,
    };
  }

  if (transient || status === 503 || status === 504) {
    return {
      status: 503,
      code: lowerCode === 'unexpected_error' ? 'service_unavailable' : code,
      message:
        context === 'database'
          ? 'The database is temporarily unavailable. Nothing was charged — please try again shortly.'
          : 'The service is temporarily unavailable. Please try again shortly.',
      retryable: true,
    };
  }

  // Preserve explicitly classified client statuses, but use a generic message
  // because an exception's own text is not a safe API contract.
  if (status && status >= 400 && status < 500) {
    return {
      status,
      code: code === 'unexpected_error' ? 'request_error' : code,
      message: 'The request could not be processed.',
      retryable: false,
    };
  }

  return {
    status: 500,
    code: code === 'unexpected_error' ? 'unexpected_error' : code,
    message: 'The server could not complete the request. Please try again.',
    retryable: false,
  };
}

/** Send a JSON error unless another middleware already ended the response. */
export function sendSafeError(
  res: any,
  error: any,
  options: { requestId?: string; context?: string; fallbackCode?: string; fallbackMessage?: string } = {}
): void {
  if (res?.headersSent || res?.writableEnded || res?.destroyed || res?.locals?.requestTimedOut) return;
  const info = classifySafeError(error, options.context);
  const body: Record<string, any> = {
    success: false,
    code: options.fallbackCode || info.code,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    error: options.fallbackMessage || info.message,
  };
  if (info.retryable) body.retryable = true;
  res.status(info.status).json(body);
}

/** Safe mapping for a Supabase/PostgREST error that a route already handled. */
export function safeDatabaseError(
  error: any,
  fallback = 'The database request could not be completed.'
): SafeErrorInfo {
  const info = classifySafeError(error, 'database');
  if (info.status === 503) return info;

  const code = errorCode(error);
  switch (code) {
    case '22P02':
      return { status: 400, code, message: 'One of the supplied values has an invalid format.', retryable: false };
    case '23502':
      return { status: 422, code, message: 'A required value was missing from the request.', retryable: false };
    case '23503':
      return { status: 422, code, message: 'The request refers to an account or salon that is not available.', retryable: false };
    case '23505':
      return { status: 409, code, message: 'This request has already been processed.', retryable: false };
    case '23514':
      return { status: 400, code, message: 'The supplied values were rejected by the database rules.', retryable: false };
    case '42501':
    case '401':
    case 'PGRST301':
      return { status: 503, code: 'database_not_configured', message: 'The database is not configured to accept this request. Please try again later.', retryable: true };
    case '42P01':
    case '42703':
    case 'PGRST204':
    case 'schema_mismatch':
      return { status: 503, code: 'database_schema_unavailable', message: 'The booking database needs an update before this request can be completed.', retryable: true };
    default:
      return { status: 500, code: code || 'db_error', message: fallback, retryable: false };
  }
}
