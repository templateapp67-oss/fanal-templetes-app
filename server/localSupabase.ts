import { logPartnerFailure, safeGatewayFailure } from './partnerErrorLog.js';
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
//   • mounted only when VITE_LOCAL_SUPABASE=true (see .env.example)
//   • the application mount guard refuses a configured real Supabase URL
//
// Scope: the Growth Partner + onboarding surface (RPCs). The owner dashboard /
// booking surfaces read the normalized production schema, which no committed
// migration creates (see tests/liveSchemaFixture.ts), so those still need a
// real project — table reads answer an explicit 501 rather than fake rows.
// ============================================================================

import { PGlite } from '@electric-sql/pglite';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import QRCode from 'qrcode';

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
  '20260921_public_partner_referral_codes.sql',
  '20260922_referral_link_attribution.sql',
  '20260923_referral_fraud_privacy.sql',
  '20260924_referral_lifecycle.sql',
  '20260925_referral_status_tabs.sql',
  '20260926_referral_search_details.sql',
  '20260927_growth_partner_profile.sql',
  '20260928_partner_referrals_table.sql',
  '20260929_partner_referral_events_rls.sql',
  // Partner portal operations — the schema behind Earnings, Withdrawals,
  // Marketing Materials, Partner Levels, Leaderboards, Notifications, Support.
  // Previously missing from the local gateway, which caused:
  // "Your tickets could not load. The partner operations schema is not applied..."
  // NOTE: These must run AFTER 20260928/29 because:
  //   - growth_partners.id is added in 20260928 (operations references it)
  //   - partner_referrals and partner_referral_events are created in 28/29
  //     (operations has FKs to them)
  // GROWTH_PARTNER_SETUP.md §3 explicitly says 28/29 must precede portal sections.
  // The timestamp 20260918 is misleading — logical dependency order is 28,29,18,19.
  '20260918035349_partner_portal_operations.sql',
  '20260918070000_partner_account_settings.sql',
  '20260919120000_partner_portal_section_reads.sql',
  // Account Settings v2 — structured social links, bank/PAN fields,
  // notification toggles, the security log + deactivation requests and the
  // security RPCs the /partner/account-settings page renders.
  '20260919130000_partner_account_security_settings.sql',
  // Flushes PostgREST's schema cache after those RPCs. Without it a project
  // that applied 20260919130000 while PostgREST was running keeps answering
  // PGRST202 for get_my_partner_security_overview — the
  // "Could not load your security overview. Please retry." page error.
  '20260919130100_reload_postgrest_schema_partner_security.sql',
  '20260930_partner_dashboard_metrics.sql',
  '20261001_partner_dashboard_activity.sql',
  // Referral code normalization (PHASE 4.2). Widens growth_normalize_code's
  // trim from spaces-only to the set String.prototype.trim() removes, so the
  // database and the browser agree on one canonical code form.
  '20261004_referral_code_normalization.sql',
  // Partner usability guard (PHASE 5). Refuses NEW referrals to a partner who
  // is inactive or GoTrue-banned; existing attributions are never revisited.
  '20261005_partner_ban_guard.sql',
  // Owner/salon workspace resolution (PART 3). Creates the normalized
  // organizations / organization_members / salons objects and the idempotent
  // ensure_owner_workspace() the Template App entry gate calls, so the
  // handoff → workspace → save → completion chain is exercisable locally.
  '20261002_owner_workspace_provisioning.sql',
  // Signup profile fields (PHASE 2). Replaces handle_new_user() so the local
  // gateway persists full_name / phone_number exactly the way the production
  // trigger does. It deliberately does not seed owner_role - see the header
  // of the migration for why that column belongs to the template/editor.
  '20261003_signup_profile_fields.sql',
  // Canonical owner -> salon resolution (PHASE 10). Replaces the read side
  // get_my_owner_workspace() with the version that PICKS a salon (primary ->
  // most recent active -> first authorized) instead of reporting "ambiguous",
  // so a multi-salon owner is exercisable locally exactly as in production.
  // The save-side patch is skipped here: nexora_save_owner_workspace() is not
  // part of this chain (the owner/editor save path reads the normalized
  // production schema).
  '20261006_owner_salon_resolution.sql',
];

/**
 * Tables this gateway will read directly. Deliberately only the Growth Partner
 * area's own tables — the owner/booking screens read the normalized production
 * schema, which no committed migration creates.
 */
export const LOCAL_TABLE_ALLOWLIST = [
  'partner_referral_events',
  'partner_referrals',
  'growth_partner_applications',
  'growth_partners',
  'growth_onboarding',
  'profiles',
];

const configuredJwtSecret = process.env.LOCAL_SUPABASE_JWT_SECRET;
if (configuredJwtSecret && Buffer.byteLength(configuredJwtSecret) < 32) {
  throw new Error('LOCAL_SUPABASE_JWT_SECRET must contain at least 32 bytes.');
}
const JWT_SECRET = configuredJwtSecret || randomBytes(32).toString('hex');
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

// ---------------------------------------------------------------------------
// Schema bootstrap — the slice of 00001_init the Growth Partner chain needs.
// ---------------------------------------------------------------------------
export const LOCAL_DATABASE_BOOTSTRAP = `
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
    created_at timestamptz not null default now(),
    -- GoTrue's ban column. Real auth.users has it, and
    -- 20260913_template_handoff.sql probes information_schema for it before
    -- enforcing a ban, so modelling it here exercises that branch locally
    -- instead of silently skipping it.
    banned_until timestamptz
  );
  grant usage on schema auth to authenticated, anon;

  -- GoTrue's session table, modelled with the columns the partner security
  -- page renders. Hosted Supabase owns the real one; here the gateway keeps
  -- it in step with the tokens it issues, so "Active Sessions" and "log out
  -- of all other sessions" are exercised against real rows, and the
  -- request.jwt.claims GUC carries the same session_id claim GoTrue would.
  create table if not exists auth.sessions (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    not_after timestamptz,
    user_agent text,
    ip text
  );
  create index if not exists auth_sessions_user_idx on auth.sessions(user_id);

  -- GoTrue's TOTP factor tables, so 2FA enrollment (QR → challenge → verify →
  -- unenroll) runs against real state locally. The secret is stored plain here
  -- only because this gateway is a local stand-in; hosted Supabase encrypts it.
  create table if not exists auth.mfa_factors (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    friendly_name text,
    factor_type text not null default 'totp',
    status text not null default 'unverified',
    secret text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table if not exists auth.mfa_challenges (
    id uuid primary key,
    factor_id uuid not null references auth.mfa_factors(id) on delete cascade,
    created_at timestamptz not null default now(),
    verified_at timestamptz
  );

  -- auth.uid() reads the JWT subject exactly like PostgREST/GoTrue expose it.
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  -- Mirrors the 00001_init columns the signup path touches. Still a stand-in:
  -- the full production profile is ~50 columns, and only these are read by
  -- the growth/onboarding chain this gateway exists to exercise.
  -- owner_role is here because 00001 declares it, but handle_new_user does
  -- NOT seed it: it is a display title owned by the template/editor, and the
  -- canonical owner role is organization_members.role (see 20261003).
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    email text,
    phone_number text,
    owner_role text,
    subdomain text,
    salon_name text
  );
  -- Same access shape production has (00001_init): RLS on, and the signed-in
  -- owner reads their own row. Without this the gateway served the profiles
  -- table with no table privileges at all, so an owner could not read back
  -- the row their own signup created.
  alter table public.profiles enable row level security;
  grant select on public.profiles to authenticated;
  drop policy if exists profiles_select_owner on public.profiles;
  create policy profiles_select_owner on public.profiles
    for select using (id = auth.uid());
  create table if not exists public.services (id uuid primary key, owner_id uuid);

  -- Same trigger production uses (00001_init): every auth user gets a profile.
  create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles(id, full_name, email, phone_number)
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), ''),
      new.email,
      nullif(btrim(new.raw_user_meta_data ->> 'phone_number'), '')
    )
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
  /** Setup/tests only. HTTP operations use the shared request/owner queue. */
  db: any;
  ownerQuery: (sql: string, params?: any[]) => Promise<any>;
  /** Run one statement with the request's role + claims applied (serialized). */
  asRequest: <T>(context: RequestContext, fn: (db: any) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

/** Who the request runs as. An admin claim maps to service_role — the same
 *  privileged role an admin console / SQL Editor session uses — because the
 *  admin-only RPCs have no EXECUTE grant for `authenticated` at all.
 *  `sessionId` is the JWT's session_id claim (GoTrue issues one per session);
 *  when present it is exposed to RPCs through the request.jwt.claims GUC
 *  exactly the way PostgREST would, so "revoke my OTHER sessions" can tell
 *  which session is the caller's. */
export interface RequestContext {
  sub: string | null;
  isAdmin: boolean;
  sessionId?: string | null;
}

export function roleFor(context: RequestContext): 'service_role' | 'authenticated' | 'anon' {
  if (context.isAdmin) return 'service_role';
  return context.sub ? 'authenticated' : 'anon';
}

export async function createLocalDatabase(dataDir?: string): Promise<LocalDatabase> {
  const db: any = dataDir ? new PGlite(dataDir) : new PGlite();

  await db.exec(LOCAL_DATABASE_BOOTSTRAP);
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
      await db.query(
        "select set_config('request.jwt.claims', $1, false)",
        [JSON.stringify({ sub: context.sub, session_id: context.sessionId ?? null })]
      );
      await db.query("select set_config('app.is_admin', $1, false)", [context.isAdmin ? 'true' : 'false']);
      await db.exec(`set role ${roleFor(context)}`);
      try {
        return await fn(db);
      } finally {
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
        await db.query("select set_config('request.jwt.claims', '', false)");
        await db.query("select set_config('app.is_admin', '', false)");
      }
    });
    queue = run.catch(() => undefined);
    return run as Promise<T>;
  };

  // Auth queries and catalog inspection must share the same queue: running
  // them on the raw connection could inherit another request's SET ROLE/GUCs.
  const ownerQuery = (sql: string, params?: any[]) => {
    const run = queue.then(() => db.query(sql, params));
    queue = run.catch(() => undefined);
    return run;
  };
  return { db, asRequest, ownerQuery, close: async () => { await queue; await db.close(); } };
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
  /** GoTrue's session_id claim — present on every gateway-issued token. */
  sessionId?: string;
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
      session_id: claims.sessionId || randomUUID(),
      user_metadata: { full_name: claims.fullName },
      app_metadata: { provider: 'email', providers: ['email'], is_admin: claims.isAdmin },
    })
  );
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return { accessToken: `${header}.${payload}.${signature}`, expiresAt };
}

export function verifyLocalToken(token: string | null | undefined): LocalClaims | null {
  if (!token || token.length > 8192) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', JWT_SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(parts[2]) || !timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  let payload: any;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat * 1000 > Date.now() + 30000 || payload.exp <= payload.iat) return null;
  if (payload.aud !== 'authenticated' || payload.role !== 'authenticated') return null;
  if (typeof payload.sub !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(payload.sub)) return null;
  return {
    sub: String(payload.sub),
    email: String(payload.email || ''),
    isAdmin: payload.app_metadata?.is_admin === true,
    fullName: payload.user_metadata?.full_name ?? null,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : undefined,
  };
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — the local stand-in for GoTrue's two-factor enrollment.
// The browser verifies the QR against an authenticator app; the gateway
// verifies the 6-digit code here with the standard ±1 step window.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(value: string): Buffer {
  const clean = value.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let buffer = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, stepSeconds = 30, window = 1): boolean {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^[0-9]{6}$/.test(normalized)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(key, counter + offset) === normalized) return true;
  }
  return false;
}

function generateBase32Secret(bytes = 20): string {
  const raw = randomBytes(bytes);
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of raw) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

function bearerOf(req: Request): string | null {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

/** Where this session started — the user agent / IP the security page shows. */
function clientMeta(req: Request): { userAgent: string | null; ip: string | null } {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    ip: (forwarded || req.socket?.remoteAddress || '').slice(0, 64) || null,
  };
}

function publicUser(row: any, factors: any[] = []) {
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
    // auth.mfa.listFactors() reads the factors off the user object (GoTrue
    // embeds them in the user payload), so the account page can tell whether
    // 2FA is actually enrolled without a privileged key.
    factors,
    identities: [],
  };
}

/** Public shape of the caller's MFA factors (never the secrets). */
async function factorsFor(db: { ownerQuery: (sql: string, params?: any[]) => Promise<any> }, userId: string): Promise<any[]> {
  const found = await db.ownerQuery(
    `select id, friendly_name, factor_type, status, created_at, updated_at
       from auth.mfa_factors where user_id = $1 order by created_at asc`,
    [userId]
  );
  return found.rows;
}

function sessionFor(row: any, refreshToken: string, sessionId: string, factors: any[] = []) {
  const claims: LocalClaims = {
    sub: row.id,
    email: row.email,
    isAdmin: row.raw_app_meta_data?.is_admin === true,
    fullName: row.raw_user_meta_data?.full_name ?? null,
    sessionId,
  };
  const { accessToken, expiresAt } = signLocalToken(claims);
  const user = publicUser(row, factors);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: TOKEN_TTL_SECONDS,
    expires_at: expiresAt,
    refresh_token: refreshToken,
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
  if (process.env.NODE_ENV === 'production') throw new Error('The local authentication gateway cannot run in production.');
  const local = await createLocalDatabase(options.dataDir);
  const log = options.log ?? ((line: string) => console.log(line));

  if (options.seedAdmin !== false) {
    const existing = await local.ownerQuery('select id from auth.users where email = $1', [
      LOCAL_DEV_ADMIN_EMAIL,
    ]);
    if (existing.rows.length === 0) {
      await local.ownerQuery(
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

  // Process-local sessions deliberately expire on restart, even with a persisted
  // database. No user ID or frontend metadata is a refresh credential.
  type SessionRecord = { userId: string; expiresAt: number; accessHash: string };
  const refreshSessions = new Map<string, SessionRecord>();
  const accessSessions = new Map<string, SessionRecord>();
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const pruneSessions = () => {
    for (const [key, value] of refreshSessions) if (value.expiresAt <= Date.now()) refreshSessions.delete(key);
    for (const [key, value] of accessSessions) if (value.expiresAt <= Date.now()) accessSessions.delete(key);
  };
  const revokeUser = (userId: string) => {
    for (const [key,value] of refreshSessions) if (value.userId === userId) refreshSessions.delete(key);
    for (const [key,value] of accessSessions) if (value.userId === userId) accessSessions.delete(key);
    // Keep auth.sessions in step: revoked tokens must not linger as "active".
    void local.ownerQuery('delete from auth.sessions where user_id = $1', [userId]).catch(() => undefined);
  };
  // Opt-in: mirror a project whose Auth settings require email confirmation,
  // so the "check your inbox" branch is exercisable end to end. Default off —
  // the local gateway has always auto-confirmed.
  const requireEmailConfirmation = process.env.LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION === 'true';

  const issueSession = async (row: any, meta?: { userAgent?: string | null; ip?: string | null }) => {
    pruneSessions();
    const refreshToken = randomBytes(32).toString('hex');
    const sessionId = randomUUID();
    // One auth.sessions row per issued session — the rows the security page's
    // "Active Sessions" list and revoke-my-other-sessions RPC operate on.
    await local
      .ownerQuery(
        `insert into auth.sessions(id, user_id, user_agent, ip) values ($1, $2, $3, $4)`,
        [sessionId, row.id, meta?.userAgent ?? null, meta?.ip ?? null]
      )
      .catch(() => undefined);
    const factors = await factorsFor(local, row.id);
    const session = sessionFor(row, refreshToken, sessionId, factors);
    const record = { userId: row.id, expiresAt: session.expires_at * 1000, accessHash: digest(session.access_token), sessionId };
    refreshSessions.set(digest(refreshToken),record);
    accessSessions.set(record.accessHash,record);
    return session;
  };
  const authenticate = async (req: Request): Promise<LocalClaims | null> => {
    pruneSessions();
    const token = bearerOf(req);
    const claims = verifyLocalToken(token);
    if (!token || !claims || !accessSessions.has(digest(token))) return null;
    // The session row must still exist: revoke-my-other-sessions deletes rows,
    // and a still-valid JWT for a revoked session must stop working (hosted
    // GoTrue enforces the same at refresh time).
    if (claims.sessionId) {
      const sessionRow = await local.ownerQuery(
        'select 1 from auth.sessions where id = $1 and user_id = $2',
        [claims.sessionId, claims.sub]
      );
      if (sessionRow.rows.length === 0) return null;
    }
    const row = (await local.ownerQuery('select raw_app_meta_data from auth.users where id=$1',[claims.sub])).rows[0];
    if (!row) return null;
    // Re-check trusted database metadata, so demotion takes effect immediately.
    return {...claims, isAdmin: row.raw_app_meta_data?.is_admin === true};
  };
  app.use('/auth/v1', (_req, res, next) => { res.set('Cache-Control','no-store'); next(); });

  // ---------------- auth ---------------------------------------------------
  app.post('/auth/v1/signup', async (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(422).json({ error: 'invalid_request', error_description: 'Email and password are required.' });
    }
    const taken = await local.ownerQuery('select id from auth.users where email = $1', [email]);
    if (taken.rows.length > 0) {
      return res
        .status(422)
        .json({ error: 'user_already_exists', error_description: 'User already registered' });
    }
    const created = await local.ownerQuery(
      `insert into auth.users(email, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values ($1, $2, ${requireEmailConfirmation ? 'null' : 'now()'}, $3::jsonb)
       returning *`,
      [email, hashPassword(password), JSON.stringify(req.body?.data || {})]
    );
    // GoTrue shape for a project with "Confirm email" ON: a user, no session.
    // That is the branch signUpWithEmail() reports as confirmationRequired.
    if (requireEmailConfirmation) {
      log(`[local-supabase] signup for ${email} requires email confirmation (no email is sent locally)`);
      return res.status(200).json({ user: publicUser(created.rows[0]) });
    }
    return res.status(200).json(await issueSession(created.rows[0], clientMeta(req)));
  });

  app.post('/auth/v1/token', async (req: Request, res: Response) => {
    const grant = String(req.query.grant_type || 'password');
    if (grant === 'refresh_token') {
      const refreshToken = String(req.body?.refresh_token || '');
      pruneSessions();
      const key = digest(refreshToken);
      const record = /^[a-f0-9]{64}$/.test(refreshToken) ? refreshSessions.get(key) : undefined;
      if (!record) return res.status(400).json({error:'invalid_grant',error_description:'Invalid Refresh Token'});
      // Consume before the first await: concurrent replays cannot both rotate.
      refreshSessions.delete(key);
      accessSessions.delete(record.accessHash);
      const found = await local.ownerQuery('select * from auth.users where id=$1',[record.userId]);
      if (!found.rows.length) return res.status(400).json({error:'invalid_grant',error_description:'Invalid Refresh Token'});
      return res.status(200).json(await issueSession(found.rows[0], clientMeta(req)));
    }
    if (grant !== 'password') return res.status(400).json({error:'unsupported_grant_type'});

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const found = await local.ownerQuery('select * from auth.users where email = $1', [email]);
    const row: any = found.rows[0];
    if (!row || !verifyPassword(password, row.encrypted_password)) {
      // Same wording GoTrue uses — src/lib/growthPartnerLogin.ts maps it to a
      // safe message, and it must never reveal whether the email exists.
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    // With confirmation required, an unverified address has no session to
    // refresh and must not be able to log in — GoTrue answers 400
    // `email_not_confirmed`, which toSafeAuthError maps to "verify your email".
    // A no-op when the gateway auto-confirms, because email_confirmed_at is set.
    if (requireEmailConfirmation && !row.email_confirmed_at) {
      return res.status(400).json({ error: 'email_not_confirmed', error_description: 'Email not confirmed' });
    }
    await local.ownerQuery('update auth.users set last_sign_in_at = now() where id = $1', [row.id]);
    return res.status(200).json(await issueSession(row, clientMeta(req)));
  });

  app.get('/auth/v1/user', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (!claims) return res.status(401).json({ error: 'invalid_token', error_description: 'Sign in required' });
    const found = await local.ownerQuery('select * from auth.users where id = $1', [claims.sub]);
    if (found.rows.length === 0) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'Sign in required' });
    }
    return res.status(200).json(publicUser(found.rows[0], await factorsFor(local, claims.sub)));
  });

  app.post('/auth/v1/logout', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (claims) revokeUser(claims.sub);
    return res.status(204).end();
  });
  app.get('/auth/v1/settings', (_req: Request, res: Response) =>
    res.status(200).json({
      external: {},
      disable_signup: false,
      mailer_autoconfirm: !requireEmailConfirmation,
    })
  );

  // GoTrue POST /resend (type=signup|recovery). No email is sent locally, and
  // the response is identical whether or not the address exists, so account
  // existence is never revealed — same contract as /recover.
  app.post('/auth/v1/resend', async (req: Request, res: Response) => {
    const type = String(req.body?.type || '');
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (type !== 'signup' && type !== 'recovery') {
      return res.status(422).json({ error: 'invalid_request', error_description: 'type must be signup or recovery' });
    }
    if (!email) return res.status(200).json({});
    const found = await local.ownerQuery('select id from auth.users where email = $1', [email]);
    log(
      `[local-supabase] ${type} email requested for ${email} ` +
        `(${found.rows.length ? 'account exists' : 'no such account'} — nothing is sent locally)`
    );
    return res.status(200).json({});
  });

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
    const found = await local.ownerQuery('select * from auth.users where email = $1', [email]);
    const row: any = found.rows[0];
    if (!row) return respond();

    // Only same-origin paths are honoured, so the logged link can never be an
    // open redirect through the dev console.
    const requested = String(req.query?.redirect_to || '');
    const redirectTo = /^\/(\/|$)/.test(requested) ? requested : '/partner/login';
    const origin =
      (typeof req.headers.origin === 'string' && req.headers.origin) ||
      `${req.protocol}://${req.get('host') || `127.0.0.1:${process.env.PORT || 3000}`}`;
    const session = await issueSession(row, clientMeta(req));
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
    const claims = await authenticate(req);
    if (!claims) {
      return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    }
    if (req.body?.email !== undefined) {
      return res.status(501).json({ error: 'not_supported', error_description: 'Email changes require a live Supabase Auth connection.' });
    }
    const password = String(req.body?.password || '');
    if (password) {
      if (password.length < 8) {
        return res
          .status(422)
          .json({ error: 'weak_password', error_description: 'Password should be at least 8 characters.' });
      }
      await local.ownerQuery('update auth.users set encrypted_password = $2 where id = $1', [
        claims.sub,
        hashPassword(password),
      ]);
      revokeUser(claims.sub);
    }
    const found = await local.ownerQuery('select * from auth.users where id = $1', [claims.sub]);
    if (found.rows.length === 0) {
      return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    }
    return res.status(200).json(publicUser(found.rows[0], await factorsFor(local, claims.sub)));
  });

  // ---------------- MFA (TOTP two-factor) ----------------------------------
  // GoTrue's /factors surface, sufficient for the partner account page's QR
  // enrollment: enroll (secret + otpauth URI + SVG QR), challenge, verify
  // (marks the factor verified, returns a fresh aal2-style session), list and
  // unenroll. The browser talks to these through supabase-js auth.mfa.
  const mfaIssuer = () => 'Nexora Growth Partner';

  app.post('/auth/v1/factors', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (!claims) return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    if (String(req.body?.factor_type || '') !== 'totp') {
      return res.status(422).json({ error: 'unsupported_factor_type', error_description: 'Only TOTP factors are supported.' });
    }
    const existing = await local.ownerQuery(
      `select id from auth.mfa_factors where user_id = $1 and factor_type = 'totp' and status = 'verified'`,
      [claims.sub]
    );
    if (existing.rows.length > 0) {
      return res.status(422).json({ error: 'factor_already_verified', error_description: 'An authenticator is already enrolled.' });
    }
    const secret = generateBase32Secret();
    const id = randomUUID();
    const friendlyName = String(req.body?.friendly_name || '').slice(0, 120) || null;
    const userRow = (await local.ownerQuery('select * from auth.users where id = $1', [claims.sub])).rows[0];
    const uri =
      `otpauth://totp/${encodeURIComponent(mfaIssuer())}:${encodeURIComponent(userRow?.email || claims.sub)}` +
      `?secret=${secret}&issuer=${encodeURIComponent(mfaIssuer())}`;
    await local.ownerQuery(
      `insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, secret)
       values ($1, $2, $3, 'totp', 'unverified', $4)`,
      [id, claims.sub, friendlyName, secret]
    );
    // Raw SVG, URL-encoded on purpose: supabase-js prefixes the data URL
    // (data:image/svg+xml;utf-8,), and a raw SVG's "#" would truncate it.
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 });
    return res.status(200).json({
      id,
      type: 'totp',
      factor_type: 'totp',
      friendly_name: friendlyName,
      status: 'unverified',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      totp: { qr_code: encodeURIComponent(qrSvg), secret, uri },
    });
  });

  app.get('/auth/v1/factors', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (!claims) return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    return res.status(200).json({ factors: await factorsFor(local, claims.sub) });
  });

  app.post('/auth/v1/factors/:factorId/challenge', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (!claims) return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    const factorId = String(req.params.factorId || '');
    const factor = (await local.ownerQuery(
      `select * from auth.mfa_factors where id = $1 and user_id = $2`,
      [factorId, claims.sub]
    )).rows[0];
    if (!factor || factor.factor_type !== 'totp') {
      return res.status(404).json({ error: 'factor_not_found', error_description: 'Authenticator not found.' });
    }
    if (factor.status !== 'verified') {
      return res.status(403).json({ error: 'factor_not_verified', error_description: 'The authenticator has not been verified yet.' });
    }
    const challengeId = randomUUID();
    await local.ownerQuery(`insert into auth.mfa_challenges(id, factor_id) values ($1, $2)`, [challengeId, factor.id]);
    return res.status(200).json({
      id: challengeId,
      factor_id: factor.id,
      type: 'totp',
      expires_at: Math.floor(Date.now() / 1000) + 300,
      friendly_name: factor.friendly_name,
    });
  });

  app.post('/auth/v1/factors/:factorId/verify', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (!claims) return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    const factorId = String(req.params.factorId || '');
    const factor = (await local.ownerQuery(
      `select * from auth.mfa_factors where id = $1 and user_id = $2`,
      [factorId, claims.sub]
    )).rows[0];
    if (!factor || factor.factor_type !== 'totp') {
      return res.status(404).json({ error: 'factor_not_found', error_description: 'Authenticator not found.' });
    }
    const challengeId = String(req.body?.challenge_id || '');
    const challenge = (await local.ownerQuery(
      `select * from auth.mfa_challenges where id = $1 and factor_id = $2 and verified_at is null`,
      [challengeId, factor.id]
    )).rows[0];
    if (!challenge) {
      return res.status(400).json({ error: 'challenge_not_found', error_description: 'Start the challenge again.' });
    }
    if (!verifyTotp(factor.secret, String(req.body?.code || ''))) {
      return res.status(422).json({ error: 'totp_ver_failed', error_description: 'Invalid authenticator code. Check the code and retry.' });
    }
    await local.ownerQuery(`update auth.mfa_challenges set verified_at = now() where id = $1`, [challenge.id]);
    await local.ownerQuery(
      `update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1`,
      [factor.id]
    );
    // GoTrue answers verify with a fresh session at a higher assurance level;
    // the client saves it, so the gateway returns the same shape a login does.
    const userRow = (await local.ownerQuery('select * from auth.users where id = $1', [claims.sub])).rows[0];
    const session = await issueSession(userRow, clientMeta(req));
    return res.status(200).json({ ...session, factor_id: factor.id });
  });

  app.delete('/auth/v1/factors/:factorId', async (req: Request, res: Response) => {
    const claims = await authenticate(req);
    if (!claims) return res.status(401).json({ error: 'unauthorized', error_description: 'Sign in required' });
    const factorId = String(req.params.factorId || '');
    const gone = await local.ownerQuery(
      `delete from auth.mfa_factors where id = $1 and user_id = $2 returning id`,
      [factorId, claims.sub]
    );
    if (gone.rows.length === 0) {
      return res.status(404).json({ error: 'factor_not_found', error_description: 'Authenticator not found.' });
    }
    return res.status(200).json({ id: gone.rows[0].id });
  });

  // ---------------- PostgREST RPC -----------------------------------------
  app.post('/rest/v1/rpc/:fn', async (req: Request, res: Response) => {
    const fn = String(req.params.fn || '');
    if (!/^[a-z0-9_]+$/i.test(fn)) return res.status(404).json({ code: 'PGRST202', message: 'Function not found' });

    const claims = await authenticate(req);
    try {
      const resolved = await resolveRpc({query: local.ownerQuery}, fn, (req.body || {}) as Record<string, unknown>);
      if ('missing' in resolved) {
        return res.status(404).json({
          code: 'PGRST202',
          message: 'This service is unavailable. Please try again later.',
        });
      }
      if ('ambiguous' in resolved) {
        return res.status(300).json({
          code: 'PGRST203',
          message: 'This request could not be processed. Please try again.',
        });
      }

      const result = await local.asRequest(
        { sub: claims?.sub ?? null, isAdmin: claims?.isAdmin ?? false, sessionId: claims?.sessionId ?? null },
        async (db) => {
          const { rows } = await db.query(resolved.sql, resolved.params);
          return resolved.returnsSet ? rows : rows[0]?.result ?? null;
        }
      );
      return res.status(200).json(result);
    } catch (error: any) {
      const requestId = logPartnerFailure(`rpc.${fn}`, error, log);
      res.set('X-Request-ID', requestId);
      const code = String(error?.code || 'XX000');
      const status = code === '42501' ? 403 : code === '42883' ? 404 : code === '22023' ? 400 : 400;
      return res.status(status).json({
        code,
        message: safeGatewayFailure(error),
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

    const columns = await local.ownerQuery(
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

    const claims = await authenticate(req);
    try {
      const rows = await local.asRequest(
        { sub: claims?.sub ?? null, isAdmin: claims?.isAdmin ?? false, sessionId: claims?.sessionId ?? null },
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
      const requestId = logPartnerFailure(`table.${table}`, error, log);
      res.set('X-Request-ID', requestId);
      return res.status(400).json({
        code: String(error?.code || 'XX000'),
        message: safeGatewayFailure(error),
      });
    }
  });

  app.all('/rest/v1/:table', (req: Request, res: Response) => tableReadUnavailable(req, res));

  return { close: () => { refreshSessions.clear(); accessSessions.clear(); return local.close(); } };
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
