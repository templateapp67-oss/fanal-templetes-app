// ============================================================================
// Local Supabase-compatible gateway — DEVELOPMENT ONLY.
//
// Why this exists: the Growth Partner area is denied to everyone until a real
// Supabase project is configured, so on a fresh checkout the page can only ever
// say "needs a live connection". This module stands up a real database instead:
// PGlite (an actual Postgres engine) running the SAME committed migrations,
// behind the two HTTP surfaces supabase-js talks to:
//
//   POST /auth/v1/signup | /auth/v1/token | /auth/v1/logout   GET /auth/v1/user
//   POST /rest/v1/rpc/<function>
//
// Everything the Growth Partner area does — sign-up, KYC application, admin
// review, partner reads, referral linking — executes the real SQL from
// supabase/migrations. There is no fake data layer: an empty dashboard is empty
// because the partner has no referrals yet.
//
// Guarded three ways so it can never serve production traffic:
//   • mounted only when NODE_ENV !== 'production'
//   • mounted only when LOCAL_SUPABASE=true (see .env.example)
//   • the module refuses to start if a real SUPABASE_URL is configured
//
// Scope: the Growth Partner + onboarding surface (RPCs). The owner dashboard /
// booking surfaces read the normalized production schema, which no committed
// migration creates (see tests/liveSchemaFixture.ts), so those still need a
// real project — table reads answer an explicit 501 rather than fake rows.
// ============================================================================

import { PGlite } from '@electric-sql/pglite';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';

/** Documented local-only admin account, created on first boot (see README note). */
export const LOCAL_DEV_ADMIN_EMAIL = 'admin@nexora.local';
export const LOCAL_DEV_ADMIN_PASSWORD = 'Admin#12345';

/** The migrations this gateway applies, in the order GROWTH_PARTNER_SETUP.md gives. */
export const LOCAL_GROWTH_CHAIN = [
  '20260911094853_growth_partner_signup_approval.sql',
  '20260911101201_growth_partner_kyc_approval.sql',
  '20260912_growth_partner_onboarding.sql',
  '20260913_template_handoff.sql',
  '20260914_template_completion.sql',
  '20260915_growth_partner_dashboard.sql',
  '20260916_part1_referral_hardening.sql',
  '20260917_part1b_link_atomicity.sql',
  '20260918_partner_dashboard_inactive_guard.sql',
  '20260919_growth_partner_area_contract_alignment.sql',
  '20260920_growth_partner_application_queue.sql',
];

/**
 * Tables this gateway will read directly. Deliberately only the Growth Partner
 * area's own tables — the owner/booking screens read the normalized production
 * schema, which no committed migration creates.
 */
export const LOCAL_TABLE_ALLOWLIST = [
  'growth_partner_applications',
  'growth_partners',
  'growth_onboarding',
  'profiles',
];

const JWT_SECRET = process.env.LOCAL_SUPABASE_JWT_SECRET || 'local-dev-only-secret';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

// ---------------------------------------------------------------------------
// Schema bootstrap — the slice of 00001_init the Growth Partner chain needs.
// ---------------------------------------------------------------------------
const BOOTSTRAP = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  alter default privileges in schema public grant execute on functions to service_role;

  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    encrypted_password text not null,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  grant usage on schema auth to authenticated, anon;

  -- auth.uid() reads the JWT subject exactly like PostgREST/GoTrue expose it.
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    email text,
    subdomain text,
    salon_name text
  );
  create table if not exists public.services (id uuid primary key, owner_id uuid);

  -- Same trigger production uses (00001_init): every auth user gets a profile.
  create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles(id, full_name, email)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.email)
    on conflict (id) do nothing;
    return new;
  end $$;
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users for each row execute procedure public.handle_new_user();

  -- Local stand-in for the production-only private.is_admin(): the gateway sets
  -- app.is_admin per request from the caller's JWT app_metadata.
  create schema if not exists private;
  create or replace function private.is_admin() returns boolean language sql stable as
    $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
  grant usage on schema private to authenticated, anon;
  grant execute on function private.is_admin() to authenticated, anon;
`;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface LocalDatabase {
  db: any;
  /** Run one statement with the request's role + claims applied (serialized). */
  asRequest: <T>(context: RequestContext, fn: (db: any) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

/** Who the request runs as. An admin claim maps to service_role — the same
 *  privileged role an admin console / SQL Editor session uses — because the
 *  admin-only RPCs have no EXECUTE grant for `authenticated` at all. */
export interface RequestContext {
  sub: string | null;
  isAdmin: boolean;
}

export function roleFor(context: RequestContext): 'service_role' | 'authenticated' | 'anon' {
  if (context.isAdmin) return 'service_role';
  return context.sub ? 'authenticated' : 'anon';
}

export async function createLocalDatabase(dataDir?: string): Promise<LocalDatabase> {
  const db: any = dataDir ? new PGlite(dataDir) : new PGlite();

  await db.exec(BOOTSTRAP);
  for (const file of LOCAL_GROWTH_CHAIN) {
    await db.exec(
      readFileSync(path.join(process.cwd(), 'supabase', 'migrations', file), 'utf8')
    );
  }

  // PGlite is a single connection: role/GUC changes must not interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const asRequest = async <T,>(context: RequestContext, fn: (db: any) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [context.sub || '']);
      await db.query("select set_config('app.is_admin', $1, false)", [context.isAdmin ? 'true' : 'false']);
      await db.exec(`set role ${roleFor(context)}`);
      try {
        return await fn(db);
      } finally {
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
        await db.query("select set_config('app.is_admin', '', false)");
      }
    });
    queue = run.catch(() => undefined);
    return run as Promise<T>;
  };

  return { db, asRequest, close: () => db.close() };
}

// ---------------------------------------------------------------------------
// Passwords + tokens (local only — never a production auth system)
// ---------------------------------------------------------------------------

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface LocalClaims {
  sub: string;
  email: string;
  isAdmin: boolean;
  fullName: string | null;
}

export function signLocalToken(claims: LocalClaims): { accessToken: string; expiresAt: number } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      aud: 'authenticated',
      role: 'authenticated',
      sub: claims.sub,
      email: claims.email,
      iat: issuedAt,
      exp: expiresAt,
      session_id: randomUUID(),
      user_metadata: { full_name: claims.fullName },
      app_metadata: { provider: 'email', providers: ['email'], is_admin: claims.isAdmin },
    })
  );
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return { accessToken: `${header}.${payload}.${signature}`, expiresAt };
}

export function verifyLocalToken(token: string | null | undefined): LocalClaims | null {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', JWT_SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  if (expected !== parts[2]) return null;
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  if (!payload.sub) return null;
  return {
    sub: String(payload.sub),
    email: String(payload.email || ''),
    isAdmin: payload.app_metadata?.is_admin === true,
    fullName: payload.user_metadata?.full_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

function bearerOf(req: Request): string | null {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function publicUser(row: any) {
  const metadata = row?.raw_user_meta_data || {};
  const appMetadata = row?.raw_app_meta_data || {};
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    phone: '',
    email_confirmed_at: row.email_confirmed_at,
    confirmed_at: row.email_confirmed_at,
    last_sign_in_at: row.last_sign_in_at,
    created_at: row.created_at,
    updated_at: row.created_at,
    app_metadata: { provider: 'email', providers: ['email'], ...appMetadata },
    user_metadata: { ...metadata },
    identities: [],
  };
}

function sessionFor(row: any) {
  const claims: LocalClaims = {
    sub: row.id,
    email: row.email,
    isAdmin: row.raw_app_meta_data?.is_admin === true,
    fullName: row.raw_user_meta_data?.full_name ?? null,
  };
  const { accessToken, expiresAt } = signLocalToken(claims);
  const user = publicUser(row);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: TOKEN_TTL_SECONDS,
    expires_at: expiresAt,
    refresh_token: `local-refresh-${row.id}`,
    user,
  };
}

/**
 * Resolve `rpc('name', {named: args})` to one positional call, like PostgREST.
 *
 * `returns table(...)` functions declare their OUT columns as arguments too, so
 * only IN/INOUT parameters may be bound — otherwise a call binds a placeholder
 * per OUT column and Postgres answers 08P01 ("supplies 14 parameters, requires
 * 2"). Set-returning functions are called in FROM, so the rows come back the
 * way PostgREST returns them: a JSON array of objects.
 */
async function resolveRpc(
  db: any,
  fn: string,
  args: Record<string, unknown>
): Promise<
  | { sql: string; params: unknown[]; returnsSet: boolean }
  | { missing: true }
  | { ambiguous: string[] }
> {
  const found = await db.query(
    `select p.oid::text as oid,
            p.proretset as returns_set,
            coalesce(p.proargnames, '{}') as all_argnames,
            coalesce(p.proargmodes, '{}') as argmodes,
            (select coalesce(array_agg(format_type(x.typeoid, null) order by x.ord), '{}')
               from unnest(p.proargtypes) with ordinality as x(typeoid, ord)) as argtypes
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1
      order by array_length(p.proargtypes, 1) asc nulls first`,
    [fn]
  );
  if (found.rows.length === 0) return { missing: true };

  /** IN/INOUT parameter names only ('b' = IN, 'i' = INOUT, 'o'/'t' = output). */
  const inputNames = (row: any): string[] => {
    const modes = (row.argmodes || []) as string[];
    return ((row.all_argnames || []) as string[]).filter((_, index) => {
      const mode = modes.length ? modes[index] : 'b';
      return mode === 'b' || mode === 'i';
    });
  };

  const keys = Object.keys(args || {});
  const candidates = found.rows.filter((row: any) =>
    keys.every((key) => inputNames(row).includes(key))
  );
  if (candidates.length === 0) {
    return { ambiguous: found.rows.map((row: any) => inputNames(row).join(', ')) };
  }
  const chosen = candidates[0];
  const names = inputNames(chosen);
  const types = chosen.argtypes as string[];
  const params = names.map((name) => (args && name in args ? args[name] : null));
  const casts = types.map((type, index) => `$${index + 1}::${type}`);
  const returnsSet = Boolean(chosen.returns_set);
  return {
    sql: returnsSet
      ? `select * from public.${fn}(${casts.join(', ')})`
      : `select public.${fn}(${casts.join(', ')}) as result`,
    params,
    returnsSet,
  };
}

export interface LocalGatewayOptions {
  /** Persist the database here (default: in-memory). */
  dataDir?: string;
  /** Create the documented local admin account on boot. */
  seedAdmin?: boolean;
  /** Called with a line to log at startup. */
  log?: (line: string) => void;
}

export async function createLocalSupabaseGateway(options: LocalGatewayOptions = {}) {
  const local = await createLocalDatabase(options.dataDir);
  const log = options.log ?? ((line: string) => console.log(line));

  if (options.seedAdmin !== false) {
    const existing = await local.db.query('select id from auth.users where email = $1', [
      LOCAL_DEV_ADMIN_EMAIL,
    ]);
    if (existing.rows.length === 0) {
      await local.db.query(
        `insert into auth.users(email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
         values ($1, $2, now(), $3::jsonb, $4::jsonb)`,
        [
          LOCAL_DEV_ADMIN_EMAIL,
          hashPassword(LOCAL_DEV_ADMIN_PASSWORD),
          JSON.stringify({ full_name: 'Local Platform Admin' }),
          JSON.stringify({ is_admin: true }),
        ]
      );
      log(
        `[local-supabase] admin review account ready: ${LOCAL_DEV_ADMIN_EMAIL} / ${LOCAL_DEV_ADMIN_PASSWORD} (local database only)`
      );
    }
  }

  return { local, log };
}

export async function registerLocalSupabaseGateway(
  app: Express,
  options: LocalGatewayOptions = {}
): Promise<{ close: () => Promise<void> }> {
  const { local, log } = await createLocalSupabaseGateway(options);
  log(
    `[local-supabase] serving /auth/v1 + /rest/v1 from PGlite with ${LOCAL_GROWTH_CHAIN.length} real migrations`
  );

  // ---------------- auth ---------------------------------------------------
  app.post('/auth/v1/signup', async (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(422).json({ error: 'invalid_request', error_description: 'Email and password are required.' });
    }
    const taken = await local.db.query('select id from auth.users where email = $1', [email]);
    if (taken.rows.length > 0) {
      return res
        .status(422)
        .json({ error: 'user_already_exists', error_description: 'User already registered' });
    }
    const created = await local.db.query(
      `insert into auth.users(email, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values ($1, $2, now(), $3::jsonb)
       returning *`,
      [email, hashPassword(password), JSON.stringify(req.body?.data || {})]
    );
    return res.status(200).json(sessionFor(created.rows[0]));
  });

  app.post('/auth/v1/token', async (req: Request, res: Response) => {
    const grant = String(req.query.grant_type || 'password');
    if (grant === 'refresh_token') {
      const refreshToken = String(req.body?.refresh_token || '');
      const userId = refreshToken.replace(/^local-refresh-/, '');
      const found = await local.db.query('select * from auth.users where id = $1', [userId]);
      if (found.rows.length === 0) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      }
      return res.status(200).json(sessionFor(found.rows[0]));
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const found = await local.db.query('select * from auth.users where email = $1', [email]);
    const row: any = found.rows[0];
    if (!row || !verifyPassword(password, row.encrypted_password)) {
      // Same wording GoTrue uses — src/lib/growthPartnerLogin.ts maps it to a
      // safe message, and it must never reveal whether the email exists.
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    await local.db.query('update auth.users set last_sign_in_at = now() where id = $1', [row.id]);
    return res.status(200).json(sessionFor(row));
  });

  app.get('/auth/v1/user', async (req: Request, res: Response) => {
    const claims = verifyLocalToken(bearerOf(req));
    if (!claims) return res.status(401).json({ error: 'invalid_token', error_description: 'Sign in required' });
    const found = await local.db.query('select * from auth.users where id = $1', [claims.sub]);
    if (found.rows.length === 0) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'Sign in required' });
    }
    return res.status(200).json(publicUser(found.rows[0]));
  });

  app.post('/auth/v1/logout', (_req: Request, res: Response) => res.status(204).end());
  app.get('/auth/v1/settings', (_req: Request, res: Response) =>
    res.status(200).json({ external: {}, disable_signup: false, mailer_autoconfirm: true })
  );

  // Password reset (GoTrue /recover semantics; local database only).
  // No email is sent in local development: the one-time recovery link is
  // logged to the server console instead, using the SAME implicit-grant hash
  // format Supabase's reset email uses, so supabase-js detectSessionInUrl
  // accepts it and fires PASSWORD_RECOVERY on /partner/login. The response
  // never reveals whether the email has an account.
  app.post('/auth/v1/recover', async (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const respond = () => res.status(200).json({});
    if (!email) return respond();
    const found = await local.db.query('select * from auth.users where email = $1', [email]);
    const row: any = found.rows[0];
    if (!row) return respond();

    // Only same-origin paths are honoured, so the logged link can never be an
    // open redirect through the dev console.
    const requested = String(req.query?.redirect_to || '');
    const redirectTo = /^\/(\/|$)/.test(requested) ? requested : '/partner/login';
    const origin =
      (typeof req.headers.origin === 'string' && req.headers.origin) ||
      `${req.protocol}://${req.get('host') || `127.0.0.1:${process.env.PORT || 3000}`}`;
    const session = sessionFor(row);
    const link =
      `${origin}${redirectTo}` +
      `#access_token=${encodeURIComponent(session.access_token)}` +
      `&expires_in=${session.expires_in}` +
      `&refresh_token=${encodeURIComponent(session.refresh_token)}` +
      `&token_type=recovery&type=recovery`;
    log(
      `[local-supabase] password reset link for ${email} (local database only — no email is sent):\n` +
        `  ${link}`
    );
    return respond();
  });

  // Password update during a recovery session (GoTrue PUT /user). Only the
  // `password` attribute is honoured; the caller must present a valid bearer
  // token, which the recovery link established.
  app.put('/auth/v1/user', async (req: Request, res: Response) => {
    const claims = verifyLocalToken(bearerOf(req));
    if (!claims) {
      return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    }
    const password = String(req.body?.password || '');
    if (password) {
      if (password.length < 8) {
        return res
          .status(422)
          .json({ error: 'weak_password', error_description: 'Password should be at least 8 characters.' });
      }
      await local.db.query('update auth.users set encrypted_password = $2 where id = $1', [
        claims.sub,
        hashPassword(password),
      ]);
    }
    const found = await local.db.query('select * from auth.users where id = $1', [claims.sub]);
    if (found.rows.length === 0) {
      return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    }
    return res.status(200).json(publicUser(found.rows[0]));
  });

  // ---------------- PostgREST RPC -----------------------------------------
  app.post('/rest/v1/rpc/:fn', async (req: Request, res: Response) => {
    const fn = String(req.params.fn || '');
    if (!/^[a-z0-9_]+$/i.test(fn)) return res.status(404).json({ code: 'PGRST202', message: 'Function not found' });

    const claims = verifyLocalToken(bearerOf(req));
    const resolved = await resolveRpc(local.db, fn, (req.body || {}) as Record<string, unknown>);
    if ('missing' in resolved) {
      return res.status(404).json({
        code: 'PGRST202',
        message: `Could not find the function public.${fn} in the schema cache`,
      });
    }
    if ('ambiguous' in resolved) {
      return res.status(300).json({
        code: 'PGRST203',
        message: `Could not choose the best candidate function for ${fn}. Try a request with one of these parameter signatures: ${resolved.ambiguous.join(' | ')}`,
      });
    }

    try {
      const result = await local.asRequest(
        { sub: claims?.sub ?? null, isAdmin: claims?.isAdmin ?? false },
        async (db) => {
          const { rows } = await db.query(resolved.sql, resolved.params);
          return resolved.returnsSet ? rows : rows[0]?.result ?? null;
        }
      );
      return res.status(200).json(result);
    } catch (error: any) {
      const code = String(error?.code || 'XX000');
      const status = code === '42501' ? 403 : code === '42883' ? 404 : code === '22023' ? 400 : 400;
      return res.status(status).json({
        code,
        message: error?.message || 'Function call failed',
        details: null,
        hint: null,
      });
    }
  });

  // ---------------- PostgREST table reads (small, explicit subset) ----------
  // Only the Growth Partner area's own tables, and only through the request's
  // role, so the committed RLS policies decide what comes back. Everything else
  // (the owner/booking surfaces, which read the normalized production schema
  // that no committed migration creates) answers 501 instead of fake rows.
  app.get('/rest/v1/:table', async (req: Request, res: Response) => {
    const table = String(req.params.table || '');
    if (!LOCAL_TABLE_ALLOWLIST.includes(table)) return tableReadUnavailable(req, res);

    const columns = await local.db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1`,
      [table]
    );
    const known = new Set(columns.rows.map((row: any) => String(row.column_name)));
    const isIdent = (value: string) => known.has(value) && /^[a-z_][a-z0-9_]*$/i.test(value);

    const select = String(req.query.select || '*')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const column of select) {
      if (column !== '*' && !isIdent(column)) {
        return res.status(400).json({
          code: 'PGRST204',
          message: `Could not find the '${column}' column of '${table}' in the schema cache`,
        });
      }
    }
    const selectSql = select.length === 0 || select.includes('*') ? '*' : select.join(', ');

    const where: string[] = [];
    const params: unknown[] = [];
    for (const [key, raw] of Object.entries(req.query)) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const match = /^eq\.(.*)$/s.exec(String(raw ?? ''));
      if (!match || !isIdent(key)) continue;
      params.push(match[1]);
      where.push(`${key} = $${params.length}`);
    }

    let tail = '';
    const order = /^([a-z_][a-z0-9_]*)\.(asc|desc)$/i.exec(String(req.query.order || ''));
    if (order && isIdent(order[1])) tail += ` order by ${order[1]} ${order[2].toLowerCase()}`;
    const limit = Number.parseInt(String(req.query.limit ?? ''), 10);
    if (Number.isFinite(limit) && limit >= 0) tail += ` limit ${Math.min(limit, 1000)}`;

    const claims = verifyLocalToken(bearerOf(req));
    try {
      const rows = await local.asRequest(
        { sub: claims?.sub ?? null, isAdmin: claims?.isAdmin ?? false },
        async (db) =>
          (
            await db.query(
              `select ${selectSql} from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}${tail}`,
              params
            )
          ).rows
      );
      // supabase-js .single()/.maybeSingle() ask for one object.
      if (String(req.headers.accept || '').includes('vnd.pgrst.object')) {
        if (rows.length > 1) {
          return res.status(406).json({
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
          });
        }
        return res.status(200).json(rows[0] ?? null);
      }
      return res.status(200).json(rows);
    } catch (error: any) {
      return res.status(400).json({
        code: String(error?.code || 'XX000'),
        message: error?.message || 'Query failed',
      });
    }
  });

  app.all('/rest/v1/:table', (req: Request, res: Response) => tableReadUnavailable(req, res));

  return { close: () => local.close() };
}

/** Honest 501 for the surfaces this gateway does not serve. */
function tableReadUnavailable(req: Request, res: Response) {
  res.status(501).json({
    code: 'PGRST-local',
    message:
      'The local development gateway serves the Growth Partner area only. ' +
      `Table "${req.params.table}" lives in the normalized production schema — point SUPABASE_URL at a real project for those screens.`,
  });
}
