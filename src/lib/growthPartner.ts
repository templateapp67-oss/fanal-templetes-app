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
//   • growth_onboarding is readable only for one's own row plus (for partners)
//     rows whose growth_partner_id is the caller. The query additionally
//     filters growth_partner_id server-side, so the page never downloads
//     another partner's referrals and filters in React.
// ============================================================================

/** One referral row as readable by its Growth Partner (no cross-partner PII). */
export interface GrowthReferralRow {
  user_id: string;
  status: GrowthOnboardingStatusValue;
  linked_at: string | null;
  template_started_at: string | null;
  template_completed_at: string | null;
  /** Selected so the client can defensively drop any row that is not its own. */
  growth_partner_id?: string | null;
}

/** Dashboard summary counts, computed from the partner's own referral rows. */
export interface GrowthReferralSummary {
  total: number;
  onboarding: number;
  completed: number;
}

/**
 * Pure summary reducer (exported for tests): total referred users, completed
 * users, and users still onboarding (total minus completed).
 */
export function summarizeGrowthReferrals(rows: GrowthReferralRow[]): GrowthReferralSummary {
  const list = Array.isArray(rows) ? rows : [];
  const completed = list.filter((row) => row?.status === 'template_completed').length;
  return { total: list.length, onboarding: list.length - completed, completed };
}

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

/**
 * Referral rows belonging to ONE partner. The growth_partner_id filter runs
 * server-side, and RLS independently restricts the caller to their own
 * referrals — a partner can never receive another partner's rows.
 */
export async function fetchMyGrowthReferrals(partnerUserId: string): Promise<GrowthReferralRow[]> {
  const { data, error } = await supabase
    .from('growth_onboarding')
    .select('user_id, status, linked_at, template_started_at, template_completed_at')
    .eq('growth_partner_id', partnerUserId)
    .order('linked_at', { ascending: false });
  if (error) throw rpcError('Referral list lookup failed', error);
  return ((data ?? []) as GrowthReferralRow[]).filter(
    (row) => row && row.user_id && row.growth_partner_id !== undefined
  );
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
  | 'session-expired'
  | 'error'
  | 'ready';

/**
 * Pure gate resolver (exported for tests): maps auth + backend outcome to the
 * single state the page renders. `partnerRow === null` after a successful
 * lookup means "signed in but not a partner".
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
  return 'ready';
}

/** Human label for a referral's onboarding status (dashboard + list). */
export function growthReferralStatusLabel(status: GrowthOnboardingStatusValue): string {
  switch (status) {
    case 'template_completed':
      return 'Completed';
    case 'template_started':
      return 'Template started';
    case 'linked':
      return 'Onboarding';
    default:
      return 'Linked';
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
