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

export function getStoredAuthenticatedProfile(): AuthenticatedProfileState | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(AUTH_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredAuthenticatedProfile(profile: Partial<AuthenticatedProfileState> | null) {
  try {
    if (typeof window === 'undefined') return;
    if (!profile) {
      localStorage.removeItem(AUTH_PROFILE_STORAGE_KEY);
      return;
    }
    const current = getStoredAuthenticatedProfile() || {};
    const merged = { ...current, ...profile };
    localStorage.setItem(AUTH_PROFILE_STORAGE_KEY, JSON.stringify(merged));
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
    (prev.ownerName && prev.ownerName !== prevTmpl?.ownerName ? prev.ownerName : tmpl.ownerName);

  // Address:
  const resolvedAddress =
    keepIfCustomized(prev.address, prevTmpl?.defaultAddress) ||
    authAddress ||
    tmpl.defaultAddress;

  // WhatsApp:
  const resolvedWhatsapp =
    keepIfCustomized(prev.whatsapp, prevTmpl?.whatsapp) ||
    authPhone ||
    tmpl.whatsapp;

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
      keepIfCustomized(prev.ownerRole, prevTmpl?.ownerRole) || tmpl.ownerRole,
    phone: resolvedPhone,
    whatsapp: resolvedWhatsapp,
    tagline:
      keepIfCustomized(prev.tagline, prevTmpl?.tagline) || tmpl.tagline,
    about: keepIfCustomized(prev.about, prevTmpl?.about) || tmpl.about,
    address: resolvedAddress,
    city: resolvedCity,
    postalCode:
      keepIfCustomized(prev.postalCode, prevTmpl?.defaultPostalCode) ||
      auth?.postalCode ||
      tmpl.defaultPostalCode,
    instagramHandle:
      keepIfCustomized(prev.instagramHandle, prevTmpl?.instagramHandle) ||
      tmpl.instagramHandle,
    ownerPhotoUrl: wasCustomized(prev.ownerPhotoUrl, prevTmpl?.ownerPhotoUrl)
      ? prev.ownerPhotoUrl
      : tmpl.ownerPhotoUrl,
    coverImageUrl:
      prev.coverImageUrl?.startsWith('data:') || prev.coverImageUrl === prevTmpl?.coverImageUrl
        ? prev.coverImageUrl
        : tmpl.coverImageUrl,
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
export function loadSalonState(): SalonState | null {
  try {
    const raw = localStorage.getItem(SALON_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      profile: parsed.profile,
      services: parsed.services,
      stylists: parsed.stylists,
      loyaltyConfig: parsed.loyaltyConfig || DEFAULT_LOYALTY_CONFIG,
      selectedTemplateId: parsed.selectedTemplateId,
    };
  } catch {
    return null;
  }
}

export function saveSalonState(state: SalonState): LocalStorageWriteResult {
  // Quota-aware write: uploaded images are stored as data URLs and can exceed
  // the ~5MB localStorage budget. safeWriteLocalStorage never throws — it
  // retries once without inline images and reports the exact error instead of
  // failing the whole save flow with a generic "Save failed".
  return safeWriteLocalStorage(SALON_STATE_STORAGE_KEY, JSON.stringify(state));
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
