// ============================================================================
// Frontend → Supabase sync mappers.
//
// THE BUG THIS MODULE FIXES:
//   The DB schema (supabase/migrations/00001_init.sql) uses snake_case columns
//   with `uuid` primary keys, but the app state uses camelCase fields with
//   friendly string ids (`hs-1`, `hs-st-uma`, `rew-1`, `srv-1693…`). The old
//   save code upserted app objects almost as-is, so Postgres rejected every
//   save with "invalid input syntax for type uuid" and the profiles upsert
//   silently dropped fields (timings, subdomain, tagline, about, whatsapp,
//   city, theme…), which is why edits looked like they were never auto-saved.
//
// Everything written to Supabase now goes through these mappers so the request
// payload always matches the backend schema exactly.
//
// RESILIENCE (Nexora saving-error repair):
//   • Every table write (profiles, services, stylists, loyalty_*, plus the
//     optional team_members / photo_gallery / salon_branches collections) is
//     wrapped in per-table error handling with `[Nexora Sync Error]` logging.
//   • Unauthenticated / mock / no-session callers never crash and never see a
//     blocking error: the draft is cached under NEXORA_DRAFT_KEY and the
//     result reports SUCCESS (Local Draft).
//   • Auth/RLS/network-only failures also resolve to SUCCESS (Local Draft)
//     (the auto-save chain still tries POST /api/website/save first via
//     persistSalonWithFallbacks). Deterministic failures (duplicate subdomain,
//     uuid mismatch, missing schema) keep ok:false so the exact remedy stays
//     visible — with the draft cached as a backup so no progress is lost.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { SalonProfile, SalonService, Stylist, LoyaltyConfig, RewardThreshold } from '../types';
import {
  toDbId,
  withRetry,
  describeError,
  safeWriteLocalStorage,
  NEXORA_DRAFT_KEY,
  isSilentLocalDraftFailure,
} from './autoSave';

/** Namespaces keep the same logical id from colliding across tables. */
export const SERVICE_ID_NAMESPACE = 'nexora-service';
export const STYLIST_ID_NAMESPACE = 'nexora-stylist';
export const REWARD_ID_NAMESPACE = 'nexora-reward';
export const TEAM_MEMBER_ID_NAMESPACE = 'nexora-team-member';
export const PHOTO_ID_NAMESPACE = 'nexora-photo';
export const BRANCH_ID_NAMESPACE = 'nexora-branch';

/** Re-exported so callers share one draft-key constant. */
export { NEXORA_DRAFT_KEY };

/** Shape of the `profiles.working_hours` jsonb column. */
export interface WorkingHoursJson {
  monFri: string;
  saturday: string;
  sunday: string;
}

export function buildWorkingHours(profile: SalonProfile): WorkingHoursJson {
  return {
    monFri: profile.workingHoursMonFri || '',
    saturday: profile.workingHoursSat || '',
    sunday: profile.workingHoursSun || '',
  };
}

/** Map a working_hours jsonb column back into the app's profile fields. */
export function applyWorkingHoursFromRow(
  profile: SalonProfile,
  row: { working_hours?: WorkingHoursJson | null } | null | undefined
): SalonProfile {
  const wh = row?.working_hours;
  if (!wh) return profile;
  return {
    ...profile,
    workingHoursMonFri: wh.monFri ?? profile.workingHoursMonFri,
    workingHoursSat: wh.saturday ?? profile.workingHoursSat,
    workingHoursSun: wh.sunday ?? profile.workingHoursSun,
  };
}

/**
 * Full `profiles` row. Every column the editor forms touch is included so
 * Salon Details, Contact, Timings, Sub-domain and theme changes actually
 * reach the database.
 */
export function toProfileRow(profile: SalonProfile, ownerId: string) {
  return {
    id: ownerId,
    business_type: profile.businessType,
    full_name: profile.ownerName,
    salon_name: profile.businessName,
    email: profile.email,
    phone_number: profile.phone,
    whatsapp: profile.whatsapp,
    owner_role: profile.ownerRole,
    owner_photo_url: profile.ownerPhotoUrl,
    cover_image_url: profile.coverImageUrl,
    logo_url: profile.logoUrl ?? null,
    tagline: profile.tagline,
    about: profile.about,
    currency: profile.currency,
    subdomain: profile.subdomain,
    custom_domain: profile.customDomain ?? null,
    full_address: profile.address,
    city: profile.city,
    postal_code: profile.postalCode,
    state: profile.state ?? null,
    landmark: profile.landmark ?? null,
    latitude: profile.latitude ?? null,
    longitude: profile.longitude ?? null,
    founding_year: profile.foundingYear ?? null,
    instagram_handle: profile.instagramHandle,
    facebook_page: profile.facebookPage ?? null,
    youtube_channel: profile.youtubeChannel ?? null,
    tiktok_profile: profile.tiktokProfile ?? null,
    google_business_url: profile.googleBusinessUrl ?? null,
    theme_preset: profile.themePreset,
    theme_accent_key: profile.themeAccentKey ?? null,
    custom_accent_color: profile.customAccentColor ?? null,
    require_deposit: profile.requireDeposit,
    deposit_percentage: profile.depositPercentage,
    // Home-service toggle/charge/radius (edited in Side Panel Customizer) —
    // previously stored only in localStorage, so it silently reset after a
    // reload and never reached the public site served from the database.
    home_service: profile.homeService ?? null,
    working_hours: buildWorkingHours(profile),
    updated_at: new Date().toISOString(),
  };
}

/** `services` row with a UUID-safe id and a stable sort order. */
export function toServiceDbRow(s: SalonService, ownerId: string, index: number) {
  return {
    id: toDbId(s.id, SERVICE_ID_NAMESPACE),
    owner_id: ownerId,
    name: s.name,
    category: s.category || 'General',
    description: s.description,
    icon: s.icon || 'sparkles',
    price: s.price,
    duration_minutes: s.durationMinutes,
    popular: s.popular ?? false,
    show_duration: s.showDuration ?? true,
    sort_order: index,
  };
}

/** `stylists` row with a UUID-safe id and a stable sort order. */
export function toStylistDbRow(st: Stylist, ownerId: string, index: number) {
  return {
    id: toDbId(st.id, STYLIST_ID_NAMESPACE),
    owner_id: ownerId,
    name: st.name,
    role: st.role,
    avatar_url: st.avatarUrl,
    bio: st.bio ?? null,
    phone: st.phone ?? null,
    specialties: st.specialties || [],
    assigned_services: st.assignedServices || [],
    rating: st.rating,
    commission_rate: st.commissionRate ?? 0,
    status: st.status ?? 'Available',
    access_role: st.accessRole ?? 'Service Provider (Assigned)',
    hide_phone: st.hidePhone ?? false,
    schedule: st.schedule || [],
    sort_order: index,
  };
}

/** `loyalty_config` row (owner_id is the primary key). */
export function toLoyaltyConfigDbRow(config: LoyaltyConfig, ownerId: string) {
  return {
    owner_id: ownerId,
    program_enabled: config.programEnabled,
    points_per_visit: config.pointsPerVisit,
    points_per_hundred_spent: config.pointsPerHundredSpent,
    tier_thresholds: config.tierThresholds,
    tier_multipliers: config.tierMultipliers,
  };
}

/** `loyalty_rewards` row with a UUID-safe id and a stable sort order. */
export function toRewardDbRow(r: RewardThreshold, ownerId: string, index: number) {
  return {
    id: toDbId(r.id, REWARD_ID_NAMESPACE),
    owner_id: ownerId,
    title: r.title,
    required_points: r.requiredPoints,
    reward_type: r.rewardType,
    discount_value: r.discountValue,
    applicable_category: r.applicableCategory ?? null,
    description: r.description,
    is_active: r.isActive ?? true,
    coupon_code_prefix: r.couponCodePrefix ?? null,
    sort_order: index,
  };
}

/** Best-effort `team_members` row (optional table — missing-table is non-fatal). */
export function toTeamMemberDbRow(member: any, ownerId: string, index: number) {
  const rawId = typeof member?.id === 'string' && member.id ? member.id : `team-${index}`;
  return {
    id: toDbId(rawId, TEAM_MEMBER_ID_NAMESPACE),
    owner_id: ownerId,
    name: member?.name ?? 'Team member',
    role: member?.role ?? null,
    avatar_url: member?.avatarUrl ?? member?.avatar_url ?? null,
    bio: member?.bio ?? null,
    phone: member?.phone ?? null,
    specialties: member?.specialties ?? [],
    sort_order: index,
  };
}

/** Best-effort `photo_gallery` row (optional table — missing-table is non-fatal). */
export function toPhotoGalleryDbRow(photo: any, ownerId: string, index: number) {
  const rawId = typeof photo?.id === 'string' && photo.id ? photo.id : `photo-${index}`;
  return {
    id: toDbId(rawId, PHOTO_ID_NAMESPACE),
    owner_id: ownerId,
    image_url: photo?.imageUrl ?? photo?.image_url ?? photo?.url ?? '',
    caption: photo?.caption ?? null,
    sort_order: index,
  };
}

/** Best-effort `salon_branches` row (optional table — missing-table is non-fatal). */
export function toBranchDbRow(branch: any, ownerId: string, index: number) {
  const rawId = typeof branch?.id === 'string' && branch.id ? branch.id : `branch-${index}`;
  return {
    id: toDbId(rawId, BRANCH_ID_NAMESPACE),
    owner_id: ownerId,
    name: branch?.name ?? `Branch ${index + 1}`,
    address: branch?.address ?? branch?.full_address ?? null,
    city: branch?.city ?? null,
    phone: branch?.phone ?? null,
    sort_order: index,
  };
}

// ---------------------------------------------------------------------------
// Diagnostics + local-draft fallback.
// ---------------------------------------------------------------------------

/**
 * Log one table failure with the table name, HTTP status, error code and the
 * exact message. Returns the `label: message` string collected into `errors`.
 */
function logTableSyncError(table: string, label: string, err: unknown): string {
  const e = (err && typeof err === 'object' ? (err as Record<string, any>) : {}) as Record<
    string,
    any
  >;
  const message = describeError(err);
  const status = e.status ?? e.statusCode ?? 'unknown';
  const code = e.code ?? 'unknown';
  console.error('[Nexora Sync Error]:', `table=${table} operation=${label} status=${status} code=${code} message=${message}`, err);
  return `${label}: ${message}`;
}

function isMissingTableMessage(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('does not exist') || m.includes('42p01') || m.includes('undefined table');
}

export interface LocalDraftWriteOutcome {
  ok: boolean;
  degraded?: boolean;
  error?: string;
}

/**
 * Cache the full salon payload under NEXORA_DRAFT_KEY. Never throws — a quota
 * failure is reported in the return value so the caller can decide whether
 * even the offline backup failed.
 */
export function saveSalonDraftToLocalStorage(payload: SalonSyncPayload): LocalDraftWriteOutcome {
  try {
    const snapshot = {
      ownerId: payload.ownerId ?? null,
      subdomain: (payload.profile as SalonProfile | undefined)?.subdomain,
      profile: payload.profile,
      services: payload.services,
      stylists: payload.stylists,
      loyaltyConfig: payload.loyaltyConfig,
      selectedTemplateId: (payload as { selectedTemplateId?: unknown }).selectedTemplateId,
      extras: {
        teamMembers: (payload as { teamMembers?: unknown }).teamMembers,
        photoGallery: (payload as { photoGallery?: unknown }).photoGallery,
        branches: (payload as { branches?: unknown }).branches,
      },
      savedAt: Date.now(),
      source: 'direct-sync-fallback',
    };
    return safeWriteLocalStorage(NEXORA_DRAFT_KEY, JSON.stringify(snapshot));
  } catch (err) {
    const message = describeError(err);
    console.error('[Nexora Sync Error]:', `table=localStorage operation=saveSalonDraft status=unknown code=LOCAL_WRITE_FAILED message=${message}`, err);
    return { ok: false, error: message };
  }
}

function clearSalonDraftBestEffort(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(NEXORA_DRAFT_KEY);
  } catch (err) {
    console.error('[Nexora Sync Error]:', 'table=localStorage operation=clearSalonDraft message=failed to clear cached draft', err);
  }
}

/**
 * Detect an unauthenticated / mock caller before touching the database:
 * missing owner id, or a Supabase client whose session lookup reports no
 * active session. Mock clients used in tests expose no `auth` at all — they
 * skip the session probe and proceed to the table writes.
 */
async function detectUnauthenticatedSession(
  db: SupabaseClient,
  ownerId: string
): Promise<{ unauthenticated: boolean; reason: string | null }> {
  if (!ownerId || typeof ownerId !== 'string' || ownerId.trim() === '') {
    return { unauthenticated: true, reason: 'missing owner id (unauthenticated or mock session)' };
  }
  try {
    const auth = (db as any)?.auth;
    if (!auth || typeof auth.getSession !== 'function') {
      return { unauthenticated: false, reason: null };
    }
    const { data, error } = await auth.getSession();
    if (error) {
      console.error('[Nexora Sync Error]:', `table=auth operation=getSession status=${(error as any)?.status ?? 'unknown'} code=${(error as any)?.code ?? 'unknown'} message=${describeError(error)}`, error);
      // A failing session lookup (e.g. offline) must not block the save —
      // proceed to the table writes; their errors are handled per table.
      return { unauthenticated: false, reason: null };
    }
    if (!data?.session?.user) {
      return { unauthenticated: true, reason: 'no active Supabase session — sign in again' };
    }
    return { unauthenticated: false, reason: null };
  } catch (err) {
    console.error('[Nexora Sync Error]:', `table=auth operation=getSession status=unknown code=SESSION_PROBE_FAILED message=${describeError(err)}`, err);
    return { unauthenticated: false, reason: null };
  }
}

/**
 * Delete a table's rows for this owner that are NOT in `keepIds` — i.e. the
 * services/stylists/rewards the owner removed in the editor. Without this,
 * deleted rows kept coming back on the next hydrate.
 */
export async function deleteRowsNotIn(
  db: SupabaseClient,
  table: string,
  ownerId: string,
  keepIds: string[]
): Promise<{ error: unknown }> {
  try {
    let query = (db.from(table) as any).delete().eq('owner_id', ownerId);
    if (keepIds.length > 0) {
      // PostgREST "not in" filter: id=not.in.(uuid1,uuid2,…)
      query = query.not('id', 'in', `(${keepIds.join(',')})`);
    }
    const { error } = await query;
    if (error) {
      logTableSyncError(table, `remove deleted rows`, error);
    }
    return { error: error ?? null };
  } catch (err) {
    logTableSyncError(table, `remove deleted rows`, err);
    return { error: err };
  }
}

export interface SalonSyncPayload {
  ownerId: string;
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
  loyaltyConfig: LoyaltyConfig;
  /** Optional extended collections (missing tables are skipped, never fatal). */
  teamMembers?: any[];
  photoGallery?: any[];
  branches?: any[];
  selectedTemplateId?: unknown;
}

export type SalonPersistedVia = 'cloud' | 'local-draft' | 'none';

export interface SalonSyncResult {
  ok: boolean;
  /** Exact per-operation error messages (empty when ok). */
  errors: string[];
  /** Where the payload landed: cloud, offline draft, or nowhere. */
  persisted?: SalonPersistedVia;
  /** True when the result is SUCCESS (Local Draft) rather than a cloud save. */
  localDraft?: boolean;
  /** True when a draft backup was written alongside this result. */
  draftSaved?: boolean;
  /** Human-readable outcome for logs/toasts. */
  message?: string;
}

/**
 * Push the full salon state to Supabase.
 *
 * Every operation is wrapped in `withRetry` (network failures retry with
 * backoff and the exact error is logged), failures are collected per table —
 * never swallowed — and stale rows are deleted when `deleteRemoved` is set
 * (the caller only enables that after a successful hydrate so a half-loaded
 * client can never wipe rows it hasn't seen yet).
 *
 * Unauthenticated / mock callers fall back to a localStorage draft and report
 * SUCCESS (Local Draft) instead of a blocking error. Auth/RLS/network-only
 * failures do the same; deterministic failures keep ok:false (with a draft
 * backup) so the exact remedy stays visible.
 */
export async function syncSalonToSupabase(
  db: SupabaseClient,
  payload: SalonSyncPayload,
  options: { deleteRemoved?: boolean } = {}
): Promise<SalonSyncResult> {
  const { ownerId, profile, services, stylists, loyaltyConfig } = payload;
  const teamMembers = Array.isArray(payload.teamMembers) ? payload.teamMembers : [];
  const photoGallery = Array.isArray(payload.photoGallery) ? payload.photoGallery : [];
  const branches = Array.isArray(payload.branches) ? payload.branches : [];
  const errors: string[] = [];

  // -- Unauthenticated / mock fast path: draft + SUCCESS (Local Draft) -----
  const sessionProbe = await detectUnauthenticatedSession(db, ownerId);
  if (sessionProbe.unauthenticated) {
    const draft = saveSalonDraftToLocalStorage(payload);
    console.error('[Nexora Sync Error]:', `table=auth operation=syncSalonToSupabase status=401 code=UNAUTHENTICATED message=${sessionProbe.reason} — draft ${draft.ok ? 'cached' : 'FAILED'} under ${NEXORA_DRAFT_KEY}`);
    if (!draft.ok) {
      return {
        ok: false,
        errors: [`local draft: ${draft.error || 'write failed'} · ${sessionProbe.reason}`],
        persisted: 'none',
        localDraft: false,
        draftSaved: false,
        message: 'Could not save even locally.',
      };
    }
    return {
      ok: true,
      errors: [],
      persisted: 'local-draft',
      localDraft: true,
      draftSaved: true,
      message: `SUCCESS (Local Draft) — ${sessionProbe.reason}; will sync after sign-in.`,
    };
  }

  const runOp = async (
    table: string,
    label: string,
    run: () => PromiseLike<{ error?: unknown } | void>,
    opts: { optionalTable?: boolean } = {}
  ) => {
    try {
      await withRetry(
        async () => {
          const result = await run();
          const err =
            result && typeof result === 'object' ? (result as { error?: unknown }).error : undefined;
          if (err) throw err;
        },
        { label: `cloud sync → ${label}` }
      );
    } catch (err) {
      const collected = logTableSyncError(table, label, err);
      // Optional collections (team_members / photo_gallery / salon_branches)
      // may not exist in projects migrated before they were added — a
      // missing-table there is a skip, never a save failure.
      if (opts.optionalTable && isMissingTableMessage(collected)) {
        console.warn(
          `[SalonSync] Optional table "${table}" does not exist — skipping (${label}).`
        );
        return;
      }
      errors.push(collected);
    }
  };

  const safeServices = Array.isArray(services) ? services : [];
  const safeStylists = Array.isArray(stylists) ? stylists : [];
  const safeRewards = Array.isArray(loyaltyConfig?.rewards) ? loyaltyConfig.rewards : [];

  const serviceRows = safeServices.map((s, i) => toServiceDbRow(s, ownerId, i));
  const stylistRows = safeStylists.map((st, i) => toStylistDbRow(st, ownerId, i));
  const rewardRows = safeRewards.map((r, i) => toRewardDbRow(r, ownerId, i));
  const teamMemberRows = teamMembers.map((m, i) => toTeamMemberDbRow(m, ownerId, i));
  const photoRows = photoGallery.map((p, i) => toPhotoGalleryDbRow(p, ownerId, i));
  const branchRows = branches.map((b, i) => toBranchDbRow(b, ownerId, i));

  await Promise.all([
    runOp('profiles', 'save salon profile', () =>
      db.from('profiles').upsert(toProfileRow(profile, ownerId))
    ),

    serviceRows.length
      ? runOp('services', 'save services & pricing', () => db.from('services').upsert(serviceRows))
      : Promise.resolve(),

    stylistRows.length
      ? runOp('stylists', 'save stylists', () => db.from('stylists').upsert(stylistRows))
      : Promise.resolve(),

    runOp('loyalty_config', 'save loyalty settings', () =>
      db.from('loyalty_config').upsert(toLoyaltyConfigDbRow(loyaltyConfig, ownerId))
    ),

    rewardRows.length
      ? runOp('loyalty_rewards', 'save loyalty rewards', () =>
          db.from('loyalty_rewards').upsert(rewardRows)
        )
      : Promise.resolve(),

    teamMemberRows.length
      ? runOp(
          'team_members',
          'save team members',
          () => db.from('team_members').upsert(teamMemberRows),
          { optionalTable: true }
        )
      : Promise.resolve(),

    photoRows.length
      ? runOp(
          'photo_gallery',
          'save photo gallery',
          () => db.from('photo_gallery').upsert(photoRows),
          { optionalTable: true }
        )
      : Promise.resolve(),

    branchRows.length
      ? runOp(
          'salon_branches',
          'save salon branches',
          () => db.from('salon_branches').upsert(branchRows),
          { optionalTable: true }
        )
      : Promise.resolve(),

    // Only sync deletions once the client has hydrated the owner's existing
    // rows — otherwise a stale local list could delete data it never loaded.
    ...(options.deleteRemoved
      ? [
          runOp('services', 'remove deleted services', () =>
            deleteRowsNotIn(db, 'services', ownerId, serviceRows.map((r) => r.id))
          ),
          runOp('stylists', 'remove deleted stylists', () =>
            deleteRowsNotIn(db, 'stylists', ownerId, stylistRows.map((r) => r.id))
          ),
          runOp('loyalty_rewards', 'remove deleted rewards', () =>
            deleteRowsNotIn(db, 'loyalty_rewards', ownerId, rewardRows.map((r) => r.id))
          ),
        ]
      : []),
  ]);

  if (errors.length === 0) {
    clearSalonDraftBestEffort();
    return {
      ok: true,
      errors: [],
      persisted: 'cloud',
      localDraft: false,
      draftSaved: false,
      message: 'Saved to the cloud.',
    };
  }

  // Failures happened — always keep a draft backup so no progress is lost.
  const draft = saveSalonDraftToLocalStorage(payload);
  if (!draft.ok) {
    console.error('[Nexora Sync Error]:', `table=localStorage operation=saveSalonDraft status=unknown code=LOCAL_WRITE_FAILED message=${draft.error}`, draft.error);
  } else if (draft.degraded) {
    console.warn('[SalonSync] Draft cached without inline images (quota):', draft.error);
  }

  const joined = errors.join(' · ');
  if (isSilentLocalDraftFailure(joined)) {
    // Auth/RLS/network-only: SUCCESS (Local Draft), no blocking UI error —
    // but only when the draft backup actually landed. If even localStorage
    // failed (quota/private mode), report a real failure so the caller can
    // surface it. The auto-save chain (persistSalonWithFallbacks) still
    // attempts the service-role website API before settling on this draft.
    if (!draft.ok) {
      console.error('[Nexora Sync Error]:', `table=salon-sync operation=syncSalonToSupabase status=failed code=LOCAL_WRITE_FAILED message=cloud unreachable (${joined}) and draft backup FAILED (${draft.error})`);
      return {
        ok: false,
        errors: [...errors, `local draft: ${draft.error || 'write failed'}`],
        persisted: 'none',
        localDraft: false,
        draftSaved: false,
        message: 'Cloud unreachable and local draft backup failed.',
      };
    }
    console.error('[Nexora Sync Error]:', `table=salon-sync operation=syncSalonToSupabase status=degraded code=LOCAL_DRAFT message=cloud unreachable (${joined}) — SUCCESS (Local Draft) cached under ${NEXORA_DRAFT_KEY}`);
    return {
      ok: true,
      errors: [],
      persisted: 'local-draft',
      localDraft: true,
      draftSaved: true,
      message: 'SUCCESS (Local Draft) — cloud unreachable; edits cached locally and will sync later.',
    };
  }

  // Deterministic (duplicate subdomain, uuid mismatch, missing schema…):
  // keep ok:false so the exact remedy stays visible; the draft above keeps
  // the progress safe regardless.
  console.error('[SalonSync] Some cloud saves failed:', errors);
  return {
    ok: false,
    errors: draft.ok ? errors : [...errors, `local draft: ${draft.error || 'write failed'}`],
    persisted: 'none',
    localDraft: false,
    draftSaved: draft.ok,
    message: 'Cloud save failed; draft backup cached locally.',
  };
}
