import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20261012_production_schema_reconciliation.sql'),
  'utf8'
);

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER_OWNER = '10000000-0000-4000-8000-000000000002';
const CUSTOMER = '10000000-0000-4000-8000-000000000003';
const OTHER_CUSTOMER = '10000000-0000-4000-8000-000000000004';
const ORG = '30000000-0000-4000-8000-000000000001';
const OTHER_ORG = '30000000-0000-4000-8000-000000000002';
const SALON = '20000000-0000-4000-8000-000000000001';
const OTHER_SALON = '20000000-0000-4000-8000-000000000002';

async function asUser(db: PGlite, userId: string, sql: string, params?: any[]) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || '']);
  await db.exec('reset role');
  if (userId) await db.exec('set role authenticated'); else await db.exec('set role anon');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

test('migration 20261012 applies cleanly to normalized schema and creates missing RPCs & views', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'email', 'owner@example.com') $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on all functions in schema auth to authenticated, anon;

    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@example.com'),
      ('${OTHER_OWNER}', 'other@example.com'),
      ('${CUSTOMER}', 'customer@example.com'),
      ('${OTHER_CUSTOMER}', 'other_customer@example.com');

    create table public.profiles (
      id uuid primary key references auth.users(id),
      full_name text,
      phone text,
      mobile text,
      whatsapp text,
      pincode text,
      city text,
      preferred_city text,
      area text,
      preferred_area text,
      avatar_url text,
      photo_url text
    );

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
      data jsonb default '{}'::jsonb,
      owner_id uuid,
      is_active boolean default true,
      deleted_at timestamptz
    );

    create function public.nexora_owner_salon_ids() returns setof uuid language sql stable as $$
      select s.id from public.salons s
      join public.organization_members om on om.organization_id = s.organization_id
      where om.user_id = auth.uid() and om.status = 'active' and om.role in ('owner', 'manager')
    $$;

    create table public.staff (
      id uuid primary key default gen_random_uuid(),
      salon_id uuid references public.salons(id),
      name text,
      is_active boolean default true
    );

    create table public.services (
      id uuid primary key default gen_random_uuid(),
      salon_id uuid references public.salons(id),
      name text,
      price numeric,
      is_active boolean default true
    );

    create table public.staff_services (
      staff_id uuid references public.staff(id),
      service_id uuid references public.services(id),
      is_active boolean default true,
      primary key (staff_id, service_id)
    );

    create table public.staff_schedules (
      id uuid primary key default gen_random_uuid(),
      staff_id uuid references public.staff(id),
      day_of_week int,
      start_time time,
      end_time time,
      is_working boolean default true
    );

    create table public.bookings (
      id uuid primary key default gen_random_uuid(),
      salon_id uuid references public.salons(id),
      customer_user_id uuid,
      status text not null default 'pending',
      customer_note text,
      cancelled_at timestamptz,
      updated_at timestamptz default now()
    );

    create table public.booking_items (
      id uuid primary key default gen_random_uuid(),
      booking_id uuid references public.bookings(id),
      service_id uuid references public.services(id)
    );

    create table public.in_app_notifications (
      id uuid primary key default gen_random_uuid(),
      user_email text,
      owner_id uuid,
      user_id uuid,
      title text,
      message text
    );

    insert into public.organizations (id, name) values ('${ORG}', 'Main Org'), ('${OTHER_ORG}', 'Other Org');
    insert into public.organization_members (organization_id, user_id, role, status) values
      ('${ORG}', '${OWNER}', 'owner', 'active'),
      ('${OTHER_ORG}', '${OTHER_OWNER}', 'owner', 'active');
    insert into public.salons (id, organization_id, slug, name) values
      ('${SALON}', '${ORG}', 'my-salon', 'My Salon'),
      ('${OTHER_SALON}', '${OTHER_ORG}', 'other-salon', 'Other Salon');

    -- Insert an insecure policy on public.salons to verify cleanup
    create policy allow_all on public.salons for all using (true);
  `);

  // Apply reconciliation migration
  await db.exec(MIGRATION);

  // 1. Verify owner_editor_state table exists and has RLS
  const oes = await db.query<any>(
    "select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'owner_editor_state'"
  );
  assert.equal(oes.rows[0].relrowsecurity, true, 'owner_editor_state must have RLS enabled');

  // 2. Verify get_owner_editor_state() RPC
  const emptyState = await asUser(db, OWNER, 'select public.get_owner_editor_state() as state');
  assert.equal((emptyState.rows[0] as any).state, null, 'Empty state initially');

  await asUser(db, OWNER, `insert into public.owner_editor_state (owner_id, state) values ('${OWNER}', '{"theme":"dark"}'::jsonb)`);
  const myState = await asUser(db, OWNER, 'select public.get_owner_editor_state() as state');
  assert.deepEqual((myState.rows[0] as any).state, { theme: 'dark' });

  const otherState = await asUser(db, OTHER_OWNER, 'select public.get_owner_editor_state() as state');
  assert.equal((otherState.rows[0] as any).state, null, 'Other user cannot see my state');

  // 3. Verify sync_owner_contact(jsonb) updates normalized salon via nexora_owner_salon_ids()
  await asUser(db, OWNER, `select public.sync_owner_contact('{"ownerName":"Alice","businessName":"Alice Studio","phone":"9876543210"}'::jsonb)`);

  const updatedSalon = await db.query<any>(`select name, phone from public.salons where id = '${SALON}'`);
  assert.equal(updatedSalon.rows[0].name, 'Alice Studio', 'Salon name updated via sync_owner_contact');
  assert.equal(updatedSalon.rows[0].phone, '9876543210', 'Salon phone updated via sync_owner_contact');

  const otherSalon = await db.query<any>(`select name from public.salons where id = '${OTHER_SALON}'`);
  assert.equal(otherSalon.rows[0].name, 'Other Salon', 'Other salon was untouched');

  // 4. Verify cancel_customer_booking RPC
  const bookingId = '90000000-0000-4000-8000-000000000001';
  await db.query(`insert into public.bookings (id, salon_id, customer_user_id, status) values ('${bookingId}', '${SALON}', '${CUSTOMER}', 'confirmed')`);

  // Unauthorized cancellation attempt by unrelated customer should fail
  await assert.rejects(
    async () => {
      await asUser(db, OTHER_CUSTOMER, `select public.cancel_customer_booking('${bookingId}'::uuid, 'Malicious cancel')`);
    },
    /Unauthorized/
  );

  // Customer cancels their own booking
  const res = await asUser(db, CUSTOMER, `select public.cancel_customer_booking('${bookingId}'::uuid, 'Change of plans') as ok`);
  assert.equal((res.rows[0] as any).ok, true, 'Booking cancelled successfully by customer');

  const bRow = await db.query<any>(`select status, customer_note, cancelled_at from public.bookings where id = '${bookingId}'`);
  assert.equal(bRow.rows[0].status, 'cancelled');
  assert.ok(bRow.rows[0].customer_note.includes('Change of plans'));
  assert.ok(bRow.rows[0].cancelled_at);

  // 5. Verify compatibility views exist
  const views = await db.query<any>(`select table_name from information_schema.views where table_schema = 'public'`);
  const viewNames = views.rows.map((r: any) => r.table_name);
  assert.ok(viewNames.includes('salon_profiles'), 'salon_profiles view exists');
  assert.ok(viewNames.includes('salon_staff'), 'salon_staff view exists');
  assert.ok(viewNames.includes('stylists'), 'stylists view exists');
  assert.ok(viewNames.includes('notifications'), 'notifications view exists');

  // 6. Verify insecure policy allow_all was dropped
  const pol = await db.query<any>(
    "select policyname from pg_policies where schemaname = 'public' and tablename = 'salons' and policyname = 'allow_all'"
  );
  assert.equal(pol.rows.length, 0, 'allow_all wildcard policy must be dropped');

  // 7. Verify tenant isolation on services
  const srvA = '55550000-0000-4000-8000-000000000001';
  const srvB = '55550000-0000-4000-8000-000000000002';
  await db.query(`insert into public.services (id, salon_id, name, price, is_active) values ('${srvA}', '${SALON}', 'Haircut A', 500, true)`);
  await db.query(`insert into public.services (id, salon_id, name, price, is_active) values ('${srvB}', '${OTHER_SALON}', 'Haircut B', 600, false)`);

  // Active services visible, but inactive service of OTHER salon not visible to OWNER
  const ownerServices = await asUser(db, OWNER, 'select id from public.services');
  const ownerSrvIds = ownerServices.rows.map((r: any) => r.id);
  assert.ok(ownerSrvIds.includes(srvA), 'Owner sees their salon service');
  assert.ok(!ownerSrvIds.includes(srvB), 'Owner cannot see other salon inactive service');

  // 8. Verify idempotency
  await db.exec(MIGRATION);
});

test('migration 20261012 applies cleanly to legacy schema generation (00001_init style)', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'email', 'owner@example.com') $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on all functions in schema auth to authenticated, anon;

    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@example.com'),
      ('${OTHER_OWNER}', 'other@example.com');

    create table public.profiles (
      id uuid primary key references auth.users(id),
      full_name text
    );

    create table public.stylists (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references auth.users(id),
      name text
    );

    create table public.services (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references auth.users(id),
      name text,
      is_active boolean default true
    );

    create table public.bookings (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid references auth.users(id),
      customer_user_id uuid,
      status text default 'confirmed',
      customer_note text
    );
  `);

  // Apply migration to legacy schema
  await db.exec(MIGRATION);

  // Verify staff compatibility view created over stylists
  const v = await db.query<any>("select table_name from information_schema.views where table_schema = 'public' and table_name = 'staff'");
  assert.equal(v.rows.length, 1, 'staff view should be created over stylists');

  // Verify cancel_customer_booking works on legacy bookings (owner_id based)
  const legacyBookingId = '88880000-0000-4000-8000-000000000001';
  await db.query(`insert into public.bookings (id, owner_id, status) values ('${legacyBookingId}', '${OWNER}', 'confirmed')`);

  const cancelled = await asUser(db, OWNER, `select public.cancel_customer_booking('${legacyBookingId}'::uuid, 'Owner cancelled') as ok`);
  assert.equal((cancelled.rows[0] as any).ok, true, 'Legacy booking cancelled successfully by owner');

  const bRow = await db.query<any>(`select status, customer_note from public.bookings where id = '${legacyBookingId}'`);
  assert.equal(bRow.rows[0].status, 'cancelled');
  assert.ok(bRow.rows[0].customer_note.includes('Owner cancelled'));

  // Verify idempotency
  await db.exec(MIGRATION);
});
