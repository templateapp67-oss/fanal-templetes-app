// ============================================================================
// Growth Partner area — ONE classifier for "the area did not load".
//
// Why this file exists
// --------------------
// A partner who cannot open `/partner/dashboard` used to see:
//
//     Could not load the Growth Partner area
//     Could not load this section. Please try again.
//
// That single sentence covered a missing migration (an administrator's job), a
// refused grant (an account/permission job), a signed-out session (the user's
// job) and a genuine outage (nobody's job but time). Retrying, hard-refreshing
// and clearing cookies — the only advice such a message allows — can never fix
// the first two, so the screen was a dead end that also hid the evidence from
// whoever *could* fix it.
//
// This module turns the raw error into the three answers a person actually
// needs, in the smallest possible vocabulary:
//
//   1. WHAT happened      → `kind`
//   2. WHO can fix it     → `scope` + `owner`
//   3. WHAT TO DO NOW     → `nextStep` (and `retryable`)
//
// It is deliberately pure: no imports, no DOM, no Supabase client, no side
// effects. The browser screen (`PartnerAreaFailurePanel`), the live probe
// (`partnerAreaDiagnostics`) and the operator script
// (`scripts/diagnose-partner-dashboard-access.mjs`) all classify through this
// one function, so a report pasted into a support ticket says the same thing
// the screen said.
//
// Safety rule kept from the rest of the area: raw SQL/database text is never
// rendered. Only an allow-listed, non-sensitive slice (`safeDetail`) may travel
// into the copyable support report — never a token, never a key.
// ============================================================================

/** What went wrong, in the coarsest useful bucket. */
export type PartnerAreaFailureKind =
  | 'offline'
  | 'network'
  | 'session-expired'
  | 'suspended'
  | 'not-a-partner'
  | 'schema-missing'
  | 'permission-denied'
  | 'outage'
  /**
   * The service answered, but not in the shape this build expects (a money
   * field that is not a whole number of paise, a count that is not a number,
   * a required key missing). Distinct from `schema-missing`: nothing is
   * missing from the database, the deployed function's CONTRACT differs from
   * the app's — which is why the app refuses to invent a value.
   */
  | 'contract-mismatch'
  /** A value this app itself was asked to send (or a local form value) is invalid. */
  | 'input-invalid'
  | 'unknown';

/**
 * Where the fix lives — this is the sentence a user is really asking for
 * ("is it my browser, my account, or the service?").
 */
export type PartnerAreaFailureScope = 'browser' | 'account' | 'service' | 'setup' | 'unclear';

/** Who has to act next. */
export type PartnerAreaFailureOwner = 'you' | 'support' | 'administrator';

export interface PartnerAreaFailure {
  kind: PartnerAreaFailureKind;
  scope: PartnerAreaFailureScope;
  owner: PartnerAreaFailureOwner;
  /** Short badge label, e.g. "Connection problem". */
  label: string;
  /** One plain sentence answering "is this my fault / my browser's?". */
  scopeSentence: string;
  title: string;
  body: string;
  /** The single most useful next action for `owner`. */
  nextStep: string;
  /** Label for the screen's primary button when a retry can help. */
  actionLabel: string;
  /** False when repeating the same request cannot succeed on its own. */
  retryable: boolean;
  /** PostgREST/Postgres error code, when the failure carried one. */
  code: string | null;
  /** HTTP status, when the failure carried one. */
  status: number | null;
  /** Allow-listed, non-sensitive slice of the server message (or null). */
  safeDetail: string | null;
  /** Migration/script an administrator must apply, when known. */
  operatorAction: string | null;
}

/** Operator-facing copy for "this project never had the migrations applied". */
export const GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE =
  'The Growth Partner database setup is missing on this project, so access cannot be verified. ' +
  'An administrator must apply the Growth Partner migrations (see GROWTH_PARTNER_SETUP.md).';

/** Setup entry point referenced by every operator-facing message. */
export const PARTNER_AREA_SETUP_DOC = 'GROWTH_PARTNER_SETUP.md';

/**
 * The two migrations the dashboard gate depends on, named so an administrator
 * does not have to bisect 70 migration files. `20260922091000` creates
 * `ensure_my_growth_partner()` (the self-enrollment read the gate makes for an
 * account with no partner row yet); `20260919_growth_partner_area_contract_alignment`
 * is what makes `get_my_growth_partner()` — the gate's very first call —
 * agree with the `growth_partners` schema this repository ships.
 */
export const PARTNER_AREA_ENROLLMENT_MIGRATION =
  'supabase/migrations/20260922091000_direct_growth_partner_dashboard_access.sql';
export const PARTNER_AREA_GATE_MIGRATION =
  'supabase/migrations/20260919_growth_partner_area_contract_alignment.sql';

export const PARTNER_AREA_VERIFY_COMMAND = 'npm run verify:growth-partner -- .env';

// ---------------------------------------------------------------------------
// Error reading
// ---------------------------------------------------------------------------

export interface PartnerAreaErrorDetail {
  message: string;
  code: string | null;
  status: number | null;
  /** The PostgREST/Postgres code before semantic rewriting (e.g. `42501`). */
  rawCode?: string | null;
  /** The backend's own message before sanitizing. NEVER rendered. */
  rawMessage?: string | null;
  /** The HTTP status the backend answered with. */
  rawStatus?: number | null;
  /** The call that failed: RPC name, API path or read label. */
  call?: string | null;
}

/**
 * Read `{ message, code, status }` out of anything a promise can reject with:
 * a PostgREST error object, an `Error`, a bare string, `null`. Never throws.
 */
/**
 * Read the fields this module cares about without trusting the object: a
 * throwing getter (or a Proxy) must degrade to "no detail", never to an
 * exception thrown out of a failure screen.
 */
function safeShallowRead(error: object): Record<string, unknown> {
  const keys = ['message', 'code', 'status', 'call', 'rawCode', 'rawMessage', 'rawStatus'] as const;
  const read: Record<string, unknown> = {};
  for (const key of keys) {
    try {
      read[key] = (error as Record<string, unknown>)[key];
    } catch {
      // Leave the field undefined: absent detail beats a broken screen.
    }
  }
  return read;
}

/** `error.message` without letting a hostile getter escape. */
function safeErrorMessage(error: Error): string {
  try {
    return typeof error.message === 'string' ? error.message : '';
  } catch {
    return '';
  }
}

export function readPartnerAreaErrorDetail(error: unknown): PartnerAreaErrorDetail {
  if (error === null || error === undefined) return { message: '', code: null, status: null };
  if (typeof error === 'string') return { message: error, code: null, status: null };
  if (typeof error === 'object') {
    const candidate = safeShallowRead(error);
    const message = typeof candidate.message === 'string' ? candidate.message : '';
    const code =
      typeof candidate.code === 'string' && candidate.code
        ? candidate.code
        : typeof candidate.code === 'number'
          ? String(candidate.code)
          : null;
    const status = typeof candidate.status === 'number' ? candidate.status : null;
    // The backend's own answer, when the layer that saw it preserved it (see
    // `partnerOperationError` and `rpcError`). Falls back to the semantic
    // fields so a hand-built error still reports something.
    const rawCode =
      typeof candidate.rawCode === 'string' && candidate.rawCode ? candidate.rawCode : null;
    const rawMessage = typeof candidate.rawMessage === 'string' ? candidate.rawMessage : null;
    const rawStatus = typeof candidate.rawStatus === 'number' ? candidate.rawStatus : null;
    const call = typeof candidate.call === 'string' && candidate.call ? candidate.call : null;
    if (message || code || status) return { message, code, status, rawCode, rawMessage, rawStatus, call };
    // An Error subclass whose `message` came through the prototype chain.
    if (error instanceof Error) {
      return { message: safeErrorMessage(error), code: null, status: null, rawCode, rawMessage, rawStatus, call };
    }
    // Any other object: no message to read. `String({})` would put
    // "[object Object]" in front of a user, so report "no message" instead.
    return { message: '', code: null, status: null, rawCode, rawMessage, rawStatus, call };
  }
  try {
    return { message: String(error), code: null, status: null };
  } catch {
    return { message: '', code: null, status: null };
  }
}

// ---------------------------------------------------------------------------
// Predicates — the exact matchers the area already used, in ONE place.
// (These were moved here from `growthPartner.ts`, which re-exports them, so
// existing importers and their pinned tests keep the same behaviour.)
// ---------------------------------------------------------------------------

/**
 * Classify "this project has not had the migration applied" — PostgREST answers
 * PGRST202 (function/table not in the schema cache) or, on older gateways, an
 * HTTP 404 with "Could not find the function ... in the schema cache".
 *
 * It is worth its own classifier because the fix is an operator action
 * (apply the migration), not a retry: telling a partner "Please try again"
 * forever is exactly the dead end this distinguishes.
 */
export function isMissingPartnerSchemaError(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as { code?: string; status?: number };
  // `schema_not_applied` is PostgREST's PGRST202 as classified by
  // `partnerPortalOperations.ts`, with its message rewritten to a migrations
  // hint — one cause, one classification.
  if (
    anyErr.code === 'PGRST202' ||
    anyErr.code === 'PGRST205' ||
    anyErr.code === 'PGRST204' ||
    (anyErr.code as string | undefined) === 'schema_not_applied'
  ) {
    return true;
  }
  if (anyErr.status === 404) return true;
  return /could not find the (function|table|.* in the schema cache)|function .* does not exist|schema cache/i.test(
    String((error as Error)?.message || anyErr || '')
  );
}

/** Session expiry: 401 / PGRST301 / JWT-shaped messages. */
export function isSessionExpiredError(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as { status?: number; code?: string; message?: string };
  if (anyErr.status === 401 || anyErr.code === 'PGRST301') return true;
  const message = String((error as Error)?.message || anyErr || '');
  return /jwt expired|invalid jwt|session.*expired|not authenticated|auth.*required|sign in required/i.test(message);
}

/** Includes mid-request revocation, not just the initial partner gate read. */
export function isPartnerSuspendedError(error: unknown): boolean {
  return /(?:partner|account|access).*(?:inactive|paused|suspended)/i.test(String((error as Error)?.message || ''));
}

/**
 * Schema DRIFT (as opposed to a missing function): the RPC exists but reads a
 * column/relation this project does not have. Same operator fix as a missing
 * migration, so the screen groups them — but the matcher deliberately does NOT
 * feed `isMissingPartnerSchemaError`, whose behaviour is pinned elsewhere.
 */
export function isPartnerSchemaDriftError(error: unknown): boolean {
  const { message, code } = readPartnerAreaErrorDetail(error);
  // The SQLSTATE alone is enough: `42P01` (undefined table) / `42703`
  // (undefined column) are schema problems whatever the message says — which
  // matters after a service layer has replaced the driver text with safe copy.
  if (code === '42P01' || code === '42703') return true;
  if (!message) return false;
  return /relation .* does not exist|column .* does not exist|column .* of relation .* does not exist|missing (column|relation)|undefined (column|table|function)|42703|42P01/i.test(
    message
  );
}

/** Insufficient privilege: 42501, RLS refusals, "permission denied ...". */
export function isPartnerPermissionDeniedError(error: unknown): boolean {
  const { message, code } = readPartnerAreaErrorDetail(error);
  if (code === '42501') return true;
  return /permission denied|row-level security|violates row-level security|not authorized|insufficient privilege/i.test(
    message
  );
}

/** The caller is signed in but is not an approved, active partner. */
export function isNotActivePartnerError(error: unknown): boolean {
  const { message, code } = readPartnerAreaErrorDetail(error);
  if (code === 'partner_only') return true;
  return /active growth partner required|not an active growth partner|growth partner access required|partner_only/i.test(
    message
  );
}

/** Marks an answer whose shape this build cannot trust (see `partnerContractMismatch`). */
export const PARTNER_CONTRACT_MISMATCH_CODE = 'PARTNER_CONTRACT_MISMATCH';
/** Marks a refusal of a value the app was asked to send (see `partnerInputInvalid`). */
export const PARTNER_INPUT_INVALID_CODE = 'PARTNER_INPUT_INVALID';

/** The service answered in a shape this build does not understand. */
export function isPartnerContractMismatchError(error: unknown): boolean {
  const { message, code } = readPartnerAreaErrorDetail(error);
  if (code === PARTNER_CONTRACT_MISMATCH_CODE) return true;
  return /answered in an unexpected shape|contract mismatch/i.test(message);
}

/**
 * The request itself was invalid — either refused locally before it was sent
 * (`PARTNER_INPUT_INVALID_CODE`) or refused by the service as a validation
 * error (`22023`/`validation`, e.g. "Minimum withdrawal is ₹500"). Either way it
 * is a form problem, not an outage.
 */
export function isPartnerInputInvalidError(error: unknown): boolean {
  const { code } = readPartnerAreaErrorDetail(error);
  return code === PARTNER_INPUT_INVALID_CODE || code === 'validation';
}

/** Build the "unexpected shape" error. `field` must be OUR contract's field name. */
export function partnerContractMismatch(field: string): Error {
  return Object.assign(
    new Error(`The Growth Partner service answered in an unexpected shape (field "${field}")`),
    { code: PARTNER_CONTRACT_MISMATCH_CODE }
  );
}

/** Build the "this value cannot be sent" error. `problem` is authored copy. */
export function partnerInputInvalid(problem: string): Error {
  return Object.assign(new Error(problem), { code: PARTNER_INPUT_INVALID_CODE });
}

/** Transport-level failure: offline, DNS, blocked, CORS, timeout. */
export function isPartnerNetworkFailure(error: unknown): boolean {
  const { message, status } = readPartnerAreaErrorDetail(error);
  if (status === 502 || status === 503 || status === 504) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return /failed to fetch|fetch failed|network ?error|networkrequestfailed|load failed|connection|econn|dns|socket|timed? ?out|timeout|aborted|offline/i.test(
    message
  );
}

/** The service answered, but with a server-side error (5xx). */
export function isPartnerServiceOutageError(error: unknown): boolean {
  const { message, status } = readPartnerAreaErrorDetail(error);
  if (typeof status === 'number' && status >= 500 && status <= 599) return true;
  return /internal server error|bad gateway|service unavailable|gateway timeout|http 5\d\d|unexpected server error/i.test(
    message
  );
}

// ---------------------------------------------------------------------------
// Allow-listed detail (what may travel into a support report / the screen)
// ---------------------------------------------------------------------------

/**
 * Only these shapes may be shown or copied. Everything else is summarised as
 * "not recognised", because a raw driver message can carry SQL, table shapes or
 * once in a while a value from a row.
 */
export function safePartnerAreaDetail(error: unknown): string | null {
  const { message } = readPartnerAreaErrorDetail(error);
  const trimmed = message.trim();
  if (!trimmed) return null;
  const patterns: RegExp[] = [
    /could not find the (?:function|table) [^\s(]+(?:\(\))? in the schema cache/i,
    /could not find the function [^\s]+/i,
    /permission denied for (?:function|table|relation|schema) [^\s]+/i,
    // Deliberately NOT identifier-capturing: a relation/column name is schema
    // information and must not travel onto a screen or into a shared report.
    /column [^\r\n]{0,120}does not exist/i,
    /relation [^\r\n]{0,120}does not exist/i,
    /invalid jwt|jwt expired/i,
    /sign in required/i,
    /active growth partner required/i,
    /failed to fetch/i,
    // Our own contract field names — never a value, never a row.
    /unexpected shape \(field "[a-z0-9_.\[\]]{1,60}"\)/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    // Identifiers are stripped: `relation "SECRET_TABLE" does not exist` becomes
    // a sentence that names the KIND of problem and nothing else.
    return match[0].includes('does not exist')
      ? 'a relation or column this project does not have (schema drift)'
      : match[0].slice(0, 180);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Pure classification of one failure into the single thing a person must read. */
export function classifyPartnerAreaFailure(
  error: unknown,
  options: { online?: boolean | null } = {}
): PartnerAreaFailure {
  const { code, status } = readPartnerAreaErrorDetail(error);
  const safeDetail = safePartnerAreaDetail(error);
  const base = { code, status, safeDetail };

  // `navigator.onLine === false` wins: nothing else can be trusted if the
  // browser is not on a network, and it changes the instruction completely.
  if (options.online === false) {
    return {
      ...base,
      kind: 'offline',
      scope: 'browser',
      owner: 'you',
      label: 'You are offline',
      scopeSentence: 'This is a connection problem on your device — not your account and not the service.',
      title: 'Your device is offline',
      body:
        'The browser reports no internet connection, so the Growth Partner area cannot reach the service. ' +
        'Nothing on your account changed.',
      nextStep: 'Reconnect to the internet (or switch network / turn off airplane mode), then choose Retry.',
      actionLabel: 'Retry',
      retryable: true,
      operatorAction: null,
    };
  }

  if (isPartnerInputInvalidError(error)) {
    return {
      ...base,
      kind: 'input-invalid',
      scope: 'unclear',
      owner: 'you',
      label: 'Check the form',
      scopeSentence: 'This is about the value that was entered — the service was not called, so nothing on your account changed.',
      title: 'Check the value you entered',
      body: 'The request was not sent because a value was not in the unit this app requires (amounts travel as whole paise: ₹1 = 100 paise).',
      nextStep: 'Correct the value and send the request again.',
      actionLabel: 'Retry',
      retryable: false,
      operatorAction: null,
    };
  }

  if (isPartnerContractMismatchError(error)) {
    return {
      ...base,
      kind: 'contract-mismatch',
      scope: 'setup',
      owner: 'administrator',
      label: 'Unexpected response shape',
      scopeSentence:
        'The service answered, but not in the shape this build expects — that is a deployment/contract problem, not your account or browser.',
      title: 'The Growth Partner service answered in an unexpected shape',
      body:
        'The call succeeded, but a money or count field was missing, or was not a whole number of paise. The app will not ' +
        'show a made-up figure, so this section stays closed until the answer matches the app.',
      nextStep:
        'Send the report below to support: an administrator must confirm that the deployed Growth Partner migrations match ' +
        `this build (${PARTNER_AREA_VERIFY_COMMAND}).`,
      actionLabel: 'Retry after the fix',
      retryable: false,
      operatorAction: `Check that the deployed Growth Partner functions match this build: ${PARTNER_AREA_VERIFY_COMMAND}`,
    };
  }

  if (isSessionExpiredError(error)) {
    return {
      ...base,
      kind: 'session-expired',
      scope: 'account',
      owner: 'you',
      label: 'Session expired',
      scopeSentence: 'This is a sign-in state on your account — not the service being down.',
      title: 'Your session expired',
      body:
        'The sign-in saved in this browser is no longer accepted by the service, so your partner record could not be read.',
      nextStep: 'Sign in again. If it happens repeatedly, sign out everywhere, then sign in with a fresh password.',
      actionLabel: 'Sign in again',
      retryable: false,
      operatorAction: null,
    };
  }

  if (isPartnerSuspendedError(error)) {
    return {
      ...base,
      kind: 'suspended',
      scope: 'account',
      owner: 'support',
      label: 'Access paused',
      scopeSentence: 'This is an account state — clearing your cache or cookies cannot change it.',
      title: 'Growth Partner access is paused',
      body: 'Your Growth Partner account is currently suspended, so the area is closed for it.',
      nextStep: 'Contact support: only an administrator can reactivate a suspended partner account.',
      actionLabel: 'Check again',
      retryable: false,
      operatorAction: 'An administrator reactivates with: select public.provision_growth_partner(\'<auth uid>\', null, true);',
    };
  }

  if (isMissingPartnerSchemaError(error) || isPartnerSchemaDriftError(error)) {
    return {
      ...base,
      kind: 'schema-missing',
      scope: 'setup',
      owner: 'administrator',
      label: 'Database setup missing',
      scopeSentence: 'This is a setup problem on the project itself — not your account, browser or cache.',
      title: 'The Growth Partner database setup is missing on this project',
      body:
        'The service answered, but the Growth Partner functions this screen calls are not installed on the database, ' +
        'so your access cannot be verified. Retrying, refreshing or clearing cookies cannot fix it, because nothing ' +
        'about the request was wrong.',
      nextStep:
        `An administrator must apply the Growth Partner migrations to this Supabase project, then reload the API ` +
        `schema cache. The gate itself needs ${PARTNER_AREA_GATE_MIGRATION} and ${PARTNER_AREA_ENROLLMENT_MIGRATION} ` +
        `(full order: ${PARTNER_AREA_SETUP_DOC}). Verify afterwards with: ${PARTNER_AREA_VERIFY_COMMAND}`,
      actionLabel: 'Retry after the fix',
      retryable: false,
      operatorAction:
        `Apply ${PARTNER_AREA_GATE_MIGRATION} and ${PARTNER_AREA_ENROLLMENT_MIGRATION} ` +
        `(see ${PARTNER_AREA_SETUP_DOC}), then run: ${PARTNER_AREA_VERIFY_COMMAND}`,
    };
  }

  if (isNotActivePartnerError(error)) {
    return {
      ...base,
      kind: 'not-a-partner',
      scope: 'account',
      owner: 'support',
      label: 'Not an active partner',
      scopeSentence: 'This is an account state — the service refused the read for this account.',
      title: 'This account is not an active Growth Partner',
      body:
        'You are signed in, but the Growth Partner service refused this read because the account has no approved, ' +
        'active Growth Partner record.',
      nextStep:
        'If you have already been approved, contact support to confirm your partner record is active. Otherwise apply ' +
        'from the Growth Partner sign-up page.',
      actionLabel: 'Check again',
      retryable: false,
      operatorAction: 'Check public.growth_partners for this auth user id (is_active must be true).',
    };
  }

  if (isPartnerPermissionDeniedError(error)) {
    return {
      ...base,
      kind: 'permission-denied',
      scope: 'account',
      owner: 'administrator',
      label: 'Permission refused for this account',
      scopeSentence:
        'The database refused this read for your account — this is an account/permission issue, not a browser, cache or cookie problem.',
      title: 'You are signed in, but the database refused this read',
      body:
        'The Growth Partner service reached the database and it answered "permission denied" for this account. ' +
        'Typical causes are a missing or inactive partner record, or a migration whose grants were not applied to ' +
        'this project — none of which a refresh can change.',
      nextStep:
        'Send the report below to support. An administrator must confirm that this account has an active ' +
        `growth_partners row and that the Growth Partner migrations were applied (${PARTNER_AREA_SETUP_DOC}).`,
      actionLabel: 'Retry after the fix',
      retryable: false,
      operatorAction:
        `Confirm the caller's row in public.growth_partners (is_active = true) and that the Growth Partner migration ` +
        `grants are present (${PARTNER_AREA_VERIFY_COMMAND}).`,
    };
  }

  if (isPartnerServiceOutageError(error)) {
    return {
      ...base,
      kind: 'outage',
      scope: 'service',
      owner: 'support',
      label: 'Service error',
      scopeSentence: 'The service answered with an error — this is a platform-side outage, not your account.',
      title: 'The Growth Partner service returned an error',
      body:
        'The service accepted the request and answered with a server error, so the failure is on the platform side ' +
        'rather than in your account or browser.',
      nextStep: 'Wait a moment and Retry. If it keeps failing, send the report below to support.',
      actionLabel: 'Retry',
      retryable: true,
      operatorAction: null,
    };
  }

  if (isPartnerNetworkFailure(error)) {
    return {
      ...base,
      kind: 'network',
      scope: 'browser',
      owner: 'you',
      label: 'Connection problem',
      scopeSentence: 'Your browser could not complete the call — your account is unchanged.',
      title: 'Could not reach the Growth Partner service',
      body:
        'The request never produced an answer from the service. That is usually a network problem on this device ' +
        'or something blocking the request (VPN, firewall, ad blocker, captive portal).',
      nextStep:
        'Check your internet connection, disable any VPN/ad blocker for this site, then Retry. If other sites load ' +
        'fine and this keeps failing, send the report below to support.',
      actionLabel: 'Retry',
      retryable: true,
      operatorAction: null,
    };
  }

  return {
    ...base,
    kind: 'unknown',
    scope: 'unclear',
    owner: 'support',
    label: 'Cause not identified',
    scopeSentence:
      'The app could not name the cause by itself, so the report below is what identifies it for support.',
    title: 'Could not load the Growth Partner area',
    body:
      'The Growth Partner area stopped loading and the failure did not match a cause the app can name on its own. ' +
      'Nothing on your account changed.',
    nextStep:
      'Retry once. If it still fails, run Diagnose below and send the report to support — it names the exact call ' +
      'that failed.',
    actionLabel: 'Retry',
    retryable: true,
    operatorAction: null,
  };
}

/** True when repeating the identical request is a sensible user action. */
export function isPartnerAreaFailureRetryable(failure: PartnerAreaFailure): boolean {
  return failure.retryable;
}

// ---------------------------------------------------------------------------
// Support report
// ---------------------------------------------------------------------------

export interface PartnerAreaReportCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'skipped';
  detail?: string;
}

export interface PartnerAreaReportInput {
  failure: PartnerAreaFailure;
  route?: string | null;
  checkedAt?: string;
  online?: boolean | null;
  session?: { signedIn: boolean; email?: string | null; expiresAt?: string | null } | null;
  projectHost?: string | null;
  checks?: PartnerAreaReportCheck[];
}

/** `someone@example.com` → `s•••@example.com`: enough to identify, not to leak. */
export function maskPartnerAreaEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = String(email).split('@');
  if (!domain) return `${String(email).slice(0, 1)}•••`;
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/** Plain-text report a user can paste into a support ticket. No secrets inside. */
export function buildPartnerAreaSupportReport(input: PartnerAreaReportInput): string {
  const { failure } = input;
  const lines: string[] = [
    'Nexora — Growth Partner access failure report',
    `When:     ${input.checkedAt ?? new Date().toISOString()}`,
    `Route:    ${input.route || '/partner/dashboard'}`,
    `Cause:    ${failure.label} (${failure.kind} · ${failure.scope})`,
    `Detail:   ${failure.safeDetail ?? 'not recognised by the app'}`,
    `Code:     ${failure.code ?? '—'}   HTTP: ${failure.status ?? '—'}`,
    `Browser:  ${input.online === false ? 'offline' : input.online === true ? 'online' : 'unknown'}`,
  ];

  if (input.session) {
    lines.push(
      `Session:  ${input.session.signedIn ? 'signed in' : 'no session'}` +
        `${input.session.email ? ` as ${maskPartnerAreaEmail(input.session.email)}` : ''}` +
        `${input.session.expiresAt ? `, expires ${input.session.expiresAt}` : ''}`
    );
  }
  lines.push(`Project:  ${input.projectHost || 'unknown'} (host only — no keys are included)`);
  lines.push(`Fixes it: ${failure.owner}${failure.retryable ? ' (a retry can help)' : ' (a retry cannot help)'}`);
  lines.push(`Next:     ${failure.nextStep}`);

  if (failure.operatorAction) lines.push(`Operator: ${failure.operatorAction}`);

  if (input.checks && input.checks.length > 0) {
    lines.push('Checks:');
    for (const check of input.checks) {
      lines.push(`  [${check.status}] ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
    }
  }

  lines.push(
    'Note: this report is safe to share. It contains no passwords, tokens or API keys.',
    'Docs: GROWTH_PARTNER_SETUP.md · operator check: npm run verify:growth-partner -- .env'
  );
  return lines.join('\n');
}

// ============================================================================
// Failure LOGGING — the evidence trail.
//
// Why this exists: a raw PostgREST refusal used to be flattened into safe copy
// and then dropped. The partner got "Please try again" (or "Could not verify
// your access") and nobody — not the browser console, not the server logs, not
// the operator — could see the `42501` / `PGRST202` / `23505` behind it. That
// is why the same failure kept being re-reported: it was undiagnosable.
//
// Every failure that reaches a screen is now logged exactly once, with the
// backend's own code/message/status and the call that produced it, redacted of
// anything credential-shaped and PII-shaped. What is logged is DIAGNOSIS; what
// is rendered stays the reviewed safe copy from `classifyPartnerAreaFailure`.
// ============================================================================

/** The values that must never reach a log line. */
const LOG_SECRET_PATTERNS: Array<[RegExp, string]> = [
  // JSON Web Tokens (Supabase access/refresh tokens, service keys).
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '<redacted:jwt>'],
  // Authorization headers, whatever the scheme.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>'],
  // Credential-bearing names in a URL, header dump or error message.
  [/\b(apikey|api_key|access_token|refresh_token|id_token|password|passwd|secret|service_role_key|private_key|razorpay_key_secret)\b(\s*[:=]\s*)("?)([^\s"'&,;)]{4,})\3/gi, '$1$2<redacted>'],
  // Provider key shapes that appear as bare values.
  [/\b(sk|pk|rzp)_(live|test)_[A-Za-z0-9]{6,}\b/g, '<redacted:key>'],
  // Email addresses: not a credential, still not something to ship to a log
  // collector. The domain survives so a support engineer can still see whose
  // tenant is involved.
  [/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<redacted:email>@$1'],
];

/**
 * Strip anything credential- or PII-shaped from text that is about to be
 * logged. Exported so the diagnostic report, the CLI and any future sink can
 * share one definition of "safe to record".
 */
export function redactPartnerAreaLogText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of LOG_SECRET_PATTERNS) redacted = redacted.replace(pattern, replacement);
  return redacted;
}

/** Where a failure happened — enough for an operator to find the code path. */
export interface PartnerAreaFailureLogContext {
  /** Stable label for the attempt, e.g. `gate.read-partner-row`. */
  operation: string;
  /** The surface the partner was on, e.g. `/partner/dashboard`. */
  route?: string | null;
  /** The backend call when known: RPC name or API path. */
  call?: string | null;
}

/** The record handed to the console (also the unit under test). */
export interface PartnerAreaFailureLogRecord {
  /** Greppable one-line prefix: `[growth-partner] <operation> failed`. */
  prefix: string;
  fields: {
    operation: string;
    route: string | null;
    call: string | null;
    kind: PartnerAreaFailure['kind'];
    scope: PartnerAreaFailure['scope'];
    owner: PartnerAreaFailure['owner'];
    retryable: boolean;
    code: string | null;
    http: number | null;
    /** The backend's own code/message, redacted — the point of all this. */
    postgrest: { code: string | null; message: string | null; status: number | null } | null;
    /** What the app did with it (safe copy, no driver text). */
    shown: string;
  };
}

/**
 * Build the log record. Pure, so a test can assert exactly what an operator
 * would see without capturing the console.
 */
export function partnerAreaFailureLogRecord(
  error: unknown,
  context: PartnerAreaFailureLogContext,
  failure?: PartnerAreaFailure
): PartnerAreaFailureLogRecord {
  const classified = failure ?? classifyPartnerAreaFailure(error);
  let detail: PartnerAreaErrorDetail;
  try {
    detail = readPartnerAreaErrorDetail(error);
  } catch {
    // A hostile error (throwing property getter) still gets a record.
    detail = { message: '', code: null, status: null };
  }
  const code = detail.rawCode ?? detail.code;
  const message = detail.rawMessage ?? detail.message;
  const status = detail.rawStatus ?? detail.status;
  const call = detail.call ?? context.call ?? null;
  const hasBackendDetail = Boolean(code || message);
  // The greppable part: `[growth-partner] <operation> failed — <call>`. A
  // support engineer greps the RPC name from the console and lands on the line
  // carrying its code and message.
  return {
    prefix: call
      ? `[growth-partner] ${context.operation} failed — ${call}`
      : `[growth-partner] ${context.operation} failed`,
    fields: {
      operation: context.operation,
      route: context.route ?? null,
      call,
      kind: classified.kind,
      scope: classified.scope,
      owner: classified.owner,
      retryable: classified.retryable,
      code: classified.code,
      http: status,
      postgrest: hasBackendDetail
        ? {
            code: code ? redactPartnerAreaLogText(code) : null,
            message: message ? redactPartnerAreaLogText(message) : null,
            status,
          }
        : null,
      shown: redactPartnerAreaLogText(classified.title),
    },
  };
}

/**
 * Errors already logged, so a failure that passes through several layers (the
 * wrapper that saw the RPC, the facade that classified it, the screen that
 * sanitized it) produces ONE line, not three.
 */
const LOGGED_PARTNER_ERRORS = new WeakSet<object>();

/**
 * Log a failure once and return its classification.
 *
 * Call it wherever a raw failure is about to become safe copy — that is the
 * moment the evidence would otherwise be lost. User-facing behaviour is
 * unchanged: this only records.
 */
/** True when this exact error already produced a log line. */
export function isPartnerAreaErrorLogged(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && LOGGED_PARTNER_ERRORS.has(error as object);
}

/**
 * Carry the "logged" mark onto a wrapper built from an already-logged error, so
 * the next layer's safety net stays quiet and one failure keeps one line.
 */
export function markPartnerAreaErrorLogged<T>(error: T): T {
  if (error && typeof error === 'object') LOGGED_PARTNER_ERRORS.add(error as object);
  return error;
}

export function logPartnerAreaFailure(
  error: unknown,
  context: PartnerAreaFailureLogContext,
  failure?: PartnerAreaFailure
): PartnerAreaFailure {
  // Deliberately TOTAL: a hostile error (a `message` getter that throws) or an
  // unwritable console must not break the screen that was only reporting a
  // problem. On any failure it still returns a usable classification.
  let classified: PartnerAreaFailure;
  try {
    classified = failure ?? classifyPartnerAreaFailure(error);
  } catch {
    classified = failure ?? classifyPartnerAreaFailure(null);
  }
  try {
    if (error && typeof error === 'object') {
      if (LOGGED_PARTNER_ERRORS.has(error as object)) return classified;
      LOGGED_PARTNER_ERRORS.add(error as object);
    }
    const record = partnerAreaFailureLogRecord(error, context, classified);
    // One call: the greppable line first (what a `grep 42501` finds), the
    // structured fields second (what a log collector indexes).
    console.error(record.prefix, record.fields);
  } catch {
    // Logging must never be the reason a screen fails.
  }
  return classified;
}
