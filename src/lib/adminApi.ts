// ============================================================================
// Admin & Manager management — client data layer.
//
// Same two-transport contract as the partner portal (src/lib/partnerPortalOperations.ts):
// the `/api/admin/*` routes are preferred, and the PostgREST RPCs are the
// standing fallback so the panel works on a static deploy too. No call invents
// data: a refusal from this app's own API is the answer, and the only fallback
// substitution is for a transport that is genuinely absent.
//
// AUTHORIZATION IS NOT DECIDED HERE. `role` comes from the SQL function
// `get_my_admin_access()`, which reads the caller's admin_members row. This file
// uses it to decide what to RENDER — hiding a button is a convenience, never a
// control: the same call is refused by SQL if the browser lies about its role.
// ============================================================================

import { supabase } from './supabaseClient';

export const ADMIN_TIMEOUT_MS = 12_000;
export const ADMIN_SCHEMA_HINT =
  'The admin management schema is not applied to this project yet. Apply ' +
  'supabase/migrations/20261101000000_admin_management_core.sql and ' +
  'supabase/migrations/20261101000100_admin_partner_operations.sql, then retry.';

export type AdminRole = 'super_admin' | 'admin' | 'area_manager' | 'sub_admin';

export interface AdminAccess {
  isAdmin: boolean;
  role: AdminRole | null;
  workArea: string | null;
  canManageMoney: boolean;
}

export const NO_ADMIN_ACCESS: AdminAccess = {
  isAdmin: false,
  role: null,
  workArea: null,
  canManageMoney: false,
};

/** What each role may do — the ONE place the UI asks that question. */
export function adminCapabilities(access: AdminAccess) {
  const role = access.role;
  const superAdmin = role === 'super_admin';
  return {
    /** Delete/restore, territory assignment, onboarding links, export. */
    manageStaff: superAdmin,
    createOnboardingLinks: superAdmin,
    reviewApplications: superAdmin,
    exportData: superAdmin,
    deletePartners: superAdmin,
    assignArea: superAdmin,
    /** Approve/unapprove/ban inside the caller's own area. */
    moderatePartners: access.isAdmin,
    /** Bank/UPI corrections and payout processing. */
    manageMoney: access.canManageMoney,
    /** Copy protection: non-super-admin directory screens are locked down. */
    copyProtection: access.isAdmin && !superAdmin,
  };
}

export interface AdminApiError extends Error {
  code?: string;
  status?: number;
  retryable?: boolean;
  field?: string;
}

/** The field a SQL refusal names, so the form can put the message under it. */
export function refusalField(message: string): string | null {
  const text = String(message || '');
  const checks: Array<[RegExp, string]> = [
    [/full name/i, 'full_name'],
    [/email/i, 'email'],
    [/whatsapp/i, 'whatsapp'],
    [/phone/i, 'phone'],
    [/aadhaar/i, 'aadhaar_number'],
    [/pan/i, 'pan_number'],
    [/ifsc/i, 'bank_ifsc'],
    [/account number/i, 'bank_account_number'],
    [/work area/i, 'work_area'],
    [/reason/i, 'reason'],
    [/utr/i, 'utr'],
    [/password/i, 'password'],
  ];
  for (const [pattern, field] of checks) if (pattern.test(text)) return field;
  return null;
}

function mark(error: AdminApiError): AdminApiError {
  return error;
}

export function adminError(raw: {
  message?: string | null;
  code?: string | null;
  status?: number | null;
} | null | undefined): AdminApiError {
  const message = String(raw?.message || '').trim();
  const code = String(raw?.code || '').trim();
  const error = new Error(message || 'The admin request failed.') as AdminApiError;
  error.code = code || undefined;
  error.status = raw?.status ?? undefined;
  if (code === 'PGRST202' || /does not exist|could not find the function/i.test(message)) {
    error.code = 'schema_not_applied';
    error.message = ADMIN_SCHEMA_HINT;
    error.retryable = false;
  } else if (raw?.status === 401 || /jwt expired|invalid claim/i.test(message)) {
    error.code = 'unauthorized';
    error.message = 'Your session expired. Sign in again.';
    error.retryable = true;
  } else if (raw?.status === 403 || code === '42501' || code === 'forbidden' || code === 'super_admin_required' || code === 'admin_required') {
    error.code = code === 'super_admin_required' ? 'super_admin_required' : code === 'admin_required' ? 'admin_required' : 'forbidden';
    error.message = message || 'This action needs a higher access level.';
    error.retryable = false;
  } else if (raw?.status === 400 || code === '22023' || code === 'P0002') {
    error.code = code || 'invalid_request';
    error.retryable = false;
    const field = refusalField(message);
    if (field) error.field = field;
  } else if (code === '23505') {
    error.code = 'conflict';
    error.retryable = false;
  } else if (!error.code) {
    error.code = 'backend_unavailable';
    error.retryable = true;
  }
  return mark(error);
}

async function sessionToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

interface ApiResult {
  ok: boolean;
  status: number;
  data?: any;
  error?: { code?: string; message?: string };
  text?: string;
}

const ABSENT_STATUSES = new Set([404, 405, 501, 502, 503]);

async function apiRequest(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  options: { raw?: boolean } = {}
): Promise<ApiResult | null> {
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
      ADMIN_TIMEOUT_MS,
      `Admin API ${method} ${path}`
    );
  } catch {
    return null;
  }
  if (options.raw) {
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text };
  }
  if (ABSENT_STATUSES.has(response.status)) return null;
  const payload = await response.json().catch(() => null);
  if (payload === null) return null;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: { code: payload?.error?.code, message: payload?.error?.message },
    };
  }
  return { ok: true, status: response.status, data: payload?.data ?? payload };
}

/** Run one RPC on the PostgREST transport (the fallback, and the local gateway). */
async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc(fn, args)).then(
      (result: any) => ({ data: result?.data ?? null, error: result?.error ?? null }),
      (thrown: any) => ({ data: null, error: thrown })
    ),
    ADMIN_TIMEOUT_MS,
    fn
  );
  if (error) throw adminError({ message: error.message, code: error.code, status: error.status });
  return data as T;
}

/**
 * API first, RPC second — and a refusal from our own API is always the answer.
 * (The partner portal used to replace a refusal with demo data; that bug is not
 * repeated here.)
 */
async function adminCall<T>(options: {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  rpc: string;
  args?: Record<string, unknown>;
}): Promise<T> {
  try {
    const proxied = await apiRequest(options.path, options.method ?? 'GET', options.body);
    if (proxied) {
      if (proxied.ok) return proxied.data as T;
      throw adminError({ ...proxied.error, status: proxied.status });
    }
  } catch (error) {
    if ((error as AdminApiError)?.code) throw error;
  }
  return callRpc<T>(options.rpc, options.args ?? {});
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export async function fetchMyAdminAccess(): Promise<AdminAccess> {
  const raw = await callRpc<any>('get_my_admin_access', {});
  if (!raw?.is_admin) return NO_ADMIN_ACCESS;
  return {
    isAdmin: true,
    role: (raw.role as AdminRole) ?? null,
    workArea: raw.work_area ? String(raw.work_area) : null,
    canManageMoney: raw.can_manage_money === true,
  };
}

// ---------------------------------------------------------------------------
// First Super Admin setup (self-bootstrapping /admin)
// ---------------------------------------------------------------------------
export interface AdminSetupState {
  /** True while no ACTIVE admin_members row exists — the claim button may show. */
  claimable: boolean;
  /** An active admin already exists on this project. */
  hasAdmin: boolean;
  /** False when the admin schema (get_my_admin_access & co.) is not installed. */
  schemaApplied: boolean;
}

function isSchemaMissing(error: unknown): boolean {
  const code = (error as AdminApiError | undefined)?.code;
  return code === 'schema_not_applied' || code === 'PGRST202';
}

/**
 * Can this project still be bootstrapped from the UI? Never throws: anything
 * other than a clear "yes, claimable" answer means the claim button stays hidden
 * (`claimable: false`). A missing schema is reported separately so the panel can
 * tell the operator to apply supabase/apply_admin_management.sql.
 */
export async function fetchAdminSetupState(): Promise<AdminSetupState> {
  try {
    const raw = await callRpc<any>('admin_setup_state', {});
    const hasAdmin = raw?.has_admin === true;
    return { claimable: raw?.claimable === true && !hasAdmin, hasAdmin, schemaApplied: true };
  } catch (error) {
    if (isSchemaMissing(error)) return { claimable: false, hasAdmin: false, schemaApplied: false };
    // Transport failure / timeout / auth trouble: do not offer the claim.
    return { claimable: false, hasAdmin: false, schemaApplied: true };
  }
}

export interface ClaimResult {
  role: AdminRole | null;
  /** False when the caller was already staff (idempotent repeat). */
  claimed: boolean;
}

/**
 * One-time claim of the first Super Admin seat for the signed-in account. The
 * SQL function is the authority: it refuses once any active admin exists, so a
 * stale or forged button cannot take over a configured project.
 */
export async function claimFirstSuperAdmin(): Promise<ClaimResult> {
  const raw = await callRpc<any>('claim_first_super_admin', {});
  return { role: (raw?.role as AdminRole) ?? null, claimed: raw?.claimed === true };
}

// ---------------------------------------------------------------------------
// Onboarding links
// ---------------------------------------------------------------------------
export interface OnboardingLink {
  id: string;
  token: string;
  work_area: string;
  role: AdminRole;
  note: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  is_active: boolean;
  exhausted?: boolean;
  created_at: string;
}

export function onboardingLinkUrl(token: string): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return `${origin}/admin/onboard-manager?token=${encodeURIComponent(token)}`;
}

export async function listOnboardingLinks(includeClosed = false): Promise<OnboardingLink[]> {
  const data = await adminCall<any>({
    path: `/api/admin/onboarding-links?include_closed=${includeClosed ? 'true' : 'false'}`,
    rpc: 'admin_list_manager_onboarding_links',
    args: { p_include_closed: includeClosed },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createOnboardingLink(input: {
  work_area: string;
  role?: 'area_manager' | 'sub_admin';
  expires_days?: number;
  max_uses?: number;
  note?: string;
}): Promise<OnboardingLink> {
  return adminCall<OnboardingLink>({
    path: '/api/admin/onboarding-links',
    method: 'POST',
    body: input,
    rpc: 'admin_create_manager_onboarding_link',
    args: {
      p_work_area: input.work_area,
      p_role: input.role ?? 'area_manager',
      p_expires_days: input.expires_days ?? 7,
      p_max_uses: input.max_uses ?? 1,
      p_note: input.note ?? null,
    },
  });
}

export async function revokeOnboardingLink(id: string): Promise<void> {
  await adminCall({
    path: `/api/admin/onboarding-links/${encodeURIComponent(id)}/revoke`,
    method: 'POST',
    rpc: 'admin_revoke_manager_onboarding_link',
    args: { p_link_id: id },
  });
}

// ---------------------------------------------------------------------------
// The PUBLIC half: link lookup, document upload, submission
// ---------------------------------------------------------------------------
export interface OnboardingLinkInfo {
  valid: boolean;
  reason?: 'not_found' | 'revoked' | 'expired' | 'already_used' | null;
  work_area?: string;
  role?: AdminRole;
  expires_at?: string | null;
}

export function onboardingLinkReason(info: OnboardingLinkInfo): string {
  switch (info.reason) {
    case 'not_found':
      return 'This onboarding link does not exist. Ask the Super Admin who shared it to send a new one.';
    case 'revoked':
      return 'This onboarding link was revoked. Ask the Super Admin for a fresh link.';
    case 'expired':
      return 'This onboarding link has expired. Ask the Super Admin for a fresh link.';
    case 'already_used':
      return 'This onboarding link has already been used. Ask the Super Admin for a fresh link.';
    default:
      return 'This onboarding link is not valid any more.';
  }
}

export async function fetchOnboardingLink(token: string): Promise<OnboardingLinkInfo> {
  const data = await adminCall<OnboardingLinkInfo>({
    path: `/api/public/manager-onboarding/${encodeURIComponent(token)}`,
    rpc: 'get_manager_onboarding_link',
    args: { p_token: token },
  });
  return data ?? { valid: false, reason: 'not_found' };
}

/**
 * Upload one document as a base64 data URL. The bucket is private and the
 * candidate has no session, so this is the one path that must go through the
 * server route — there is no safe direct-to-storage variant for an anonymous
 * form.
 */
export async function uploadOnboardingDocument(
  token: string,
  kind: 'photo' | 'aadhaar_front' | 'aadhaar_back' | 'pan_card',
  file: File
): Promise<{ kind: string; path: string }> {
  if (file.size > 10 * 1024 * 1024) {
    throw adminError({ status: 413, message: 'Each document must be smaller than 10 MB.' });
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(adminError({ message: 'That file could not be read.' }));
    reader.readAsDataURL(file);
  });
  const result = await adminCall<{ kind: string; path: string }>({
    path: `/api/public/manager-onboarding/${encodeURIComponent(token)}/documents`,
    method: 'POST',
    body: { kind, file_name: file.name, data_url: dataUrl },
    // No RPC equivalent: storing a document needs the service-role key.
    rpc: '__no_rpc__',
  });
  return result;
}

export interface ManagerApplicationInput {
  full_name: string;
  email: string;
  phone: string;
  whatsapp?: string;
  photo_path?: string | null;
  aadhaar_number?: string;
  aadhaar_front_path?: string | null;
  aadhaar_back_path?: string | null;
  pan_number?: string;
  pan_card_path?: string | null;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  upi_id?: string;
  work_area?: string;
}

export async function submitManagerApplication(
  token: string,
  input: ManagerApplicationInput
): Promise<{ id: string; status: string; work_area: string }> {
  return adminCall<{ id: string; status: string; work_area: string }>({
    path: `/api/public/manager-onboarding/${encodeURIComponent(token)}`,
    method: 'POST',
    body: input,
    rpc: 'submit_manager_onboarding_application',
    args: { p_token: token, p_payload: input },
  });
}

// ---------------------------------------------------------------------------
// Applications (super admin review)
// ---------------------------------------------------------------------------
export interface ManagerApplication {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  whatsapp: string | null;
  work_area: string;
  role: AdminRole;
  status: 'pending' | 'approved' | 'rejected';
  photo_path: string | null;
  aadhaar_last4: string;
  aadhaar_number?: string | null;
  aadhaar_front_path: string | null;
  aadhaar_back_path: string | null;
  pan_number: string | null;
  pan_card_path: string | null;
  bank_account_name: string | null;
  bank_account_last4: string;
  bank_ifsc: string | null;
  upi_id: string | null;
  review_note: string | null;
  created_at: string;
}

export async function listManagerApplications(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): Promise<ManagerApplication[]> {
  const data = await adminCall<any>({
    path: `/api/admin/manager-applications?status=${status}`,
    rpc: 'admin_list_manager_applications',
    args: { p_status: status, p_limit: 100 },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function approveManagerApplication(id: string, password: string, note?: string) {
  return adminCall<{ id: string; status: string; email: string; temporary_password: string; work_area: string; role: string }>({
    path: `/api/admin/manager-applications/${encodeURIComponent(id)}/approve`,
    method: 'POST',
    body: { password, note: note ?? null },
    rpc: 'admin_review_manager_application',
    args: { p_application_id: id, p_approve: true, p_note: note ?? null, p_user_id: null },
  });
}

export async function rejectManagerApplication(id: string, reason: string) {
  return adminCall<{ id: string; status: string }>({
    path: `/api/admin/manager-applications/${encodeURIComponent(id)}/reject`,
    method: 'POST',
    body: { reason },
    rpc: 'admin_review_manager_application',
    args: { p_application_id: id, p_approve: false, p_note: reason, p_user_id: null },
  });
}

// ---------------------------------------------------------------------------
// Directory + report + moderation
// ---------------------------------------------------------------------------
export interface PartnerMilestone {
  code: string;
  title: string;
  threshold: number;
  bonus_paise: number;
  remaining: number;
  unlocked: boolean;
}

export interface DirectoryPartner {
  id: string;
  user_id: string;
  referral_code: string;
  partner_code: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  photo_path: string | null;
  is_active: boolean;
  status: string | null;
  work_area: string | null;
  created_at: string;
  deleted_at: string | null;
  banned_at: string | null;
  ban_reason: string | null;
  onboarded_salons: number;
  active_referrals: number;
  lifetime_paise: number;
  available_paise: number;
  open_payouts: number;
  bank_details: Record<string, any> | null;
  milestones: PartnerMilestone[];
}

export interface DirectoryPayload {
  items: DirectoryPartner[];
  total: number;
  work_area: string | null;
  can_manage_money: boolean;
  is_super_admin: boolean;
}

export async function fetchPartnerDirectory(filters: {
  area?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
} = {}): Promise<DirectoryPayload> {
  const query = new URLSearchParams();
  if (filters.area) query.set('area', filters.area);
  if (filters.status) query.set('status', filters.status);
  if (filters.search) query.set('q', filters.search);
  if (filters.limit) query.set('limit', String(filters.limit));
  if (filters.offset) query.set('offset', String(filters.offset));
  if (filters.includeDeleted) query.set('include_deleted', 'true');
  const data = await adminCall<DirectoryPayload>({
    path: `/api/admin/partners${query.toString() ? `?${query}` : ''}`,
    rpc: 'admin_partner_directory',
    args: {
      p_area: filters.area ?? null,
      p_status: filters.status ?? null,
      p_search: filters.search ?? null,
      p_limit: filters.limit ?? 50,
      p_offset: filters.offset ?? 0,
      p_include_deleted: filters.includeDeleted ?? false,
    },
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: Number(data?.total ?? 0),
    work_area: data?.work_area ?? null,
    can_manage_money: data?.can_manage_money === true,
    is_super_admin: data?.is_super_admin === true,
  };
}

export interface ReportSummary {
  total_partners: number;
  active_partners: number;
  inactive_partners: number;
  banned_partners: number;
  deleted_partners: number;
  partners_with_work_area: number;
  onboarded_salons: number;
  pending_verifications: number;
  pending_manager_applications: number;
  pending_payouts: number;
  areas: string[];
}

export async function fetchReportSummary(area?: string | null): Promise<ReportSummary> {
  const data = await adminCall<any>({
    path: `/api/admin/report/summary${area ? `?area=${encodeURIComponent(area)}` : ''}`,
    rpc: 'admin_partner_report_summary',
    args: { p_area: area ?? null },
  });
  return {
    total_partners: 0, active_partners: 0, inactive_partners: 0, banned_partners: 0, deleted_partners: 0,
    partners_with_work_area: 0, onboarded_salons: 0, pending_verifications: 0,
    pending_manager_applications: 0, pending_payouts: 0, areas: [], ...(data ?? {}),
  };
}

export type ModerationAction = 'approve' | 'unapprove' | 'ban' | 'unban' | 'soft_delete' | 'restore';

export async function setPartnerState(partnerId: string, action: ModerationAction, reason?: string) {
  return adminCall<{ id: string; status: string | null; is_active: boolean }>({
    path: `/api/admin/partners/${encodeURIComponent(partnerId)}/state`,
    method: 'POST',
    body: { action, reason: reason ?? null },
    rpc: 'admin_set_partner_state',
    args: { p_partner_id: partnerId, p_action: action, p_reason: reason ?? null, p_area: null },
  });
}

export async function assignPartnerArea(partnerId: string, workArea: string) {
  return adminCall<{ id: string; work_area: string }>({
    path: `/api/admin/partners/${encodeURIComponent(partnerId)}/area`,
    method: 'POST',
    body: { work_area: workArea },
    rpc: 'admin_assign_partner_area',
    args: { p_partner_id: partnerId, p_area: workArea },
  });
}

export async function updatePartnerBankDetails(partnerId: string, patch: Record<string, unknown>) {
  return adminCall<Record<string, unknown>>({
    path: `/api/admin/partners/${encodeURIComponent(partnerId)}/bank-details`,
    method: 'POST',
    body: patch,
    rpc: 'admin_update_partner_bank_details',
    args: { p_partner_id: partnerId, p_patch: patch },
  });
}

export interface AdminPayoutRequest {
  id: string;
  partner_id: string;
  amount_paise: number;
  payout_method: string;
  destination_label: string;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  paid_at: string | null;
  provider_reference: string | null;
  rejection_reason: string | null;
  partner_name: string | null;
  partner_email: string | null;
  partner_code: string | null;
  work_area: string | null;
}

export async function fetchPayoutRequests(status: 'open' | 'paid' | 'rejected' | 'all' = 'open'): Promise<AdminPayoutRequest[]> {
  const data = await adminCall<any>({
    path: `/api/admin/payouts?status=${status}`,
    rpc: 'admin_list_partner_payouts',
    args: { p_status: status, p_area: null, p_limit: 100 },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function processPartnerPayout(requestId: string, action: 'mark_paid' | 'reject', options: { utr?: string; note?: string } = {}) {
  return adminCall<{ id: string; status: string; amount_paise: number; provider_reference: string | null }>({
    path: `/api/admin/payouts/${encodeURIComponent(requestId)}/process`,
    method: 'POST',
    body: { action, utr: options.utr ?? null, note: options.note ?? null },
    rpc: 'admin_process_partner_payout',
    args: { p_request_id: requestId, p_action: action, p_utr: options.utr ?? null, p_note: options.note ?? null },
  });
}

export interface AuditLogRow {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  work_area: string | null;
  reason: string | null;
  details: Record<string, any>;
  created_at: string;
}

export async function fetchAuditLogs(filters: { targetType?: string; targetId?: string; limit?: number } = {}): Promise<AuditLogRow[]> {
  const query = new URLSearchParams();
  if (filters.targetType) query.set('target_type', filters.targetType);
  if (filters.targetId) query.set('target_id', filters.targetId);
  if (filters.limit) query.set('limit', String(filters.limit));
  const data = await adminCall<any>({
    path: `/api/admin/audit-logs${query.toString() ? `?${query}` : ''}`,
    rpc: 'admin_list_audit_logs',
    args: {
      p_target_type: filters.targetType ?? null,
      p_target_id: filters.targetId ?? null,
      p_limit: filters.limit ?? 100,
    },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function syncPartnerRewards(partnerId?: string) {
  return adminCall<{ unlocked: any[] }>({
    path: `/api/admin/partners${partnerId ? `?id=${encodeURIComponent(partnerId)}` : ''}`,
    rpc: 'admin_sync_partner_rewards',
    args: { p_partner_id: partnerId ?? null },
  }).catch(() => ({ unlocked: [] }));
}

/**
 * Export the directory as CSV. Super admin only — the SQL function refuses
 * everybody else, so this cannot be reached by a manager who edits the DOM.
 */
export async function exportPartnerDirectoryCsv(filters: { area?: string | null; status?: string | null } = {}): Promise<string> {
  const query = new URLSearchParams();
  if (filters.area) query.set('area', filters.area);
  if (filters.status) query.set('status', filters.status);
  const path = `/api/admin/partners/export.csv${query.toString() ? `?${query}` : ''}`;
  const token = await sessionToken();
  const response = await withTimeout(
    fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
    ADMIN_TIMEOUT_MS,
    'Admin export'
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw adminError({
      status: response.status,
      code: payload?.error?.code,
      message: payload?.error?.message || 'The export was refused.',
    });
  }
  return response.text();
}

/** Used by the export button: hands the CSV to the browser as a download. */
export function downloadCsv(csv: string, fileName = `partner-directory-${new Date().toISOString().slice(0, 10)}.csv`): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Rupee formatting shared by the directory, payouts and the reward badges. */
export function formatRupees(paise: number | null | undefined): string {
  const value = Number(paise ?? 0) / 100;
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Milestone forecasting copy: "Needs 1 more salon for ₹2,000 bonus". */
export function rewardForecast(milestones: PartnerMilestone[]): string | null {
  const next = milestones.find((milestone) => !milestone.unlocked && milestone.remaining > 0);
  if (!next) return null;
  const salons = next.remaining === 1 ? '1 more salon' : `${next.remaining} more salons`;
  return `Needs ${salons} for ${formatRupees(next.bonus_paise)} bonus`;
}

/** `tel:` / `https://wa.me/` triggers — the directory's one-click actions. */
export function dialHref(phone: string | null | undefined): string | null {
  const digits = String(phone || '').replace(/[^0-9+]/g, '');
  return digits.length >= 10 ? `tel:${digits}` : null;
}

export function whatsappHref(phone: string | null | undefined, message?: string): string | null {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${withCountry}${text}`;
}

/** The personalised template the bulk-messaging pass renders per partner. */
export function waTemplateForPartner(template: string, partner: { full_name?: string | null; work_area?: string | null; referral_code?: string }): string {
  return String(template || '')
    .replace(/\{\{name\}\}/g, partner.full_name || 'there')
    .replace(/\{\{area\}\}/g, partner.work_area || 'your area')
    .replace(/\{\{code\}\}/g, partner.referral_code || '');
}
