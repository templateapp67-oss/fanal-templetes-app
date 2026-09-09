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
// ERROR HANDLING CONTRACT (unauthenticated / free-tier / RLS failures):
//   Every database call (profiles, services, stylists, loyalty_config,
//   loyalty_rewards — the app's equivalents of team members / gallery /
//   branches data) is wrapped in try/catch + retry. syncSalonToSupabase
//   NEVER throws and NEVER fails silently: each per-table failure is logged
//   as `console.error('[Nexora Sync Error]:', …)` with the table name, the
//   exact message and the HTTP status, and the returned SalonSyncResult
//   flags whether RLS/auth blocked the whole sync (blockedByAuth).
//
//   The caller (autoSave.runSalonSavePipeline) then degrades gracefully:
//   unauthenticated owners, local mock sessions and Supabase free-tier
//   setups store the draft in localStorage `nexora_draft_salon_data` and the
//   editor shows SUCCESS (Local Draft) — never a blocking "couldn't save"
//   error. When the direct client sync is blocked by network/auth/RLS, the
//   pipeline retries through POST /api/website/save (service role).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { SalonProfile, SalonService, Stylist, LoyaltyConfig, RewardThreshold } from '../types.js';
import { toDbId, withRetry, describeError, isAuthLikeFailure } from './autoSave.js';

/** Namespaces keep the same logical id from colliding across tables. */
export const SERVICE_ID_NAMESPACE = 'nexora-service';
export const STYLIST_ID_NAMESPACE = 'nexora-stylist';
export const REWARD_ID_NAMESPACE = 'nexora-reward';

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
    offers: profile.offers ?? [],
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
    birthday_bonus_points: config.birthdayBonusPoints ?? 250,
    referral_bonus_points: config.referralBonusPoints ?? 100,
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
  let query = (db.from(table) as any).delete().eq('owner_id', ownerId);
  if (keepIds.length > 0) {
    // PostgREST "not in" filter: id=not.in.(uuid1,uuid2,…)
    query = query.not('id', 'in', `(${keepIds.join(',')})`);
  }
  const { error } = await query;
  return { error: error ?? null };
}

export interface SalonSyncPayload {
  ownerId: string;
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
  loyaltyConfig: LoyaltyConfig;
}

export interface SalonSyncResult {
  ok: boolean;
  /** Exact per-operation error messages (empty when ok). */
  errors: string[];
  /**
   * True when every failure is an authentication / RLS / table-grant
   * rejection (no network or data-shape problem). The save pipeline uses
   * this to route the retry through the service-role API instead of retrying
   * the same blocked client session forever.
   */
  blockedByAuth?: boolean;
}

/** The five tables every editor save writes (see migrations/00001_init.sql). */
export const SALON_SYNC_TABLES = [
  'profiles',
  'services',
  'stylists',
  'loyalty_config',
  'loyalty_rewards',
] as const;

/**
 * Push the full salon state to Supabase.
 *
 * NEVER throws, never fails silently:
 *   • every operation (profiles, services, stylists, loyalty_config,
 *     loyalty_rewards) is wrapped in try/catch + `withRetry` (network
 *     failures retry with backoff),
 *   • every per-table failure is logged as
 *     `console.error('[Nexora Sync Error]:', …)` with the table name, the
 *     exact message and the HTTP status, so network-trace issues are visible
 *     in DevTools immediately,
 *   • failures are collected per table (never swallowed) and reported in the
 *     result, including whether RLS/auth blocked the sync (blockedByAuth) so
 *     the caller can fall back to the localStorage draft (SUCCESS Local
 *     Draft) or the service-role API instead of surfacing a blocking error.
 *
 * Stale rows are deleted when `deleteRemoved` is set (the caller only enables
 * that after a successful hydrate so a half-loaded client can never wipe rows
 * it hasn't seen yet).
 */
export async function syncSalonToSupabase(
  db: SupabaseClient,
  payload: SalonSyncPayload,
  options: { deleteRemoved?: boolean } = {}
): Promise<SalonSyncResult> {
  try {
    const { ownerId, profile, services, stylists, loyaltyConfig } = payload;
    const errors: string[] = [];

    const runOp = async (
      table: string,
      label: string,
      run: () => PromiseLike<{ error?: unknown } | void>
    ) => {
      try {
        await withRetry(
          async () => {
            const result = await run();
            const err =
              result && typeof result === 'object'
                ? (result as { error?: unknown }).error
                : undefined;
            if (err) throw err;
          },
          { label: `cloud sync → ${label}` }
        );
      } catch (err) {
        const detail = describeError(err);
        errors.push(`${label}: ${detail}`);
        // Explicit, descriptive diagnostics: exact message + HTTP status +
        // table name, so a blocked RLS policy or a dead connection is
        // immediately visible in DevTools.
        const e = err as Record<string, any>;
        console.error('[Nexora Sync Error]:', {
          table,
          operation: label,
          message: detail,
          status: e?.status ?? undefined,
          code: e?.code ?? undefined,
          owner_id: ownerId,
        });
      }
    };

    const serviceRows = services.map((s, i) => toServiceDbRow(s, ownerId, i));
    const stylistRows = stylists.map((st, i) => toStylistDbRow(st, ownerId, i));
    const rewardRows = (loyaltyConfig.rewards || []).map((r, i) => toRewardDbRow(r, ownerId, i));

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

    if (errors.length) {
      const blockedByAuth = errors.every((e) => isAuthLikeFailure(e));
      console.error('[Nexora Sync Error]:', {
        stage: 'client sync — one or more tables failed',
        tables: SALON_SYNC_TABLES,
        owner_id: ownerId,
        blockedByAuth,
        errors,
      });
      return { ok: false, errors, blockedByAuth };
    }
    return { ok: true, errors: [], blockedByAuth: false };
  } catch (err) {
    // Defense in depth: syncSalonToSupabase must NEVER throw, no matter what
    // the client/middleware does. A thrown failure degrades to a result the
    // pipeline can route to the API fallback / local draft.
    const detail = describeError(err);
    console.error('[Nexora Sync Error]:', {
      stage: 'client sync — unexpected exception (no table-specific failure)',
      tables: SALON_SYNC_TABLES,
      message: detail,
    });
    return { ok: false, errors: [`unexpected sync failure: ${detail}`], blockedByAuth: false };
  }
}
