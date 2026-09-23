import type { ReferralStatus, ReferralStatusCounts } from './referralStatus';
import { supabase } from './supabaseClient';
import { projectReferralRelationship, projectValidationResponse } from './safePartnerResponse';
// The failure predicates and the operator-facing setup copy live in ONE module
// (`partnerAreaFailure.ts`) so the browser screen, the live diagnostic and the
// operator script can never disagree about what a failure means. Re-exported
// here because this module is the area's public front door.
import {
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
  isMissingPartnerSchemaError,
  isPartnerSuspendedError,
  isSessionExpiredError,
} from './partnerAreaFailure';

export {
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
  isMissingPartnerSchemaError,
  isPartnerSuspendedError,
  isSessionExpiredError,
};

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

/**
 * The caller's referral relationship (get_my_growth_referral / link result).
 *
 * Projected through `safePartnerResponse.ts`: these five fields are the
 * complete answer, and `linked_at`/`status` stay null when the backend did not
 * supply a usable value rather than being invented.
 */
export interface GrowthReferralRelationship {
  growth_partner_id: string;
  referral_code: string;
  linked_at: string | null;
  status: GrowthOnboardingStatusValue | null;
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

/** Server-side code format: Legacy alphanumerics or public NEXORA-prefixed codes. */
const GROWTH_CODE_RE = /^(?:[A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$/;

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

function rpcError(context: string, error: { message?: string; code?: string; status?: number } | null): Error {
  const detail = error?.message || 'Unknown database error';
  const code = error?.code ? ` (${error.code})` : '';
  return Object.assign(new Error(`${context}${code}: ${detail}`), { code: error?.code, status: error?.status });
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
  // 5.2 SAFE RESPONSE: a validation answer is built from the allowlist
  // ({valid, referral_code}) instead of being cast from the RPC payload, so a
  // widened jsonb cannot hand the browser private partner profile data,
  // internal ids, bank details, commission configuration, admin metadata or
  // private contact details. A `token` is never accepted here: code validation
  // must not smuggle a signup capability into the client's hands.
  const safe = projectValidationResponse('validate-code', data);
  return { valid: safe.valid, referral_code: safe.referralCode };
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
  // 5.2 SAFE RESPONSE: keep only the documented relationship fields. The
  // related-user answer discloses the partner's display name on purpose, but a
  // row that grew bank/commission/admin/contact fields must not reach state.
  const relationship = projectReferralRelationship(data);
  // A response without a usable partner id + canonical code did not establish
  // a relationship: fail closed instead of returning a half-populated object.
  if (!relationship) throw rpcError('Referral linking failed', { message: 'incomplete relationship' });
  return relationship;
}

/** Read the signed-in user's referral relationship (null when unlinked). */
export async function getMyGrowthReferral(): Promise<GrowthReferralRelationship | null> {
  const { data, error } = await supabase.rpc('get_my_growth_referral');
  if (error) throw rpcError('Referral lookup failed', error);
  return projectReferralRelationship(data);
}

/** Read the signed-in user's onboarding progress (defaults when never started). */
export async function getMyOnboardingStatus(): Promise<GrowthOnboardingStatus> {
  return readPartnerPayload('Onboarding status lookup failed', normalizeGrowthOnboardingStatus,
    () => supabase.rpc('get_my_onboarding_status'));
}

/**
 * Advance onboarding one validated step. Idempotent: repeating a step returns
 * the current state. Completion requires a prior start (server-validated).
 * Timestamps are set by the server; there is intentionally no way to pass one.
 */
export async function updateMyOnboardingProgress(
  action: OnboardingProgressAction
): Promise<GrowthOnboardingStatus> {
  return readPartnerPayload('Onboarding update failed', normalizeGrowthOnboardingStatus,
    () => supabase.rpc('update_my_onboarding_progress', { p_action: action }));
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

/** One row of the signed-in user's own KYC application, as RLS lets them see it. */
export interface GrowthPartnerApplicationRow {
  id: string;
  /**
   * Backend status. A drifted/unrecognized value is preserved verbatim instead
   * of being guessed: `resolveGrowthPartnerGate` then simply does not match
   * `pending`/`rejected`, which fails closed to "unauthorized" exactly as
   * before.
   */
  status: 'pending' | 'approved' | 'rejected' | (string & {});
  kyc_status: string | null;
  created_at: string;
}

/**
 * The caller's own application row. The committed policy
 * `growth_partner_applications_self_select` allows exactly this read, so it
 * tells "your application is under review" apart from "you never applied".
 * Returns null when there is no application (or the read is unavailable) —
 * never a guess about access.
 */
export async function fetchMyGrowthPartnerApplication(): Promise<GrowthPartnerApplicationRow | null> {
  const rows = await readPartnerPayload<GrowthPartnerApplicationRow[]>(
    'Partner application lookup failed',
    (raw) => list(raw, normalizeGrowthPartnerApplicationRow),
    () => supabase
      .from('growth_partner_applications')
      .select('id, status, kyc_status, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
  );
  return rows[0] ?? null;
}

/**
 * The signed-in user's own Growth Partner row, or null when the account is
 * not a partner. RLS decides — the frontend only renders the outcome.
 */
export async function fetchMyGrowthPartnerRow(): Promise<GrowthPartner | null> {
  return readPartnerPayload('Growth Partner lookup failed', normalizeGrowthPartnerRow,
    () => supabase.rpc('get_my_growth_partner'));
}

/**
 * Ensure the authenticated caller has a partner row, then return that row.
 * The RPC accepts no user id: the database provisions auth.uid() only and
 * preserves an existing suspended partner instead of reactivating it.
 *
 * A missing enrollment RPC is reported as such (isMissingPartnerSchemaError)
 * so callers can distinguish "the database says you are not a partner" from
 * "this project never had the migration applied".
 */
export async function ensureMyGrowthPartner(): Promise<GrowthPartner> {
  const { data, error } = await supabase.rpc('ensure_my_growth_partner');
  if (error) throw rpcError('Growth Partner activation failed', error);
  return data as GrowthPartner;
}

/**
 * Self-service enrollment used by the "Instantly Approve & Access" affordances
 * on the denial/pending screens.
 *
 * It is deliberately the SAME session-scoped RPC the verification path calls:
 * the backend derives the identity from the JWT (`auth.uid()`), so this can
 * only ever enroll the caller — it cannot name another user id, cannot be
 * pointed at a partner id, and never reactivates a suspended row. There is no
 * service-role key in the browser.
 *
 * Throws (never resolves as a silent no-op) when the RPC is missing, so the
 * UI can say what is actually wrong instead of re-checking forever.
 */
export async function approveDemoGrowthPartnerAccount(): Promise<GrowthPartner> {
  const row = await readPartnerPayload('Growth Partner activation failed', normalizeGrowthPartnerRow, () =>
    supabase.rpc('ensure_my_growth_partner')
  );
  if (!row) {
    throw new Error('Growth Partner activation returned no partner row. Please try again.');
  }
  return row;
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


// `isSessionExpiredError` / `isPartnerSuspendedError` are re-exported at the
// top of this file from `partnerAreaFailure.ts` (one definition per predicate).

/** Page-level gate states for the Growth Partner area. */
export type GrowthPartnerGate =
  | 'loading'
  | 'mock-mode'
  | 'unauthenticated'
  | 'unauthorized'
  | 'pending'
  | 'rejected'
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
  applicationStatus?: string | null;
}): GrowthPartnerGate {
  if (input.loading) return 'loading';
  if (!input.userId) return 'unauthenticated';
  if (input.isMockMode) return 'mock-mode';
  if (input.loadError) return isSessionExpiredError(input.loadError) ? 'session-expired' : isPartnerSuspendedError(input.loadError) ? 'inactive' : 'error';
  if (!input.partnerRow) {
    if (input.applicationStatus === 'pending') return 'pending';
    if (input.applicationStatus === 'rejected') return 'rejected';
    return 'unauthorized';
  }
  if (input.partnerRow.is_active === false) return 'inactive';
  return 'ready';
}

/** Inactive partner denial copy (shared by the area gate and the login page). */
export const GROWTH_PARTNER_INACTIVE_TITLE = 'Growth Partner access is paused';
export const GROWTH_PARTNER_INACTIVE_BODY =
  'Your Growth Partner account is currently suspended. Please contact support for assistance.';

/** Human label for a referral's onboarding status (the ONE reusable mapping). */
export function growthReferralStatusLabel(status: GrowthOnboardingStatusValue | null): string {
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
    return await readPartnerPayload('Template completion update failed', normalizeTemplateCompletion,
      () => supabase.rpc('complete_template_onboarding'));
  } catch (error) {
    throw toCompletionError(error);
  }
}

/** Completion result: the normalized progress plus the backend's verified flag. */
export function normalizeTemplateCompletion(raw: unknown): TemplateCompletionResult {
  return { ...normalizeGrowthOnboardingStatus(raw), completed: record(raw)?.completed === true };
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
export type PartnerReferralFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'inactive' | 'cancelled' | 'rejected';

/** UI labels for the referral status filter (single reusable mapping). */
export const PARTNER_REFERRAL_FILTER_LABELS: Record<PartnerReferralFilter, string> = {
  all: 'All',
  pending: 'Pending',
  in_progress: 'Active',
  completed: 'Converted',
  inactive: 'Inactive',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

/** One referral row for the caller's OWN referrals (masked ref, no ids). */
export interface PartnerReferralEntry {
  /** Opaque referral-record identifier, never the auth user ID. */
  referral_id?: string;
  referral_clicked_at?: string | null;
  referral_status?: ReferralStatus;
  /** Masked in the backend; raw contact details are never returned. */
  masked_contact?: string | null;
  joined_at?: string | null;
  referral_code?: string | null;
  conversion_status?: 'converted' | 'not_converted' | null;
  /** Latest referral milestone, not private login/authentication activity. */
  last_activity_at?: string | null;
  /** Masked reference ('…' + last 8 id chars) — never the full user id. */
  ref: string;
  /** Display name from profiles, or null when unavailable. */
  display_name: string | null;
  status: GrowthOnboardingStatusValue | null;
  linked_at: string | null;
  template_started_at: string | null;
  template_completed_at: string | null;
}

/** Paginated referral list with a server-side total for the pager. */
export interface PartnerReferralList {
  /**
   * All matching referrals, independent of selected status and pagination.
   * Partial on purpose: a status the backend did not count renders as '—'
   * rather than as an invented zero.
   */
  status_counts?: Partial<ReferralStatusCounts>;
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

export interface PartnerReferralActivity {
  recentReferrals: { referralId: string; name: string; date: string; status: ReferralStatus | null }[];
  /** Null when the backend did not supply the count (rendered as '—'). */
  last7DaysReferrals: number | null;
  dailyReferrals: { date: string; count: number }[];
  window: { from: string; asOf: string; timeZone: 'UTC' };
}

export interface PartnerDashboardData {
  /** Backend-owned analytics; absent only during a rolling schema upgrade. */
  referralActivity?: PartnerReferralActivity;
  /** Authoritative registered-referral aggregates; optional for rolling upgrades. */
  totalReferrals?: number;
  activeReferrals?: number;
  pendingReferrals?: number;
  convertedReferrals?: number;
  referral_status_counts?: Partial<Record<ReferralStatus, number>>;
  /**
   * Partner card. A value the backend did not supply stays null/'' so the UI
   * can say "not available" instead of inventing a code, a status or a date.
   */
  partner: { referral_code: string; is_active: boolean | null; partner_since: string | null };
  /** Counts are null when unknown — the KPI chips render '—', never a fake 0. */
  kpis: { total_referrals: number | null; active_onboarding: number | null; completed: number | null };
  recent_activity: PartnerActivityEntry[];
}

export interface PartnerMonthlyPoint {
  /** Calendar month as YYYY-MM. */
  month: string;
  referred: number;
  completed: number;
}

export interface PartnerPerformanceData {
  /** Aggregates are null when the backend omitted them (rendered as '—'). */
  total_referrals: number | null;
  completed: number | null;
  active_onboarding: number | null;
  websites_started: number | null;
  completion_rate_pct: number | null;
  monthly: PartnerMonthlyPoint[];
}

// ============================================================================
// Defensive normalization — every read returns a COMPLETE, safe shape.
//
// These RPC payloads cross a network and a schema that may be one migration
// behind, so they are treated as untrusted input:
//   • arrays are always arrays — a missing `rows` / `recent_activity` /
//     `monthly` can never become an undefined `.map` in React,
//   • objects are always objects — no `dashboard.partner` property crash,
//   • a value the backend did not send stays null/'' and renders as '—',
//     'Unknown' or "not available"; a count is never invented as 0,
//   • the mapping itself runs inside try/catch, so even a payload that throws
//     while being read degrades to a safe default instead of unmounting the
//     page into the root ErrorBoundary ("Something went wrong").
//
// This mirrors the normalization layer the partner-operations API already
// applies (src/lib/partnerPortalOperations.ts).
// ============================================================================

/** Page size the referral RPCs default to; also the fallback when `limit` is absent. */
export const PARTNER_REFERRAL_PAGE_SIZE = 20;

/** Statuses the referral funnel can report (mirrors src/lib/referralStatus.ts). */
const REFERRAL_STATUS_VALUES: readonly ReferralStatus[] = [
  'clicked',
  'registered',
  'pending',
  'active',
  'converted',
  'inactive',
  'cancelled',
  'rejected',
];

/** Onboarding lifecycle values (forward-only, terminal at completed). */
const ONBOARDING_STATUS_VALUES: readonly GrowthOnboardingStatusValue[] = [
  'not_started',
  'linked',
  'template_started',
  'template_completed',
];

/** Plain-object view of untrusted JSON, or null (arrays/scalars are rejected). */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** String value; a missing value becomes '' (the UI renders '—'/fallback copy). */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined || typeof value === 'object' ? '' : String(value);
}

/** Non-empty string, or null. Values are never coerced into truthy garbage. */
function nullableText(value: unknown): string | null {
  const trimmed = text(value).trim();
  return trimmed ? trimmed : null;
}

/** Finite number or null — an unknown count stays unknown instead of NaN/0. */
function nullableNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Finite number or `fallback` — for values that must be numeric. */
function num(value: unknown, fallback = 0): number {
  return nullableNum(value) ?? fallback;
}

/** Strict tri-state boolean: only a real boolean/1/0 is accepted. */
function nullableFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/** Map an array, dropping entries the mapper rejects; a non-array becomes []. */
function list<T>(value: unknown, map: (row: unknown, index: number) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const rows: T[] = [];
  value.forEach((row, index) => {
    try {
      const mapped = map(row, index);
      if (mapped !== null) rows.push(mapped);
    } catch {
      // One malformed row must never blank the whole list.
    }
  });
  return rows;
}

/** Run a transformation, falling back to a safe default instead of throwing. */
function safely<T>(label: string, build: () => T, fallback: T): T {
  try {
    return build();
  } catch (error) {
    if (typeof console !== 'undefined') {
      console.warn(`[growth-partner] ${label} could not be normalized; showing safe defaults instead.`, error);
    }
    return fallback;
  }
}

function referralStatus(value: unknown): ReferralStatus | null {
  return typeof value === 'string' && (REFERRAL_STATUS_VALUES as readonly string[]).includes(value)
    ? (value as ReferralStatus)
    : null;
}

function onboardingStatus(value: unknown): GrowthOnboardingStatusValue | null {
  return typeof value === 'string' && (ONBOARDING_STATUS_VALUES as readonly string[]).includes(value)
    ? (value as GrowthOnboardingStatusValue)
    : null;
}

/**
 * Only tab/status keys the UI knows are kept; unknown keys are dropped, never
 * echoed. `all` is the tab total rather than a referral status, so it is kept
 * explicitly — dropping it would render the "All" tab as `All (—)`.
 */
function statusCounts(value: unknown): Partial<ReferralStatusCounts> | undefined {
  const counts = record(value);
  if (!counts) return undefined;
  const safe: Record<string, number> = {};
  for (const [key, raw] of Object.entries(counts)) {
    const count = nullableNum(raw);
    if (count === null) continue;
    if (key === 'all') {
      safe.all = count;
      continue;
    }
    const status = referralStatus(key);
    if (status) safe[status] = count;
  }
  return safe as Partial<ReferralStatusCounts>;
}

/** One referral row, or null when the entry is not an object at all. */
export function normalizePartnerReferralEntry(raw: unknown): PartnerReferralEntry | null {
  const row = record(raw);
  if (!row) return null;
  return safely('referral row', () => ({
    referral_id: nullableText(row.referral_id) ?? undefined,
    referral_clicked_at: nullableText(row.referral_clicked_at),
    referral_status: referralStatus(row.referral_status) ?? undefined,
    masked_contact: nullableText(row.masked_contact),
    joined_at: nullableText(row.joined_at),
    referral_code: nullableText(row.referral_code),
    conversion_status: row.conversion_status === 'converted' || row.conversion_status === 'not_converted'
      ? row.conversion_status
      : null,
    last_activity_at: nullableText(row.last_activity_at),
    // `ref` is the row's display identity: '' keeps it renderable (the table
    // shows "Referred user") instead of printing "undefined".
    ref: text(row.ref).trim(),
    display_name: nullableText(row.display_name),
    status: onboardingStatus(row.status),
    linked_at: nullableText(row.linked_at),
    template_started_at: nullableText(row.template_started_at),
    template_completed_at: nullableText(row.template_completed_at),
  }), null);
}

/** A paginated referral list that is always safe to iterate and page through. */
export function normalizePartnerReferralList(raw: unknown): PartnerReferralList {
  const payload = record(raw) ?? {};
  return safely<PartnerReferralList>('referral list', () => {
    const rows = list(payload.rows, normalizePartnerReferralEntry);
    const counts = statusCounts(payload.status_counts);
    return {
      ...(counts ? { status_counts: counts } : {}),
      // `total` drives the empty state and the pager: it can never be smaller
      // than the page we actually received.
      total: Math.max(num(payload.total, rows.length), rows.length),
      // A zero/negative/NaN page size is "the backend did not tell us", not a
      // real window: fall back to the app's page size (a 0 here would make the
      // page-offset math divide by zero).
      limit: Math.trunc(nullableNum(payload.limit) ?? PARTNER_REFERRAL_PAGE_SIZE) >= 1
        ? Math.trunc(nullableNum(payload.limit) ?? PARTNER_REFERRAL_PAGE_SIZE)
        : PARTNER_REFERRAL_PAGE_SIZE,
      offset: Math.max(0, Math.trunc(nullableNum(payload.offset) ?? 0)),
      rows,
    };
  }, { total: 0, limit: PARTNER_REFERRAL_PAGE_SIZE, offset: 0, rows: [] });
}

/** One recent-activity event; an unrecognized kind renders as "Referral update". */
export function normalizePartnerActivityEntry(raw: unknown): PartnerActivityEntry | null {
  const row = record(raw);
  if (!row) return null;
  return safely('activity entry', () => ({
    type: (text(row.type) || 'unknown') as PartnerActivityType,
    ref: text(row.ref).trim(),
    display_name: nullableText(row.display_name),
    at: nullableText(row.at),
  }), null);
}

/** Last-7-days/recent-referrals analytics, or undefined when not supplied. */
export function normalizePartnerReferralActivity(raw: unknown): PartnerReferralActivity | undefined {
  const activity = record(raw);
  if (!activity) return undefined;
  return safely('referral activity', () => {
    const window = record(activity.window) ?? {};
    return {
      recentReferrals: list(activity.recentReferrals, (row) => {
        const entry = record(row);
        if (!entry) return null;
        return {
          referralId: text(entry.referralId),
          name: text(entry.name),
          date: text(entry.date),
          status: referralStatus(entry.status),
        };
      }),
      last7DaysReferrals: nullableNum(activity.last7DaysReferrals),
      dailyReferrals: list(activity.dailyReferrals, (row) => {
        const point = record(row);
        return point ? { date: text(point.date), count: num(point.count) } : null;
      }),
      window: { from: text(window.from), asOf: text(window.asOf), timeZone: 'UTC' },
    };
  }, undefined);
}

/**
 * The dashboard payload. Never null: an empty/rolled-back answer becomes a
 * well-formed object whose unknown values render as '—' / "not available" and
 * whose lists are empty, so the section shows its honest empty state.
 */
export function normalizePartnerDashboardData(raw: unknown): PartnerDashboardData {
  const payload = record(raw) ?? {};
  return safely<PartnerDashboardData>('partner dashboard', () => {
    const partner = record(payload.partner) ?? {};
    const kpis = record(payload.kpis) ?? {};
    return {
      referralActivity: normalizePartnerReferralActivity(payload.referralActivity),
      totalReferrals: nullableNum(payload.totalReferrals) ?? undefined,
      activeReferrals: nullableNum(payload.activeReferrals) ?? undefined,
      pendingReferrals: nullableNum(payload.pendingReferrals) ?? undefined,
      convertedReferrals: nullableNum(payload.convertedReferrals) ?? undefined,
      referral_status_counts: statusCounts(payload.referral_status_counts),
      partner: {
        referral_code: text(partner.referral_code).trim(),
        is_active: nullableFlag(partner.is_active),
        partner_since: nullableText(partner.partner_since),
      },
      kpis: {
        total_referrals: nullableNum(kpis.total_referrals),
        active_onboarding: nullableNum(kpis.active_onboarding),
        completed: nullableNum(kpis.completed),
      },
      recent_activity: list(payload.recent_activity, normalizePartnerActivityEntry),
    };
  }, {
    partner: { referral_code: '', is_active: null, partner_since: null },
    kpis: { total_referrals: null, active_onboarding: null, completed: null },
    recent_activity: [],
  });
}

/** Performance aggregates with an always-iterable monthly series. */
export function normalizePartnerPerformanceData(raw: unknown): PartnerPerformanceData {
  const payload = record(raw) ?? {};
  return safely('partner performance', () => ({
    total_referrals: nullableNum(payload.total_referrals),
    completed: nullableNum(payload.completed),
    active_onboarding: nullableNum(payload.active_onboarding),
    websites_started: nullableNum(payload.websites_started),
    completion_rate_pct: nullableNum(payload.completion_rate_pct),
    monthly: list(payload.monthly, (row) => {
      const point = record(row);
      if (!point) return null;
      return { month: text(point.month).trim(), referred: num(point.referred), completed: num(point.completed) };
    }),
  }), {
    total_referrals: null,
    completed: null,
    active_onboarding: null,
    websites_started: null,
    completion_rate_pct: null,
    monthly: [],
  });
}

/** Onboarding progress. `linked` follows the backend value, else the status. */
export function normalizeGrowthOnboardingStatus(raw: unknown): GrowthOnboardingStatus {
  const payload = record(raw) ?? {};
  return safely('onboarding status', () => {
    const status = onboardingStatus(payload.status)
      ?? (nullableFlag(payload.linked) === true ? 'linked' : 'not_started');
    return {
      status,
      linked: nullableFlag(payload.linked) ?? status !== 'not_started',
      growth_partner_id: nullableText(payload.growth_partner_id),
      referral_code: nullableText(payload.referral_code),
      linked_at: nullableText(payload.linked_at),
      template_started_at: nullableText(payload.template_started_at),
      template_completed_at: nullableText(payload.template_completed_at),
    };
  }, {
    status: 'not_started',
    linked: false,
    growth_partner_id: null,
    referral_code: null,
    linked_at: null,
    template_started_at: null,
    template_completed_at: null,
  });
}

/** One KYC application row (status preserved verbatim — never guessed). */
export function normalizeGrowthPartnerApplicationRow(raw: unknown): GrowthPartnerApplicationRow | null {
  const row = record(raw);
  if (!row) return null;
  return safely('partner application', () => ({
    id: text(row.id),
    status: text(row.status) || 'pending',
    kyc_status: nullableText(row.kyc_status),
    created_at: text(row.created_at),
  }), null);
}

/**
 * The caller's own Growth Partner row, or null when the caller is not a
 * partner. `is_active` follows the gate's rule exactly — only an explicit
 * `false` is "paused", so a payload that omits the flag cannot lock a partner
 * out of their own area.
 */
export function normalizeGrowthPartnerRow(raw: unknown): GrowthPartner | null {
  const row = record(raw);
  if (!row) return null;
  return safely('partner row', () => ({
    user_id: text(row.user_id),
    referral_code: text(row.referral_code).trim(),
    is_active: nullableFlag(row.is_active) !== false,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  }), null);
}

/**
 * Run one read and normalize its payload. Transport failures stay classified
 * (`rpcError` keeps message/code/status) so the page can still tell a session
 * expiry from a suspension and offer the right recovery — but they can never
 * arrive as an unhandled throw or as `undefined` data.
 */
async function readPartnerPayload<T>(
  context: string,
  normalize: (raw: unknown) => T,
  run: () => PromiseLike<{ data?: unknown; error?: unknown }>
): Promise<T> {
  let settled: { data?: unknown; error?: unknown };
  try {
    // postgrest-js REJECTS on some failures instead of resolving with
    // `{ error }`; both shapes land in the same classified error below.
    settled = await Promise.resolve(run()).then(
      (result) => result ?? {},
      (thrown) => ({ error: thrown })
    );
  } catch (thrown) {
    // A transport that throws synchronously is classified the same way.
    settled = { error: thrown };
  }
  if (settled.error) {
    const failure = settled.error as { message?: string; code?: string; status?: number };
    throw rpcError(context, failure);
  }
  return normalize(settled.data);
}

/** One-call dashboard read: partner card + server KPIs + recent activity. */
export async function fetchMyPartnerDashboard(): Promise<PartnerDashboardData> {
  return readPartnerPayload('Partner dashboard lookup failed', normalizePartnerDashboardData,
    () => supabase.rpc('get_my_partner_dashboard'));
}

/** Own referrals with server-side filter, search and pagination. */
export async function fetchMyPartnerReferrals(input: {
  status?: PartnerReferralFilter;
  search?: string;
  limit?: number;
  offset?: number;
  joinedFrom?: string;
  joinedBefore?: string;
  conversion?: 'all' | 'converted' | 'not_converted';
  sort?: 'newest' | 'oldest' | 'recently_active';
}): Promise<PartnerReferralList> {
  const extended = !!(input.joinedFrom || input.joinedBefore || (input.conversion && input.conversion !== 'all') || (input.sort && input.sort !== 'newest'));
  const args = {
    p_status_filter: input.status ?? 'all', p_search: input.search ?? null,
    p_limit: input.limit ?? 20, p_offset: input.offset ?? 0,
  };
  return readPartnerPayload('Partner referral lookup failed', normalizePartnerReferralList, () => (
    extended
      ? supabase.rpc('get_my_partner_referrals_filtered', {
          ...args, p_joined_from: input.joinedFrom ?? null, p_joined_before: input.joinedBefore ?? null,
          p_conversion: input.conversion ?? 'all', p_sort: input.sort ?? 'newest',
        })
      : readPartnerReferralPage({
          p_status_filter: input.status ?? 'all',
          p_search: input.search ?? null,
          p_limit: input.limit ?? 20,
          p_offset: input.offset ?? 0,
        })
  ));
}

/**
 * The four sanctioned arguments of the session-scoped referral page read — the
 * caller's identity is derived by the backend from the JWT, so no partner id,
 * user id or filter-by-partner ever travels from the browser (audit-pinned).
 */
function readPartnerReferralPage(page: {
  p_status_filter: PartnerReferralFilter;
  p_search: string | null;
  p_limit: number;
  p_offset: number;
}) {
  return supabase.rpc('get_my_partner_referrals', {
    p_status_filter: page.p_status_filter,
    p_search: page.p_search,
    p_limit: page.p_limit,
    p_offset: page.p_offset,
  });
}

/** Server-side aggregates: totals, completion rate, monthly history. */
export async function fetchMyPartnerPerformance(): Promise<PartnerPerformanceData> {
  return readPartnerPayload('Partner performance lookup failed', normalizePartnerPerformanceData,
    () => supabase.rpc('get_my_partner_performance'));
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
  if (isPartnerSuspendedError(error)) return new Error('Your Growth Partner access is paused. Contact support to reactivate it.');
  if (/network|failed to fetch|fetch failed|connection|timeout/i.test(message)) return new Error('Network error. Check your connection and try again.');
  if (isSessionExpiredError(error) && !/sign in required/i.test(message)) return new Error('Your session expired. Please sign in again.');
  const safe = message.match(/Growth Partner access required|Sign in required|Unknown referral filter/i);
  if (safe) return new Error(safe[0]);
  return new Error(PARTNER_SECTION_ERROR_MESSAGE);
}

/** Read-only, own-partner detail lookup. Null also covers another partner's ID. */
export async function fetchMyPartnerReferralDetail(referralId: string): Promise<PartnerReferralEntry | null> {
  try {
    return await readPartnerPayload('Referral detail lookup failed', normalizePartnerReferralEntry,
      () => supabase.rpc('get_my_partner_referral_detail', { p_referral_id: referralId }));
  } catch (error) {
    // The drawer shows safe copy, never SQL/database text.
    throw toSafePartnerSectionError(error);
  }
}
