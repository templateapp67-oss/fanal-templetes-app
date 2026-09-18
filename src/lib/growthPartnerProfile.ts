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
export interface PartnerAccountSettings {
  agency_name: string; whatsapp_phone: string | null; city: string; state: string; public_bio: string;
  payout_method: 'upi' | 'bank_transfer' | 'paypal' | null; payout_account_name: string | null; payout_account_number: string | null; payout_ifsc: string | null; payout_upi_id: string | null;
}
/** Structural interface keeps Auth and Storage paths testable without privileged keys. */
export interface GrowthPartnerProfileClient {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
  auth: {
    getUser: () => Promise<{ data: { user: any }; error: any }>;
    updateUser: (attributes: { email: string }, options?: { emailRedirectTo?: string }) => Promise<{ data: any; error: any }>;
  };
  storage: { from: (bucket: string) => {
    upload: (path: string, file: Blob, options: Record<string, unknown>) => Promise<{ error: any }>;
    remove: (paths: string[]) => Promise<{ error: any }>;
    getPublicUrl: (path: string) => { data: { publicUrl: string } };
  } };
}
const defaultClient = supabase as unknown as GrowthPartnerProfileClient;

export async function fetchGrowthPartnerProfile(client: GrowthPartnerProfileClient = defaultClient): Promise<GrowthPartnerProfileData> {
  const { data, error } = await client.rpc('get_my_growth_partner_profile');
  if (error || !data) throw new Error(safePartnerErrorMessage(error, 'Could not load your partner profile. Please retry.'));
  return data as GrowthPartnerProfileData;
}
export async function fetchPartnerAccountSettings(client: GrowthPartnerProfileClient = defaultClient): Promise<PartnerAccountSettings> {
  const { data, error } = await client.rpc('get_my_partner_account_settings');
  if (error || !data) throw new Error(safePartnerErrorMessage(error, 'Could not load account settings.'));
  return data as PartnerAccountSettings;
}
export async function savePartnerAccountSettings(patch: Partial<PartnerAccountSettings>, client: GrowthPartnerProfileClient = defaultClient): Promise<PartnerAccountSettings> {
  const { data, error } = await client.rpc('save_my_partner_account_settings', { p_patch: patch });
  if (error || !data) throw new Error(safePartnerErrorMessage(error, 'Could not save account settings.'));
  return data as PartnerAccountSettings;
}
export function growthPartnerPhotoUrl(path: string | null, client: GrowthPartnerProfileClient = defaultClient): string {
  if (!path || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(path)) return '';
  return client.storage.from('partner-avatars').getPublicUrl(path).data.publicUrl;
}

export async function saveGrowthPartnerProfile(input: {
  fullName: string; phone: string; expectedUserId: string; photo?: Blob | null; removePhoto?: boolean;
}, client: GrowthPartnerProfileClient = defaultClient): Promise<GrowthPartnerProfileData> {
  const fullName = input.fullName.trim();
  const phone = input.phone.replace(/[\s().-]/g, '');
  if (!fullName || fullName.length > 120 || /[\x00-\x1f\x7f]/.test(fullName)) throw new Error('Enter a full name of 1–120 characters.');
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) throw new Error('Enter a phone number with 7–15 digits.');
  if (input.photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(input.photo.type) || input.photo.size > 5 * 1024 * 1024)) throw new Error('Choose a JPG, PNG or WebP image no larger than 5 MB.');
  const verifyViewer = async () => {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || data.user.id !== input.expectedUserId) throw new Error('Your session changed. Reload your profile before saving.');
    return data.user.id as string;
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
    if (error || !data) throw new Error(safePartnerErrorMessage(error, 'Could not save your partner profile. Please retry.'));
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

/** Auth, never profiles.email: Supabase owns identity verification and confirmation. */
export async function requestGrowthPartnerEmailChange(email: string, expectedUserId: string, client: GrowthPartnerProfileClient = defaultClient): Promise<void> {
  const value = email.trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== expectedUserId) throw new Error('Your session changed. Reload your profile before continuing.');
  if (data.user?.email?.toLowerCase() === value.toLowerCase()) throw new Error('Enter a different email address.');
  const result = await client.auth.updateUser({ email: value }, {
    emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/partner/profile` : undefined,
  });
  if (result.error) {
    if (result.error.status === 501 || /live Supabase Auth/.test(result.error.message || '')) throw new Error('Email changes require a live Supabase Auth connection.');
    throw new Error('Could not request an email change. Sign in again and retry.');
  }
}
