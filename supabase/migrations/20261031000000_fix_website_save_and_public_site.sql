-- ============================================================================
-- 20261031000000_fix_website_save_and_public_site.sql
--
-- Comprehensive, idempotent repair for:
--   1. Website Editor save failures ("Save failed: Network error..." / 503 /
--      42501 / 42703 / 22023 / PGRST202)
--   2. Table & schema grants + non-recursive RLS policies for profiles,
--      owner_editor_state, salons, salon_hours, services, staff,
--      staff_services, staff_schedules, loyalty_config, loyalty_rewards
--   3. Atomic save_owner_editor_state / nexora_save_owner_workspace RPC with:
--      - automatic workspace provisioning if owner has no salon yet
--      - UPSERT on public.profiles in sync_owner_contact
--      - graceful handling of empty gallery/lookbook image slots
--      - automatic staff.is_public = is_active sync + salon_hours seeding
--   4. Public booking availability RPC nexora_customer_booking_options
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. SCHEMA & COLUMN RECONCILIATION
-- ----------------------------------------------------------------------------
create table if not exists public.owner_editor_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table if exists public.owner_editor_state
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists state jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.profiles
  add column if not exists id uuid,
  add column if not exists full_name text,
  add column if not exists salon_name text,
  add column if not exists subdomain text,
  add column if not exists phone text,
  add column if not exists mobile text,
  add column if not exists whatsapp text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists preferred_city text,
  add column if not exists area text,
  add column if not exists preferred_area text,
  add column if not exists pincode text,
  add column if not exists avatar_url text,
  add column if not exists photo_url text,
  add column if not exists dob date,
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.salons
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists organization_id uuid,
  add column if not exists name text,
  add column if not exists slug text,
  add column if not exists subdomain text,
  add column if not exists description text,
  add column if not exists business_type text not null default 'hair_salon',
  add column if not exists tagline text,
  add column if not exists about text,
  add column if not exists phone text,
  add column if not exists mobile text,
  add column if not exists whatsapp text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists area text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists pincode text,
  add column if not exists landmark text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists logo_url text,
  add column if not exists cover_image_url text,
  add column if not exists primary_color text,
  add column if not exists accent_color text,
  add column if not exists theme_key text,
  add column if not exists template_key text,
  add column if not exists custom_domain text,
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists is_active boolean not null default true,
  add column if not exists is_listed boolean not null default true,
  add column if not exists is_verified boolean not null default false,
  add column if not exists online_booking_enabled boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.services
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists salon_id uuid references public.salons(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists category text not null default 'General',
  add column if not exists description text,
  add column if not exists duration_minutes integer not null default 30,
  add column if not exists price numeric not null default 0,
  add column if not exists price_paise bigint not null default 0,
  add column if not exists icon text,
  add column if not exists image_url text,
  add column if not exists popular boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_bookable_online boolean not null default true,
  add column if not exists is_featured boolean not null default false,
  add column if not exists display_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'services'
      and column_name = 'owner_id' and is_nullable = 'NO'
  ) then
    alter table public.services alter column owner_id drop not null;
  end if;
end $$;

alter table if exists public.staff
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists salon_id uuid references public.salons(id) on delete cascade,
  add column if not exists name text,
  add column if not exists full_name text,
  add column if not exists role_title text,
  add column if not exists phone text,
  add column if not exists bio text,
  add column if not exists avatar_path text,
  add column if not exists profile_photo_url text,
  add column if not exists display_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_public boolean not null default true,
  add column if not exists employment_status text not null default 'active',
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.staff_services
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists is_active boolean not null default true;

alter table if exists public.staff_schedules
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists is_working boolean not null default true;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_schedules'
      and column_name = 'start_time' and is_nullable = 'NO'
  ) then
    alter table public.staff_schedules alter column start_time drop not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_schedules'
      and column_name = 'end_time' and is_nullable = 'NO'
  ) then
    alter table public.staff_schedules alter column end_time drop not null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. SCHEMA, TABLE & SEQUENCE GRANTS
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'salon_profiles',
    'website_profiles',
    'owner_editor_state',
    'organizations',
    'organization_members',
    'salons',
    'salon_hours',
    'websites',
    'services',
    'staff',
    'stylists',
    'staff_services',
    'staff_schedules',
    'loyalty_config',
    'loyalty_rewards',
    'bookings',
    'booking_items',
    'customers',
    'salon_customers'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on table public.%I to authenticated, service_role', t);
    end if;
  end loop;

  foreach t in array array[
    'salons',
    'salon_hours',
    'websites',
    'services',
    'staff',
    'stylists',
    'staff_services',
    'staff_schedules',
    'profiles',
    'salon_profiles',
    'website_profiles',
    'owner_editor_state',
    'loyalty_config',
    'loyalty_rewards'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on table public.%I to anon', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. NON-RECURSIVE OWNER SALON RESOLVER & RLS POLICIES
-- ----------------------------------------------------------------------------
create or replace function public.nexora_owner_salon_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select s.id
  from public.salons s
  join public.organization_members om
    on om.organization_id = s.organization_id
  where om.user_id = auth.uid()
    and om.role = 'owner'
    and om.status = 'active'
    and s.deleted_at is null
    and s.is_active = true
$$;

revoke all on function public.nexora_owner_salon_ids() from public, anon;
grant execute on function public.nexora_owner_salon_ids() to authenticated, service_role;

-- profiles RLS
alter table if exists public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- owner_editor_state RLS
alter table if exists public.owner_editor_state enable row level security;
drop policy if exists owner_editor_state_owner_all on public.owner_editor_state;
create policy owner_editor_state_owner_all on public.owner_editor_state
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- salons RLS
alter table if exists public.salons enable row level security;
drop policy if exists salons_public_read on public.salons;
create policy salons_public_read on public.salons
  for select to anon, authenticated
  using (is_active = true and deleted_at is null);
drop policy if exists salons_owner_all on public.salons;
create policy salons_owner_all on public.salons
  for all to authenticated
  using (id in (select public.nexora_owner_salon_ids()))
  with check (id in (select public.nexora_owner_salon_ids()));

-- salon_hours RLS
do $$
begin
  if to_regclass('public.salon_hours') is not null then
    alter table public.salon_hours enable row level security;
    drop policy if exists salon_hours_public_read on public.salon_hours;
    create policy salon_hours_public_read on public.salon_hours
      for select to anon, authenticated using (true);
    drop policy if exists salon_hours_owner_all on public.salon_hours;
    create policy salon_hours_owner_all on public.salon_hours
      for all to authenticated
      using (salon_id in (select public.nexora_owner_salon_ids()))
      with check (salon_id in (select public.nexora_owner_salon_ids()));
  end if;
end $$;

-- services RLS
alter table if exists public.services enable row level security;
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services
  for select to anon, authenticated
  using (is_active = true);
drop policy if exists services_owner_all on public.services;
drop policy if exists services_owner_write on public.services;
create policy services_owner_all on public.services
  for all to authenticated
  using (
    salon_id in (select public.nexora_owner_salon_ids())
    or (salon_id is null and owner_id = auth.uid())
  )
  with check (
    salon_id in (select public.nexora_owner_salon_ids())
    or (salon_id is null and owner_id = auth.uid())
  );

-- staff RLS
alter table if exists public.staff enable row level security;
drop policy if exists staff_public_read on public.staff;
create policy staff_public_read on public.staff
  for select to anon, authenticated
  using (is_active = true);
drop policy if exists staff_owner_all on public.staff;
create policy staff_owner_all on public.staff
  for all to authenticated
  using (salon_id in (select public.nexora_owner_salon_ids()))
  with check (salon_id in (select public.nexora_owner_salon_ids()));

-- staff_services & staff_schedules RLS
do $$
begin
  if to_regclass('public.staff_services') is not null then
    alter table public.staff_services enable row level security;
    drop policy if exists staff_services_public_read on public.staff_services;
    create policy staff_services_public_read on public.staff_services
      for select to anon, authenticated using (true);
    drop policy if exists staff_services_owner_all on public.staff_services;
    create policy staff_services_owner_all on public.staff_services
      for all to authenticated
      using (
        exists (
          select 1 from public.staff st
          where st.id = staff_services.staff_id
            and st.salon_id in (select public.nexora_owner_salon_ids())
        )
      )
      with check (
        exists (
          select 1 from public.staff st
          where st.id = staff_services.staff_id
            and st.salon_id in (select public.nexora_owner_salon_ids())
        )
      );
  end if;

  if to_regclass('public.staff_schedules') is not null then
    alter table public.staff_schedules enable row level security;
    drop policy if exists staff_schedules_public_read on public.staff_schedules;
    create policy staff_schedules_public_read on public.staff_schedules
      for select to anon, authenticated using (true);
    drop policy if exists staff_schedules_owner_all on public.staff_schedules;
    create policy staff_schedules_owner_all on public.staff_schedules
      for all to authenticated
      using (
        exists (
          select 1 from public.staff st
          where st.id = staff_schedules.staff_id
            and st.salon_id in (select public.nexora_owner_salon_ids())
        )
      )
      with check (
        exists (
          select 1 from public.staff st
          where st.id = staff_schedules.staff_id
            and st.salon_id in (select public.nexora_owner_salon_ids())
        )
      );
  end if;

  if to_regclass('public.loyalty_config') is not null then
    alter table public.loyalty_config enable row level security;
    drop policy if exists loyalty_config_public_read on public.loyalty_config;
    create policy loyalty_config_public_read on public.loyalty_config
      for select to anon, authenticated using (true);
    drop policy if exists loyalty_config_owner_all on public.loyalty_config;
    create policy loyalty_config_owner_all on public.loyalty_config
      for all to authenticated
      using (owner_id = auth.uid())
      with check (owner_id = auth.uid());
  end if;

  if to_regclass('public.loyalty_rewards') is not null then
    alter table public.loyalty_rewards enable row level security;
    drop policy if exists loyalty_rewards_public_read on public.loyalty_rewards;
    create policy loyalty_rewards_public_read on public.loyalty_rewards
      for select to anon, authenticated using (true);
    drop policy if exists loyalty_rewards_owner_all on public.loyalty_rewards;
    create policy loyalty_rewards_owner_all on public.loyalty_rewards
      for all to authenticated
      using (owner_id = auth.uid())
      with check (owner_id = auth.uid());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC WORKSPACE SAVE HELPERS & RPCs
-- ----------------------------------------------------------------------------
drop function if exists public.sync_owner_contact(jsonb);
drop function if exists public.nexora_catalog_uuid(uuid, text, text);
drop function if exists public.nexora_website_youtube_id(text);
drop function if exists public.nexora_website_image_url(text);
drop function if exists public.save_owner_editor_state(jsonb);
drop function if exists public.nexora_save_owner_workspace(jsonb);
drop function if exists public.get_owner_editor_state();
drop function if exists public.nexora_customer_booking_options(uuid, uuid[], date, uuid);

create or replace function public.sync_owner_contact(p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  has_name boolean;
  owner_name text;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Profile payload must be a JSON object' using errcode = '22023';
  end if;

  has_name := p_profile ? 'full_name' or p_profile ? 'ownerName';
  owner_name := coalesce(nullif(btrim(p_profile->>'full_name'), ''), nullif(btrim(p_profile->>'ownerName'), ''));
  if has_name and (owner_name is null or lower(owner_name) in ('demo person', 'user')) then
    has_name := false;
  end if;

  insert into public.profiles (
    id,
    full_name,
    phone,
    mobile,
    whatsapp,
    pincode,
    city,
    preferred_city,
    area,
    preferred_area,
    avatar_url,
    photo_url,
    updated_at
  )
  values (
    actor,
    case when has_name then owner_name else 'Salon Owner' end,
    case when p_profile ? 'phone' then nullif(btrim(p_profile->>'phone'), '') else null end,
    case when p_profile ? 'phone' then nullif(btrim(p_profile->>'phone'), '') else null end,
    case when p_profile ? 'whatsapp' then nullif(btrim(p_profile->>'whatsapp'), '') else null end,
    case when p_profile ? 'postalCode' or p_profile ? 'pincode' then coalesce(nullif(btrim(p_profile->>'postalCode'), ''), nullif(btrim(p_profile->>'pincode'), '')) else null end,
    case when p_profile ? 'city' then nullif(btrim(p_profile->>'city'), '') else null end,
    case when p_profile ? 'city' then nullif(btrim(p_profile->>'city'), '') else null end,
    case when p_profile ? 'areaLocality' or p_profile ? 'area' then coalesce(nullif(btrim(p_profile->>'areaLocality'), ''), nullif(btrim(p_profile->>'area'), '')) else null end,
    case when p_profile ? 'areaLocality' or p_profile ? 'area' then coalesce(nullif(btrim(p_profile->>'areaLocality'), ''), nullif(btrim(p_profile->>'area'), '')) else null end,
    case when p_profile ? 'avatar_url' or p_profile ? 'photo_url' then coalesce(nullif(btrim(p_profile->>'avatar_url'), ''), nullif(btrim(p_profile->>'photo_url'), '')) else null end,
    case when p_profile ? 'avatar_url' or p_profile ? 'photo_url' then coalesce(nullif(btrim(p_profile->>'avatar_url'), ''), nullif(btrim(p_profile->>'photo_url'), '')) else null end,
    now()
  )
  on conflict (id) do update set
    full_name = case when has_name then owner_name else public.profiles.full_name end,
    phone = case when p_profile ? 'phone' then nullif(btrim(p_profile->>'phone'), '') else public.profiles.phone end,
    mobile = case when p_profile ? 'phone' then nullif(btrim(p_profile->>'phone'), '') else public.profiles.mobile end,
    whatsapp = case when p_profile ? 'whatsapp' then nullif(btrim(p_profile->>'whatsapp'), '') else public.profiles.whatsapp end,
    pincode = case when p_profile ? 'postalCode' or p_profile ? 'pincode' then coalesce(nullif(btrim(p_profile->>'postalCode'), ''), nullif(btrim(p_profile->>'pincode'), '')) else public.profiles.pincode end,
    city = case when p_profile ? 'city' then nullif(btrim(p_profile->>'city'), '') else public.profiles.city end,
    preferred_city = case when p_profile ? 'city' then nullif(btrim(p_profile->>'city'), '') else public.profiles.preferred_city end,
    area = case when p_profile ? 'areaLocality' or p_profile ? 'area' then coalesce(nullif(btrim(p_profile->>'areaLocality'), ''), nullif(btrim(p_profile->>'area'), '')) else public.profiles.area end,
    preferred_area = case when p_profile ? 'areaLocality' or p_profile ? 'area' then coalesce(nullif(btrim(p_profile->>'areaLocality'), ''), nullif(btrim(p_profile->>'area'), '')) else public.profiles.preferred_area end,
    avatar_url = case when p_profile ? 'avatar_url' or p_profile ? 'photo_url' then coalesce(nullif(btrim(p_profile->>'avatar_url'), ''), nullif(btrim(p_profile->>'photo_url'), '')) else public.profiles.avatar_url end,
    photo_url = case when p_profile ? 'avatar_url' or p_profile ? 'photo_url' then coalesce(nullif(btrim(p_profile->>'avatar_url'), ''), nullif(btrim(p_profile->>'photo_url'), '')) else public.profiles.photo_url end,
    updated_at = now();
end;
$$;

revoke all on function public.sync_owner_contact(jsonb) from public, anon;
grant execute on function public.sync_owner_contact(jsonb) to authenticated, service_role;

create or replace function public.nexora_catalog_uuid(p_salon_id uuid, p_kind text, p_raw text)
returns uuid
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  trimmed text := btrim(p_raw);
  hash text;
begin
  if trimmed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return lower(trimmed)::uuid;
  end if;
  hash := md5(p_salon_id::text || ':' || p_kind || ':' || coalesce(nullif(trimmed, ''), 'item'));
  return (
    substr(hash, 1, 8) || '-' ||
    substr(hash, 9, 4) || '-4' ||
    substr(hash, 14, 3) || '-a' ||
    substr(hash, 18, 3) || '-' ||
    substr(hash, 21, 12)
  )::uuid;
end;
$$;

create or replace function public.nexora_website_youtube_id(p_url text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v text := btrim(coalesce(p_url, ''));
  m text[];
begin
  if v ~ '^[A-Za-z0-9_-]{11}$' then return v; end if;
  m := regexp_match(v, '^https?://(?:www\.|m\.)?youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#&]|$)');
  if m is not null then return m[1]; end if;
  m := regexp_match(v, '^https?://(?:www\.|m\.)?youtube(?:-nocookie)?\.com/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})(?:[/?#&]|$)');
  if m is not null then return m[1]; end if;
  m := regexp_match(v, '^https?://(?:www\.|m\.)?youtube(?:-nocookie)?\.com/watch/?\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#]|$)');
  if m is not null then return m[1]; end if;
  return null;
end;
$$;

create or replace function public.nexora_website_image_url(p_url text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    btrim(p_url) = ''
    or (btrim(p_url) ~ '^/([^/]|$)' and btrim(p_url) !~ E'[\\\\\r\n]')
    or btrim(p_url) ~* '^data:image/(png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,[A-Za-z0-9+/=\s]+$'
    or btrim(p_url) ~* '^https?://[^/@[:space:]]+([/?#].*)?$'
$$;

create or replace function public.nexora_save_owner_workspace(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  actor uuid := auth.uid();
  owned uuid[];
  target uuid;
  new_org_id uuid;
  profile jsonb := coalesce(p_state->'profile', '{}'::jsonb);
  public_profile jsonb;
  raw_slug text;
  slug_val text;
  item jsonb;
  schedule jsonb;
  local_id uuid;
  svc_id uuid;
  keep_services uuid[] := array[]::uuid[];
  keep_staff uuid[] := array[]::uuid[];
  idx integer := 0;
  day_index integer;
  price_rupees numeric;
  duration_mins integer;
  changed integer;
  vid text;
  vtag text;
  url text;
  videos jsonb := '[]'::jsonb;
  gallery jsonb := '[]'::jsonb;
  lookbook jsonb := '[]'::jsonb;
  reviews jsonb := '[]'::jsonb;
  shorts_n integer := 0;
  showcase_n integer := 0;
  rating_n integer;
  owner_name text;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or jsonb_typeof(profile) <> 'object' then
    raise exception 'Invalid workspace payload' using errcode = '22023';
  end if;
  if octet_length(p_state::text) > 10000000 or octet_length(profile::text) > 6000000 then
    raise exception 'Website content is too large; use smaller images' using errcode = '22023';
  end if;
  if nullif(btrim(profile->>'ownerId'), '') is not null and btrim(profile->>'ownerId') <> actor::text then
    raise exception 'Cross-account profile write rejected' using errcode = '42501';
  end if;

  select array_agg(s.id order by s.id)
  into owned
  from public.salons s
  where s.id in (select public.nexora_owner_salon_ids());

  if coalesce(array_length(owned, 1), 0) = 1 then
    target := owned[1];
  elsif coalesce(array_length(owned, 1), 0) > 1
    and nullif(btrim(p_state->>'salonId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (nullif(btrim(p_state->>'salonId'), '')::uuid = any(owned)) then
    target := nullif(btrim(p_state->>'salonId'), '')::uuid;
  elsif coalesce(array_length(owned, 1), 0) > 1 then
    select s.id
    into target
    from public.salons s
    where s.id = any(owned)
      and lower(coalesce(s.slug, '')) = lower(btrim(coalesce(profile->>'subdomain', '')))
    order by s.id
    limit 1;
    if target is null then
      target := owned[1];
    end if;
  end if;

  if target is null and to_regprocedure('public.owner_workspace_pick_salon()') is not null then
    execute 'select (public.owner_workspace_pick_salon() ->> ''salon_id'')::uuid' into target;
  end if;

  if (target is null or target not in (select public.nexora_owner_salon_ids()))
     and to_regprocedure('public.ensure_owner_workspace()') is not null then
    execute 'select (public.ensure_owner_workspace() ->> ''salon_id'')::uuid' into target;
  end if;

  if target is null then
    raise exception 'Select a salon owned by this account' using errcode = '42501';
  end if;

  for url in select coalesce(btrim(value), '') from unnest(array[
    profile->>'ownerPhotoUrl',
    profile->>'socialShareImageUrl',
    profile->>'customFaviconUrl',
    profile->>'coverImageUrl',
    profile->>'logoUrl'
  ]) as value loop
    if not public.nexora_website_image_url(url) then
      raise exception 'Invalid profile image URL' using errcode = '22023';
    end if;
  end loop;

  if coalesce(btrim(profile->>'faviconColor'), '') <> '' and btrim(profile->>'faviconColor') !~ '^#[0-9A-Fa-f]{3,8}$' then
    raise exception 'Invalid favicon color' using errcode = '22023';
  end if;

  for url in select coalesce(btrim(value), '') from unnest(array[
    profile->>'primaryColor',
    profile->>'secondaryColor',
    profile->>'customAccentColor',
    profile->>'backgroundColor'
  ]) as value loop
    if url <> '' and url !~ '^#[0-9A-Fa-f]{3,8}$' then
      raise exception 'Invalid brand color' using errcode = '22023';
    end if;
  end loop;

  if coalesce(btrim(profile->>'faviconLetter'), '') <> '' and char_length(btrim(profile->>'faviconLetter')) > 2 then
    raise exception 'Invalid favicon letter' using errcode = '22023';
  end if;
  if length(coalesce(profile->>'ownerBio', '')) > 2000
    or length(coalesce(profile->>'about', '')) > 4000
    or length(coalesce(profile->>'seoTitle', '')) > 120
    or length(coalesce(profile->>'seoDescription', '')) > 320
    or length(coalesce(profile->>'seoKeywords', '')) > 500 then
    raise exception 'Website text exceeds allowed length' using errcode = '22023';
  end if;

  if jsonb_typeof(profile->'socialVideos') = 'array' then
    for item in select value from jsonb_array_elements(profile->'socialVideos') loop
      vid := public.nexora_website_youtube_id(coalesce(nullif(btrim(item->>'youtubeUrl'), ''), item->>'videoId'));
      if vid is null then
        raise exception 'Use a valid YouTube link' using errcode = '22023';
      end if;
      if coalesce(btrim(item->>'title'), '') = '' or length(btrim(item->>'title')) > 200 or length(coalesce(item->>'description', '')) > 2000 then
        raise exception 'Invalid YouTube video details' using errcode = '22023';
      end if;
      vtag := case when upper(coalesce(item->>'categoryTag', '')) in ('SHORT', 'SHOWCASE', 'LONG') then upper(item->>'categoryTag') else 'SHORT' end;
      if vtag = 'SHORT' then shorts_n := shorts_n + 1; else showcase_n := showcase_n + 1; end if;
      if shorts_n > 14 or showcase_n > 14 then
        raise exception 'Video limit exceeded' using errcode = '22023';
      end if;
      videos := videos || jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(btrim(item->>'id'), ''), 'yt-' || vid),
        'videoId', vid,
        'youtubeUrl', case when vtag = 'SHORT' then 'https://www.youtube.com/shorts/' || vid else 'https://www.youtube.com/watch?v=' || vid end,
        'title', btrim(item->>'title'),
        'description', left(coalesce(btrim(item->>'description'), ''), 2000),
        'categoryTag', vtag,
        'thumbnailUrl', 'https://i.ytimg.com/vi/' || vid || '/hqdefault.jpg',
        'isDemo', coalesce((item->>'isDemo')::boolean, false),
        'isOwnerVideo', not coalesce((item->>'isDemo')::boolean, false)
      ));
    end loop;
  end if;

  if jsonb_typeof(profile->'gallery') = 'array' then
    for item in select value from jsonb_array_elements(profile->'gallery') limit 100 loop
      url := coalesce(btrim(item->>'url'), '');
      if url = '' then
        continue;
      end if;
      if not public.nexora_website_image_url(url) then
        raise exception 'Invalid gallery image' using errcode = '22023';
      end if;
      gallery := gallery || jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(btrim(item->>'id'), ''), md5(url)),
        'url', url,
        'title', left(coalesce(btrim(item->>'title'), ''), 120),
        'tag', left(coalesce(btrim(item->>'tag'), ''), 60)
      ));
    end loop;
  end if;

  if jsonb_typeof(profile->'lookbookPhotos') = 'array' then
    for item in select value from jsonb_array_elements(profile->'lookbookPhotos') limit 100 loop
      url := coalesce(btrim(item->>'url'), '');
      if url = '' then
        continue;
      end if;
      if not public.nexora_website_image_url(url) then
        raise exception 'Invalid lookbook image' using errcode = '22023';
      end if;
      lookbook := lookbook || jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(btrim(item->>'id'), ''), md5(url)),
        'url', url,
        'title', left(coalesce(btrim(item->>'title'), ''), 120),
        'tag', left(coalesce(btrim(item->>'tag'), ''), 60)
      ));
    end loop;
  end if;

  if jsonb_typeof(profile->'testimonials') = 'array' then
    for item in select value from jsonb_array_elements(profile->'testimonials') limit 50 loop
      if coalesce(btrim(item->>'name'), '') = '' or coalesce(btrim(item->>'comment'), '') = '' then
        raise exception 'Invalid testimonial' using errcode = '22023';
      end if;
      rating_n := greatest(1, least(5, coalesce((item->>'rating')::integer, 5)));
      reviews := reviews || jsonb_build_array(
        (item - 'name' - 'comment' - 'rating') || jsonb_build_object(
          'id', coalesce(nullif(btrim(item->>'id'), ''), md5((item->>'name') || (item->>'comment'))),
          'name', left(btrim(item->>'name'), 120),
          'comment', left(btrim(item->>'comment'), 1000),
          'rating', rating_n
        )
      );
    end loop;
  end if;

  perform public.sync_owner_contact(profile - 'avatar_url' - 'photo_url');
  select nullif(btrim(full_name), '') into owner_name from public.profiles where id = actor;
  profile := jsonb_set(profile, '{ownerId}', to_jsonb(actor::text), true);
  if owner_name is not null then
    profile := jsonb_set(profile, '{ownerName}', to_jsonb(owner_name), true);
  end if;
  if jsonb_typeof(profile->'socialVideos') = 'array' then profile := jsonb_set(profile, '{socialVideos}', videos, true); end if;
  if jsonb_typeof(profile->'gallery') = 'array' then profile := jsonb_set(profile, '{gallery}', gallery, true); end if;
  if jsonb_typeof(profile->'lookbookPhotos') = 'array' then profile := jsonb_set(profile, '{lookbookPhotos}', lookbook, true); end if;
  if jsonb_typeof(profile->'testimonials') = 'array' then profile := jsonb_set(profile, '{testimonials}', reviews, true); end if;

  raw_slug := lower(coalesce(nullif(btrim(profile->>'subdomain'), ''), ''));
  slug_val := nullif(btrim(regexp_replace(raw_slug, '[^a-z0-9-]+', '-', 'g'), '-'), '');
  if raw_slug <> '' and (slug_val is null or slug_val <> raw_slug) then
    raise exception 'Invalid website subdomain' using errcode = '22023';
  end if;
  if slug_val is not null and exists (select 1 from public.salons s where s.slug = slug_val and s.id <> target) then
    raise exception 'Subdomain already in use' using errcode = '23505';
  end if;

  public_profile := profile - 'ownerId' - 'dob' - 'dateOfBirth' - 'gender' - 'pan' - 'aadhaar' - 'kyc' - 'bankAccount' - 'upiId';

  update public.salons s set
    name = coalesce(nullif(btrim(profile->>'businessName'), ''), s.name),
    slug = coalesce(slug_val, s.slug),
    subdomain = coalesce(slug_val, s.subdomain),
    business_type = coalesce(nullif(btrim(profile->>'businessType'), ''), s.business_type),
    tagline = case when profile ? 'tagline' then nullif(btrim(profile->>'tagline'), '') else s.tagline end,
    about = case when profile ? 'about' then nullif(btrim(profile->>'about'), '') else s.about end,
    phone = case when profile ? 'phone' then nullif(btrim(profile->>'phone'), '') else s.phone end,
    mobile = case when profile ? 'phone' then nullif(btrim(profile->>'phone'), '') else s.mobile end,
    whatsapp = case when profile ? 'whatsapp' then nullif(btrim(profile->>'whatsapp'), '') else s.whatsapp end,
    email = case when profile ? 'email' then nullif(btrim(profile->>'email'), '') else s.email end,
    address = case when profile ? 'address' then nullif(btrim(profile->>'address'), '') else s.address end,
    area = case when profile ? 'areaLocality' then nullif(btrim(profile->>'areaLocality'), '') else s.area end,
    city = case when profile ? 'city' then nullif(btrim(profile->>'city'), '') else s.city end,
    pincode = case when profile ? 'postalCode' then nullif(btrim(profile->>'postalCode'), '') else s.pincode end,
    logo_url = case when profile ? 'logoUrl' then nullif(btrim(profile->>'logoUrl'), '') else s.logo_url end,
    cover_image_url = case when profile ? 'coverImageUrl' then nullif(btrim(profile->>'coverImageUrl'), '') else s.cover_image_url end,
    primary_color = case when profile ? 'primaryColor' or profile ? 'customAccentColor' then coalesce(nullif(btrim(profile->>'primaryColor'), ''), nullif(btrim(profile->>'customAccentColor'), '')) else s.primary_color end,
    accent_color = case when profile ? 'secondaryColor' or profile ? 'customAccentColor' then coalesce(nullif(btrim(profile->>'secondaryColor'), ''), nullif(btrim(profile->>'customAccentColor'), '')) else s.accent_color end,
    theme_key = case when profile ? 'themePreset' then nullif(btrim(profile->>'themePreset'), '') else s.theme_key end,
    template_key = coalesce(nullif(btrim(p_state->>'selectedTemplateId'), ''), nullif(btrim(profile->>'businessType'), ''), s.template_key),
    custom_domain = case when profile ? 'customDomain' then nullif(lower(btrim(profile->>'customDomain')), '') else s.custom_domain end,
    data = coalesce(s.data, '{}'::jsonb) || jsonb_build_object(
      'editor_profile', public_profile,
      'selected_template_id', coalesce(p_state->'selectedTemplateId', to_jsonb(profile->>'businessType'))
    ),
    updated_at = now()
  where s.id = target;

  -- Ensure default salon_hours rows exist so public site & customer availability work
  if to_regclass('public.salon_hours') is not null then
    insert into public.salon_hours (salon_id, day_of_week, opens_at, closes_at, is_closed)
    select target, d, '09:00'::time, '21:00'::time, false
    from generate_series(0, 6) as d
    on conflict (salon_id, day_of_week) do nothing;
  end if;

  if jsonb_typeof(p_state->'services') = 'array' then
    for item in select value from jsonb_array_elements(p_state->'services') loop
      if coalesce(btrim(item->>'name'), '') = '' then
        raise exception 'Service name is required' using errcode = '22023';
      end if;
      price_rupees := (item->>'price')::numeric;
      duration_mins := (item->>'durationMinutes')::integer;
      if price_rupees is null or price_rupees < 0 or duration_mins is null or duration_mins <= 0 then
        raise exception 'Invalid service price or duration' using errcode = '22023';
      end if;
      if not public.nexora_website_image_url(coalesce(btrim(item->>'imageUrl'), '')) then
        raise exception 'Invalid service image URL' using errcode = '22023';
      end if;
      local_id := public.nexora_catalog_uuid(target, 'service', coalesce(item->>'id', item->>'name'));
      keep_services := array_append(keep_services, local_id);
      insert into public.services (
        id, salon_id, owner_id, name, category, description, duration_minutes,
        price, price_paise, icon, image_url, popular, is_active, is_bookable_online, is_featured, display_order
      )
      values (
        local_id, target, actor, btrim(item->>'name'),
        coalesce(nullif(btrim(item->>'category'), ''), 'General'),
        item->>'description', duration_mins, price_rupees,
        round(price_rupees * 100)::bigint, item->>'icon', item->>'imageUrl',
        coalesce((item->>'popular')::boolean, false), true, true,
        coalesce((item->>'popular')::boolean, false), idx
      )
      on conflict (id) do update set
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        duration_minutes = excluded.duration_minutes,
        price = excluded.price,
        price_paise = excluded.price_paise,
        icon = excluded.icon,
        image_url = excluded.image_url,
        popular = excluded.popular,
        is_active = true,
        is_bookable_online = true,
        is_featured = excluded.is_featured,
        display_order = excluded.display_order,
        updated_at = now()
      where public.services.salon_id = target;
      get diagnostics changed = row_count;
      if changed <> 1 then
        raise exception 'Cross-tenant service write rejected' using errcode = '42501';
      end if;
      idx := idx + 1;
    end loop;

    update public.services
    set is_active = false, is_bookable_online = false, updated_at = now()
    where salon_id = target
      and not (id = any(keep_services));
  end if;

  if jsonb_typeof(p_state->'stylists') = 'array' then
    for item in select value from jsonb_array_elements(p_state->'stylists') loop
      if coalesce(btrim(item->>'name'), '') = '' then
        raise exception 'Staff name is required' using errcode = '22023';
      end if;
      if not public.nexora_website_image_url(coalesce(btrim(item->>'avatarUrl'), '')) then
        raise exception 'Invalid staff image URL' using errcode = '22023';
      end if;
      local_id := public.nexora_catalog_uuid(target, 'staff', coalesce(item->>'id', item->>'name'));
      keep_staff := array_append(keep_staff, local_id);
      insert into public.staff (
        id, salon_id, name, full_name, role_title, phone, bio,
        avatar_path, profile_photo_url, is_active, is_public
      )
      values (
        local_id, target, btrim(item->>'name'), btrim(item->>'name'),
        item->>'role', item->>'phone', item->>'bio',
        item->>'avatarUrl', item->>'avatarUrl',
        coalesce(item->>'status', 'Available') <> 'Inactive',
        coalesce(item->>'status', 'Available') <> 'Inactive'
      )
      on conflict (id) do update set
        name = excluded.name,
        full_name = excluded.full_name,
        role_title = excluded.role_title,
        phone = excluded.phone,
        bio = excluded.bio,
        avatar_path = excluded.avatar_path,
        profile_photo_url = excluded.profile_photo_url,
        is_active = excluded.is_active,
        is_public = excluded.is_active,
        updated_at = now()
      where public.staff.salon_id = target;
      get diagnostics changed = row_count;
      if changed <> 1 then
        raise exception 'Cross-tenant staff write rejected' using errcode = '42501';
      end if;

      delete from public.staff_services where staff_id = local_id;
      if jsonb_typeof(item->'assignedServices') = 'array' then
        for schedule in select value from jsonb_array_elements(item->'assignedServices') loop
          svc_id := public.nexora_catalog_uuid(target, 'service', trim(both '"' from schedule::text));
          if not exists (select 1 from public.services s where s.id = svc_id and s.salon_id = target and s.is_active = true) then
            raise exception 'Assigned service is not available in this salon' using errcode = '22023';
          end if;
          insert into public.staff_services (staff_id, service_id, is_active)
          values (local_id, svc_id, true)
          on conflict (staff_id, service_id) do update set is_active = true;
        end loop;
      end if;

      if jsonb_typeof(item->'schedule') = 'array' then
        delete from public.staff_schedules where staff_id = local_id;
        for schedule in select value from jsonb_array_elements(item->'schedule') loop
          day_index := case lower(coalesce(schedule->>'day', ''))
            when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2
            when 'wednesday' then 3 when 'thursday' then 4 when 'friday' then 5
            when 'saturday' then 6 else null end;
          if day_index is null then
            raise exception 'Invalid staff schedule day' using errcode = '22023';
          end if;
          if coalesce((schedule->>'enabled')::boolean, false) and (
            nullif(schedule->>'fromTime', '')::time is null
            or nullif(schedule->>'toTime', '')::time is null
            or nullif(schedule->>'toTime', '')::time <= nullif(schedule->>'fromTime', '')::time
          ) then
            raise exception 'Invalid staff schedule time range' using errcode = '22023';
          end if;
          insert into public.staff_schedules (staff_id, day_of_week, start_time, end_time, is_working)
          values (
            local_id,
            day_index,
            coalesce(nullif(schedule->>'fromTime', '')::time, '09:00'::time),
            coalesce(nullif(schedule->>'toTime', '')::time, '18:00'::time),
            coalesce((schedule->>'enabled')::boolean, false)
          );
        end loop;
      end if;
    end loop;

    update public.staff
    set is_active = false, is_public = false, updated_at = now()
    where salon_id = target
      and not (id = any(keep_staff));
  end if;

  insert into public.owner_editor_state (owner_id, state, updated_at)
  values (
    actor,
    jsonb_set(jsonb_set(p_state, '{profile}', profile, true), '{salonId}', to_jsonb(target::text), true),
    now()
  )
  on conflict (owner_id) do update set
    state = excluded.state,
    updated_at = now();
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_owner_editor_state'
      and pg_get_function_identity_arguments(p.oid) = 'p_state jsonb'
      and pg_get_function_result(p.oid) <> 'void'
  ) then
    drop function public.save_owner_editor_state(jsonb);
  end if;
end $$;

create or replace function public.save_owner_editor_state(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.nexora_save_owner_workspace(p_state);
end;
$$;

create or replace function public.get_owner_editor_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  actor uuid := auth.uid();
  state jsonb;
  owner_name text;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select o.state into state from public.owner_editor_state o where o.owner_id = actor;
  if state is null then
    return null;
  end if;
  select nullif(btrim(full_name), '') into owner_name from public.profiles where id = actor;
  if owner_name is not null and jsonb_typeof(state->'profile') = 'object' then
    state := jsonb_set(state, '{profile,ownerName}', to_jsonb(owner_name), true);
  end if;
  return state;
end;
$$;

revoke all on function public.nexora_save_owner_workspace(jsonb) from public, anon;
revoke all on function public.save_owner_editor_state(jsonb) from public, anon;
revoke all on function public.get_owner_editor_state() from public, anon;
grant execute on function public.nexora_save_owner_workspace(jsonb) to authenticated, service_role;
grant execute on function public.save_owner_editor_state(jsonb) to authenticated, service_role;
grant execute on function public.get_owner_editor_state() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. CUSTOMER BOOKING AVAILABILITY RPC (Fixes PGRST202 on /api/bookings/availability)
-- ----------------------------------------------------------------------------
create or replace function public.nexora_customer_booking_options(
  p_salon_id uuid,
  p_service_ids uuid[],
  p_date date,
  p_staff_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  salon public.salons%rowtype;
  hours public.salon_hours%rowtype;
  specialist record;
  candidate timestamp;
  starts timestamptz;
  duration integer;
  price bigint;
  need integer;
  slots jsonb := '[]'::jsonb;
  specialists jsonb := '[]'::jsonb;
  free boolean;
begin
  select * into salon
  from public.salons
  where id = p_salon_id
    and is_active = true
    and is_listed = true
    and online_booking_enabled = true
    and deleted_at is null;
  if not found then
    return jsonb_build_object('available_slots', '[]'::jsonb, 'available_staff', '[]'::jsonb, 'closed', true);
  end if;

  select count(distinct id) into need from unnest(coalesce(p_service_ids, array[]::uuid[])) id;
  if need = 0 then
    return jsonb_build_object('available_slots', '[]'::jsonb, 'available_staff', '[]'::jsonb);
  end if;

  select count(*), coalesce(sum(duration_minutes), 0), coalesce(sum(price_paise), 0)
  into need, duration, price
  from public.services
  where salon_id = p_salon_id
    and id = any(p_service_ids)
    and is_active = true
    and is_bookable_online = true
  having count(*) = (select count(distinct id) from unnest(p_service_ids) id);
  if not found or duration <= 0 then
    return jsonb_build_object('available_slots', '[]'::jsonb, 'available_staff', '[]'::jsonb);
  end if;

  select * into hours
  from public.salon_hours
  where salon_id = p_salon_id
    and day_of_week = extract(dow from p_date)::integer
    and not is_closed;
  if not found or hours.opens_at is null or hours.closes_at is null or hours.closes_at <= hours.opens_at then
    return jsonb_build_object('available_slots', '[]'::jsonb, 'available_staff', '[]'::jsonb, 'closed', true);
  end if;

  for specialist in
    select st.id, st.full_name, st.role_title, st.profile_photo_url, sc.start_time, sc.end_time
    from public.staff st
    left join public.staff_schedules sc
      on sc.staff_id = st.id
     and sc.day_of_week = extract(dow from p_date)::integer
    where st.salon_id = p_salon_id
      and st.is_active = true
      and st.is_public = true
      and st.employment_status = 'active'
      and st.deleted_at is null
      and (p_staff_id is null or st.id = p_staff_id)
      and (
        sc.staff_id is null
        or (
          sc.is_working = true
          and sc.start_time is not null
          and sc.end_time is not null
          and sc.end_time > sc.start_time
        )
      )
      and (
        not exists (
          select 1 from public.staff_services ss_any
          where ss_any.staff_id = st.id
            and ss_any.is_active = true
        )
        or (
          select count(distinct ss.service_id)
          from public.staff_services ss
          where ss.staff_id = st.id
            and ss.is_active = true
            and ss.service_id = any(p_service_ids)
        ) = need
      )
    order by coalesce(st.display_order, 0), st.full_name
  loop
    specialists := specialists || jsonb_build_array(jsonb_build_object(
      'id', specialist.id,
      'name', specialist.full_name,
      'role_title', specialist.role_title,
      'photo_url', specialist.profile_photo_url
    ));
  end loop;

  if jsonb_array_length(specialists) = 0 then
    return jsonb_build_object(
      'available_slots', '[]'::jsonb,
      'available_staff', '[]'::jsonb,
      'duration_minutes', duration,
      'total_paise', price
    );
  end if;

  candidate := p_date + hours.opens_at;
  while candidate + make_interval(mins => duration) <= p_date + hours.closes_at loop
    starts := candidate at time zone coalesce(nullif(salon.timezone, ''), 'Asia/Kolkata');
    free := false;
    for specialist in
      select st.id, coalesce(sc.start_time, hours.opens_at) as start_time, coalesce(sc.end_time, hours.closes_at) as end_time
      from public.staff st
      left join public.staff_schedules sc
        on sc.staff_id = st.id
       and sc.day_of_week = extract(dow from p_date)::integer
      where st.id in (
        select (value->>'id')::uuid from jsonb_array_elements(specialists)
      )
    loop
      if candidate::time >= greatest(hours.opens_at, specialist.start_time)
        and (candidate + make_interval(mins => duration))::time <= least(hours.closes_at, specialist.end_time)
        and not exists (
          select 1 from public.bookings b
          where b.salon_id = p_salon_id
            and b.primary_staff_id = specialist.id
            and b.status in ('pending', 'confirmed', 'checked_in', 'in_service')
            and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(starts, starts + make_interval(mins => duration), '[)')
        )
        and not exists (
          select 1 from public.staff_time_off off
          where off.staff_id = specialist.id
            and tstzrange(off.starts_at, off.ends_at, '[)') && tstzrange(starts, starts + make_interval(mins => duration), '[)')
        )
      then
        free := true;
        exit;
      end if;
    end loop;

    if free then
      slots := slots || jsonb_build_array(jsonb_build_object(
        'time', to_char(candidate, 'HH24:MI'),
        'starts_at', starts,
        'ends_at', starts + make_interval(mins => duration)
      ));
    end if;
    candidate := candidate + interval '30 minutes';
  end loop;

  return jsonb_build_object(
    'available_slots', slots,
    'available_staff', specialists,
    'duration_minutes', duration,
    'total_paise', price
  );
end;
$$;

grant execute on function public.nexora_customer_booking_options(uuid, uuid[], date, uuid)
  to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. BACKFILL EXISTING SALONS (PUBLIC STAFF VISIBILITY & DEFAULT SALON HOURS)
-- ----------------------------------------------------------------------------
update public.staff
set is_public = is_active
where is_active = true
  and is_public is distinct from true;

do $$
begin
  if to_regclass('public.salon_hours') is not null then
    insert into public.salon_hours (salon_id, day_of_week, opens_at, closes_at, is_closed)
    select s.id, d, '09:00'::time, '21:00'::time, false
    from public.salons s
    cross join generate_series(0, 6) as d
    where s.is_active = true
    on conflict (salon_id, day_of_week) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
