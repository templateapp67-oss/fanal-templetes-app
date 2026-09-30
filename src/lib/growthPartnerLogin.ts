import { supabase } from './supabaseClient';
import {
  fetchMyGrowthPartnerRow,
  isSessionExpiredError,
  type GrowthPartner,
  type GrowthPartnerGate,
} from './growthPartner';
import {
  PartnerApplicationError,
  PARTNER_APPLICATION_ERROR_MESSAGES,
  toPartnerApplicationError,
} from './partnerApplicationErrors';
import {
  validatePartnerApplication,
  type PartnerApplicationFieldErrors,
  type PartnerApplicationInput,
} from './partnerApplicationValidation';
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
  ensurePartnerRow?: () => Promise<unknown>;
  /**
   * The caller's own application row, used to tell "under review" apart from
   * "never applied". Defaults to `fetchMyGrowthPartnerApplication` (the RLS
   * self-select read); injectable for the same reason as `fetchPartnerRow`.
   */
  fetchApplicationRow?: () => Promise<{ status?: string | null } | null>;
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
}

// ---------------------------------------------------------------------------
// Growth Partner APPLICATION submission
//
// One write path, used by both entry points (sign-up and the signed-in
// "Become a Growth Partner" form), so the two can never drift:
//
//   1. validate + sanitize every field (`validatePartnerApplication`) — an
//      invalid Aadhaar number or phone never reaches the network,
//   2. prove a live session exists (`auth.getSession()`), because the backend
//      derives the row's owner from the JWT (`auth.uid()`) and an expired
//      session would otherwise be reported as a generic failure,
//   3. refuse a duplicate application BEFORE the write, using the caller's own
//      application row (RLS-scoped read) — a rejected applicant may reapply,
//   4. call the RPC with the sanitized values only. No user id, no partner id
//      and no status ever travel from the browser: the database decides those,
//   5. map ANY failure to a classified, actionable error
//      (`toPartnerApplicationError`) instead of the old catch-all sentence.
// ---------------------------------------------------------------------------

/** The stored application, as the RPC reports it. */
export interface GrowthPartnerApplicationResult {
  id: string | null;
  status: string;
  kycStatus: string | null;
  createdAt: string | null;
  /** Present only on projects whose enrollment approves applications at once. */
  referralCode?: string | null;
}

export interface SubmitPartnerApplicationOptions {
  /**
   * Read of the caller's own application row, used to refuse a duplicate before
   * the write. Injectable: the portal already has the row in state, and tests
   * decide where it comes from. Omit it and the check is skipped — the database
   * still refuses the duplicate, so skipping is never unsafe, only slower.
   */
  fetchApplicationRow?: () => PromiseLike<{ status?: string | null } | null> | { status?: string | null } | null;
  /**
   * Verify a live session before writing (default true). Sign-up passes false:
   * the session was just minted by `auth.signUp` on the same client.
   */
  requireSession?: boolean;
  /** Skip the duplicate pre-check (rarely needed; the DB is authoritative). */
  allowResubmission?: boolean;
}

/** Create an Auth account, then submit a pending partner application. */
export interface SignUpGrowthPartnerResult {
  confirmed: boolean;
  viewer?: GrowthPartnerViewer;
  application?: GrowthPartnerApplicationResult;
  /**
   * Set when the account was created but the application was not stored. The
   * account exists, so this is NOT thrown: the caller shows "account created"
   * together with the real reason (invalid KYC, duplicate, missing migration…).
   */
  applicationError?: PartnerApplicationError;
}

export async function signUpGrowthPartner(
  client: GrowthPartnerAuthClient,
  input: { email: string; password: string; fullName: string; phone?: string; kycDocumentType: string; kycDocumentReference: string }
): Promise<SignUpGrowthPartnerResult> {
  if (!client.auth.signUp) throw new Error('Signup is unavailable. Please try again later.');
  const { data, error } = await client.auth.signUp({
    email: input.email.trim(), password: input.password,
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error) throw toGrowthPartnerLoginError(error);
  if (!data?.user) throw new Error('Signup failed. Please try again.');
  // Supabase intentionally returns an empty identities array for an email
  // that already exists (to avoid account enumeration). It can also return no
  // session in that case, so do not mislabel an existing account as an email
  // confirmation requirement.
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('This email already has an account. Please use Sign in instead.');
  }
  if (!data.session) return { confirmed: false };
  try {
    // The session was just minted by this client, so no second read is needed
    // before the write; a brand-new account cannot have an application yet.
    const application = await submitPartnerApplication(
      client,
      {
        fullName: input.fullName,
        phone: input.phone,
        kycDocumentType: input.kycDocumentType,
        kycDocumentReference: input.kycDocumentReference,
      },
      { requireSession: false, allowResubmission: true }
    );
    return { confirmed: true, viewer: viewerFromUser(data.session.user ?? data.user), application };
  } catch (thrown) {
    // The account exists and is signed in: report the application outcome with
    // the real reason instead of failing the whole sign-up.
    return {
      confirmed: true,
      viewer: viewerFromUser(data.session.user ?? data.user),
      applicationError: toPartnerApplicationError(thrown),
    };
  }
}

/** Submit an application for an account that is already authenticated. */
export async function submitGrowthPartnerApplication(
  client: GrowthPartnerAuthClient,
  input: PartnerApplicationInput,
  options: SubmitPartnerApplicationOptions = {}
): Promise<GrowthPartnerApplicationResult> {
  return submitPartnerApplication(client, input, options);
}

async function submitPartnerApplication(
  client: GrowthPartnerAuthClient,
  input: PartnerApplicationInput,
  options: SubmitPartnerApplicationOptions
): Promise<GrowthPartnerApplicationResult> {
  // (1) Validate + sanitize. `values` is null unless every field passed, so an
  //     invalid field can never reach the network — and the error still names
  //     the field, so the form marks the right input.
  const validated = validatePartnerApplication(input);
  if (!validated.values) {
    const field = (Object.keys(validated.errors) as Array<keyof PartnerApplicationFieldErrors>)[0];
    throw new PartnerApplicationError(
      'validation',
      validated.message || 'Check your application details and try again.',
      field ? { field } : {}
    );
  }

  // (2) A live session is what attaches the row to the caller (`auth.uid()`):
  //     the RPC never receives a user id, it reads the JWT. Check it here so an
  //     expired session prompts a sign-in instead of a dead-end failure.
  //
  //     A session read that THROWS is not evidence of a missing session — it is
  //     usually the same transport failure the write would hit — so it is left
  //     for the write's own answer to classify (network, not "signed out").
  if (options.requireSession !== false && typeof client.auth?.getSession === 'function') {
    let sessionUserId: unknown = null;
    let sessionLookupFailed = false;
    try {
      const { data } = await client.auth.getSession();
      sessionUserId = data?.session?.user?.id ?? null;
    } catch {
      sessionLookupFailed = true;
    }
    if (!sessionLookupFailed && !sessionUserId) {
      throw new PartnerApplicationError('session', PARTNER_APPLICATION_ERROR_MESSAGES.session);
    }
  }

  // (3) Duplicate guard: this user already has an application under review (or
  //     already approved). A REJECTED applicant may reapply, which is why the
  //     status — not mere existence — decides.
  if (!options.allowResubmission && typeof options.fetchApplicationRow === 'function') {
    const existing = await Promise.resolve()
      .then(() => options.fetchApplicationRow?.())
      .catch(() => null);
    const status = String(existing?.status ?? '').trim().toLowerCase();
    if (status === 'pending') {
      throw new PartnerApplicationError('duplicate', PARTNER_APPLICATION_ERROR_MESSAGES.duplicate, {
        code: '23505',
      });
    }
    if (status === 'approved') {
      throw new PartnerApplicationError('approved', PARTNER_APPLICATION_ERROR_MESSAGES.approved, {
        code: '23505',
      });
    }
  }

  // (4) The write. Identity and status are decided by the database: the payload
  //     carries no user id, no partner id and no status field.
  if (!client.rpc) {
    throw new PartnerApplicationError('schema', PARTNER_APPLICATION_ERROR_MESSAGES.unavailable);
  }
  // The payload is written inline on purpose: tests/growthPartnerContract.test.ts
  // reads every `.rpc('<name>', { … })` call out of this file and asserts that
  // no identity (user_id / partner_id) is ever sent — the backend derives it
  // from auth.uid(). Keeping it visible keeps that guarantee checkable.
  //
  // postgrest-js RESOLVES with `{ error }` for a database refusal but REJECTS
  // for a transport failure (and can throw synchronously). Both shapes are
  // funnelled into the same classifier — otherwise a dropped connection would
  // escape as a raw driver error, which is exactly how this path used to end up
  // showing one generic sentence for everything.
  let settled: { data?: unknown; error?: unknown } = {};
  try {
    settled = await Promise.resolve(
      client.rpc('submit_growth_partner_application', {
        p_full_name: validated.values.fullName,
        p_phone: validated.values.phone,
        p_kyc_document_type: validated.values.kycDocumentType,
        p_kyc_document_reference: validated.values.kycDocumentReference,
      })
    ).then(
      (result) => result ?? {},
      (thrown) => ({ data: null, error: thrown })
    );
  } catch (thrown) {
    settled = { data: null, error: thrown };
  }
  // (5) Fallback to direct RLS-scoped INSERT if the RPC is not in PostgREST's
  //     schema cache yet, but the table + RLS policies exist on the project.
  if (
    settled.error &&
    typeof (client as any).from === 'function' &&
    /PGRST202|PGRST203|42883|could not find the function/i.test(
      `${(settled.error as any)?.code ?? ''} ${(settled.error as any)?.message ?? ''}`
    )
  ) {
    try {
      const { data: sessionData } = await client.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (uid) {
        const directInsert = await (client as any)
          .from('growth_partner_applications')
          .insert({
            user_id: uid,
            full_name: validated.values.fullName,
            phone: validated.values.phone,
            status: 'pending',
            kyc_status: 'submitted',
            kyc_document_type: validated.values.kycDocumentType,
            kyc_document_reference: validated.values.kycDocumentReference,
            kyc_submitted_at: new Date().toISOString(),
          })
          .select('id, status, kyc_status, created_at')
          .single();
        if (!directInsert?.error && directInsert?.data) {
          return normalizeApplicationResult(directInsert.data);
        }
        if (directInsert?.error) {
          settled = { data: null, error: directInsert.error };
        }
      }
    } catch {
      // Keep the original RPC error if the direct table fallback also fails.
    }
  }

  // (6) Classify every failure — never replace it with a catch-all sentence.
  if (settled.error) throw toPartnerApplicationError(settled.error);
  return normalizeApplicationResult(settled.data);
}

/** Normalize the RPC payload; unknown shapes degrade to null, never to guesses. */
function normalizeApplicationResult(data: unknown): GrowthPartnerApplicationResult {
  const payload = (data ?? {}) as Record<string, unknown>;
  const value = (key: string): string | null => {
    const raw = payload[key];
    return typeof raw === 'string' && raw.trim() ? raw : null;
  };
  return {
    id: value('id'),
    status: value('status') ?? 'pending',
    kycStatus: value('kyc_status'),
    createdAt: value('created_at'),
    referralCode: value('referral_code'),
  };
}

/** The authenticated viewer identity (id + email), never a role. */
export interface GrowthPartnerViewer {
  id: string;
  email: string;
  /** True only when the auth provider marks this account as an admin (local dev review panel). */
  isAdmin?: boolean;
}

/**
 * Login-page states. `granted` means "active Growth Partner — proceed to the
 * area"; every other state keeps the visitor out of the partner area or shows
 * the open-enrollment application flow.
 */
export type GrowthPartnerLoginState =
  | 'loading'
  | 'mock-mode'
  | 'signed-out'
  | 'unauthorized'
  | 'pending'
  | 'rejected'
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
  if (
    (error as {code?: string})?.code === 'email_provider_disabled' ||
    /email (signups|logins) are disabled|email provider.*disabled/i.test(message)
  ) {
    return new Error('Email sign-in is disabled in Supabase. Enable the Email provider in Authentication → Providers → Email.');
  }
  if ((error as {code?: string})?.code === 'user_banned' || /user.*banned|account.*suspended/i.test(message)) {
    return new Error('Your account is suspended. Contact support for help.');
  }
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

/**
 * Map an auth user to the viewer the login route uses. One mapper for both the
 * sign-in and session-restore paths so the shape can never drift between them.
 */
function viewerFromUser(user: { id?: unknown; email?: unknown; app_metadata?: unknown }): GrowthPartnerViewer {
  return {
    id: String(user.id),
    email: typeof user.email === 'string' ? user.email : '',
    // True only when the auth provider marks this account as an admin; that
    // flag unlocks the local review queue, never any partner data.
    isAdmin: (user.app_metadata as { is_admin?: unknown } | undefined)?.is_admin === true,
  };
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
  return viewerFromUser(user);
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
  return viewerFromUser(user);
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
  /** Status of the caller's own KYC application, when they have one. */
  applicationStatus?: string | null;
}): GrowthPartnerLoginState {
  if (input.isMockMode) return 'mock-mode';
  if (input.loading) return 'loading';
  if (!input.userId) return 'signed-out';
  if (input.loadError) return isSessionExpiredError(input.loadError) ? 'session-expired' : 'error';
  if (!input.partnerRow) {
    if (input.applicationStatus === 'pending') return 'pending';
    if (input.applicationStatus === 'rejected') return 'rejected';
    return 'unauthorized';
  }
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
