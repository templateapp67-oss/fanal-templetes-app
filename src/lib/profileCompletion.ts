import { hasRequiredWebsiteProfile, isValidContactPhone } from './websiteValidation';
import type { SalonProfile } from '../types';
import { supabase, isMockSupabase } from './supabaseClient';

export interface SalonProfileCompletionInfo {
  isComplete: boolean;
  percentage: number;
  completedCount: number;
  totalCount: number;
  missingFields: string[];
  mandatoryMissing: string[];
}

export const MANDATORY_PROFILE_FIELDS: Array<{ key: keyof SalonProfile; label: string }> = [
  { key: 'businessName', label: 'Salon Name' },
  { key: 'phone', label: 'Contact Number' },
  { key: 'businessType', label: 'Business Category' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
];

export const CORE_PROFILE_FIELDS: Array<{ key: keyof SalonProfile; label: string; mandatory: boolean }> = [
  { key: 'businessName', label: 'Salon Name', mandatory: true },
  { key: 'phone', label: 'Contact Number', mandatory: true },
  { key: 'businessType', label: 'Business Category', mandatory: true },
  { key: 'address', label: 'Address', mandatory: true },
  { key: 'city', label: 'City', mandatory: true },
  { key: 'ownerName', label: 'Owner Name', mandatory: false },
  { key: 'tagline', label: 'Tagline', mandatory: false },
  { key: 'email', label: 'Email Address', mandatory: false },
];

/**
 * Checks mandatory profile fields (salon_name, phone_number, category, address, city).
 * Returns true only when all core operational details are filled.
 */
export function isSalonProfileComplete(profile: Partial<SalonProfile> | null | undefined): boolean {
  return hasRequiredWebsiteProfile(profile);
}

/** Alias for isSalonProfileComplete */
export function isProfileComplete(profile: Partial<SalonProfile> | null | undefined): boolean {
  return isSalonProfileComplete(profile);
}

/**
 * Returns detailed completion metrics including percentage, missing fields, and mandatory flags.
 */
export function getSalonProfileCompletion(profile: Partial<SalonProfile> | null | undefined): SalonProfileCompletionInfo {
  if (!profile || typeof profile !== 'object') {
    return {
      isComplete: false,
      percentage: 0,
      completedCount: 0,
      totalCount: CORE_PROFILE_FIELDS.length,
      missingFields: CORE_PROFILE_FIELDS.map((f) => f.label),
      mandatoryMissing: MANDATORY_PROFILE_FIELDS.map((f) => f.label),
    };
  }

  const missingFields: string[] = [];
  const mandatoryMissing: string[] = [];
  let completedCount = 0;

  for (const field of CORE_PROFILE_FIELDS) {
    let val = (profile as any)[field.key];
    if (field.key === 'phone' && !val && (profile as any).phone_number) {
      val = (profile as any).phone_number;
    }
    const isPresent = field.key === 'phone' ? isValidContactPhone(val) : (typeof val === 'string' ? val.trim().length > 0 : Boolean(val));
    if (isPresent) {
      completedCount++;
    } else {
      missingFields.push(field.label);
      if (field.mandatory) {
        mandatoryMissing.push(field.label);
      }
    }
  }

  const isComplete = isSalonProfileComplete(profile);
  const percentage = Math.min(100, Math.round((completedCount / CORE_PROFILE_FIELDS.length) * 100));

  return {
    isComplete,
    percentage,
    completedCount,
    totalCount: CORE_PROFILE_FIELDS.length,
    missingFields,
    mandatoryMissing,
  };
}

export function isPartnerProfileComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['name', 'whatsapp', 'postal', 'city', 'area', 'avatar', 'dob'].every(
    key => typeof p[key] === 'string' && (p[key] as string).trim().length > 0
  );
}

export interface ProfileCompletionStatusResult {
  isComplete: boolean;
  missingFields: string[];
  profile: {
    ownerName: string;
    businessName: string;
    phone: string;
    city: string;
    address: string;
    postalCode: string;
    businessType: string;
  } | null;
  salonId: string | null;
  organizationId: string | null;
}

export async function getMyProfileCompletionStatus(): Promise<ProfileCompletionStatusResult> {
  if (isMockSupabase) {
    let storedStateStr: string | null = null;
    try {
      storedStateStr = typeof window !== 'undefined' ? localStorage.getItem('nexora_salon_state_v1') : null;
    } catch {}
    let profile: any = null;
    if (storedStateStr) {
      try {
        const state = JSON.parse(storedStateStr);
        profile = state?.profile;
      } catch {}
    }
    const ownerName = profile?.ownerName || '';
    const businessName = profile?.businessName || '';
    const phone = profile?.phone || profile?.whatsapp || '';
    const city = profile?.city || '';
    const address = profile?.address || '';
    const postalCode = profile?.postalCode || '';
    const businessType = profile?.businessType || 'hair_salon';

    const missingFields: string[] = [];
    if (!ownerName.trim()) missingFields.push('ownerName');
    if (!businessName.trim()) missingFields.push('businessName');
    if (!phone.trim()) missingFields.push('phone');
    if (!city.trim()) missingFields.push('city');

    return {
      isComplete: missingFields.length === 0,
      missingFields,
      profile: {
        ownerName,
        businessName,
        phone,
        city,
        address,
        postalCode,
        businessType,
      },
      salonId: 'mock-salon',
      organizationId: 'mock-org',
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_my_profile_completion_status');
    if (error) throw error;
    return {
      isComplete: data.isComplete,
      missingFields: Array.isArray(data.missingFields) ? data.missingFields : [],
      profile: data.profile,
      salonId: data.salonId,
      organizationId: data.organizationId,
    };
  } catch (err) {
    console.error('[profileCompletion] getMyProfileCompletionStatus RPC error:', err);
    return {
      isComplete: false,
      missingFields: ['database-error'],
      profile: null,
      salonId: null,
      organizationId: null,
    };
  }
}

export function isProfileCompleteForWebsiteEditor(profile: any): boolean {
  if (!profile) return false;
  const ownerName = String(profile.ownerName || '').trim();
  const businessName = String(profile.businessName || '').trim();
  const phone = String(profile.phone || profile.whatsapp || '').trim();
  const city = String(profile.city || '').trim();
  const businessType = String(profile.businessType || '').trim();

  return (
    ownerName.length > 0 &&
    businessName.length > 0 &&
    phone.length >= 7 &&
    city.length > 0 &&
    businessType.length > 0
  );
}
