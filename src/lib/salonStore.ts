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

/**
 * Merge a new category template into the current profile WITHOUT clobbering
 * the owner's own input (salon name, phone, city, address, services, etc.).
 *
 * Fields the user has customised (i.e. differ from the previous template's
 * defaults) are preserved; untouched defaults roll over to the new template.
 */
export function mergeTemplatePreservingUserData(
  prev: SalonProfile,
  nextTmplId: BusinessTypeId,
  prevTmplId?: BusinessTypeId
): SalonProfile {
  const tmpl = CATEGORY_TEMPLATES[nextTmplId];
  if (!tmpl) return prev;

  const prevTmpl = prevTmplId ? CATEGORY_TEMPLATES[prevTmplId] : undefined;

  // A value is "customised" when the current value is non-empty AND differs
  // from what the previous template's default was.
  const keepIfCustomized = (
    value: string | undefined,
    prevDefault: string | undefined
  ) => {
    if (value && value !== prevDefault) return value;
    return undefined;
  };

  const wasCustomized = (value: string | undefined, prevDefault: string | undefined) =>
    !!value && value !== prevDefault;

  // Business copy / contact: customised values stick around, otherwise the new
  // template's defaults are adopted.
  const nextProfile: SalonProfile = {
    ...prev,
    businessType: tmpl.id,
    themePreset: tmpl.themePreset,
    themeAccentKey: DEFAULT_CATEGORY_ACCENTS[tmpl.id] as AccentPaletteKey,
    customAccentColor: undefined,
    currency: '₹',
    businessName:
      keepIfCustomized(prev.businessName, prevTmpl?.title) || tmpl.title,
    ownerName:
      keepIfCustomized(prev.ownerName, prevTmpl?.ownerName) || tmpl.ownerName,
    ownerRole:
      keepIfCustomized(prev.ownerRole, prevTmpl?.ownerRole) || tmpl.ownerRole,
    phone: keepIfCustomized(prev.phone, prevTmpl?.phone) || tmpl.phone,
    whatsapp:
      keepIfCustomized(prev.whatsapp, prevTmpl?.whatsapp) || tmpl.whatsapp,
    tagline:
      keepIfCustomized(prev.tagline, prevTmpl?.tagline) || tmpl.tagline,
    about: keepIfCustomized(prev.about, prevTmpl?.about) || tmpl.about,
    address:
      keepIfCustomized(prev.address, prevTmpl?.defaultAddress) ||
      tmpl.defaultAddress,
    city: keepIfCustomized(prev.city, prevTmpl?.defaultCity) || tmpl.defaultCity,
    postalCode:
      keepIfCustomized(prev.postalCode, prevTmpl?.defaultPostalCode) ||
      tmpl.defaultPostalCode,
    instagramHandle:
      keepIfCustomized(prev.instagramHandle, prevTmpl?.instagramHandle) ||
      tmpl.instagramHandle,
    // Images only roll over when the owner uploaded a custom (data URL) image,
    // otherwise the new template's curated photo is used.
    ownerPhotoUrl: wasCustomized(prev.ownerPhotoUrl, prevTmpl?.ownerPhotoUrl)
      ? prev.ownerPhotoUrl
      : tmpl.ownerPhotoUrl,
    coverImageUrl:
      prev.coverImageUrl?.startsWith('data:') || prev.coverImageUrl === prevTmpl?.coverImageUrl
        ? prev.coverImageUrl
        : tmpl.coverImageUrl,
    // Always regenerate the subdomain from the (possibly preserved) salon name.
    subdomain: slugifySalonName(
      keepIfCustomized(prev.businessName, prevTmpl?.title) || tmpl.title
    ),
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
