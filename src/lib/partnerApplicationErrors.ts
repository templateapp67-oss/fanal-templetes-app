// ============================================================================
// Growth Partner application — error classification.
//
// The bug this file fixes: `submitGrowthPartnerApplication` used to throw one
// fixed sentence for EVERY failure, and the page then replaced it with another
// fixed sentence — so the user always saw "Application failed. Please try
// again." no matter whether the real problem was an invalid Aadhaar number, a
// duplicate application, an expired session, a missing migration or a dropped
// connection.
//
// Every failure is now mapped to a `kind` the UI can act on (offer sign-in,
// mark a field, show the pending state, ask for a retry) plus exact, reviewed
// copy. Raw database/driver text is never shown: only messages in the allowlist
// below (or a deliberately written generic one) reach the screen.
// ============================================================================

/** Why a submission failed. The UI branches on this, not on the message text. */
export type PartnerApplicationErrorKind =
  /** No live session / expired JWT — prompt or redirect to sign in. */
  | 'session'
  /** A field is wrong — mark the field, do not lose the typed values. */
  | 'validation'
  /** This user (or this KYC number) already has an application (HTTP 409). */
  | 'duplicate'
  /** Already approved: nothing to submit, open the dashboard instead. */
  | 'approved'
  /** Transport failure — retry is meaningful. */
  | 'network'
  /** The backend object is absent (migration not applied) — retry is useless. */
  | 'schema'
  | 'rate-limit'
  | 'suspended'
  /** Recognized as a failure, but not attributable — honest generic copy. */
  | 'unknown';

/** Exact, reviewed UI copy. Nothing else may be rendered. */
export const PARTNER_APPLICATION_ERROR_MESSAGES = {
  session: 'Your session expired. Please sign in again.',
  duplicate: 'You have already submitted an application.',
  duplicateKyc: 'That KYC document is already registered. Check the number and try again.',
  approved: 'Your Growth Partner application is already approved. Sign in to open your dashboard.',
  network: 'Network error. Check your connection and try again.',
  schema:
    'Partner applications are not set up on this project yet. Apply supabase/migrations/20261030000000_partner_applications_hardening.sql, then try again.',
  rateLimit: 'Too many attempts. Please wait a moment and try again.',
  suspended: 'Your account is suspended. Contact support for help.',
  unavailable: 'Applications are unavailable right now. Please try again later.',
  kycStatusSchema: 'Partner application setup needs an update. Please contact support and try again after it is fixed.',
  unknown: 'We could not submit your application. Please try again.',
} as const;

/**
 * Server messages that are safe to show verbatim. They are raised by the
 * hardened RPC (`22023` = invalid parameter value), so they name a field and a
 * fix — never a table, a policy or a SQL detail.
 */
const SERVER_VALIDATION_MESSAGES = new Set([
  'Full name is required',
  'Enter your full name as it appears on your KYC document',
  'Select a valid KYC document type',
  'KYC document reference is required',
  'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card',
  'Invalid PAN. Enter it as ABCDE1234F',
  'Invalid passport number. Use 6-20 letters or digits',
  'Invalid driving licence number. Use 6-20 letters or digits',
  'Invalid business registration number. Use 6-20 letters or digits',
  'Enter a valid 10-digit mobile number',
]);

/** A failure classified into a kind the UI can act on. */
export class PartnerApplicationError extends Error {
  readonly kind: PartnerApplicationErrorKind;
  /** Postgres SQLSTATE or PostgREST code, when the backend supplied one. */
  readonly code?: string;
  /** HTTP status, when the client supplied one. */
  readonly status?: number;
  /** The field the message belongs to, for validation failures. */
  readonly field?: 'fullName' | 'phone' | 'kycDocumentType' | 'kycDocumentReference';

  constructor(
    kind: PartnerApplicationErrorKind,
    message: string,
    options: {
      code?: string;
      status?: number;
      field?: PartnerApplicationError['field'];
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PartnerApplicationError';
    this.kind = kind;
    this.code = options.code;
    this.status = options.status;
    this.field = options.field;
  }
}

/** True when `error` is already a classified application failure. */
export function isPartnerApplicationError(error: unknown): error is PartnerApplicationError {
  return error instanceof PartnerApplicationError;
}

function text(error: unknown): string {
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Which field a backend validation message refers to, when we can tell. */
function fieldFor(message: string): PartnerApplicationError['field'] | undefined {
  if (/full name/i.test(message)) return 'fullName';
  if (/mobile number|phone/i.test(message)) return 'phone';
  if (/aadhaar|pan\b|passport|driving licence|driving license|business registration/i.test(message)) {
    return 'kycDocumentReference';
  }
  if (/KYC document reference|KYC reference/i.test(message)) return 'kycDocumentReference';
  if (/document type/i.test(message)) return 'kycDocumentType';
  return undefined;
}

/**
 * Map ANY thrown value from the application path to a classified error.
 *
 * Order matters: a duplicate (23505/409) is checked before the generic
 * validation branch, and the network branch runs before the catch-all, so a
 * dropped connection is never reported as "check your details".
 */
export function toPartnerApplicationError(error: unknown): PartnerApplicationError {
  if (isPartnerApplicationError(error)) return error;

  const message = text(error);
  const code = codeOf(error);
  const status = statusOf(error);

  // This CHECK concerns the server's workflow state, never a user's KYC input.
  // Legacy projects rejected the RPC's 'submitted' value with SQLSTATE 23514.
  if (code === '23514' && /growth_partner_applications_kyc_status_check/i.test(message)) {
    return new PartnerApplicationError('schema', PARTNER_APPLICATION_ERROR_MESSAGES.kycStatusSchema, {
      code, status, cause: error,
    });
  }

  // 1. Duplicate — the DB unique index, the RPC guard, or an HTTP 409.
  if (
    code === '23505' ||
    status === 409 ||
    /duplicate key value|already submitted|already applied|Application already submitted/i.test(message)
  ) {
    const kycReused = /KYC document already used/i.test(message);
    return new PartnerApplicationError(
      'duplicate',
      kycReused
        ? PARTNER_APPLICATION_ERROR_MESSAGES.duplicateKyc
        : PARTNER_APPLICATION_ERROR_MESSAGES.duplicate,
      { code, status, cause: error }
    );
  }

  // 2. Already an active partner — nothing left to apply for.
  if (/Growth Partner access is already active/i.test(message)) {
    return new PartnerApplicationError('approved', PARTNER_APPLICATION_ERROR_MESSAGES.approved, {
      code,
      status,
      cause: error,
    });
  }

  // 3. Suspended / banned account. Checked before the session branch because a
  //    suspended caller is also refused with 42501 — and the fix (contact
  //    support) is not "sign in again".
  if (/banned|suspended/i.test(message)) {
    return new PartnerApplicationError('suspended', PARTNER_APPLICATION_ERROR_MESSAGES.suspended, {
      code,
      status,
      cause: error,
    });
  }

  // 4. Authentication / session (42501, PGRST301, expired JWT, HTTP 401).
  if (
    code === '42501' ||
    code === 'PGRST301' ||
    status === 401 ||
    /sign in required|jwt expired|invalid jwt|session.*expired|refresh_token_not_found/i.test(message)
  ) {
    return new PartnerApplicationError('session', PARTNER_APPLICATION_ERROR_MESSAGES.session, {
      code,
      status,
      cause: error,
    });
  }

  // 5. The backend object is missing — retrying cannot help.
  if (
    code === 'PGRST202' ||
    code === 'PGRST203' ||
    code === '42883' ||
    status === 404 ||
    /could not find the function|schema cache|does not exist/i.test(message)
  ) {
    return new PartnerApplicationError('schema', PARTNER_APPLICATION_ERROR_MESSAGES.schema, {
      code,
      status,
      cause: error,
    });
  }

  // 6. Transport failures.
  if (/network|failed to fetch|fetch failed|load failed|connection|timeout|econnrefused|enotfound/i.test(message)) {
    return new PartnerApplicationError('network', PARTNER_APPLICATION_ERROR_MESSAGES.network, {
      code,
      status,
      cause: error,
    });
  }

  // 7. Rate limiting.
  if (status === 429 || /rate limit|too many requests|over_request/i.test(message)) {
    return new PartnerApplicationError('rate-limit', PARTNER_APPLICATION_ERROR_MESSAGES.rateLimit, {
      code,
      status,
      cause: error,
    });
  }

  // 8. Backend validation: pass through the reviewed server copy (22023, 23514
  //    check constraints, and friends), keeping the field it belongs to.
  if (
    code === '22023' ||
    code === '22007' ||
    code === '22P02' ||
    code === '23514' ||
    SERVER_VALIDATION_MESSAGES.has(message) ||
    SERVER_VALIDATION_MESSAGES.has(message.replace(/\.$/, ''))
  ) {
    const trimmed = message.replace(/\.$/, '');
    let safe = 'Check your application details and try again.';
    if (SERVER_VALIDATION_MESSAGES.has(message) || SERVER_VALIDATION_MESSAGES.has(trimmed)) {
      safe = message;
    } else if (/invalid aadhaar|aadhaar_format|kyc_reference.*aadhaar/i.test(message)) {
      safe = 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.';
    } else if (/invalid pan\b|pan_format|kyc_reference.*pan/i.test(message)) {
      safe = 'Invalid PAN. Enter it as ABCDE1234F.';
    } else if (/invalid passport/i.test(message)) {
      safe = 'Invalid passport number. Use 6-20 letters or digits.';
    } else if (/invalid driving licen[cs]e/i.test(message)) {
      safe = 'Invalid driving licence number. Use 6-20 letters or digits.';
    } else if (/invalid business registration/i.test(message)) {
      safe = 'Invalid business registration number. Use 6-20 letters or digits.';
    } else if (/kyc_reference_check|kyc_reference_format_check|kyc_document_reference_check/i.test(message)) {
      safe = 'Invalid KYC reference number for the selected document type.';
    } else if (/kyc_document_type_check/i.test(message)) {
      safe = 'Select a valid KYC document type';
    }
    return new PartnerApplicationError('validation', safe, {
      code,
      status,
      field: fieldFor(safe !== 'Check your application details and try again.' ? safe : message),
      cause: error,
    });
  }

  // 9. Recognized as a failure, but not attributable.
  return new PartnerApplicationError('unknown', PARTNER_APPLICATION_ERROR_MESSAGES.unknown, {
    code,
    status,
    cause: error,
  });
}

/**
 * The message to render. Used by the page so the copy for a classified failure
 * is decided in exactly one place (this file) instead of being rebuilt per
 * call site.
 */
export function partnerApplicationErrorMessage(error: unknown): string {
  return toPartnerApplicationError(error).message;
}
