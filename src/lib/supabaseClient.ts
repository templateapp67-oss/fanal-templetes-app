import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Read env vars safely in both Vite (client) and Node.js (server).
// The browser build only ever gets the *anon* key; the service-role key is
// read exclusively in the Node server/Edge Functions and is NEVER bundled.
// ---------------------------------------------------------------------------
const env = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
const nodeEnv = typeof process !== 'undefined' ? (process.env ?? {}) : {};

export const SUPABASE_URL: string =
  env.VITE_SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL || nodeEnv.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY: string =
  env.VITE_SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY || nodeEnv.SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY: string =
  nodeEnv.SUPABASE_SERVICE_ROLE_KEY || nodeEnv.SUPABASE_SERVICE_KEY || '';

const isRealSupabase =
  !!SUPABASE_URL &&
  SUPABASE_URL.trim() !== '' &&
  !SUPABASE_URL.includes('placeholder');

export const isMockSupabase = !isRealSupabase;

// Public (anon) client — used by the browser for auth + owner-scoped queries.
// RLS policies scoped to auth.uid() protect the data.
export const supabase: SupabaseClient = createClient(
  isRealSupabase ? SUPABASE_URL : 'https://placeholder-project.supabase.co',
  isRealSupabase ? SUPABASE_ANON_KEY : 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

// Server-side admin (service role) client — bypasses RLS. Only created in the
// Node server, never in the browser bundle, so the secret never ships to the
// client.
export function getSupabaseAdmin(): SupabaseClient | null {
  if (typeof process === 'undefined') return null; // browser
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Convenience singleton for the Express server (server.ts).
export const supabaseAdmin = getSupabaseAdmin();

if (isMockSupabase && typeof console !== 'undefined') {
  console.warn(
    'Supabase keys are missing or using placeholders. App will run in mock mode with limited persistence.'
  );
}
