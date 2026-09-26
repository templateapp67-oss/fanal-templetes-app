import type { OnboardingSection } from '../../lib/router';
import type { GrowthOnboardingStatus, GrowthOnboardingStatusValue } from '../../lib/growthPartner';

// ============================================================================
// Onboarding App — pure flow logic (no React, no Supabase imports).
//
// Everything here is a pure function so the routing/validation/error rules
// are unit-testable without a DOM or a database. Side effects live in
// ./auth.ts, which injects the Supabase client.
// ============================================================================

/** Onboarding phases the app understands (backend is the source of truth). */
export type OnboardingPhase = 'pending' | 'referral_added' | 'template_started' | 'completed';

/**
 * Map the Phase 1 backend status to an app phase. `linked=false` always means
 * pending, even if a status string ever disagrees — the referral relationship
 * (protected by RLS + the immutable link RPC) is authoritative.
 */
export function phaseFromOnboardingState(state: {
  status: GrowthOnboardingStatusValue | string;
  linked: boolean;
}): OnboardingPhase {
  if (!state || state.linked !== true) return 'pending';
  switch (state.status) {
    case 'template_completed':
      return 'completed';
    case 'template_started':
      return 'template_started';
    default:
      return 'referral_added';
  }
}

/** True when the user has a linked referral (any phase past pending). */
export function hasLinkedReferral(phase: OnboardingPhase): boolean {
  return phase !== 'pending';
}

const AUTH_SECTIONS: OnboardingSection[] = ['login', 'signup', 'forgot-password'];

/**
 * Backend-driven route resolution — the single decider for which onboarding
 * screen renders. The database phase (never localStorage) drives it:
 *
 *   unauthenticated → auth screens as requested, protected routes bounce to login
 *   authenticated + pending → referral (auth screens also forward to referral,
 *     so a signed-in user is never shown Sign Up again)
 *   authenticated + linked → status/handoff (referral never forced again)
 *
 * Loop-free by construction: the resolved section is always renderable for
 * the given (session, phase), so syncing the URL to it converges in one step.
 */
export function resolveOnboardingRoute(input: {
  hasSession: boolean;
  phase: OnboardingPhase;
  requested: OnboardingSection;
}): OnboardingSection {
  const { hasSession, phase, requested } = input;
  if (!hasSession) {
    return (AUTH_SECTIONS as string[]).includes(requested) ? requested : 'login';
  }
  if (!hasLinkedReferral(phase)) return 'referral';
  // The one-time handoff is still the only way to enter setup. Once the
  // backend records template_started, the signed-in owner may use the
  // website step; a deep link before that is sent back to the status screen.
  if (requested === 'website' && (phase === 'template_started' || phase === 'completed')) {
    return 'website';
  }
  return 'status';
}

// ---------------------------------------------------------------------------
// Client-side validation (UX only — Supabase Auth + RPCs re-validate).
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 6;
/**
 * Supabase Auth hashes passwords with bcrypt, which only reads the first 72
 * bytes of its input. Anything longer is silently truncated server-side, so
 * rejecting it here beats letting the user believe a 200-character password is
 * protecting the account.
 */
export const MAX_PASSWORD_LENGTH = 72;
/** Full name is stored in `profiles.full_name` (plain text column). */
export const MAX_FULL_NAME_LENGTH = 120;
/** Digits only after separators are stripped; optional leading `+`. */
const PHONE_RE = /^\+?[0-9]{7,15}$/;

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

/**
 * Phone shape check (UX only — the column is free text). Accepts the Indian
 * `+91 98450 77654` / `9845077654` forms plus any 7–15 digit international
 * number; spaces, dashes, dots and parentheses are ignored.
 */
export function isValidPhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const compact = value.trim().replace(/[\s().-]/g, '');
  return compact.length > 0 && PHONE_RE.test(compact);
}

/** Digits-plus-`+` form of a phone number, for storage in `user_metadata`. */
export function normalizePhone(value: string): string {
  return String(value || '').trim().replace(/[\s().-]/g, '');
}

function signupText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/**
 * Auth metadata is copied to `auth.users.raw_user_meta_data`; treat it as
 * untrusted input. Referral attribution deliberately uses the one-use
 * `growth_referral_token` instead of a raw referral code, so an invalid code
 * can never become a foreign-key lookup during the Auth insert trigger.
 */
export function buildSafeSignupMetadata(input: {
  fullName?: unknown;
  salonName?: unknown;
  phone?: unknown;
  city?: unknown;
  attributionToken?: unknown;
}): Record<string, string | null> {
  const token = typeof input.attributionToken === 'string' && /^[a-f0-9]{64}$/.test(input.attributionToken)
    ? input.attributionToken
    : null;
  const phone = normalizePhone(signupText(input.phone, 32));
  return {
    full_name: signupText(input.fullName, MAX_FULL_NAME_LENGTH),
    salon_name: signupText(input.salonName, 160),
    // Keep the legacy spelling as well as the current trigger spelling.
    phone,
    phone_number: phone,
    city: signupText(input.city, 120),
    // Raw referral codes are never an Auth-trigger input. The referral token
    // above is validated against an active partner in a separate trigger.
    referral_code: null,
    ...(token ? { growth_referral_token: token } : {}),
  };
}

/** Log actionable signup diagnostics without logging credentials or metadata. */
export function logSignupFailure(context: string, error: unknown): void {
  const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown; status?: unknown } | null;
  console.error(`[Nexora signup] ${context}`, {
    message: typeof value?.message === 'string' ? value.message : String(error || 'Unknown error'),
    details: value?.details ?? null,
    hint: value?.hint ?? null,
    code: value?.code ?? null,
    status: value?.status ?? null,
  });
}

export interface SignupValidation {
  ok: boolean;
  errors: {
    fullName?: string;
    email?: string;
    phone?: string;
    password?: string;
    confirm?: string;
  };
}

/**
 * Client-side signup validation. `full_name` and `phone_number` are the two
 * identity columns `handle_new_user()` persists into `profiles`, so the
 * gateway collects them instead of leaving the new owner's profile blank.
 * Supabase Auth re-validates the password server-side.
 */
export function validateSignup(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
}): SignupValidation {
  const errors: SignupValidation['errors'] = {};
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  if (!fullName) errors.fullName = 'Enter your full name.';
  else if (fullName.length > MAX_FULL_NAME_LENGTH)
    errors.fullName = `Full name must be ${MAX_FULL_NAME_LENGTH} characters or fewer.`;
  if (!isValidEmail(input.email)) errors.email = 'Enter a valid email address.';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (phone && !isValidPhone(phone)) errors.phone = 'Enter a valid phone number (7–15 digits).';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!password) errors.password = 'Enter a password.';
  else if (password.length < MIN_PASSWORD_LENGTH)
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (password.length > MAX_PASSWORD_LENGTH)
    errors.password = `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  else if (isValidEmail(input.email) && password.toLowerCase() === input.email.trim().toLowerCase())
    errors.password = 'Password cannot be the same as your email.';
  if (!input.confirm) errors.confirm = 'Confirm your password.';
  else if (input.confirm !== input.password) errors.confirm = 'Passwords do not match.';
  return { ok: Object.keys(errors).length === 0, errors };
}

export interface LoginValidation {
  ok: boolean;
  errors: { email?: string; password?: string };
}

export function validateLogin(input: { email: string; password: string }): LoginValidation {
  const errors: LoginValidation['errors'] = {};
  if (!isValidEmail(input.email)) errors.email = 'Enter a valid email address.';
  if (!input.password) errors.password = 'Enter your password.';
  return { ok: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Safe user-facing errors (never leak database internals).
// ---------------------------------------------------------------------------

export type OnboardingErrorCode =
  | 'validation'
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'email-in-use'
  | 'invalid-code'
  | 'already-linked'
  | 'invalid-handoff'
  | 'handoff-used'
  | 'handoff-expired'
  | 'handoff-forbidden'
  | 'session'
  | 'network'
  | 'unknown';

export class OnboardingError extends Error {
  code: OnboardingErrorCode;
  constructor(code: OnboardingErrorCode, message: string) {
    super(message);
    this.name = 'OnboardingError';
    this.code = code;
  }
}

function messageOf(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const value = error as { message?: unknown; error_description?: unknown; details?: unknown; code?: unknown };
  // GoTrue is not fully consistent across its endpoints: some failures use
  // `message`, while others only carry `error_description` or a code such as
  // `email_exists`. Keeping all safe, non-secret fields here ensures the
  // signup screen never hides a recoverable state behind its generic fallback.
  return [value.message, value.error_description, value.details, value.code]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

/**
 * Map a Supabase Auth failure to a safe message. Unknown shapes fall back to
 * the generic message — raw database/driver text is never surfaced.
 */
export function toSafeAuthError(
  error: unknown,
  action: 'signup' | 'login' | 'reset' | 'resend' = 'login'
): OnboardingError {
  if (error instanceof OnboardingError) return error;
  const message = messageOf(error);
  // GoTrue answers with BOTH `error` ("email_not_confirmed",
  // "user_already_exists") and `error_description` ("Email not confirmed",
  // "User already registered"). The JS client prefers the description, but
  // when it is absent the code form is what reaches us — and then a matcher
  // written against the spaced spelling silently falls through to the generic
  // message. Match both, so the copy an owner sees does not depend on which
  // half of the response arrived.
  const text = `${message} ${message.replace(/_/g, ' ')}`;
  if ((error as {code?: string})?.code === 'user_banned' || /user.*banned|account.*suspended/i.test(text)) return new OnboardingError('unknown', 'Your account is suspended. Contact support for help.');
  // An expired or revoked token is not a login failure — the owner did not do
  // anything wrong, and "Login failed. Please try again." sends them back to a
  // form that will fail the same way. GoTrue words this several ways
  // ("Invalid Refresh Token", "Sign in required", "Token is expired"), and the
  // gateway/`code` forms appear when the JS client surfaces `error` rather
  // than `error_description`.
  if (
    // Spaced spellings only — `text` already folds underscores, so the code
    // forms ('refresh_token_not_found', 'token_expired', 'invalid_token')
    // match here too, and no token-looking identifier appears in this file.
    /invalid refresh token|refresh token not found|session not found|token expired|token is expired|jwt expired|invalid token|sign in required|session expired/i.test(text) ||
    (error as {code?: string})?.code === 'session_expired'
  ) {
    return new OnboardingError('session', 'Your session expired. Please sign in again.');
  }
  if (/invalid login credentials|invalid email or password/i.test(text)) {
    return new OnboardingError('invalid-credentials', 'Invalid email or password. Please try again.');
  }
  if (/email not confirmed/i.test(text)) {
    return new OnboardingError('email-not-confirmed', 'Please verify your email, then log in.');
  }
  if (
    (error as { code?: string })?.code === 'email_exists' ||
    (error as { code?: string })?.code === 'user_already_exists' ||
    /email exists|user already registered|already exists|already been registered/i.test(text)
  ) {
    return new OnboardingError('email-in-use', 'An account already exists with this email. Please log in.');
  }
  if (/database error saving new user|error.*saving.*new user|failed.*create.*user/i.test(text)) {
    return new OnboardingError('unknown', 'We could not prepare your account. Please try again or contact support.');
  }
  if ((error as {code?: string})?.code === 'unexpected_failure' || /unexpected.*failure|internal.*server.*error/i.test(text)) {
    return new OnboardingError('unknown', 'Account setup failed on the server. Please try again; if it continues, contact support.');
  }
  if (/password.*(too long|maximum length|exceed)/i.test(text)) {
    return new OnboardingError('validation', `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`);
  }
  if (/password.*(short|weak|at least 6|6 characters)/i.test(text)) {
    return new OnboardingError('validation', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (/rate limit|too many|over request|for security purposes|only request this after/i.test(text)) {
    return new OnboardingError('unknown', 'Too many attempts. Please wait a moment and try again.');
  }
  if (/failed to fetch|network|fetch failed|connection/i.test(text)) {
    return new OnboardingError('network', 'Network error. Check your connection and try again.');
  }
  const fallback =
    action === 'signup'
      ? 'Account creation could not be completed. Check your connection or contact support if this continues.'
      : action === 'reset'
        ? 'Password reset failed. Please try again.'
        : action === 'resend'
          ? 'The confirmation email could not be resent. Please try again later.'
          : 'Login failed. Please try again.';
  return new OnboardingError('unknown', fallback);
}

/**
 * Map a referral-link failure to a safe message. `already-linked` is a
 * distinct code (not an error dead-end): the caller refreshes backend state
 * and routes to status, since the relationship already exists server-side.
 */
export function toSafeReferralError(error: unknown): OnboardingError {
  if (error instanceof OnboardingError) return error;
  if ((error as {status?: number})?.status === 401 || (error as {code?: string})?.code === 'PGRST301') return new OnboardingError('session', 'Your session expired. Please sign in again.');
  const message = messageOf(error);
  if (/referral attribution could not be checked/i.test(message)) return new OnboardingError('unknown', 'Referral attribution could not be checked. Please retry.');
  if (/already linked to a Growth Partner/i.test(message)) {
    return new OnboardingError('already-linked', 'This account is already linked. Loading your status…');
  }
  if (/own referral code/i.test(message)) {
    return new OnboardingError('invalid-code', 'You cannot use your own referral code.');
  }
  if (/invalid.*referral code|referral code.*invalid|inactive referral/i.test(message)) {
    return new OnboardingError('invalid-code', 'Invalid referral code. Please check and try again.');
  }
  // `update_my_onboarding_progress` rejects an action it does not recognise.
  // That is a stale or wrong client, not a transient failure, so "Something
  // went wrong. Please try again." would send the owner back to retry the exact
  // call that just failed. Reuses the existing 'validation' code rather than
  // adding a new one.
  if (/unknown onboarding action|invalid onboarding action/i.test(message)) {
    return new OnboardingError('validation', 'This step could not be completed. Please refresh the page and try again.');
  }
  if (/sign in required|not authenticated|jwt expired|invalid jwt/i.test(message)) {
    return new OnboardingError('session', 'Your session expired. Please sign in again.');
  }
  if (/failed to fetch|network|fetch failed|connection/i.test(message)) {
    return new OnboardingError('network', 'Network error. Check your connection and try again.');
  }
  return new OnboardingError('unknown', 'Something went wrong. Please try again.');
}

// ---------------------------------------------------------------------------
// Single-flight guard (prevents accidental duplicate submissions).
// ---------------------------------------------------------------------------

/**
 * Returns a `run` that executes at most one async function at a time: a call
 * made while another is in flight resolves to `null` without invoking `fn`.
 * The UI additionally disables the button; this is the logic backstop.
 */
export function createSingleFlight() {
  let inFlight = false;
  return {
    isBusy: () => inFlight,
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      if (inFlight) return null;
      inFlight = true;
      try {
        return await fn();
      } finally {
        inFlight = false;
      }
    },
  };
}

/** Re-export for screens that only need the status type. */
export type { GrowthOnboardingStatus };
