import { supabase, isMockSupabase } from './supabaseClient';
import type { SalonProfile } from '../types';
import { slugifySalonName } from './salonStore';

export interface OwnerSalonResolutionResult {
  status: 'active' | 'needs_onboarding';
  salon: any | null;
}

/**
 * Creates a clean, empty/default salon profile for a new user needing onboarding.
 * Uses ONLY the user's signup metadata (or blank defaults).
 * Zero mock data, no previous avatar, no demo salon name, no previous tenant settings.
 */
export function createBlankSalonProfile(user?: any): SalonProfile {
  const meta = user?.user_metadata || {};
  const businessName = meta.salon_name || '';
  return {
    ownerId: user?.id,
    businessType: 'hair_salon',
    businessName,
    ownerName: meta.full_name || '',
    ownerRole: '',
    phone: meta.phone_number || '',
    whatsapp: '',
    email: user?.email || '',
    tagline: '',
    about: '',
    ownerPhotoUrl: '',
    coverImageUrl: '',
    logoUrl: undefined,
    themePreset: 'slate_silver',
    themeAccentKey: 'slate',
    currency: '₹',
    subdomain: slugifySalonName(businessName),
    address: '',
    city: meta.city || '',
    areaLocality: '',
    postalCode: '',
    state: '',
    instagramHandle: '',
    facebookPage: '',
    tiktokHandle: '',
    tiktokProfile: '',
    requireDeposit: false,
    depositPercentage: 20,
    whiteLabelEnabled: true,
    offers: [],
  };
}

/**
 * Canonical owner salon resolution:
 * auth.uid()
 *     ↓
 * organization_members.user_id
 *     ↓
 * role = 'owner'
 * status = 'active'
 *     ↓
 * organization_members.organization_id
 *     ↓
 * salons.organization_id
 *
 * Consistent with nexora_owner_salon_ids().
 * job_salon_members is NOT used.
 * Never resolves a salon using:
 * - hardcoded salon ID
 * - cached salon ID
 * - previous localStorage salon ID
 * - fallback demo salon
 * - first salon in database
 * - static slug
 * - previous user state
 * - random salon
 * - query such as .limit(1) without ownership filtering
 *
 * When authenticated user exists BUT no valid owner organization/salon exists:
 * returns:
 * {
 *   status: "needs_onboarding",
 *   salon: null
 * }
 */
export async function resolveOwnerSalon(
  client: any = supabase,
  userId?: string
): Promise<OwnerSalonResolutionResult> {
  if (isMockSupabase) {
    return { status: 'needs_onboarding', salon: null };
  }

  let actor = userId;
  if (!actor) {
    try {
      const { data: sessionData } = await client.auth.getSession();
      actor = sessionData?.session?.user?.id;
    } catch {
      return { status: 'needs_onboarding', salon: null };
    }
  }

  if (!actor) {
    return { status: 'needs_onboarding', salon: null };
  }

  try {
    // 1. auth.uid() -> organization_members.user_id (role='owner', status='active')
    const { data: members, error: memErr } = await client
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', actor)
      .eq('role', 'owner')
      .eq('status', 'active');

    if (memErr || !members || members.length === 0) {
      return { status: 'needs_onboarding', salon: null };
    }

    const orgIds = members.map((m: any) => m.organization_id).filter(Boolean);
    if (orgIds.length === 0) {
      return { status: 'needs_onboarding', salon: null };
    }

    // 2. organization_members.organization_id -> salons.organization_id
    const { data: salons, error: salonErr } = await client
      .from('salons')
      .select('*')
      .in('organization_id', orgIds);

    if (salonErr || !salons || salons.length === 0) {
      return { status: 'needs_onboarding', salon: null };
    }

    // Filter out deleted salons if column exists
    const validSalons = salons.filter((s: any) => !s.deleted_at);
    if (validSalons.length === 0) {
      return { status: 'needs_onboarding', salon: null };
    }

    return {
      status: 'active',
      salon: validSalons[0],
    };
  } catch (err) {
    console.warn('[Owner salon resolution] Error resolving owner salon:', err);
    return { status: 'needs_onboarding', salon: null };
  }
}

export interface ProfileCompletenessResult {
  isComplete: boolean;
  missingFields: string[];
}

/**
 * Evaluates profile completeness for the global middleware guard.
 * Essential fields: ownerName (or full_name), phone (or whatsapp/phone_number), city.
 */
export function checkProfileCompleteness(
  profile?: Partial<SalonProfile> | null,
  user?: any
): ProfileCompletenessResult {
  const missingFields: string[] = [];
  const ownerName = String(profile?.ownerName || user?.user_metadata?.full_name || '').trim();
  const phone = String(profile?.phone || profile?.whatsapp || user?.user_metadata?.phone_number || '').trim();
  const city = String(profile?.city || user?.user_metadata?.city || '').trim();

  if (!ownerName) missingFields.push('ownerName');
  if (!phone) missingFields.push('phone');
  if (!city) missingFields.push('city');

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

export interface UserOwnedSalonsResult {
  salons: any[];
  count: number;
}

export async function fetchUserOwnedSalons(
  client: any = supabase,
  userId?: string
): Promise<UserOwnedSalonsResult> {
  if (isMockSupabase) {
    return { salons: [], count: 0 };
  }

  let actor = userId;
  if (!actor) {
    try {
      const { data: sessionData } = await client.auth.getSession();
      actor = sessionData?.session?.user?.id;
    } catch {
      return { salons: [], count: 0 };
    }
  }

  if (!actor) return { salons: [], count: 0 };

  try {
    const { data: members, error: memErr } = await client
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', actor)
      .eq('role', 'owner')
      .eq('status', 'active');

    if (memErr || !members || members.length === 0) {
      return { salons: [], count: 0 };
    }

    const orgIds = members.map((m: any) => m.organization_id).filter(Boolean);
    if (orgIds.length === 0) return { salons: [], count: 0 };

    const { data: salons, error: salonErr } = await client
      .from('salons')
      .select('*')
      .in('organization_id', orgIds);

    if (salonErr || !salons) return { salons: [], count: 0 };

    const validSalons = salons.filter((s: any) => !s.deleted_at);
    return { salons: validSalons, count: validSalons.length };
  } catch (err) {
    console.warn('[fetchUserOwnedSalons] Error:', err);
    return { salons: [], count: 0 };
  }
}

export async function validateSiteOwnership(
  client: any = supabase,
  userId: string,
  targetSiteId: string
): Promise<{ isValid: boolean; salon: any | null }> {
  if (!targetSiteId || !userId) return { isValid: false, salon: null };
  const { salons } = await fetchUserOwnedSalons(client, userId);
  const match = salons.find(
    (s: any) =>
      String(s.id) === String(targetSiteId) ||
      String(s.slug) === String(targetSiteId) ||
      String(s.subdomain) === String(targetSiteId)
  );
  if (match) {
    return { isValid: true, salon: match };
  }
  return { isValid: false, salon: null };
}
