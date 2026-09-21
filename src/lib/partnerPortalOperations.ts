import { supabase } from './supabaseClient';

// ============================================================================
// Growth Partner PORTAL OPERATIONS — the data layer behind the sidebar sections
// that used to be "Coming soon" slots: Earnings, Withdrawals, Marketing
// Materials, Partner Levels, Leaderboards, Notifications, Support.
//
// Everything here reads the schema owned by
//   supabase/migrations/20260918035349_partner_portal_operations.sql
//   supabase/migrations/20260919120000_partner_portal_section_reads.sql
// and no call ever names a partner: each RPC derives the partner from
// auth.uid() server-side (my_active_partner_id()), so a tampered URL or body
// cannot reach another partner's wallet, tickets or notifications. This module
// therefore never accepts or forwards a partner id — same rule the rest of the
// portal follows (see growthPartner.ts).
//
// TWO TRANSPORTS, ONE CONTRACT
// ---------------------------
//   1. `/api/partner/*` on this app's own API (server/partnerPortalRoutes.ts)
//      — preferred when it answers. The caller's Supabase bearer token is
//      forwarded untouched, so RLS and the RPC's own guards still decide
//      visibility; the route layer adds request logging and one place to
//      version/deploy the contract without shipping a new SPA bundle.
//   2. The PostgREST RPCs directly — the fallback whenever the API is absent
//      (a static SPA deploy), unreachable, or mid-deploy, and the transport
//      the local PGlite gateway speaks. Also what every other partner section
//      in this app already uses, so nothing here depends on the API existing.
//
// A response is only treated as "the proxy is not here" for statuses that
// genuinely mean that (404/405/501/502/503, non-JSON bodies, network errors).
// Anything with a JSON error body — including a validation refusal like
// "Minimum withdrawal is ₹500" — is surfaced, never silently retried against
// the other transport.
// ============================================================================

/** Both transports are bounded: a hung proxy must not hang the page. */
export const PARTNER_OPERATION_TIMEOUT_MS = 12_000;

/** Shown whenever a section cannot load because its RPCs are not deployed. */
export const PARTNER_SCHEMA_HINT =
  'The partner operations schema is not applied to this project yet. Run ' +
  'supabase/migrations/20260918035349_partner_portal_operations.sql and ' +
  'supabase/migrations/20260919120000_partner_portal_section_reads.sql, then retry.';

// ---------------------------------------------------------------------------
// Payloads (the exact jsonb shapes the SQL functions return)
// ---------------------------------------------------------------------------

export interface PartnerEarningRow {
  id: string;
  earning_type: string;
  status: string;
  amount_paise: number;
  commission_bps: number;
  earned_at: string;
  payment_cleared_at: string | null;
  available_at: string | null;
  paid_at: string | null;
}

export interface PartnerEarningsPayload {
  currency: string;
  totals: {
    /** Everything earned that was not reversed. */
    lifetime_paise: number;
    /** Cleared payments still inside the 7-day window. */
    pending_paise: number;
    /** Rows past clearance, BEFORE payouts are netted off. */
    cleared_paise: number;
    /** What the partner may actually withdraw now. */
    available_paise: number;
  };
  transactions: PartnerEarningRow[];
}

export interface PartnerPayoutRequestRow {
  id: string;
  amount_paise: number;
  payout_method: string;
  destination_label: string;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  provider_reference: string | null;
}

export interface PartnerPayoutRequestsPayload {
  total: number;
  open_amount_paise: number;
  items: PartnerPayoutRequestRow[];
}

export interface PartnerLevelRow {
  code: string;
  sort_order: number;
  minimum_paid_referrals: number;
  commission_bps: number;
  perks: string[];
  unlocked: boolean;
}

export interface PartnerLevelsPayload {
  active_referrals: number;
  levels: PartnerLevelRow[];
}

export interface PartnerLeaderboardRow {
  rank: number;
  partner_id: string;
  earnings_paise: number;
}

export interface PartnerLeaderboardPayload {
  items: PartnerLeaderboardRow[];
  my_rank: number | null;
}

export interface PartnerNotificationRow {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface PartnerNotificationsPayload {
  unread_count: number;
  items: PartnerNotificationRow[];
}

export interface PartnerNotificationPreferences {
  email_enabled: boolean;
  in_app_enabled: boolean;
  updated_at: string | null;
}

export interface PartnerMarketingAsset {
  id: string;
  category: string;
  title: string;
  description: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number | null;
  published_at: string | null;
}

export interface PartnerMarketingCategory {
  category: string;
  asset_count: number;
}

export interface PartnerSupportTicketRow {
  id: string;
  ticket_number: number;
  subject: string;
  message: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface PartnerSupportTicketReceipt {
  id: string;
  ticket_number: number;
  status: string;
  created_at: string;
}

export type PartnerPayoutMethod = 'upi' | 'bank_transfer' | 'paypal';
export type PartnerTicketPriority = 'low' | 'normal' | 'high';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PartnerOperationErrorCode =
  | 'schema_not_applied'
  | 'unauthorized'
  | 'partner_only'
  | 'validation'
  | 'unavailable'
  | 'unknown';

export interface PartnerOperationError extends Error {
  code: PartnerOperationErrorCode;
  retryable: boolean;
}

/** Set on every error this classifier produced (see idempotence note below). */
const PARTNER_ERROR_CLASSIFIED = Symbol.for('nexora.partnerOperationError.classified');

/** Tag an error as classified so a second pass through the classifier is a no-op. */
function markPartnerError(error: PartnerOperationError): PartnerOperationError {
  (error as any)[PARTNER_ERROR_CLASSIFIED] = true;
  return error;
}

export function partnerOperationError(
  context: string,
  raw: { message?: string | null; code?: string | null; status?: number | null } | null | undefined
): PartnerOperationError {
  // Already classified (the RPC client rejects with our own error on some
  // paths): re-running the patterns could only downgrade an exact message.
  if ((raw as any)?.[PARTNER_ERROR_CLASSIFIED]) return raw as PartnerOperationError;
  const message = String(raw?.message || '').trim();
  const code = String(raw?.code || '').trim();
  const error = new Error(message || `${context} failed`) as PartnerOperationError;
  // PostgREST answers PGRST202 for "no function matches"; a missing schema is
  // the single most common reason a promoted section cannot load, and naming
  // the two migrations is the only actionable thing the page can say.
  if (code === 'PGRST202' || /does not exist|could not find the function/i.test(message)) {
    error.code = 'schema_not_applied';
    error.message = PARTNER_SCHEMA_HINT;
    error.retryable = false;
    return markPartnerError(error);
  }
  if (raw?.status === 401 || /new row violates|jwt expired|invalid claim/i.test(message)) {
    error.code = 'unauthorized';
    error.message = 'Your session expired. Sign in again to load this section.';
    error.retryable = true;
    return markPartnerError(error);
  }
  // The RPCs raise 42501 for "not an active Growth Partner".
  if (code === '42501' || /Active Growth Partner required/i.test(message)) {
    error.code = 'partner_only';
    error.message = 'These records are only available to an approved, active Growth Partner.';
    error.retryable = false;
    return markPartnerError(error);
  }
  // "One open payout request per partner" is a partial UNIQUE INDEX, so the
  // second request fails with a raw constraint name instead of a raised message.
  // The partner can resolve that one themselves, so say what to do rather than
  // leaking `partner_payout_requests_one_open_per_partner` onto a screen.
  if (code === '23505' || /one_open_per_partner|duplicate key value/i.test(message)) {
    error.code = 'validation';
    error.message = 'You already have a payout request open. Wait for the review, or cancel it and request again.';
    error.retryable = false;
    return markPartnerError(error);
  }
  // 22023 is the constraint/validation code these functions raise with.
  if (code === '22023' || raw?.status === 400 || raw?.status === 409 || /Minimum withdrawal|exceeds available|Invalid/i.test(message)) {
    error.code = 'validation';
    error.retryable = false;
    return markPartnerError(error);
  }
  if (/fetch|network|timeout|Failed to fetch/i.test(message) || raw?.status === 502 || raw?.status === 503 || raw?.status === 504) {
    error.code = 'unavailable';
    error.message = message || 'The partner API is unreachable right now.';
    error.retryable = true;
    return markPartnerError(error);
  }
  error.code = 'unknown';
  error.retryable = true;
  return markPartnerError(error);
}

// ---------------------------------------------------------------------------
// Defensive normalization — a jsonb payload is treated as untrusted input:
// missing keys become zeros/empty strings instead of NaN or "undefined".
// ---------------------------------------------------------------------------

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const nullableText = (value: unknown): string | null => (value == null || value === '' ? null : String(value));
const flag = (value: unknown): boolean => value === true || value === 'true' || value === 1;
const list = <T>(value: unknown, map: (row: any) => T): T[] =>
  Array.isArray(value) ? value.map((row) => map(row)) : [];

const earningRow = (row: any): PartnerEarningRow => ({
  id: text(row?.id),
  earning_type: text(row?.earning_type) || 'manual_adjustment',
  status: text(row?.status) || 'pending',
  amount_paise: num(row?.amount_paise),
  commission_bps: num(row?.commission_bps),
  earned_at: text(row?.earned_at),
  payment_cleared_at: nullableText(row?.payment_cleared_at),
  available_at: nullableText(row?.available_at),
  paid_at: nullableText(row?.paid_at),
});

const payoutRow = (row: any): PartnerPayoutRequestRow => ({
  id: text(row?.id),
  amount_paise: num(row?.amount_paise),
  payout_method: text(row?.payout_method) || 'upi',
  destination_label: text(row?.destination_label),
  status: text(row?.status) || 'pending',
  requested_at: text(row?.requested_at),
  reviewed_at: nullableText(row?.reviewed_at),
  paid_at: nullableText(row?.paid_at),
  rejection_reason: nullableText(row?.rejection_reason),
  provider_reference: nullableText(row?.provider_reference),
});

const notificationRow = (row: any): PartnerNotificationRow => ({
  id: text(row?.id),
  notification_type: text(row?.notification_type) || 'system',
  title: text(row?.title) || 'Partner update',
  body: text(row?.body),
  is_read: flag(row?.is_read),
  read_at: nullableText(row?.read_at),
  created_at: text(row?.created_at),
});

export function normalizeEarnings(raw: any): PartnerEarningsPayload {
  return {
    currency: text(raw?.currency) || 'INR',
    totals: (() => {
      const cleared = num(raw?.totals?.cleared_paise);
      // `cleared_paise` is new; a project one migration behind still answers the
      // older three keys. Falling back to the gross figure keeps the "cleared"
      // line truthful instead of printing ₹0 next to a non-zero wallet.
      const available = Math.max(num(raw?.totals?.available_paise), 0);
      return {
        lifetime_paise: num(raw?.totals?.lifetime_paise),
        pending_paise: num(raw?.totals?.pending_paise),
        cleared_paise: cleared || available,
        available_paise: available,
      };
    })(),
    transactions: list(raw?.transactions, earningRow),
  };
}

export function normalizePayoutRequests(raw: any): PartnerPayoutRequestsPayload {
  return {
    total: num(raw?.total),
    open_amount_paise: num(raw?.open_amount_paise),
    items: list(raw?.items, payoutRow),
  };
}

export function normalizeLevels(raw: any): PartnerLevelsPayload {
  return {
    active_referrals: num(raw?.active_referrals),
    levels: list(raw?.levels, (row: any): PartnerLevelRow => ({
      code: text(row?.code),
      sort_order: num(row?.sort_order),
      minimum_paid_referrals: num(row?.minimum_paid_referrals),
      commission_bps: num(row?.commission_bps),
      perks: list(row?.perks, (perk: any) => text(perk)),
      unlocked: flag(row?.unlocked),
    })),
  };
}

export function normalizeLeaderboard(raw: any): PartnerLeaderboardPayload {
  const myRank = raw?.my_rank;
  return {
    items: list(raw?.items, (row: any): PartnerLeaderboardRow => ({
      rank: num(row?.rank),
      partner_id: text(row?.partner_id),
      earnings_paise: num(row?.earnings_paise),
    })),
    my_rank: myRank == null ? null : num(myRank),
  };
}

export function normalizeNotifications(raw: any): PartnerNotificationsPayload {
  return {
    unread_count: num(raw?.unread_count),
    items: list(raw?.items, notificationRow),
  };
}

export function normalizeNotificationPreferences(raw: any): PartnerNotificationPreferences {
  return {
    email_enabled: raw?.email_enabled == null ? true : flag(raw.email_enabled),
    in_app_enabled: raw?.in_app_enabled == null ? true : flag(raw.in_app_enabled),
    updated_at: nullableText(raw?.updated_at),
  };
}

export function normalizeMarketingAssets(raw: any): PartnerMarketingAsset[] {
  return list(raw, (row: any): PartnerMarketingAsset => ({
    id: text(row?.id),
    category: text(row?.category) || 'banner',
    title: text(row?.title) || 'Untitled asset',
    description: nullableText(row?.description),
    storage_bucket: text(row?.storage_bucket) || 'partner-marketing-assets',
    storage_path: text(row?.storage_path),
    mime_type: text(row?.mime_type) || 'application/octet-stream',
    file_size_bytes: row?.file_size_bytes == null ? null : num(row.file_size_bytes),
    published_at: nullableText(row?.published_at),
  }));
}

export function normalizeMarketingCategories(raw: any): PartnerMarketingCategory[] {
  return list(raw, (row: any): PartnerMarketingCategory => ({
    category: text(row?.category),
    asset_count: num(row?.asset_count),
  }));
}

export function normalizeSupportTickets(raw: any): PartnerSupportTicketRow[] {
  return list(raw, (row: any): PartnerSupportTicketRow => ({
    id: text(row?.id),
    ticket_number: num(row?.ticket_number),
    subject: text(row?.subject),
    message: text(row?.message),
    status: text(row?.status) || 'open',
    priority: text(row?.priority) || 'normal',
    created_at: text(row?.created_at),
    updated_at: text(row?.updated_at),
    closed_at: nullableText(row?.closed_at),
  }));
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** Statuses that mean "this deploy has no proxy route" → use the RPC. */
const PROXY_ABSENT_STATUSES = new Set([404, 405, 501, 502, 503]);

interface ProxyResult {
  ok: boolean;
  status: number;
  /** Present only when the JSON body carried data. */
  data?: unknown;
  error?: { message?: string; code?: string };
}

async function sessionToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || '';
  } catch {
    return '';
  }
}

/** `null` → the proxy is not part of this deploy; the caller falls back. */
async function proxyRequest(path: string, method: 'GET' | 'POST', body?: unknown): Promise<ProxyResult | null> {
  const token = await sessionToken();
  let response: Response;
  try {
    response = await withTimeout(
      fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      PARTNER_OPERATION_TIMEOUT_MS,
      `Partner API ${method} ${path}`
    );
  } catch {
    return null;
  }
  if (PROXY_ABSENT_STATUSES.has(response.status)) return null;
  const payload = await response.json().catch(() => null);
  if (payload === null) return null; // an HTML/empty body: not our route
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: { message: text((payload as any)?.error?.message) || text((payload as any)?.message), code: text((payload as any)?.error?.code) },
    };
  }
  return { ok: true, status: response.status, data: (payload as any)?.data ?? payload };
}

/**
 * Run one portal operation: API first, RPC as the standing fallback.
 * `normalize` runs on BOTH paths so the pages never see a shape difference.
 */
export async function callPartnerOperation<T>(operation: {
  /** REST path on this app's API, e.g. `/api/partner/earnings`. */
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** The PostgREST function the same call maps to. */
  rpc: string;
  args?: Record<string, unknown>;
  normalize?: (raw: unknown) => T;
}): Promise<T> {
  const method = operation.method || 'GET';
  const proxied = await proxyRequest(operation.path, method, operation.body);
  if (proxied) {
    if (!proxied.ok) {
      throw partnerOperationError(operation.rpc, { ...proxied.error, status: proxied.status });
    }
    return (operation.normalize ? operation.normalize(proxied.data) : (proxied.data as T)) as T;
  }

  let data: unknown;
  let rpcError: { message?: string | null; code?: string | null } | null = null;
  try {
    // postgrest-js REJECTS on some failures instead of resolving with
    // `{ error }`, so both shapes must arrive at the same classifier —
    // otherwise a partner sees a raw `42501` string instead of the copy below.
    const settled = await withTimeout(
      Promise.resolve(supabase.rpc(operation.rpc, operation.args ?? {})).then(
        (result: any) => ({ data: result?.data ?? null, error: result?.error ?? null }),
        (thrown: any) => ({ data: null, error: thrown })
      ),
      PARTNER_OPERATION_TIMEOUT_MS,
      operation.rpc
    );
    data = settled.data;
    rpcError = settled.error;
  } catch (thrown) {
    // Only the timeout reaches here (the rpc promise is settled above).
    throw partnerOperationError(operation.rpc, thrown as any);
  }
  if (rpcError) throw partnerOperationError(operation.rpc, rpcError as any);
  return (operation.normalize ? operation.normalize(data) : (data as T)) as T;
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

export function getPartnerEarnings(options: { limit?: number; offset?: number } = {}): Promise<PartnerEarningsPayload> {
  const limit = Math.min(Math.max(num(options.limit) || 25, 1), 200);
  const offset = Math.max(num(options.offset), 0);
  return callPartnerOperation({
    path: `/api/partner/earnings?limit=${limit}&offset=${offset}`,
    rpc: 'get_my_partner_earnings',
    args: { p_limit: limit, p_offset: offset },
    normalize: normalizeEarnings,
  });
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

/** The ledger's floor, mirrored from the SQL check (amount_paise >= 50000). */
export const PARTNER_MINIMUM_PAYOUT_PAISE = 50_000;

export function requestPartnerPayout(
  amountPaise: number,
  method: PartnerPayoutMethod | string,
  destinationLabel: string
): Promise<{ id: string; status: string; amount_paise: number }> {
  return callPartnerOperation({
    path: '/api/partner/payout-requests',
    method: 'POST',
    body: { amount_paise: amountPaise, method, destination_label: destinationLabel },
    rpc: 'request_my_partner_payout',
    args: { p_amount_paise: amountPaise, p_method: method, p_destination_label: destinationLabel },
    normalize: (raw: any) => ({
      id: text(raw?.id),
      status: text(raw?.status) || 'pending',
      amount_paise: num(raw?.amount_paise),
    }),
  });
}

export function getPartnerPayoutRequests(
  options: { limit?: number; offset?: number } = {}
): Promise<PartnerPayoutRequestsPayload> {
  const limit = Math.min(Math.max(num(options.limit) || 25, 1), 100);
  const offset = Math.max(num(options.offset), 0);
  return callPartnerOperation({
    path: `/api/partner/payout-requests?limit=${limit}&offset=${offset}`,
    rpc: 'get_my_partner_payout_requests',
    args: { p_limit: limit, p_offset: offset },
    normalize: normalizePayoutRequests,
  });
}

export function cancelPartnerPayoutRequest(requestId: string): Promise<{ id: string; status: string }> {
  return callPartnerOperation({
    path: '/api/partner/payout-requests/cancel',
    method: 'POST',
    body: { request_id: requestId },
    rpc: 'cancel_my_partner_payout_request',
    args: { p_request_id: requestId },
    normalize: (raw: any) => ({ id: text(raw?.id || requestId), status: text(raw?.status) || 'cancelled' }),
  });
}

// ---------------------------------------------------------------------------
// Levels + leaderboard
// ---------------------------------------------------------------------------

export function getPartnerLevels(): Promise<PartnerLevelsPayload> {
  return callPartnerOperation({
    path: '/api/partner/levels',
    rpc: 'get_my_partner_levels',
    normalize: normalizeLevels,
  });
}

export function getPartnerLeaderboard(options: { limit?: number } = {}): Promise<PartnerLeaderboardPayload> {
  const limit = Math.min(Math.max(num(options.limit) || 25, 1), 100);
  return callPartnerOperation({
    path: `/api/partner/leaderboard?limit=${limit}`,
    rpc: 'get_partner_leaderboard',
    args: { p_limit: limit },
    normalize: normalizeLeaderboard,
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function getPartnerNotifications(
  type?: string | null,
  options: { limit?: number } = {}
): Promise<PartnerNotificationsPayload> {
  const limit = Math.min(Math.max(num(options.limit) || 50, 1), 100);
  const filter = type && type !== 'all' ? type : null;
  return callPartnerOperation({
    path: `/api/partner/notifications?limit=${limit}${filter ? `&type=${filter}` : ''}`,
    rpc: 'get_my_partner_notifications',
    args: { p_type: filter, p_limit: limit },
    normalize: normalizeNotifications,
  });
}

/** No ids → "mark all read"; the RPC returns how many rows it touched. */
export function markPartnerNotificationsRead(ids?: string[]): Promise<number> {
  const cleaned = Array.isArray(ids) ? ids.map((id) => text(id).trim()).filter((id) => id.length > 0) : [];
  return callPartnerOperation({
    path: '/api/partner/notifications/read',
    method: 'POST',
    body: { ids: cleaned.length ? cleaned : null },
    rpc: 'mark_my_partner_notifications_read',
    args: { p_ids: cleaned.length ? cleaned : null },
    normalize: (raw: any) => num(raw?.count ?? raw),
  });
}

export function getPartnerNotificationPreferences(): Promise<PartnerNotificationPreferences> {
  return callPartnerOperation({
    path: '/api/partner/notification-preferences',
    rpc: 'get_my_partner_notification_preferences',
    normalize: normalizeNotificationPreferences,
  });
}

export function updatePartnerNotificationPreferences(prefs: {
  email_enabled: boolean;
  in_app_enabled: boolean;
}): Promise<PartnerNotificationPreferences> {
  return callPartnerOperation({
    path: '/api/partner/notification-preferences',
    method: 'POST',
    body: prefs,
    rpc: 'update_my_partner_notification_preferences',
    args: { p_email_enabled: prefs.email_enabled, p_in_app_enabled: prefs.in_app_enabled },
    normalize: normalizeNotificationPreferences,
  });
}

// ---------------------------------------------------------------------------
// Marketing materials
// ---------------------------------------------------------------------------

export function getPartnerMarketingAssets(category?: string | null): Promise<PartnerMarketingAsset[]> {
  const filter = category && category !== 'all' ? category : null;
  return callPartnerOperation({
    path: `/api/partner/marketing-assets${filter ? `?category=${filter}` : ''}`,
    rpc: 'get_partner_marketing_assets',
    args: { p_category: filter },
    normalize: normalizeMarketingAssets,
  });
}

export async function getPartnerMarketingAssetCategories(): Promise<PartnerMarketingCategory[]> {
  try {
    return await callPartnerOperation({
      path: '/api/partner/marketing-assets/categories',
      rpc: 'get_partner_marketing_asset_categories',
      normalize: normalizeMarketingCategories,
    });
  } catch (error: any) {
    if (
      error?.code === 'schema_not_applied' ||
      /PGRST202|does not exist|could not find the function/i.test(String(error?.message || ''))
    ) {
      try {
        const assets = await getPartnerMarketingAssets();
        const counts: Record<string, number> = {};
        for (const asset of assets) {
          if (asset.category) {
            counts[asset.category] = (counts[asset.category] || 0) + 1;
          }
        }
        return Object.keys(counts).sort().map((category) => ({
          category,
          asset_count: counts[category],
        }));
      } catch {
        // Fallback failed, continue to rethrow error
      }
    }
    throw error;
  }
}

/**
 * Signed download URL for one asset. The bucket is private, so this is the one
 * portal operation with no direct-RPC fallback — PostgREST cannot sign a storage
 * URL, and the API route is what authorizes the pair (asset id must appear in
 * the caller's own published list) before it signs.
 */
export async function getPartnerAssetDownloadUrl(assetId: string): Promise<string> {
  const token = await sessionToken();
  const response = await withTimeout(
    fetch(`/api/partner/marketing-assets/${encodeURIComponent(assetId)}/download`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      redirect: 'manual',
    }),
    PARTNER_OPERATION_TIMEOUT_MS,
    'Asset download'
  ).catch(() => null);
  if (!response) {
    throw partnerOperationError('asset download', { message: 'Downloads need this app’s API. Start the server (npm run dev) and retry.' });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw partnerOperationError('asset download', {
      message: text((payload as any)?.error?.message),
      code: text((payload as any)?.error?.code),
      status: response.status,
    });
  }
  const payload: any = await response.json().catch(() => null);
  // The route wraps its answer in { data } like every other partner endpoint;
  // a plain body is accepted too so a hand-rolled proxy still works.
  const url = text(payload?.data?.signed_url ?? payload?.signed_url);
  if (!url) throw partnerOperationError('asset download', { message: 'The asset storage bucket is not configured yet.' });
  return url;
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export function getPartnerSupportTickets(
  options: { limit?: number; status?: string | null } = {}
): Promise<PartnerSupportTicketRow[]> {
  const limit = Math.min(Math.max(num(options.limit) || 25, 1), 100);
  const status = options.status && options.status !== 'all' ? options.status : null;
  return callPartnerOperation({
    path: `/api/partner/support-tickets?limit=${limit}${status ? `&status=${status}` : ''}`,
    rpc: 'get_my_partner_support_tickets',
    args: { p_limit: limit, p_status: status },
    normalize: normalizeSupportTickets,
  });
}

export function submitPartnerSupportTicket(
  subject: string,
  message: string,
  priority: PartnerTicketPriority | string = 'normal'
): Promise<PartnerSupportTicketReceipt> {
  return callPartnerOperation({
    path: '/api/partner/support-tickets',
    method: 'POST',
    body: { subject, message, priority },
    rpc: 'submit_my_partner_support_ticket',
    args: { p_subject: subject, p_message: message, p_priority: priority },
    normalize: (raw: any): PartnerSupportTicketReceipt => ({
      id: text(raw?.id),
      ticket_number: num(raw?.ticket_number),
      status: text(raw?.status) || 'open',
      created_at: text(raw?.created_at),
    }),
  });
}
