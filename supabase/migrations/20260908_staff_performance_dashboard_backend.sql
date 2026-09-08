-- ==============================================================================
-- Nexora Salon OS — Owner-only Staff Performance Dashboard backend
-- Migration: 20260908_staff_performance_dashboard_backend.sql
-- ------------------------------------------------------------------------------
-- ONE idempotent file. Safe to paste into the Supabase SQL Editor and to re-run.
-- Never references a live column until information_schema / pg_catalog proves it.
-- Does not drop, rename, or rewrite booking / payment / review / auth / tenant
-- tables. New objects are additive.
--
-- EXISTING SCHEMA MAP (verified against repo migrations + application code;
-- the DO-blocks below re-check the LIVE database before interpolating names)
-- ------------------------------------------------------------------------------
--   Spec name                 Actual storage in this project
--   ------------------------  --------------------------------------------------
--   salons                    public.profiles (id = auth.users.id = salon owner).
--                             No `salons` table. salon_id := profiles.id.
--                             (salon_youtube_videos already uses salon_id → profiles.id)
--   organizations             DOES NOT EXIST
--   organization_members      DOES NOT EXIST
--   team_members / staff      public.stylists (id, owner_id, name, role,
--                             avatar_url, commission_rate, status, access_role)
--   bookings / appointments   public.bookings is canonical (owner_id, booking_date,
--                             status, payment_status, payment_id, total_amount,
--                             advance_paid_amount, metadata jsonb).
--                             public.appointments is a parallel owner-logged view
--                             (stylist_id, date) — used only if bookings is absent.
--   booking_items             NO table. Line items live in bookings.metadata.services[]
--   services                  public.services (id, owner_id, name, price)
--   payments                  NO table. Collected money is bookings.payment_status
--                             + advance_paid_amount + payment_id.
--                             Allowed payment_status: pending, paid_deposit,
--                             paid_full, pay_at_salon, refunded, failed.
--   reviews                   NO table. bookings.metadata.review_rating /
--                             review_text / reviewed_at
--   refunds                   NO table. payment_status = 'refunded'
--   commission                stylists.commission_rate numeric(5,2) percent.
--                             Copied into staff_commission_settings on first run.
--   owner helper              No existing is_*_owner() function. Owner identity
--                             is auth.uid() = profiles.id = tenant owner_id.
--   timezone                  No salon timezone column. booking_date is a `date`
--                             (entered in salon-local civil date). Window math
--                             uses that date as-is. When only timestamptz exists,
--                             conversion uses UTC (documented below).
--
-- BUSINESS RULES
--   net = greatest(gross - discount, 0)
--   percentage commission is taken from NET (after discount), never from gross
--   (this project has no documented “commission on gross” rule).
--   fixed commission is min(fixed_amount, net) so salon_amount cannot go negative.
--   disabled / missing / type=none settings → commission 0
--   cancelled bookings are counted but NEVER as completed revenue
--   failed / pending / refunded payments are NEVER collected paid_amount
--   duplicate payments collapse on payment_id (or payments.gateway id when present)
--   bookings without a staff uuid are skipped for per-staff rows (not crashed)
--   former staff (bookings whose staff_id is gone from stylists) still appear
-- ==============================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ==============================================================================
-- 0. Introspection helpers (never interpolate untrusted identifiers)
-- ==============================================================================
create or replace function public.staff_dashboard_is_ident(p text)
returns boolean
language sql
immutable
as $$
  select p is not null and p ~ '^[a-z_][a-z0-9_]*$';
$$;

create or replace function public.staff_dashboard_has_rel(p_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select to_regclass(format('public.%I', p_name)) is not null
    and public.staff_dashboard_is_ident(p_name);
$$;

create or replace function public.staff_dashboard_has_col(p_table text, p_col text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = p_table
      and a.attname = p_col
      and a.attnum > 0
      and not a.attisdropped
      and public.staff_dashboard_is_ident(p_table)
      and public.staff_dashboard_is_ident(p_col)
  );
$$;

create or replace function public.staff_dashboard_try_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return btrim(p)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.staff_dashboard_try_numeric(p text)
returns numeric
language plpgsql
immutable
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return btrim(p)::numeric;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.staff_dashboard_money(p numeric)
returns numeric
language sql
immutable
as $$
  select round(coalesce(p, 0)::numeric, 2);
$$;

create or replace function public.staff_dashboard_is_trusted_server()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  begin
    jwt_role := coalesce(auth.role(), '');
  exception
    when others then
      jwt_role := '';
  end;
  if jwt_role = 'service_role' then
    return true;
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return true;
  end if;
  begin
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
      return true;
    end if;
  exception
    when others then
      null;
  end;
  return false;
end;
$$;

-- ==============================================================================
-- 1. OWNER SECURITY
--    is_staff_dashboard_owner(target_salon_id)
--    Reads auth.uid() only. Never trusts a client-supplied owner flag.
--    Supports: profiles (canonical), optional salons, optional
--    organization_members. A column is read only when it exists.
-- ==============================================================================
create or replace function public.is_staff_dashboard_owner(target_salon_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid;
  ok boolean := false;
  sql text;
begin
  begin
    uid := auth.uid();
  exception
    when others then
      uid := null;
  end;
  if uid is null or target_salon_id is null then
    return false;
  end if;

  -- A. Canonical Nexora tenant: the salon IS the owner profile row.
  if public.staff_dashboard_has_rel('profiles')
     and public.staff_dashboard_has_col('profiles', 'id') then
    execute 'select exists (select 1 from public.profiles p where p.id = $1 and p.id = $2)'
      into ok using target_salon_id, uid;
    if ok then
      return true;
    end if;
  end if;

  -- B. Optional `salons` table (not present in this repo; live projects may have it).
  if public.staff_dashboard_has_rel('salons')
     and public.staff_dashboard_has_col('salons', 'id') then
    if public.staff_dashboard_has_col('salons', 'owner_id') then
      execute 'select exists (select 1 from public.salons s where s.id = $1 and s.owner_id = $2)'
        into ok using target_salon_id, uid;
      if ok then return true; end if;
    end if;
    if public.staff_dashboard_has_col('salons', 'owner_user_id') then
      execute 'select exists (select 1 from public.salons s where s.id = $1 and s.owner_user_id = $2)'
        into ok using target_salon_id, uid;
      if ok then return true; end if;
    end if;
    if public.staff_dashboard_has_col('salons', 'user_id') then
      execute 'select exists (select 1 from public.salons s where s.id = $1 and s.user_id = $2)'
        into ok using target_salon_id, uid;
      if ok then return true; end if;
    end if;
    if public.staff_dashboard_has_col('salons', 'created_by') then
      execute 'select exists (select 1 from public.salons s where s.id = $1 and s.created_by = $2)'
        into ok using target_salon_id, uid;
      if ok then return true; end if;
    end if;
  end if;

  -- C. Optional organization_members. Role names that mean owner; is_active
  --    is consulted ONLY when the column exists.
  if public.staff_dashboard_has_rel('organization_members') then
    if public.staff_dashboard_has_col('organization_members', 'user_id')
       and public.staff_dashboard_has_col('organization_members', 'salon_id') then
      sql := 'select exists (select 1 from public.organization_members m where m.salon_id = $1 and m.user_id = $2';
      if public.staff_dashboard_has_col('organization_members', 'role') then
        sql := sql || ' and lower(coalesce(m.role, '''')) in (''owner'',''salon_owner'',''admin'',''super_admin'')';
      end if;
      if public.staff_dashboard_has_col('organization_members', 'is_active') then
        sql := sql || ' and m.is_active is true';
      end if;
      sql := sql || ')';
      execute sql into ok using target_salon_id, uid;
      if ok then return true; end if;
    elsif public.staff_dashboard_has_col('organization_members', 'user_id')
          and public.staff_dashboard_has_col('organization_members', 'organization_id') then
      -- Join through salons.organization_id or organizations.id = salon id.
      if public.staff_dashboard_has_rel('salons')
         and public.staff_dashboard_has_col('salons', 'organization_id') then
        sql := 'select exists (
                  select 1
                  from public.organization_members m
                  join public.salons s on s.organization_id = m.organization_id
                  where s.id = $1 and m.user_id = $2';
        if public.staff_dashboard_has_col('organization_members', 'role') then
          sql := sql || ' and lower(coalesce(m.role, '''')) in (''owner'',''salon_owner'',''admin'',''super_admin'')';
        end if;
        if public.staff_dashboard_has_col('organization_members', 'is_active') then
          sql := sql || ' and m.is_active is true';
        end if;
        sql := sql || ')';
        execute sql into ok using target_salon_id, uid;
        if ok then return true; end if;
      end if;
      -- organization id coinciding with salon id
      sql := 'select exists (select 1 from public.organization_members m where m.organization_id = $1 and m.user_id = $2';
      if public.staff_dashboard_has_col('organization_members', 'role') then
        sql := sql || ' and lower(coalesce(m.role, '''')) in (''owner'',''salon_owner'',''admin'',''super_admin'')';
      end if;
      if public.staff_dashboard_has_col('organization_members', 'is_active') then
        sql := sql || ' and m.is_active is true';
      end if;
      sql := sql || ')';
      execute sql into ok using target_salon_id, uid;
      if ok then return true; end if;
    end if;
  end if;

  return false;
end;
$$;

comment on function public.is_staff_dashboard_owner(uuid) is
  'True iff auth.uid() owns target_salon_id. Canonical path: profiles.id = auth.uid() = salon id. Also supports optional salons.owner_id and organization_members (role in owner/admin; is_active only if that column exists). Unauthenticated → false. Never trusts a client-supplied salon_id without this check.';

create or replace function public.staff_dashboard_assert_owner(target_salon_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff_dashboard_owner(target_salon_id) then
    raise exception 'Staff performance dashboard is owner-only'
      using errcode = '42501';
  end if;
end;
$$;

-- ==============================================================================
-- 2. REQUIRED TABLES (created only when missing)
--    salon_id is uuid (matches profiles.id / auth.users.id). Foreign keys are
--    added only when the referenced relation+type exist — never invented.
--    staff_id has NO ON DELETE CASCADE so historical staff keep daily/audit rows.
-- ==============================================================================
create table if not exists public.staff_commission_settings (
  id               uuid primary key default gen_random_uuid(),
  salon_id         uuid not null,
  staff_id         uuid not null,
  commission_type  text not null default 'percentage',
  commission_rate  numeric not null default 0,
  fixed_amount     numeric not null default 0,
  is_enabled       boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_commission_settings_type_chk'
      and conrelid = 'public.staff_commission_settings'::regclass
  ) then
    alter table public.staff_commission_settings
      add constraint staff_commission_settings_type_chk
      check (commission_type in ('percentage', 'fixed', 'none'));
  end if;
end;
$$;

create unique index if not exists uq_staff_commission_settings_salon_staff
  on public.staff_commission_settings (salon_id, staff_id);
create index if not exists idx_staff_commission_settings_salon
  on public.staff_commission_settings (salon_id);
create index if not exists idx_staff_commission_settings_staff
  on public.staff_commission_settings (staff_id);

create table if not exists public.staff_performance_daily (
  id                   uuid primary key default gen_random_uuid(),
  salon_id             uuid not null,
  staff_id             uuid not null,
  performance_date     date not null,
  total_bookings       integer not null default 0,
  completed_bookings   integer not null default 0,
  cancelled_bookings   integer not null default 0,
  gross_amount         numeric not null default 0,
  discount_amount      numeric not null default 0,
  net_amount           numeric not null default 0,
  paid_amount          numeric not null default 0,
  commission_amount    numeric not null default 0,
  salon_amount         numeric not null default 0,
  review_count         integer not null default 0,
  average_rating       numeric not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists uq_staff_performance_daily_salon_staff_date
  on public.staff_performance_daily (salon_id, staff_id, performance_date);
create index if not exists idx_staff_performance_daily_salon
  on public.staff_performance_daily (salon_id);
create index if not exists idx_staff_performance_daily_staff
  on public.staff_performance_daily (staff_id);
create index if not exists idx_staff_performance_daily_date
  on public.staff_performance_daily (performance_date);
create index if not exists idx_staff_performance_daily_created
  on public.staff_performance_daily (created_at);

create table if not exists public.staff_performance_audit (
  id                 uuid primary key default gen_random_uuid(),
  salon_id           uuid not null,
  staff_id           uuid,
  booking_id         uuid,
  event_type         text not null,
  gross_amount       numeric not null default 0,
  discount_amount    numeric not null default 0,
  net_amount         numeric not null default 0,
  commission_amount  numeric not null default 0,
  salon_amount       numeric not null default 0,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists idx_staff_performance_audit_salon
  on public.staff_performance_audit (salon_id);
create index if not exists idx_staff_performance_audit_staff
  on public.staff_performance_audit (staff_id);
create index if not exists idx_staff_performance_audit_booking
  on public.staff_performance_audit (booking_id);
create index if not exists idx_staff_performance_audit_created
  on public.staff_performance_audit (created_at);

-- Safe FKs: only when the live referenced column is uuid.
do $$
declare
  salon_target text := null;
  booking_target text := null;
begin
  if public.staff_dashboard_has_rel('profiles')
     and public.staff_dashboard_has_col('profiles', 'id') then
    salon_target := 'public.profiles(id)';
  elsif public.staff_dashboard_has_rel('salons')
        and public.staff_dashboard_has_col('salons', 'id') then
    salon_target := 'public.salons(id)';
  end if;

  if salon_target is not null then
    if not exists (
      select 1 from pg_constraint
      where conname = 'staff_commission_settings_salon_fk'
    ) then
      execute format(
        'alter table public.staff_commission_settings
           add constraint staff_commission_settings_salon_fk
           foreign key (salon_id) references %s on delete cascade',
        salon_target
      );
    end if;
    if not exists (
      select 1 from pg_constraint
      where conname = 'staff_performance_daily_salon_fk'
    ) then
      execute format(
        'alter table public.staff_performance_daily
           add constraint staff_performance_daily_salon_fk
           foreign key (salon_id) references %s on delete cascade',
        salon_target
      );
    end if;
    if not exists (
      select 1 from pg_constraint
      where conname = 'staff_performance_audit_salon_fk'
    ) then
      execute format(
        'alter table public.staff_performance_audit
           add constraint staff_performance_audit_salon_fk
           foreign key (salon_id) references %s on delete cascade',
        salon_target
      );
    end if;
  end if;

  -- booking_id on audit: SET NULL so deleting a booking does not wipe the trail,
  -- and only when public.bookings.id exists.
  if public.staff_dashboard_has_rel('bookings')
     and public.staff_dashboard_has_col('bookings', 'id') then
    booking_target := 'public.bookings(id)';
  elsif public.staff_dashboard_has_rel('appointments')
        and public.staff_dashboard_has_col('appointments', 'id') then
    booking_target := 'public.appointments(id)';
  end if;
  if booking_target is not null
     and not exists (
       select 1 from pg_constraint where conname = 'staff_performance_audit_booking_fk'
     ) then
    execute format(
      'alter table public.staff_performance_audit
         add constraint staff_performance_audit_booking_fk
         foreign key (booking_id) references %s on delete set null',
      booking_target
    );
  end if;
end;
$$;

-- updated_at triggers (idempotent)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_staff_commission_settings_updated_at') then
    create trigger trg_staff_commission_settings_updated_at
      before update on public.staff_commission_settings
      for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_staff_performance_daily_updated_at') then
    create trigger trg_staff_performance_daily_updated_at
      before update on public.staff_performance_daily
      for each row execute procedure public.set_updated_at();
  end if;
end;
$$;

comment on table public.staff_commission_settings is
  'Per-staff commission for a salon (salon_id = profiles.id). Unique (salon_id, staff_id).';
comment on table public.staff_performance_daily is
  'Idempotent daily rollup. Unique (salon_id, staff_id, performance_date).';
comment on table public.staff_performance_audit is
  'Append-only event trail for commission/performance writes.';

-- ==============================================================================
-- 3. RLS — owner can manage own salon rows; everyone else (incl. staff/customers
--    /anon) cannot read these tables directly. service_role bypasses RLS.
-- ==============================================================================
alter table public.staff_commission_settings enable row level security;
alter table public.staff_performance_daily enable row level security;
alter table public.staff_performance_audit enable row level security;

drop policy if exists staff_commission_settings_owner_select on public.staff_commission_settings;
drop policy if exists staff_commission_settings_owner_insert on public.staff_commission_settings;
drop policy if exists staff_commission_settings_owner_update on public.staff_commission_settings;
drop policy if exists staff_commission_settings_owner_delete on public.staff_commission_settings;
create policy staff_commission_settings_owner_select
  on public.staff_commission_settings for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy staff_commission_settings_owner_insert
  on public.staff_commission_settings for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_commission_settings_owner_update
  on public.staff_commission_settings for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_commission_settings_owner_delete
  on public.staff_commission_settings for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

drop policy if exists staff_performance_daily_owner_select on public.staff_performance_daily;
drop policy if exists staff_performance_daily_owner_insert on public.staff_performance_daily;
drop policy if exists staff_performance_daily_owner_update on public.staff_performance_daily;
drop policy if exists staff_performance_daily_owner_delete on public.staff_performance_daily;
create policy staff_performance_daily_owner_select
  on public.staff_performance_daily for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy staff_performance_daily_owner_insert
  on public.staff_performance_daily for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_performance_daily_owner_update
  on public.staff_performance_daily for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_performance_daily_owner_delete
  on public.staff_performance_daily for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

drop policy if exists staff_performance_audit_owner_select on public.staff_performance_audit;
drop policy if exists staff_performance_audit_owner_insert on public.staff_performance_audit;
drop policy if exists staff_performance_audit_owner_update on public.staff_performance_audit;
drop policy if exists staff_performance_audit_owner_delete on public.staff_performance_audit;
create policy staff_performance_audit_owner_select
  on public.staff_performance_audit for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy staff_performance_audit_owner_insert
  on public.staff_performance_audit for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_performance_audit_owner_update
  on public.staff_performance_audit for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_performance_audit_owner_delete
  on public.staff_performance_audit for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

grant select, insert, update, delete on table
  public.staff_commission_settings,
  public.staff_performance_daily,
  public.staff_performance_audit
to authenticated;

grant select, insert, update, delete on table
  public.staff_commission_settings,
  public.staff_performance_daily,
  public.staff_performance_audit
to service_role;

-- ==============================================================================
-- 4. COMMISSION CALCULATION
--    percentage → net * rate / 100 (net AFTER discount)
--    fixed      → min(fixed_amount, net)
--    none/disabled/missing → 0
--    values rounded to 2 dp; never negative
-- ==============================================================================
create or replace function public.calculate_staff_commission(
  target_salon_id uuid,
  target_staff_id uuid,
  target_gross_amount numeric,
  target_discount_amount numeric
)
returns table (
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  commission_type text,
  commission_rate numeric,
  commission_amount numeric,
  salon_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gross numeric := public.staff_dashboard_money(greatest(coalesce(target_gross_amount, 0), 0));
  v_disc  numeric := public.staff_dashboard_money(greatest(coalesce(target_discount_amount, 0), 0));
  v_net   numeric;
  v_type  text := 'none';
  v_rate  numeric := 0;
  v_fixed numeric := 0;
  v_enabled boolean := false;
  v_comm  numeric := 0;
  v_salon numeric := 0;
begin
  v_net := public.staff_dashboard_money(greatest(v_gross - v_disc, 0));

  select
    s.commission_type,
    coalesce(s.commission_rate, 0),
    coalesce(s.fixed_amount, 0),
    coalesce(s.is_enabled, false)
  into v_type, v_rate, v_fixed, v_enabled
  from public.staff_commission_settings s
  where s.salon_id = target_salon_id
    and s.staff_id = target_staff_id
  limit 1;

  if not found or v_enabled is not true or coalesce(v_type, 'none') = 'none' then
    v_type := coalesce(nullif(v_type, ''), 'none');
    if not found then
      v_type := 'none';
    end if;
    v_comm := 0;
  elsif v_type = 'percentage' then
    v_comm := public.staff_dashboard_money(greatest(v_net * greatest(v_rate, 0) / 100.0, 0));
    if v_comm > v_net then
      v_comm := v_net;
    end if;
  elsif v_type = 'fixed' then
    v_comm := public.staff_dashboard_money(greatest(least(greatest(v_fixed, 0), v_net), 0));
  else
    v_type := 'none';
    v_comm := 0;
  end if;

  v_salon := public.staff_dashboard_money(greatest(v_net - v_comm, 0));

  gross_amount := v_gross;
  discount_amount := v_disc;
  net_amount := v_net;
  commission_type := v_type;
  commission_rate := public.staff_dashboard_money(v_rate);
  commission_amount := v_comm;
  salon_amount := v_salon;
  return next;
end;
$$;

comment on function public.calculate_staff_commission(uuid, uuid, numeric, numeric) is
  'Commission from staff_commission_settings. percentage uses NET after discount. Missing/disabled/none → 0. Never negative. Rounded to 2 dp.';

-- Backfill settings from stylists.commission_rate when that column exists.
-- Re-runs are no-ops (unique salon_id + staff_id).
do $$
declare
  staff_rel text := null;
  salon_col text := null;
  rate_col text := null;
begin
  if public.staff_dashboard_has_rel('stylists') then
    staff_rel := 'stylists';
  elsif public.staff_dashboard_has_rel('team_members') then
    staff_rel := 'team_members';
  elsif public.staff_dashboard_has_rel('staff') then
    staff_rel := 'staff';
  end if;
  if staff_rel is null then
    return;
  end if;
  if public.staff_dashboard_has_col(staff_rel, 'owner_id') then
    salon_col := 'owner_id';
  elsif public.staff_dashboard_has_col(staff_rel, 'salon_id') then
    salon_col := 'salon_id';
  else
    return;
  end if;
  if public.staff_dashboard_has_col(staff_rel, 'commission_rate') then
    rate_col := 'commission_rate';
  elsif public.staff_dashboard_has_col(staff_rel, 'commission_percent') then
    rate_col := 'commission_percent';
  end if;
  if rate_col is null then
    return;
  end if;
  execute format(
    'insert into public.staff_commission_settings
       (salon_id, staff_id, commission_type, commission_rate, fixed_amount, is_enabled)
     select st.%I, st.id,
            case when coalesce(st.%I, 0) > 0 then ''percentage'' else ''none'' end,
            coalesce(st.%I, 0),
            0,
            coalesce(st.%I, 0) > 0
     from public.%I st
     on conflict (salon_id, staff_id) do nothing',
    salon_col, rate_col, rate_col, rate_col, staff_rel
  );
end;
$$;

-- ==============================================================================
-- 5. BOOKING FACTS — generated from the LIVE schema so a missing column never
--    appears in the function body.
-- ==============================================================================
create or replace function public.staff_dashboard_rebuild_booking_facts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  src text;
  salon_expr text;
  date_expr text;
  status_expr text;
  pay_status_expr text;
  pay_key_expr text;
  gross_expr text;
  disc_expr text;
  advance_expr text;
  staff_expr text;
  svc_id_expr text;
  svc_name_expr text;
  cust_expr text;
  time_expr text;
  meta_expr text;
  deleted_pred text := 'true';
  body text;
  tz_note text := 'UTC (no salon timezone column; booking_date is civil date as stored)';
begin
  if public.staff_dashboard_has_rel('bookings') then
    src := 'bookings';
  elsif public.staff_dashboard_has_rel('appointments') then
    src := 'appointments';
  else
    execute $empty$
      create or replace function public.staff_dashboard_booking_facts(
        p_salon_id uuid, p_from date default null, p_to date default null
      )
      returns table (
        booking_id uuid,
        salon_id uuid,
        staff_id uuid,
        performance_date date,
        status text,
        payment_status text,
        payment_key text,
        gross_amount numeric,
        discount_amount numeric,
        net_amount numeric,
        paid_amount numeric,
        is_completed boolean,
        is_cancelled boolean,
        is_pending boolean,
        is_confirmed boolean,
        is_paid boolean,
        review_rating numeric,
        service_id text,
        service_name text,
        customer_name text,
        time_slot text
      )
      language sql
      stable
      security definer
      set search_path = public
      as $fn$
        select
          null::uuid, null::uuid, null::uuid, null::date,
          null::text, null::text, null::text,
          0::numeric, 0::numeric, 0::numeric, 0::numeric,
          false, false, false, false, false,
          null::numeric, null::text, null::text, null::text, null::text
        where false
      $fn$;
    $empty$;
    return;
  end if;

  -- salon scope
  if public.staff_dashboard_has_col(src, 'owner_id') then
    salon_expr := 'b.owner_id';
  elsif public.staff_dashboard_has_col(src, 'salon_id') then
    salon_expr := 'b.salon_id';
  else
    salon_expr := 'null::uuid';
  end if;

  -- performance date
  if public.staff_dashboard_has_col(src, 'booking_date') then
    date_expr := 'b.booking_date';
  elsif public.staff_dashboard_has_col(src, 'date') then
    date_expr := 'b.date';
  elsif public.staff_dashboard_has_col(src, 'appointment_date') then
    date_expr := 'b.appointment_date';
  elsif public.staff_dashboard_has_col(src, 'created_at') then
    date_expr := '(b.created_at at time zone ''utc'')::date';
    tz_note := 'UTC (created_at timestamptz; no salon timezone column on profiles/salons)';
  else
    date_expr := 'current_date';
  end if;

  status_expr := case when public.staff_dashboard_has_col(src, 'status')
                      then 'lower(coalesce(b.status, ''''))' else '''''::text' end;
  pay_status_expr := case when public.staff_dashboard_has_col(src, 'payment_status')
                          then 'lower(coalesce(b.payment_status, ''''))' else '''''::text' end;

  if public.staff_dashboard_has_col(src, 'payment_id') then
    pay_key_expr := 'coalesce(nullif(b.payment_id, ''''), b.id::text)';
  else
    pay_key_expr := 'b.id::text';
  end if;

  if public.staff_dashboard_has_col(src, 'total_amount') then
    gross_expr := 'coalesce(b.total_amount, 0)';
  elsif public.staff_dashboard_has_col(src, 'service_price') then
    gross_expr := 'coalesce(b.service_price, 0)';
  elsif public.staff_dashboard_has_col(src, 'amount') then
    gross_expr := 'coalesce(b.amount, 0)';
  else
    gross_expr := '0';
  end if;

  meta_expr := case when public.staff_dashboard_has_col(src, 'metadata')
                    then 'coalesce(b.metadata, ''{}''::jsonb)' else '''{}''::jsonb' end;

  if public.staff_dashboard_has_col(src, 'discount_amount') then
    disc_expr := format('coalesce(b.discount_amount, public.staff_dashboard_try_numeric((%s) ->> ''discount_amount''), 0)', meta_expr);
  else
    disc_expr := format(
      'coalesce(public.staff_dashboard_try_numeric((%s) ->> ''discount_amount''), public.staff_dashboard_try_numeric((%s) ->> ''discount''), 0)',
      meta_expr, meta_expr
    );
  end if;

  if public.staff_dashboard_has_col(src, 'advance_paid_amount') then
    advance_expr := 'coalesce(b.advance_paid_amount, 0)';
  elsif public.staff_dashboard_has_col(src, 'amount_paid') then
    advance_expr := 'coalesce(b.amount_paid, 0)';
  else
    advance_expr := '0';
  end if;

  -- staff id: real column first, then metadata.staff_id / stylist_id / services[0]
  staff_expr := 'null::uuid';
  if public.staff_dashboard_has_col(src, 'staff_id') then
    staff_expr := 'b.staff_id';
  elsif public.staff_dashboard_has_col(src, 'stylist_id') then
    staff_expr := 'b.stylist_id';
  end if;
  if public.staff_dashboard_has_col(src, 'metadata') then
    staff_expr := format(
      'coalesce(%s, public.staff_dashboard_try_uuid((%s) ->> ''staff_id''), public.staff_dashboard_try_uuid((%s) ->> ''stylist_id''), public.staff_dashboard_try_uuid((%s) -> ''services'' -> 0 ->> ''staff_id''))',
      staff_expr, meta_expr, meta_expr, meta_expr
    );
  end if;

  svc_id_expr := case when public.staff_dashboard_has_col(src, 'service_id')
                      then 'b.service_id::text' else 'null::text' end;
  svc_name_expr := case when public.staff_dashboard_has_col(src, 'service_name')
                        then 'b.service_name' else 'null::text' end;
  if public.staff_dashboard_has_col(src, 'customer_name') then
    cust_expr := 'b.customer_name';
  elsif public.staff_dashboard_has_col(src, 'client_name') then
    cust_expr := 'b.client_name';
  else
    cust_expr := 'null::text';
  end if;
  if public.staff_dashboard_has_col(src, 'time_slot') then
    time_expr := 'b.time_slot';
  elsif public.staff_dashboard_has_col(src, 'time') then
    time_expr := 'b.time';
  else
    time_expr := 'null::text';
  end if;

  if public.staff_dashboard_has_col(src, 'deleted_at') then
    deleted_pred := 'b.deleted_at is null';
  elsif public.staff_dashboard_has_col(src, 'is_deleted') then
    deleted_pred := 'coalesce(b.is_deleted, false) = false';
  end if;

  body := format($f$
    create or replace function public.staff_dashboard_booking_facts(
      p_salon_id uuid,
      p_from date default null,
      p_to date default null
    )
    returns table (
      booking_id uuid,
      salon_id uuid,
      staff_id uuid,
      performance_date date,
      status text,
      payment_status text,
      payment_key text,
      gross_amount numeric,
      discount_amount numeric,
      net_amount numeric,
      paid_amount numeric,
      is_completed boolean,
      is_cancelled boolean,
      is_pending boolean,
      is_confirmed boolean,
      is_paid boolean,
      review_rating numeric,
      service_id text,
      service_name text,
      customer_name text,
      time_slot text
    )
    language sql
    stable
    security definer
    set search_path = public
    as $fn$
      select
        b.id as booking_id,
        %1$s as salon_id,
        %2$s as staff_id,
        %3$s as performance_date,
        %4$s as status,
        %5$s as payment_status,
        %6$s as payment_key,
        public.staff_dashboard_money(%7$s) as gross_amount,
        public.staff_dashboard_money(greatest(%8$s, 0)) as discount_amount,
        public.staff_dashboard_money(greatest(public.staff_dashboard_money(%7$s) - public.staff_dashboard_money(greatest(%8$s, 0)), 0)) as net_amount,
        public.staff_dashboard_money(
          case
            when %5$s in ('failed', 'pending', 'refunded', 'cancelled') then 0
            when %5$s in ('paid_full', 'paid', 'captured', 'success') then %7$s
            when %5$s = 'paid_deposit' then %9$s
            when %5$s = 'pay_at_salon' and %4$s in ('completed', 'complete', 'done') then %7$s
            else 0
          end
        ) as paid_amount,
        (%4$s in ('completed', 'complete', 'done')) as is_completed,
        (%4$s in ('cancelled', 'canceled')) as is_cancelled,
        (%4$s in ('pending', 'requested')) as is_pending,
        (%4$s in ('confirmed', 'accepted', 'in_progress', 'reschedule_proposed', 'reschedule_requested')) as is_confirmed,
        (%5$s in ('paid_full', 'paid', 'captured', 'success', 'paid_deposit')
          or (%5$s = 'pay_at_salon' and %4$s in ('completed', 'complete', 'done'))) as is_paid,
        public.staff_dashboard_try_numeric((%10$s) ->> 'review_rating') as review_rating,
        %11$s as service_id,
        %12$s as service_name,
        %13$s as customer_name,
        %14$s as time_slot
      from public.%15$I b
      where %1$s = p_salon_id
        and %16$s
        and (p_from is null or %3$s >= p_from)
        and (p_to is null or %3$s <= p_to)
    $fn$;
  $f$,
    salon_expr,        -- 1
    staff_expr,        -- 2
    date_expr,         -- 3
    status_expr,       -- 4
    pay_status_expr,   -- 5
    pay_key_expr,      -- 6
    gross_expr,        -- 7
    disc_expr,         -- 8
    advance_expr,      -- 9
    meta_expr,         -- 10
    svc_id_expr,       -- 11
    svc_name_expr,     -- 12
    cust_expr,         -- 13
    time_expr,         -- 14
    src,               -- 15
    deleted_pred       -- 16
  );

  execute body;

  execute format(
    'comment on function public.staff_dashboard_booking_facts(uuid, date, date) is %L',
    'Normalised booking facts for the staff dashboard. Source table: public.'
      || src || '. Timezone: ' || tz_note
      || '. Cancelled rows keep counts but is_completed=false. Failed/pending/refunded payments have paid_amount=0.'
  );
end;
$$;

select public.staff_dashboard_rebuild_booking_facts();

-- Overlay paid_amount from a real payments table when one exists (deduped).
create or replace function public.staff_dashboard_paid_from_payments(p_salon_id uuid)
returns table (booking_id uuid, paid_amount numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  sql text;
  amount_col text;
  status_col text;
  booking_col text;
  salon_pred text := 'true';
  key_expr text;
begin
  if not public.staff_dashboard_has_rel('payments') then
    return;
  end if;
  if public.staff_dashboard_has_col('payments', 'booking_id') then
    booking_col := 'booking_id';
  else
    return;
  end if;
  if public.staff_dashboard_has_col('payments', 'amount') then
    amount_col := 'amount';
  elsif public.staff_dashboard_has_col('payments', 'amount_paid') then
    amount_col := 'amount_paid';
  elsif public.staff_dashboard_has_col('payments', 'total') then
    amount_col := 'total';
  else
    return;
  end if;
  status_col := case when public.staff_dashboard_has_col('payments', 'status') then 'status'
                     when public.staff_dashboard_has_col('payments', 'payment_status') then 'payment_status'
                     else null end;
  if public.staff_dashboard_has_col('payments', 'salon_id') then
    salon_pred := 'p.salon_id = $1';
  elsif public.staff_dashboard_has_col('payments', 'owner_id') then
    salon_pred := 'p.owner_id = $1';
  end if;
  if public.staff_dashboard_has_col('payments', 'gateway_payment_id') then
    key_expr := 'coalesce(nullif(p.gateway_payment_id, ''''), p.id::text)';
  elsif public.staff_dashboard_has_col('payments', 'payment_id') then
    key_expr := 'coalesce(nullif(p.payment_id, ''''), p.id::text)';
  else
    key_expr := 'p.id::text';
  end if;

  sql := format(
    'select d.%I, public.staff_dashboard_money(sum(d.%I))
     from (
       select distinct on (p.%I, %s)
              p.%I, p.%I
       from public.payments p
       where %s
         %s
       order by p.%I, %s, p.id
     ) d
     group by 1',
    booking_col, amount_col,
    booking_col, key_expr,
    booking_col, amount_col,
    salon_pred,
    case when status_col is not null
         then format('and lower(coalesce(p.%I, '''')) not in (''failed'',''pending'',''refunded'',''cancelled'',''canceled'')', status_col)
         else '' end,
    booking_col, key_expr
  );
  return query execute sql using p_salon_id;
end;
$$;

-- Overlay review rating from a real reviews table when one exists.
create or replace function public.staff_dashboard_reviews_from_table(
  p_salon_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  staff_id uuid,
  booking_id uuid,
  review_date date,
  rating numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  sql text;
  staff_expr text := 'null::uuid';
  date_expr text;
  rating_expr text;
  salon_pred text;
begin
  if not public.staff_dashboard_has_rel('reviews') then
    return;
  end if;
  if public.staff_dashboard_has_col('reviews', 'rating') then
    rating_expr := 'r.rating';
  elsif public.staff_dashboard_has_col('reviews', 'stars') then
    rating_expr := 'r.stars';
  elsif public.staff_dashboard_has_col('reviews', 'score') then
    rating_expr := 'r.score';
  else
    return;
  end if;
  if public.staff_dashboard_has_col('reviews', 'salon_id') then
    salon_pred := 'r.salon_id = $1';
  elsif public.staff_dashboard_has_col('reviews', 'owner_id') then
    salon_pred := 'r.owner_id = $1';
  else
    return;
  end if;
  if public.staff_dashboard_has_col('reviews', 'staff_id') then
    staff_expr := 'r.staff_id';
  elsif public.staff_dashboard_has_col('reviews', 'stylist_id') then
    staff_expr := 'r.stylist_id';
  end if;
  if public.staff_dashboard_has_col('reviews', 'created_at') then
    date_expr := '(r.created_at at time zone ''utc'')::date';
  elsif public.staff_dashboard_has_col('reviews', 'reviewed_at') then
    date_expr := '(r.reviewed_at)::date';
  else
    date_expr := 'current_date';
  end if;
  sql := format(
    'select %s,
            %s,
            %s,
            %s::numeric
     from public.reviews r
     where %s
       and ($2 is null or %s >= $2)
       and ($3 is null or %s <= $3)
       %s',
    staff_expr,
    case when public.staff_dashboard_has_col('reviews', 'booking_id') then 'r.booking_id' else 'null::uuid' end,
    date_expr,
    rating_expr,
    salon_pred,
    date_expr,
    date_expr,
    case when public.staff_dashboard_has_col('reviews', 'deleted_at') then 'and r.deleted_at is null' else '' end
  );
  return query execute sql using p_salon_id, p_from, p_to;
end;
$$;

-- Staff dimension (current roster + names for historical ids).
create or replace function public.staff_dashboard_staff_dim(p_salon_id uuid)
returns table (
  staff_id uuid,
  staff_name text,
  staff_photo text,
  staff_role text,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  rel text;
  salon_col text;
  name_col text;
  photo_col text;
  role_col text;
  sql text;
begin
  if public.staff_dashboard_has_rel('stylists') then
    rel := 'stylists';
  elsif public.staff_dashboard_has_rel('team_members') then
    rel := 'team_members';
  elsif public.staff_dashboard_has_rel('staff') then
    rel := 'staff';
  elsif public.staff_dashboard_has_rel('salon_staff') then
    rel := 'salon_staff';
  else
    return;
  end if;
  if public.staff_dashboard_has_col(rel, 'owner_id') then
    salon_col := 'owner_id';
  elsif public.staff_dashboard_has_col(rel, 'salon_id') then
    salon_col := 'salon_id';
  else
    return;
  end if;
  name_col := case when public.staff_dashboard_has_col(rel, 'name') then 'name'
                   when public.staff_dashboard_has_col(rel, 'full_name') then 'full_name'
                   else null end;
  photo_col := case when public.staff_dashboard_has_col(rel, 'avatar_url') then 'avatar_url'
                    when public.staff_dashboard_has_col(rel, 'photo_url') then 'photo_url'
                    when public.staff_dashboard_has_col(rel, 'image_url') then 'image_url'
                    else null end;
  role_col := case when public.staff_dashboard_has_col(rel, 'role') then 'role'
                   when public.staff_dashboard_has_col(rel, 'access_role') then 'access_role'
                   when public.staff_dashboard_has_col(rel, 'job_title') then 'job_title'
                   else null end;
  sql := format(
    'select st.id,
            coalesce(%s, ''Staff'')::text,
            %s,
            coalesce(%s, '''')::text,
            true
     from public.%I st
     where st.%I = $1',
    case when name_col is not null then format('st.%I', name_col) else '''Staff''' end,
    case when photo_col is not null then format('st.%I', photo_col) else 'null::text' end,
    case when role_col is not null then format('st.%I', role_col) else '''''' end,
    rel,
    salon_col
  );
  return query execute sql using p_salon_id;
end;
$$;

-- ==============================================================================
-- 6. OWNER RPC — STAFF SUMMARY
-- ==============================================================================
create or replace function public.get_owner_staff_performance(
  target_salon_id uuid,
  from_date date default null,
  to_date date default null,
  target_staff_id uuid default null
)
returns table (
  staff_id uuid,
  staff_name text,
  staff_photo text,
  staff_role text,
  total_bookings integer,
  pending_bookings integer,
  confirmed_bookings integer,
  completed_bookings integer,
  cancelled_bookings integer,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  paid_amount numeric,
  commission_rate numeric,
  commission_amount numeric,
  salon_amount numeric,
  review_count integer,
  average_rating numeric,
  five_star_reviews integer,
  four_star_reviews integer,
  three_star_reviews integer,
  two_star_reviews integer,
  one_star_reviews integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);

  return query
  with roster as (
    select * from public.staff_dashboard_staff_dim(target_salon_id)
  ),
  facts as (
    select f.*
    from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
    where f.staff_id is not null
      and (target_staff_id is null or f.staff_id = target_staff_id)
  ),
  pay_override as (
    select * from public.staff_dashboard_paid_from_payments(target_salon_id)
  ),
  facts_paid as (
    select
      f.*,
      public.staff_dashboard_money(coalesce(po.paid_amount, f.paid_amount)) as paid_final
    from facts f
    left join pay_override po on po.booking_id = f.booking_id
  ),
  -- One payment_key per staff: collapse duplicate gateway captures.
  paid_dedup as (
    select distinct on (fp.staff_id, fp.payment_key)
      fp.staff_id, fp.payment_key, fp.paid_final
    from facts_paid fp
    where fp.is_paid
    order by fp.staff_id, fp.payment_key, fp.booking_id
  ),
  paid_agg as (
    select staff_id, public.staff_dashboard_money(sum(paid_final)) as paid_amount
    from paid_dedup
    group by staff_id
  ),
  table_reviews as (
    select * from public.staff_dashboard_reviews_from_table(target_salon_id, from_date, to_date)
  ),
  review_src as (
    select staff_id, rating
    from (
      select tr.staff_id, tr.rating
      from table_reviews tr
      where tr.staff_id is not null
        and tr.rating is not null
        and tr.rating >= 1
      union all
      select f.staff_id, f.review_rating
      from facts f
      where not exists (select 1 from table_reviews)
        and f.review_rating is not null
        and f.review_rating >= 1
        and f.review_rating <= 5
    ) u
  ),
  review_agg as (
    select
      staff_id,
      count(*)::int as review_count,
      round(avg(rating)::numeric, 2) as average_rating,
      count(*) filter (where round(rating) = 5)::int as five_star_reviews,
      count(*) filter (where round(rating) = 4)::int as four_star_reviews,
      count(*) filter (where round(rating) = 3)::int as three_star_reviews,
      count(*) filter (where round(rating) = 2)::int as two_star_reviews,
      count(*) filter (where round(rating) = 1)::int as one_star_reviews
    from review_src
    group by staff_id
  ),
  hist as (
    select distinct f.staff_id
    from facts f
    where f.staff_id is not null
      and not exists (select 1 from roster r where r.staff_id = f.staff_id)
  ),
  staff_set as (
    select
      r.staff_id,
      r.staff_name,
      r.staff_photo,
      r.staff_role
    from roster r
    where target_staff_id is null or r.staff_id = target_staff_id
    union all
    select
      h.staff_id,
      'Former staff'::text,
      null::text,
      'Former staff'::text
    from hist h
    where target_staff_id is null or h.staff_id = target_staff_id
  ),
  book_agg as (
    select
      f.staff_id,
      count(*)::int as total_bookings,
      count(*) filter (where f.is_pending)::int as pending_bookings,
      count(*) filter (where f.is_confirmed)::int as confirmed_bookings,
      count(*) filter (where f.is_completed)::int as completed_bookings,
      count(*) filter (where f.is_cancelled)::int as cancelled_bookings,
      public.staff_dashboard_money(sum(f.gross_amount) filter (where f.is_completed)) as gross_amount,
      public.staff_dashboard_money(sum(f.discount_amount) filter (where f.is_completed)) as discount_amount,
      public.staff_dashboard_money(sum(f.net_amount) filter (where f.is_completed)) as net_amount
    from facts f
    group by f.staff_id
  )
  select
    s.staff_id,
    s.staff_name,
    s.staff_photo,
    s.staff_role,
    coalesce(b.total_bookings, 0),
    coalesce(b.pending_bookings, 0),
    coalesce(b.confirmed_bookings, 0),
    coalesce(b.completed_bookings, 0),
    coalesce(b.cancelled_bookings, 0),
    coalesce(b.gross_amount, 0),
    coalesce(b.discount_amount, 0),
    coalesce(b.net_amount, 0),
    coalesce(p.paid_amount, 0),
    coalesce(cs.commission_rate, 0),
    coalesce((
      select c.commission_amount
      from public.calculate_staff_commission(
        target_salon_id, s.staff_id,
        coalesce(b.gross_amount, 0), coalesce(b.discount_amount, 0)
      ) c
    ), 0),
    coalesce((
      select c.salon_amount
      from public.calculate_staff_commission(
        target_salon_id, s.staff_id,
        coalesce(b.gross_amount, 0), coalesce(b.discount_amount, 0)
      ) c
    ), 0),
    coalesce(rv.review_count, 0),
    coalesce(rv.average_rating, 0),
    coalesce(rv.five_star_reviews, 0),
    coalesce(rv.four_star_reviews, 0),
    coalesce(rv.three_star_reviews, 0),
    coalesce(rv.two_star_reviews, 0),
    coalesce(rv.one_star_reviews, 0)
  from staff_set s
  left join book_agg b on b.staff_id = s.staff_id
  left join paid_agg p on p.staff_id = s.staff_id
  left join review_agg rv on rv.staff_id = s.staff_id
  left join public.staff_commission_settings cs
    on cs.salon_id = target_salon_id and cs.staff_id = s.staff_id
  order by s.staff_name, s.staff_id;
end;
$$;

-- ==============================================================================
-- 7. OWNER RPC — LAST 7 DAYS + RANKS
--    Date window: [today-6, today] on booking_date (civil date as stored).
--    Timezone: UTC documented — no salon timezone column exists.
--
--    OVERALL RANK FORMULA
--      overall_score = (1.0 / booking_rank) + (1.0 / payment_rank) + (1.0 / review_rank)
--      overall_rank  = dense_rank() OVER (ORDER BY overall_score DESC, staff_name ASC)
--    A rank of 1 is best. Inverse-rank averaging treats the three ladders equally
--    without depending on the size of the roster.
-- ==============================================================================
create or replace function public.get_owner_staff_last_7_days(target_salon_id uuid)
returns table (
  staff_id uuid,
  staff_name text,
  staff_photo text,
  booking_count_7d integer,
  completed_booking_count_7d integer,
  gross_amount_7d numeric,
  discount_amount_7d numeric,
  net_amount_7d numeric,
  paid_amount_7d numeric,
  commission_amount_7d numeric,
  salon_amount_7d numeric,
  review_count_7d integer,
  average_rating_7d numeric,
  booking_rank integer,
  payment_rank integer,
  review_rank integer,
  overall_rank integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  d_from date := (current_date - 6);
  d_to date := current_date;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);

  return query
  with base as (
    select
      s.staff_id,
      s.staff_name,
      s.staff_photo,
      s.total_bookings as booking_count_7d,
      s.completed_bookings as completed_booking_count_7d,
      s.gross_amount as gross_amount_7d,
      s.discount_amount as discount_amount_7d,
      s.net_amount as net_amount_7d,
      s.paid_amount as paid_amount_7d,
      s.commission_amount as commission_amount_7d,
      s.salon_amount as salon_amount_7d,
      s.review_count as review_count_7d,
      s.average_rating as average_rating_7d,
      s.five_star_reviews
    from public.get_owner_staff_performance(target_salon_id, d_from, d_to, null) s
  ),
  ranked as (
    select
      b.*,
      dense_rank() over (
        order by b.completed_booking_count_7d desc, b.booking_count_7d desc, b.staff_name asc
      )::int as booking_rank,
      dense_rank() over (
        order by b.paid_amount_7d desc, b.completed_booking_count_7d desc, b.staff_name asc
      )::int as payment_rank,
      dense_rank() over (
        order by b.review_count_7d desc, b.average_rating_7d desc, b.five_star_reviews desc, b.staff_name asc
      )::int as review_rank
    from base b
  )
  select
    r.staff_id,
    r.staff_name,
    r.staff_photo,
    r.booking_count_7d,
    r.completed_booking_count_7d,
    r.gross_amount_7d,
    r.discount_amount_7d,
    r.net_amount_7d,
    r.paid_amount_7d,
    r.commission_amount_7d,
    r.salon_amount_7d,
    r.review_count_7d,
    r.average_rating_7d,
    r.booking_rank,
    r.payment_rank,
    r.review_rank,
    dense_rank() over (
      order by (1.0 / r.booking_rank + 1.0 / r.payment_rank + 1.0 / r.review_rank) desc,
               r.staff_name asc
    )::int as overall_rank
  from ranked r
  order by overall_rank, r.staff_name;
end;
$$;

comment on function public.get_owner_staff_last_7_days(uuid) is
  'Last 7 civil days (today-6..today) using stored booking_date. Timezone: UTC / as-stored (no salon timezone column). overall_score = 1/booking_rank + 1/payment_rank + 1/review_rank; overall_rank = dense_rank of that score desc.';

-- ==============================================================================
-- 8. OWNER RPC — DAILY CHART DATA
-- ==============================================================================
create or replace function public.get_owner_staff_daily_performance(
  target_salon_id uuid,
  from_date date default null,
  to_date date default null,
  target_staff_id uuid default null
)
returns table (
  performance_date date,
  staff_id uuid,
  staff_name text,
  bookings integer,
  completed_bookings integer,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  paid_amount numeric,
  commission_amount numeric,
  salon_amount numeric,
  reviews integer,
  average_rating numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);

  return query
  with roster as (
    select * from public.staff_dashboard_staff_dim(target_salon_id)
  ),
  facts as (
    select f.*
    from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
    where f.staff_id is not null
      and (target_staff_id is null or f.staff_id = target_staff_id)
  ),
  pay_override as (
    select * from public.staff_dashboard_paid_from_payments(target_salon_id)
  ),
  facts_paid as (
    select f.*, public.staff_dashboard_money(coalesce(po.paid_amount, f.paid_amount)) as paid_final
    from facts f
    left join pay_override po on po.booking_id = f.booking_id
  ),
  paid_dedup as (
    select distinct on (fp.staff_id, fp.performance_date, fp.payment_key)
      fp.staff_id, fp.performance_date, fp.payment_key, fp.paid_final
    from facts_paid fp
    where fp.is_paid
    order by fp.staff_id, fp.performance_date, fp.payment_key, fp.booking_id
  ),
  paid_agg as (
    select staff_id, performance_date, public.staff_dashboard_money(sum(paid_final)) as paid_amount
    from paid_dedup
    group by 1, 2
  ),
  book_agg as (
    select
      f.performance_date,
      f.staff_id,
      count(*)::int as bookings,
      count(*) filter (where f.is_completed)::int as completed_bookings,
      public.staff_dashboard_money(sum(f.gross_amount) filter (where f.is_completed)) as gross_amount,
      public.staff_dashboard_money(sum(f.discount_amount) filter (where f.is_completed)) as discount_amount,
      public.staff_dashboard_money(sum(f.net_amount) filter (where f.is_completed)) as net_amount,
      count(*) filter (where f.review_rating is not null and f.review_rating >= 1)::int as reviews,
      coalesce(round(avg(f.review_rating) filter (where f.review_rating is not null and f.review_rating >= 1)::numeric, 2), 0) as average_rating
    from facts f
    group by 1, 2
  )
  select
    b.performance_date,
    b.staff_id,
    coalesce(r.staff_name, 'Former staff') as staff_name,
    b.bookings,
    b.completed_bookings,
    coalesce(b.gross_amount, 0),
    coalesce(b.discount_amount, 0),
    coalesce(b.net_amount, 0),
    coalesce(p.paid_amount, 0),
    coalesce((
      select c.commission_amount
      from public.calculate_staff_commission(target_salon_id, b.staff_id, coalesce(b.gross_amount, 0), coalesce(b.discount_amount, 0)) c
    ), 0),
    coalesce((
      select c.salon_amount
      from public.calculate_staff_commission(target_salon_id, b.staff_id, coalesce(b.gross_amount, 0), coalesce(b.discount_amount, 0)) c
    ), 0),
    b.reviews,
    b.average_rating
  from book_agg b
  left join roster r on r.staff_id = b.staff_id
  left join paid_agg p on p.staff_id = b.staff_id and p.performance_date = b.performance_date
  order by b.performance_date, coalesce(r.staff_name, 'Former staff');
end;
$$;

-- ==============================================================================
-- 9. OWNER RPC — STAFF DETAILS (jsonb payload)
-- ==============================================================================
create or replace function public.get_owner_staff_detail(
  target_salon_id uuid,
  target_staff_id uuid,
  from_date date default null,
  to_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  result jsonb;
  summary record;
  last7 jsonb;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  if target_staff_id is null then
    raise exception 'target_staff_id is required' using errcode = '22023';
  end if;

  select * into summary
  from public.get_owner_staff_performance(target_salon_id, from_date, to_date, target_staff_id)
  limit 1;

  if summary.staff_id is null then
    -- Still return a profile-shaped object when the staff id is unknown.
    summary.staff_id := target_staff_id;
    summary.staff_name := 'Unknown staff';
    summary.staff_photo := null;
    summary.staff_role := '';
    summary.total_bookings := 0;
    summary.pending_bookings := 0;
    summary.confirmed_bookings := 0;
    summary.completed_bookings := 0;
    summary.cancelled_bookings := 0;
    summary.gross_amount := 0;
    summary.discount_amount := 0;
    summary.net_amount := 0;
    summary.paid_amount := 0;
    summary.commission_rate := 0;
    summary.commission_amount := 0;
    summary.salon_amount := 0;
    summary.review_count := 0;
    summary.average_rating := 0;
    summary.five_star_reviews := 0;
    summary.four_star_reviews := 0;
    summary.three_star_reviews := 0;
    summary.two_star_reviews := 0;
    summary.one_star_reviews := 0;
  end if;

  select to_jsonb(l) into last7
  from public.get_owner_staff_last_7_days(target_salon_id) l
  where l.staff_id = target_staff_id;

  result := jsonb_build_object(
    'staff_profile', jsonb_build_object(
      'staff_id', summary.staff_id,
      'staff_name', summary.staff_name,
      'staff_photo', summary.staff_photo,
      'staff_role', summary.staff_role
    ),
    'booking_status_summary', jsonb_build_object(
      'total_bookings', summary.total_bookings,
      'pending_bookings', summary.pending_bookings,
      'confirmed_bookings', summary.confirmed_bookings,
      'completed_bookings', summary.completed_bookings,
      'cancelled_bookings', summary.cancelled_bookings
    ),
    'payment_summary', jsonb_build_object(
      'gross_amount', summary.gross_amount,
      'paid_amount', summary.paid_amount,
      'outstanding_amount', public.staff_dashboard_money(greatest(summary.net_amount - summary.paid_amount, 0))
    ),
    'discount_summary', jsonb_build_object(
      'discount_amount', summary.discount_amount,
      'net_amount', summary.net_amount
    ),
    'commission_calculation', jsonb_build_object(
      'commission_rate', summary.commission_rate,
      'commission_amount', summary.commission_amount
    ),
    'salon_share', jsonb_build_object(
      'salon_amount', summary.salon_amount
    ),
    'review_summary', jsonb_build_object(
      'review_count', summary.review_count,
      'average_rating', summary.average_rating
    ),
    'rating_distribution', jsonb_build_object(
      'five_star_reviews', summary.five_star_reviews,
      'four_star_reviews', summary.four_star_reviews,
      'three_star_reviews', summary.three_star_reviews,
      'two_star_reviews', summary.two_star_reviews,
      'one_star_reviews', summary.one_star_reviews
    ),
    'service_wise_booking_summary', coalesce((
      select jsonb_agg(x order by x->>'service_name')
      from (
        select jsonb_build_object(
          'service_id', coalesce(f.service_id, ''),
          'service_name', coalesce(nullif(f.service_name, ''), 'Unknown service'),
          'bookings', count(*)::int,
          'completed_bookings', count(*) filter (where f.is_completed)::int,
          'gross_amount', public.staff_dashboard_money(sum(f.gross_amount) filter (where f.is_completed))
        ) as x
        from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
        where f.staff_id = target_staff_id
        group by coalesce(f.service_id, ''), coalesce(nullif(f.service_name, ''), 'Unknown service')
      ) s
    ), '[]'::jsonb),
    'top_services', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'service_name', coalesce(nullif(f.service_name, ''), 'Unknown service'),
          'completed_bookings', count(*) filter (where f.is_completed)::int,
          'gross_amount', public.staff_dashboard_money(sum(f.gross_amount) filter (where f.is_completed))
        ) as x
        from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
        where f.staff_id = target_staff_id
        group by coalesce(nullif(f.service_name, ''), 'Unknown service')
        order by count(*) filter (where f.is_completed) desc, coalesce(nullif(f.service_name, ''), 'Unknown service')
        limit 5
      ) t
    ), '[]'::jsonb),
    'recent_appointments', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'booking_id', f.booking_id,
          'performance_date', f.performance_date,
          'time_slot', f.time_slot,
          'status', f.status,
          'payment_status', f.payment_status,
          'service_name', f.service_name,
          'customer_name', f.customer_name,
          'gross_amount', f.gross_amount,
          'paid_amount', f.paid_amount
        ) as x
        from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
        where f.staff_id = target_staff_id
        order by f.performance_date desc, f.booking_id desc
        limit 10
      ) r
    ), '[]'::jsonb),
    'last_7_days', coalesce(last7, '{}'::jsonb)
  );
  return result;
end;
$$;

-- ==============================================================================
-- 10. DATA REFRESH — UPSERT daily rollup (safe to re-run, no duplicates)
-- ==============================================================================
create or replace function public.refresh_staff_performance_daily(
  target_salon_id uuid,
  target_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  n int := 0;
begin
  if not (
    public.is_staff_dashboard_owner(target_salon_id)
    or public.staff_dashboard_is_trusted_server()
  ) then
    raise exception 'Staff performance refresh is owner- or service-role-only'
      using errcode = '42501';
  end if;

  with daily as (
    select
      d.staff_id,
      d.performance_date,
      d.bookings as total_bookings,
      d.completed_bookings,
      (
        select count(*)::int
        from public.staff_dashboard_booking_facts(target_salon_id, target_date, target_date) f
        where f.staff_id = d.staff_id and f.is_cancelled
      ) as cancelled_bookings,
      d.gross_amount,
      d.discount_amount,
      d.net_amount,
      d.paid_amount,
      d.commission_amount,
      d.salon_amount,
      d.reviews as review_count,
      d.average_rating
    from public.get_owner_staff_daily_performance(target_salon_id, target_date, target_date, null) d
  ),
  upserted as (
    insert into public.staff_performance_daily (
      salon_id, staff_id, performance_date,
      total_bookings, completed_bookings, cancelled_bookings,
      gross_amount, discount_amount, net_amount, paid_amount,
      commission_amount, salon_amount, review_count, average_rating,
      updated_at
    )
    select
      target_salon_id, staff_id, performance_date,
      total_bookings, completed_bookings, cancelled_bookings,
      gross_amount, discount_amount, net_amount, paid_amount,
      commission_amount, salon_amount, review_count, average_rating,
      now()
    from daily
    on conflict (salon_id, staff_id, performance_date) do update set
      total_bookings = excluded.total_bookings,
      completed_bookings = excluded.completed_bookings,
      cancelled_bookings = excluded.cancelled_bookings,
      gross_amount = excluded.gross_amount,
      discount_amount = excluded.discount_amount,
      net_amount = excluded.net_amount,
      paid_amount = excluded.paid_amount,
      commission_amount = excluded.commission_amount,
      salon_amount = excluded.salon_amount,
      review_count = excluded.review_count,
      average_rating = excluded.average_rating,
      updated_at = now()
    returning 1
  )
  select count(*)::int into n from upserted;

  insert into public.staff_performance_audit (
    salon_id, event_type, metadata
  ) values (
    target_salon_id,
    'daily_refresh',
    jsonb_build_object('target_date', target_date, 'rows', n)
  );

  return n;
end;
$$;

-- refresh_staff_performance_daily calls get_owner_staff_daily_performance which
-- asserts owner. Service-role jobs are trusted but are not salon owners, so the
-- inner assert would fail. Provide a SECURITY DEFINER path that skips the nested
-- owner RPC when the caller is already trusted, by inlining daily aggregation
-- when needed. Re-create refresh to compute from facts directly.
create or replace function public.refresh_staff_performance_daily(
  target_salon_id uuid,
  target_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  n int := 0;
  trusted boolean;
begin
  trusted := public.staff_dashboard_is_trusted_server();
  if not (public.is_staff_dashboard_owner(target_salon_id) or trusted) then
    raise exception 'Staff performance refresh is owner- or service-role-only'
      using errcode = '42501';
  end if;

  with facts as (
    select f.*
    from public.staff_dashboard_booking_facts(target_salon_id, target_date, target_date) f
    where f.staff_id is not null
  ),
  pay_override as (
    select * from public.staff_dashboard_paid_from_payments(target_salon_id)
  ),
  facts_paid as (
    select f.*, public.staff_dashboard_money(coalesce(po.paid_amount, f.paid_amount)) as paid_final
    from facts f
    left join pay_override po on po.booking_id = f.booking_id
  ),
  paid_dedup as (
    select distinct on (fp.staff_id, fp.payment_key)
      fp.staff_id, fp.payment_key, fp.paid_final
    from facts_paid fp
    where fp.is_paid
    order by fp.staff_id, fp.payment_key, fp.booking_id
  ),
  paid_agg as (
    select staff_id, public.staff_dashboard_money(sum(paid_final)) as paid_amount
    from paid_dedup
    group by staff_id
  ),
  book_agg as (
    select
      f.staff_id,
      f.performance_date,
      count(*)::int as total_bookings,
      count(*) filter (where f.is_completed)::int as completed_bookings,
      count(*) filter (where f.is_cancelled)::int as cancelled_bookings,
      public.staff_dashboard_money(sum(f.gross_amount) filter (where f.is_completed)) as gross_amount,
      public.staff_dashboard_money(sum(f.discount_amount) filter (where f.is_completed)) as discount_amount,
      public.staff_dashboard_money(sum(f.net_amount) filter (where f.is_completed)) as net_amount,
      count(*) filter (where f.review_rating is not null and f.review_rating >= 1)::int as review_count,
      coalesce(round(avg(f.review_rating) filter (where f.review_rating is not null and f.review_rating >= 1)::numeric, 2), 0) as average_rating
    from facts f
    group by f.staff_id, f.performance_date
  ),
  calc as (
    select
      b.*,
      coalesce(p.paid_amount, 0) as paid_amount,
      coalesce((
        select c.commission_amount
        from public.calculate_staff_commission(target_salon_id, b.staff_id, b.gross_amount, b.discount_amount) c
      ), 0) as commission_amount,
      coalesce((
        select c.salon_amount
        from public.calculate_staff_commission(target_salon_id, b.staff_id, b.gross_amount, b.discount_amount) c
      ), 0) as salon_amount
    from book_agg b
    left join paid_agg p on p.staff_id = b.staff_id
  ),
  upserted as (
    insert into public.staff_performance_daily (
      salon_id, staff_id, performance_date,
      total_bookings, completed_bookings, cancelled_bookings,
      gross_amount, discount_amount, net_amount, paid_amount,
      commission_amount, salon_amount, review_count, average_rating,
      updated_at
    )
    select
      target_salon_id, staff_id, performance_date,
      total_bookings, completed_bookings, cancelled_bookings,
      gross_amount, discount_amount, net_amount, paid_amount,
      commission_amount, salon_amount, review_count, average_rating,
      now()
    from calc
    on conflict (salon_id, staff_id, performance_date) do update set
      total_bookings = excluded.total_bookings,
      completed_bookings = excluded.completed_bookings,
      cancelled_bookings = excluded.cancelled_bookings,
      gross_amount = excluded.gross_amount,
      discount_amount = excluded.discount_amount,
      net_amount = excluded.net_amount,
      paid_amount = excluded.paid_amount,
      commission_amount = excluded.commission_amount,
      salon_amount = excluded.salon_amount,
      review_count = excluded.review_count,
      average_rating = excluded.average_rating,
      updated_at = now()
    returning 1
  )
  select count(*)::int into n from upserted;

  insert into public.staff_performance_audit (salon_id, event_type, metadata)
  values (
    target_salon_id,
    'daily_refresh',
    jsonb_build_object('target_date', target_date, 'rows', n, 'trusted_server', trusted)
  );

  return n;
end;
$$;

-- ==============================================================================
-- 11. CSV EXPORT RPC
-- ==============================================================================
create or replace function public.get_owner_staff_export(
  target_salon_id uuid,
  from_date date,
  to_date date,
  target_staff_id uuid default null
)
returns table (
  staff_name text,
  staff_role text,
  total_bookings integer,
  completed_bookings integer,
  cancelled_bookings integer,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  paid_amount numeric,
  commission_rate numeric,
  commission_amount numeric,
  salon_amount numeric,
  review_count integer,
  average_rating numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  return query
  select
    s.staff_name,
    s.staff_role,
    s.total_bookings,
    s.completed_bookings,
    s.cancelled_bookings,
    s.gross_amount,
    s.discount_amount,
    s.net_amount,
    s.paid_amount,
    s.commission_rate,
    s.commission_amount,
    s.salon_amount,
    s.review_count,
    s.average_rating
  from public.get_owner_staff_performance(target_salon_id, from_date, to_date, target_staff_id) s
  order by s.staff_name;
end;
$$;

-- ==============================================================================
-- 12. GRANTS — PostgREST exposure. SECURITY DEFINER functions default to PUBLIC
--     execute; revoke that, then grant only to authenticated + service_role.
-- ==============================================================================
do $$
declare
  f record;
  exposed text[] := array[
    'is_staff_dashboard_owner',
    'calculate_staff_commission',
    'get_owner_staff_performance',
    'get_owner_staff_last_7_days',
    'get_owner_staff_daily_performance',
    'get_owner_staff_detail',
    'refresh_staff_performance_daily',
    'get_owner_staff_export'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'is_staff_dashboard_owner',
        'staff_dashboard_assert_owner',
        'staff_dashboard_is_trusted_server',
        'calculate_staff_commission',
        'staff_dashboard_booking_facts',
        'staff_dashboard_rebuild_booking_facts',
        'staff_dashboard_paid_from_payments',
        'staff_dashboard_reviews_from_table',
        'staff_dashboard_staff_dim',
        'get_owner_staff_performance',
        'get_owner_staff_last_7_days',
        'get_owner_staff_daily_performance',
        'get_owner_staff_detail',
        'refresh_staff_performance_daily',
        'get_owner_staff_export',
        'staff_dashboard_has_rel',
        'staff_dashboard_has_col',
        'staff_dashboard_is_ident',
        'staff_dashboard_try_uuid',
        'staff_dashboard_try_numeric',
        'staff_dashboard_money'
      )
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname = any (exposed) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end;
$$;

-- Internal rebuild should not be a customer-facing RPC; keep service_role + owner (authenticated).
-- (already granted above)

comment on function public.get_owner_staff_performance(uuid, date, date, uuid) is
  'Owner-only staff performance summary. One row per current stylist plus historical staff with bookings. Revenue from completed bookings only; paid_amount ignores failed/pending/refunded and dedupes payment_id.';
comment on function public.get_owner_staff_detail(uuid, uuid, date, date) is
  'Owner-only staff detail payload (profile, bookings, payments, discounts, commission, reviews, top services, recent appointments, last 7 days).';
comment on function public.get_owner_staff_export(uuid, date, date, uuid) is
  'Owner-only CSV-ready staff performance export.';
comment on function public.refresh_staff_performance_daily(uuid, date) is
  'Owner or service_role. UPSERT into staff_performance_daily for target_date. Idempotent.';
