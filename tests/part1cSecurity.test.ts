// ============================================================================
// PART 1C FINAL GATE — RLS + Security + Final Part 1 Verification
// ============================================================================
// Consolidated acceptance for PART 1A + 1B + 1C on the FULL migration stack
// (20260912 base + 20260916 hardening + 20260917 link atomicity) applied to
// PGlite with the production auth contract (auth.users + auth.uid() +
// anon/authenticated roles).
//
// LIVE (database enforces; frontend alone is never trusted):
//   C1  RLS enabled + exact SELECT-only policy inventory (no write policies)
//   C2  Table grants: authenticated SELECT-only, anon nothing
//   C3  EXECUTE matrix: user RPCs yes, provision/helpers no client access
//   C4  Every Part-1 RPC is SECURITY DEFINER with pinned search_path
//   C5  Normal-user security: no self-promote, no fake links, no partner reads
//   C6  Cross-partner isolation: A↔A only, B↔B only
//   C7  Privilege-escalation matrix: all 7 attacks fail
//   C8  RLS + RPC consistency: direct access and RPC enforce the same rules
//   C9  Full Part-1 acceptance flow (provision → link → own → isolate → keep)
//
// STATIC (source-tree guarantees):
//   C10 Single Supabase project / Auth / client singleton
//   C11 Service-role key never browser-exposed
//   C12 No frontend authorization trust (URL/storage/role/partner identity)
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_A = 'b0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000002';
const USER_C = 'b0000000-0000-4000-8000-000000000003';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const BASE = read('supabase/migrations/20260912_growth_partner_onboarding.sql');
const HARDENING = read('supabase/migrations/20260916_part1_referral_hardening.sql');
const ATOMICITY = read('supabase/migrations/20260917_part1b_link_atomicity.sql');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id, email) values
      ('${PARTNER_A}', 'anita@example.com'), ('${PARTNER_B}', 'bala@example.com'),
      ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com'), ('${USER_C}', 'c@example.com');
    insert into public.profiles(id, full_name) values
      ('${PARTNER_A}', 'Partner Anita'), ('${PARTNER_B}', 'Partner Bala');
  `);
  await db.exec(BASE);
  await db.exec(HARDENING);
  await db.exec(ATOMICITY);
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
// C1 — RLS enabled + exact policy inventory on the full stack.
// ---------------------------------------------------------------------------

test('Part1C-C1: RLS enabled, exactly two SELECT-only policies (no write path)', async () => {
  const db = await setup();
  try {
    for (const table of ['growth_partners', 'growth_onboarding']) {
      const rls = await db.query<any>(
        `select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = $1`,
        [table]
      );
      assert.equal(rls.rows[0].relrowsecurity, true, `RLS must be enabled on ${table}`);
    }
    const policies = await db.query<any>(
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
    // No INSERT/UPDATE/DELETE policy may ever exist on these tables.
    const writes = policies.rows.filter((r: any) => r.cmd !== 'SELECT');
    assert.deepEqual(writes, []);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C2 — Table grants: authenticated SELECT-only, anon nothing.
// ---------------------------------------------------------------------------

test('Part1C-C2: authenticated holds SELECT-only grants; anon holds nothing', async () => {
  const db = await setup();
  try {
    const grants = await db.query<any>(
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

// ---------------------------------------------------------------------------
// C3 — EXECUTE matrix on the full stack (incl. atomicity re-assertion).
// ---------------------------------------------------------------------------

test('Part1C-C3: EXECUTE matrix — user RPCs yes, provision/helpers blocked', async () => {
  const db = await setup();
  try {
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
    for (const fn of [
      'public.provision_growth_partner(uuid, text, boolean)',
      'public.provision_growth_partner_by_email(text, text, boolean)',
      'public.growth_normalize_code(text)',
      'public.growth_partner_display_name(uuid)',
      'public.growth_touch_updated_at()',
    ]) {
      assert.equal(await can('authenticated', fn), false, `authenticated must NOT execute ${fn}`);
      assert.equal(await can('anon', fn), false, `anon must NOT execute ${fn}`);
    }
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C4 — SECURITY DEFINER + pinned search_path for every Part-1 RPC.
// ---------------------------------------------------------------------------

test('Part1C-C4: every Part-1 routine pins search_path; RPCs are DEFINER', async () => {
  const db = await setup();
  try {
    const rows = (
      await db.query<any>(
        `select proname, prosecdef, proconfig from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('validate_growth_referral_code', 'link_my_growth_referral',
                           'get_my_growth_referral', 'get_my_onboarding_status',
                           'update_my_onboarding_progress', 'provision_growth_partner',
                           'provision_growth_partner_by_email', 'growth_normalize_code',
                           'growth_partner_display_name', 'growth_touch_updated_at')`
      )
    ).rows as any[];
    assert.equal(rows.length, 10, 'all ten Part-1 routines must exist exactly once (no overloads)');
    const definer = new Set([
      'validate_growth_referral_code',
      'link_my_growth_referral',
      'get_my_growth_referral',
      'get_my_onboarding_status',
      'update_my_onboarding_progress',
      'provision_growth_partner',
      'provision_growth_partner_by_email',
    ]);
    for (const row of rows) {
      assert.equal(row.prosecdef, definer.has(row.proname), `${row.proname} DEFINER flag`);
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
// C5 — Normal-user security.
// ---------------------------------------------------------------------------

test('Part1C-C5: normal users cannot self-promote, fake links, or read partner data', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);

    // Cannot become a partner (table write denied + RPC denied).
    const selfServe = await captureError(
      asUser(db, USER_C, 'insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)', [
        USER_C,
        'HACKED1',
      ])
    );
    assert.match(selfServe.message, /permission denied|row-level security/i);
    const rpcDenied = await captureError(
      asUser(db, USER_C, 'select public.provision_growth_partner($1::uuid, $2)', [USER_C, 'HACKED1'])
    );
    assert.match(rpcDenied.message, /permission denied for function/i);
    const emailDenied = await captureError(
      asUser(db, USER_C, `select public.provision_growth_partner_by_email('c@example.com')`)
    );
    assert.match(emailDenied.message, /permission denied for function/i);

    // Cannot insert a fake referral relationship.
    const fake = await captureError(
      asUser(db, USER_C, 'insert into public.growth_onboarding(user_id, status) values ($1::uuid, $2)', [
        USER_C,
        'linked',
      ])
    );
    assert.match(fake.message, /permission denied|row-level security/i);

    // Cannot read partner-private data (partner rows / other users' links).
    assert.deepEqual((await asUser(db, USER_C, 'select * from public.growth_partners')).rows, []);
    assert.deepEqual((await asUser(db, USER_C, 'select * from public.growth_onboarding')).rows, []);
    assert.deepEqual((await asUser(db, USER_B, 'select * from public.growth_partners')).rows, []);
    const cross = await asUser(db, USER_B, 'select * from public.growth_onboarding where user_id = $1::uuid', [
      USER_A,
    ]);
    assert.deepEqual(cross.rows, []);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C6 — Cross-partner isolation.
// ---------------------------------------------------------------------------

test('Part1C-C6: Partner A sees only User A, Partner B only User B', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);
    await rpc(db, USER_B, 'link_my_growth_referral', [CODE_B]);

    const seenByA = await asUser(db, PARTNER_A, 'select user_id from public.growth_onboarding order by user_id');
    assert.deepEqual(
      seenByA.rows.map((r: any) => r.user_id),
      [USER_A]
    );
    const seenByB = await asUser(db, PARTNER_B, 'select user_id from public.growth_onboarding order by user_id');
    assert.deepEqual(
      seenByB.rows.map((r: any) => r.user_id),
      [USER_B]
    );
    // Partners cannot see each other's codes either.
    const codesA = await asUser(db, PARTNER_A, 'select referral_code from public.growth_partners');
    assert.deepEqual(
      codesA.rows.map((r: any) => r.referral_code),
      [CODE_A]
    );
    const codesB = await asUser(db, PARTNER_B, 'select referral_code from public.growth_partners');
    assert.deepEqual(
      codesB.rows.map((r: any) => r.referral_code),
      [CODE_B]
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C7 — Privilege-escalation matrix (all 7 task attacks fail).
// ---------------------------------------------------------------------------

test('Part1C-C7: all privilege-escalation attempts fail at the database', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);

    const attacks: Array<[string, string, string, any[]]> = [
      ['1 self-promote to partner', USER_C, 'insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)', [USER_C, 'HACKED1']],
      ['2 set own partner link', USER_C, 'insert into public.growth_onboarding(user_id, growth_partner_id, referral_code, linked_at) values ($1::uuid, $2::uuid, $3, now())', [USER_C, PARTNER_A, CODE_A]],
      ['3 change referral owner', USER_A, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_A]],
      ["4 set another user's owner", USER_B, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_A]],
      ['6 modify partner fields', USER_A, `update public.growth_partners set is_active = false where user_id = '${PARTNER_A}'`, []],
      ['6b rotate partner code', PARTNER_A, `update public.growth_partners set referral_code = 'HACKED1' where user_id = '${PARTNER_A}'`, []],
      ['7 delete relationship', USER_A, `delete from public.growth_onboarding where user_id = '${USER_A}'`, []],
      ['7b delete partner row', USER_A, `delete from public.growth_partners where user_id = '${PARTNER_A}'`, []],
    ];
    for (const [label, attacker, sql, params] of attacks) {
      const err = await captureError(asUser(db, attacker, sql, params));
      assert.match(err.message, /permission denied|row-level security/i, label);
    }

    // Attack 5: read another partner's referrals (RLS scoping, not an error path).
    const leaked = await asUser(
      db,
      PARTNER_A,
      'select * from public.growth_onboarding where growth_partner_id = $1::uuid',
      [PARTNER_B]
    );
    assert.deepEqual(leaked.rows, [], '5 cross-partner referral read must return zero rows');

    // Ownership byte-identical after every attack.
    const row = (await db.query<any>('select * from public.growth_onboarding where user_id = $1::uuid', [USER_A]))
      .rows[0];
    assert.equal(row.growth_partner_id, PARTNER_A);
    assert.equal(row.referral_code, CODE_A);
    assert.equal(row.status, 'linked');
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C8 — RLS + RPC consistency (same rules via direct access and RPC).
// ---------------------------------------------------------------------------

test('Part1C-C8: RPC and direct access enforce identical ownership rules', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);

    // RPC read-back and direct read-back agree (partner sees own referral both ways).
    const direct = await asUser(db, PARTNER_A, 'select user_id, growth_partner_id from public.growth_onboarding');
    assert.equal(direct.rows.length, 1);
    const viaRpc = await rpc(db, USER_A, 'get_my_growth_referral');
    assert.equal(viaRpc.growth_partner_id, direct.rows[0].growth_partner_id);

    // Neither path leaks the other partner's data.
    assert.equal(await rpc(db, USER_B, 'get_my_growth_referral'), null);
    assert.deepEqual(
      (await asUser(db, USER_B, 'select * from public.growth_onboarding where user_id = $1::uuid', [USER_A])).rows,
      []
    );

    // Validation reveals no identity (RPC cannot be used as an oracle for
    // data that direct reads deny).
    const keys = Object.keys(await rpc(db, USER_B, 'validate_growth_referral_code', [CODE_A]));
    assert.deepEqual(keys.sort(), ['referral_code', 'valid']);

    // RPC failures are safe copy (no schema/SQL/identifier leak).
    const err = await captureError(rpc(db, USER_C, 'link_my_growth_referral', ['NOPE99']));
    assert.doesNotMatch(err.message, /growth_onboarding|growth_partners|auth\.users|select |insert |stack/i);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C9 — Full Part-1 acceptance flow.
// ---------------------------------------------------------------------------

test('Part1C-C9: full Part-1 flow — provision, link, own, isolate, keep', async () => {
  const db = await setup();
  try {
    // 1-2. Partner + unique code exist (server-side).
    const provisioned = (
      await db.query<any>('select public.provision_growth_partner($1::uuid, $2) as result', [PARTNER_A, CODE_A])
    ).rows[0].result;
    assert.equal(provisioned.referral_code, CODE_A);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);

    // 3-4. Authenticated user links a valid code to the CORRECT partner.
    const linked = await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);
    assert.equal(linked.growth_partner_id, PARTNER_A);

    // 5+10. Ownership protected; duplicates refused, single row.
    await assert.rejects(rpc(db, USER_A, 'link_my_growth_referral', [CODE_B]), /already linked/);
    const n = await db.query<any>('select count(*)::int as n from public.growth_onboarding');
    assert.equal(n.rows[0].n, 1);

    // 6-7. Isolation: partner B and normal users see none of it.
    assert.deepEqual(
      (await asUser(db, PARTNER_B, 'select * from public.growth_onboarding')).rows,
      []
    );
    assert.deepEqual((await asUser(db, USER_C, 'select * from public.growth_onboarding')).rows, []);

    // 8-9. Self-promotion + direct writes fail (covered in C5/C7; spot-check).
    const denied = await captureError(
      asUser(db, USER_C, 'insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)', [
        USER_C,
        'HACKED1',
      ])
    );
    assert.match(denied.message, /permission denied|row-level security/i);

    // Data survives a full-stack re-apply.
    const before = (await db.query<any>('select * from public.growth_onboarding order by user_id')).rows;
    await db.exec(BASE);
    await db.exec(HARDENING);
    await db.exec(ATOMICITY);
    assert.deepEqual((await db.query<any>('select * from public.growth_onboarding order by user_id')).rows, before);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// C10 — Single Supabase project / Auth / client singleton.
// ---------------------------------------------------------------------------

test('Part1C-C10: one shared Supabase project, Auth, and client singleton', () => {
  for (const file of [
    'src/onboarding/lib/auth.ts',
    'src/onboarding/lib/handoff.ts',
    'src/onboarding/OnboardingApp.tsx',
    'src/App.tsx',
    'src/components/AuthModal.tsx',
  ]) {
    assert.match(read(file), /from ['"]\.\.?\/.*lib\/supabaseClient['"]/, `${file} must use the shared singleton`);
  }
  const allowed = new Set([
    'src/lib/supabaseClient.ts',
    'src/lib/readPartnerProfile.ts',
    'server/backendContext.ts',
    'server/staffPerformanceRoutes.ts',
  ]);
  for (const file of allSourceFiles('src').concat(allSourceFiles('server'), allSourceFiles('api'))) {
    if (read(file).includes('createClient(')) {
      assert.ok(allowed.has(file), `unexpected createClient site (possible second auth system): ${file}`);
    }
  }
  // Exactly one profile table across all migrations; trigger on auth.users.
  const profileTables = new Set<string>();
  for (const file of readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))) {
    const body = read(`supabase/migrations/${file}`)
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    assert.doesNotMatch(body, /password/i, `${file} must not store passwords`);
    for (const m of body.matchAll(/create table (?:if not exists )?public\.([a-z_]*profile[a-z_]*)/gi)) {
      profileTables.add(m[1].toLowerCase());
    }
  }
  assert.deepEqual([...profileTables].sort(), ['profiles']);
  const init = read('supabase/migrations/00001_init.sql');
  assert.match(init, /create trigger on_auth_user_created[\s\S]*?on auth\.users/i);
});

// ---------------------------------------------------------------------------
// C11 — Service-role key never browser-exposed.
// ---------------------------------------------------------------------------

test('Part1C-C11: service-role key cannot reach the browser', () => {
  for (const file of allSourceFiles('src')) {
    assert.doesNotMatch(read(file), /VITE_\w*SERVICE/i, `${file} must not reference a VITE service key`);
    assert.doesNotMatch(
      read(file),
      /VITE_[A-Za-z_]*(SECRET|ADMIN|PRIVATE)/,
      `${file} must not reference a VITE secret`
    );
  }
  const client = read('src/lib/supabaseClient.ts');
  assert.match(client, /getEnvVar\('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'\)/);
  assert.match(client, /if \(typeof process === 'undefined'\) return null; \/\/ browser/);
  assert.match(client, /!isBrowser && hasServiceKey/);
  for (const file of allSourceFiles('src')) {
    if (file === 'src/lib/supabaseClient.ts') continue;
    assert.doesNotMatch(read(file), /getSupabaseAdmin|supabaseAdmin/, `${file} must not touch the admin client`);
  }
  // Server-only importers (exact allowlist).
  const importers = allSourceFiles('server')
    .concat(allSourceFiles('api'))
    .filter((f) => /getSupabaseAdmin|supabaseAdmin/.test(read(f)));
  assert.deepEqual(importers.sort(), ['api/index.ts', 'server/websiteSave.ts']);
});

// ---------------------------------------------------------------------------
// C12 — No frontend authorization trust.
// ---------------------------------------------------------------------------

test('Part1C-C12: no URL/storage/role-based authorization trust in the client', () => {
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

  // No direct client writes to the protected growth tables (reads: one
  // SELECT-own-row call site; writes: none).
  for (const file of allSourceFiles('src')) {
    const src = read(file);
    if (/growth_(partners|onboarding)/.test(src)) {
      assert.doesNotMatch(
        src,
        /\.from\(['"]growth_(partners|onboarding)['"]\)\s*\.\s*(insert|update|upsert|delete)\b/,
        `${file} must not write growth tables directly`
      );
    }
  }
  // Link/validate call sites pass only the code string.
  const clientSrc = read('src/lib/growthPartner.ts');
  assert.match(clientSrc, /rpc\('link_my_growth_referral', \{\s*p_code:/);
  assert.match(clientSrc, /rpc\('validate_growth_referral_code', \{\s*p_code:/);
  assert.match(read('src/onboarding/lib/auth.ts'), /rpc\('link_my_growth_referral', \{ p_code:/);
});
