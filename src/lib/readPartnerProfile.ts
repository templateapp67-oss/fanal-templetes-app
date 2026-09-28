import { createClient } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';

export interface ProfileSettingsValues {
  ownerName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  postalCode?: string | null;
  city?: string | null;
  areaLocality?: string | null;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  landmark?: string | null;
  dob?: string | null;
  avatar?: string | null;
  ownerPhotoUrl?: string | null;
  notifications?: boolean;
  whatsappNotificationsEnabled?: boolean;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  }
  return '';
}

function dateInputValue(...values: unknown[]): string {
  const value = firstText(...values);
  return value ? value.slice(0, 10) : '';
}

/** Prefer a real saved name, but replace generic placeholders with Auth metadata. */
export function resolveOwnerProfileName(profileName?: string | null, fallbackName?: string | null): string {
  const stored = typeof profileName === 'string' ? profileName.trim() : '';
  const fallback = typeof fallbackName === 'string' ? fallbackName.trim() : '';
  const genericNames = new Set(['user', 'owner', 'salon owner', 'unknown']);
  if (stored && !genericNames.has(stored.toLowerCase())) return stored;
  return fallback || stored;
}

/**
 * Profiles has acquired a few historical column spellings over time. Return
 * the raw row as well as one consistent camelCase view so both the editor and
 * older website autofill callers can consume the same authenticated read.
 */
export function mapProfileSettingsRow(row: Record<string, any> | null | undefined) {
  if (!row) return null;

  const ownerName = firstText(row.full_name, row.ownerName, row.owner_name);
  const phone = firstText(row.phone_number, row.phone, row.mobile);
  const whatsapp = firstText(row.whatsapp_number, row.whatsapp);
  const postalCode = firstText(row.pin_code, row.postal_code, row.pincode, row.postalCode);
  const city = firstText(row.city, row.preferred_city);
  const area = firstText(row.area, row.locality, row.preferred_area, row.areaLocality);
  const email = firstText(row.contact_email, row.email);
  const address = firstText(row.address, row.full_address);
  const state = firstText(row.state);
  const landmark = firstText(row.landmark);
  const dob = dateInputValue(row.dob, row.date_of_birth);
  const avatar = firstText(row.avatar_url, row.owner_photo_url, row.photo_url, row.avatar);
  const notifications = typeof row.whatsapp_notifications_enabled === 'boolean'
    ? row.whatsapp_notifications_enabled
    : typeof row.notifications === 'boolean'
      ? row.notifications
      : undefined;

  return {
    ...row,
    id: row.id,
    ownerId: row.id,
    ownerName,
    name: ownerName,
    phone,
    whatsapp,
    postalCode,
    postal: postalCode,
    city,
    area,
    areaLocality: area,
    email,
    address,
    state,
    landmark,
    dob,
    avatar,
    notifications,
    whatsappNotificationsEnabled: notifications,
  };
}

/**
 * Make every request with the currently verified Auth user's bearer token.
 * Never trust a cached user id from app state as authority for profile access.
 */
async function authenticatedProfileClient(expectedOwnerId?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.access_token) {
    throw new Error('Your login session is missing. Close this window and sign in again.');
  }

  const verified = await supabase.auth.getUser(session.access_token);
  const user = verified.data.user;
  if (verified.error || !user) {
    throw new Error('Your login session has expired. Please sign in again.');
  }
  if (expectedOwnerId && user.id !== expectedOwnerId) {
    throw new Error('The active account changed. Reload before editing this profile.');
  }

  // Bind the REST request to the same verified JWT as the identity check.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  return { client, user };
}

/** Read the current owner's latest database profile row. */
export async function readPartnerProfile(expectedOwnerId?: string) {
  const { client, user } = await authenticatedProfileClient(expectedOwnerId);
  const result = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (result.error) {
    return {
      data: null,
      error: new Error(`Profile load failed (${result.error.code || 'database'}): ${result.error.message}`),
    };
  }

  return { data: mapProfileSettingsRow(result.data), error: null };
}

/** Build a partial upsert while leaving fields not present in the form intact. */
export function buildProfileSettingsUpsert(ownerId: string, values: ProfileSettingsValues) {
  const row: Record<string, unknown> = {
    id: ownerId,
    updated_at: new Date().toISOString(),
  };
  const has = (key: keyof ProfileSettingsValues) => Object.prototype.hasOwnProperty.call(values, key);

  if (has('ownerName')) row.full_name = values.ownerName;
  if (has('phone')) {
    row.phone_number = values.phone;
    row.phone = values.phone;
    row.mobile = values.phone;
  }
  if (has('whatsapp')) {
    row.whatsapp_number = values.whatsapp;
    row.whatsapp = values.whatsapp;
  }
  if (has('dob')) {
    row.dob = values.dob;
    row.date_of_birth = values.dob;
  }
  if (has('postalCode')) {
    row.pin_code = values.postalCode;
    row.postal_code = values.postalCode;
    row.pincode = values.postalCode;
  }
  if (has('city')) {
    row.city = values.city;
    row.preferred_city = values.city;
  }
  if (has('areaLocality')) {
    row.area = values.areaLocality;
    row.preferred_area = values.areaLocality;
  }
  if (has('email')) {
    row.contact_email = values.email;
    row.email = values.email;
  }
  if (has('address')) {
    row.address = values.address;
    row.full_address = values.address;
  }
  if (has('state')) row.state = values.state;
  if (has('landmark')) row.landmark = values.landmark;
  if (has('avatar') || has('ownerPhotoUrl')) {
    const avatar = has('avatar') ? values.avatar : values.ownerPhotoUrl;
    row.avatar_url = avatar;
    row.owner_photo_url = avatar;
    row.photo_url = avatar;
  }
  if (has('notifications') || has('whatsappNotificationsEnabled')) {
    row.whatsapp_notifications_enabled = has('whatsappNotificationsEnabled')
      ? values.whatsappNotificationsEnabled
      : values.notifications;
  }

  return row;
}

/**
 * Persist the caller's profile using an owner-keyed upsert. RLS and the unique
 * profiles.id key are the final authority; a write without an authenticated
 * matching user is rejected rather than treated as a local success.
 */
export async function savePartnerProfileSettings(ownerId: string | undefined, values: ProfileSettingsValues) {
  const { client, user } = await authenticatedProfileClient(ownerId);
  const payload = buildProfileSettingsUpsert(user.id, values);
  const { data, error } = await client
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Profile save failed (${error.code || 'database'}): ${error.message}`);
  }
  if (!data || data.id !== user.id) {
    throw new Error('Supabase did not confirm the saved profile. Please retry.');
  }

  return mapProfileSettingsRow(data);
}
