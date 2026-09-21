// ============================================================================
// Safe JSON error responses shared by the Express and Vercel entrypoints.
//
// Route handlers log the detailed exception on the server, but the browser
// must never receive a raw database, auth, filesystem, or provider message.
// Raw exception text can contain SQL details, internal URLs, or credentials and
// makes serverless failures look like HTML FUNCTION_INVOCATION_FAILED pages.
// ============================================================================

import { isTransientDbError } from './dbGuard.js';

export interface SafeErrorInfo {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Semantic error constructors — every one of these throws an Error whose
 * `status` and `code` classifySafeError() will translate into the correct HTTP
 * response. They replace the old "catch { res.json({success:false}) }" pattern
 * that accidentally returned HTTP 200 for failed mutations.
 *
 *   400 validation          -> ApiValidationError     (bad input / shape)
 *   401 unauthenticated     -> ApiUnauthenticatedError (missing/invalid session)
 *   403 unauthorized        -> ApiForbiddenError      (authenticated but no permission)
 *   404 not found           -> ApiNotFoundError
 *   409 conflict            -> ApiConflictError       (duplicate slug/email/already done)
 *   422 invalid state       -> ApiInvalidStateError   (valid payload, wrong resource state)
 *   500 unexpected          -> ApiServerError         (caught bugs / unknown)
 *   503 unavailable         -> ApiUnavailableError    (DB/downstream unavailable, retryable)
 */
export class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown> | null;
  constructor(status: number, message: string, code = 'request_error', retryable = false, details?: Record<string, unknown> | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details ?? null;
  }
}

export class ApiValidationError extends ApiError {
  constructor(message = 'Invalid request.', details?: Record<string, unknown> | null) {
    super(400, message, 'validation_error', false, details);
    this.name = 'ApiValidationError';
  }
}
export class ApiUnauthenticatedError extends ApiError {
  constructor(message = 'Authentication required.') {
    super(401, message, 'auth_required', false);
    this.name = 'ApiUnauthenticatedError';
  }
}
export class ApiForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, message, 'forbidden', false);
    this.name = 'ApiForbiddenError';
  }
}
export class ApiNotFoundError extends ApiError {
  constructor(message = 'Resource not found.') {
    super(404, message, 'not_found', false);
    this.name = 'ApiNotFoundError';
  }
}
export class ApiConflictError extends ApiError {
  constructor(message = 'Request conflicts with existing resource state.', code = 'conflict') {
    super(409, message, code, false);
    this.name = 'ApiConflictError';
  }
}
export class ApiInvalidStateError extends ApiError {
  constructor(message = 'Resource is not in a state that allows this operation.', details?: Record<string, unknown> | null) {
    super(422, message, 'invalid_state', false, details);
    this.name = 'ApiInvalidStateError';
  }
}
export class ApiUnavailableError extends ApiError {
  constructor(message = 'The service is temporarily unavailable. Please try again shortly.', code = 'service_unavailable') {
    super(503, message, code, true);
    this.name = 'ApiUnavailableError';
  }
}
export class ApiServerError extends ApiError {
  constructor(message = 'An unexpected server error occurred.', cause?: unknown) {
    super(500, message, 'unexpected_error', false);
    this.name = 'ApiServerError';
    if (cause) this.cause = cause as Error;
  }
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

/**
 * Detect when a Supabase / PostgREST query failed because a column does not exist.
 */
export function isMissingColumnError(error: any, column?: string): boolean {
  if (!error) return false;
  const msg = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  // Postgres 42703: undefined_column
  // PostgREST PGRST204: column not found in schema cache
  if (code === '42703' || code === 'PGRST204') return true;
  if (msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
    if (column) {
      return msg.includes(column.toLowerCase());
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
  // Our own typed API errors are authoritative — honor their status/code/message.
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      retryable: !!error.retryable,
    };
  }
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

  // 401 / 403 both signal auth problems; use 403 explicitly when thrown.
  if (lowerCode === 'auth_required' || status === 401) {
    return { status: 401, code: 'auth_required', message: 'Please sign in again before continuing.', retryable: false };
  }
  if (status === 403) {
    return { status: 403, code: 'forbidden', message: 'You do not have permission to perform this action.', retryable: false };
  }
  if (status === 404 || lowerCode === 'not_found') {
    return { status: 404, code: 'not_found', message: 'The requested resource was not found.', retryable: false };
  }
  if (status === 409 || lowerCode === 'conflict' || lowerCode === 'already_exists') {
    return { status: 409, code: lowerCode === 'unexpected_error' ? 'conflict' : code, message: 'This request conflicts with the current state of the resource.', retryable: false };
  }
  if (status === 422 || lowerCode === 'invalid_state' || lowerCode === 'unprocessable') {
    return { status: 422, code: lowerCode === 'unexpected_error' ? 'invalid_state' : code, message: 'The request could not be completed in the current resource state.', retryable: false };
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
  // because an exception's own text is not a safe API contract — EXCEPT for
  // our typed ApiError which was already handled above.
  if (status && status >= 400 && status < 500) {
    return {
      status,
      code: code === 'unexpected_error' ? `http_${status}` : code,
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

/** Send a JSON error unless another middleware already ended the response.
 *  If the error is an ApiError, its `details` field is forwarded as well so
 *  validation errors can carry a per-field map for the UI.
 */
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
  // Forward ApiError.details (field-level validation errors, etc.) when present.
  if (error instanceof ApiError && error.details && Object.keys(error.details).length) {
    body.details = error.details;
  }
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
