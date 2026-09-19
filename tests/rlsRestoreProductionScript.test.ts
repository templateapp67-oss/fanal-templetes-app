import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * supabase/rls-restore-production.sql — the one-file repair operators are told
 * to run when the editor reports "Database permission problem".
 *
 * Migration 20261010 added the combined owner policy
 * ("Users can insert/update their own profile") and the owner_editor_state
 * section to it, so this test pins that the script still applies cleanly,
 * repairs exactly the owner-scoped access, and is safe to run twice.
 */

const SCRIPT = new URL('../supabase/rls-restore-production.sql', import.meta.url);
const OWNER = '10000000-0000-4000-8000-000000000001';

async function schemaDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.profiles (id uuid primary key, full_name text, phone text);
    create table public.owner_editor_state (owner_id uuid primary key, state jsonb default '{}'::jsonb);
    create table public.services (id uuid primary key, owner_id uuid, name text);
    create table public.stylists (id uuid primary key, owner_id uuid, name text);
    create table public.loyalty_config (owner_id uuid primary key, program_enabled boolean);
    create table public.loyalty_rewards (id uuid primary key, owner_id uuid, title text);
    insert into auth.users values ('${OWNER}');
  `);
  return db;
}

test('the repair script restores owner-scoped RLS, the combined profile policy and grants', async () => {
  const db = await schemaDb();
  try {
    const script = await readFile(SCRIPT, 'utf8');
    await db.exec(script);

    // Every editor table: RLS on. profiles now carries the four canonical
    // owner policies plus the combined one; the other four carry four each.
    const rls = await db.query<any>(
      `select c.relname as table_name, c.relrowsecurity as rls_enabled,
              (select count(*) from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('profiles','services','stylists','loyalty_config','loyalty_rewards')
        order by c.relname`
    );
    for (const row of rls.rows) {
      assert.equal(row.rls_enabled, true, `${row.table_name} must have RLS enabled`);
      const expected = row.table_name === 'profiles' ? 5 : 4;
      assert.equal(row.policy_count, expected, `${row.table_name} policy count`);
    }

    const combined = await db.query<any>(
      `select cmd, roles::text[] as roles from pg_policies
        where schemaname='public' and tablename='profiles'
          and policyname='Users can insert/update their own profile'`
    );
    assert.equal(combined.rows.length, 1);
    assert.equal(combined.rows[0].cmd, 'ALL');
    assert.deepEqual(combined.rows[0].roles, ['authenticated']);

    // The editor-state row the save transaction upserts.
    const statePolicy = await db.query<any>(
      `select cmd, roles::text[] as roles from pg_policies
        where schemaname='public' and tablename='owner_editor_state'`
    );
    assert.equal(statePolicy.rows.length, 1);
    assert.equal(statePolicy.rows[0].cmd, 'ALL');
    assert.deepEqual(statePolicy.rows[0].roles, ['authenticated']);

    // Grants: full DML for the owner, read-only for anon.
    const grants = await db.query<any>(
      `select
         has_table_privilege('authenticated','public.profiles','UPDATE') as owner_update,
         has_table_privilege('authenticated','public.owner_editor_state','INSERT') as center_insert,
         has_table_privilege('anon','public.profiles','SELECT') as anon_select,
         has_table_privilege('anon','public.profiles','INSERT') as anon_insert`
    );
    assert.equal(grants.rows[0].owner_update, true);
    assert.equal(grants.rows[0].center_insert, true);
    assert.equal(grants.rows[0].anon_select, true);
    assert.equal(grants.rows[0].anon_insert, false, 'anon must never hold a write privilege');

    // Cross-tenant negative test: another signed-in user sees nothing.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      '10000000-0000-4000-8000-000000000002',
    ]);
    await db.exec('set role authenticated');
    try {
      await db.query(`insert into public.profiles (id, full_name) values ('${OWNER}', 'Not Mine')`).then(
        () => assert.fail('inserting another owner’s profile row must be rejected'),
        (error: any) => assert.match(String(error.message), /row-level security|violates/i)
      );
      const seen = await db.query<any>(`select count(*)::int as n from public.profiles`);
      assert.equal(seen.rows[0].n, 0);
    } finally {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }

    // Idempotent: a second run is a no-op, not an error.
    await db.exec(script);
  } finally {
    await db.close();
  }
});
