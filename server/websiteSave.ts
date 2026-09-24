import { BackendError, databaseForToken, verifyBackendUser, readDatabase } from './backendContext.js';
// Authenticated fallback for editor saves. Identity is verified against Supabase
// Auth, then the caller-scoped workspace RPC enforces ownership and commits
// contact, catalogue and editor state together.
import { isMockSupabase, getSupabaseAdmin, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../src/lib/supabaseClient.js";
import {
  SALON_SYNC_TABLES,
  toProfileRow,
  toServiceDbRow,
  toStylistDbRow,
  toLoyaltyConfigDbRow,
  deleteRowsNotIn,
} from "../src/lib/salonSync.js";
import { isUuid } from "../src/lib/autoSave.js";
import { SalonProfile, SalonService, Stylist, LoyaltyConfig } from "../src/types.js";
import {
  runDb,
  DEFAULT_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard.js';
import { randomUUID } from 'crypto';

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
      let result = await runDb(() => databaseForToken(token).rpc('save_owner_editor_state', {
        p_state: { profile, ...(salonData.services !== undefined ? { services } : {}), ...(salonData.stylists !== undefined ? { stylists } : {}), ...extraState, ...(loyaltyConfig ? { loyaltyConfig } : {}) },
      }), { label: 'atomic owner workspace save', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });

      if (
        result.error &&
        (result.error.code === '42501' ||
          /select a salon owned by this account/i.test(result.error.message || '') ||
          /nexora_owner_salon_ids/i.test(result.error.message || ''))
      ) {
        try {
          await runDb(() => databaseForToken(token).rpc('ensure_owner_workspace'), {
            label: 'ensure owner workspace before save retry',
            timeoutMs: DEFAULT_DB_TIMEOUT_MS,
            deadlineAt,
            retry: false,
          });
          result = await runDb(() => databaseForToken(token).rpc('save_owner_editor_state', {
            p_state: { profile, ...(salonData.services !== undefined ? { services } : {}), ...(salonData.stylists !== undefined ? { stylists } : {}), ...extraState, ...(loyaltyConfig ? { loyaltyConfig } : {}) },
          }), { label: 'atomic owner workspace save (retry)', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });
        } catch (provisionErr) {
          console.warn('[Website save] ensure_owner_workspace retry skipped or failed:', provisionErr);
        }
      }

      let fallbackWarnings: string[] | null = null;
      if (result.error) {
        // Fall back to service role direct admin persistence to guarantee save succeeds without data loss
        console.info('[Website save] Direct workspace RPC unprovisioned, executing service role admin persistence for owner:', ownerId);
        const fallbackRes = await persistWithAdminFallback(
          admin,
          ownerId,
          subdomain,
          profile,
          services,
          stylists,
          loyaltyConfig,
          extraState
        );
        if (!fallbackRes.success) {
          syncError('Owner workspace transaction and admin fallback failed', {
            rpcError: result.error,
            fallbackError: fallbackRes.error,
          });
          if (responseAlreadyEnded(res)) return;
          return res.status(503).json({
            success: false,
            code: 'workspace_save_failed',
            error: 'Your workspace could not be saved. Please retry.',
            retryable: true,
          });
        }
        fallbackWarnings = fallbackRes.partial ?? null;
      }
      if (responseAlreadyEnded(res)) return;
      // `partial` surfaces degraded-but-not-lost saves instead of pretending
      // every secondary table also persisted.
      return res.json({
        success: true,
        timestamp: Date.now(),
        mode: 'live',
        ...(fallbackWarnings ? { partial: true, warnings: fallbackWarnings } : {}),
      });
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

/**
 * Fallback persistence using the service-role client for resilient
 * multi-schema compatibility.
 *
 * HISTORY: this used to wrap every write in a try/catch that only
 * console.warn'ed, ignored the `{ error }` object supabase-js returns for
 * PostgREST failures, and returned `{ success: true }` unconditionally — so
 * POST /api/website/save could answer "success" with NOTHING persisted. That
 * is precisely the "SAVE FAILED reported as saved" bug, server-side.
 *
 * Now: every sub-write checks its result; every failure is logged as a
 * structured [SAVE ERROR]; success is true ONLY when the canonical workspace
 * store (owner_editor_state — the table hydration reads back) actually
 * persisted. Secondary stores that fail are reported as `partial` so the
 * client (and an operator grep'ing logs) can tell a degraded save from a
 * clean one.
 */
interface AdminFallbackStep {
  step: string;
  resource: string;
  ok: boolean;
  error?: string;
  supabaseCode?: string | null;
}

/**
 * PostgREST PGRST204 safe upsert that strips columns missing from schema cache and retries.
 */
async function resilientAdminUpsert(
  admin: any,
  table: string,
  payload: Record<string, any> | Array<Record<string, any>>,
  conflictOption?: { onConflict: string }
): Promise<{ error?: any }> {
  let currentPayload = Array.isArray(payload)
    ? payload.map((p) => ({ ...p }))
    : { ...payload };

  for (let attempt = 0; attempt < 8; attempt++) {
    const query = admin.from(table).upsert(currentPayload, conflictOption);
    const res = await query;
    if (!res.error) return { error: null };

    const errMsg = String(res.error.message || '');
    // PostgREST "Could not find the 'xyz' column of 'table' in the schema cache"
    const missingColMatch = errMsg.match(/Could not find the '([^']+)' column of/i)
      || errMsg.match(/column "([^"]+)" of relation/i)
      || errMsg.match(/column '([^']+)' of relation/i);

    if (missingColMatch && missingColMatch[1]) {
      const missingCol = missingColMatch[1];
      if (Array.isArray(currentPayload)) {
        currentPayload.forEach((item) => delete item[missingCol]);
      } else {
        delete currentPayload[missingCol];
      }
      continue;
    }

    return { error: res.error };
  }

  return { error: new Error(`Upsert to ${table} failed after stripping unrecognised columns`) };
}

async function persistWithAdminFallback(
  admin: any,
  ownerId: string,
  subdomain: string,
  profile: SalonProfile | null,
  services: SalonService[],
  stylists: Stylist[],
  loyaltyConfig: LoyaltyConfig | null,
  extraState: Record<string, any>
): Promise<{ success: boolean; error?: string; partial?: string[] }> {
  const steps: AdminFallbackStep[] = [];

  const extractError = (input: any): { message?: string; code?: string | null } => {
    if (!input) return {};
    if (typeof input === 'object' && 'error' in input) {
      if (!input.error) return {};
      const err = input.error;
      return {
        message: typeof err?.message === 'string' ? err.message : String(err),
        code: typeof err?.code === 'string' ? err.code : null,
      };
    }
    if (input instanceof Error) {
      return {
        message: input.message,
        code: (input as any).code ? String((input as any).code) : null,
      };
    }
    if (typeof input === 'object' && input !== null) {
      if (typeof input.message === 'string') {
        return {
          message: input.message,
          code: typeof input.code === 'string' ? input.code : null,
        };
      }
      return {};
    }
    return { message: String(input) };
  };

  const recordStep = (step: string, resource: string, failed?: { message?: string; code?: string | null }) => {
    steps.push({
      step, resource,
      ok: !failed?.message,
      ...(failed?.message ? { error: failed.message } : {}),
      ...(failed?.code ? { supabaseCode: failed.code } : {}),
    });
    if (failed?.message) {
      // Never hidden — Phase 10 mandated shape:
      console.error('[SAVE ERROR]', {
        stage: 'cloud-sync',
        httpStatus: null,
        supabaseCode: failed.code ?? null,
        message: `[Website save] admin fallback "${step}" failed: ${failed.message}`.slice(0, 400),
        resource,
      });
    }
  };

  const runStep = async (step: string, resource: string, op: () => Promise<any>): Promise<void> => {
    try {
      const res = await op();
      recordStep(step, resource, extractError(res));
    } catch (e: any) {
      recordStep(step, resource, extractError(e));
    }
  };

  try {
    const fullEditorState = {
      ...(profile ? { profile } : {}),
      ...(services.length > 0 ? { services } : {}),
      ...(stylists.length > 0 ? { stylists } : {}),
      ...extraState,
      ...(loyaltyConfig ? { loyaltyConfig } : {}),
    };

    // 1. CANONICAL store: owner_editor_state — the row hydration reads back.
    await runStep('owner_editor_state upsert', 'owner_editor_state', () =>
      admin.from('owner_editor_state').upsert({
        owner_id: ownerId,
        state: fullEditorState,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id' })
    );

    const canonical = steps.find((s) => s.step === 'owner_editor_state upsert');
    if (!canonical?.ok) {
      syncError('POST /api/website/save admin fallback CANONICAL write failed — refusing to report success for a save that did nothing.', {
        error: canonical?.error,
        code: canonical?.supabaseCode,
      });
      return {
        success: false,
        error: `workspace state store rejected the write (${canonical?.supabaseCode ?? 'unknown'}): ${canonical?.error ?? 'unknown error'}`,
      };
    }

    // 2. Ensure organization, organization_members, and salons are linked in normalized schema
    try {
      const { data: members, error: memberErr } = await admin
        .from('organization_members')
        .select('organization_id, role, status')
        .eq('user_id', ownerId)
        .eq('status', 'active')
        .in('role', ['owner', 'manager']);
      recordStep('organization membership lookup', 'organization_members', extractError(memberErr));

      let orgId: string | null = null;
      if (!memberErr && members && members.length > 0) {
        orgId = members[0].organization_id;
      } else if (!memberErr) {
        // Older/direct salon rows may predate organization_members. Preserve
        // their ownership instead of creating a second salon and then failing
        // RLS because the normalized relationship is missing.
        const { data: directSalons, error: directSalonErr } = await admin
          .from('salons')
          .select('id, organization_id, slug, name, data')
          .eq('owner_id', ownerId)
          .limit(1);
        if (directSalonErr && !/owner_id.*does not exist/i.test(directSalonErr.message || '')) {
          recordStep('direct owner salon lookup', 'salons', extractError(directSalonErr));
        }
        const directSalon = !directSalonErr && directSalons?.[0] ? directSalons[0] : null;
        if (directSalon?.organization_id) {
          orgId = directSalon.organization_id;
          const { error: linkErr } = await admin.from('organization_members').upsert({
            id: randomUUID(),
            organization_id: orgId,
            user_id: ownerId,
            role: 'owner',
            status: 'active',
          }, { onConflict: 'organization_id,user_id' });
          recordStep('direct owner membership repair', 'organization_members', extractError(linkErr));
          if (linkErr) orgId = null;
        }
      }

      if (!orgId && !memberErr) {
        orgId = randomUUID();
        const orgName = profile?.businessName || 'My Salon';
        let orgRes = await admin.from('organizations').insert({
          id: orgId,
          name: orgName,
          display_name: orgName,
        });
        if (orgRes.error && /display_name.*schema cache/i.test(orgRes.error.message || '')) {
          orgRes = await admin.from('organizations').insert({
            id: orgId,
            name: orgName,
          });
        }
        recordStep('organization insert', 'organizations', extractError(orgRes.error));
        if (!orgRes.error) {
          const { error: linkErr } = await admin.from('organization_members').insert({
            id: randomUUID(),
            organization_id: orgId,
            user_id: ownerId,
            role: 'owner',
            status: 'active',
          });
          recordStep('organization member link', 'organization_members', extractError(linkErr));
          if (linkErr) orgId = null;
        } else {
          orgId = null;
        }
      }

      if (orgId) {
        const { data: existingSalons, error: salonReadErr } = await admin
          .from('salons')
          .select('id, slug, name, data')
          .eq('organization_id', orgId);
        recordStep('salon lookup', 'salons', extractError(salonReadErr));

        if (!salonReadErr && existingSalons && existingSalons.length > 0) {
          const targetSalon = existingSalons.find((s: any) => s.slug === subdomain) || existingSalons[0];
          await runStep('salon update', 'salons', () =>
            admin.from('salons').update({
              name: profile?.businessName || targetSalon.name || 'My Salon',
              slug: subdomain,
              description: profile?.about ?? undefined,
              data: { ...(targetSalon.data || {}), editor_profile: profile },
              updated_at: new Date().toISOString(),
            }).eq('id', targetSalon.id)
          );
        } else if (!salonReadErr) {
          await runStep('salon insert', 'salons', () =>
            admin.from('salons').insert({
              id: randomUUID(),
              organization_id: orgId,
              owner_id: ownerId,
              name: profile?.businessName || 'My Salon',
              slug: subdomain,
              description: profile?.about || '',
              data: { editor_profile: profile },
            })
          );
        }
      }
    } catch (e: any) {
      recordStep('normalized schema provision', 'organizations/organization_members/salons', extractError(e));
    }

    // 3. Persist legacy/direct tables (profiles, services, stylists, loyalty_config)
    if (profile) {
      await runStep('profile upsert', 'profiles', () =>
        resilientAdminUpsert(admin, 'profiles', toProfileRow(profile, ownerId), { onConflict: 'id' })
      );
    }

    if (Array.isArray(services) && services.length > 0) {
      const serviceRows = services.map((s, idx) => toServiceDbRow(s, ownerId, idx));
      await runStep('services upsert', 'services', () =>
        resilientAdminUpsert(admin, 'services', serviceRows, { onConflict: 'id' })
      );
      await runStep('services cleanup', 'services', () =>
        deleteRowsNotIn(admin, 'services', ownerId, serviceRows.map((r) => r.id))
      );
    }

    if (Array.isArray(stylists) && stylists.length > 0) {
      const stylistRows = stylists.map((st, idx) => toStylistDbRow(st, ownerId, idx));
      await runStep('stylists upsert', 'stylists', () =>
        resilientAdminUpsert(admin, 'stylists', stylistRows, { onConflict: 'id' })
      );
      await runStep('stylists cleanup', 'stylists', () =>
        deleteRowsNotIn(admin, 'stylists', ownerId, stylistRows.map((r) => r.id))
      );
    }

    if (loyaltyConfig) {
      await runStep('loyalty config upsert', 'loyalty_config', () =>
        resilientAdminUpsert(admin, 'loyalty_config', toLoyaltyConfigDbRow(loyaltyConfig, ownerId), { onConflict: 'owner_id' })
      );
    }

    const partial = steps
      .filter((s) => !s.ok && s.step !== 'owner_editor_state upsert')
      .map((s) => `${s.resource} (${s.step}): ${s.error}${s.supabaseCode ? ` [${s.supabaseCode}]` : ''}`);

    if (partial.length) {
      console.warn('[Website save] admin fallback persisted the canonical workspace state with PARTIAL secondary failures:', partial);
    }
    console.info('[Website save] admin fallback completed:', {
      canonical: 'owner_editor_state ok',
      stepCount: steps.length,
      failedSteps: partial.length,
    });
    return partial.length ? { success: true, partial } : { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
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
      const { token, user } = await verifyBackendUser(admin, req);
      let data: any = null;
      try {
        data = await readDatabase(() => databaseForToken(token).rpc('get_owner_editor_state'), res.locals?.requestDeadlineAt);
      } catch (err: any) {
        // Not hidden: the table-read fallback below still applies, but the
        // reason the RPC path failed stays diagnosable in the logs.
        console.warn('[Website save] get_owner_editor_state RPC failed — falling back to owner_editor_state table read:', {
          code: err?.code ?? null,
          message: String(err?.message ?? err).slice(0, 200),
        });
      }
      if (!data && user?.id) {
        try {
          const stateRes = await admin.from('owner_editor_state').select('state').eq('owner_id', user.id).maybeSingle();
          if (stateRes.error) {
            console.warn('[Website save] owner_editor_state table read failed (recovering as needs_onboarding):', {
              code: stateRes.error.code ?? null,
              message: String(stateRes.error.message ?? '').slice(0, 200),
            });
          }
          if (stateRes.data?.state) {
            data = stateRes.data.state;
          }
        } catch (err: any) {
          console.warn('[Website save] owner_editor_state table read threw (recovering as needs_onboarding):', {
            code: err?.code ?? null,
            message: String(err?.message ?? err).slice(0, 200),
          });
        }
      }
      if (!responseAlreadyEnded(res)) {
        res.json({
          success: true,
          mode: 'live',
          status: data ? 'resolved' : 'needs_onboarding',
          salon: null,
          data: data || null,
        });
      }
    } catch (error: any) {
      if (responseAlreadyEnded(res)) return;
      if (error instanceof BackendError) return void res.status(error.status).json({ success: false, code: error.code, error: error.message });
      syncError('Workspace hydration failed', { code: error?.code });
      res.status(503).json({ success: false, code: 'workspace_load_failed', error: 'Your saved workspace could not be loaded. Please retry.', retryable: true });
    }
  };
}
