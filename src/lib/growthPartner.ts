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
