import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/lib/supabaseClient.js';
import { runDb, DEFAULT_DB_TIMEOUT_MS } from './dbGuard.js';

export class BackendError extends Error {
  constructor(public status: number, message: string, public code = 'invalid_request') { super(message); }
}
export async function readDatabase(query: () => any, deadlineAt?: number): Promise<any> {
  const result = await runDb(query, { label: 'normalized backend', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });
  if (result.error) throw result.error;
  return result.data;
}
export async function verifyBackendUser(db: any, req: any) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) throw new BackendError(401, 'Please sign in to continue.', 'auth_required');
  const token = header.replace(/^Bearer\s+/i, '');
  let result: any;
  try { result = await readDatabase(() => db.auth.getUser(token), req.res?.locals?.requestDeadlineAt); }
  catch (error: any) {
    if ([400, 401, 403].includes(error?.status)) throw new BackendError(401, 'Your session could not be verified.', 'auth_required');
    throw error;
  }
  if (!result?.user?.id) throw new BackendError(401, 'Your session could not be verified.', 'auth_required');
  return { user: result.user, token };
}
export function databaseForToken(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
export async function ownerSalonIds(db: any, actor: string, deadlineAt?: number): Promise<string[]> {
  const members = await readDatabase(() => db.from('organization_members').select('organization_id')
    .eq('user_id', actor).eq('status', 'active').in('role', ['owner', 'manager', 'receptionist']), deadlineAt);
  if (!members?.length) return [];
  const salons = await readDatabase(() => db.from('salons').select('id').in('organization_id', members.map((m: any) => m.organization_id)), deadlineAt);
  return (salons || []).map((s: any) => s.id);
}
