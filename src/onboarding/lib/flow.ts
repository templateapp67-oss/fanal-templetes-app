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
 *   authenticated + linked → status (referral never forced again)
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
  if (requested === 'referral') return 'status';
  if ((AUTH_SECTIONS as string[]).includes(requested)) return 'status';
  return 'status';
}

// ---------------------------------------------------------------------------
// Client-side validation (UX only — Supabase Auth + RPCs re-validate).
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 6;

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

export interface SignupValidation {
  ok: boolean;
  errors: { email?: string; password?: string; confirm?: string };
}

export function validateSignup(input: { email: string; password: string; confirm: string }): SignupValidation {
  const errors: SignupValidation['errors'] = {};
  if (!isValidEmail(input.email)) errors.email = 'Enter a valid email address.';
  if (!input.password) errors.password = 'Enter a password.';
  else if (input.password.length < MIN_PASSWORD_LENGTH)
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
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
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * Map a Supabase Auth failure to a safe message. Unknown shapes fall back to
 * the generic message — raw database/driver text is never surfaced.
 */
export function toSafeAuthError(error: unknown, action: 'signup' | 'login' | 'reset' = 'login'): OnboardingError {
  const message = messageOf(error);
  if (/invalid login credentials|invalid email or password/i.test(message)) {
    return new OnboardingError('invalid-credentials', 'Invalid email or password. Please try again.');
  }
  if (/email not confirmed/i.test(message)) {
    return new OnboardingError('email-not-confirmed', 'Please verify your email, then log in.');
  }
  if (/user already registered|already exists|already been registered/i.test(message)) {
    return new OnboardingError('email-in-use', 'An account with this email already exists. Try logging in.');
  }
  if (/password.*(short|weak|at least 6|6 characters)/i.test(message)) {
    return new OnboardingError('validation', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (/rate limit|too many|over request/i.test(message)) {
    return new OnboardingError('unknown', 'Too many attempts. Please wait a moment and try again.');
  }
  if (/failed to fetch|network|fetch failed|connection/i.test(message)) {
    return new OnboardingError('network', 'Network error. Check your connection and try again.');
  }
  const fallback =
    action === 'signup'
      ? 'Account creation failed. Please try again.'
      : action === 'reset'
        ? 'Password reset failed. Please try again.'
        : 'Login failed. Please try again.';
  return new OnboardingError('unknown', fallback);
}

/**
 * Map a referral-link failure to a safe message. `already-linked` is a
 * distinct code (not an error dead-end): the caller refreshes backend state
 * and routes to status, since the relationship already exists server-side.
 */
export function toSafeReferralError(error: unknown): OnboardingError {
  const message = messageOf(error);
  if (/already linked to a Growth Partner/i.test(message)) {
    return new OnboardingError('already-linked', 'This account is already linked. Loading your status…');
  }
  if (/own referral code/i.test(message)) {
    return new OnboardingError('invalid-code', 'You cannot use your own referral code.');
  }
  if (/invalid.*referral code|referral code.*invalid|inactive referral/i.test(message)) {
    return new OnboardingError('invalid-code', 'Invalid referral code. Please check and try again.');
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
