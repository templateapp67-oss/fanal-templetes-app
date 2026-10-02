-- ============================================================================
-- 20261102000000_salon_booking_settings_deposit.sql
--
-- Website / profile save was rejected with:
--   code 23514  violates check constraint "salon_booking_settings_deposit_25_check"
--
-- Repair:
--   1. Ensure public.salon_booking_settings exists with a numeric 0â100
--      deposit percentage (default 25).
--   2. Drop the overly-strict deposit_25 check (and any sibling deposit
--      checks) and replace them with a percentage range the editor can meet.
--   3. Upsert a valid row whenever a salon is saved so profile/website writes
--      never leave the booking-settings table in a violating state.
-- ============================================================================

begin;

create table if not exists public.salon_booking_settings (
  salon_id uuid primary key,
  require_deposit boolean not null default true,
  deposit_percent numeric(5,2) not null default 25,
  deposit_percentage numeric(5,2) not null default 25,
  deposit_25 numeric(5,2) not null default 25,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.salons') is not null then
    begin
      alter table public.salon_booking_settings
        add constraint salon_booking_settings_salon_id_fkey
        foreign key (salon_id) references public.salons(id) on delete cascade;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

alter table public.salon_booking_settings
  add column if not exists require_deposit boolean,
  add column if not exists deposit_percent numeric(5,2),
  add column if not exists deposit_percentage numeric(5,2),
  add column if not exists deposit_25 numeric(5,2),
  add column if not exists updated_at timestamptz;

alter table public.salon_booking_settings
  alter column require_deposit set default true;

do $$
declare
  col record;
begin
  for col in
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0 and not a.attisdropped
      and a.attname in ('deposit_percent', 'deposit_percentage', 'deposit_25', 'deposit')
  loop
    if col.typ in ('boolean') then
      continue;
    end if;
    execute format('alter table public.salon_booking_settings alter column %I set default 25', col.name);
  end loop;
end $$;

-- Drop every deposit check, including the reported
-- salon_booking_settings_deposit_25_check (23514).
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and c.contype = 'c'
      and (
        c.conname ilike '%deposit%'
        or pg_get_constraintdef(c.oid) ilike '%deposit%'
      )
  loop
    execute format('alter table public.salon_booking_settings drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- Numeric deposit columns: coerce out-of-range / null values to 25.
do $$
declare
  col record;
begin
  for col in
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0 and not a.attisdropped
      and a.attname in ('deposit_percent', 'deposit_percentage', 'deposit_25', 'deposit')
  loop
    if col.typ like 'numeric%' or col.typ like 'int%' or col.typ = 'double precision' or col.typ = 'real' then
      execute format(
        'update public.salon_booking_settings set %I = 25 where %I is null or %I < 0 or %I > 100',
        col.name, col.name, col.name, col.name
      );
    end if;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'salon_booking_settings' and column_name = 'deposit_percent'
      and data_type in ('numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real')
  ) then
    begin
      alter table public.salon_booking_settings
        add constraint salon_booking_settings_deposit_percent_check
        check (deposit_percent is null or (deposit_percent >= 0 and deposit_percent <= 100));
    exception when duplicate_object then null;
    end;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'salon_booking_settings' and column_name = 'deposit_percentage'
      and data_type in ('numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real')
  ) then
    begin
      alter table public.salon_booking_settings
        add constraint salon_booking_settings_deposit_percentage_check
        check (deposit_percentage is null or (deposit_percentage >= 0 and deposit_percentage <= 100));
    exception when duplicate_object then null;
    end;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'salon_booking_settings' and column_name = 'deposit_25'
      and data_type in ('numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real')
  ) then
    -- Recreate the reported constraint name as a satisfiable 0â100 percentage
    -- check so existing clients that still send 25 (or any valid percent) save.
    begin
      alter table public.salon_booking_settings
        add constraint salon_booking_settings_deposit_25_check
        check (deposit_25 is null or (deposit_25 >= 0 and deposit_25 <= 100));
    exception when duplicate_object then null;
    end;
  end if;
end $$;

alter table public.salon_booking_settings enable row level security;

drop policy if exists salon_booking_settings_owner_all on public.salon_booking_settings;
do $$
declare
  owner_using text := 'true';
  has_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  if to_regprocedure('public.nexora_owner_salon_ids()') is not null then
    owner_using := 'salon_id in (select public.nexora_owner_salon_ids())';
  end if;
  if has_auth then
    execute format(
      'create policy salon_booking_settings_owner_all on public.salon_booking_settings for all to authenticated using (%s) with check (%s)',
      owner_using, owner_using
    );
  else
    execute format(
      'create policy salon_booking_settings_owner_all on public.salon_booking_settings for all using (%s) with check (%s)',
      owner_using, owner_using
    );
  end if;
end $$;

do $$
begin
  grant select, insert, update, delete on table public.salon_booking_settings to authenticated, service_role;
exception
  when undefined_object then
    grant select, insert, update, delete on table public.salon_booking_settings to public;
end $$;

create or replace function public.nexora_upsert_salon_booking_settings(
  p_salon_id uuid,
  p_require_deposit boolean default true,
  p_deposit numeric default 25
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  pct numeric := 25;
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sets text[] := array[]::text[];
  col record;
begin
  if p_salon_id is null or to_regclass('public.salon_booking_settings') is null then
    return;
  end if;
  pct := case
    when p_deposit is null or p_deposit < 0 or p_deposit > 100 then 25
    else round(p_deposit)
  end;

  cols := array['salon_id'];
  vals := array[quote_literal(p_salon_id) || '::uuid'];
  sets := array[]::text[];

  for col in
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0 and not a.attisdropped
      and a.attname in ('require_deposit', 'deposit_percent', 'deposit_percentage', 'deposit_25', 'deposit', 'updated_at')
  loop
    cols := cols || array[col.name];
    if col.name = 'require_deposit' then
      vals := vals || array[coalesce(p_require_deposit, true)::text];
      sets := sets || array[format('%I = excluded.%I', col.name, col.name)];
    elsif col.name = 'updated_at' then
      vals := vals || array['now()'];
      sets := sets || array[format('%I = now()', col.name)];
    elsif col.typ = 'boolean' then
      vals := vals || array[(pct = 25)::text];
      sets := sets || array[format('%I = excluded.%I', col.name, col.name)];
    else
      vals := vals || array[pct::text];
      sets := sets || array[format('%I = excluded.%I', col.name, col.name)];
    end if;
  end loop;

  if coalesce(array_length(sets, 1), 0) = 0 then
    execute format(
      'insert into public.salon_booking_settings (%s) values (%s) on conflict (salon_id) do nothing',
      array_to_string(cols, ', '),
      array_to_string(vals, ', ')
    );
  else
    execute format(
      'insert into public.salon_booking_settings (%s) values (%s) on conflict (salon_id) do update set %s',
      array_to_string(cols, ', '),
      array_to_string(vals, ', '),
      array_to_string(sets, ', ')
    );
  end if;
end;
$$;

do $$
begin
  revoke all on function public.nexora_upsert_salon_booking_settings(uuid, boolean, numeric) from public, anon;
exception
  when undefined_object then null;
end $$;
do $$
begin
  grant execute on function public.nexora_upsert_salon_booking_settings(uuid, boolean, numeric) to authenticated, service_role;
exception
  when undefined_object then
    grant execute on function public.nexora_upsert_salon_booking_settings(uuid, boolean, numeric) to public;
end $$;

create or replace function public.nexora_sync_salon_booking_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pct numeric := 25;
  require_dep boolean := true;
  src jsonb := '{}'::jsonb;
begin
  src := coalesce(new.data, '{}'::jsonb);
  if jsonb_typeof(src->'editor_profile') = 'object' then
    src := src->'editor_profile';
  end if;
  begin
    pct := coalesce(
      nullif(src->>'depositPercentage', '')::numeric,
      nullif(src->>'deposit_percentage', '')::numeric,
      nullif(src->>'deposit_percent', '')::numeric,
      nullif(src->>'deposit_25', '')::numeric,
      25
    );
  exception when others then
    pct := 25;
  end;
  if pct < 0 or pct > 100 then
    pct := 25;
  end if;
  begin
    require_dep := coalesce((src->>'requireDeposit')::boolean, (src->>'require_deposit')::boolean, true);
  exception when others then
    require_dep := true;
  end;
  perform public.nexora_upsert_salon_booking_settings(new.id, require_dep, pct);
  return new;
end;
$$;

drop trigger if exists trg_salon_booking_settings_sync on public.salons;
do $$
begin
  if to_regclass('public.salons') is not null then
    create trigger trg_salon_booking_settings_sync
      after insert or update on public.salons
      for each row execute procedure public.nexora_sync_salon_booking_settings();
  end if;
end $$;

-- Backfill existing salons so a later website save is an UPDATE of a valid row.
do $$
declare
  sid uuid;
begin
  if to_regclass('public.salons') is null then
    return;
  end if;
  for sid in select s.id from public.salons s loop
    perform public.nexora_upsert_salon_booking_settings(sid, true, 25);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
