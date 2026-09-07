// ============================================================================
// Shared POST /api/website/save handler (dev server.ts + serverless
// api/index.ts — one implementation so the two entrypoints can't drift, the
// same pattern as server/bookingOps.ts).
//
// Server-side fallback for the editor's auto-save pipeline
// (src/lib/autoSave.ts → runSalonSavePipeline): when the browser's direct
// Supabase client sync fails (network, expired session, RLS policies, missing
// table grants), the client POSTs the full salon state here. This handler
// persists it with the Supabase ADMIN (service role) client built from
// SUPABASE_SERVICE_ROLE_KEY, which safely bypasses RLS policies — RLS is a
// client-side auth boundary and the service role is the one role allowed to
// write through it from a trusted server.
//
// Contract (see src/lib/autoSave.ts saveViaWebsiteApi):
//   POST /api/website/save
//   headers: Authorization: Bearer <caller's Supabase access token>
//   body: { salonData: { ownerId, profile, services, stylists, loyaltyConfig } }
//          (a bare payload without the salonData wrapper is also accepted)
//   200  { success: true, timestamp }            — persisted
//   400  { success: false, error }               — subdomain / owner_id missing
//   401  { success: false, error: "Unauthorized" } — live mode: no/invalid access
//          token, or the token belongs to a different user than owner_id
//   500  { error: "Failed to persist site state" } — any persistence failure
//
// AUTH MODEL: the service role bypasses RLS, so RLS is NOT the authorization
// boundary for this endpoint — the endpoint IS. In live mode (service key
// configured) the caller must present their own Supabase access token; it is
// verified against the Supabase Auth server (GET /auth/v1/user with the
// service-role apikey) and must belong to the same user as owner_id. Without
// that check, any visitor could pass any owner_id and upsert that owner's
// rows. Mock mode (no env vars, local dev/demo) skips verification.
//
// The service-role key is read server-side only (supabaseClient.getSupabaseAdmin)
// and never shipped to the browser bundle.
// ============================================================================
import { isMockSupabase, getSupabaseAdmin, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../src/lib/supabaseClient";
import {
  toProfileRow,
  toServiceDbRow,
  toStylistDbRow,
  toLoyaltyConfigDbRow,
  toRewardDbRow,
  SALON_SYNC_TABLES,
} from "../src/lib/salonSync";
import { isUuid } from "../src/lib/autoSave";
import { SalonProfile, SalonService, Stylist, LoyaltyConfig, RewardThreshold } from "../src/types";
import {
  runDb,
  DEFAULT_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard';

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
        return res.status(500).json({ error: "Failed to persist site state" });
      }

      const profileRow = toProfileRow(profile, ownerId);
      const serviceRows = services.map((s, i) => toServiceDbRow(s, ownerId, i));
      const stylistRows = stylists.map((st, i) => toStylistDbRow(st, ownerId, i));
      const rewardRows = (loyaltyConfig?.rewards || []).map((r, i) =>
        toRewardDbRow(r as RewardThreshold, ownerId, i)
      );

      try {
        // Upsert order: the profiles row first (identity + subdomain), then
        // the tenant catalogue. Safe (non-destructive) on purpose: the
        // fallback path must never delete rows it cannot verify.
        const profileRes = await runDb(
          () => admin.from("profiles").upsert(profileRow, { onConflict: "id" }),
          { label: `website save profiles (${subdomain})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
        );
        if (profileRes.error) {
          throw Object.assign(new Error(`profiles upsert failed: ${profileRes.error.message}`), {
            table: "profiles",
            code: profileRes.error.code,
            details: profileRes.error.details,
            hint: profileRes.error.hint,
          });
        }

        if (serviceRows.length) {
          const r = await runDb(
            () => admin.from("services").upsert(serviceRows, { onConflict: "id" }),
            { label: `website save services (${subdomain})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
          );
          if (r.error) {
            throw Object.assign(new Error(`services upsert failed: ${r.error.message}`), {
              table: "services",
              code: r.error.code,
              details: r.error.details,
              hint: r.error.hint,
            });
          }
        }

        if (stylistRows.length) {
          const r = await runDb(
            () => admin.from("stylists").upsert(stylistRows, { onConflict: "id" }),
            { label: `website save stylists (${subdomain})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
          );
          if (r.error) {
            throw Object.assign(new Error(`stylists upsert failed: ${r.error.message}`), {
              table: "stylists",
              code: r.error.code,
              details: r.error.details,
              hint: r.error.hint,
            });
          }
        }

        if (loyaltyConfig) {
          const r = await runDb(
            () => admin
              .from("loyalty_config")
              .upsert(toLoyaltyConfigDbRow(loyaltyConfig, ownerId), { onConflict: "owner_id" }),
            { label: `website save loyalty config (${subdomain})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
          );
          if (r.error) {
            throw Object.assign(new Error(`loyalty_config upsert failed: ${r.error.message}`), {
              table: "loyalty_config",
              code: r.error.code,
              details: r.error.details,
              hint: r.error.hint,
            });
          }
        }

        if (rewardRows.length) {
          const r = await runDb(
            () => admin
              .from("loyalty_rewards")
              .upsert(rewardRows, { onConflict: "id" }),
            { label: `website save loyalty rewards (${subdomain})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
          );
          if (r.error) {
            throw Object.assign(new Error(`loyalty_rewards upsert failed: ${r.error.message}`), {
              table: "loyalty_rewards",
              code: r.error.code,
              details: r.error.details,
              hint: r.error.hint,
            });
          }
        }
      } catch (err) {
        const e = err as any;
        syncError(
          `POST /api/website/save upsert failed (subdomain="${subdomain}", owner_id="${ownerId}") — the site state was NOT persisted.`,
          {
            table: e?.table ?? "unknown",
            code: e?.code ?? null,
            details: e?.details ?? null,
            hint: e?.hint ?? null,
            message: e?.message ?? String(err),
            owner_id: ownerId,
          }
        );
        if (responseAlreadyEnded(res)) return;
        return res.status(500).json({ error: "Failed to persist site state" });
      }

      console.info(
        `[Website save] Persisted site state via Supabase service role — subdomain="${subdomain}", owner_id=${ownerId}, ` +
          `services=${serviceRows.length}, stylists=${stylistRows.length}, loyaltyRewards=${rewardRows.length}.`
      );
      return res.json({ success: true, timestamp: Date.now() });
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
