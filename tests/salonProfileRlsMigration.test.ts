import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * Website Editor save permissions (migration 20261010).
 *
 * The editor's cloud save runs public.save_owner_editor_state() →
 * public.nexora_save_owner_workspace() (SECURITY DEFINER) →
 * public.sync_owner_contact() (SECURITY INVOKER). The last hop writes
 * public.profiles and public.owner_editor_state AS THE SIGNED-IN OWNER, so the
 * save fails with a permission error whenever the authenticated role lacks the
 * table/column GRANTs or the owner-scoped RLS policy is missing — the red
 * "Database permission problem" toast.
 *
 * These tests run the real migration file against PGlite (a real Postgres
 * engine) and prove:
 *   • the requested owner policy exists and is scoped to the row owner,
 *   • the authenticated role can read/insert/update/delete its OWN row,
 *   • another signed-in user can neither see nor write it (cross-tenant),
 *   • the migration is idempotent and cannot fail on a schema that is missing
 *     optional columns (the reason a half-applied project ended up with no
 *     grants at all).
 */

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER_OWNER = '10000000-0000-4000-8000-000000000002';

const MIGRATION_PATH = new URL(
  '../supabase/migrations/20261010_salon_profile_rls_and_grants.sql',
  import.meta.url
);

function migrationSql(): Promise<string> {
  return readFile(MIGRATION_PATH, 'utf8');
}

/** A schema slice close to production: profiles + owner_editor_state + salons. */
async function schemaDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text,
      email text,
      phone text,
      mobile text,
      whatsapp text,
      pincode text,
      postal_code text,
      city text,
      preferred_city text,
      area text,
      preferred_area text,
      state text,
      landmark text,
      latitude numeric,
      longitude numeric,
      avatar_url text,
      photo_url text,
      owner_photo_url text,
      date_of_birth date,
      subdomain text unique
    );
    create table public.owner_editor_state (
      owner_id uuid primary key references auth.users(id) on delete cascade,
      state jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table public.salons (
      id uuid primary key,
      owner_id uuid,
      slug text,
      name text,
      phone text,
      mobile text,
      whatsapp text,
      email text,
      address text,
      city text,
      area text,
      state text,
      pincode text,
      landmark text,
      latitude numeric,
      longitude numeric,
      data jsonb
    );
    insert into auth.users values ('${OWNER}'), ('${OTHER_OWNER}');
  `);
  return db;
}

/** The classic deployment shape: the same logical table named `salon_profiles`. */
async function classicSchemaDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.salon_profiles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      full_name text,
      phone text,
      city text
    );
    insert into auth.users values ('${OWNER}'), ('${OTHER_OWNER}');
  `);
  return db;
}

/** Run SQL as a signed-in PostgREST caller (auth.uid() = userId). */
async function asUser(db: any, userId: string | null, sql: string, params?: any[]) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || '']);
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

test('the migration creates the owner-scoped "insert/update their own profile" policy', async () => {
  const db = await schemaDb();
  try {
    await db.exec(await migrationSql());

    const policies = await db.query<any>(
      `select policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'profiles'
        order by policyname`
    );
    const names = policies.rows.map((row) => row.policyname);
    for (const expected of [
      'Users can insert/update their own profile',
      'profiles_select_owner',
      'profiles_insert_owner',
      'profiles_update_owner',
      'profiles_delete_owner',
    ]) {
      assert.ok(names.includes(expected), `missing policy: ${expected} (found ${names.join(', ')})`);
    }

    const combined = policies.rows.find(
      (row) => row.policyname === 'Users can insert/update their own profile'
    );
    assert.equal(combined.cmd, 'ALL');
    assert.deepEqual(combined.roles, ['authenticated'], 'the combined policy is scoped to authenticated');
    // profiles is keyed on `id` in this schema; the issue's `user_id` spelling
    // is the same owner column on the classic website_profiles shape.
    assert.match(combined.qual, /auth\.uid\(\) = id/);
    assert.match(combined.with_check, /auth\.uid\(\) = id/);

    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.profiles'::regclass`
    );
    assert.equal(rls.rows[0].relrowsecurity, true, 'RLS must be enabled on public.profiles');
  } finally {
    await db.close();
  }
});

test('the migration grants the authenticated role full DML on the salon profile table', async () => {
  const db = await schemaDb();
  try {
    await db.exec(await migrationSql());
    const privileges = await db.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
    }>(
      `select has_table_privilege('authenticated', 'public.profiles', 'SELECT') as can_select,
              has_table_privilege('authenticated', 'public.profiles', 'INSERT') as can_insert,
              has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as can_update,
              has_table_privilege('authenticated', 'public.profiles', 'DELETE') as can_delete,
              has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') as can_truncate,
              has_table_privilege('authenticated', 'public.profiles', 'REFERENCES') as can_references,
              has_table_privilege('authenticated', 'public.profiles', 'TRIGGER') as can_trigger`
    );
    assert.equal(privileges.rows[0].can_select, true);
    assert.equal(privileges.rows[0].can_insert, true);
    assert.equal(privileges.rows[0].can_update, true);
    assert.equal(privileges.rows[0].can_delete, true);
    // The migration applies the literal `GRANT ALL` and then revokes the
    // privileges that are NOT row-scoped: TRUNCATE bypasses RLS (any signed-in
    // user could wipe every salon profile), REFERENCES/TRIGGER are unused.
    assert.equal(privileges.rows[0].can_truncate, false, 'TRUNCATE must never be granted (bypasses RLS)');
    assert.equal(privileges.rows[0].can_references, false);
    assert.equal(privileges.rows[0].can_trigger, false);

    // The editor-state row the save transaction upserts as the caller.
    const statePrivileges = await db.query<any>(
      `select has_table_privilege('authenticated', 'public.owner_editor_state', 'INSERT') as can_insert,
              has_table_privilege('authenticated', 'public.owner_editor_state', 'UPDATE') as can_update`
    );
    assert.equal(statePrivileges.rows[0].can_insert, true);
    assert.equal(statePrivileges.rows[0].can_update, true);
  } finally {
    await db.close();
  }
});

test('an owner can insert/update their own profile row but no other owner can', async () => {
  const db = await schemaDb();
  try {
    await db.exec(await migrationSql());

    // Own row: INSERT (first save) and UPDATE (every later save).
    await asUser(db, OWNER, `insert into public.profiles (id, full_name) values ($1, 'Uma')`, [OWNER]);
    await asUser(db, OWNER, `update public.profiles set phone = '+91 90000 00000' where id = $1`, [OWNER]);
    const own = await asUser(db, OWNER, `select full_name, phone from public.profiles where id = $1`, [OWNER]);
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].phone, '+91 90000 00000');

    // Another signed-in user cannot see or touch that row (cross-tenant).
    const hidden = await asUser(db, OTHER_OWNER, `select * from public.profiles where id = $1`, [OWNER]);
    assert.equal(hidden.rows.length, 0, 'RLS must hide other owners’ profile rows');
    const stolen = await asUser(db, OTHER_OWNER, `update public.profiles set full_name = 'stolen' where id = $1`, [OWNER]);
    assert.equal(stolen.affectedRows, 0, 'RLS must not update another owner’s row');
    await assert.rejects(
      asUser(db, OTHER_OWNER, `insert into public.profiles (id, full_name) values ($1, 'impostor')`, [OWNER]),
      /row-level security|violates/i,
      'inserting a row for another auth user must be rejected by the WITH CHECK clause'
    );

    // Anonymous visitors never hold a write privilege on the profile table.
    await assert.rejects(
      asUser(db, null, `insert into public.profiles (id, full_name) values ($1, 'anon')`, [OWNER]),
      /permission denied/i
    );
  } finally {
    await db.close();
  }
});

test('owner_editor_state is write-protected to the owning session too', async () => {
  const db = await schemaDb();
  try {
    await db.exec(await migrationSql());
    await asUser(db, OWNER, `insert into public.owner_editor_state (owner_id, state) values ($1, '{}'::jsonb)`, [OWNER]);
    await asUser(db, OWNER, `update public.owner_editor_state set state = '{"profile":{}}'::jsonb where owner_id = $1`, [OWNER]);
    await assert.rejects(
      asUser(db, OTHER_OWNER, `insert into public.owner_editor_state (owner_id, state) values ($1, '{}'::jsonb)`, [OWNER]),
      /row-level security|violates/i
    );
    const seen = await asUser(db, OTHER_OWNER, `select * from public.owner_editor_state where owner_id = $1`, [OWNER]);
    assert.equal(seen.rows.length, 0);
  } finally {
    await db.close();
  }
});

test('the migration is idempotent — a second run changes nothing and does not fail', async () => {
  const db = await schemaDb();
  try {
    const sql = await migrationSql();
    await db.exec(sql);
    const before = await db.query<any>(
      `select policyname from pg_policies where schemaname = 'public' order by policyname`
    );
    await db.exec(sql);
    const after = await db.query<any>(
      `select policyname from pg_policies where schemaname = 'public' order by policyname`
    );
    assert.deepEqual(
      after.rows.map((row) => row.policyname),
      before.rows.map((row) => row.policyname)
    );
  } finally {
    await db.close();
  }
});

test('a minimal profiles schema (no optional columns, no editor state) still applies cleanly', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.profiles (
        id uuid primary key references auth.users(id) on delete cascade,
        full_name text,
        salon_name text
      );
      insert into auth.users values ('${OWNER}');
    `);
    // This is the schema variant that made the older column-level GRANT
    // migrations abort, which is how a project ended up with tables but no
    // privileges and no policies.
    await db.exec(await migrationSql());

    const privileges = await db.query<any>(
      `select has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as can_update,
              has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as can_update_name`
    );
    assert.equal(privileges.rows[0].can_update, true);
    assert.equal(privileges.rows[0].can_update_name, true);

    // The owner can actually write the row on this minimal schema too.
    await asUser(db, OWNER, `insert into public.profiles (id, full_name) values ($1, 'Uma')`, [OWNER]);
    await asUser(db, OWNER, `update public.profiles set full_name = 'Uma Updated' where id = $1`, [OWNER]);
    const row = await db.query<{ full_name: string }>(
      `select full_name from public.profiles where id = $1`,
      [OWNER]
    );
    assert.equal(row.rows[0].full_name, 'Uma Updated');
  } finally {
    await db.close();
  }
});

test('a project whose table is named salon_profiles gets the reported policy verbatim', async () => {
  // The issue names `salon_profiles` with an `auth.uid() = user_id` owner
  // column. This repo's own migration is `public.profiles`/`id`, but the
  // migration must repair the classic shape too — same statements, on that
  // table — otherwise an operator following the report on such a project
  // would change nothing.
  const db = await classicSchemaDb();
  try {
    await db.exec(await migrationSql());

    const policy = await db.query<any>(
      `select cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'salon_profiles'
          and policyname = 'Users can insert/update their own profile'`
    );
    assert.equal(policy.rows.length, 1, 'the reported policy must exist on public.salon_profiles');
    assert.equal(policy.rows[0].cmd, 'ALL');
    assert.deepEqual(policy.rows[0].roles, ['authenticated']);
    assert.match(policy.rows[0].qual, /auth\.uid\(\) = user_id/);
    assert.match(policy.rows[0].with_check, /auth\.uid\(\) = user_id/);

    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.salon_profiles'::regclass`
    );
    assert.equal(rls.rows[0].relrowsecurity, true, 'RLS must be enabled on public.salon_profiles');

    // GRANT ALL is executed; only the privileges that bypass RLS are revoked.
    const grants = await db.query<any>(
      `select has_table_privilege('authenticated','public.salon_profiles','SELECT') as can_select,
              has_table_privilege('authenticated','public.salon_profiles','INSERT') as can_insert,
              has_table_privilege('authenticated','public.salon_profiles','UPDATE') as can_update,
              has_table_privilege('authenticated','public.salon_profiles','DELETE') as can_delete,
              has_table_privilege('authenticated','public.salon_profiles','TRUNCATE') as can_truncate`
    );
    assert.equal(grants.rows[0].can_select, true);
    assert.equal(grants.rows[0].can_insert, true);
    assert.equal(grants.rows[0].can_update, true);
    assert.equal(grants.rows[0].can_delete, true);
    assert.equal(grants.rows[0].can_truncate, false, 'TRUNCATE bypasses RLS and must stay revoked');

    // End to end: the owner can create/update their own row...
    await asUser(db, OWNER, `insert into public.salon_profiles (user_id, full_name) values ($1, 'Uma')`, [OWNER]);
    await asUser(db, OWNER, `update public.salon_profiles set full_name = 'Uma S' where user_id = $1`, [OWNER]);
    const mine = await asUser(db, OWNER, `select count(*)::int as n from public.salon_profiles`);
    assert.equal(mine.rows[0].n, 1);

    // ...another signed-in owner can neither see nor write it.
    const theirs = await asUser(db, OTHER_OWNER, `select count(*)::int as n from public.salon_profiles`);
    assert.equal(theirs.rows[0].n, 0);
    await asUser(
      db,
      OTHER_OWNER,
      `insert into public.salon_profiles (user_id, full_name) values ($1, 'Not Mine')`,
      [OWNER]
    ).then(
      () => assert.fail('inserting another owner’s salon profile must be rejected'),
      (error: any) => assert.match(String(error.message), /row-level security|violates/i)
    );

    // Idempotent on this shape too.
    await db.exec(await migrationSql());
  } finally {
    await db.close();
  }
});
