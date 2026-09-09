import { createClient } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';

export async function readPartnerProfile(expectedOwnerId?: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.access_token) throw new Error('Your login session is missing. Close this window and sign in again.');
  const verified = await supabase.auth.getUser(session.access_token);
  if (verified.error || !verified.data.user) throw new Error('Your login session has expired. Please sign in again.');
  if (expectedOwnerId && verified.data.user.id !== expectedOwnerId) throw new Error('The active account changed. Reload before editing this profile.');
  // Bind this request explicitly to the verified bearer token. Do not allow
  // a default/guest client or later auth transition to change the request role.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  const result = await client.rpc('get_partner_profile');
  if (result.error) throw new Error(`Profile load failed (${result.error.code || 'database'}): ${result.error.message}`);
  return result;
}
