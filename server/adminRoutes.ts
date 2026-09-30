// ============================================================================
// Admin & Manager management API — /api/admin/* and the public onboarding form
// behind /api/public/manager-onboarding/*
//
// Two authorization layers, on purpose:
//
//   1. SQL is the authority. Every admin RPC re-derives the caller's role from
//      their JWT / admin_members row (public.current_admin_role()), scopes the
//      read or write to `current_admin_area()` when the caller is an area
//      manager, refuses DELETE for everybody but a super admin, and writes the
//      audit row itself. A route that forgets a check therefore grants nothing.
//
//   2. This file adds the checks SQL cannot express or that must happen before
//      a privileged action is attempted (creating an Auth user needs the
//      service-role key, which the browser must never hold). `requireAdmin`
//      verifies the bearer token, then the role; `requireSuperAdmin` narrows it
//      to super_admin and is the ONLY gate the export and the deletion path
//      accept.
//
// The public onboarding endpoints are the one deliberately unauthenticated
// surface: possession of a valid, unexpired, unused link token IS the
// authorization. They can read nothing but the link's own area/role, and the
// submission is rate-limited by the link's `max_uses` in SQL.
// ============================================================================

import type { Express, Request, Response } from 'express';
import { BackendError, databaseForToken, verifyBackendUser } from './backendContext.js';
import { logPartnerFailure } from './partnerErrorLog.js';
import { isUuidLike } from './bookingOps.js';

export interface AdminRouteDeps {
  /** Client used to verify the bearer token (the app's Supabase client). */
  db: any;
  /** No live Supabase connection: mutations answer 503, reads fall back client-side. */
  isMock: boolean;
  /** Token-scoped RPC transport (what keeps RLS + the SQL guards in force). */
  callRpc?: (token: string, fn: string, args: Record<string, unknown>) => Promise<{ data?: any; error?: any }>;
  /**
   * Service-role client. Needed for exactly two things: creating the Auth user
   * when a manager application is approved, and storing a candidate's documents
   * in the private `manager-documents` bucket. Absent → those routes answer 503.
   */
  admin?: any;
  /** Injectable for tests: records what the approval would have created. */
  createAuthUser?: (input: { email: string; password: string; full_name: string; work_area: string; role: string }) => Promise<{ id: string }>;
  /** Injectable for tests: stores one uploaded document, returns its object path. */
  storeDocument?: (input: { token: string; kind: string; file_name: string; content_type: string; bytes: Buffer }) => Promise<string | null>;
}

const ADMIN_ROLES = new Set(['super_admin', 'admin', 'area_manager', 'sub_admin']);
const MODERATION_ACTIONS = new Set(['approve', 'unapprove', 'ban', 'unban', 'soft_delete', 'restore']);
const APPLICATION_STATUSES = new Set(['pending', 'approved', 'rejected', 'all']);
const DOCUMENT_KINDS = new Set(['photo', 'aadhaar_front', 'aadhaar_back', 'pan_card']);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Refusals the SQL functions write FOR the operator → safe to forward. */
const OPERATOR_FACING_REFUSAL =
  /^(?:Super Admin access required|Admin access required|This partner is|A reason is required|A UTR \/ reference|This payout request|This application was|This onboarding link|No work area|Payout method must|IFSC must|Account number must|Enter a valid|Aadhaar number must|PAN must look|Full name is required|An application for this email|An admin with this email|This account is already|Unknown moderation action|Unknown payout action|Application not found|Onboarding link not found|Partner not found|Only a Super Admin|Approving needs)/i;

// ---------------------------------------------------------------------------
// Small input helpers (same conventions as server/partnerPortalRoutes.ts)
// ---------------------------------------------------------------------------
function boundedInt(raw: unknown, options: { default: number; min: number; max: number; name: string }): number {
  if (raw === undefined || raw === null || raw === '') return options.default;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < options.min) {
    throw new BackendError(400, `${options.name} must be a number of at least ${options.min}.`, 'invalid_request');
  }
  return Math.min(Math.floor(value), options.max);
}

function optionalText(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  return value ? value.slice(0, max) : null;
}

function requiredText(raw: unknown, options: { min: number; max: number; label: string }): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length < options.min) {
    throw new BackendError(400, `${options.label} must be at least ${options.min} characters.`, 'invalid_request');
  }
  if (value.length > options.max) {
    throw new BackendError(400, `${options.label} must be at most ${options.max} characters.`, 'invalid_request');
  }
  return value;
}

function enumParam(raw: unknown, allowed: Set<string>, fallback: string | null, label: string): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return fallback;
  if (!allowed.has(value)) throw new BackendError(400, `Unknown ${label}.`, 'invalid_request');
  return value;
}

/** Postgres/PostgREST failure → the operator-facing answer. */
function adminRpcFailure(error: any): BackendError {
  const code = String(error?.code || '').trim();
  const rawMessage = String(error?.message || '').trim();
  if (code === 'PGRST202' || /does not exist|could not find the function/i.test(rawMessage)) {
    return new BackendError(
      501,
      'The admin management schema is not applied to this project yet. Apply supabase/migrations/20261101000000_admin_management_core.sql and 20261101000100_admin_partner_operations.sql, then retry.',
      'schema_not_applied'
    );
  }
  if (code === '42501' || /access required|outside your work area|work area is assigned/i.test(rawMessage)) {
    return new BackendError(403, rawMessage || 'This action needs a higher access level.', 'forbidden');
  }
  if (code === '23505') {
    return new BackendError(409, rawMessage || 'That record already exists.', 'conflict');
  }
  if (code === '22023' || code === 'P0002' || OPERATOR_FACING_REFUSAL.test(rawMessage)) {
    return new BackendError(400, rawMessage.slice(0, 300) || 'The request was refused.', 'invalid_request');
  }
  if (code === '23503' || code === '23514' || code === '22P02') {
    return new BackendError(400, 'Some of those details are not valid. Check the form and try again.', 'invalid_request');
  }
  if (/jwt expired|invalid claim/i.test(rawMessage)) {
    return new BackendError(401, 'Your session could not be verified. Sign in again.', 'auth_required');
  }
  return new BackendError(502, 'The admin backend could not answer. Please try again.', 'backend_unavailable');
}

// ---------------------------------------------------------------------------
// Caller verification
// ---------------------------------------------------------------------------
async function runRpc(
  deps: AdminRouteDeps,
  token: string,
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<any> {
  const call =
    deps.callRpc ??
    ((bearer: string, name: string, payload: Record<string, unknown>) => databaseForToken(bearer).rpc(name, payload));
  let result: { data?: any; error?: any };
  try {
    result = await call(token, fn, args);
  } catch (error: any) {
    logPartnerFailure(`admin.${operation}`, error);
    throw adminRpcFailure(error);
  }
  if (result?.error) {
    logPartnerFailure(`admin.${operation}`, result.error);
    throw adminRpcFailure(result.error);
  }
  return result?.data;
}

interface AdminCaller {
  token: string;
  userId: string;
  role: string;
  workArea: string | null;
  canManageMoney: boolean;
}

/** Verify the token, then read the role from SQL (never from the request body). */
async function resolveAdmin(deps: AdminRouteDeps, req: Request): Promise<AdminCaller> {
  if (deps.isMock) {
    throw new BackendError(
      503,
      'No Supabase project is connected, so the admin panel cannot read partner data yet.',
      'backend_unavailable'
    );
  }
  const { token, user } = await verifyBackendUser(deps.db, req);
  const access = await runRpc(deps, token, 'access', 'get_my_admin_access', {});
  const role = String(access?.role || '').trim();
  if (!access?.is_admin || !ADMIN_ROLES.has(role)) {
    throw new BackendError(403, 'This area is for Nexora staff accounts.', 'admin_required');
  }
  return {
    token,
    userId: user.id,
    role,
    workArea: access?.work_area ? String(access.work_area) : null,
    canManageMoney: access?.can_manage_money === true,
  };
}

async function requireAdmin(deps: AdminRouteDeps, req: Request): Promise<AdminCaller> {
  return resolveAdmin(deps, req);
}

async function requireSuperAdmin(deps: AdminRouteDeps, req: Request): Promise<AdminCaller> {
  const caller = await resolveAdmin(deps, req);
  if (caller.role !== 'super_admin') {
    throw new BackendError(403, 'Only a Super Admin can do this.', 'super_admin_required');
  }
  return caller;
}

/** Admin gate for a route the SQL restricts further (money, deletions). */
function assertMoney(caller: AdminCaller): void {
  if (!caller.canManageMoney) {
    throw new BackendError(403, 'Only an Admin or Super Admin can change payout details.', 'forbidden');
  }
}

// ---------------------------------------------------------------------------
// Public onboarding helpers (token = the whole authorization)
// ---------------------------------------------------------------------------
async function readJsonBody(req: Request, maxBytes = 32_000): Promise<Record<string, any>> {
  const body = (req.body || {}) as Record<string, any>;
  const encoded = JSON.stringify(body);
  if (encoded.length > maxBytes) {
    throw new BackendError(413, 'That payload is too large.', 'payload_too_large');
  }
  return body;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------
export type AdminRoute = {
  method: 'get' | 'post';
  path: string;
  /** Operators only. Public routes have their own registration below. */
  handler: (deps: AdminRouteDeps, req: Request, res: Response, caller: AdminCaller) => Promise<void>;
};

function send(res: Response, data: unknown, status = 200): void {
  if (res.headersSent) return;
  res.status(status).json({ data });
}

export const ADMIN_ROUTES: AdminRoute[] = [
  {
    method: 'get',
    path: '/api/admin/access',
    handler: async (_deps, _req, res, caller) => {
      send(res, { role: caller.role, work_area: caller.workArea, can_manage_money: caller.canManageMoney });
    },
  },

  // ── Onboarding links (super admin generates, everybody reads their own) ───
  {
    method: 'get',
    path: '/api/admin/onboarding-links',
    handler: async (deps, req, res, caller) => {
      const data = await runRpc(deps, caller.token, 'links-list', 'admin_list_manager_onboarding_links', {
        p_include_closed: String(req.query.include_closed || '') === 'true',
      });
      send(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/admin/onboarding-links',
    handler: async (deps, req, res, caller) => {
      if (caller.role !== 'super_admin') throw new BackendError(403, 'Only a Super Admin can create onboarding links.', 'super_admin_required');
      const body = await readJsonBody(req);
      const data = await runRpc(deps, caller.token, 'link-create', 'admin_create_manager_onboarding_link', {
        p_work_area: requiredText(body.work_area, { min: 2, max: 80, label: 'Work area' }),
        p_role: enumParam(body.role, new Set(['area_manager', 'sub_admin']), 'area_manager', 'manager role'),
        p_expires_days: boundedInt(body.expires_days, { default: 7, min: 1, max: 365, name: 'expires_days' }),
        p_max_uses: boundedInt(body.max_uses, { default: 1, min: 1, max: 500, name: 'max_uses' }),
        p_note: optionalText(body.note, 200),
      });
      send(res, data, 201);
    },
  },
  {
    method: 'post',
    path: '/api/admin/onboarding-links/:id/revoke',
    handler: async (deps, req, res, caller) => {
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'A link id is required.', 'invalid_request');
      const data = await runRpc(deps, caller.token, 'link-revoke', 'admin_revoke_manager_onboarding_link', {
        p_link_id: id,
      });
      send(res, data);
    },
  },

  // ── Applications (super admin review) ────────────────────────────────────
  {
    method: 'get',
    path: '/api/admin/manager-applications',
    handler: async (deps, req, res, caller) => {
      const data = await runRpc(deps, caller.token, 'applications', 'admin_list_manager_applications', {
        p_status: enumParam(req.query.status, APPLICATION_STATUSES, 'pending', 'application status'),
        p_limit: boundedInt(req.query.limit, { default: 50, min: 1, max: 200, name: 'limit' }),
      });
      send(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/admin/manager-applications/:id/approve',
    handler: async (deps, req, res, caller) => {
      if (caller.role !== 'super_admin') throw new BackendError(403, 'Only a Super Admin can approve a manager.', 'super_admin_required');
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'An application id is required.', 'invalid_request');
      const body = await readJsonBody(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 8) {
        throw new BackendError(400, 'Set a temporary password of at least 8 characters for this manager.', 'invalid_request');
      }
      // The application's own email/area/role decide the account — never the body.
      const pending = await runRpc(deps, caller.token, 'applications-for-approval', 'admin_list_manager_applications', {
        p_status: 'pending',
        p_limit: 200,
      });
      const application = (Array.isArray(pending?.items) ? pending.items : []).find((row: any) => String(row?.id) === id);
      if (!application) {
        throw new BackendError(404, 'That application is no longer pending.', 'not_found');
      }
      const createUser = deps.createAuthUser ?? defaultCreateAuthUser(deps);
      const created = await createUser({
        email: String(application.email),
        password,
        full_name: String(application.full_name || ''),
        work_area: String(application.work_area || ''),
        role: String(application.role || 'area_manager'),
      });
      const data = await runRpc(deps, caller.token, 'application-approve', 'admin_review_manager_application', {
        p_application_id: id,
        p_approve: true,
        p_note: optionalText(body.note, 300),
        p_user_id: created.id,
      });
      send(res, { ...data, email: application.email, temporary_password: password }, 201);
    },
  },
  {
    method: 'post',
    path: '/api/admin/manager-applications/:id/reject',
    handler: async (deps, req, res, caller) => {
      if (caller.role !== 'super_admin') throw new BackendError(403, 'Only a Super Admin can reject a manager.', 'super_admin_required');
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'An application id is required.', 'invalid_request');
      const body = await readJsonBody(req);
      const data = await runRpc(deps, caller.token, 'application-reject', 'admin_review_manager_application', {
        p_application_id: id,
        p_approve: false,
        p_note: requiredText(body.reason, { min: 3, max: 300, label: 'Reason' }),
        p_user_id: null,
      });
      send(res, data);
    },
  },

  // ── Directory, report, moderation ────────────────────────────────────────
  {
    method: 'get',
    path: '/api/admin/partners',
    handler: async (deps, req, res, caller) => {
      const data = await runRpc(deps, caller.token, 'directory', 'admin_partner_directory', {
        p_area: optionalText(req.query.area, 80),
        p_status: enumParam(
          req.query.status,
          new Set(['all', 'active', 'inactive', 'banned', 'deleted', 'pending']),
          null,
          'partner status'
        ),
        p_search: optionalText(req.query.q, 80),
        p_limit: boundedInt(req.query.limit, { default: 50, min: 1, max: 200, name: 'limit' }),
        p_offset: boundedInt(req.query.offset, { default: 0, min: 0, max: 100_000, name: 'offset' }),
        p_include_deleted: String(req.query.include_deleted || '') === 'true',
      });
      send(res, data);
    },
  },
  {
    method: 'get',
    path: '/api/admin/report/summary',
    handler: async (deps, req, res, caller) => {
      const data = await runRpc(deps, caller.token, 'report', 'admin_partner_report_summary', {
        p_area: optionalText(req.query.area, 80),
      });
      send(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/admin/partners/:id/state',
    handler: async (deps, req, res, caller) => {
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'A partner id is required.', 'invalid_request');
      const body = await readJsonBody(req);
      const action = enumParam(body.action, MODERATION_ACTIONS, null, 'moderation action');
      if (!action) throw new BackendError(400, 'A moderation action is required.', 'invalid_request');
      // The two destructive cases are gated here as well as in SQL.
      if (caller.role !== 'super_admin' && (action === 'soft_delete' || action === 'restore')) {
        throw new BackendError(403, 'Only a Super Admin can delete or restore a partner profile.', 'super_admin_required');
      }
      if ((action === 'ban' || action === 'soft_delete') && !optionalText(body.reason, 300)) {
        throw new BackendError(400, `A reason is required to ${action === 'ban' ? 'ban' : 'delete'} a partner.`, 'invalid_request');
      }
      const data = await runRpc(deps, caller.token, 'moderation', 'admin_set_partner_state', {
        p_partner_id: id,
        p_action: action,
        p_reason: optionalText(body.reason, 300),
        p_area: null,
      });
      send(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/admin/partners/:id/area',
    handler: async (deps, req, res, caller) => {
      if (caller.role !== 'super_admin') throw new BackendError(403, 'Only a Super Admin can assign a work area.', 'super_admin_required');
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'A partner id is required.', 'invalid_request');
      const body = await readJsonBody(req);
      const data = await runRpc(deps, caller.token, 'area-assign', 'admin_assign_partner_area', {
        p_partner_id: id,
        p_area: requiredText(body.work_area, { min: 2, max: 80, label: 'Work area' }),
      });
      send(res, data);
    },
  },

  // ── Financial oversight ──────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/admin/partners/:id/bank-details',
    handler: async (deps, req, res, caller) => {
      assertMoney(caller);
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'A partner id is required.', 'invalid_request');
      const body = await readJsonBody(req);
      const patch: Record<string, unknown> = {};
      for (const key of ['payout_method', 'payout_account_name', 'payout_account_number', 'payout_ifsc', 'payout_upi_id']) {
        if (body[key] !== undefined) patch[key] = optionalText(body[key], 120);
      }
      if (!Object.keys(patch).length) {
        throw new BackendError(400, 'Nothing to update.', 'invalid_request');
      }
      const data = await runRpc(deps, caller.token, 'bank-details', 'admin_update_partner_bank_details', {
        p_partner_id: id,
        p_patch: patch,
      });
      send(res, data);
    },
  },
  {
    method: 'get',
    path: '/api/admin/payouts',
    handler: async (deps, req, res, caller) => {
      const data = await runRpc(deps, caller.token, 'payouts', 'admin_list_partner_payouts', {
        p_status: enumParam(req.query.status, new Set(['open', 'paid', 'rejected', 'all']), 'open', 'payout status'),
        p_area: optionalText(req.query.area, 80),
        p_limit: boundedInt(req.query.limit, { default: 100, min: 1, max: 200, name: 'limit' }),
      });
      send(res, data ?? { items: [], total: 0 });
    },
  },
  {
    method: 'post',
    path: '/api/admin/payouts/:id/process',
    handler: async (deps, req, res, caller) => {
      assertMoney(caller);
      const id = String(req.params?.id || '').trim();
      if (!isUuidLike(id)) throw new BackendError(400, 'A payout request id is required.', 'invalid_request');
      const body = await readJsonBody(req);
      const action = enumParam(body.action, new Set(['mark_paid', 'reject']), null, 'payout action');
      if (!action) throw new BackendError(400, 'Choose mark_paid or reject.', 'invalid_request');
      // Same bounds the SQL function enforces, checked here so the operator
      // learns before the round trip (and so the message names the field).
      const utr = optionalText(body.utr, 60);
      const note = optionalText(body.note, 300);
      if (action === 'mark_paid' && (!utr || utr.length < 6)) {
        throw new BackendError(400, 'Enter the UTR / reference of at least 6 characters before marking this paid.', 'invalid_request');
      }
      if (action === 'reject' && (!note || note.length < 3)) {
        throw new BackendError(400, 'A reason of at least 3 characters is required to reject a payout request.', 'invalid_request');
      }
      const data = await runRpc(deps, caller.token, 'payout-process', 'admin_process_partner_payout', {
        p_request_id: id,
        p_action: action,
        p_utr: utr,
        p_note: note,
      });
      send(res, data);
    },
  },

  // ── Candidate documents (private bucket, super admin only) ──────────────
  {
    method: 'get',
    path: '/api/admin/manager-documents/:path',
    handler: async (deps, req, res, caller) => {
      if (caller.role !== 'super_admin') {
        throw new BackendError(403, 'Only a Super Admin can open candidate documents.', 'super_admin_required');
      }
      const objectPath = String(req.params?.path || '');
      const decoded = decodeURIComponent(objectPath);
      if (!decoded || decoded.includes('..')) {
        throw new BackendError(400, 'A document path is required.', 'invalid_request');
      }
      if (!deps.admin?.storage) {
        throw new BackendError(503, 'Document storage is not configured on this deployment.', 'storage_unavailable');
      }
      const { data, error } = await deps.admin.storage.from('manager-documents').createSignedUrl(decoded, 60);
      if (error || !data?.signedUrl) {
        throw new BackendError(404, 'That document is not available.', 'not_found');
      }
      if (res.headersSent) return;
      // A browser tab opens this href directly, so answer with the redirect
      // instead of JSON — the signed URL itself expires in a minute.
      res.redirect(302, data.signedUrl);
    },
  },

  // ── Audit trail ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/admin/audit-logs',
    handler: async (deps, req, res, caller) => {
      const data = await runRpc(deps, caller.token, 'audit', 'admin_list_audit_logs', {
        p_target_type: optionalText(req.query.target_type, 60),
        p_target_id: isUuidLike(String(req.query.target_id || '')) ? String(req.query.target_id) : null,
        p_limit: boundedInt(req.query.limit, { default: 100, min: 1, max: 500, name: 'limit' }),
      });
      send(res, data);
    },
  },

  // ── Export (super admin only; CSV, and the export itself is audited) ─────
  {
    method: 'get',
    path: '/api/admin/partners/export.csv',
    handler: async (deps, req, res, caller) => {
      if (caller.role !== 'super_admin') {
        throw new BackendError(403, 'Only a Super Admin can export partner data.', 'super_admin_required');
      }
      const data = await runRpc(deps, caller.token, 'export', 'admin_export_partner_directory', {
        p_area: optionalText(req.query.area, 80),
        p_status: enumParam(
          req.query.status,
          new Set(['all', 'active', 'inactive', 'banned', 'deleted', 'pending']),
          null,
          'partner status'
        ),
      });
      const csv = toDirectoryCsv(Array.isArray(data?.items) ? data.items : []);
      if (res.headersSent) return;
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="partner-directory-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.status(200).send(csv);
    },
  },
];

/** CSV keeps the columns an operator acts on, never bank numbers or secrets. */
export function toDirectoryCsv(items: any[]): string {
  const columns = [
    'partner_id', 'referral_code', 'full_name', 'email', 'phone', 'whatsapp',
    'work_area', 'status', 'is_active', 'banned_at', 'deleted_at',
    'onboarded_salons', 'active_referrals', 'lifetime_paise', 'available_paise', 'open_payouts', 'created_at',
  ];
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.join(',')];
  for (const row of items) {
    lines.push(
      columns
        .map((column) => {
          if (column === 'partner_id') return escape(row?.id);
          if (column === 'status') return escape(row?.status ?? (row?.is_active ? 'active' : 'inactive'));
          return escape(row?.[column]);
        })
        .join(',')
    );
  }
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Public onboarding routes — the token is the authorization
// ---------------------------------------------------------------------------
export type PublicOnboardingRoute = {
  method: 'get' | 'post';
  path: string;
  handler: (deps: AdminRouteDeps, req: Request, res: Response) => Promise<void>;
};

export async function submitPublicApplication(
  deps: AdminRouteDeps,
  req: Request,
  res: Response,
  token: string
): Promise<void> {
  const body = await readJsonBody(req);
  const call =
    deps.callRpc ??
    ((_bearer: string, name: string, payload: Record<string, unknown>) =>
      (deps.admin ?? deps.db).rpc(name, payload));
  // Public submissions run through the service-role client: the candidate has no
  // session, and the SQL function is the only thing allowed to write this table.
  let result: { data?: any; error?: any };
  try {
    result = await call('', 'submit_manager_onboarding_application', {
      p_token: token,
      p_payload: body,
    });
  } catch (error: any) {
    throw adminRpcFailure(error);
  }
  if (result?.error) throw adminRpcFailure(result.error);
  send(res, result?.data ?? { ok: true }, 201);
}

export const PUBLIC_ONBOARDING_ROUTES: PublicOnboardingRoute[] = [
  {
    method: 'get',
    path: '/api/public/manager-onboarding/:token',
    handler: async (deps, req, res) => {
      const token = String(req.params?.token || '').trim();
      if (token.length < 16) throw new BackendError(404, 'This onboarding link does not exist.', 'not_found');
      const call =
        deps.callRpc ??
        ((_bearer: string, name: string, payload: Record<string, unknown>) =>
          (deps.admin ?? deps.db).rpc(name, payload));
      const { data, error } = await call('', 'get_manager_onboarding_link', { p_token: token });
      if (error) throw adminRpcFailure(error);
      send(res, data ?? { valid: false, reason: 'not_found' });
    },
  },
  {
    method: 'post',
    path: '/api/public/manager-onboarding/:token',
    handler: async (deps, req, res) => {
      const token = String(req.params?.token || '').trim();
      if (token.length < 16) throw new BackendError(404, 'This onboarding link does not exist.', 'not_found');
      await submitPublicApplication(deps, req, res, token);
    },
  },
  {
    method: 'post',
    path: '/api/public/manager-onboarding/:token/documents',
    handler: async (deps, req, res) => {
      const token = String(req.params?.token || '').trim();
      if (token.length < 16) throw new BackendError(404, 'This onboarding link does not exist.', 'not_found');
      const body = await readJsonBody(req, 16 * 1024 * 1024);
      const kind = String(body.kind || '').trim();
      if (!DOCUMENT_KINDS.has(kind)) {
        throw new BackendError(400, 'kind must be photo, aadhaar_front, aadhaar_back or pan_card.', 'invalid_request');
      }
      const dataUrl = typeof body.data_url === 'string' ? body.data_url : '';
      const match = dataUrl.match(/^data:([\w./+-]+);base64,(.+)$/);
      if (!match) {
        throw new BackendError(400, 'Send the file as a base64 data URL.', 'invalid_request');
      }
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
        throw new BackendError(413, 'Each document must be smaller than 10 MB.', 'payload_too_large');
      }
      const store = deps.storeDocument ?? defaultStoreDocument(deps);
      const path = await store({
        token,
        kind,
        file_name: String(body.file_name || `${kind}.bin`),
        content_type: match[1],
        bytes,
      });
      if (!path) {
        throw new BackendError(
          503,
          'Document storage is not configured on this deployment. Send the documents to the reviewer another way.',
          'storage_unavailable'
        );
      }
      send(res, { kind, path }, 201);
    },
  },
];

// ---------------------------------------------------------------------------
// Default service-role implementations
// ---------------------------------------------------------------------------
function defaultCreateAuthUser(deps: AdminRouteDeps) {
  return async (input: { email: string; password: string; full_name: string; work_area: string; role: string }) => {
    if (!deps.admin?.auth?.admin?.createUser) {
      throw new BackendError(
        503,
        'Creating the manager account needs a service-role Supabase connection on the server.',
        'storage_unavailable'
      );
    }
    const { data, error } = await deps.admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { role: input.role, work_area: input.work_area },
      user_metadata: { full_name: input.full_name },
    });
    if (error || !data?.user?.id) {
      const message = String(error?.message || '');
      throw new BackendError(
        /already/i.test(message) ? 409 : 502,
        /already/i.test(message)
          ? 'An account with this email already exists. Use “Reset password” instead, or reject the application.'
          : 'The manager account could not be created. Please try again.',
        /already/i.test(message) ? 'conflict' : 'backend_unavailable'
      );
    }
    return { id: data.user.id };
  };
}

function defaultStoreDocument(deps: AdminRouteDeps) {
  return async (input: { token: string; kind: string; file_name: string; content_type: string; bytes: Buffer }) => {
    if (!deps.admin?.storage) return null;
    const safeName = input.file_name.replace(/[^\w.-]+/g, '_').slice(-60);
    const path = `${input.token}/${input.kind}-${Date.now()}-${safeName}`;
    const { error } = await deps.admin.storage
      .from('manager-documents')
      .upload(path, input.bytes, { contentType: input.content_type, upsert: false });
    return error ? null : path;
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
type AsyncRoute = (handler: (req: Request, res: Response) => Promise<void>) => any;

/**
 * Wraps a handler so every failure becomes the safe JSON error shape. Public
 * routes pass NO auth gate; operator routes resolve the caller first.
 */
function wrap(handler: (req: Request, res: Response) => Promise<void>, sendError: (res: Response, error: unknown) => void) {
  // Returns the promise on purpose: a test (or a caller) can await the whole
  // request, and the failure is still turned into the safe JSON answer.
  return (req: Request, res: Response) => handler(req, res).catch((error) => sendError(res, error));
}

/** Express-level error answer: JSON only, with the safe code + copy. */
export function sendAdminError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof BackendError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const status = Number((error as any)?.status) || 500;
  logPartnerFailure('admin.api.unhandled', error);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: { code: 'server_error', message: 'The admin backend could not answer. Please try again.' },
  });
}

export function registerAdminRoutes(
  app: Express,
  deps: AdminRouteDeps,
  asyncRoute?: AsyncRoute,
  sendError: (res: Response, error: unknown) => void = sendAdminError
): void {
  const routed = asyncRoute ?? ((handler: (req: Request, res: Response) => Promise<void>) => wrap(handler, sendError));

  // Public first: these must not resolve an admin caller.
  for (const route of PUBLIC_ONBOARDING_ROUTES) {
    const handler = routed(async (req: Request, res: Response) => {
      await route.handler(deps, req, res);
    });
    if (route.method === 'get') app.get(route.path, handler);
    else app.post(route.path, handler);
  }

  for (const route of ADMIN_ROUTES) {
    const handler = routed(async (req: Request, res: Response) => {
      // One gate for every operator route: verify the token, then read the role
      // from SQL. The narrower rules (super admin only, money only) live in the
      // handler AND in SQL, so a handler cannot be the only thing enforcing them.
      const caller = await requireAdmin(deps, req);
      await route.handler(deps, req, res, caller);
    });
    if (route.method === 'get') app.get(route.path, handler);
    else app.post(route.path, handler);
  }
}

export { adminRpcFailure, requireAdmin, requireSuperAdmin };
