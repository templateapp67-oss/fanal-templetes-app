import { supabase } from '../../lib/supabaseClient';
import { normalizeGrowthReferralCode } from '../../lib/growthPartner';
import {
  buildSafeSignupMetadata,
  isValidEmail,
  logSignupFailure,
  OnboardingError,
  phaseFromOnboardingState,
  toSafeAuthError,
  toSafeReferralError,
  validateLogin,
  validateSignup,
  type OnboardingPhase,
} from './flow';

// ============================================================================
// Onboarding App — Supabase integration.
//
// Same project, same Auth, same database/RPCs/RLS as the Template App. Every
// function takes the client as its first argument (defaulting to the shared
// anon-key `supabase` client) so tests can inject fakes. No function here
// touches privileged keys, stores passwords, or writes profile/business data.
//
// Referral trust chain (all server-side, Phase 1):
//   link → link_my_growth_referral (validates code + creates the ONE
//          immutable relationship; the frontend never picks a partner id)
//   state → get_my_onboarding_status + get_my_growth_referral (source of
//          truth for routing; never trusted from localStorage)
// ============================================================================

/** Structural client: the real Supabase client satisfies this; so do fakes. */
export interface OnboardingSupabaseClient {
  auth: {
    signUp: (args: Record<string, any>) => Promise<{ data: any; error: any }>;
    signInWithPassword: (args: Record<string, any>) => Promise<{ data: any; error: any }>;
    resetPasswordForEmail: (email: string, opts?: Record<string, any>) => Promise<{ data: any; error: any }>;
    signOut: () => Promise<{ error: any }>;
    getSession: () => Promise<{ data: { session: any }; error: any }>;
    /** Present on the real client; used to finish a PASSWORD_RECOVERY reset. */
    updateUser?: (attrs: { password: string }) => Promise<{ data: any; error: any }>;
    /** Present on the real client; re-sends the "confirm your email" mail. */
    resend?: (args: Record<string, any>) => Promise<{ data: any; error: any }>;
    onAuthStateChange: (cb: (event: string, session: any) => void) => {
      data: { subscription: { unsubscribe: () => void } };
    };
  };
  rpc: (fn: string, args?: Record<string, any>) => Promise<{ data: any; error: any }>;
}

export interface OnboardingViewer {
  id: string;
  email: string;
}

export interface OnboardingSnapshot {
  phase: OnboardingPhase;
  linked: boolean;
  referralCode: string | null;
  partnerId: string | null;
  partnerName: string | null;
}

function viewerFromUser(user: any): OnboardingViewer | null {
  if (!user?.id) return null;
  return { id: String(user.id), email: typeof user.email === 'string' ? user.email : '' };
}

function firstValidationMessage(errors: Record<string, string | undefined>): string {
  return (
    errors.fullName ||
    errors.email ||
    errors.phone ||
    errors.password ||
    errors.confirm ||
    'Please check the form and try again.'
  );
}

/**
 * Same-origin URL Supabase Auth appends to its confirmation / reset emails.
 * Kept identical for both so the Auth "Redirect URLs" allow-list only needs
 * one entry, and so a confirmed account lands back inside the funnel.
 */
export function onboardingAuthRedirectTo(): string | undefined {
  return typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/onboarding/login`
    : undefined;
}

/**
 * Register with email + password via Supabase Auth. Returns
 * `confirmationRequired: true` when the project requires email verification
 * (a newly-created user object but no session) — the UI then shows "check
 * your inbox" instead of treating it as a login. Supabase intentionally
 * returns an obfuscated user with `identities: []` for an existing address in
 * some configurations; that is an existing-account result, not a request to
 * verify email.
 */
export async function signUpWithEmail(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    confirm: string;
    attributionToken?: string;
  }
): Promise<{ viewer: OnboardingViewer | null; confirmationRequired: boolean }> {
  const validation = validateSignup(input);
  if (!validation.ok) throw new OnboardingError('validation', firstValidationMessage(validation.errors));
  const email = input.email.trim();
  const redirectTo = onboardingAuthRedirectTo();
  const { data, error } = await client.auth.signUp({
    email,
    password: input.password,
    options: {
      ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
      data: buildSafeSignupMetadata({
        fullName: input.fullName,
        phone: input.phone,
        attributionToken: input.attributionToken,
      }),
    },
  });
  if (error) {
    logSignupFailure('onboarding auth.signUp', error);
    throw toSafeAuthError(error, 'signup');
  }
  if (!data?.user) throw toSafeAuthError(new Error('signup failed'), 'signup');
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new OnboardingError('email-in-use', 'An account with this email already exists. Try logging in.');
  }
  return { viewer: viewerFromUser(data.user), confirmationRequired: !data.session };
}

/**
 * Re-send the "confirm your email" mail for an account whose signup returned a
 * user but no session. Supabase Auth rate-limits this server-side; the response
 * is identical whether or not the address exists, so nothing is revealed.
 */
export async function resendSignupConfirmation(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  email: string
): Promise<void> {
  const trimmed = String(email || '').trim();
  if (!isValidEmail(trimmed)) {
    throw new OnboardingError('validation', 'Enter a valid email address.');
  }
  if (typeof client.auth.resend !== 'function') {
    throw new OnboardingError('unknown', 'Confirmation emails cannot be resent right now. Please try again later.');
  }
  const redirectTo = onboardingAuthRedirectTo();
  const { error } = await client.auth.resend({
    type: 'signup',
    email: trimmed,
    ...(redirectTo ? { options: { emailRedirectTo: redirectTo } } : {}),
  });
  if (error) throw toSafeAuthError(error, 'resend');
}

/** Sign in with email + password via Supabase Auth. */
export async function signInWithEmail(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  input: { email: string; password: string }
): Promise<{ viewer: OnboardingViewer }> {
  const validation = validateLogin(input);
  if (!validation.ok) throw new OnboardingError('validation', firstValidationMessage(validation.errors));
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });
  if (error) throw toSafeAuthError(error, 'login');
  const viewer = viewerFromUser(data?.user);
  if (!viewer || !data?.session) throw toSafeAuthError(new Error('login failed'), 'login');
  return { viewer };
}

/**
 * Supabase Auth password reset (no custom password storage/reset tables).
 * Always resolves to the same success copy — account existence is never
 * revealed. Throws only for invalid input or transport failures.
 */
export async function sendPasswordReset(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  email: string
): Promise<void> {
  const trimmed = String(email || '').trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new OnboardingError('validation', 'Enter a valid email address.');
  }
  const redirectTo = onboardingAuthRedirectTo();
  const { error } = await client.auth.resetPasswordForEmail(
    trimmed,
    redirectTo ? { redirectTo } : undefined
  );
  if (error) throw toSafeAuthError(error, 'reset');
}

/**
 * Finish a password reset inside a live PASSWORD_RECOVERY session.
 *
 * The reset email links back to `/onboarding/login`; Supabase Auth exchanges
 * the token there and emits PASSWORD_RECOVERY with a real (recovery) session.
 * Without this the user lands on the login form holding a session they cannot
 * use and no way to set a password — the reset flow dead-ends. Same contract
 * as the partner portal's `completePartnerPasswordReset`.
 */
export async function setNewPassword(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  password: string,
  confirm: string
): Promise<void> {
  // Only the password rules apply here — the recovery session already proved
  // the email, and name/phone are not part of setting a new password.
  const validation = validateSignup({
    fullName: 'Recovery',
    email: 'reset@in.recovery',
    phone: '+910000000000',
    password,
    confirm,
  });
  if (validation.errors.password) throw new OnboardingError('validation', validation.errors.password);
  if (validation.errors.confirm) throw new OnboardingError('validation', validation.errors.confirm);
  if (!client.auth.updateUser) {
    throw new OnboardingError('unknown', 'Could not update the password. Please try again.');
  }
  const { error } = await client.auth.updateUser({ password });
  if (error) throw toSafeAuthError(error, 'reset');
}

/** Sign out via Supabase Auth. Never deletes the account or the referral link. */
export async function signOutViewer(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient
): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    // Local logout is the goal; a transport blip must not trap the user.
  }
}

/**
 * Restore the persisted Supabase session (page refresh path). Resolves null
 * when signed out; throws only when the read itself fails (boot retry state).
 */
export async function loadViewer(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient
): Promise<OnboardingViewer | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw toSafeAuthError(error, 'login');
  return viewerFromUser(data?.session?.user);
}

/**
 * Backend source of truth for routing: onboarding status + referral
 * relationship for the signed-in caller. Throws `session` when the JWT is no
 * longer accepted so the app can bounce to login.
 */
export async function fetchOnboardingSnapshot(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient
): Promise<OnboardingSnapshot> {
  const { data: status, error: statusError } = await client.rpc('get_my_onboarding_status');
  if (statusError) throw toSafeReferralError(statusError);
  const { data: relationship, error: relError } = await client.rpc('get_my_growth_referral');
  if (relError) throw toSafeReferralError(relError);
  const linked = status?.linked === true;
  return {
    phase: phaseFromOnboardingState({ status: status?.status, linked }),
    linked,
    referralCode:
      (typeof status?.referral_code === 'string' && status.referral_code) ||
      (typeof relationship?.referral_code === 'string' && relationship.referral_code) ||
      null,
    partnerId:
      (typeof status?.growth_partner_id === 'string' && status.growth_partner_id) ||
      (typeof relationship?.growth_partner_id === 'string' && relationship.growth_partner_id) ||
      null,
    partnerName:
      (typeof relationship?.partner_name === 'string' && relationship.partner_name.trim()) || null,
  };
}

/**
 * Server-side referral validation + linking in ONE RPC. The frontend only
 * supplies the raw code string — validity, partner identity and ownership are
 * all decided inside `link_my_growth_referral`; there is no parameter through
 * which the browser could choose an arbitrary partner.
 */
export async function linkReferralCode(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  code: string
): Promise<{ referralCode: string; partnerName: string | null }> {
  const normalized = normalizeGrowthReferralCode(code);
  if (!normalized) throw new OnboardingError('validation', 'Enter your referral code.');
  const { data, error } = await client.rpc('link_my_growth_referral', { p_code: normalized });
  if (error) throw toSafeReferralError(error);
  if (!data?.growth_partner_id) throw toSafeReferralError(new Error('link failed'));
  return {
    referralCode: typeof data.referral_code === 'string' ? data.referral_code : normalized,
    partnerName: typeof data?.partner_name === 'string' && data.partner_name.trim() ? data.partner_name : null,
  };
}
