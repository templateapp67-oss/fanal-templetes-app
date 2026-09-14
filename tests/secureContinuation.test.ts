// ============================================================================
// PHASE 9 — SECURE HANDOFF / SECURE CONTINUATION
//
// The architecture question first, because it decides everything else:
//
//   The Onboarding App (`src/onboarding/*`) and the Template App
//   (`src/App.tsx` + the editor) are **one deployment and one origin** by
//   default — the handoff route `/onboarding/handoff` is rendered by the
//   Template App inside the same bundle (`src/App.tsx` matches it before the
//   onboarding surface, pinned by `tests/templateHandoff.test.ts`). A split
//   deployment is opt-in through `VITE_TEMPLATE_APP_URL` /
//   `VITE_ONBOARDING_APP_URL`; when it is not set, `templateAppBaseUrl()`
//   returns the current origin.
//
// So 9.1 applies (session + authorized backend state, no new token), and 9.2's
// mechanism is the EXISTING one (`20260913_template_handoff.sql`) — audited in
// this file against the eight requirements and left as it is.
//
// `tests/templateHandoff.test.ts` already owns the token lifecycle itself
// (mint/redeem, single-use, atomicity, expiry, destination, cross-user, banned,
// RLS-closed, URL hygiene, safe errors). This suite adds the properties nothing
// else asserts:
//
//   9.1 the same-app continuation is session-only, and **no identity parameter
//       exists anywhere on the continuation surface** — not in the RPC
//       signatures, not in the client contracts.
//   9.1 the referral + workspace gates are backend state, not URL claims.
//   9.2 the grant is not a session: the exchange returns no credential, and a
//       token cannot be used as one.
//   9.2 identity query parameters (`?userId= ?email= ?ownerId= ?salonId=`) stay
//       inert end to end.
//   9.2 the repo-wide sweep: which server paths read identity from a query
//       parameter, and the one legacy branch that would — unreachable today,
//       recorded rather than assumed.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { asUser, liveSchemaDb } from './liveSchemaFixture';
import { LOCAL_GROWTH_CHAIN } from '../server/localSupabase';
import { matchTemplateHandoffQuery, TEMPLATE_HANDOFF_PATH } from '../src/lib/router';
import { stripHandoffQuery } from '../src/onboarding/lib/handoff';

const MIGRATION = (file: string) =>
  readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const SOURCE = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const OWNER_STATE_MIGRATIONS = [
  '20260909045308_contact_profile_wiring.sql',
  '20260909142000_normalized_owner_workspace.sql',
];

/** Same preamble as the state audit: fixture gaps, not product gaps. */
const FIXTURE_GAPS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  alter default privileges in schema public grant execute on functions to service_role;
  create schema if not exists private;
  create or replace function private.is_admin() returns boolean language sql stable as
    $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
  grant usage on schema private to authenticated, anon;
  grant execute on function private.is_admin() to authenticated, anon;
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text, salon_name text, business_type text, email text, phone_number text,
    whatsapp text, owner_role text, subdomain text unique, city text, state text,
    mobile text, phone text, pincode text, preferred_city text, area text,
    preferred_area text, avatar_url text, photo_url text,
    updated_at timestamptz not null default now()
  );
  alter table public.profiles enable row level security;
  grant select on public.profiles to authenticated;
  drop policy if exists profiles_select_owner on public.profiles;
  create policy profiles_select_owner on public.profiles for select using (id = auth.uid());
  alter table auth.users add column if not exists email text;
  alter table auth.users add column if not exists encrypted_password text;
  alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
  alter table auth.users add column if not exists banned_until timestamptz;
  alter table auth.users add column if not exists created_at timestamptz not null default now();
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  alter table public.salons add column if not exists deleted_at timestamptz;
  alter table public.salons add column if not exists owner_id uuid;
  alter table public.salons add column if not exists is_active boolean not null default true;
  alter table public.salons add column if not exists verified boolean not null default false;
  alter table public.salons add column if not exists mobile text;
  alter table public.salons add column if not exists email text;
  alter table public.salons add column if not exists area text;
  alter table public.salons add column if not exists state text;
  alter table public.salons add column if not exists pincode text;
  alter table public.salons add column if not exists landmark text;
  create table if not exists public.salon_staff (
    id uuid primary key default gen_random_uuid(), salon_id uuid, staff_id uuid
  );
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'salons_slug_key') then
      alter table public.salons add constraint salons_slug_key unique (slug);
    end if;
  end $$;
  grant usage on schema auth to authenticated, anon;
`;

let db: any;

before(async () => {
  db = await liveSchemaDb();
  await db.exec(FIXTURE_GAPS);
  for (const file of LOCAL_GROWTH_CHAIN) await db.exec(MIGRATION(file));
  for (const file of OWNER_STATE_MIGRATIONS) await db.exec(MIGRATION(file));
});

const PARTNER = 'f0000000-0000-4000-8000-0000000000c1';
const ADMIN = 'f0000000-0000-4000-8000-0000000000c9';

let seq = 0;
const ownerId = () => `e0000000-0000-4000-8000-${String((seq += 1) + 100).padStart(12, '0')}`;

async function signUp(id: string, email: string, meta: Record<string, unknown> = {}) {
  await db.query(
    'insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values($1,$2,$3,$4::jsonb)',
    [id, email, 'test-only', JSON.stringify({ full_name: 'Owner', salon_name: 'Owner Salon', ...meta })]
  );
  return id;
}

async function rpc(who: string, fn: string, args: any[] = []): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  const result = await asUser(db, who, `select public.${fn}(${placeholders}) as r`, args);
  return result.rows[0].r;
}

async function rpcAdmin(fn: string, args: any[] = [], actor = ADMIN): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
  await db.query("select set_config('app.is_admin', 'true', false)");
  await db.exec('reset role');
  await db.exec('set role service_role');
  try {
    return (await db.query(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('app.is_admin', 'false', false)");
  }
}

/** A real partner account + canonical code, provisioned once. */
async function ensurePartner(): Promise<string> {
  const exists = (await db.query('select 1 from auth.users where id = $1', [PARTNER])).rows.length > 0;
  if (!exists) await signUp(PARTNER, 'handoff.partner@example.com', { full_name: 'Partner' });
  return (await rpcAdmin('provision_growth_partner', [PARTNER])).referral_code as string;
}

/** An owner who followed a referral link: the referral-linked state 9.1 needs. */
async function referredOwner(email: string) {
  const id = await signUp(ownerId(), email);
  await rpc(id, 'link_my_growth_referral', [await ensurePartner()]);
  return id;
}

async function saveBusiness(who: string, extra: Record<string, unknown> = {}) {
  await rpc(who, 'ensure_owner_workspace');
  await rpc(who, 'save_owner_editor_state', [{
    profile: { businessName: 'Owner Salon', ownerName: 'Owner', phone: '+919000000000', subdomain: 'owner-salon' },
    services: [{ id: 'svc-1', name: 'Signature Cut', price: 500, durationMinutes: 30 }],
    stylists: [],
    loyaltyConfig: { pointsPerVisit: 10 },
    ...extra,
  }]);
}

/** Function argument lists, exactly as Postgres reports them. */
async function rpcArguments(fn: string): Promise<string> {
  const rows = (
    await db.query(
      `select pg_get_function_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1
       order by p.oid desc limit 1`,
      [fn]
    )
  ).rows;
  assert.equal(rows.length, 1, `${fn} must exist`);
  return rows[0].args as string;
}

// ===========================================================================
// 9.1 — same-app continuation: session + authorized backend state
// ===========================================================================

test('9.1a the same-origin continuation needs the session and the backend state — no grant row is created', async () => {
  const owner = await referredOwner('handoff.same-app@example.com');
  await saveBusiness(owner);

  // What the route needs, in the order the brief gives it:
  //   authenticated user -> referral verified -> workspace resolved -> editor
  const status = await rpc(owner, 'get_my_onboarding_status');
  assert.equal(status.linked, true, 'referral attribution verified from growth_onboarding');
  assert.equal(status.growth_partner_id, PARTNER);
  const workspace = await rpc(owner, 'get_my_owner_workspace');
  assert.equal(workspace.resolved, true, 'owner workspace resolved from membership + salon');
  assert.ok(workspace.salon_id && workspace.slug);
  const editorState = await rpc(owner, 'get_owner_editor_state');
  assert.equal(editorState.selectedTemplateId, undefined);

  // Every one of those reads derived the caller from the session. And the
  // same-app path minted nothing: no one-time token was needed to continue
  // inside one origin.
  const grants = await db.query('select count(*)::int as count from public.template_handoffs where user_id = $1', [owner]);
  assert.equal(grants.rows[0].count, 0, 'the same-app continuation creates no handoff grant');

  // The handoff route is the Template App's own route, not a second origin.
  assert.equal(TEMPLATE_HANDOFF_PATH, '/onboarding/handoff');
  const appSource = SOURCE('src/App.tsx');
  assert.ok(
    appSource.indexOf("isTemplateHandoffPath") < appSource.indexOf("isOnboardingApp"),
    'the Template App renders /onboarding/handoff before the Onboarding App surface'
  );
});

test('9.1b no identity parameter exists on the continuation surface — there is nothing for a URL to override', async () => {
  // The eight entry points of the flow, with their real signatures. A user id,
  // email, owner id or salon id appears in none of them: identity is auth.uid()
  // inside the function, which is why no query string can influence it.
  assert.equal(await rpcArguments('get_my_onboarding_status'), '');
  assert.equal(await rpcArguments('get_my_owner_workspace'), '');
  assert.equal(await rpcArguments('ensure_owner_workspace'), '');
  assert.equal(await rpcArguments('get_owner_editor_state'), '');
  assert.equal(await rpcArguments('complete_template_onboarding'), '');
  assert.equal(await rpcArguments('save_owner_editor_state'), 'p_state jsonb');
  assert.equal(await rpcArguments('create_template_handoff'), 'p_state text DEFAULT NULL::text');
  assert.equal(await rpcArguments('exchange_template_handoff'), 'p_token text');

  // Named-parameter calls with identity arguments cannot even be expressed:
  // PostgREST/Postgres rejects an argument the function does not declare.
  await assert.rejects(
    () => asUser(db, 'e0000000-0000-4000-8000-0000000000ff', 'select public.get_my_owner_workspace($1)', ['x']),
    /does not exist|No function matches/i,
    'there is no user/owner parameter to pass'
  );
  await assert.rejects(
    () => asUser(db, 'e0000000-0000-4000-8000-0000000000ff', 'select public.exchange_template_handoff($1, $2)', ['t', 'u']),
    /does not exist|No function matches/i,
    'the exchange takes the token and nothing else'
  );
  // And none of the eight accepts an owner id in its argument list.
  for (const fn of [
    'get_my_onboarding_status',
    'get_my_owner_workspace',
    'ensure_owner_workspace',
    'get_owner_editor_state',
    'complete_template_onboarding',
    'save_owner_editor_state',
    'create_template_handoff',
    'exchange_template_handoff',
  ]) {
    const args = await rpcArguments(fn);
    assert.doesNotMatch(args, /user_id|owner_id|salon_id|email|partner_id/i, `${fn}(${args})`);
  }
});

test('9.1c the referral and workspace gates are backend state, not URL claims', async () => {
  // No referral: the handoff refuses, and no id in the world changes that
  // (the function has no parameter through which to claim one).
  const unlinked = await signUp(ownerId(), 'handoff.unlinked@example.com');
  await assert.rejects(
    () => rpc(unlinked, 'create_template_handoff', ['state-1']),
    /A verified referral is required before entering the Template App/i
  );

  // Referral but no workspace yet: the save path is what creates it, and the
  // retry that calls ensure_owner_workspace() is the application's own
  // `isMissingOwnerWorkspaceError` fallback (src/lib/ownerEditorState.ts),
  // i.e. authorized backend state rather than a redirect parameter.
  const linked = await referredOwner('handoff.no-workspace@example.com');
  assert.equal((await rpc(linked, 'get_my_owner_workspace')).resolved, false);
  await assert.rejects(
    () => rpc(linked, 'save_owner_editor_state', [{ profile: { businessName: 'X' }, services: [], stylists: [] }]),
    /Select a salon owned by this account/i,
    'the save cannot imagine a workspace into existence'
  );
  await rpc(linked, 'ensure_owner_workspace');
  await saveBusiness(linked);
  assert.equal((await rpc(linked, 'get_my_owner_workspace')).resolved, true, 'the backend state now resolves');

  const source = SOURCE('src/lib/ownerEditorState.ts');
  assert.match(source, /isMissingOwnerWorkspaceError/);
  assert.match(source, /resolveOwnerWorkspace\(db as any\)/, 'the retry is the only provisioning call site');
});

// ===========================================================================
// 9.2 — the cross-origin grant (only needed when the split deployment is on)
// ===========================================================================

test('9.2a the grant is not a session: the exchange returns no credential and a token cannot be used as one', async () => {
  const owner = await referredOwner('handoff.not-a-session@example.com');
  const grant = await rpc(owner, 'create_template_handoff', ['state-1']);
  assert.match(grant.token, /^[0-9a-f]{64}$/);

  const exchanged = await rpc(owner, 'exchange_template_handoff', [grant.token]);
  assert.deepEqual(
    Object.keys(exchanged).sort(),
    ['growth_partner_id', 'onboarding_status', 'referral_code', 'template_started_at', 'user_id'],
    'the redemption returns progress only — never a credential'
  );
  const serialized = JSON.stringify(exchanged);
  assert.doesNotMatch(serialized, /access_token|refresh_token|id_token|password|secret|service_role|apikey|jwt/i);

  // Holding the token grants nothing on the continuation surface: the token is
  // not a bearer credential, and the workspace/editor RPCs do not accept one.
  const anonWorkspace = await asUser(db, '', 'select public.get_my_owner_workspace()', [])
    .then(() => 'allowed')
    .catch((error: Error) => error.message);
  assert.match(String(anonWorkspace), /permission denied|Sign in required/i, 'anon cannot read a workspace at all');

  // The stored row is a hash; there is no session/JWT material in the table.
  const row = (await db.query('select * from public.template_handoffs order by created_at desc limit 1')).rows[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    ['consumed_at', 'created_at', 'destination', 'expires_at', 'growth_partner_id', 'id', 'state', 'token_hash', 'user_id']
  );
  assert.match(row.token_hash, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(row), /eyJ/, 'no JWT anywhere in the grant row');
});

test('9.2b identity query parameters stay inert end to end', async () => {
  // 1) Parsing: only token and state are read, whatever else the URL carries.
  const hostile = '?token=tok&state=st&userId=victim&email=victim%40example.com&ownerId=victim&salonId=victim&partner_id=victim';
  assert.deepEqual(matchTemplateHandoffQuery(hostile), { token: 'tok', state: 'st' });
  assert.deepEqual(Object.keys(matchTemplateHandoffQuery(hostile)).sort(), ['state', 'token']);

  // 2) Consumption: the same URL params passed to the RPC as extra arguments
  //    are impossible (9.1b), and a wrong token fails regardless of them.
  const owner = await referredOwner('handoff.query-params@example.com');
  await assert.rejects(
    () => rpc(owner, 'exchange_template_handoff', ['0000000000000000000000000000000000000000000000000000000000000000']),
    /Invalid onboarding session/i,
    'no query parameter turns a bad token into a session'
  );

  // 3) The token is the only thing in the URL that does anything, and it is
  //    removed afterwards (already pinned in the handoff suite; asserted here
  //    against a hostile URL so the cleanup cannot be bypassed by extra params).
  const cleaned = stripHandoffQuery(
    'https://app.example/onboarding/handoff?token=tok&state=st&userId=victim&email=a%40b.c&next=%2F'
  );
  assert.doesNotMatch(cleaned, /[?&]token=/);
  assert.doesNotMatch(cleaned, /[?&]state=/);
  assert.match(cleaned, /next=%2F/, 'unrelated params survive the cleanup');
  assert.match(cleaned, /userId=victim/, 'inert params survive too — and nothing in the app reads them');

  // 4) The page itself reads nothing else from the query.
  const page = SOURCE('src/components/TemplateHandoffPage.tsx');
  assert.doesNotMatch(page, /searchParams\.get\(['"](userId|user_id|email|ownerId|owner_id|salonId|salon_id|partner_id)['"]\)/i);
  assert.doesNotMatch(page, /localStorage/, 'a handoff page never restores identity from storage');
});

test('9.2c the repo-wide sweep: identity from a query parameter is never authentication on a reachable path', async () => {
  const server = SOURCE('server.ts');
  // Production wiring: every booking route family runs the normalized
  // (bearer-token) path. This is the reachability pin, not a security claim —
  // see the legacy branch below.
  assert.equal((server.match(/normalizedBookings:\s*true/g) || []).length, 3);
  assert.doesNotMatch(server, /normalizedBookings:\s*false/);

  const routes = SOURCE('server/bookingRoutes.ts');
  const listHandler = routes.slice(routes.indexOf('export function createBookingsListHandler'));
  assert.ok(
    listHandler.indexOf('if (deps.normalizedBookings)') < listHandler.indexOf('resolveOwnerScope(deps'),
    'the authenticated normalized handler returns before the query-param scope resolver runs'
  );

  const normalized = SOURCE('server/ownerBookings.ts');
  assert.match(normalized, /db\.auth\.getUser\(token\)/, 'the owner scope comes from the bearer token');
  assert.match(normalized, /status: 401, error: 'Please sign in to load your bookings\.'/);
  assert.match(
    normalized,
    /req\.query\?\.owner_id && req\.query\.owner_id !== userId[\s\S]{0,80}status: 403/,
    'an owner_id that disagrees with the token is refused, not honoured'
  );

  const checkin = SOURCE('server/bookingCheckin.ts');
  assert.ok(
    checkin.indexOf('await verifyBackendUser(deps.db, req)') < checkin.indexOf('req.query?.owner_id'),
    'check-in authenticates before any query parameter is read'
  );

  // The one path that WOULD trust them: resolveOwnerScope() in the legacy,
  // non-normalized generation selects a tenant from ?owner_id / ?email= /
  // ?subdomain= with no authentication, and its handler serves that tenant's
  // bookings on the service-role client. It is unreachable because every wiring
  // in server.ts sets normalizedBookings: true — recorded here so that flipping
  // that flag is a deliberate act, not a silent downgrade.
  assert.match(routes, /export async function resolveOwnerScope/);
  for (const trusted of ["query.owner_id", "query.email", "query.subdomain"]) {
    assert.ok(routes.includes(trusted), `legacy scope resolver still reads ${trusted}`);
  }
  assert.ok(
    routes.includes('Refusing beats leaking every salon'),
    'the legacy branch still requires an owner scope before listing'
  );
});

test('9.2d the split-deployment switch is opt-in, validated, and never identity-bearing', async () => {
  const source = SOURCE('src/onboarding/lib/handoff.ts');
  // Same-origin default: no env var means the current origin (the audit's
  // architecture claim), and the env value is http(s)-validated so a
  // misconfiguration cannot turn the redirect into an open redirector.
  assert.match(source, /VITE_TEMPLATE_APP_URL/);
  assert.match(source, /if \(fromEnv\) return normalizeBaseUrl\(fromEnv\);/);
  assert.match(source, /if \(!\/\^https\?:\\\/\\\/\[\^\/\\s\]\+\/i\.test\(value\)\)/);
  assert.match(source, /'The Template App address is misconfigured\.'/);
  // The redirect carries exactly two parameters.
  assert.match(
    source,
    /return `\$\{prefix\}\$\{TEMPLATE_HANDOFF_ROUTE\}\?token=\$\{encodeURIComponent\(token\)\}&state=\$\{encodeURIComponent\(state\)\}`;/
  );
  // Scoped to the URL builder: the exchange RESULT carries the authenticated
  // user's own id back to the caller (a value, not a parameter), while nothing
  // that constructs a URL mentions any identity.
  const builder = source.slice(
    source.indexOf('export function buildTemplateHandoffUrl'),
    source.indexOf('export function buildOnboardingLoginUrl')
  );
  assert.doesNotMatch(builder, /userId|user_id|ownerId|owner_id|salonId|salon_id|email/i);

  // The audit's verdict, kept as an assertion: the handoff is created ONLY by
  // the onboarding status screen's continue action. Nothing else in the app
  // mints one, so the same-app path is the ordinary session path.
  const app = SOURCE('src/onboarding/OnboardingApp.tsx');
  assert.equal((app.match(/createTemplateHandoff\(/g) || []).length, 1);
  const statusScreen = SOURCE('src/onboarding/screens/StatusScreen.tsx');
  assert.match(statusScreen, /onContinueToTemplateApp/);
});
