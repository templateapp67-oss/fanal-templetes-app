-- =============================================================================
-- Nexora Salon OS — Owner-only staff commission settings + payouts
-- Migration: 20260909_staff_commission_payouts.sql
-- Requires 20260908_staff_performance_dashboard_backend.sql first.
-- Idempotent. Reuses staff_commission_settings and staff_performance_audit.
-- Does not rewrite booking / payment / review / auth tables.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.is_staff_dashboard_owner(uuid)') is null
     or to_regclass('public.staff_commission_settings') is null then
    raise exception 'Apply 20260908_staff_performance_dashboard_backend.sql before this file';
  end if;
end;
$$;

-- =============================================================================
-- 1. Version columns on existing staff_commission_settings
--    Old calculation fields are never updated in place. A new row is inserted
--    and the previous open row is closed via effective_to only.
-- =============================================================================
alter table public.staff_commission_settings
  add column if not exists notes text not null default '';
alter table public.staff_commission_settings
  add column if not exists effective_from date;
alter table public.staff_commission_settings
  add column if not exists effective_to date;

-- Existing unversioned rows must cover historical booking dates. New upserts
-- still default effective_from to today (future-only from the RPC).
update public.staff_commission_settings
   set effective_from = date '2000-01-01'
 where effective_from is null;

alter table public.staff_commission_settings
  alter column effective_from set default current_date;
alter table public.staff_commission_settings
  alter column effective_from set not null;

drop index if exists public.uq_staff_commission_settings_salon_staff;

create unique index if not exists uq_staff_commission_settings_active
  on public.staff_commission_settings (salon_id, staff_id)
  where effective_to is null;

create index if not exists idx_staff_commission_settings_effective
  on public.staff_commission_settings (salon_id, staff_id, effective_from);

-- =============================================================================
-- 2. Payouts (new). Status: pending, approved, paid, cancelled.
-- =============================================================================
create table if not exists public.staff_commission_payouts (
  id                  uuid primary key default gen_random_uuid(),
  salon_id            uuid not null,
  staff_id            uuid not null,
  period_from         date not null,
  period_to           date not null,
  completed_bookings  integer not null default 0,
  gross_amount        numeric not null default 0,
  discount_amount     numeric not null default 0,
  net_amount          numeric not null default 0,
  commission_amount   numeric not null default 0,
  status              text not null default 'pending',
  reference_number    text not null default '',
  notes               text not null default '',
  approved_by         uuid,
  approved_at         timestamptz,
  paid_at             timestamptz,
  cancelled_at        timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (period_to >= period_from),
  check (commission_amount >= 0),
  check (status in ('pending', 'approved', 'paid', 'cancelled'))
);

create unique index if not exists uq_staff_commission_payouts_open_period
  on public.staff_commission_payouts (salon_id, staff_id, period_from, period_to)
  where status in ('pending', 'approved', 'paid');

create index if not exists idx_staff_commission_payouts_salon
  on public.staff_commission_payouts (salon_id, status, period_from);
create index if not exists idx_staff_commission_payouts_staff
  on public.staff_commission_payouts (staff_id, created_at desc);

do $$
begin
  if public.staff_dashboard_has_rel('profiles')
     and public.staff_dashboard_has_col('profiles', 'id')
     and not exists (select 1 from pg_constraint where conname = 'staff_commission_payouts_salon_fk') then
    alter table public.staff_commission_payouts
      add constraint staff_commission_payouts_salon_fk
      foreign key (salon_id) references public.profiles(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_staff_commission_payouts_updated_at') then
    create trigger trg_staff_commission_payouts_updated_at
      before update on public.staff_commission_payouts
      for each row execute procedure public.set_updated_at();
  end if;
end;
$$;

alter table public.staff_commission_payouts enable row level security;

drop policy if exists staff_commission_payouts_owner_select on public.staff_commission_payouts;
drop policy if exists staff_commission_payouts_owner_insert on public.staff_commission_payouts;
drop policy if exists staff_commission_payouts_owner_update on public.staff_commission_payouts;
drop policy if exists staff_commission_payouts_owner_delete on public.staff_commission_payouts;
create policy staff_commission_payouts_owner_select
  on public.staff_commission_payouts for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy staff_commission_payouts_owner_insert
  on public.staff_commission_payouts for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_commission_payouts_owner_update
  on public.staff_commission_payouts for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_commission_payouts_owner_delete
  on public.staff_commission_payouts for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

grant select, insert, update, delete on table public.staff_commission_payouts to authenticated;
grant select, insert, update, delete on table public.staff_commission_payouts to service_role;

-- =============================================================================
-- 3. As-of commission (new setting never rewrites old rows)
-- =============================================================================
drop function if exists public.calculate_staff_commission(uuid, uuid, numeric, numeric);

create or replace function public.calculate_staff_commission(
  target_salon_id uuid,
  target_staff_id uuid,
  target_gross_amount numeric,
  target_discount_amount numeric,
  as_of date default current_date
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
  v_as_of date := coalesce(as_of, current_date);
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
    and s.effective_from <= v_as_of
    and (s.effective_to is null or s.effective_to >= v_as_of)
  order by s.effective_from desc, s.created_at desc
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

create or replace function public.staff_dashboard_write_audit(
  p_salon_id uuid,
  p_staff_id uuid,
  p_action text,
  p_payout_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  begin
    uid := auth.uid();
  exception
    when others then
      uid := null;
  end;
  insert into public.staff_performance_audit (
    salon_id, staff_id, booking_id, event_type, metadata
  ) values (
    p_salon_id,
    p_staff_id,
    null,
    p_action,
    jsonb_build_object(
      'owner_user_id', uid,
      'action', p_action,
      'old_value', coalesce(p_old, 'null'::jsonb),
      'new_value', coalesce(p_new, 'null'::jsonb),
      'payout_id', p_payout_id,
      'timestamp', now()
    ) || coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- =============================================================================
-- 4. Period commission (completed, non-refunded) using as-of setting
-- =============================================================================
create or replace function public.staff_dashboard_period_commission(
  target_salon_id uuid,
  target_staff_id uuid,
  from_date date,
  to_date date
)
returns table (
  completed_bookings integer,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  commission_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select
    count(*)::int,
    public.staff_dashboard_money(sum(f.gross_amount)),
    public.staff_dashboard_money(sum(f.discount_amount)),
    public.staff_dashboard_money(sum(f.net_amount)),
    public.staff_dashboard_money(sum(c.commission_amount))
  from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
  cross join lateral public.calculate_staff_commission(
    target_salon_id, f.staff_id, f.gross_amount, f.discount_amount, f.performance_date
  ) c
  where f.staff_id = target_staff_id
    and f.is_completed
    and coalesce(f.payment_status, '') not in ('failed', 'refunded', 'cancelled', 'canceled');
end;
$$;

-- =============================================================================
-- 5. Owner RPCs
-- =============================================================================
create or replace function public.get_staff_commission_settings(
  target_salon_id uuid,
  target_staff_id uuid default null
)
returns table (
  id uuid,
  staff_id uuid,
  staff_name text,
  commission_type text,
  commission_rate numeric,
  fixed_amount numeric,
  is_enabled boolean,
  effective_from date,
  effective_to date,
  notes text,
  is_current boolean,
  created_at timestamptz
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
    s.id,
    s.staff_id,
    coalesce(d.staff_name, 'Former staff'),
    s.commission_type,
    public.staff_dashboard_money(s.commission_rate),
    public.staff_dashboard_money(s.fixed_amount),
    s.is_enabled,
    s.effective_from,
    s.effective_to,
    coalesce(s.notes, ''),
    (s.effective_to is null),
    s.created_at
  from public.staff_commission_settings s
  left join public.staff_dashboard_staff_dim(target_salon_id) d on d.staff_id = s.staff_id
  where s.salon_id = target_salon_id
    and (target_staff_id is null or s.staff_id = target_staff_id)
  order by coalesce(d.staff_name, 'Former staff'), s.effective_from desc, s.created_at desc;
end;
$$;

create or replace function public.upsert_staff_commission_setting(
  target_salon_id uuid,
  target_staff_id uuid,
  p_commission_type text,
  p_commission_rate numeric,
  p_fixed_amount numeric,
  p_is_enabled boolean,
  p_effective_from date,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_type text := lower(btrim(coalesce(p_commission_type, 'none')));
  v_rate numeric := public.staff_dashboard_money(coalesce(p_commission_rate, 0));
  v_fixed numeric := public.staff_dashboard_money(coalesce(p_fixed_amount, 0));
  v_from date := coalesce(p_effective_from, current_date);
  v_notes text := coalesce(p_notes, '');
  v_enabled boolean := coalesce(p_is_enabled, false);
  cur public.staff_commission_settings%rowtype;
  new_id uuid;
  old_json jsonb;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  if target_staff_id is null then
    raise exception 'target_staff_id is required' using errcode = '22023';
  end if;
  if v_type not in ('percentage', 'fixed', 'none') then
    raise exception 'commission_type must be percentage, fixed, or none' using errcode = '22023';
  end if;
  if v_rate < 0 or v_rate > 100 then
    raise exception 'commission_rate must be between 0 and 100' using errcode = '22023';
  end if;
  if v_fixed < 0 then
    raise exception 'fixed_amount must not be negative' using errcode = '22023';
  end if;
  if v_from < current_date then
    raise exception 'effective_from cannot be in the past' using errcode = '22023';
  end if;
  if v_type = 'none' then
    v_enabled := false;
  end if;
  if v_type = 'percentage' then
    v_fixed := 0;
  end if;
  if v_type = 'fixed' then
    v_rate := 0;
  end if;

  select * into cur
  from public.staff_commission_settings s
  where s.salon_id = target_salon_id
    and s.staff_id = target_staff_id
    and s.effective_to is null
  order by s.effective_from desc, s.created_at desc
  limit 1;

  if found
     and cur.commission_type = v_type
     and public.staff_dashboard_money(cur.commission_rate) = v_rate
     and public.staff_dashboard_money(cur.fixed_amount) = v_fixed
     and cur.is_enabled is not distinct from v_enabled then
    old_json := to_jsonb(cur);
    update public.staff_commission_settings
       set notes = v_notes
     where id = cur.id;
    perform public.staff_dashboard_write_audit(
      target_salon_id, target_staff_id, 'commission_setting_notes',
      null, old_json, to_jsonb(cur) || jsonb_build_object('notes', v_notes)
    );
    return cur.id;
  end if;

  if found then
    old_json := to_jsonb(cur);
    update public.staff_commission_settings
       set effective_to = case
             when v_from <= cur.effective_from then cur.effective_from
             else v_from - 1
           end
     where id = cur.id;
  else
    old_json := 'null'::jsonb;
  end if;

  insert into public.staff_commission_settings (
    salon_id, staff_id, commission_type, commission_rate, fixed_amount,
    is_enabled, notes, effective_from, effective_to
  ) values (
    target_salon_id, target_staff_id, v_type, v_rate, v_fixed,
    v_enabled, v_notes, v_from, null
  )
  returning id into new_id;

  perform public.staff_dashboard_write_audit(
    target_salon_id, target_staff_id, 'commission_setting_insert',
    null, old_json,
    jsonb_build_object(
      'id', new_id,
      'commission_type', v_type,
      'commission_rate', v_rate,
      'fixed_amount', v_fixed,
      'is_enabled', v_enabled,
      'effective_from', v_from,
      'notes', v_notes
    )
  );
  return new_id;
end;
$$;

create or replace function public.get_staff_payout_summary(
  target_salon_id uuid,
  from_date date,
  to_date date,
  target_staff_id uuid default null
)
returns table (
  staff_id uuid,
  staff_name text,
  completed_bookings integer,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  commission_amount numeric,
  already_paid_commission numeric,
  pending_commission numeric,
  payout_status text,
  last_payout_date date,
  open_payout_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'valid from_date and to_date are required' using errcode = '22023';
  end if;

  return query
  with roster as (
    select * from public.staff_dashboard_staff_dim(target_salon_id)
  ),
  earned as (
    select
      f.staff_id,
      count(*)::int as completed_bookings,
      public.staff_dashboard_money(sum(f.gross_amount)) as gross_amount,
      public.staff_dashboard_money(sum(f.discount_amount)) as discount_amount,
      public.staff_dashboard_money(sum(f.net_amount)) as net_amount,
      public.staff_dashboard_money(sum(c.commission_amount)) as commission_amount
    from public.staff_dashboard_booking_facts(target_salon_id, from_date, to_date) f
    cross join lateral public.calculate_staff_commission(
      target_salon_id, f.staff_id, f.gross_amount, f.discount_amount, f.performance_date
    ) c
    where f.is_completed
      and coalesce(f.payment_status, '') not in ('failed', 'refunded', 'cancelled', 'canceled')
      and f.staff_id is not null
      and (target_staff_id is null or f.staff_id = target_staff_id)
    group by f.staff_id
  ),
  paid as (
    select
      p.staff_id,
      public.staff_dashboard_money(sum(p.commission_amount) filter (where p.status = 'paid')) as already_paid,
      max(p.paid_at)::date as last_paid
    from public.staff_commission_payouts p
    where p.salon_id = target_salon_id
      and p.period_from >= from_date
      and p.period_to <= to_date
      and (target_staff_id is null or p.staff_id = target_staff_id)
    group by p.staff_id
  ),
  open_p as (
    select distinct on (p.staff_id)
      p.staff_id, p.id, p.status
    from public.staff_commission_payouts p
    where p.salon_id = target_salon_id
      and p.period_from = from_date
      and p.period_to = to_date
      and p.status in ('pending', 'approved', 'paid')
      and (target_staff_id is null or p.staff_id = target_staff_id)
    order by p.staff_id, p.created_at desc
  ),
  staff_set as (
    select r.staff_id, r.staff_name from roster r
    where target_staff_id is null or r.staff_id = target_staff_id
    union
    select e.staff_id, coalesce(r.staff_name, 'Former staff')
    from earned e
    left join roster r on r.staff_id = e.staff_id
  )
  select
    s.staff_id,
    s.staff_name,
    coalesce(e.completed_bookings, 0),
    coalesce(e.gross_amount, 0),
    coalesce(e.discount_amount, 0),
    coalesce(e.net_amount, 0),
    coalesce(e.commission_amount, 0),
    coalesce(pd.already_paid, 0),
    public.staff_dashboard_money(greatest(coalesce(e.commission_amount, 0) - coalesce(pd.already_paid, 0), 0)),
    coalesce(op.status, 'pending'),
    pd.last_paid,
    op.id
  from staff_set s
  left join earned e on e.staff_id = s.staff_id
  left join paid pd on pd.staff_id = s.staff_id
  left join open_p op on op.staff_id = s.staff_id
  order by s.staff_name, s.staff_id;
end;
$$;

create or replace function public.approve_staff_payout(
  target_salon_id uuid,
  target_staff_id uuid,
  from_date date,
  to_date date,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  uid uuid;
  earned record;
  existing public.staff_commission_payouts%rowtype;
  new_id uuid;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  begin uid := auth.uid(); exception when others then uid := null; end;
  if target_staff_id is null or from_date is null or to_date is null or to_date < from_date then
    raise exception 'staff id and a valid period are required' using errcode = '22023';
  end if;

  select * into existing
  from public.staff_commission_payouts p
  where p.salon_id = target_salon_id
    and p.staff_id = target_staff_id
    and p.period_from = from_date
    and p.period_to = to_date
    and p.status in ('pending', 'approved', 'paid')
  order by p.created_at desc
  limit 1;

  if found and existing.status = 'paid' then
    raise exception 'Paid payout cannot be approved again' using errcode = 'P0001';
  end if;
  if found and existing.status = 'approved' then
    return existing.id;
  end if;

  select * into earned
  from public.staff_dashboard_period_commission(target_salon_id, target_staff_id, from_date, to_date);

  if coalesce(earned.commission_amount, 0) <= 0 then
    raise exception 'No eligible commission to approve for this period' using errcode = 'P0001';
  end if;

  if found and existing.status = 'pending' then
    update public.staff_commission_payouts
       set status = 'approved',
           approved_by = uid,
           approved_at = now(),
           notes = coalesce(nullif(p_notes, ''), notes),
           completed_bookings = coalesce(earned.completed_bookings, 0),
           gross_amount = coalesce(earned.gross_amount, 0),
           discount_amount = coalesce(earned.discount_amount, 0),
           net_amount = coalesce(earned.net_amount, 0),
           commission_amount = coalesce(earned.commission_amount, 0)
     where id = existing.id;
    perform public.staff_dashboard_write_audit(
      target_salon_id, target_staff_id, 'payout_approve', existing.id,
      to_jsonb(existing), jsonb_build_object('status', 'approved')
    );
    return existing.id;
  end if;

  insert into public.staff_commission_payouts (
    salon_id, staff_id, period_from, period_to,
    completed_bookings, gross_amount, discount_amount, net_amount, commission_amount,
    status, notes, approved_by, approved_at, created_by
  ) values (
    target_salon_id, target_staff_id, from_date, to_date,
    coalesce(earned.completed_bookings, 0),
    coalesce(earned.gross_amount, 0),
    coalesce(earned.discount_amount, 0),
    coalesce(earned.net_amount, 0),
    coalesce(earned.commission_amount, 0),
    'approved', coalesce(p_notes, ''), uid, now(), uid
  )
  returning id into new_id;

  perform public.staff_dashboard_write_audit(
    target_salon_id, target_staff_id, 'payout_approve', new_id,
    'null'::jsonb, jsonb_build_object('status', 'approved', 'commission_amount', earned.commission_amount)
  );
  return new_id;
end;
$$;

create or replace function public.mark_staff_payout_paid(
  target_salon_id uuid,
  payout_id uuid,
  p_reference text default '',
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.staff_commission_payouts%rowtype;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  if payout_id is null then
    raise exception 'payout_id is required' using errcode = '22023';
  end if;
  select * into row from public.staff_commission_payouts p
  where p.id = payout_id and p.salon_id = target_salon_id;
  if not found then
    raise exception 'Payout not found' using errcode = 'P0002';
  end if;
  if row.status = 'paid' then
    raise exception 'Paid payout cannot be paid again' using errcode = 'P0001';
  end if;
  if row.status = 'cancelled' then
    raise exception 'Cancelled payout cannot be marked paid' using errcode = 'P0001';
  end if;
  if row.status <> 'approved' then
    raise exception 'Payout must be approved before it is marked paid' using errcode = 'P0001';
  end if;
  update public.staff_commission_payouts
     set status = 'paid',
         paid_at = now(),
         reference_number = coalesce(p_reference, reference_number),
         notes = coalesce(nullif(p_notes, ''), notes)
   where id = payout_id;
  perform public.staff_dashboard_write_audit(
    target_salon_id, row.staff_id, 'payout_paid', payout_id,
    to_jsonb(row), jsonb_build_object('status', 'paid', 'reference_number', p_reference)
  );
  return payout_id;
end;
$$;

create or replace function public.cancel_staff_payout(
  target_salon_id uuid,
  payout_id uuid,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.staff_commission_payouts%rowtype;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  if payout_id is null then
    raise exception 'payout_id is required' using errcode = '22023';
  end if;
  select * into row from public.staff_commission_payouts p
  where p.id = payout_id and p.salon_id = target_salon_id;
  if not found then
    raise exception 'Payout not found' using errcode = 'P0002';
  end if;
  if row.status = 'paid' then
    raise exception 'Paid payout cannot be cancelled' using errcode = 'P0001';
  end if;
  if row.status = 'cancelled' then
    return payout_id;
  end if;
  update public.staff_commission_payouts
     set status = 'cancelled',
         cancelled_at = now(),
         notes = coalesce(nullif(p_notes, ''), notes)
   where id = payout_id;
  perform public.staff_dashboard_write_audit(
    target_salon_id, row.staff_id, 'payout_cancel', payout_id,
    to_jsonb(row), jsonb_build_object('status', 'cancelled')
  );
  return payout_id;
end;
$$;

create or replace function public.get_staff_payout_history(
  target_salon_id uuid,
  from_date date default null,
  to_date date default null,
  target_staff_id uuid default null,
  p_status text default null
)
returns table (
  payout_id uuid,
  staff_id uuid,
  staff_name text,
  commission_amount numeric,
  period_from date,
  period_to date,
  status text,
  approved_by uuid,
  paid_at timestamptz,
  reference_number text,
  notes text,
  created_at timestamptz,
  completed_bookings integer,
  gross_amount numeric,
  net_amount numeric
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
    p.id,
    p.staff_id,
    coalesce(d.staff_name, 'Former staff'),
    p.commission_amount,
    p.period_from,
    p.period_to,
    p.status,
    p.approved_by,
    p.paid_at,
    p.reference_number,
    p.notes,
    p.created_at,
    p.completed_bookings,
    p.gross_amount,
    p.net_amount
  from public.staff_commission_payouts p
  left join public.staff_dashboard_staff_dim(target_salon_id) d on d.staff_id = p.staff_id
  where p.salon_id = target_salon_id
    and (target_staff_id is null or p.staff_id = target_staff_id)
    and (p_status is null or p_status = '' or p.status = p_status)
    and (from_date is null or p.period_to >= from_date)
    and (to_date is null or p.period_from <= to_date)
  order by p.created_at desc, p.id desc;
end;
$$;

-- =============================================================================
-- 6. Grants
-- =============================================================================
do $$
declare
  f record;
  exposed text[] := array[
    'get_staff_commission_settings',
    'upsert_staff_commission_setting',
    'get_staff_payout_summary',
    'approve_staff_payout',
    'mark_staff_payout_paid',
    'cancel_staff_payout',
    'get_staff_payout_history',
    'calculate_staff_commission'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_staff_commission_settings',
        'upsert_staff_commission_setting',
        'get_staff_payout_summary',
        'approve_staff_payout',
        'mark_staff_payout_paid',
        'cancel_staff_payout',
        'get_staff_payout_history',
        'staff_dashboard_period_commission',
        'staff_dashboard_write_audit',
        'calculate_staff_commission'
      )
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname = any (exposed) and f.proname <> 'calculate_staff_commission' then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- 7. Versioned settings must not multiply owner summary rows.
--    Keep the Phase 2 body as _unversioned and overlay the current open setting.
-- =============================================================================
do $$
begin
  if to_regprocedure('public.get_owner_staff_performance_unversioned(uuid, date, date, uuid)') is null
     and to_regprocedure('public.get_owner_staff_performance(uuid, date, date, uuid)') is not null then
    alter function public.get_owner_staff_performance(uuid, date, date, uuid)
      rename to get_owner_staff_performance_unversioned;
  end if;
end;
$$;

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
  select distinct on (u.staff_id)
    u.staff_id,
    u.staff_name,
    u.staff_photo,
    u.staff_role,
    u.total_bookings,
    u.pending_bookings,
    u.confirmed_bookings,
    u.completed_bookings,
    u.cancelled_bookings,
    u.gross_amount,
    u.discount_amount,
    u.net_amount,
    u.paid_amount,
    public.staff_dashboard_money(coalesce(cs.commission_rate, 0)),
    u.commission_amount,
    u.salon_amount,
    u.review_count,
    u.average_rating,
    u.five_star_reviews,
    u.four_star_reviews,
    u.three_star_reviews,
    u.two_star_reviews,
    u.one_star_reviews
  from public.get_owner_staff_performance_unversioned(
    target_salon_id, from_date, to_date, target_staff_id
  ) u
  left join public.staff_commission_settings cs
    on cs.salon_id = target_salon_id
   and cs.staff_id = u.staff_id
   and cs.effective_to is null
  order by u.staff_id, cs.effective_from desc nulls last, cs.created_at desc nulls last;
end;
$$;

do $$
begin
  perform 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_owner_staff_performance_unversioned';
  if found then
    execute format(
      'revoke all on function public.get_owner_staff_performance_unversioned(uuid, date, date, uuid) from public, anon, authenticated'
    );
    execute format(
      'grant execute on function public.get_owner_staff_performance_unversioned(uuid, date, date, uuid) to service_role'
    );
  end if;
  execute format('grant execute on function public.get_owner_staff_performance(uuid, date, date, uuid) to authenticated');
  execute format('grant execute on function public.get_owner_staff_performance(uuid, date, date, uuid) to service_role');
end;
$$;
