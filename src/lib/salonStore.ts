import {
  SalonProfile,
  SalonService,
  Stylist,
  BusinessTypeId,
  LoyaltyConfig,
} from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { DEFAULT_CATEGORY_ACCENTS, AccentPaletteKey } from '../themeAccents';
import { DEFAULT_LOYALTY_CONFIG } from '../loyaltyData';
import { safeWriteLocalStorage, LocalStorageWriteResult } from './autoSave';

// ============================================================================
// Central persistent salon state.
// A single source of truth for the whole app so onboarding fields, the active
// template, services, stylists and loyalty config never get lost when a user
// switches templates/themes.
// ============================================================================

export const SALON_STATE_STORAGE_KEY = 'nexora_salon_state_v1';
export const ONBOARDING_COMPLETED_KEY = 'onboarding_wizard_completed';

export interface SalonState {
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
  loyaltyConfig: LoyaltyConfig;
  selectedTemplateId: BusinessTypeId;
}

/** Clean, URL-safe subdomain from a salon name. */
export function slugifySalonName(name: string): string {
  const base =
    (name || 'mysalon')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^-+/g, '')
      .trim();
  // Never start with a digit, keep it short and readable.
  const cleaned = base.replace(/^[0-9]+/, '');
  return (cleaned.slice(0, 30) || 'mysalon').replace(/^-+$/, 'mysalon');
}

/** Build the public (white-label) site URL from a profile. */
export function getSiteUrl(profile: SalonProfile, publishedOrigin?: string): string {
  if (profile.customDomain) {
    return `https://${profile.customDomain}`;
  }
  const sub = profile.subdomain || slugifySalonName(profile.businessName);

  // Share the published deployment, not the editor's temporary preview origin.
  if (publishedOrigin) {
    const url = new URL('/', publishedOrigin);
    url.searchParams.set('site', sub);
    return url.toString();
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    const host = window.location.hostname;
    // If running under official nexora.in production domain:
    if (host.endsWith('nexora.in') && !host.startsWith('localhost')) {
      return `https://${sub}.nexora.in`;
    }
    // For Vercel deployments, preview hosts, sandbox, localhost:
    return `${origin}/?site=${sub}`;
  }

  return `https://${sub}.nexora.in`;
}

/** Get the official subdomain format URL (e.g. https://arts-by-uma.nexora.in). */
export function getSubdomainUrl(profile: SalonProfile): string {
  if (profile.customDomain) {
    return `https://${profile.customDomain}`;
  }
  const sub = profile.subdomain || slugifySalonName(profile.businessName);
  return `https://${sub}.nexora.in`;
}

export interface AuthenticatedProfileState {
  salonName?: string;
  businessName?: string;
  phoneNumber?: string;
  phone?: string;
  city?: string;
  ownerName?: string;
  fullName?: string;
  email?: string;
  address?: string;
  fullAddress?: string;
  postalCode?: string;
  subdomain?: string;
}

const AUTH_PROFILE_STORAGE_KEY = 'nexora_auth_profile_state';

/**
 * Scoped storage key for tenant salon state:
 * `nexora:salon:${userId}:${salonId}`
 */
export function getScopedSalonStateKey(userId: string, salonId?: string | null): string {
  const sid = salonId || 'default';
  return `nexora:salon:${userId}:${sid}`;
}

export function getScopedAuthProfileKey(userId: string): string {
  return `nexora:auth_profile:${userId}`;
}

export function getStoredAuthenticatedProfile(userId?: string | null): AuthenticatedProfileState | null {
  try {
    if (typeof window === 'undefined' || !userId) return null;
    const key = getScopedAuthProfileKey(userId);
    let raw = localStorage.getItem(key);
    if (!raw) {
      raw = localStorage.getItem(`${AUTH_PROFILE_STORAGE_KEY}_${userId}`);
    }
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredAuthenticatedProfile(profile: Partial<AuthenticatedProfileState> | null, userId?: string | null) {
  try {
    if (typeof window === 'undefined' || !userId) return;
    const key = getScopedAuthProfileKey(userId);
    if (!profile) {
      localStorage.removeItem(key);
      localStorage.removeItem(`${AUTH_PROFILE_STORAGE_KEY}_${userId}`);
      return;
    }
    const current = getStoredAuthenticatedProfile(userId) || {};
    const merged = { ...current, ...profile };
    localStorage.setItem(key, JSON.stringify(merged));
    localStorage.setItem(`${AUTH_PROFILE_STORAGE_KEY}_${userId}`, JSON.stringify(merged));
    // NEVER write to un-scoped AUTH_PROFILE_STORAGE_KEY
  } catch {
    // ignore quota/storage issues
  }
}

/**
 * Merge a new category template into the current profile WITHOUT clobbering
 * the owner's own input (salon name, phone, city, address, services, etc.),
 * AND automatically fetching & populating salon name, mobile, and city from
 * the user's authenticated profile state whenever any template is selected.
 */
export function mergeTemplatePreservingUserData(
  prev: SalonProfile,
  nextTmplId: BusinessTypeId,
  prevTmplId?: BusinessTypeId,
  authProfileOverride?: Partial<AuthenticatedProfileState> | null
): SalonProfile {
  const tmpl = CATEGORY_TEMPLATES[nextTmplId];
  if (!tmpl) return prev;

  const prevTmpl = prevTmplId ? CATEGORY_TEMPLATES[prevTmplId] : undefined;
  const auth = authProfileOverride || getStoredAuthenticatedProfile();

  // A value is "customised" when the current value is non-empty AND differs
  // from what the previous template's default was.
  const keepIfCustomized = (
    value: string | undefined,
    prevDefault: string | undefined
  ) => {
    if (value && value.trim() && value !== prevDefault) return value.trim();
    return undefined;
  };

  const wasCustomized = (value: string | undefined, prevDefault: string | undefined) =>
    Boolean(value && value.trim() && value !== prevDefault);

  // Authenticated profile values have priority for auto-population onto selected templates:
  const authSalonName = (auth?.salonName || auth?.businessName || '').trim();
  const authPhone = (auth?.phoneNumber || auth?.phone || '').trim();
  const authCity = (auth?.city || '').trim();
  const authOwnerName = (auth?.ownerName || auth?.fullName || '').trim();
  const authAddress = (auth?.fullAddress || auth?.address || '').trim();

  // Business Name:
  // 1. Customized value if user explicitly changed it
  // 2. Authenticated user's registered salon name
  // 3. Current business name if already valid and not prev template's title
  // 4. New template title
  const resolvedBusinessName =
    keepIfCustomized(prev.businessName, prevTmpl?.title) ||
    authSalonName ||
    (prev.businessName && prev.businessName !== prevTmpl?.title ? prev.businessName : tmpl.title);

  // Phone / Mobile:
  const resolvedPhone =
    keepIfCustomized(prev.phone, prevTmpl?.phone) ||
    authPhone ||
    (prev.phone && prev.phone !== prevTmpl?.phone ? prev.phone : tmpl.phone);

  // City:
  const resolvedCity =
    keepIfCustomized(prev.city, prevTmpl?.defaultCity) ||
    authCity ||
    (prev.city && prev.city !== prevTmpl?.defaultCity ? prev.city : tmpl.defaultCity);

  // Owner Name:
  const resolvedOwnerName =
    keepIfCustomized(prev.ownerName, prevTmpl?.ownerName) ||
    authOwnerName ||
    prev.ownerName?.trim() ||
    '';

  // Address:
  const resolvedAddress =
    keepIfCustomized(prev.address, prevTmpl?.defaultAddress) ||
    authAddress ||
    prev.address?.trim() ||
    tmpl.defaultAddress;

  // WhatsApp:
  const resolvedWhatsapp =
    keepIfCustomized(prev.whatsapp, prevTmpl?.whatsapp) ||
    authPhone ||
    prev.whatsapp?.trim() ||
    '';

  const nextProfile: SalonProfile = {
    ...prev,
    businessType: tmpl.id,
    themePreset: tmpl.themePreset,
    themeAccentKey: DEFAULT_CATEGORY_ACCENTS[tmpl.id] as AccentPaletteKey,
    customAccentColor: undefined,
    currency: '₹',
    businessName: resolvedBusinessName,
    ownerName: resolvedOwnerName,
    ownerRole:
      keepIfCustomized(prev.ownerRole, prevTmpl?.ownerRole) || prev.ownerRole?.trim() || tmpl.ownerRole,
    phone: resolvedPhone,
    whatsapp: resolvedWhatsapp,
    tagline:
      keepIfCustomized(prev.tagline, prevTmpl?.tagline) || prev.tagline?.trim() || tmpl.tagline,
    about: keepIfCustomized(prev.about, prevTmpl?.about) || prev.about?.trim() || tmpl.about,
    address: resolvedAddress,
    city: resolvedCity,
    postalCode:
      keepIfCustomized(prev.postalCode, prevTmpl?.defaultPostalCode) ||
      auth?.postalCode ||
      prev.postalCode?.trim() ||
      tmpl.defaultPostalCode,
    instagramHandle:
      keepIfCustomized(prev.instagramHandle, prevTmpl?.instagramHandle) ||
      prev.instagramHandle?.trim() ||
      tmpl.instagramHandle,
    ownerPhotoUrl: prev.ownerPhotoUrl?.trim()
      ? prev.ownerPhotoUrl
      : (tmpl.ownerPhotoUrl || ''),
    coverImageUrl:
      prev.coverImageUrl?.startsWith('data:') || prev.coverImageUrl === prevTmpl?.coverImageUrl
        ? prev.coverImageUrl
        : (tmpl.coverImageUrl || prev.coverImageUrl || ''),
    subdomain: slugifySalonName(resolvedBusinessName),
  };

  return nextProfile;
}

/** Decide whether the owner has customised their service list. */
export function areServicesCustomized(
  services: SalonService[],
  prevTmplId?: BusinessTypeId
): boolean {
  if (!services.length) return false;
  if (!prevTmplId) return true;
  const prevDefault = CATEGORY_TEMPLATES[prevTmplId]?.services;
  if (!prevDefault) return true;
  if (services.length !== prevDefault.length) return true;
  // Same ids, same lengths -> effectively the template defaults
  const prevIds = prevDefault.map((s) => s.id).sort().join(',');
  const curIds = services.map((s) => s.id).sort().join(',');
  return curIds !== prevIds;
}

/** Decide whether the owner has customised their stylist list. */
export function areStylistsCustomized(
  stylists: Stylist[],
  prevTmplId?: BusinessTypeId
): boolean {
  if (!stylists.length) return false;
  if (!prevTmplId) return true;
  const prevDefault = CATEGORY_TEMPLATES[prevTmplId]?.stylists;
  if (!prevDefault) return true;
  if (stylists.length !== prevDefault.length) return true;
  const prevIds = prevDefault.map((s) => s.id).sort().join(',');
  const curIds = stylists.map((s) => s.id).sort().join(',');
  return curIds !== prevIds;
}

/** Auto-compute services/stylists for a template switch, preserving edits. */
export function mergeTemplateServices(
  services: SalonService[],
  nextTmplId: BusinessTypeId,
  prevTmplId?: BusinessTypeId
): SalonService[] {
  if (areServicesCustomized(services, prevTmplId)) return services;
  return CATEGORY_TEMPLATES[nextTmplId]?.services || services;
}

export function mergeTemplateStylists(
  stylists: Stylist[],
  nextTmplId: BusinessTypeId,
  prevTmplId?: BusinessTypeId
): Stylist[] {
  if (areStylistsCustomized(stylists, prevTmplId)) return stylists;
  return CATEGORY_TEMPLATES[nextTmplId]?.stylists || stylists;
}

// ============================================================================
// localStorage helpers
// ============================================================================
export function clearAllLocalUserState(targetUserId?: string | null): void {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    // 1. Remove all un-scoped global tenant keys
    const globalKeys = [
      SALON_STATE_STORAGE_KEY,
      'nexora_draft_salon_data',
      AUTH_PROFILE_STORAGE_KEY,
      'nexora_authenticated_profile',
      'pinky_nails_salon_profile_v1',
      ONBOARDING_COMPLETED_KEY,
      'nexora_auth_user_v1',
      'salonState',
      'profile',
      'currentSalon',
      'websiteState',
      'partnerProfile',
      'salon_guest_booking_info',
    ];
    for (const key of globalKeys) {
      localStorage.removeItem(key);
    }

    // 2. Clear tenant-scoped keys matching patterns
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (targetUserId) {
        if (
          k.startsWith(`nexora:salon:${targetUserId}:`) ||
          k === `nexora:auth_profile:${targetUserId}` ||
          k === `nexora:draft:${targetUserId}` ||
          k.startsWith(`nexora:backup:${targetUserId}:`) ||
          k === `${SALON_STATE_STORAGE_KEY}_${targetUserId}` ||
          k === `${AUTH_PROFILE_STORAGE_KEY}_${targetUserId}`
        ) {
          doomed.push(k);
        }
      } else {
        if (
          k.startsWith('nexora:salon:') ||
          k.startsWith('nexora:auth_profile:') ||
          k.startsWith('nexora:draft:') ||
          k.startsWith('nexora:backup:') ||
          k.startsWith(`${SALON_STATE_STORAGE_KEY}_`) ||
          k.startsWith(`${AUTH_PROFILE_STORAGE_KEY}_`) ||
          k.startsWith('salon_snapshots_history_')
        ) {
          doomed.push(k);
        }
      }
    }
    for (const k of doomed) {
      localStorage.removeItem(k);
    }
  } catch {}
}

export function loadSalonState(userId?: string | null, salonId?: string | null): SalonState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    if (userId) {
      const targetSalon = salonId || 'default';
      const scopedKey = getScopedSalonStateKey(userId, targetSalon);
      let raw = localStorage.getItem(scopedKey);
      if (!raw) {
        raw = localStorage.getItem(`${SALON_STATE_STORAGE_KEY}_${userId}`);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const profile = parsed.profile && typeof parsed.profile === 'object' && parsed.profile.businessName ? parsed.profile : null;
          if (profile) {
            // Strict ownership guard
            if (profile.ownerId && profile.ownerId !== userId) {
              return null;
            }
            return {
              profile,
              services: Array.isArray(parsed.services) && parsed.services.length > 0 ? parsed.services : null,
              stylists: Array.isArray(parsed.stylists) && parsed.stylists.length > 0 ? parsed.stylists : null,
              loyaltyConfig: parsed.loyaltyConfig && typeof parsed.loyaltyConfig === 'object' ? parsed.loyaltyConfig : DEFAULT_LOYALTY_CONFIG,
              selectedTemplateId: parsed.selectedTemplateId || parsed.profile?.businessType || 1,
            };
          }
        }
      }
      return null;
    }

    // When NO userId is provided:
    // NEVER return any cached data that has an ownerId!
    // Check purely anonymous visitor cache if any:
    const anonKey = 'nexora:salon:anonymous:default';
    const anonRaw = localStorage.getItem(anonKey);
    if (anonRaw) {
      const parsed = JSON.parse(anonRaw);
      if (parsed?.profile && !parsed.profile.ownerId && parsed.profile.businessName) {
        return {
          profile: parsed.profile,
          services: Array.isArray(parsed.services) ? parsed.services : null,
          stylists: Array.isArray(parsed.stylists) ? parsed.stylists : null,
          loyaltyConfig: parsed.loyaltyConfig || DEFAULT_LOYALTY_CONFIG,
          selectedTemplateId: parsed.selectedTemplateId || parsed.profile?.businessType || 1,
        };
      }
    }
  } catch {}

  return null;
}

export function saveSalonState(state: SalonState, userId?: string | null, salonId?: string | null): LocalStorageWriteResult {
  // Quota-aware write: uploaded images are stored as data URLs and can exceed
  // the ~5MB localStorage budget. safeWriteLocalStorage never throws — it
  // retries once without inline images and reports the exact error instead of
  // failing the whole save flow with a generic "Save failed".
  const targetUser = userId || state.profile?.ownerId;
  const targetSalon = salonId || state.profile?.id || 'default';
  if (targetUser) {
    const scopedKey = getScopedSalonStateKey(targetUser, targetSalon);
    const res = safeWriteLocalStorage(scopedKey, JSON.stringify(state));
    safeWriteLocalStorage(`${SALON_STATE_STORAGE_KEY}_${targetUser}`, JSON.stringify(state));
    // NEVER write to un-scoped global key `SALON_STATE_STORAGE_KEY`!
    return res;
  }
  // Purely anonymous visitor before login/signup:
  return safeWriteLocalStorage('nexora:salon:anonymous:default', JSON.stringify(state));
}

// Legacy key the app previously wrote to; we migrate it on first load.
export const LEGACY_PROFILE_KEY = 'pinky_nails_salon_profile_v1';
export function loadLegacyProfile(): SalonProfile | null {
  try {
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
