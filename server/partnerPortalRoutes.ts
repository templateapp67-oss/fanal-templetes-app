// ============================================================================
// Growth Partner portal OPERATIONS API — /api/partner/*
//
// The HTTP surface for the seven sidebar sections that were "Coming soon"
// slots until Part 3: Earnings, Withdrawals, Marketing Materials, Partner
// Levels, Leaderboards, Notifications, Support. `src/lib/partnerPortalOperations.ts`
// prefers these routes and falls back to the PostgREST RPCs directly, so the
// pages work with or without this file — but with it, the portal gets one place
// to log failures, bound payloads and version the contract.
//
// AUTHORIZATION MODEL — deliberately thin
// --------------------------------------
// Every handler does two things and nothing else: verify the caller's Supabase
// bearer token, then call the RPC **with that same token**. Nothing here passes
// a partner id, and nothing here widens visibility: the SQL functions derive the
// partner from auth.uid() (my_active_partner_id()) and raise 42501 for a caller
// who is not an approved, active partner. A forged body therefore cannot read
// another partner's wallet — the route has no parameter to forge.
//
// The allowlist of "what a section may see" lives in SQL (each function selects
// exactly the columns its page renders), which is why the answers below are
// forwarded as-is instead of being re-projected: this surface can never expose
// more than the RPC the browser would have called directly.
//
// RAW DATABASE MESSAGES NEVER LEAVE THE SERVER, with one deliberate exception:
// the constraint refusals these functions raise in the partner's own words
// ("Minimum withdrawal is ₹500") are user-facing copy and are forwarded.
// Everything else is logged with logPartnerFailure and answered with a fixed
// sentence.
// ============================================================================

import type { Express, Request, Response } from 'express';
import { BackendError, databaseForToken, verifyBackendUser } from './backendContext.js';
import { logPartnerFailure } from './partnerErrorLog.js';
import { isUuidLike } from './bookingOps.js';

/** The portal operations this surface exposes: RPC name + how to bound inputs. */
const PAYOUT_METHODS = new Set(['upi', 'bank_transfer', 'paypal']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high']);
const TICKET_STATUSES = new Set(['open', 'in_progress', 'resolved']);
const NOTIFICATION_TYPES = new Set(['system', 'payout', 'referral', 'reward']);
const ASSET_CATEGORIES = new Set(['banner', 'email_template', 'social_graphic', 'video_demo']);
const EARNING_LIMITS = { max: 200, default: 25 };
const NOTIFICATION_LIMITS = { max: 100, default: 50 };

/** Copy written FOR the partner inside the SQL functions → safe to forward. */
const PARTNER_FACING_REFUSAL =
  /^(?:Minimum withdrawal is|Withdrawal exceeds available balance|Invalid payout destination|Invalid ticket|Open payout request not found)/i;

export interface PartnerPortalRouteDeps {
  /** Client used to verify the bearer token (the app's Supabase client). */
  db: any;
  /** No live Supabase connection: the API answers 503 and the client falls back. */
  isMock: boolean;
  /**
   * RPC transport, injectable so tests can assert the exact call shape without
   * a database. Defaults to a token-scoped client, which is what keeps RLS and
   * the functions' own partner guards in force.
   */
  callRpc?: (token: string, fn: string, args: Record<string, unknown>) => Promise<{ data?: any; error?: any }>;
  /**
   * Signs a short-lived URL for one private-bucket marketing asset. Absent (no
   * service key configured) → the download route answers 503 and the page says
   * so instead of pretending the file is downloadable.
   */
  signAssetUrl?: (bucket: string, path: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Input binding helpers
// ---------------------------------------------------------------------------

function intParam(raw: unknown, options: { default: number; max: number; name: string }): number {
  if (raw === undefined || raw === null || raw === '') return options.default;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new BackendError(400, `${options.name} must be a positive number.`, 'invalid_request');
  }
  return Math.min(Math.floor(value), options.max);
}

function offsetParam(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new BackendError(400, 'offset must be zero or a positive number.', 'invalid_request');
  }
  return Math.floor(value);
}

/** Optional enum filter: empty/`all` means "no filter", anything else must match. */
function enumParam(raw: unknown, allowed: Set<string>, name: string): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value === 'all') return null;
  if (!allowed.has(value)) throw new BackendError(400, `Unknown ${name}.`, 'invalid_request');
  return value;
}

function textParam(body: Record<string, any>, key: string, options: { min: number; max: number; label: string }): string {
  const value = typeof body?.[key] === 'string' ? body[key].trim() : '';
  if (value.length < options.min) {
    throw new BackendError(400, `${options.label} must be at least ${options.min} characters.`, 'invalid_request');
  }
  if (value.length > options.max) {
    throw new BackendError(400, `${options.label} must be at most ${options.max} characters.`, 'invalid_request');
  }
  return value;
}

function boolParam(body: Record<string, any>, key: string, fallback: boolean): boolean {
  const value = body?.[key];
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 1;
}

// ---------------------------------------------------------------------------
// Execution + failure mapping
// ---------------------------------------------------------------------------

/** Postgres SQLSTATE → HTTP. The codes are the ones the RPCs raise with. */
function partnerRpcFailure(error: any): BackendError {
  const code = String(error?.code || '').trim();
  const rawMessage = String(error?.message || '').trim();
  // PGRST202: the function is not in the schema cache — the migration was
  // never applied to this project. 501 says "not implemented here", which is
  // exactly what it is, and the client names the two files to run.
  if (code === 'PGRST202') {
    return new BackendError(501, 'The partner operations schema is not applied to this project yet.', 'schema_not_applied');
  }
  if (code === '42501' || /Active Growth Partner required/i.test(rawMessage)) {
    return new BackendError(403, 'These records are only available to an approved, active Growth Partner.', 'partner_only');
  }
  if (code === '22023' || code === 'P0002' || PARTNER_FACING_REFUSAL.test(rawMessage)) {
    const message = PARTNER_FACING_REFUSAL.test(rawMessage) ? rawMessage.slice(0, 300) : 'The request was refused by the partner backend.';
    return new BackendError(400, message, 'invalid_request');
  }
  // A second open payout request is refused by a partial UNIQUE index, which
  // answers with a raw constraint name. Forwarded as the fix, not the index.
  if (code === '23505' || /one_open_per_partner/i.test(rawMessage)) {
    return new BackendError(
      400,
      'You already have a payout request open. Wait for the review, or cancel it and request again.',
      'invalid_request'
    );
  }
  if (/jwt expired|invalid claim|token/i.test(rawMessage)) {
    return new BackendError(401, 'Your session could not be verified. Sign in again.', 'auth_required');
  }
  return new BackendError(502, 'The partner backend could not answer. Please try again.', 'backend_unavailable');
}

/** No live connection: answer 503 before anything else, so no route can half-work. */
async function callerToken(deps: PartnerPortalRouteDeps, req: Request): Promise<string> {
  if (deps.isMock) {
    throw new BackendError(
      503,
      'No Supabase project is connected, so partner earnings, payouts and tickets cannot be read yet.',
      'backend_unavailable'
    );
  }
  const { token } = await verifyBackendUser(deps.db, req);
  return token;
}

/**
 * Run one RPC **as the verified caller** (`operation` is only the log label).
 *
 * Verification happens in the mount wrapper below, before a handler parses its
 * body — so an anonymous probe never learns which fields exist or what the
 * validation bounds are, and a handler cannot forget the check.
 */
async function runAs(
  deps: PartnerPortalRouteDeps,
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
    logPartnerFailure(`api.${operation}`, error);
    throw new BackendError(502, 'The partner backend could not answer. Please try again.', 'backend_unavailable');
  }
  if (result.error) {
    logPartnerFailure(`api.${operation}`, result.error);
    throw partnerRpcFailure(result.error);
  }
  return result.data;
}

function answer(res: Response, data: unknown): void {
  if (res.headersSent) return;
  res.status(200).json({ data });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Route table so the dev server and the Vercel entrypoint register one list. */
export type PartnerPortalRoute = {
  method: 'get' | 'post';
  path: string;
  /** Human description — also what the test suite asserts the contract on. */
  description: string;
  /** `token` is the ALREADY VERIFIED caller; handlers never re-do that work. */
  handler: (deps: PartnerPortalRouteDeps, req: Request, res: Response, token: string) => Promise<void>;
};

export const PARTNER_PORTAL_ROUTES: PartnerPortalRoute[] = [
  {
    method: 'get',
    path: '/api/partner/earnings',
    description: 'The partner’s own commission ledger: totals + newest rows.',
    handler: async (deps, req, res, token) => {
      const data = await runAs(deps, token, 'earnings', 'get_my_partner_earnings', {
        p_limit: intParam(req.query.limit, { ...EARNING_LIMITS, default: EARNING_LIMITS.default, name: 'limit' }),
        p_offset: offsetParam(req.query.offset),
      });
      answer(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/partner/payout-requests',
    description: 'Request a payout (₹500 minimum, within the cleared balance).',
    handler: async (deps, req, res, token) => {
      const body = (req.body || {}) as Record<string, any>;
      const amountPaise = Number(body.amount_paise);
      if (!Number.isFinite(amountPaise) || !Number.isInteger(amountPaise) || amountPaise <= 0) {
        throw new BackendError(400, 'Amount must be a whole number of paise.', 'invalid_request');
      }
      const method = String(body.method || '').trim();
      if (!PAYOUT_METHODS.has(method)) {
        throw new BackendError(400, 'Choose UPI, bank transfer or PayPal.', 'invalid_request');
      }
      const destination = textParam(body, 'destination_label', {
        min: 2,
        max: 120,
        label: 'Destination reference',
      });
      const data = await runAs(deps, token, 'payout-request-create', 'request_my_partner_payout', {
        p_amount_paise: Math.round(amountPaise),
        p_method: method,
        p_destination_label: destination,
      });
      if (res.headersSent) return;
      res.status(201).json({ data });
    },
  },
  {
    method: 'get',
    path: '/api/partner/payout-requests',
    description: 'The partner’s own payout requests, newest first, with the open total.',
    handler: async (deps, req, res, token) => {
      const data = await runAs(deps, token, 'payout-request-list', 'get_my_partner_payout_requests', {
        p_limit: intParam(req.query.limit, { max: 100, default: 25, name: 'limit' }),
        p_offset: offsetParam(req.query.offset),
      });
      answer(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/partner/payout-requests/cancel',
    description: 'Withdraw one of the caller’s own still-open requests.',
    handler: async (deps, req, res, token) => {
      const requestId = String((req.body || {}).request_id || '').trim();
      if (!isUuidLike(requestId)) {
        throw new BackendError(400, 'A payout request id is required.', 'invalid_request');
      }
      const data = await runAs(deps, token, 'payout-request-cancel', 'cancel_my_partner_payout_request', {
        p_request_id: requestId,
      });
      answer(res, data);
    },
  },
  {
    method: 'get',
    path: '/api/partner/levels',
    description: 'Tier ladder + how many active referrals the caller has.',
    handler: async (deps, _req, res, token) => {
      answer(res, await runAs(deps, token, 'levels', 'get_my_partner_levels', {}));
    },
  },
  {
    method: 'get',
    path: '/api/partner/leaderboard',
    description: 'Dense-rank partner standings and the caller’s own rank.',
    handler: async (deps, req, res, token) => {
      const data = await runAs(deps, token, 'leaderboard', 'get_partner_leaderboard', {
        p_limit: intParam(req.query.limit, { max: 100, default: 25, name: 'limit' }),
      });
      answer(res, data);
    },
  },
  {
    method: 'get',
    path: '/api/partner/notifications',
    description: 'The partner’s own notifications with the unread count.',
    handler: async (deps, req, res, token) => {
      const data = await runAs(deps, token, 'notifications', 'get_my_partner_notifications', {
        p_type: enumParam(req.query.type, NOTIFICATION_TYPES, 'notification type'),
        p_limit: intParam(req.query.limit, { ...NOTIFICATION_LIMITS, default: NOTIFICATION_LIMITS.default, name: 'limit' }),
      });
      answer(res, data);
    },
  },
  {
    method: 'post',
    path: '/api/partner/notifications/read',
    description: 'Mark given (or all) notifications read; returns the row count.',
    handler: async (deps, req, res, token) => {
      const raw = (req.body || {}).ids;
      const ids = Array.isArray(raw)
        ? raw.map((id: unknown) => String(id || '').trim()).filter((id: string) => id.length > 0)
        : [];
      if (ids.length > 100) throw new BackendError(400, 'Mark at most 100 notifications at a time.', 'invalid_request');
      if (ids.some((id: string) => !isUuidLike(id))) {
        throw new BackendError(400, 'Notification ids must be UUIDs.', 'invalid_request');
      }
      const data = await runAs(deps, token, 'notifications-read', 'mark_my_partner_notifications_read', {
        p_ids: ids.length ? ids : null,
      });
      answer(res, { count: Number(data) || 0 });
    },
  },
  {
    method: 'get',
    path: '/api/partner/notification-preferences',
    description: 'Delivery toggles, defaulting to on/on before anything is saved.',
    handler: async (deps, _req, res, token) => {
      answer(res, await runAs(deps, token, 'notification-preferences-read', 'get_my_partner_notification_preferences', {}));
    },
  },
  {
    method: 'post',
    path: '/api/partner/notification-preferences',
    description: 'Save the caller’s own delivery toggles.',
    handler: async (deps, req, res, token) => {
      const body = (req.body || {}) as Record<string, any>;
      const data = await runAs(deps, token, 'notification-preferences-write', 'update_my_partner_notification_preferences', {
        p_email_enabled: boolParam(body, 'email_enabled', true),
        p_in_app_enabled: boolParam(body, 'in_app_enabled', true),
      });
      answer(res, data);
    },
  },
  {
    method: 'get',
    path: '/api/partner/marketing-assets',
    description: 'Published partner creatives, optionally filtered by category.',
    handler: async (deps, req, res, token) => {
      const data = await runAs(deps, token, 'marketing-assets', 'get_partner_marketing_assets', {
        p_category: enumParam(req.query.category, ASSET_CATEGORIES, 'asset category'),
      });
      answer(res, data);
    },
  },
  {
    method: 'get',
    path: '/api/partner/marketing-assets/categories',
    description: 'Category index with published counts, for the library filter.',
    handler: async (deps, _req, res, token) => {
      answer(res, await runAs(deps, token, 'marketing-asset-categories', 'get_partner_marketing_asset_categories', {}));
    },
  },
  {
    method: 'post',
    path: '/api/partner/support-tickets',
    description: 'Raise a partner support ticket; returns the receipt.',
    handler: async (deps, req, res, token) => {
      const body = (req.body || {}) as Record<string, any>;
      const subject = textParam(body, 'subject', { min: 3, max: 180, label: 'Subject' });
      const message = textParam(body, 'message', { min: 10, max: 5000, label: 'Message' });
      const priority = String(body.priority || 'normal').trim();
      if (!TICKET_PRIORITIES.has(priority)) {
        throw new BackendError(400, 'Priority must be low, normal or high.', 'invalid_request');
      }
      const data = await runAs(deps, token, 'support-ticket-create', 'submit_my_partner_support_ticket', {
        p_subject: subject,
        p_message: message,
        p_priority: priority,
      });
      if (res.headersSent) return;
      res.status(201).json({ data });
    },
  },
  {
    method: 'get',
    path: '/api/partner/support-tickets',
    description: 'The partner’s own tickets with status filter.',
    handler: async (deps, req, res, token) => {
      const data = await runAs(deps, token, 'support-ticket-list', 'get_my_partner_support_tickets', {
        p_limit: intParam(req.query.limit, { max: 100, default: 25, name: 'limit' }),
        p_status: enumParam(req.query.status, TICKET_STATUSES, 'ticket status'),
      });
      answer(res, data);
    },
  },
];

/**
 * The one route that is NOT a thin RPC proxy: a marketing asset lives in a
 * private bucket, so signing its URL needs the service-role client. The pair
 * (caller, asset) is authorized through the caller's own published list — an
 * unpublished or unknown id is refused even though the signer is privileged.
 */
async function assetDownloadUrl(
  deps: PartnerPortalRouteDeps,
  req: Request,
  res: Response,
  token: string
): Promise<void> {
  const assetId = String(req.params?.id || '').trim();
  if (!isUuidLike(assetId)) throw new BackendError(400, 'Asset id must be a UUID.', 'invalid_request');
  // Authorization BEFORE capability: the caller's own published list is what
  // makes an asset fetchable, so an unknown or unpublished id is a 404 here
  // even for a deploy that could sign any URL at all.
  const published = await runAs(deps, token, 'marketing-asset-download', 'get_partner_marketing_assets', {
    p_category: null,
  });
  if (!deps.signAssetUrl) {
    throw new BackendError(503, 'Asset downloads need a storage-enabled Supabase connection.', 'storage_unavailable');
  }
  const rows = Array.isArray(published) ? published : [];
  const asset = rows.find((row: any) => String(row?.id || '') === assetId);
  if (!asset) {
    throw new BackendError(404, 'That asset is not published for partners.', 'asset_not_found');
  }
  const signedUrl = await deps.signAssetUrl(String(asset.storage_bucket), String(asset.storage_path));
  if (!signedUrl) {
    throw new BackendError(503, 'The asset storage bucket is not configured yet.', 'storage_unavailable');
  }
  answer(res, { signed_url: signedUrl, expires_in_seconds: 60, file_name: String(asset.title || 'asset') });
}

/** Express-level error answer: JSON only, with the safe code + copy. */
function sendPartnerError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof BackendError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const status = Number((error as any)?.status) || 500;
  logPartnerFailure('api.unhandled', error);
  res.status(status >= 400 && status <= 599 ? status : 500).json({
    error: { code: 'backend_unavailable', message: 'The partner backend could not answer. Please try again.' },
  });
}

/**
 * Register the portal operations routes. Called identically from `server.ts`
 * (dev + self-hosted) and `api/index.ts` (Vercel), so the two entrypoints can
 * never drift apart — the same table, the same binding rules.
 */
export function registerPartnerPortalRoutes(
  app: Express,
  deps: PartnerPortalRouteDeps,
  wrap: (handler: (req: Request, res: Response) => void) => any = (handler) => handler
): void {
  for (const route of PARTNER_PORTAL_ROUTES) {
    app[route.method](
      route.path,
      wrap(async (req: Request, res: Response) => {
        try {
          const token = await callerToken(deps, req);
          await route.handler(deps, req, res, token);
        } catch (error) {
          sendPartnerError(res, error);
        }
      })
    );
  }
  app.get(
    '/api/partner/marketing-assets/:id/download',
    wrap(async (req: Request, res: Response) => {
      try {
        const token = await callerToken(deps, req);
        await assetDownloadUrl(deps, req, res, token);
      } catch (error) {
        sendPartnerError(res, error);
      }
    })
  );
}
