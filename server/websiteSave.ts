import { BackendError, databaseForToken, verifyBackendUser, readDatabase } from './backendContext.js';
// Authenticated fallback for editor saves. Identity is verified against Supabase
// Auth, then the caller-scoped workspace RPC enforces ownership and commits
// contact, catalogue and editor state together.
import { isMockSupabase, getSupabaseAdmin, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../src/lib/supabaseClient.js";
import { SALON_SYNC_TABLES } from "../src/lib/salonSync.js";
import { isUuid } from "../src/lib/autoSave.js";
import { SalonProfile, SalonService, Stylist, LoyaltyConfig } from "../src/types.js";
import {
  runDb,
  DEFAULT_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard.js';

export interface WebsiteSaveDeps {
  /** In-memory salon registry used when Supabase is not configured (mock mode). */
  mockSalons: Record<string, any>;
}

/** Descriptive server-side diagnostics, always prefixed for DevTools grep. */
function syncError(message: string, extra?: unknown): void {
  if (extra !== undefined) {
    console.error('[Nexora Sync Error]:', message, extra);
  } else {
    console.error('[Nexora Sync Error]:', message);
  }
}

/**
 * Verify that the caller presenting `authorizationHeader` is the Supabase
 * user `ownerId` — i.e. they can only save their own salon.
 *
 * The token is validated server-side by Supabase Auth itself
 * (GET /auth/v1/user, same endpoint supabase.auth.getUser() uses internally)
 * using the service-role apikey — no JWT secret or extra dependency needed.
 * Returns a precise reason on failure so the rejection is diagnosable.
 */
async function verifyCallerIsOwner(
  ownerId: string,
  authorizationHeader: string | undefined,
  deadlineAt?: number
): Promise<string | null> {
  const token = (authorizationHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return "missing access token (Authorization: Bearer <token>)";
  }

  const remaining = typeof deadlineAt === 'number' ? deadlineAt - Date.now() : 4000;
  if (remaining <= 0) return 'auth server lookup exceeded the request deadline';

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(Math.max(1, Math.min(4000, remaining))),
    });
  } catch (err) {
    return `auth server unreachable (${(err as Error)?.message ?? "network error"})`;
  }

  if (!res.ok) {
    return `access token rejected by Supabase Auth (HTTP ${res.status})`;
  }

  const user: any = await res.json().catch(() => null);
  if (!user || typeof user.id !== "string" || !user.id) {
    return "auth server returned no user for this token";
  }
  if (user.id !== ownerId) {
    return `token belongs to user ${user.id} but owner_id is ${ownerId} — callers may only save their own salon`;
  }
  return null;
}

/**
 * Build the Express handler for POST /api/website/save.
 * `deps.mockSalons` is the entrypoint's in-memory registry so mock-mode saves
 * round-trip through GET /api/site/:subdomain.
 */
export function handleWebsiteSave(deps: WebsiteSaveDeps) {
  return async (req: any, res: any): Promise<void> => {
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      // ------------------------------------------------------------------
      // Parse the incoming salonData (accept { salonData: {...} } or bare).
      // ------------------------------------------------------------------
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const salonData =
        body.salonData && typeof body.salonData === "object" ? body.salonData : body;

      for (const key of ['services', 'stylists', 'appointments', 'clients']) {
        if (salonData[key] !== undefined && !Array.isArray(salonData[key])) {
          return res.status(400).json({ success: false, error: key + ' must be an array.' });
        }
      }
      const profile: SalonProfile | null =
        salonData.profile && typeof salonData.profile === "object" ? salonData.profile : null;
      const services: SalonService[] = Array.isArray(salonData.services)
        ? (salonData.services as SalonService[])
        : [];
      const stylists: Stylist[] = Array.isArray(salonData.stylists)
        ? (salonData.stylists as Stylist[])
        : [];
      const loyaltyConfig: LoyaltyConfig | null =
        salonData.loyaltyConfig && typeof salonData.loyaltyConfig === "object"
          ? (salonData.loyaltyConfig as LoyaltyConfig)
          : null;

      // ------------------------------------------------------------------
      // Validate the essential fields.
      // ------------------------------------------------------------------
      const subdomain =
        typeof profile?.subdomain === "string" ? profile.subdomain.trim().toLowerCase() : "";
      const ownerId = String(
        salonData.ownerId ?? salonData.owner_id ?? profile?.ownerId ?? ""
      ).trim();

      if (!subdomain) {
        syncError('POST /api/website/save rejected — missing essential field "subdomain" (profiles.subdomain).', {
          tables: [...SALON_SYNC_TABLES],
        });
        return res.status(400).json({ success: false, error: 'salonData.profile.subdomain is required.' });
      }
      if (!ownerId) {
        syncError(
          'POST /api/website/save rejected — missing essential field "owner_id" (profiles.id + owner_id foreign keys).',
          { tables: [...SALON_SYNC_TABLES] }
        );
        return res.status(400).json({ success: false, error: "owner_id is required." });
      }
      if (!isMockSupabase && !isUuid(ownerId)) {
        syncError(`POST /api/website/save rejected — owner_id "${ownerId}" is not a valid Supabase user id (uuid).`, {
          tables: ["profiles"],
        });
        return res.status(400).json({ success: false, error: "owner_id must be a valid user id (uuid)." });
      }

      // ------------------------------------------------------------------
      // Live-mode identity check: the service role bypasses RLS, so this
      // endpoint is the authorization boundary. The caller must present
      // their own Supabase access token and it must match owner_id —
      // otherwise ANY visitor could upsert ANY owner's rows.
      // Mock mode skips this (local dev/demo has no auth server).
      // ------------------------------------------------------------------
      if (!isMockSupabase) {
        const authError = await verifyCallerIsOwner(ownerId, req.headers?.authorization, deadlineAt);
        if (authError !== null) {
          syncError(`POST /api/website/save rejected (AUTH): ${authError}.`, {
            owner_id: ownerId,
          });
          return res.status(401).json({ success: false, error: "Unauthorized" });
        }
      }

      // ------------------------------------------------------------------
      // Mock mode (local session / Supabase not configured): persist in the
      // in-memory registry so the demo flow — including the public site —
      // keeps working end to end.
      // ------------------------------------------------------------------
      if (isMockSupabase) {
        deps.mockSalons[subdomain] = {
          profile: { ...profile, subdomain, ownerId },
          services,
          stylists,
          loyaltyConfig,
          customDomain: profile?.customDomain || null,
        };
        console.info(
          `[Website save] (mock) persisted site state for subdomain "${subdomain}" (owner_id=${ownerId}) in the in-memory registry.`
        );
        return res.json({ success: true, timestamp: Date.now(), mode: "mock" });
      }

      // ------------------------------------------------------------------
      // Live mode: persist with the ADMIN (service role) client — this is the
      // only safe way to bypass RLS from the server.
      // ------------------------------------------------------------------
      const admin = getSupabaseAdmin();
      if (!admin) {
        syncError(
          "POST /api/website/save cannot persist — SUPABASE_SERVICE_ROLE_KEY is not configured server-side. Refusing to write through the anon client (RLS would reject it). Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        );
        return res.status(503).json({
          success: false,
          code: 'supabase_not_configured',
          retryable: true,
          error: 'The site database is not configured on this server. Please try again later.',
        });
      }

      const extraState = {
        ...(Array.isArray(salonData.appointments) ? { appointments: salonData.appointments } : {}),
        ...(Array.isArray(salonData.clients) ? { clients: salonData.clients } : {}),
        ...(salonData.selectedTemplateId !== undefined ? { selectedTemplateId: salonData.selectedTemplateId } : {}),
      };
      // Use the same transaction as the editor. Never write salon fields into identity profiles.
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const result = await runDb(() => databaseForToken(token).rpc('save_owner_editor_state', {
        p_state: { profile, ...(salonData.services !== undefined ? { services } : {}), ...(salonData.stylists !== undefined ? { stylists } : {}), ...extraState, ...(loyaltyConfig ? { loyaltyConfig } : {}) },
      }), { label: 'atomic owner workspace save', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });
      if (result.error) {
        syncError('Owner workspace transaction failed', { code: result.error.code, message: result.error.message });
        if (responseAlreadyEnded(res)) return;
        return res.status(503).json({ success: false, code: 'workspace_save_failed', error: 'Your workspace could not be saved. Please retry.', retryable: true });
      }
      if (responseAlreadyEnded(res)) return;
      return res.json({ success: true, timestamp: Date.now(), mode: 'live' });
    } catch (err: any) {
      // Unreachable in normal operation (every DB call above is wrapped),
      // but the endpoint must always answer JSON, never an HTML 500 page.
      syncError("POST /api/website/save handler crashed:", {
        message: err?.message ?? String(err),
      });
      if (responseAlreadyEnded(res)) return;
      return res.status(500).json({ error: "Failed to persist site state" });
    }
  };
}

/** Restore the verified caller's private workspace; query-string identities are not trusted. */
export function handleGetSalonState(deps: WebsiteSaveDeps) {
  return async (req: any, res: any): Promise<void> => {
    try {
      if (isMockSupabase) {
        return void res.json({ success: true, mode: 'mock', data: deps.mockSalons[String(req.query?.subdomain || '')] || null });
      }
      const admin = getSupabaseAdmin();
      if (!admin) throw new BackendError(503, 'The workspace database is not configured.', 'supabase_not_configured');
      const { token } = await verifyBackendUser(admin, req);
      const data = await readDatabase(() => databaseForToken(token).rpc('get_owner_editor_state'), res.locals?.requestDeadlineAt);
      if (!responseAlreadyEnded(res)) res.json({ success: true, mode: 'live', data: data || null });
    } catch (error: any) {
      if (responseAlreadyEnded(res)) return;
      if (error instanceof BackendError) return void res.status(error.status).json({ success: false, code: error.code, error: error.message });
      syncError('Workspace hydration failed', { code: error?.code });
      res.status(503).json({ success: false, code: 'workspace_load_failed', error: 'Your saved workspace could not be loaded. Please retry.', retryable: true });
    }
  };
}
