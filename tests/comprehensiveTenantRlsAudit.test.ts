import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20261011_comprehensive_tenant_rls_audit.sql'),
  'utf8'
);

test('migration 20261011 applies cleanly and creates tenant RLS policies on organizations, salons, staff, etc.', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text
    );

    create table public.organization_members (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid references public.organizations(id),
      user_id uuid references auth.users(id),
      role text not null default 'owner',
      status text not null default 'active'
    );

    create table public.salons (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid references public.organizations(id),
      slug text unique,
      name text,
      owner_id uuid,
      is_active boolean default true,
      deleted_at timestamptz
    );

    create table public.salon_hours (
      id uuid primary key default gen_random_uuid(),
      salon_id uuid references public.salons(id),
      day_of_week int,
      opens_at time,
      closes_at time,
      is_closed boolean default false
    );

    create table public.salon_customers (
      id uuid primary key default gen_random_uuid(),
      salon_id uuid references public.salons(id),
      user_id uuid,
      name text
    );

    create table public.staff (
      id uuid primary key default gen_random_uuid(),
      salon_id uuid references public.salons(id),
      name text,
      is_active boolean default true,
      is_public boolean default true
    );
  `);

  // Apply migration first time
  await db.exec(MIGRATION);

  // Verify RLS is enabled on all tables
  for (const table of ['organizations', 'organization_members', 'salons', 'salon_hours', 'salon_customers', 'staff']) {
    const res = await db.query<any>(
      `select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = $1`,
      [table]
    );
    assert.equal(res.rows[0].relrowsecurity, true, `RLS must be enabled on ${table}`);
  }

  // Verify policies exist
  const policies = await db.query<any>(
    `select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, policyname`
  );
  assert.ok(policies.rows.length >= 10, 'Expected at least 10 policies created');

  // Verify idempotency (re-applying must succeed without error)
  await db.exec(MIGRATION);
});
