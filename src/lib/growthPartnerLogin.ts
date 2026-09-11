import { supabase } from './supabaseClient';
import {
  fetchMyGrowthPartnerRow,
  isSessionExpiredError,
  type GrowthPartner,
  type GrowthPartnerGate,
} from './growthPartner';
import { GROWTH_PARTNER_LOGIN_PATH, isGrowthPartnerLoginPath } from './router';

// ============================================================================
// Growth Partner LOGIN (Part 2.1) — email + password via Supabase Auth, then
// backend role verification. No second auth system, no manual password
// storage: sign-in is `supabase.auth.signInWithPassword`, and authorization is
// decided only by the caller's own `growth_partners` row (RLS SELECT-own-row),
// never by anything the browser could claim (no role flag, no stored value,
// no URL/query parameter, no React state).
// ============================================================================

/**
 * Structural Supabase Auth client (the real `supabase` satisfies this; so do
 * test fakes). Only the three auth methods the login flow needs, plus an
 * injectable backend role read so authentication and authorization always
 * come from the SAME client.
 */
export interface GrowthPartnerAuthClient {
  auth: {
    signUp?: (args: { email: string; password: string; options?: { data?: Record<string, string> } }) => Promise<{ data: any; error: any }>;
    signInWithPassword: (args: {
      email: string;
      password: string;
    }) => Promise<{ data: any; error: any }>;
    signOut: () => Promise<{ error: any }>;
    getSession: () => Promise<{ data: { session: any }; error: any }>;
  };
  /**
   * Backend role read for the signed-in caller. Defaults to
   * `fetchMyGrowthPartnerRow` (the RLS SELECT-own-row query). Injectable so a
   * test (or any future client swap) exercises the SAME source for both the
   * auth actions and the Growth Partner authorization check.
   */
  fetchPartnerRow?: () => Promise<GrowthPartner | null>;
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
}

/** Create an Auth account, then submit a pending partner application. */
export async function signUpGrowthPartner(
  client: GrowthPartnerAuthClient,
  input: { email: string; password: string; fullName: string; phone?: string; kycDocumentType: string; kycDocumentReference: string }
): Promise<{ confirmed: boolean }> {
  if (!client.auth.signUp) throw new Error('Signup is unavailable. Please try again later.');
  const { data, error } = await client.auth.signUp({
    email: input.email.trim(), password: input.password,
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error) throw toGrowthPartnerLoginError(error);
  if (!data?.user) throw new Error('Signup failed. Please try again.');
  if (!data.session) return { confirmed: false };
  if (!client.rpc) throw new Error('Signup is unavailable. Please try again later.');
  const { error: applicationError } = await client.rpc('submit_growth_partner_application', {
    p_full_name: input.fullName.trim(), p_phone: input.phone?.trim() || null,
    p_kyc_document_type: input.kycDocumentType, p_kyc_document_reference: input.kycDocumentReference.trim(),
  });
  if (applicationError) throw new Error('Account created, but the partner application could not be submitted. Please sign in and try again.');
  return { confirmed: true };
}

/** The authenticated viewer identity (id + email), never a role. */
export interface GrowthPartnerViewer {
  id: string;
  email: string;
}

/**
 * Login-page states. `granted` means "active Growth Partner — proceed to the
 * area"; every other state keeps the visitor out of the partner area.
 */
export type GrowthPartnerLoginState =
  | 'loading'
  | 'mock-mode'
  | 'signed-out'
  | 'unauthorized'
  | 'inactive'
  | 'session-expired'
  | 'error'
  | 'granted';

function messageOf(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * Map a Supabase Auth failure to safe copy (never raw database/driver text).
 * The invalid-credentials shape is pinned so a wrong password is always
 * reported as exactly that — never with account-existence hints.
 */
export function toGrowthPartnerLoginError(error: unknown): Error {
  const message = messageOf(error);
  if (/invalid login credentials|invalid email or password|invalid grant/i.test(message)) {
    return new Error('Invalid email or password. Please try again.');
  }
  if (/user already registered|already registered|already exists/i.test(message)) {
    return new Error('This email already has an account. Please use Sign in instead.');
  }
  if (/email not confirmed/i.test(message)) {
    return new Error('Please verify your email, then log in.');
  }
  if (/rate limit|too many|over request/i.test(message)) {
    return new Error('Too many attempts. Please wait a moment and try again.');
  }
  if (/failed to fetch|network|fetch failed|connection/i.test(message)) {
    return new Error('Network error. Check your connection and try again.');
  }
  return new Error('Login failed. Please try again.');
}

/** Sign in with email + password via Supabase Auth (no password storage). */
export async function signInGrowthPartner(
  client: GrowthPartnerAuthClient = supabase as unknown as GrowthPartnerAuthClient,
  input: { email: string; password: string }
): Promise<GrowthPartnerViewer> {
  const { data, error } = await client.auth.signInWithPassword({
    email: String(input.email ?? '').trim(),
    password: String(input.password ?? ''),
  });
  if (error) throw toGrowthPartnerLoginError(error);
  const user = data?.session?.user ?? data?.user;
  if (!user?.id || !data?.session) throw new Error('Login failed. Please try again.');
  return { id: String(user.id), email: typeof user.email === 'string' ? user.email : '' };
}

/**
 * Restore the persisted Supabase session (page refresh path). Resolves null
 * when signed out; throws only when the read itself fails.
 */
export async function loadGrowthPartnerSession(
  client: GrowthPartnerAuthClient = supabase as unknown as GrowthPartnerAuthClient
): Promise<GrowthPartnerViewer | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw toGrowthPartnerLoginError(error);
  const user = data?.session?.user;
  if (!user?.id) return null;
  return { id: String(user.id), email: typeof user.email === 'string' ? user.email : '' };
}

/** Sign out via Supabase Auth (removes the session; the account/data stay). */
export async function signOutGrowthPartner(
  client: GrowthPartnerAuthClient = supabase as unknown as GrowthPartnerAuthClient
): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    // Local logout is the goal; a transport blip must not trap the user.
  }
}

/**
 * Pure login resolver (exported for tests): maps (session, backend role) to
 * the single state the login route renders. `partnerRow === null` after a
 * successful lookup means "signed in but not a partner" (unauthorized);
 * `is_active === false` means "partner but paused" (inactive → denied).
 */
export function resolveGrowthPartnerLogin(input: {
  loading: boolean;
  isMockMode: boolean;
  userId: string | null;
  partnerRow: GrowthPartner | null;
  loadError: unknown;
}): GrowthPartnerLoginState {
  if (input.isMockMode) return 'mock-mode';
  if (input.loading) return 'loading';
  if (!input.userId) return 'signed-out';
  if (input.loadError) return isSessionExpiredError(input.loadError) ? 'session-expired' : 'error';
  if (!input.partnerRow) return 'unauthorized';
  if (input.partnerRow.is_active === false) return 'inactive';
  return 'granted';
}

/**
 * True when the Growth Partner AREA must send the visitor to the login route
 * instead of rendering in place. Only the unauthenticated state redirects; all
 * other states render where they are, so the area and the login route never
 * chase each other (no redirect loop).
 */
export function shouldRedirectToGrowthPartnerLogin(gate: GrowthPartnerGate, path: string): boolean {
  return gate === 'unauthenticated' && !isGrowthPartnerLoginPath(path);
}

/** Canonical login route (re-exported for convenience in tests/components). */
export const growthPartnerLoginUrl = GROWTH_PARTNER_LOGIN_PATH;

/**
 * The backend authorization check the login flow depends on, re-exported so
 * the feature has one import surface. It resolves the caller's OWN partner row
 * through RLS: a normal user gets zero rows (null), a partner gets their row
 * (including `is_active`), regardless of anything the browser claims.
 */
export { fetchMyGrowthPartnerRow };
