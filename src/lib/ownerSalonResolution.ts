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
