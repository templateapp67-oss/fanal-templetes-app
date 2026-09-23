// ============================================================================
// Growth Partner SERVICE FACADE — the one entry point every partner screen uses.
//
//   const result = await growthPartnerService.getEarnings({ limit: 25, offset: 0 });
//   if (result.ok) render(result.data);       // money is in PAISE (integers)
//   else show(result.error.message, result.error.toFailure());
//
// Three rules this facade exists to enforce:
//
//   1. NO partner id, ever. Identity comes from the session JWT: every function
//      below delegates to a `*my_partner*` / `get_my_partner_*` call that
//      derives the caller from `auth.uid()` inside the database. No function in
//      this module takes a partner/user id, and none may be added (the audit
//      pins it: `src/lib/growthPartner.ts` — "no partner id, user id or
//      filter-by-partner ever travels from the browser").
//
//   2. MONEY IS PAISE. Every monetary field is a whole number of paise
//      (`₹1 = 100`). The facade validates that against the raw answer instead of
//      trusting the shared normalizers, whose `num()` coercion turns a missing
//      field into `0`.
//
//   3. NEVER A FAKE ZERO. `{ ok: false, error }` means exactly that: the value
//      is unknown. An empty-but-valid answer (`{ ok: true }` with real zeros)
//      stays distinguishable, because it comes from the backend rather than from
//      a fallback. A refused or malformed money field becomes an `error`, never
//      a zero balance, a zero earning or a zero count.
//
// Delegation (nothing here re-implements transport or access control):
//   • gate + dashboard/referrals/performance/detail reads → `src/lib/growthPartner.ts`
//     (audited session-scoped RPC wrappers, classified with `rpcError`).
//   • earnings/payouts/levels/leaderboard/notifications/marketing/support →
//     `src/lib/partnerPortalOperations.ts` (`callPartnerOperation`: API route
//     first, PostgREST RPC as the standing fallback, bounded by a timeout, with
//     every refusal classified by `partnerOperationError`).
//   • failure causes → `src/lib/partnerAreaFailure.ts`, the SAME classifier the
//     failure screens and the operator script use, so a screen, a report and a
//     terminal diagnosis can never disagree.
// ============================================================================

import {
  ensureMyGrowthPartner,
  fetchMyGrowthPartnerApplication,
  fetchMyGrowthPartnerRow,
  fetchMyPartnerDashboard,
  fetchMyPartnerPerformance,
  fetchMyPartnerReferralDetail,
  fetchMyPartnerReferrals,
  type GrowthPartner,
  type GrowthPartnerApplicationRow,
  type PartnerDashboardData,
  type PartnerPerformanceData,
  type PartnerReferralEntry,
  type PartnerReferralFilter,
  type PartnerReferralList,
} from '../lib/growthPartner';
import {
  PARTNER_MINIMUM_PAYOUT_PAISE,
  callPartnerOperation,
  normalizeMarketingAssets,
  normalizeSupportTickets,
  type PartnerEarningRow,
  type PartnerEarningsPayload,
  type PartnerLeaderboardPayload,
  type PartnerLeaderboardRow,
  type PartnerLevelRow,
  type PartnerLevelsPayload,
  type PartnerMarketingAsset,
  type PartnerMarketingCategory,
  type PartnerNotificationPreferences,
  type PartnerNotificationsPayload,
  type PartnerNotificationRow,
  type PartnerPayoutMethod,
  type PartnerPayoutRequestRow,
  type PartnerPayoutRequestsPayload,
  type PartnerSupportTicketReceipt,
  type PartnerSupportTicketRow,
  type PartnerTicketPriority,
} from '../lib/partnerPortalOperations';
import {
  classifyPartnerAreaFailure,
  partnerContractMismatch,
  partnerInputInvalid,
  type PartnerAreaFailure,
} from '../lib/partnerAreaFailure';
import {
  GROWTH_PARTNER_INACTIVE_BODY,
  PARTNER_SECTION_ERROR_MESSAGE,
} from '../lib/growthPartner';

// ---------------------------------------------------------------------------
// Result contract
// ---------------------------------------------------------------------------

/** Every function in this module resolves with this — it never rejects. */
export type GrowthPartnerResult<T> = { ok: true; data: T } | { ok: false; error: GrowthPartnerServiceError };

/**
 * A failed service call, as data.
 *
 * It is a real `Error` (so throw-based helpers such as `usePartnerQuery`, error
 * boundaries and `partnerQueryErrorMessage` keep working) and it carries the
 * classified cause, so a screen can say WHO has to act instead of printing
 * "Please try again" for something a retry cannot fix.
 */
export class GrowthPartnerServiceError extends Error {
  readonly kind: PartnerAreaFailure['kind'];
  readonly scope: PartnerAreaFailure['scope'];
  readonly owner: PartnerAreaFailure['owner'];
  readonly retryable: boolean;
  readonly code: string | null;
  readonly status: number | null;
  /** Allow-listed, non-sensitive slice of the server message (or null). */
  readonly safeDetail: string | null;
  /** The full classified failure (badge, scope sentence, next step, operator action). */
  readonly failure: PartnerAreaFailure;

  constructor(failure: PartnerAreaFailure, message?: string) {
    super(message ?? shortServiceMessage(failure));
    this.name = 'GrowthPartnerServiceError';
    this.kind = failure.kind;
    this.scope = failure.scope;
    this.owner = failure.owner;
    this.retryable = failure.retryable;
    this.code = failure.code;
    this.status = failure.status;
    this.safeDetail = failure.safeDetail;
    this.failure = failure;
  }

  /** Classify anything a rejected promise (or a guard) produced. */
  static from(raw: unknown): GrowthPartnerServiceError {
    const online = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : null;
    const failure = classifyPartnerAreaFailure(raw, { online });
    // An `input-invalid` message is authored by this app (a form value), so it is
    // shown verbatim; every other kind uses the reviewed short copy below.
    const authored = failure.kind === 'input-invalid' ? String((raw as Error)?.message || '') : '';
    return new GrowthPartnerServiceError(failure, authored || undefined);
  }

  toFailure(): PartnerAreaFailure {
    return this.failure;
  }
}

/**
 * Safe, short, user-facing copy per cause. Reuses the strings the app already
 * ships for these situations so a section card reads the same wherever it is
 * rendered; the full explanation + next step live on `failure`.
 */
function shortServiceMessage(failure: PartnerAreaFailure): string {
  switch (failure.kind) {
    case 'schema-missing':
      return (
        'The Growth Partner database setup is missing on this project, so this data cannot be read. ' +
        'An administrator must apply the Growth Partner migrations (see GROWTH_PARTNER_SETUP.md).'
      );
    case 'contract-mismatch':
      return (
        'The Growth Partner service answered in an unexpected shape, so these figures cannot be trusted. ' +
        'Nothing was guessed or defaulted — the section stays closed until the answer matches the app.'
      );
    case 'session-expired':
      return 'Your session expired. Please sign in again.';
    case 'suspended':
      return GROWTH_PARTNER_INACTIVE_BODY;
    case 'not-a-partner':
      return 'These records are only available to an approved, active Growth Partner.';
    case 'permission-denied':
      return 'You are signed in, but the service refused this read for this account.';
    case 'network':
    case 'offline':
      return 'Network error. Check your connection and try again.';
    case 'outage':
      return 'The partner service is unreachable right now. Please try again shortly.';
    default:
      return PARTNER_SECTION_ERROR_MESSAGE;
  }
}

// ---------------------------------------------------------------------------
// Strict value guards (rule 2 + 3)
// ---------------------------------------------------------------------------

/** ₹1 = 100 paise. Amounts travel as integers; formatting never happens here. */
export const PAISE_PER_RUPEE = 100;

/** True when `value` is a whole, non-negative number of paise. */
export function isWholePaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Display helper only — the data layer never converts currencies. */
export function paiseToRupees(paise: number): number {
  return Math.round((paise / PAISE_PER_RUPEE) * 100) / 100;
}

/** What a form collects (rupees) → what the ledger stores (paise). */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** A money field, or a contract mismatch. Never 0. */
function money(value: unknown, field: string): number {
  if (isWholePaise(value)) return value;
  throw partnerContractMismatch(field);
}

/** A count/rank/index, or a contract mismatch. Never 0. */
function count(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) return value;
  throw partnerContractMismatch(field);
}

/** A commission rate in basis points (0…10000), or a contract mismatch. */
function basisPoints(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000) return value;
  throw partnerContractMismatch(field);
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function flags(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  throw partnerContractMismatch(field);
}

function objectOrThrow(value: unknown, field: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw partnerContractMismatch(field);
}

function arrayOrThrow(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw partnerContractMismatch(field);
}

// ---------------------------------------------------------------------------
// Strict projections for the payloads that carry money or counts
//
// These deliberately do NOT reuse the shared `normalize*` helpers for the
// value-bearing fields: those coerce a missing number to `0`, which is exactly
// the "fake zero" this facade must not return. Row SHAPES (ids, labels, dates)
// still come from the shared normalizers.
// ---------------------------------------------------------------------------

function toEarnings(raw: unknown): PartnerEarningsPayload {
  const payload = objectOrThrow(raw, 'earnings');
  const totals = objectOrThrow(payload.totals, 'totals');
  const available = money(totals.available_paise, 'totals.available_paise');
  // `cleared_paise` arrived in a later migration; a project one release behind
  // answers the older three keys. That fallback is documented, and it is derived
  // from a VALIDATED field — never from a zero.
  const cleared = totals.cleared_paise === undefined || totals.cleared_paise === null
    ? available
    : money(totals.cleared_paise, 'totals.cleared_paise');

  const transactions: PartnerEarningRow[] = arrayOrThrow(payload.transactions, 'transactions').map((row, index) => {
    const entry = objectOrThrow(row, `transactions[${index}]`);
    return {
      id: textOr(entry.id, ''),
      earning_type: textOr(entry.earning_type, 'other'),
      status: textOr(entry.status, 'pending'),
      amount_paise: money(entry.amount_paise, `transactions[${index}].amount_paise`),
      commission_bps: basisPoints(entry.commission_bps, `transactions[${index}].commission_bps`),
      earned_at: textOr(entry.earned_at, ''),
      payment_cleared_at: typeof entry.payment_cleared_at === 'string' ? entry.payment_cleared_at : null,
      available_at: typeof entry.available_at === 'string' ? entry.available_at : null,
      paid_at: typeof entry.paid_at === 'string' ? entry.paid_at : null,
    };
  });

  return {
    currency: textOr(payload.currency, 'INR'),
    totals: {
      lifetime_paise: money(totals.lifetime_paise, 'totals.lifetime_paise'),
      pending_paise: money(totals.pending_paise, 'totals.pending_paise'),
      cleared_paise: cleared,
      available_paise: available,
    },
    transactions,
  };
}

function toPayoutRequests(raw: unknown): PartnerPayoutRequestsPayload {
  const payload = objectOrThrow(raw, 'payout requests');
  const items: PartnerPayoutRequestRow[] = arrayOrThrow(payload.items, 'items').map((row, index) => {
    const entry = objectOrThrow(row, `items[${index}]`);
    return {
      id: textOr(entry.id, ''),
      amount_paise: money(entry.amount_paise, `items[${index}].amount_paise`),
      payout_method: textOr(entry.payout_method, 'upi'),
      destination_label: textOr(entry.destination_label, ''),
      status: textOr(entry.status, 'pending'),
      requested_at: textOr(entry.requested_at, ''),
      reviewed_at: typeof entry.reviewed_at === 'string' ? entry.reviewed_at : null,
      paid_at: typeof entry.paid_at === 'string' ? entry.paid_at : null,
      rejection_reason: typeof entry.rejection_reason === 'string' ? entry.rejection_reason : null,
      provider_reference: typeof entry.provider_reference === 'string' ? entry.provider_reference : null,
    };
  });

  return {
    total: count(payload.total, 'total'),
    open_amount_paise: money(payload.open_amount_paise, 'open_amount_paise'),
    items,
  };
}

function toLevels(raw: unknown): PartnerLevelsPayload {
  const payload = objectOrThrow(raw, 'levels');
  const levels: PartnerLevelRow[] = arrayOrThrow(payload.levels, 'levels').map((row, index) => {
    const entry = objectOrThrow(row, `levels[${index}]`);
    return {
      code: textOr(entry.code, ''),
      sort_order: count(entry.sort_order, `levels[${index}].sort_order`),
      minimum_paid_referrals: count(entry.minimum_paid_referrals, `levels[${index}].minimum_paid_referrals`),
      commission_bps: basisPoints(entry.commission_bps, `levels[${index}].commission_bps`),
      perks: Array.isArray(entry.perks) ? entry.perks.map((perk) => String(perk)) : [],
      unlocked: flags(entry.unlocked, `levels[${index}].unlocked`),
    };
  });

  return { active_referrals: count(payload.active_referrals, 'active_referrals'), levels };
}

function toLeaderboard(raw: unknown): PartnerLeaderboardPayload {
  const payload = objectOrThrow(raw, 'leaderboard');
  const items: PartnerLeaderboardRow[] = arrayOrThrow(payload.items, 'items').map((row, index) => {
    const entry = objectOrThrow(row, `items[${index}]`);
    return {
      rank: count(entry.rank, `items[${index}].rank`),
      // Another partner's opaque id: shown as a leaderboard entry, never used to
      // address their data.
      partner_id: textOr(entry.partner_id, ''),
      earnings_paise: money(entry.earnings_paise, `items[${index}].earnings_paise`),
    };
  });

  const myRank = payload.my_rank;
  return {
    items,
    // `null` is a real answer here ("not ranked yet") and is preserved as such.
    my_rank: myRank === null || myRank === undefined ? null : count(myRank, 'my_rank'),
  };
}

function toNotifications(raw: unknown): PartnerNotificationsPayload {
  const payload = objectOrThrow(raw, 'notifications');
  const items: PartnerNotificationRow[] = arrayOrThrow(payload.items, 'items').map((row, index) => {
    const entry = objectOrThrow(row, `items[${index}]`);
    return {
      id: textOr(entry.id, ''),
      notification_type: textOr(entry.notification_type, 'system'),
      title: textOr(entry.title, 'Partner update'),
      body: typeof entry.body === 'string' ? entry.body : '',
      is_read: flags(entry.is_read, `items[${index}].is_read`),
      read_at: typeof entry.read_at === 'string' ? entry.read_at : null,
      created_at: textOr(entry.created_at, ''),
    };
  });

  return { unread_count: count(payload.unread_count, 'unread_count'), items };
}

function toNotificationPreferences(raw: unknown): PartnerNotificationPreferences {
  const payload = objectOrThrow(raw, 'notification preferences');
  return {
    email_enabled: flags(payload.email_enabled, 'email_enabled'),
    in_app_enabled: flags(payload.in_app_enabled, 'in_app_enabled'),
    updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : null,
  };
}

function toSupportTickets(raw: unknown): PartnerSupportTicketRow[] {
  return normalizeSupportTickets(raw).map((row, index) => ({
    ...row,
    // A ticket number is an identifier, not "0" when it is missing.
    ticket_number: count((raw as any[])?.[index]?.ticket_number, `tickets[${index}].ticket_number`),
  }));
}

function toMarketingCategories(raw: unknown): PartnerMarketingCategory[] {
  const rows = arrayOrThrow(raw, 'marketing categories');
  return rows.map((row, index) => {
    const entry = objectOrThrow(row, `categories[${index}]`);
    return {
      category: textOr(entry.category, ''),
      asset_count: count(entry.asset_count, `categories[${index}].asset_count`),
    };
  });
}

// ---------------------------------------------------------------------------
// Transport adapter
// ---------------------------------------------------------------------------

/**
 * Narrowing helpers.
 *
 * Explicit guards rather than `if (result.ok)`: this project compiles with
 * `strictNullChecks: false`, where a boolean-literal discriminant does not
 * narrow a union. A user-defined type predicate narrows in every mode, so every
 * call site in the app uses these two functions and stays honest about which
 * branch it is in.
 */
export type GrowthPartnerSuccess<T> = { ok: true; data: T };
export type GrowthPartnerFailure = { ok: false; error: GrowthPartnerServiceError };

export function isServiceFailure<T>(result: GrowthPartnerResult<T>): result is GrowthPartnerFailure {
  return result.ok === false;
}

export function isServiceSuccess<T>(result: GrowthPartnerResult<T>): result is GrowthPartnerSuccess<T> {
  return result.ok === true;
}

/**
 * Throw a failed result's error, for flows that are already throw-based (the
 * area gate's `try/catch`, error boundaries). The error is the same classified
 * `GrowthPartnerServiceError`, so nothing is lost by unwrapping it.
 */
export function unwrapPartnerResult<T>(result: GrowthPartnerResult<T>): T {
  if (isServiceFailure(result)) throw result.error;
  return result.data;
}

/** Run one delegated call and turn its rejection into `{ ok: false, error }`. */
async function settle<T>(work: () => Promise<T>): Promise<GrowthPartnerResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (raw) {
    return { ok: false, error: GrowthPartnerServiceError.from(raw) };
  }
}

// ===========================================================================
// Gate reads (the calls that decide whether the area opens at all)
// ===========================================================================

/** The caller's own partner row — or `null`, meaning "signed in, not a partner". */
export function getMyPartner(): Promise<GrowthPartnerResult<GrowthPartner | null>> {
  return settle(() => fetchMyGrowthPartnerRow());
}

/** Provision the CALLER's own partner row (the database acts on `auth.uid()` only). */
export function ensureMyPartner(): Promise<GrowthPartnerResult<GrowthPartner>> {
  return settle(() => ensureMyGrowthPartner());
}

/** The caller's own application (used to tell "under review" from "never applied"). */
export function getMyApplication(): Promise<GrowthPartnerResult<GrowthPartnerApplicationRow | null>> {
  return settle(() => fetchMyGrowthPartnerApplication());
}

// ===========================================================================
// Dashboard sections
// ===========================================================================

/** KPI card + recent activity. Counts may be `null` when the backend omits them. */
export function getDashboard(): Promise<GrowthPartnerResult<PartnerDashboardData>> {
  return settle(() => fetchMyPartnerDashboard());
}

export interface PartnerReferralQuery {
  status?: PartnerReferralFilter;
  search?: string;
  limit?: number;
  offset?: number;
  joinedFrom?: string;
  joinedBefore?: string;
  conversion?: 'all' | 'converted' | 'not_converted';
  sort?: 'newest' | 'oldest' | 'recently_active';
}

/** Server-side filtered/searched/paged referrals — the caller's own rows. */
export function getReferrals(options: PartnerReferralQuery = {}): Promise<GrowthPartnerResult<PartnerReferralList>> {
  return settle(() => fetchMyPartnerReferrals({ ...options }));
}

/**
 * The Customers section reads the same owner-scoped page as Referrals (one
 * implementation, one filter vocabulary); the facade names it so a screen never
 * has to know that.
 */
export function getCustomers(options: PartnerReferralQuery = {}): Promise<GrowthPartnerResult<PartnerReferralList>> {
  return getReferrals({ status: 'all', ...options });
}

/** Aggregates: totals, completion rate, monthly history. */
export function getPerformance(): Promise<GrowthPartnerResult<PartnerPerformanceData>> {
  return settle(() => fetchMyPartnerPerformance());
}

/** One referral's own detail. `null` covers "not yours" as well as "not found". */
export function getReferralDetail(referralId: string): Promise<GrowthPartnerResult<PartnerReferralEntry | null>> {
  if (!referralId || !referralId.trim()) {
    return Promise.resolve({ ok: false, error: GrowthPartnerServiceError.from(partnerInputInvalid('A referral id is required.')) });
  }
  return settle(() => fetchMyPartnerReferralDetail(referralId));
}

// ===========================================================================
// Money: earnings + withdrawals
// ===========================================================================

/** Earnings page + wallet totals. Every amount is a whole number of paise. */
export function getEarnings(options: { limit?: number; offset?: number } = {}): Promise<GrowthPartnerResult<PartnerEarningsPayload>> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 200);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  return settle(() =>
    callPartnerOperation({
      path: `/api/partner/earnings?limit=${limit}&offset=${offset}`,
      rpc: 'get_my_partner_earnings',
      args: { p_limit: limit, p_offset: offset },
      normalize: toEarnings,
    })
  );
}

/** Payout-request history + the open amount (paise). */
export function getPayoutRequests(
  options: { limit?: number; offset?: number } = {}
): Promise<GrowthPartnerResult<PartnerPayoutRequestsPayload>> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  return settle(() =>
    callPartnerOperation({
      path: `/api/partner/payout-requests?limit=${limit}&offset=${offset}`,
      rpc: 'get_my_partner_payout_requests',
      args: { p_limit: limit, p_offset: offset },
      normalize: toPayoutRequests,
    })
  );
}

export interface PayoutRequestInput {
  /** Whole paise. The SQL floor is enforced by the backend, not by a guess here. */
  amountPaise: number;
  payoutMethod: PartnerPayoutMethod | string;
  destinationLabel: string;
}

/**
 * Ask for a payout. The amount is validated as whole paise before the request is
 * sent (a bad value is a form problem, not a service outage), and the ledger's
 * own floor/limit refusals come back as a normal classified error.
 */
export function requestPayout(input: PayoutRequestInput): Promise<GrowthPartnerResult<{ id: string; status: string; amount_paise: number }>> {
  if (!isWholePaise(input?.amountPaise) || input.amountPaise <= 0) {
    return Promise.resolve({
      ok: false,
      error: GrowthPartnerServiceError.from(
        partnerInputInvalid(
          `Enter the amount as a whole number of paise (₹1 = ${PAISE_PER_RUPEE} paise). The minimum payout is ${PARTNER_MINIMUM_PAYOUT_PAISE} paise.`
        )
      ),
    });
  }
  const label = String(input.destinationLabel ?? '').trim();
  if (label.length < 2) {
    return Promise.resolve({
      ok: false,
      error: GrowthPartnerServiceError.from(partnerInputInvalid('Tell us where to send the payout (UPI ID, email or account reference).')),
    });
  }
  return settle(async () => {
    const created = await callPartnerOperation<{ id: string; status: string; amount_paise: number }>({
      path: '/api/partner/payout-requests',
      method: 'POST',
      body: { amount_paise: input.amountPaise, method: input.payoutMethod, destination_label: label },
      rpc: 'request_my_partner_payout',
      args: { p_amount_paise: input.amountPaise, p_method: input.payoutMethod, p_destination_label: label },
      normalize: (raw: unknown) => {
        const payload = objectOrThrow(raw, 'payout request');
        return {
          id: textOr(payload.id, ''),
          status: textOr(payload.status, 'pending'),
          // The receipt's amount must be the paise the ledger recorded — never 0.
          amount_paise: money(payload.amount_paise, 'amount_paise'),
        };
      },
    });
    return created;
  });
}

/** Withdraw an open payout request (only the caller's own). */
export function cancelPayoutRequest(requestId: string): Promise<GrowthPartnerResult<{ id: string; status: string }>> {
  if (!requestId || !requestId.trim()) {
    return Promise.resolve({ ok: false, error: GrowthPartnerServiceError.from(partnerInputInvalid('A payout request id is required.')) });
  }
  return settle(() =>
    callPartnerOperation<{ id: string; status: string }>({
      path: '/api/partner/payout-requests/cancel',
      method: 'POST',
      body: { request_id: requestId },
      rpc: 'cancel_my_partner_payout_request',
      args: { p_request_id: requestId },
      normalize: (raw: unknown) => {
        const payload = objectOrThrow(raw, 'payout cancellation');
        return { id: textOr(payload.id, requestId), status: textOr(payload.status, 'cancelled') };
      },
    })
  );
}

// ===========================================================================
// Levels, leaderboard, notifications
// ===========================================================================

export function getLevels(): Promise<GrowthPartnerResult<PartnerLevelsPayload>> {
  return settle(() =>
    callPartnerOperation({ path: '/api/partner/levels', rpc: 'get_my_partner_levels', normalize: toLevels })
  );
}

/** Anonymous peer earnings (paise) — ranks only, no identity of other partners. */
export function getLeaderboard(options: { limit?: number } = {}): Promise<GrowthPartnerResult<PartnerLeaderboardPayload>> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  return settle(() =>
    callPartnerOperation({
      path: `/api/partner/leaderboard?limit=${limit}`,
      rpc: 'get_partner_leaderboard',
      args: { p_limit: limit },
      normalize: toLeaderboard,
    })
  );
}

export function getNotifications(
  options: { type?: string | null; limit?: number } = {}
): Promise<GrowthPartnerResult<PartnerNotificationsPayload>> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const filter = options.type && options.type !== 'all' ? options.type : null;
  return settle(() =>
    callPartnerOperation({
      path: `/api/partner/notifications?limit=${limit}${filter ? `&type=${encodeURIComponent(filter)}` : ''}`,
      rpc: 'get_my_partner_notifications',
      args: { p_type: filter, p_limit: limit },
      normalize: toNotifications,
    })
  );
}

/** No ids → mark everything read. Resolves with the number of rows touched. */
export function markNotificationsRead(ids?: string[]): Promise<GrowthPartnerResult<number>> {
  const cleaned = Array.isArray(ids) ? ids.map((id) => String(id).trim()).filter(Boolean) : [];
  return settle(() =>
    callPartnerOperation<number>({
      path: '/api/partner/notifications/read',
      method: 'POST',
      body: { ids: cleaned.length ? cleaned : null },
      rpc: 'mark_my_partner_notifications_read',
      args: { p_ids: cleaned.length ? cleaned : null },
      normalize: (raw: unknown) => {
        const payload = (raw ?? {}) as Record<string, unknown>;
        return count(payload.count ?? raw, 'count');
      },
    })
  );
}

export function getNotificationPreferences(): Promise<GrowthPartnerResult<PartnerNotificationPreferences>> {
  return settle(() =>
    callPartnerOperation({
      path: '/api/partner/notification-preferences',
      rpc: 'get_my_partner_notification_preferences',
      normalize: toNotificationPreferences,
    })
  );
}

export function updateNotificationPreferences(prefs: {
  email_enabled: boolean;
  in_app_enabled: boolean;
}): Promise<GrowthPartnerResult<PartnerNotificationPreferences>> {
  if (typeof prefs?.email_enabled !== 'boolean' || typeof prefs?.in_app_enabled !== 'boolean') {
    return Promise.resolve({
      ok: false,
      error: GrowthPartnerServiceError.from(partnerInputInvalid('Choose whether each notification channel is on or off.')),
    });
  }
  return settle(() =>
    callPartnerOperation({
      path: '/api/partner/notification-preferences',
      method: 'POST',
      body: prefs,
      rpc: 'update_my_partner_notification_preferences',
      args: { p_email_enabled: prefs.email_enabled, p_in_app_enabled: prefs.in_app_enabled },
      normalize: toNotificationPreferences,
    })
  );
}

// ===========================================================================
// Marketing materials + support
// ===========================================================================

export function getMarketingAssets(category?: string | null): Promise<GrowthPartnerResult<PartnerMarketingAsset[]>> {
  const filter = category && category !== 'all' ? category : null;
  return settle(() =>
    callPartnerOperation({
      path: `/api/partner/marketing-assets${filter ? `?category=${encodeURIComponent(filter)}` : ''}`,
      rpc: 'get_partner_marketing_assets',
      args: { p_category: filter },
      normalize: (raw: unknown) => normalizeMarketingAssets(raw),
    })
  );
}

export function getMarketingCategories(): Promise<GrowthPartnerResult<PartnerMarketingCategory[]>> {
  return settle(() =>
    callPartnerOperation({
      path: '/api/partner/marketing-assets/categories',
      rpc: 'get_partner_marketing_asset_categories',
      normalize: toMarketingCategories,
    })
  );
}

/** A signed download URL for one of the caller's own published assets. */
export function getAssetDownloadUrl(assetId: string): Promise<GrowthPartnerResult<string>> {
  if (!assetId || !assetId.trim()) {
    return Promise.resolve({ ok: false, error: GrowthPartnerServiceError.from(partnerInputInvalid('An asset id is required.')) });
  }
  return settle(() =>
    callPartnerOperation<string>({
      path: `/api/partner/marketing-assets/${encodeURIComponent(assetId)}/download`,
      rpc: 'get_my_partner_asset_download_url',
      args: { p_asset_id: assetId },
      normalize: (raw: unknown) => {
        const url = typeof raw === 'string' ? raw : String((raw as any)?.signed_url ?? '');
        if (!url) throw partnerContractMismatch('download_url');
        return url;
      },
    })
  );
}

export function getSupportTickets(
  options: { limit?: number; status?: string | null } = {}
): Promise<GrowthPartnerResult<PartnerSupportTicketRow[]>> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  const status = options.status && options.status !== 'all' ? options.status : null;
  return settle(() =>
    callPartnerOperation({
      path: `/api/partner/support-tickets?limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
      rpc: 'get_my_partner_support_tickets',
      args: { p_limit: limit, p_status: status },
      normalize: toSupportTickets,
    })
  );
}

export function submitSupportTicket(
  subject: string,
  message: string,
  priority: PartnerTicketPriority | string = 'normal'
): Promise<GrowthPartnerResult<PartnerSupportTicketReceipt>> {
  const trimmedSubject = String(subject ?? '').trim();
  const trimmedMessage = String(message ?? '').trim();
  if (trimmedSubject.length < 3) {
    return Promise.resolve({ ok: false, error: GrowthPartnerServiceError.from(partnerInputInvalid('Give the ticket a short subject.')) });
  }
  if (trimmedMessage.length < 10) {
    return Promise.resolve({
      ok: false,
      error: GrowthPartnerServiceError.from(partnerInputInvalid('Describe the issue in at least a sentence so the desk can act on it.')),
    });
  }
  return settle(() =>
    callPartnerOperation({
      path: '/api/partner/support-tickets',
      method: 'POST',
      body: { subject: trimmedSubject, message: trimmedMessage, priority },
      rpc: 'submit_my_partner_support_ticket',
      args: { p_subject: trimmedSubject, p_message: trimmedMessage, p_priority: priority },
      normalize: (raw: unknown) => {
        const payload = objectOrThrow(raw, 'support ticket receipt');
        return {
          id: textOr(payload.id, ''),
          ticket_number: count(payload.ticket_number, 'ticket_number'),
          status: textOr(payload.status, 'open'),
          created_at: textOr(payload.created_at, ''),
        };
      },
    })
  );
}

// ---------------------------------------------------------------------------
// One namespace object, for callers that prefer `service.getEarnings(...)`.
// ---------------------------------------------------------------------------

export const growthPartnerService = {
  // gate
  getMyPartner,
  ensureMyPartner,
  getMyApplication,
  // dashboard sections
  getDashboard,
  getReferrals,
  getCustomers,
  getPerformance,
  getReferralDetail,
  // money
  getEarnings,
  getPayoutRequests,
  requestPayout,
  cancelPayoutRequest,
  // levels + feed
  getLevels,
  getLeaderboard,
  getNotifications,
  markNotificationsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
  // marketing + support
  getMarketingAssets,
  getMarketingCategories,
  getAssetDownloadUrl,
  getSupportTickets,
  submitSupportTicket,
  // bridges + value helpers
  unwrapPartnerResult,
  isServiceFailure,
  isServiceSuccess,
  isWholePaise,
  paiseToRupees,
  rupeesToPaise,
} as const;

export default growthPartnerService;
