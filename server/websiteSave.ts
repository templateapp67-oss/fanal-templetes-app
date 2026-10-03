import { hasRequiredWebsiteProfile } from '../src/lib/websiteValidation.js';
import { prepareWebsiteStateForSave } from '../src/lib/websiteContentNormalize.js';
import { describeWebsiteSaveFailure, summarizeWebsiteIssues } from '../src/lib/websiteSaveErrors.js';
import {
  buildBookingSettingsPayload,
  type BookingSettingsSource,
} from '../src/lib/advanceDeposit.js';
import {
  BOOKING_SETTINGS_REJECTION_MESSAGE,
  isBookingSettingsRejection,
} from '../src/lib/bookingSettingsErrors.js';
import { BackendError, databaseForToken, verifyBackendUser, readDatabase } from './backendContext.js';
// Authenticated fallback for editor saves. Identity is verified against Supabase
// Auth, then the caller-scoped workspace RPC enforces ownership and commits
// contact, catalogue and editor state together.
import { isMockSupabase, getSupabaseAdmin } from "../src/lib/supabaseClient.js";
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
// JWT payloads are untrusted until Supabase Auth verifies their signature and
// revocation state. Never accept a decoded `sub` as authentication.
async function verifyCallerIsOwner(
  ownerId: string,
  authorizationHeader: string | undefined,
  _deadlineAt?: number
): Promise<string | null> {
  const token = (authorizationHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return 'missing access token';
  const admin = getSupabaseAdmin();
  if (!admin) return 'authentication service unavailable';
  try {
    const { data, error } = await runDb(() => admin.auth.getUser(token), { label: 'website save identity', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt: _deadlineAt, retry: false });
    if (error && ![400, 401, 403].includes(Number((error as any).status))) return 'authentication service unavailable';
    if (error || !data?.user) return 'access token rejected by Supabase Auth';
    if (data.user.id !== ownerId) return 'authenticated user does not own this request';
    return null;
  } catch {
    return 'authentication service unavailable';
  }
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
          tables: ['salons', 'services', 'staff', 'owner_editor_state'],
        });
        return res.status(400).json({ success: false, error: 'salonData.profile.subdomain is required.' });
      }
      if (!ownerId) {
        syncError(
          'POST /api/website/save rejected — missing essential field "owner_id" (profiles.id + owner_id foreign keys).',
          { tables: ['salons', 'services', 'staff', 'owner_editor_state'] }
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
          return res.status(authError === 'authentication service unavailable' ? 503 : 401).json({ success: false, error: authError === 'authentication service unavailable' ? 'Authentication is temporarily unavailable. Please retry.' : 'Unauthorized' });
        }
      }

      // A client-supplied nested identity or site ID cannot override the
      // authenticated owner. Do not store another tenant's ID in editor JSON.
      if (profile?.ownerId && profile.ownerId !== ownerId) {
        return res.status(403).json({ success: false, code: 'DATA_ACCESS_DENIED',
          error: 'This account cannot save the requested profile.' });
      }

      if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(subdomain)) return res.status(400).json({ success: false, code: 'INVALID_WEBSITE_ADDRESS', error: 'Use 2–63 letters, numbers or hyphens for the website address.' });

      // The owner must be authenticated before returning draft validation errors.
      // Repair what has an obvious repair first (padded links, empty gallery
      // slots → the default image, stale team assignments…) so the save does
      // not fail on something the editor could have fixed itself; whatever
      // remains is reported field by field.
      const prepared = prepareWebsiteStateForSave(salonData);
      if (prepared.errors.length) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_WEBSITE_CONTENT',
          error: summarizeWebsiteIssues(prepared.errors),
          issues: prepared.errors,
        });
      }
      const content: any = prepared.payload;
      const cleanProfile: SalonProfile | null = content.profile && typeof content.profile === 'object' ? content.profile : null;
      if (!hasRequiredWebsiteProfile(cleanProfile)) {
        return res.status(400).json({ success: false, code: 'PROFILE_INCOMPLETE',
          error: 'Add your salon name, contact number, business category, address and city before publishing.' });
      }

      // ------------------------------------------------------------------
      // Mock mode (local session / Supabase not configured): persist in the
      // in-memory registry so the demo flow — including the public site —
      // keeps working end to end.
      // ------------------------------------------------------------------
      if (isMockSupabase) {
        deps.mockSalons[subdomain] = {
          profile: { ...cleanProfile, subdomain, ownerId },
          services: Array.isArray(content.services) ? content.services : services,
          stylists: Array.isArray(content.stylists) ? content.stylists : stylists,
          loyaltyConfig,
          selectedTemplateId: salonData.selectedTemplateId,
          customDomain: profile?.customDomain || null,
        };
        console.info(
          `[Website save] (mock) persisted site state for subdomain "${subdomain}" (owner_id=${ownerId}) in the in-memory registry.`
        );
        return res.json({ success: true, timestamp: Date.now(), mode: "mock" });
      }

      // ------------------------------------------------------------------
      // Live mode verifies Auth through the server client, but writes ONLY
      // through the caller-scoped RPC; there is no RLS-bypass save fallback.
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

      // ------------------------------------------------------------------
      // Booking settings are DERIVED here, never copied from the request body.
      //
      // The route used to forward `salonData.bookingSettings` verbatim when the
      // client sent one, and to clamp its own copy to 0–100 — so a client (or a
      // stale browser bundle) could still post `deposit_percent: 20`, which
      // `salon_booking_settings_deposit_25_check` rejects with 23514 and which
      // then rolled back the profile, the catalogue and the template selection
      // committed in the same transaction.
      //
      // The advance is fixed at 25%; only the two owner switches (require a
      // deposit at all, accept online bookings) are taken from the caller, and
      // an explicit `false` is preserved rather than defaulted away.
      // ------------------------------------------------------------------
      const clientBookingSettings =
        salonData.bookingSettings && typeof salonData.bookingSettings === 'object'
          ? (salonData.bookingSettings as Record<string, unknown>)
          : null;
      const bookingSettings = buildBookingSettingsPayload(
        cleanProfile as unknown as BookingSettingsSource,
        clientBookingSettings as unknown as BookingSettingsSource
      );
      if (clientBookingSettings) {
        const requested = Number(
          clientBookingSettings.deposit_percent ??
            clientBookingSettings.deposit_percentage ??
            clientBookingSettings.deposit_25
        );
        if (Number.isFinite(requested) && requested !== bookingSettings.deposit_percentage) {
          // Safe diagnostic: the field and the rejected value only.
          console.warn(
            `[Website save] Ignored a booking-settings advance of ${requested}% — ` +
              `the advance payment is fixed at ${bookingSettings.deposit_percentage}%.`
          );
        }
      }
      const extraState = {
        ...(Array.isArray(salonData.appointments) ? { appointments: salonData.appointments } : {}),
        ...(Array.isArray(salonData.clients) ? { clients: salonData.clients } : {}),
        ...(salonData.selectedTemplateId !== undefined ? { selectedTemplateId: salonData.selectedTemplateId } : {}),
        bookingSettings,
      };
      // Use the same transaction as the editor. Never write salon fields into identity profiles.
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const savedState = {
        profile: {
          ...cleanProfile,
          depositPercentage: bookingSettings.deposit_percentage,
          deposit_25: bookingSettings.deposit_25,
        },
        ...(salonData.services !== undefined ? { services: content.services } : {}),
        ...(salonData.stylists !== undefined ? { stylists: content.stylists } : {}),
        ...extraState,
        ...(loyaltyConfig ? { loyaltyConfig } : {}),
      };
      let result = await runDb(() => databaseForToken(token).rpc('save_owner_editor_state', {
        p_state: savedState,
      }), { label: 'atomic owner workspace save', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });

      if (
        result.error &&
        (
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
            p_state: savedState,
          }), { label: 'atomic owner workspace save (retry)', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });
        } catch (provisionErr) {
          console.warn('[Website save] ensure_owner_workspace retry skipped or failed:', provisionErr);
        }
      }

      if (result.error) {
        syncError('Owner workspace transaction failed; refusing service-role fallback', {
          code: result.error.code ?? null,
          message: result.error.message ?? null,
        });
        if (responseAlreadyEnded(res)) return;
        const code = result.error.code;
        const detail = String(result.error.message ?? '');
        // 23514 on salon_booking_settings is NOT a "contact support" failure: it
        // is the advance-payment check, it is deterministic, and it used to
        // answer 503 WEBSITE_SAVE_FAILED with the raw constraint name in
        // `details`. Name it so the editor can tell the owner the one thing
        // that has to change.
        const bookingSettingsRejected = isBookingSettingsRejection(detail);
        const isContentRejection = code === '22023' || code === '22P02' || bookingSettingsRejected;
        return res.status(
          code === '42501' ? 403 : code === '23505' ? 409 : isContentRejection ? 400 : 503
        ).json({
          success: false,
          code: code === '42501' ? 'DATA_ACCESS_DENIED'
            : code === '23505' ? 'WEBSITE_ADDRESS_CONFLICT'
            : bookingSettingsRejected ? 'BOOKING_SETTINGS_INVALID'
            : code === '22023' || code === '22P02' ? 'INVALID_WEBSITE_CONTENT'
            : 'WEBSITE_SAVE_FAILED',
          dbCode: code ?? null,
          details: result.error.message ?? undefined,
          ...(isContentRejection
            ? { issues: describeWebsiteSaveFailure(detail, savedState) }
            : {}),
          error: code === '23505'
            ? 'That website address is already in use. Choose another address.'
            : bookingSettingsRejected
              ? BOOKING_SETTINGS_REJECTION_MESSAGE
              : code === '22023' || code === '22P02'
                ? (result.error.message || 'Check your website content, service details and staff schedule before saving.')
                : 'Your workspace could not be saved. Please retry or contact support.',
        });
      }
      if (responseAlreadyEnded(res)) return;
      // The snapshot and public catalogue committed in the same transaction.
      return res.json({
        success: true,
        timestamp: Date.now(),
        mode: 'live',
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
          const stateRes = await runDb(() => admin.from('owner_editor_state').select('state').eq('owner_id', user.id).maybeSingle(), { label: 'owner state restore', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt: res.locals?.requestDeadlineAt, retry: false });
          if (stateRes.error) {
            console.warn('[Website save] owner_editor_state table read failed:', {
              code: stateRes.error.code ?? null,
              message: String(stateRes.error.message ?? '').slice(0, 200),
            });
            throw new BackendError(503, 'Your saved workspace could not be loaded. Please retry.', 'workspace_load_failed');
          }
          if (stateRes.data?.state) {
            data = stateRes.data.state;
          }
        } catch (err: any) {
          console.warn('[Website save] owner_editor_state table read threw:', {
            code: err?.code ?? null,
            message: String(err?.message ?? err).slice(0, 200),
          });
          throw new BackendError(503, 'Your saved workspace could not be loaded. Please retry.', 'workspace_load_failed');
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
