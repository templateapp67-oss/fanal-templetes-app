import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';

// ============================================================================
// PART 1 ACCEPTANCE — Shared Supabase + Auth + Identity + Roles + Referral
// ============================================================================
// Executable gate for PART 1A + 1B + 1C. Every test below maps to a Part 1
// must-pass criterion. Static tests pin the source-tree guarantees; live
// tests apply the REAL migration file to PGlite and attack the backend as
// unprivileged roles (never through the UI).
//
//   1A: single project/client/auth/profile/role architecture
//   1B: referral code + relationship data model
//   1C: RLS, grants, isolation, privilege-escalation protection
// ============================================================================

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const migrationFiles = () =>
  readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
const stripSqlComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

function allSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) allSourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1A — Shared Supabase project: ONE client singleton for both apps
// ---------------------------------------------------------------------------

test('Part1-1A: onboarding app and template app share the same supabase singleton', () => {
  const onboardingImports = [
    'src/onboarding/lib/auth.ts',
    'src/onboarding/lib/handoff.ts',
    'src/onboarding/OnboardingApp.tsx',
  ];
  const templateImports = ['src/App.tsx', 'src/components/AuthModal.tsx'];
  for (const file of [...onboardingImports, ...templateImports]) {
    const src = read(file);
    assert.match(src, /from ['"]\.\.?\/.*lib\/supabaseClient['"]/, `${file} must import the shared singleton`);
  }
  // No second persistent-session client may exist: only the singleton module
  // plus the two documented per-request token-bound clients and the
  // server-only admin clients may call createClient.
  const allowed = new Set([
    'src/lib/supabaseClient.ts',
    'src/lib/readPartnerProfile.ts',
    'server/backendContext.ts',
    'server/staffPerformanceRoutes.ts',
  ]);
  for (const file of allSourceFiles('src').concat(allSourceFiles('server'), allSourceFiles('api'))) {
    if (read(file).includes('createClient(')) {
      assert.ok(allowed.has(file), `unexpected createClient call site (possible second auth system): ${file}`);
    }
  }
});

test('Part1-1A: auth is Supabase Auth only — no password storage, no parallel identity', () => {
  for (const file of migrationFiles()) {
    const body = stripSqlComments(read(`supabase/migrations/${file}`));
    assert.doesNotMatch(body, /password/i, `${file} must not store passwords (comments stripped)`);
  }
  // Exactly one profile table in the whole migration history.
  const profileTables = new Set<string>();
  for (const file of migrationFiles()) {
    const body = stripSqlComments(read(`supabase/migrations/${file}`));
    for (const m of body.matchAll(/create table (?:if not exists )?public\.([a-z_]*profile[a-z_]*)/gi)) {
      profileTables.add(m[1].toLowerCase());
    }
  }
  assert.deepEqual([...profileTables].sort(), ['profiles']);
  // Automatic profile creation: handle_new_user trigger on auth.users.
  const init = read('supabase/migrations/00001_init.sql');
  assert.match(init, /create trigger on_auth_user_created[\s\S]*?on auth\.users/i);
  assert.match(init, /insert into public\.profiles \(id, email, full_name\)\s*values \(\s*new\.id,/i);
  // profiles.id is the auth.users foreign key (no email-based identity).
  assert.match(init, /id\s+uuid primary key references auth\.users\(id\) on delete cascade/i);
});

test('Part1-1A/1C: service-role key can never reach the browser', () => {
  for (const file of allSourceFiles('src')) {
    assert.doesNotMatch(read(file), /VITE_\w*SERVICE/i, `${file} must not reference a VITE service key`);
  }
  const client = read('src/lib/supabaseClient.ts');
  // Service key is read from non-VITE names only (Vite never bundles those).
  assert.match(client, /getEnvVar\('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'\)/);
  // Browser guard on the admin getter + on the service-key fallback.
  assert.match(client, /if \(typeof process === 'undefined'\) return null; \/\/ browser/);
  assert.match(client, /!isBrowser && hasServiceKey/);
  // Only server entry points may import the admin client.
  for (const file of allSourceFiles('src')) {
    if (file === 'src/lib/supabaseClient.ts') continue; // the guarded definer itself
    assert.doesNotMatch(
      read(file),
      /getSupabaseAdmin|supabaseAdmin/,
      `${file} must not touch the admin client`
    );
  }
});

test('Part1-1A/1C: no role, partner or user identity is trusted from client state', () => {
  const offenders: string[] = [];
  for (const file of allSourceFiles('src')) {
    const src = read(file);
    if (
      /localStorage.*role|role.*localStorage|sessionStorage.*role|role.*sessionStorage/i.test(src) ||
      /searchParams.*(partner|user_id|role)|(partner_id|user_id).*searchParams/i.test(src) ||
      /Authorization.*referral|referral.*Authorization/i.test(src)
    ) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// Live backend: apply the REAL referral migration to PGlite
// ---------------------------------------------------------------------------

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_A = 'b0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000002';
const USER_C = 'b0000000-0000-4000-8000-000000000003';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = read('supabase/migrations/20260912_growth_partner_onboarding.sql');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id) values
      ('${PARTNER_A}'), ('${PARTNER_B}'), ('${USER_A}'), ('${USER_B}'), ('${USER_C}');
    insert into public.profiles(id, full_name) values
      ('${PARTNER_A}', 'Partner Anita'), ('${PARTNER_B}', 'Partner Bala');
  `);
  await db.exec(MIGRATION);
  return db;
}

async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}

async function captureError(promise: Promise<any>) {
  try {
    await promise;
  } catch (err: any) {
    return err;
  }
  assert.fail('expected the statement to fail, but it succeeded');
}

// ---------------------------------------------------------------------------
// 1C — RLS + grants + function inventory, straight from the catalogs
// ---------------------------------------------------------------------------

test('Part1-1C: RLS is enabled and the policy inventory is exactly as designed', async () => {
  const db = await setup();
  try {
    for (const table of ['growth_partners', 'growth_onboarding']) {
      const rls = await db.query<any>(
        `select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = $1`,
        [table]
      );
      assert.equal(rls.rows[0].relrowsecurity, true, `RLS must be enabled on ${table}`);
    }
    // Any future migration that adds a permissive policy breaks this test.
    const policies = await db.query(
      `select tablename, policyname, cmd from pg_policies
       where schemaname = 'public' and tablename in ('growth_partners', 'growth_onboarding')
       order by tablename, policyname`
    );
    assert.deepEqual(
      policies.rows.map((r: any) => `${r.tablename}.${r.policyname}.${r.cmd}`),
      [
        'growth_onboarding.growth_onboarding_select_own_or_partner.SELECT',
        'growth_partners.growth_partners_select_own.SELECT',
      ]
    );
  } finally {
    await db.close();
  }
});

test('Part1-1C: authenticated clients hold SELECT-only table grants; anon holds nothing', async () => {
  const db = await setup();
  try {
    const grants = await db.query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in ('growth_partners', 'growth_onboarding')
         and grantee in ('authenticated', 'anon')
       order by table_name, privilege_type`
    );
    assert.deepEqual(
      grants.rows.map((r: any) => `${r.table_name}.${r.privilege_type}`),
      ['growth_onboarding.SELECT', 'growth_partners.SELECT']
    );
  } finally {
    await db.close();
  }
});

test('Part1-1C: EXECUTE matrix — users can run user RPCs, nobody client-side can provision', async () => {
  const db = await setup();
  try {
    // allowlist is hardcoded below (no client input); names are inlined because
    // the PGlite driver cannot bind a regprocedure parameter.
    const can = async (role: string, fn: string) =>
      (
        await db.query<any>(
          `select has_function_privilege('${role}', '${fn}'::regprocedure, 'EXECUTE') as ok`
        )
      ).rows[0].ok;
    for (const fn of [
      'public.validate_growth_referral_code(text)',
      'public.link_my_growth_referral(text)',
      'public.get_my_growth_referral()',
      'public.get_my_onboarding_status()',
      'public.update_my_onboarding_progress(text)',
    ]) {
      assert.equal(await can('authenticated', fn), true, `authenticated must execute ${fn}`);
      assert.equal(await can('anon', fn), false, `anon must NOT execute ${fn}`);
    }
    assert.equal(
      await can('authenticated', 'public.provision_growth_partner(uuid, text, boolean)'),
      false,
      'authenticated must NOT execute provision_growth_partner'
    );
    assert.equal(
      await can('anon', 'public.provision_growth_partner(uuid, text, boolean)'),
      false,
      'anon must NOT execute provision_growth_partner'
    );
  } finally {
    await db.close();
  }
});

test('Part1-1C: every growth RPC is SECURITY DEFINER with a pinned search_path', async () => {
  const db = await setup();
  try {
    const rows = (
      await db.query(
        `select proname, prosecdef, proconfig from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('validate_growth_referral_code', 'link_my_growth_referral',
                           'get_my_growth_referral', 'get_my_onboarding_status',
                           'update_my_onboarding_progress', 'provision_growth_partner')`
      )
    ).rows as any[];
    assert.equal(rows.length, 6, 'all six referral RPCs must exist exactly once (no duplicate overloads)');
    for (const row of rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
      assert.ok(
        (row.proconfig || []).some((c: string) => c.startsWith('search_path=')),
        `${row.proname} must pin search_path`
      );
    }
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 1B + 1C — Acceptance matrix: Partner A/B × User A/B, attacked at the DB
// ---------------------------------------------------------------------------

test('Part1-1B/1C: referral acceptance — link, isolation, immutability, attacks', async () => {
  const db = await setup();
  try {
    // Admin provisions Partner A (active) and Partner B (active).
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);

    // Valid code -> linked to the CORRECT partner; invalid -> rejected, no row.
    assert.equal((await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A])).growth_partner_id, PARTNER_A);
    await assert.rejects(rpc(db, USER_B, 'link_my_growth_referral', ['NOPE99']), /Invalid or inactive/);
    assert.equal(await rpc(db, USER_B, 'get_my_growth_referral'), null);
    await rpc(db, USER_B, 'link_my_growth_referral', [CODE_B]);

    // Duplicate request -> refused, still exactly one relationship row.
    await assert.rejects(rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]), /already linked/);
    const count = await db.query<any>('select count(*)::int as n from public.growth_onboarding');
    assert.equal(count.rows[0].n, 2);

    // Partner A reads User A but NOT User B; Partner B the mirror.
    const seenByA = await asUser(
      db,
      PARTNER_A,
      'select user_id from public.growth_onboarding order by user_id'
    );
    assert.deepEqual(
      seenByA.rows.map((r: any) => r.user_id),
      [USER_A]
    );
    const seenByB = await asUser(
      db,
      PARTNER_B,
      'select user_id from public.growth_onboarding order by user_id'
    );
    assert.deepEqual(
      seenByB.rows.map((r: any) => r.user_id),
      [USER_B]
    );
    // Partners cannot see each other's codes or rows.
    const codesSeenByA = await asUser(db, PARTNER_A, 'select referral_code from public.growth_partners');
    assert.deepEqual(
      codesSeenByA.rows.map((r: any) => r.referral_code),
      [CODE_A]
    );

    // Normal user sees only self, never partner-level data.
    const seenByUserC = await asUser(db, USER_C, 'select * from public.growth_onboarding');
    assert.deepEqual(seenByUserC.rows, []);
    const partnersSeenByUser = await asUser(db, USER_A, 'select * from public.growth_partners');
    assert.deepEqual(partnersSeenByUser.rows, []);

    // Attack matrix: every unauthorized write is denied at the database.
    for (const [attacker, sql, params] of [
      [USER_A, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_A]],
      [USER_B, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_A]],
      [USER_C, 'insert into public.growth_onboarding(user_id, status) values ($1::uuid, $2)', [USER_C, 'linked']],
      [USER_A, `update public.growth_onboarding set status = 'template_completed' where user_id = '${USER_A}'`, []],
      [USER_A, `delete from public.growth_onboarding where user_id = '${USER_A}'`, []],
      [USER_A, 'insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)', [USER_A, 'HACKED1']],
      [USER_A, `update public.growth_partners set is_active = false where user_id = '${PARTNER_A}'`, []],
      [USER_A, `delete from public.growth_partners where user_id = '${PARTNER_A}'`, []],
    ] as Array<[string, string, any[]]>) {
      const err = await captureError(asUser(db, attacker, sql, params));
      assert.match(err.message, /permission denied|row-level security/i, sql);
    }

    // Safe errors only: RPC failures never leak SQL, schema or identifiers.
    const err = await captureError(rpc(db, USER_C, 'link_my_growth_referral', ['NOPE99']));
    assert.doesNotMatch(err.message, /growth_onboarding|growth_partners|auth\.users|select |insert |stack/i);

    // Ownership byte-identical after every attack.
    const row = (
      await db.query<any>('select * from public.growth_onboarding where user_id = $1::uuid', [USER_A])
    ).rows[0];
    assert.equal(row.growth_partner_id, PARTNER_A);
    assert.equal(row.referral_code, CODE_A);
    assert.equal(row.status, 'linked');
  } finally {
    await db.close();
  }
});
