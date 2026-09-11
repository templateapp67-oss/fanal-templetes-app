import { supabase } from './supabaseClient';

// ============================================================================
// Growth Partner + shared Onboarding — typed client for the Phase 1 backend
// wiring (supabase/migrations/20260912_growth_partner_onboarding.sql).
//
// Shared by the Template App and (later) the separate Onboarding App: both
// talk to the SAME Supabase project through THESE rpc calls.
//
// Security notes:
//   • This module uses ONLY the anon-key `supabase` client. It never imports
//     or references SUPABASE_SERVICE_ROLE_KEY.
//   • All writes are validated server-side inside SECURITY DEFINER RPCs; the
//     client cannot self-assign a partner, change referral ownership, skip
//     onboarding steps, or supply progress timestamps.
//   • Growth Partner provisioning is admin-only (SQL Editor / service_role)
//     and intentionally has NO wrapper here.
// ============================================================================

/** Canonical onboarding lifecycle. Forward-only, terminal at completed. */
export type GrowthOnboardingStatusValue =
  | 'not_started'
  | 'linked'
  | 'template_started'
  | 'template_completed';

/** Progress steps accepted by update_my_onboarding_progress. */
export type OnboardingProgressAction = 'start_template' | 'complete_template';

/** A Growth Partner row as visible to its owner (SELECT own row only). */
export interface GrowthPartner {
  user_id: string;
  referral_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A growth_onboarding row as stored (backend source of truth for the
 * referral relationship + template progress). Clients never write this
 * table directly — all writes go through the link/progress RPCs.
 *
 * NOTE: the customer-loyalty `Referral` type (src/lib/customer/types.ts,
 * NX- codes, clicked/booked/credited) is a SEPARATE salon-owner feature,
 * not a duplicate of this — the two domains must stay unmerged.
 */
export interface GrowthOnboardingRow {
  user_id: string;
  growth_partner_id: string | null;
  referral_code: string | null;
  status: GrowthOnboardingStatusValue;
  linked_at: string | null;
  template_started_at: string | null;
  template_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The caller's referral relationship (get_my_growth_referral / link result). */
export interface GrowthReferralRelationship {
  growth_partner_id: string;
  referral_code: string;
  linked_at: string;
  status: GrowthOnboardingStatusValue;
  /** Display name from profiles, or null when unavailable. */
  partner_name: string | null;
}

/** The caller's onboarding progress (read + update result shape). */
export interface GrowthOnboardingStatus {
  status: GrowthOnboardingStatusValue;
  linked: boolean;
  growth_partner_id: string | null;
  referral_code: string | null;
  linked_at: string | null;
  template_started_at: string | null;
  template_completed_at: string | null;
}

/** Result of validate_growth_referral_code (reveals no partner identity). */
export interface ValidateReferralResult {
  valid: boolean;
  referral_code: string | null;
}

/** Server-side code format: 6-12 uppercase alphanumerics (no NX- prefix). */
const GROWTH_CODE_RE = /^[A-Z0-9]{6,12}$/;

/**
 * Client-side normalization (trim + uppercase) for UX only.
 * The server re-normalizes and re-validates every code.
 */
export function normalizeGrowthReferralCode(code: unknown): string {
  return String(code ?? '').trim().toUpperCase();
}

/** Client-side format check (mirrors the DB CHECK; server is authoritative). */
export function isGrowthReferralCodeFormat(code: unknown): boolean {
  return GROWTH_CODE_RE.test(normalizeGrowthReferralCode(code));
}

function rpcError(context: string, error: { message?: string; code?: string } | null): Error {
  const detail = error?.message || 'Unknown database error';
  const code = error?.code ? ` (${error.code})` : '';
  return new Error(`${context}${code}: ${detail}`);
}

/**
 * Validate a referral code WITHOUT linking. Safe to call on every keystroke
 * (debounced): reveals only validity, never partner identity.
 */
export async function validateGrowthReferralCode(code: string): Promise<ValidateReferralResult> {
  const { data, error } = await supabase.rpc('validate_growth_referral_code', {
    p_code: normalizeGrowthReferralCode(code),
  });
  if (error) throw rpcError('Referral validation failed', error);
  return data as ValidateReferralResult;
}

/**
 * One-time link of the signed-in user to a Growth Partner. Throws when the
 * code is invalid/inactive, on self-referral, or when the account is already
 * linked (ownership is immutable — this never overwrites).
 */
export async function linkMyGrowthReferral(code: string): Promise<GrowthReferralRelationship> {
  const { data, error } = await supabase.rpc('link_my_growth_referral', {
    p_code: normalizeGrowthReferralCode(code),
  });
  if (error) throw rpcError('Referral linking failed', error);
  return data as GrowthReferralRelationship;
}

/** Read the signed-in user's referral relationship (null when unlinked). */
export async function getMyGrowthReferral(): Promise<GrowthReferralRelationship | null> {
  const { data, error } = await supabase.rpc('get_my_growth_referral');
  if (error) throw rpcError('Referral lookup failed', error);
  return (data ?? null) as GrowthReferralRelationship | null;
}

/** Read the signed-in user's onboarding progress (defaults when never started). */
export async function getMyOnboardingStatus(): Promise<GrowthOnboardingStatus> {
  const { data, error } = await supabase.rpc('get_my_onboarding_status');
  if (error) throw rpcError('Onboarding status lookup failed', error);
  return data as GrowthOnboardingStatus;
}

/**
 * Advance onboarding one validated step. Idempotent: repeating a step returns
 * the current state. Completion requires a prior start (server-validated).
 * Timestamps are set by the server; there is intentionally no way to pass one.
 */
export async function updateMyOnboardingProgress(
  action: OnboardingProgressAction
): Promise<GrowthOnboardingStatus> {
  const { data, error } = await supabase.rpc('update_my_onboarding_progress', {
    p_action: action,
  });
  if (error) throw rpcError('Onboarding update failed', error);
  return data as GrowthOnboardingStatus;
}

// ============================================================================
// Growth Partner area reads (Phase 2 — same anon client, same RLS model).
//
// Authorization is enforced by the DATABASE, not by route hiding:
//   • growth_partners has a SELECT-own-row-only policy, so this query returns
//     a row if and only if the signed-in user IS a Growth Partner. A normal
//     user gets zero rows (null) — the "unauthorized" state.
//   • Referral lists, KPIs and performance come from the Phase 6 RPCs at the
//     bottom of this file, which derive the partner from auth.uid() and scope
//     every query to the caller's own referrals — no partner id ever travels
//     from the browser, and counts/rates are computed on the server.
// ============================================================================

/**
 * The signed-in user's own Growth Partner row, or null when the account is
 * not a partner. RLS decides — the frontend only renders the outcome.
 */
export async function fetchMyGrowthPartnerRow(): Promise<GrowthPartner | null> {
  const { data, error } = await supabase
    .from('growth_partners')
    .select('user_id, referral_code, is_active, created_at, updated_at')
    .maybeSingle();
  if (error) throw rpcError('Growth Partner lookup failed', error);
  return (data ?? null) as GrowthPartner | null;
}

// ============================================================================
// Referral code section (Part 2.3) — display + copy, ownership via RLS.
//
// The referral code is NEVER generated, chosen or trusted from the frontend:
// it is read from the caller's OWN growth_partners row (SELECT-own-row RLS
// above), so a partner can only ever see their own code and there is no
// partner_id / user_id / URL / query parameter to manipulate. The clipboard
// helper copies ONLY the code string and keeps no browser-side state.
// ============================================================================

/** Safe copy when the partner has no referral code yet (never invented). */
export const GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE = 'Referral code not available.';

/** Structural clipboard (real `navigator` satisfies this; so do test fakes). */
export interface ClipboardLike {
  clipboard?: { writeText: (text: string) => Promise<void> } | null;
}

/**
 * Copy the referral code to the clipboard. Resolves true only when the value
 * was actually written (clipboard present and writeText resolved); otherwise
 * false — the UI keeps its "Copy" affordance instead of claiming a copy that
 * never happened. Never throws. `target` is optional (tests inject a fake);
 * the default reads the browser `navigator`.
 */
export async function copyReferralCodeToClipboard(
  code: unknown,
  target?: ClipboardLike | null
): Promise<boolean> {
  const value = String(code ?? '').trim();
  if (!value) return false;
  try {
    const nav: ClipboardLike | null =
      target ?? (typeof navigator !== 'undefined' ? (navigator as unknown as ClipboardLike) : null);
    const writeText = nav?.clipboard?.writeText;
    if (typeof writeText !== 'function') return false;
    await writeText(value);
    return true;
  } catch {
    return false;
  }
}


/** True when a Supabase/PostgREST failure means the session must be renewed. */
export function isSessionExpiredError(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as { status?: number; code?: string; message?: string };
  if (anyErr.status === 401 || anyErr.code === 'PGRST301') return true;
  const message = String((error as Error)?.message || anyErr || '');
  return /jwt expired|invalid jwt|session.*expired|not authenticated|auth.*required/i.test(message);
}

/** Page-level gate states for the Growth Partner area. */
export type GrowthPartnerGate =
  | 'loading'
  | 'mock-mode'
  | 'unauthenticated'
  | 'unauthorized'
  | 'inactive'
  | 'session-expired'
  | 'error'
  | 'ready';

/**
 * Pure gate resolver (exported for tests): maps auth + backend outcome to the
 * single state the page renders. `partnerRow === null` after a successful
 * lookup means "signed in but not a partner". A partner row with
 * `is_active === false` is DENIED entry (inactive), never silently admitted —
 * the account and its historical data are left untouched, only access is cut.
 */
export function resolveGrowthPartnerGate(input: {
  userId: string | null;
  loading: boolean;
  isMockMode: boolean;
  partnerRow: GrowthPartner | null;
  loadError: unknown;
}): GrowthPartnerGate {
  if (input.loading) return 'loading';
  if (!input.userId) return 'unauthenticated';
  if (input.isMockMode) return 'mock-mode';
  if (input.loadError) return isSessionExpiredError(input.loadError) ? 'session-expired' : 'error';
  if (!input.partnerRow) return 'unauthorized';
  if (input.partnerRow.is_active === false) return 'inactive';
  return 'ready';
}

/** Inactive partner denial copy (shared by the area gate and the login page). */
export const GROWTH_PARTNER_INACTIVE_TITLE = 'Growth Partner access is paused';
export const GROWTH_PARTNER_INACTIVE_BODY =
  'Your Growth Partner account is currently inactive. Your account and historical data are safe — contact the platform to reactivate partner access.';

/** Human label for a referral's onboarding status (the ONE reusable mapping). */
export function growthReferralStatusLabel(status: GrowthOnboardingStatusValue): string {
  switch (status) {
    case 'template_completed':
      return 'Completed';
    case 'template_started':
      return 'Website Started';
    case 'linked':
      return 'Referral Added';
    default:
      return 'Pending';
  }
}

// ============================================================================
// Verified website completion (Phase 5 — same anon client, same RLS model).
//
// The Template App calls recordTemplateCompletion() right after the existing
// explicit cloud save whose success opens "Website saved successfully!".
// Whether the website REALLY is finished is decided server-side by
// complete_template_onboarding() — the browser merely reports the outcome
// and never asserts completion itself. The onboarding screen reads the same
// completed state back through getMyOnboardingStatus() (backend source of
// truth; nothing completion-related is persisted in localStorage).
// ============================================================================

/** Safe message when the user's website does not verify as finished yet. */
export const TEMPLATE_COMPLETION_NOT_READY_MESSAGE = 'Your website setup is not complete yet.';

/** Generic message when the completion request itself fails. */
export const TEMPLATE_COMPLETION_GENERIC_MESSAGE = 'Could not update completion status. Please try again.';

/** Completion event result: the caller's progress plus the verified outcome. */
export interface TemplateCompletionResult extends GrowthOnboardingStatus {
  completed: boolean;
}

/**
 * Record the verified website-completion event for the signed-in user. The
 * RPC derives the user from the session, verifies the finished-website
 * conditions against committed database state, and advances the funnel row
 * to template_completed with server timestamps. Idempotent (safe to call
 * after every cloud save — including save retries), a no-op for users with
 * no onboarding row, and referral ownership is never touched.
 *
 * Throws only safe UI copy: the not-ready message when the website does not
 * verify yet, otherwise a generic failure message (never SQL/stack text).
 */
export async function recordTemplateCompletion(): Promise<TemplateCompletionResult> {
  try {
    const { data, error } = await supabase.rpc('complete_template_onboarding');
    if (error) throw rpcError('Template completion update failed', error);
    return data as TemplateCompletionResult;
  } catch (error) {
    throw toCompletionError(error);
  }
}

/** True when a completion failure means "website not finished yet". */
export function isCompletionNotReadyError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || '');
  return /website setup is not complete yet/i.test(message);
}

/** Maps completion failures to safe UI copy (never SQL/stack traces). */
export function toCompletionError(error: unknown): Error {
  if (isCompletionNotReadyError(error)) return new Error(TEMPLATE_COMPLETION_NOT_READY_MESSAGE);
  return new Error(TEMPLATE_COMPLETION_GENERIC_MESSAGE);
}

// ============================================================================
// Growth Partner operational dashboard (Phase 6 — same anon client, same RLS).
//
// Reads go through three server-side RPCs (20260915_growth_partner_dashboard):
// get_my_partner_dashboard / get_my_partner_referrals /
// get_my_partner_performance. Each derives the partner from auth.uid() and
// returns only that partner's own referrals — the frontend never passes a
// partner id, never filters by partner, and never computes KPI or financial
// totals. (The Phase 2 client-side list fetch + reducer were removed: counts
// and rates now come from the backend.)
// ============================================================================

/** Server-side status filter accepted by get_my_partner_referrals. */
export type PartnerReferralFilter = 'all' | 'pending' | 'in_progress' | 'completed';

/** UI labels for the referral status filter (single reusable mapping). */
export const PARTNER_REFERRAL_FILTER_LABELS: Record<PartnerReferralFilter, string> = {
  all: 'All',
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

/** One referral row for the caller's OWN referrals (masked ref, no ids). */
export interface PartnerReferralEntry {
  /** Masked reference ('…' + last 8 id chars) — never the full user id. */
  ref: string;
  /** Display name from profiles, or null when unavailable. */
  display_name: string | null;
  status: GrowthOnboardingStatusValue;
  linked_at: string | null;
  template_started_at: string | null;
  template_completed_at: string | null;
}

/** Paginated referral list with a server-side total for the pager. */
export interface PartnerReferralList {
  total: number;
  limit: number;
  offset: number;
  rows: PartnerReferralEntry[];
}

/** Recent-activity event kinds (backend activity types). */
export type PartnerActivityType = 'referral_added' | 'website_started' | 'website_completed';

/** UI labels for activity events (single reusable mapping). */
export const PARTNER_ACTIVITY_LABELS: Record<PartnerActivityType, string> = {
  referral_added: 'New referral added',
  website_started: 'User started website',
  website_completed: 'Website completed',
};

export interface PartnerActivityEntry {
  type: PartnerActivityType;
  ref: string;
  display_name: string | null;
  at: string | null;
}

export interface PartnerDashboardData {
  partner: { referral_code: string; is_active: boolean; partner_since: string };
  kpis: { total_referrals: number; active_onboarding: number; completed: number };
  recent_activity: PartnerActivityEntry[];
}

export interface PartnerMonthlyPoint {
  /** Calendar month as YYYY-MM. */
  month: string;
  referred: number;
  completed: number;
}

export interface PartnerPerformanceData {
  total_referrals: number;
  completed: number;
  active_onboarding: number;
  websites_started: number;
  completion_rate_pct: number;
  monthly: PartnerMonthlyPoint[];
}

/** One-call dashboard read: partner card + server KPIs + recent activity. */
export async function fetchMyPartnerDashboard(): Promise<PartnerDashboardData> {
  const { data, error } = await supabase.rpc('get_my_partner_dashboard');
  if (error) throw rpcError('Partner dashboard lookup failed', error);
  return data as PartnerDashboardData;
}

/** Own referrals with server-side filter, search and pagination. */
export async function fetchMyPartnerReferrals(input: {
  status?: PartnerReferralFilter;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<PartnerReferralList> {
  const { data, error } = await supabase.rpc('get_my_partner_referrals', {
    p_status_filter: input.status ?? 'all',
    p_search: input.search ?? null,
    p_limit: input.limit ?? 20,
    p_offset: input.offset ?? 0,
  });
  if (error) throw rpcError('Partner referral lookup failed', error);
  return data as PartnerReferralList;
}

/** Server-side aggregates: totals, completion rate, monthly history. */
export async function fetchMyPartnerPerformance(): Promise<PartnerPerformanceData> {
  const { data, error } = await supabase.rpc('get_my_partner_performance');
  if (error) throw rpcError('Partner performance lookup failed', error);
  return data as PartnerPerformanceData;
}

/** Generic message for dashboard section failures (never SQL/database text). */
export const PARTNER_SECTION_ERROR_MESSAGE = 'Could not load this section. Please try again.';

/**
 * Maps dashboard RPC failures to safe UI copy. Only the backend's own safe
 * messages pass through; everything else becomes the generic retry message
 * so raw SQL/database errors are never displayed.
 */
export function toSafePartnerSectionError(error: unknown): Error {
  const message = String((error as Error)?.message || error || '');
  const safe = message.match(/Growth Partner access required|Sign in required|Unknown referral filter/i);
  if (safe) return new Error(safe[0]);
  return new Error(PARTNER_SECTION_ERROR_MESSAGE);
}
