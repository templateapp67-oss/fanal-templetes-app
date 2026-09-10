// ============================================================================
// Live-schema PGlite fixture for the normalized owner booking backend.
//
// The connected production Supabase project uses a NORMALIZED schema
// (salons, organization_members, salon_customers, services, staff,
// booking_items, …) that was applied OUTSIDE this repository, so no committed
// migration creates it. This fixture re-creates that live contract as the
// application code proves it (see SUPABASE_SETUP.md §"Existing production
// database", server/backendContext.ts, server/ownerDashboard.ts,
// server/normalizedBookingAccess.ts and the FK names used by
// NORMALIZED_BOOKING_SELECT). The owner-booking migration is then applied on
// top exactly like the SQL Editor would apply it to production.
// ============================================================================

import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const OWNER = '10000000-0000-4000-8000-000000000001';
export const OTHER_OWNER = '10000000-0000-4000-8000-000000000002';
export const CUSTOMER_USER = '10000000-0000-4000-8000-000000000003';
export const ORG = '30000000-0000-4000-8000-000000000001';
export const OTHER_ORG = '30000000-0000-4000-8000-000000000002';
export const SALON = '20000000-0000-4000-8000-000000000001';
export const OTHER_SALON = '20000000-0000-4000-8000-000000000002';
export const SERVICE = '40000000-0000-4000-8000-000000000001';
export const OTHER_SERVICE = '40000000-0000-4000-8000-000000000002';
export const STAFF = '50000000-0000-4000-8000-000000000001';
export const OTHER_STAFF = '50000000-0000-4000-8000-000000000002';

const SCHEMA = `
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);

create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Salon identity + organization membership (server/backendContext.ts reads
-- exactly these columns: user_id / organization_id / status / role).
create table public.salons (
  id uuid primary key,
  organization_id uuid,
  slug text,
  name text,
  description text,
  address text,
  city text,
  phone text,
  whatsapp text,
  latitude numeric,
  longitude numeric,
  timezone text default 'Asia/Kolkata',
  logo_url text,
  cover_url text,
  data jsonb,
  updated_at timestamptz default now()
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  role text not null,
  status text not null default 'active'
);

-- Catalogue (mirrors what save_owner_editor_state writes).
create table public.services (
  id uuid primary key,
  salon_id uuid not null references public.salons(id),
  name text not null,
  description text,
  price_paise bigint not null check (price_paise >= 0),
  price numeric,
  duration_minutes int not null check (duration_minutes > 0),
  is_active boolean default true,
  is_bookable_online boolean default true,
  is_featured boolean default false,
  display_order int,
  updated_at timestamptz default now()
);
create table public.staff (
  id uuid primary key,
  salon_id uuid not null references public.salons(id),
  name text not null,
  full_name text,
  role_title text,
  phone text,
  bio text,
  avatar_path text,
  profile_photo_url text,
  is_active boolean default true,
  updated_at timestamptz default now()
);
create table public.staff_services (
  staff_id uuid references public.staff(id),
  service_id uuid references public.services(id),
  is_active boolean default true,
  primary key (staff_id, service_id)
);

-- Customers: per-salon, keyed by phone; no auth user required.
create table public.salon_customers (
  id uuid primary key,
  salon_id uuid not null references public.salons(id),
  name text,
  phone text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Bookings: the normalized shape the API reads (see NORMALIZED_BOOKING_SELECT
-- and the reconciled status check applied to production by
-- 20260908183705_reconcile_booking_status_constraints.sql). FK names matter:
-- PostgREST embeds address them (bookings_salon_id_fkey …).
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null constraint bookings_salon_id_fkey references public.salons(id),
  organization_id uuid,
  staff_id uuid references public.staff(id),
  staff_name_snapshot text,
  salon_customer_id uuid constraint bookings_salon_customer_id_fkey references public.salon_customers(id),
  customer_user_id uuid,
  status text not null default 'pending',
  appointment_start timestamptz,
  appointment_end timestamptz,
  proposed_date date,
  proposed_time_slot text,
  booking_date date,
  booking_time text,
  total_paise bigint default 0,
  total_amount numeric(12,2) default 0,
  paid_amount numeric(12,2) default 0,
  currency text default 'INR',
  customer_note text,
  internal_note text,
  idempotency_key text,
  created_by uuid,
  is_walk_in boolean default false,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  checked_in_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  no_show_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (
  status in ('payment_pending', 'pending', 'confirmed', 'reschedule_proposed',
             'reschedule_requested', 'checked_in', 'in_progress', 'completed',
             'cancelled', 'no_show', 'disputed')
);
-- Production also carries bookings_staff_active_slot_no_overlap (EXCLUDE
-- USING gist). PGlite cannot load btree_gist, so the equivalent guard is the
-- explicit overlap check inside create_owner_booking (same predicate).
do $$ begin
  create extension if not exists btree_gist;
  alter table public.bookings add constraint bookings_staff_active_slot_no_overlap
    exclude using gist (
      staff_id with =,
      tstzrange(appointment_start, appointment_end, '[)') with &&
    ) where (staff_id is not null and status in (
      'payment_pending', 'pending', 'confirmed', 'reschedule_proposed',
      'reschedule_requested', 'checked_in', 'in_progress'
    ));
exception when others then
  raise notice 'btree_gist unavailable (PGlite): exclusion constraint skipped; the RPC overlap guard covers it';
end $$;

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_id uuid references public.services(id),
  service_name_snapshot text,
  duration_minutes_snapshot int,
  unit_price_paise bigint,
  quantity int default 1,
  created_at timestamptz default now()
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid constraint reviews_booking_id_fkey references public.bookings(id),
  rating int,
  review_text text,
  updated_at timestamptz default now()
);

-- RLS is enabled on the tenant tables exactly like production; the booking
-- writes go through the SECURITY DEFINER RPC which enforces tenancy itself.
alter table public.salons enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.staff_services enable row level security;
alter table public.salon_customers enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;

insert into auth.users values
  ('${OWNER}'), ('${OTHER_OWNER}'), ('${CUSTOMER_USER}');
insert into public.salons (id, organization_id, slug, name, timezone) values
  ('${SALON}', '${ORG}', 'uma-salon', 'Uma Salon', 'Asia/Kolkata'),
  ('${OTHER_SALON}', '${OTHER_ORG}', 'other-salon', 'Other Salon', 'Asia/Kolkata');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('${ORG}', '${OWNER}', 'owner', 'active'),
  ('${OTHER_ORG}', '${OTHER_OWNER}', 'owner', 'active');
insert into public.services (id, salon_id, name, price_paise, price, duration_minutes, is_active) values
  ('${SERVICE}', '${SALON}', 'Signature Cut', 50000, 500.00, 45, true),
  ('${OTHER_SERVICE}', '${OTHER_SALON}', 'Foreign Service', 60000, 600.00, 30, true);
insert into public.staff (id, salon_id, name, is_active) values
  ('${STAFF}', '${SALON}', 'Priya', true),
  ('${OTHER_STAFF}', '${OTHER_SALON}', 'Foreign Stylist', true);
`;

/** The live contract fixture, WITHOUT the owner-booking migration. */
export async function liveSchemaDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
}

/** The live contract WITH the owner-booking migration applied (like SQL Editor). */
export async function liveSchemaDbWithRpc() {
  const db = await liveSchemaDb();
  const migration = await readFile(
    new URL('../supabase/migrations/20260910200000_create_owner_booking.sql', import.meta.url),
    'utf8'
  );
  await db.exec(migration);
  return db;
}

/** Run SQL as a signed-in role (auth.uid() = userId) — mirrors a PostgREST call. */
export async function asUser(db: any, userId: string, sql: string, params?: any[]) {
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
