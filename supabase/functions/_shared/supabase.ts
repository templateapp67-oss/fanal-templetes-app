// Supabase client factory for Edge Functions (Deno).
// Uses the project vars that Supabase injects automatically:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Client for the caller (honours RLS). Use for public/owner-scoped reads. */
export function callerClient(req: Request) {
  const auth = req.headers.get("Authorization");
  return createClient(url, anonKey, {
    global: { headers: auth ? { Authorization: auth } : {} },
  });
}

/** Service-role client (bypasses RLS). ONLY for trusted server-side writes. */
export function adminClient() {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
