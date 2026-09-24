import { createClient } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';

/** What `get_partner_profile()` returns (every field optional: the RPC builds
 *  the payload from whichever columns the deployed schema carries). */
export type PartnerProfileDetails = {
  name?: string | null;
  whatsapp?: string | null;
  postal?: string | null;
  city?: string | null;
  avatar?: string | null;
  dob?: string | null;
  area?: string | null;
  notifications?: boolean | null;
};

/**
 * The area's canonical call result: `{ ok: true, data }` or `{ ok: false,
 * error }` with REVIEWED copy. The database's own message is logged (that is
 * what makes a failure diagnosable) but never returned to a screen — a
 * PostgREST string is not something a salon owner should have to read.
 */
export type PartnerProfileReadResult =
  | { ok: true; data: PartnerProfileDetails }
  | { ok: false; error: { code: string; message: string } };

const failure = (code: string, message: string): PartnerProfileReadResult => ({
  ok: false,
  error: { code, message },
});

export async function readPartnerProfile(expectedOwnerId?: string): Promise<PartnerProfileReadResult> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error(`[partner-profile] getSession failed — ${error.message}`);
    return failure('session_unavailable', 'Could not confirm your session. Close this window and sign in again.');
  }
  const session = data.session;
  if (!session?.access_token) {
    return failure('session_missing', 'Your login session is missing. Close this window and sign in again.');
  }
  const verified = await supabase.auth.getUser(session.access_token);
  if (verified.error || !verified.data.user) {
    if (verified.error) console.error(`[partner-profile] getUser failed — ${verified.error.message}`);
    return failure('session_expired', 'Your login session has expired. Please sign in again.');
  }
  if (expectedOwnerId && verified.data.user.id !== expectedOwnerId) {
    return failure('account_changed', 'The active account changed. Reload before editing this profile.');
  }
  // Bind this request explicitly to the verified bearer token. Do not allow
  // a default/guest client or later auth transition to change the request role.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  const result = await client.rpc('get_partner_profile');
  if (result.error) {
    // Real cause in the logs (PGRST202 when the migration is missing, 42501 for
    // RLS, 42P01 for a missing legacy table…), reviewed copy on the screen.
    console.error(
      `[partner-profile] get_partner_profile failed — ${result.error.code || 'database'}: ${result.error.message}`
    );
    return failure(
      result.error.code || 'database',
      'Could not load your saved profile details. You can still edit and save below.'
    );
  }
  return { ok: true, data: (result.data ?? {}) as PartnerProfileDetails };
}
