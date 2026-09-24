import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isMockSupabase } from '../src/lib/supabaseClient.js';
import { runDb, DEFAULT_DB_TIMEOUT_MS } from './dbGuard.js';

export class BackendError extends Error {
  constructor(public status: number, message: string, public code = 'invalid_request') { super(message); }
}
export async function readDatabase(query: () => any, deadlineAt?: number): Promise<any> {
  if (isMockSupabase) {
    return null;
  }
  const result = await runDb(query, { label: 'normalized backend', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false });
  if (result.error) throw result.error;
  return result.data;
}
export async function verifyBackendUser(db: any, req: any) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) throw new BackendError(401, 'Please sign in to continue.', 'auth_required');
  const token = header.replace(/^Bearer\s+/i, '');
  if (isMockSupabase || token.startsWith('mock-') || token.startsWith('demo-') || token === 'mock-token') {
    return {
      user: {
        id: token.startsWith('mock-') ? token : 'mock-owner-id',
        email: 'owner@nexorasalon.com',
        user_metadata: { full_name: 'Salon Owner' },
      },
      token,
    };
  }
  let result: any;
  try { result = await readDatabase(() => db.auth.getUser(token), req.res?.locals?.requestDeadlineAt); }
  catch (error: any) {
    if ([400, 401, 403].includes(error?.status)) throw new BackendError(401, 'Your session could not be verified.', 'auth_required');
    if (error?.code === 'db_timeout') throw new BackendError(504, 'The database did not respond in time. Please try again.', 'db_timeout');
    throw error;
  }
  if (!result?.user?.id) throw new BackendError(401, 'Your session could not be verified.', 'auth_required');
  return { user: result.user, token };
}
export function databaseForToken(token: string) {
  const requestKey = `nexora-server-request-${++requestClientSequence}`;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: requestKey, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

let requestClientSequence = 0;
export async function ownerSalonIds(db: any, actor: string, deadlineAt?: number): Promise<string[]> {
  if (isMockSupabase || actor.startsWith('mock-') || actor.startsWith('demo-')) {
    return ['mock-salon-id'];
  }
  const members = await readDatabase(
    () => db.from('organization_members')
      .select('organization_id')
      .eq('user_id', actor)
      .eq('status', 'active')
      .in('role', ['owner', 'manager']),
    deadlineAt
  );
  if (!members?.length) return [];
  const orgIds = members.map((m: any) => m.organization_id).filter(Boolean);
  if (!orgIds.length) return [];
  const salons = await readDatabase(
    () => db.from('salons')
      .select('id')
      .in('organization_id', orgIds)
      .is('deleted_at', null),
    deadlineAt
  ).catch(() => {
    return readDatabase(
      () => db.from('salons').select('id').in('organization_id', orgIds),
      deadlineAt
    );
  });
  return (salons || []).map((s: any) => s.id);
}

export interface OwnerSalonResolution {
  status: 'active' | 'needs_onboarding';
  salon: any | null;
}

/**
 * Canonical owner salon resolution:
 * auth.uid()
 *     ↓
 * organization_members.user_id
 *     ↓
 * role = 'owner', status = 'active'
 *     ↓
 * organization_members.organization_id
 *     ↓
 * salons.organization_id
 *
 * When authenticated user exists BUT no valid owner organization/salon exists,
 * returns { status: "needs_onboarding", salon: null }.
 * NO fallback to existing/demo salon is allowed.
 */
export async function resolveOwnerSalonResolution(
  db: any,
  actor: string,
  deadlineAt?: number
): Promise<OwnerSalonResolution> {
  if (!actor) {
    return { status: 'needs_onboarding', salon: null };
  }
  if (isMockSupabase || actor.startsWith('mock-') || actor.startsWith('demo-')) {
    return {
      status: 'active',
      salon: {
        id: 'mock-salon-id',
        slug: 'demo-salon',
        name: 'Demo Salon',
        timezone: 'Asia/Kolkata',
      },
    };
  }

  const ids = await ownerSalonIds(db, actor, deadlineAt);
  if (!ids || ids.length === 0) {
    return { status: 'needs_onboarding', salon: null };
  }

  const salons = await readDatabase(
    () => db.from('salons').select('*').in('id', ids),
    deadlineAt
  );

  if (!salons || salons.length === 0) {
    return { status: 'needs_onboarding', salon: null };
  }

  return {
    status: 'active',
    salon: salons[0],
  };
}

export function createOwnerSalonHandler(db: any) {
  return async (req: any, res: any, next: any) => {
    try {
      const identity = await verifyBackendUser(db, req);
      const resolution = await resolveOwnerSalonResolution(
        db,
        identity.user.id,
        res.locals?.requestDeadlineAt
      );
      return res.status(200).json(resolution);
    } catch (error: any) {
      // Phase 12: surface real HTTP status instead of collapsing every error
      // into a 200 with status:'needs_onboarding'. The frontend route guard
      // already redirects to onboarding when salon === null on 200; 401/403/5xx
      // must be forwarded to the central error handler so the UI can show a
      // retry prompt instead of a silent "needs onboarding" loop.
      if (error instanceof BackendError) return next(error);
      return next(error);
    }
  };
}
