-- ============================================================================
-- Nexora Salon OS — Production Schema Reconciliation & Drift Repair (PHASE 5)
-- Migration: 20261012_production_schema_reconciliation.sql
-- ----------------------------------------------------------------------------
-- Bridges legacy schema bootstrap (00001_init.sql) and intermediate migrations
-- with the canonical normalized production database (project qwaehqsmodekbgvnaavz).
--
-- This migration addresses:
--   1. Split / alias tables across schema generations:
--      • profiles ↔ salon_profiles (with user_id compatibility)
--      • staff ↔ salon_staff ↔ stylists
--      • in_app_notifications ↔ notifications
--   2. Missing or drifted RPCs:
--      • cancel_customer_booking(uuid, text) → boolean
--      • get_owner_editor_state() → jsonb
--      • sync_owner_contact(jsonb) reconciled for normalized salons via
--        nexora_owner_salon_ids() + legacy owner_id
--   3. owner_editor_state table guarantee with owner RLS and DML grants.
--   4. Tenant RLS enforcement across normalized and legacy tables:
--      • bookings, booking_items, services, staff_services, staff_schedules, reviews
--   5. Insecure / permissive wildcard policy cleanup (using (true) on private tables).
--   6. Least-privilege role & sequence grants (select, insert, update, delete).
--
-- Idempotent, safe, and backwards-compatible with all schema generations.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Ensure owner_editor_state table exists
-- ---------------------------------------------------------------------------
create table if not exists public.owner_editor_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.owner_editor_state enable row level security;

drop policy if exists editor_owner on public.owner_editor_state;
drop policy if exists owner_editor_state_owner_all on public.owner_editor_state;
create policy owner_editor_state_owner_all on public.owner_editor_state
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select, insert, update, delete on table public.owner_editor_state to authenticated;
revoke truncate, references, trigger on table public.owner_editor_state from authenticated;

-- ---------------------------------------------------------------------------
-- 2. profiles ↔ salon_profiles compatibility
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is not null then
    -- Ensure user_id column exists on profiles if absent, defaulting to id
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'user_id'
    ) then
      begin
        alter table public.profiles add column user_id uuid references auth.users(id) on delete cascade;
        update public.profiles set user_id = id where user_id is null;
      exception when others then
        raise notice 'profiles user_id column could not be added: %', sqlerrm;
      end;
    end if;

    -- If salon_profiles does not exist, provide an updatable compatibility view
    if to_regclass('public.salon_profiles') is null then
      create or replace view public.salon_profiles as select * from public.profiles;
      grant select, insert, update, delete on public.salon_profiles to authenticated;
      grant select on public.salon_profiles to anon;
    end if;
  elsif to_regclass('public.salon_profiles') is not null and to_regclass('public.profiles') is null then
    create or replace view public.profiles as select * from public.salon_profiles;
    grant select, insert, update, delete on public.profiles to authenticated;
    grant select on public.profiles to anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. staff ↔ salon_staff ↔ stylists compatibility
-- ---------------------------------------------------------------------------
do $$
begin
  -- If staff exists and salon_staff does not exist
  if to_regclass('public.staff') is not null and to_regclass('public.salon_staff') is null then
    create or replace view public.salon_staff as select * from public.staff;
    grant select, insert, update, delete on public.salon_staff to authenticated;
    grant select on public.salon_staff to anon;
  end if;

  -- If staff exists and stylists does not exist
  if to_regclass('public.staff') is not null and to_regclass('public.stylists') is null then
    create or replace view public.stylists as select * from public.staff;
    grant select, insert, update, delete on public.stylists to authenticated;
    grant select on public.stylists to anon;
  end if;

  -- If stylists exists and staff does not exist
  if to_regclass('public.stylists') is not null and to_regclass('public.staff') is null then
    create or replace view public.staff as select * from public.stylists;
    grant select, insert, update, delete on public.staff to authenticated;
    grant select on public.staff to anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. in_app_notifications ↔ notifications compatibility
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.in_app_notifications') is not null and to_regclass('public.notifications') is null then
    create or replace view public.notifications as select * from public.in_app_notifications;
    grant select, insert, update, delete on public.notifications to authenticated;
    grant select on public.notifications to anon;
  elsif to_regclass('public.notifications') is not null and to_regclass('public.in_app_notifications') is null then
    create or replace view public.in_app_notifications as select * from public.notifications;
    grant select, insert, update, delete on public.in_app_notifications to authenticated;
    grant select on public.in_app_notifications to anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RPC: get_owner_editor_state()
-- ---------------------------------------------------------------------------
create or replace function public.get_owner_editor_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  res jsonb;
begin
  if actor is null then
    return null;
  end if;

  if to_regclass('public.owner_editor_state') is not null then
    select state into res
    from public.owner_editor_state
    where owner_id = actor;
    return res;
  end if;

  return null;
end;
$$;

revoke all on function public.get_owner_editor_state() from public, anon;
grant execute on function public.get_owner_editor_state() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC: cancel_customer_booking(uuid, text)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_customer_booking(p_booking_id uuid, p_reason text default 'Customer cancellation')
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  b_status text;
  b_customer uuid;
  b_salon uuid;
  b_owner uuid;
  is_auth boolean := false;
  has_customer_col boolean;
  has_salon_col boolean;
  has_owner_col boolean;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  has_customer_col := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'customer_user_id'
  );
  has_salon_col := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'salon_id'
  );
  has_owner_col := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'owner_id'
  );

  execute 'select status, '
    || case when has_customer_col then 'customer_user_id' else 'null::uuid' end || ', '
    || case when has_salon_col then 'salon_id' else 'null::uuid' end || ', '
    || case when has_owner_col then 'owner_id' else 'null::uuid' end
    || ' from public.bookings where id = $1 for update'
    into b_status, b_customer, b_salon, b_owner
    using p_booking_id;

  if b_status is null then
    return false;
  end if;

  if b_status = 'cancelled' then
    return true;
  end if;

  if b_status not in ('pending', 'payment_pending', 'confirmed', 'reschedule_proposed', 'reschedule_requested') then
    return false;
  end if;

  if b_customer is not null and b_customer = actor then
    is_auth := true;
  end if;

  if not is_auth and b_owner is not null and b_owner = actor then
    is_auth := true;
  end if;

  if not is_auth and b_salon is not null then
    if exists (
      select 1 from public.salons s
      join public.organization_members om on om.organization_id = s.organization_id
      where s.id = b_salon
        and om.user_id = actor
        and om.status = 'active'
    ) or (
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'salons' and column_name = 'owner_id'
      ) and exists (
        select 1 from public.salons s where s.id = b_salon and s.owner_id = actor
      )
    ) then
      is_auth := true;
    end if;
  end if;

  if not is_auth then
    raise exception 'Unauthorized to cancel this booking' using errcode = '42501';
  end if;

  execute 'update public.bookings set status = ''cancelled'''
    || case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'bookings' and column_name = 'cancelled_at'
       ) then ', cancelled_at = now()' else '' end
    || case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'bookings' and column_name = 'updated_at'
       ) then ', updated_at = now()' else '' end
    || case
         when p_reason is not null and btrim(p_reason) <> '' then
           ', customer_note = case when customer_note is null or btrim(customer_note) = '''' then ''Cancelled: '' || $2 else customer_note || E''\nCancelled: '' || $2 end'
         else ''
       end
    || ' where id = $1'
    using p_booking_id, btrim(p_reason);

  return true;
end;
$$;

revoke all on function public.cancel_customer_booking(uuid, text) from public, anon;
grant execute on function public.cancel_customer_booking(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC: sync_owner_contact(jsonb) — reconciled for normalized + legacy
-- ---------------------------------------------------------------------------
create or replace function public.sync_owner_contact(p_profile jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  changed integer;
  patch jsonb;
  has_owner_id boolean;
  has_slug boolean;
  salon_where text;
  salon_stmt text;
begin
  if actor is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(p_profile) <> 'object' or p_profile is null then raise exception 'Invalid profile'; end if;
  if octet_length(p_profile::text) > 4000000 then raise exception 'Profile is too large; use image uploads'; end if;

  if to_regclass('public.profiles') is not null then
    update public.profiles set
      full_name = case when p_profile ? 'ownerName' then p_profile->>'ownerName' else full_name end,
      phone = case when p_profile ? 'phone' then p_profile->>'phone' else phone end,
      mobile = case when p_profile ? 'phone' then p_profile->>'phone' else mobile end,
      whatsapp = case when p_profile ? 'whatsapp' then p_profile->>'whatsapp' else whatsapp end,
      pincode = case when p_profile ? 'postalCode' then p_profile->>'postalCode' else pincode end,
      city = case when p_profile ? 'city' then p_profile->>'city' else city end,
      preferred_city = case when p_profile ? 'city' then p_profile->>'city' else preferred_city end,
      area = case when p_profile ? 'areaLocality' then p_profile->>'areaLocality' else area end,
      preferred_area = case when p_profile ? 'areaLocality' then p_profile->>'areaLocality' else preferred_area end,
      avatar_url = case when p_profile ? 'ownerPhotoUrl' then p_profile->>'ownerPhotoUrl' else avatar_url end,
      photo_url = case when p_profile ? 'ownerPhotoUrl' then p_profile->>'ownerPhotoUrl' else photo_url end
    where id = actor;

    get diagnostics changed = row_count;
    if changed <> 1 then
      insert into public.profiles (
        id, full_name, phone, mobile, whatsapp, pincode, city, preferred_city, area, preferred_area, avatar_url, photo_url
      ) values (
        actor,
        p_profile->>'ownerName',
        p_profile->>'phone',
        p_profile->>'phone',
        p_profile->>'whatsapp',
        p_profile->>'postalCode',
        p_profile->>'city',
        p_profile->>'city',
        p_profile->>'areaLocality',
        p_profile->>'areaLocality',
        p_profile->>'ownerPhotoUrl',
        p_profile->>'ownerPhotoUrl'
      ) on conflict (id) do update set
        full_name = coalesce(excluded.full_name, profiles.full_name),
        phone = coalesce(excluded.phone, profiles.phone),
        whatsapp = coalesce(excluded.whatsapp, profiles.whatsapp),
        pincode = coalesce(excluded.pincode, profiles.pincode),
        city = coalesce(excluded.city, profiles.city),
        area = coalesce(excluded.area, profiles.area),
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
        photo_url = coalesce(excluded.photo_url, profiles.photo_url);
    end if;
  end if;

  patch := p_profile - array['dateOfBirth','dob','notifications','whatsappNotifications'];
  if to_regclass('public.owner_editor_state') is not null then
    insert into public.owner_editor_state(owner_id, state) values(actor, jsonb_build_object('profile', patch))
    on conflict(owner_id) do update set
      state = jsonb_set(owner_editor_state.state, '{profile}', coalesce(owner_editor_state.state->'profile', '{}'::jsonb) || patch),
      updated_at = now();
  end if;

  if to_regclass('public.salons') is not null then
    has_owner_id := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'salons' and column_name = 'owner_id'
    );
    has_slug := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'salons' and column_name = 'slug'
    );

    if to_regprocedure('public.nexora_owner_salon_ids()') is not null and has_owner_id then
      salon_where := '(id in (select public.nexora_owner_salon_ids()) or owner_id = $2)';
    elsif to_regprocedure('public.nexora_owner_salon_ids()') is not null then
      salon_where := 'id in (select public.nexora_owner_salon_ids())';
    elsif has_owner_id then
      salon_where := 'owner_id = $2';
    else
      salon_where := 'false';
    end if;

    if has_slug and patch ? 'subdomain' and nullif(btrim(patch->>'subdomain'), '') is not null then
      salon_where := salon_where || ' and (slug = ($1->>''subdomain'') or (select count(*) from public.salons where ' || salon_where || ') = 1)';
    end if;

    salon_stmt := 'update public.salons set '
      || 'name = case when $1 ? ''businessName'' and nullif(btrim($1->>''businessName''), '''') is not null then btrim($1->>''businessName'') else name end, '
      || 'phone = case when $1 ? ''phone'' then $1->>''phone'' else phone end, '
      || 'mobile = case when $1 ? ''phone'' then $1->>''phone'' else mobile end, '
      || 'whatsapp = case when $1 ? ''whatsapp'' then $1->>''whatsapp'' else whatsapp end, '
      || 'email = case when $1 ? ''email'' then $1->>''email'' else email end, '
      || 'address = case when $1 ? ''address'' then $1->>''address'' else address end, '
      || 'city = case when $1 ? ''city'' then $1->>''city'' else city end, '
      || 'area = case when $1 ? ''areaLocality'' then $1->>''areaLocality'' else area end, '
      || 'state = case when $1 ? ''state'' then $1->>''state'' else state end, '
      || 'pincode = case when $1 ? ''postalCode'' then $1->>''postalCode'' else pincode end, '
      || 'landmark = case when $1 ? ''landmark'' then $1->>''landmark'' else landmark end, '
      || 'latitude = case when $1 ? ''latitude'' then ($1->>''latitude'')::numeric else latitude end, '
      || 'longitude = case when $1 ? ''longitude'' then ($1->>''longitude'')::numeric else longitude end, '
      || 'data = coalesce(data, ''{}''::jsonb) || jsonb_build_object('
      || '''owner_photo_url'', coalesce($1->>''ownerPhotoUrl'', data->>''owner_photo_url''), '
      || '''owner_name'', coalesce($1->>''ownerName'', data->>''owner_name'')'
      || ') '
      || 'where ' || salon_where;

    execute salon_stmt using patch, actor;
  end if;
end;
$$;

revoke all on function public.sync_owner_contact(jsonb) from public, anon;
grant execute on function public.sync_owner_contact(jsonb) to authenticated;

-- Ensure authenticated role has update grants on updated salon columns
do $$
declare
  present text;
begin
  if to_regclass('public.salons') is not null then
    present := (
      select string_agg(column_name, ', ' order by column_name)
      from information_schema.columns
      where table_schema = 'public' and table_name = 'salons'
        and column_name in (
          'name', 'phone', 'mobile', 'whatsapp', 'email', 'address', 'city', 'area',
          'state', 'pincode', 'landmark', 'latitude', 'longitude', 'data'
        )
    );
    if present is not null then
      execute format('grant update (%s) on table public.salons to authenticated', present);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Tenant RLS: services, staff_services, staff_schedules, bookings, booking_items, reviews, notifications
-- ---------------------------------------------------------------------------
do $$
declare
  has_owner_id boolean;
  has_salon_id boolean;
  has_customer_id boolean;
  has_email boolean;
  has_user_id boolean;
  select_clauses text[];
  write_clauses text[];
begin

-- 8a. services
if to_regclass('public.services') is not null then
  execute 'alter table public.services enable row level security';
  execute 'drop policy if exists services_tenant_select on public.services';
  execute 'drop policy if exists services_owner_write on public.services';

  has_owner_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'owner_id');
  has_salon_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'salon_id');

  select_clauses := array['(is_active = true)'];
  write_clauses := array[]::text[];

  if has_salon_id then
    select_clauses := array_append(select_clauses, $c$
      (auth.uid() is not null and exists (
        select 1 from public.salons s
        join public.organization_members om on om.organization_id = s.organization_id
        where s.id = services.salon_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      ))
    $c$);
    write_clauses := array_append(write_clauses, $c$
      exists (
        select 1 from public.salons s
        join public.organization_members om on om.organization_id = s.organization_id
        where s.id = services.salon_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    $c$);
  end if;

  if has_owner_id then
    select_clauses := array_append(select_clauses, '(owner_id = auth.uid())');
    write_clauses := array_append(write_clauses, '(owner_id = auth.uid())');
  end if;

  if array_length(select_clauses, 1) > 0 then
    execute format('create policy services_tenant_select on public.services for select using (%s)', array_to_string(select_clauses, ' or '));
  end if;
  if array_length(write_clauses, 1) > 0 then
    execute format('create policy services_owner_write on public.services for all to authenticated using (%s) with check (%s)', array_to_string(write_clauses, ' or '), array_to_string(write_clauses, ' or '));
  end if;

  execute 'grant select, insert, update, delete on table public.services to authenticated';
  execute 'grant select on table public.services to anon';
  execute 'revoke truncate, references, trigger on table public.services from authenticated, anon';
end if;

-- 8b. staff_services & staff_schedules
if to_regclass('public.staff_services') is not null then
  execute 'alter table public.staff_services enable row level security';

  execute 'drop policy if exists staff_services_select on public.staff_services';
  execute $p$
    create policy staff_services_select on public.staff_services for select
    using (
      (is_active = true)
      or (auth.uid() is not null and exists (
        select 1 from public.staff st
        join public.salons s on s.id = st.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where st.id = staff_services.staff_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      ))
    )
  $p$;

  execute 'drop policy if exists staff_services_owner_write on public.staff_services';
  execute $p$
    create policy staff_services_owner_write on public.staff_services for all to authenticated
    using (
      exists (
        select 1 from public.staff st
        join public.salons s on s.id = st.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where st.id = staff_services.staff_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    )
    with check (
      exists (
        select 1 from public.staff st
        join public.salons s on s.id = st.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where st.id = staff_services.staff_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    )
  $p$;

  execute 'grant select, insert, update, delete on table public.staff_services to authenticated';
  execute 'grant select on table public.staff_services to anon';
  execute 'revoke truncate, references, trigger on table public.staff_services from authenticated, anon';
end if;

if to_regclass('public.staff_schedules') is not null then
  execute 'alter table public.staff_schedules enable row level security';

  execute 'drop policy if exists staff_schedules_select on public.staff_schedules';
  execute $p$
    create policy staff_schedules_select on public.staff_schedules for select
    using (
      (is_working = true)
      or (auth.uid() is not null and exists (
        select 1 from public.staff st
        join public.salons s on s.id = st.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where st.id = staff_schedules.staff_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      ))
    )
  $p$;

  execute 'drop policy if exists staff_schedules_owner_write on public.staff_schedules';
  execute $p$
    create policy staff_schedules_owner_write on public.staff_schedules for all to authenticated
    using (
      exists (
        select 1 from public.staff st
        join public.salons s on s.id = st.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where st.id = staff_schedules.staff_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    )
    with check (
      exists (
        select 1 from public.staff st
        join public.salons s on s.id = st.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where st.id = staff_schedules.staff_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    )
  $p$;

  execute 'grant select, insert, update, delete on table public.staff_schedules to authenticated';
  execute 'grant select on table public.staff_schedules to anon';
  execute 'revoke truncate, references, trigger on table public.staff_schedules from authenticated, anon';
end if;

-- 8c. bookings
if to_regclass('public.bookings') is not null then
  execute 'alter table public.bookings enable row level security';
  execute 'drop policy if exists bookings_tenant_select on public.bookings';
  execute 'drop policy if exists bookings_owner_write on public.bookings';

  has_owner_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'owner_id');
  has_salon_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'salon_id');
  has_customer_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'customer_user_id');

  select_clauses := array[]::text[];
  write_clauses := array[]::text[];

  if has_salon_id then
    select_clauses := array_append(select_clauses, $c$
      exists (
        select 1 from public.salons s
        join public.organization_members om on om.organization_id = s.organization_id
        where s.id = bookings.salon_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      )
    $c$);
    write_clauses := array_append(write_clauses, $c$
      exists (
        select 1 from public.salons s
        join public.organization_members om on om.organization_id = s.organization_id
        where s.id = bookings.salon_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    $c$);
  end if;

  if has_customer_id then
    select_clauses := array_append(select_clauses, '(customer_user_id is not null and customer_user_id = auth.uid())');
  end if;

  if has_owner_id then
    select_clauses := array_append(select_clauses, '(owner_id = auth.uid())');
    write_clauses := array_append(write_clauses, '(owner_id = auth.uid())');
  end if;

  if array_length(select_clauses, 1) > 0 then
    execute format('create policy bookings_tenant_select on public.bookings for select to authenticated using (%s)', array_to_string(select_clauses, ' or '));
  end if;
  if array_length(write_clauses, 1) > 0 then
    execute format('create policy bookings_owner_write on public.bookings for all to authenticated using (%s) with check (%s)', array_to_string(write_clauses, ' or '), array_to_string(write_clauses, ' or '));
  end if;

  execute 'grant select, insert, update, delete on table public.bookings to authenticated';
  execute 'revoke truncate, references, trigger on table public.bookings from authenticated';
end if;

-- 8d. booking_items
if to_regclass('public.booking_items') is not null then
  execute 'alter table public.booking_items enable row level security';

  execute 'drop policy if exists booking_items_tenant_select on public.booking_items';
  execute $p$
    create policy booking_items_tenant_select on public.booking_items for select to authenticated
    using (
      exists (
        select 1 from public.bookings b
        join public.salons s on s.id = b.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where b.id = booking_items.booking_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      )
      or exists (
        select 1 from public.bookings b
        where b.id = booking_items.booking_id
          and b.customer_user_id = auth.uid()
      )
    )
  $p$;

  execute 'drop policy if exists booking_items_owner_write on public.booking_items';
  execute $p$
    create policy booking_items_owner_write on public.booking_items for all to authenticated
    using (
      exists (
        select 1 from public.bookings b
        join public.salons s on s.id = b.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where b.id = booking_items.booking_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    )
    with check (
      exists (
        select 1 from public.bookings b
        join public.salons s on s.id = b.salon_id
        join public.organization_members om on om.organization_id = s.organization_id
        where b.id = booking_items.booking_id
          and om.user_id = auth.uid()
          and om.status = 'active'
          and om.role = 'owner'
      )
    )
  $p$;

  execute 'grant select, insert, update, delete on table public.booking_items to authenticated';
  execute 'revoke truncate, references, trigger on table public.booking_items from authenticated';
end if;

-- 8e. reviews
if to_regclass('public.reviews') is not null then
  execute 'alter table public.reviews enable row level security';

  execute 'drop policy if exists reviews_select on public.reviews';
  execute $p$
    create policy reviews_select on public.reviews for select
    using (true)
  $p$;

  execute 'drop policy if exists reviews_customer_write on public.reviews';
  execute $p$
    create policy reviews_customer_write on public.reviews for insert to authenticated
    with check (
      exists (
        select 1 from public.bookings b
        where b.id = reviews.booking_id
          and b.customer_user_id = auth.uid()
      )
    )
  $p$;

  execute 'grant select, insert, update on table public.reviews to authenticated';
  execute 'grant select on table public.reviews to anon';
  execute 'revoke truncate, references, trigger on table public.reviews from authenticated, anon';
end if;

-- 8f. in_app_notifications
if to_regclass('public.in_app_notifications') is not null then
  execute 'alter table public.in_app_notifications enable row level security';
  execute 'drop policy if exists notifications_select on public.in_app_notifications';
  execute 'drop policy if exists notifications_owner_write on public.in_app_notifications';

  has_email := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'in_app_notifications' and column_name = 'user_email');
  has_owner_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'in_app_notifications' and column_name = 'owner_id');
  has_user_id := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'in_app_notifications' and column_name = 'user_id');

  select_clauses := array[]::text[];
  write_clauses := array[]::text[];

  if has_email then
    select_clauses := array_append(select_clauses, '(user_email = auth.jwt() ->> ''email'')');
  end if;
  if has_owner_id then
    select_clauses := array_append(select_clauses, '(owner_id = auth.uid())');
    write_clauses := array_append(write_clauses, '(owner_id = auth.uid())');
  end if;
  if has_user_id then
    select_clauses := array_append(select_clauses, '(user_id = auth.uid())');
    write_clauses := array_append(write_clauses, '(user_id = auth.uid())');
  end if;

  if array_length(select_clauses, 1) > 0 then
    execute format('create policy notifications_select on public.in_app_notifications for select to authenticated using (%s)', array_to_string(select_clauses, ' or '));
  end if;
  if array_length(write_clauses, 1) > 0 then
    execute format('create policy notifications_owner_write on public.in_app_notifications for all to authenticated using (%s) with check (%s)', array_to_string(write_clauses, ' or '), array_to_string(write_clauses, ' or '));
  end if;

  execute 'grant select, insert, update, delete on table public.in_app_notifications to authenticated';
  execute 'revoke truncate, references, trigger on table public.in_app_notifications from authenticated';
end if;

end $$;

-- ---------------------------------------------------------------------------
-- 9. Drop insecure / overly permissive wildcard policies on private tables
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'salon_profiles', 'website_profiles',
        'salons', 'organizations', 'organization_members',
        'salon_customers', 'owner_editor_state', 'bookings', 'booking_items'
      )
      and policyname in (
        'allow_all', 'permissive_all', 'public_all', 'temp_allow_all',
        'enable_all_access_for_authenticated', 'enable_all_for_anon',
        'allow_anon_all', 'allow_authenticated_all'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Sequences & Schema privileges & Table Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
begin
  if to_regclass('public.organizations') is not null then
    grant select, insert, update, delete on table public.organizations to authenticated;
    revoke truncate, references, trigger on table public.organizations from authenticated;
  end if;

  if to_regclass('public.organization_members') is not null then
    grant select, insert, update, delete on table public.organization_members to authenticated;
    revoke truncate, references, trigger on table public.organization_members from authenticated;
  end if;

  if to_regclass('public.profiles') is not null then
    grant select, insert, update, delete on table public.profiles to authenticated;
    grant select on table public.profiles to anon;
    revoke truncate, references, trigger on table public.profiles from authenticated, anon;
  end if;

  if to_regclass('public.salons') is not null then
    grant select, insert, update, delete on table public.salons to authenticated;
    grant select on table public.salons to anon;
    revoke truncate, references, trigger on table public.salons from authenticated, anon;
  end if;

  if to_regclass('public.staff') is not null then
    grant select, insert, update, delete on table public.staff to authenticated;
    grant select on table public.staff to anon;
    revoke truncate, references, trigger on table public.staff from authenticated, anon;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
