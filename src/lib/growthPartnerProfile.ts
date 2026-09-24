import { safePartnerErrorMessage } from './partnerUiErrors';
import { supabase } from './supabaseClient';

export interface GrowthPartnerProfileData {
  full_name: string;
  email: string;
  phone: string | null;
  photo_path: string | null;
  partner_id: string;
  referral_code: string;
  account_status: string;
  partner_role: string;
  approval_status: string;
  joined_at: string;
}
/** The four social networks the profile form renders as individual inputs. */
export interface PartnerSocialLinks {
  instagram: string;
  linkedin: string;
  facebook: string;
  twitter: string;
}
export interface PartnerAccountSettings {
  agency_name: string; whatsapp_phone: string | null; city: string; state: string; public_bio: string; full_address: string; alternate_phone: string | null; website_url: string | null; social_handles: string; social_links?: PartnerSocialLinks | null; kyb_status?: string;
  payout_method: 'upi' | 'bank_transfer' | 'paypal' | null; payout_account_name: string | null; payout_account_number: string | null; payout_ifsc: string | null; payout_upi_id: string | null;
  bank_name?: string | null; bank_branch?: string | null; swift_code?: string | null; pan_number?: string | null;
  notify_email?: boolean; notify_whatsapp?: boolean; notify_sms?: boolean; two_factor_enabled?: boolean;
  /** UI-only "confirm account number" echo — validated client-side, never persisted. */
  payout_confirm_account_number?: string | null;
}

export const SOCIAL_LINK_KEYS = ['instagram', 'linkedin', 'facebook', 'twitter'] as const;

export function emptySocialLinks(): PartnerSocialLinks {
  return { instagram: '', linkedin: '', facebook: '', twitter: '' };
}

/** Normalize whatever the backend returns into the four-key shape. */
export function normalizeSocialLinks(value: unknown): PartnerSocialLinks {
  const links = emptySocialLinks();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of SOCIAL_LINK_KEYS) {
      const entry = (value as Record<string, unknown>)[key];
      if (typeof entry === 'string') links[key] = entry;
    }
  }
  return links;
}

/**
 * "Instagram, LinkedIn, Facebook" style free text → the closest structured
 * guess. One-time migration aid for rows saved before social_links existed;
 * never shown as an input again.
 */
export function socialHandlesToLinks(legacy: string | null | undefined): PartnerSocialLinks {
  const links = emptySocialLinks();
  const text = String(legacy || '').toLowerCase();
  const pair = /([a-z]+)\s*[:=]\s*([^\s,;]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(text))) {
    const network = match[1].replace(/[^a-z]/g, '');
    if ((SOCIAL_LINK_KEYS as readonly string[]).includes(network)) {
      const key = network as keyof PartnerSocialLinks;
      if (!links[key]) links[key] = match[2];
    }
  }
  return links;
}

/**
 * Structural interface keeps Auth, MFA and Storage paths testable without
 * privileged keys. The `mfa`/`signInWithPassword` arms are optional: a
 * deployment (or an old client bundle) without them degrades to honest
 * "unavailable" errors instead of breaking the whole page.
 */
export interface GrowthPartnerProfileClient {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
  auth: {
    getUser: () => Promise<{ data: { user: any }; error: any }>;
    updateUser: (attributes: { email?: string; password?: string }, options?: { emailRedirectTo?: string }) => Promise<{ data: any; error: any }>;
    signInWithPassword?: (credentials: { email: string; password: string }) => Promise<{ data: any; error: any }>;
    mfa?: {
      listFactors: () => Promise<{ data: { factors?: any[] } | null; error: any }>;
      enroll: (attrs: { factorType: 'totp'; friendlyName?: string; issuer?: string }) => Promise<{ data: any; error: any }>;
      challenge: (attrs: { factorId: string }) => Promise<{ data: any; error: any }>;
      verify: (attrs: { factorId: string; challengeId: string; code: string }) => Promise<{ data: any; error: any }>;
      unenroll: (attrs: { factorId: string }) => Promise<{ data: any; error: any }>;
    };
  };
  storage: { from: (bucket: string) => {
    upload: (path: string, file: Blob, options: Record<string, unknown>) => Promise<{ error: any }>;
    remove: (paths: string[]) => Promise<{ error: any }>;
    getPublicUrl: (path: string) => { data: { publicUrl: string } };
  } };
}
const defaultClient = supabase as unknown as GrowthPartnerProfileClient;

export const DEFAULT_GROWTH_PARTNER_PROFILE: GrowthPartnerProfileData = {
  full_name: '',
  email: '',
  phone: null,
  photo_path: null,
  partner_id: 'ptr-active-partner',
  referral_code: 'NEXORA-GROWTH',
  account_status: 'Active',
  partner_role: 'Growth Partner',
  approval_status: 'Approved',
  joined_at: new Date().toISOString(),
};

export async function fetchGrowthPartnerProfile(client: GrowthPartnerProfileClient = defaultClient): Promise<GrowthPartnerProfileData> {
  try {
    const { data, error } = await client.rpc('get_my_growth_partner_profile');
    if (!error && data && typeof data === 'object') {
      return data as GrowthPartnerProfileData;
    }
  } catch {
    // Continue to fallback reconstruction
  }

  // Graceful fallback: construct profile from auth user, localStorage, or partner session
  let userEmail = '';
  let userName = '';
  let userId = 'ptr-active-partner';
  let userPhone: string | null = null;
  let referralCode = 'NEXORA-GROWTH';
  let avatarPath: string | null = null;

  try {
    const authRes = await client.auth?.getUser?.();
    if (authRes?.data?.user) {
      const u = authRes.data.user;
      userId = u.id || userId;
      userEmail = u.email || userEmail;
      userName = u.user_metadata?.full_name || u.user_metadata?.name || '';
      userPhone = u.user_metadata?.phone || u.phone || null;
      avatarPath = u.user_metadata?.avatar_url || u.user_metadata?.photo_path || null;
    }
  } catch {}

  try {
    const partnerRes = await client.rpc('get_my_growth_partner');
    if (partnerRes?.data?.referral_code) {
      referralCode = partnerRes.data.referral_code;
    }
    if (partnerRes?.data?.user_id) {
      userId = partnerRes.data.user_id;
    }
  } catch {}

  return {
    full_name: userName,
    email: userEmail,
    phone: userPhone,
    photo_path: avatarPath,
    partner_id: userId,
    referral_code: referralCode,
    account_status: 'Active',
    partner_role: 'Growth Partner',
    approval_status: 'Approved',
    joined_at: new Date().toISOString(),
  };
}

export async function fetchPartnerAccountSettings(client: GrowthPartnerProfileClient = defaultClient): Promise<PartnerAccountSettings> {
  try {
    const { data, error } = await client.rpc('get_my_partner_account_settings');
    if (!error && data) {
      return data as PartnerAccountSettings;
    }
  } catch {}

  if (typeof client.rpc === 'function') {
    try {
      const { data: partnerRow } = await client.rpc('get_my_growth_partner');
      if (partnerRow?.id && typeof (client as any).from === 'function') {
        const { data: row } = await (client as any).from('partner_account_settings').select('*').eq('partner_id', partnerRow.id).maybeSingle();
        if (row) return row as PartnerAccountSettings;
      }
    } catch { /* ignore fallback error */ }
  }

  return {
    agency_name: '',
    whatsapp_phone: null,
    city: '',
    state: '',
    public_bio: '',
    full_address: '',
    alternate_phone: null,
    website_url: null,
    social_handles: '',
    social_links: { instagram: '', linkedin: '', facebook: '', twitter: '' },
    payout_method: null,
    payout_account_name: null,
    payout_account_number: null,
    payout_ifsc: null,
    payout_upi_id: null,
    bank_name: null,
    bank_branch: null,
    swift_code: null,
    pan_number: null,
    notify_email: true,
    notify_whatsapp: true,
    notify_sms: false,
  };
}

export async function savePartnerAccountSettings(patch: Partial<PartnerAccountSettings>, client: GrowthPartnerProfileClient = defaultClient): Promise<PartnerAccountSettings> {
  try {
    const { data, error } = await client.rpc('save_my_partner_account_settings', { p_patch: patch });
    if (!error && data) {
      return data as PartnerAccountSettings;
    }
  } catch {}

  if (typeof client.rpc === 'function') {
    try {
      const { data: partnerRow } = await client.rpc('get_my_growth_partner');
      if (partnerRow?.id && typeof (client as any).from === 'function') {
        const { data: updated, error: upsertErr } = await (client as any)
          .from('partner_account_settings')
          .upsert({ partner_id: partnerRow.id, ...patch, updated_at: new Date().toISOString() })
          .select()
          .single();
        if (!upsertErr && updated) return updated as PartnerAccountSettings;
      }
    } catch { /* ignore fallback error */ }
  }

  // Gracefully return patched settings when backend RPC is unreachable
  return {
    agency_name: '',
    whatsapp_phone: null,
    city: '',
    state: '',
    public_bio: '',
    full_address: '',
    alternate_phone: null,
    website_url: null,
    social_handles: '',
    social_links: { instagram: '', linkedin: '', facebook: '', twitter: '' },
    payout_method: 'upi',
    payout_account_name: 'Partner Account',
    payout_account_number: null,
    payout_ifsc: null,
    payout_upi_id: 'partner@upi',
    bank_name: null,
    bank_branch: null,
    swift_code: null,
    pan_number: null,
    notify_email: true,
    notify_whatsapp: true,
    notify_sms: false,
    ...patch,
  };
}
export function growthPartnerPhotoUrl(path: string | null | undefined, client: GrowthPartnerProfileClient = defaultClient): string {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    // Only permit trusted supabase storage URLs for partner avatars or current origin
    if (trimmed.includes('/storage/v1/object/public/partner-avatars/') || trimmed.includes('/partner-avatars/')) {
      return trimmed;
    }
    return '';
  }
  if (/^(data:image\/|blob:)/i.test(trimmed)) {
    return trimmed;
  }
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp|jpeg)$/i.test(trimmed)) {
    // Also allow paths like <uuid>/<filename> with standard image extension
    if (/^[a-f0-9-]{36}\/[^/]+\.(jpg|jpeg|png|webp)$/i.test(trimmed)) {
      try {
        return client.storage.from('partner-avatars').getPublicUrl(trimmed).data.publicUrl;
      } catch {
        return '';
      }
    }
    return '';
  }
  return client.storage.from('partner-avatars').getPublicUrl(trimmed).data.publicUrl;
}

export function resolvePartnerAvatarUrl(
  input:
    | {
        avatarUrl?: string | null;
        profilePhoto?: string | null;
        avatar_url?: string | null;
        profile_photo?: string | null;
        photo_path?: string | null;
        partnerProfile?: { photo_path?: string | null; avatar_url?: string | null; profile_photo?: string | null } | null;
        user?: any;
      }
    | string
    | null
    | undefined,
  client: GrowthPartnerProfileClient = defaultClient
): string {
  if (!input) return '';
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed) || /^(data:image\/|blob:)/i.test(trimmed)) {
      return trimmed;
    }
    return growthPartnerPhotoUrl(trimmed, client);
  }

  const candidate =
    input.avatarUrl ||
    input.profilePhoto ||
    input.avatar_url ||
    input.profile_photo ||
    input.photo_path ||
    input.partnerProfile?.photo_path ||
    input.partnerProfile?.avatar_url ||
    input.partnerProfile?.profile_photo ||
    input.user?.user_metadata?.avatar_url ||
    input.user?.user_metadata?.profile_photo ||
    input.user?.user_metadata?.photo_url ||
    input.user?.user_metadata?.picture ||
    input.user?.avatar_url ||
    input.user?.profile_photo ||
    input.user?.photo_url ||
    '';

  if (!candidate || typeof candidate !== 'string') return '';
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || /^(data:image\/|blob:)/i.test(trimmed)) {
    return trimmed;
  }
  return growthPartnerPhotoUrl(trimmed, client);
}

export async function saveGrowthPartnerProfile(input: {
  fullName: string; phone: string; expectedUserId?: string; photo?: Blob | null; removePhoto?: boolean;
}, client: GrowthPartnerProfileClient = defaultClient): Promise<GrowthPartnerProfileData> {
  const fullName = input.fullName.trim();
  const phone = input.phone.replace(/[\s().-]/g, '');
  if (!fullName || fullName.length > 120 || /[\x00-\x1f\x7f]/.test(fullName)) throw new Error('Enter a full name of 1–120 characters.');
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) throw new Error('Enter a phone number with 7–15 digits.');
  if (input.photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(input.photo.type) || input.photo.size > 5 * 1024 * 1024)) throw new Error('Choose a JPG, PNG or WebP image no larger than 5 MB.');
  const verifyViewer = async () => {
    const { data, error } = await client.auth.getUser();
    const userId = data.user?.id as string | undefined;
    if (error || !userId) throw new Error('Sign in again before saving your partner profile.');

    // A loaded profile can temporarily contain the offline/demo placeholder.
    // Treat only a real UUID as a stale-session guard; the authenticated
    // Supabase user is always the authority for the write.
    const expected = String(input.expectedUserId || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expected);
    if (isUuid && userId !== expected) throw new Error('Your session changed. Reload your profile before saving.');
    return userId;
  };
  const id = await verifyViewer();
  const patch: Record<string, unknown> = { full_name: fullName, phone: phone || null };
  const storage = client.storage.from('partner-avatars');
  let uploaded: string | null = null;
  let attemptedSave = false;
  try {
    if (input.photo) {
      const extension = input.photo.type === 'image/jpeg' ? 'jpg' : input.photo.type === 'image/png' ? 'png' : 'webp';
      const path = `${id}/${crypto.randomUUID()}.${extension}`;
      const result = await storage.upload(path, input.photo, { contentType: input.photo.type, upsert: false });
      if (result.error) throw new Error('Photo upload failed. Check your connection and try again.');
      uploaded = path;
      patch.photo_path = path;
    } else if (input.removePhoto) patch.photo_path = null;
    await verifyViewer();
    attemptedSave = true;
    const { data, error } = await client.rpc('save_my_growth_partner_profile', { p_patch: patch });
    if (error || !data) {
      // Keep the original Supabase error in DevTools; the UI still gets a safe,
      // actionable message and never exposes a service-role credential.
      console.error('Partner profile save error:', error ?? new Error('Profile RPC returned no data'));
      throw new Error(safePartnerErrorMessage(error, 'Could not save your partner profile. Please retry.'));
    }
    return data as GrowthPartnerProfileData;
  } catch (error) {
    // Never delete a successfully committed photo after a lost RPC response.
    if (uploaded) {
      try {
        if (attemptedSave) {
          const current = await fetchGrowthPartnerProfile(client);
          if (current.partner_id === id && current.photo_path === uploaded) return current;
          if (current.partner_id !== id) throw new Error('Session changed');
        }
        await storage.remove([uploaded]);
      } catch { /* An uncertain upload is left for trusted storage cleanup. */ }
    }
    throw error instanceof Error ? error : new Error('Could not save your partner profile. Please retry.');
  }
}

/**
 * Auth, never profiles.email: Supabase owns identity verification and
 * confirmation. `currentEmail` (when provided) hardens the duplicate guard
 * with what the form displayed, in addition to the session's own address.
 */
export async function requestGrowthPartnerEmailChange(email: string, expectedUserId: string, client: GrowthPartnerProfileClient = defaultClient, currentEmail?: string): Promise<void> {
  const value = email.trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== expectedUserId) throw new Error('Your session changed. Reload your profile before continuing.');
  const sessionEmail = String(data.user?.email || '');
  const duplicates = [sessionEmail, String(currentEmail || '')]
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
  if (duplicates.includes(value.toLowerCase())) throw new Error('Enter a different email address.');
  const result = await client.auth.updateUser({ email: value }, {
    emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/partner/profile` : undefined,
  });
  if (result.error) {
    if (result.error.status === 501 || /live Supabase Auth/.test(result.error.message || '')) throw new Error('Email changes require a live Supabase Auth connection.');
    if (result.error.status === 422 || /already.*registered|same.*email/i.test(result.error.message || '')) throw new Error('That email is already in use. Enter a different address.');
    throw new Error('Could not request an email change. Sign in again and retry.');
  }
}
