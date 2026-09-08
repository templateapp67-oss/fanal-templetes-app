-- ============================================================================
-- Nexora SalonOS — Staff Payroll & Payout Engine
-- Migration: 20260909_staff_payroll_payouts.sql
-- ----------------------------------------------------------------------------
-- Delivers idempotent PostgreSQL schema extensions, staff_payouts table,
-- and server-side RPCs for monthly commission payout calculations, marking
-- payouts as Paid, and historical tracking under owner RLS security.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Staff Payouts Table Creation
-- ----------------------------------------------------------------------------
create table if not exists public.staff_payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  staff_id uuid not null references public.stylists(id) on delete cascade,
  payout_period varchar(7) not null, -- Format 'YYYY-MM' (e.g., '2026-09')
  gross_sales numeric(12,2) not null default 0.00,
  commission_earned numeric(12,2) not null default 0.00,
  bonus_amount numeric(12,2) not null default 0.00,
  deductions_amount numeric(12,2) not null default 0.00,
  net_payout numeric(12,2) not null default 0.00,
  status varchar(20) not null default 'Pending', -- 'Pending' | 'Paid' | 'Processing'
  payment_method varchar(50) default 'Bank Transfer', -- 'UPI' | 'Bank Transfer' | 'Cash' | 'Cheque'
  payment_reference varchar(100),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_staff_payout_owner_period unique(owner_id, staff_id, payout_period)
);

create index if not exists idx_staff_payouts_owner_period on public.staff_payouts(owner_id, payout_period);
create index if not exists idx_staff_payouts_staff_period on public.staff_payouts(staff_id, payout_period);

alter table public.staff_payouts enable row level security;

drop policy if exists owner_payouts_all on public.staff_payouts;
create policy owner_payouts_all on public.staff_payouts
  for all using (
    owner_id = auth.uid() or
    auth.uid() is null
  ) with check (
    owner_id = auth.uid() or
    auth.uid() is null
  );

-- ----------------------------------------------------------------------------
-- 2. RPC: owner_get_monthly_payroll
-- Calculates monthly gross sales & commission earned for each staff member,
-- joining existing payout records if marked 'Paid' or 'Pending'.
-- ----------------------------------------------------------------------------
create or replace function public.owner_get_monthly_payroll(
  p_payout_period text default null
)
returns table (
  payout_id uuid,
  staff_id uuid,
  staff_name text,
  staff_role text,
  avatar_url text,
  payout_period text,
  commission_rate numeric,
  commission_type text,
  commission_basis text,
  fixed_commission_amount numeric,
  completed_bookings_count bigint,
  gross_sales numeric,
  calculated_commission numeric,
  bonus_amount numeric,
  deductions_amount numeric,
  net_payout numeric,
  status text,
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
  notes text
)
language plpgsql
security definer
as $$
declare
  v_owner_id uuid;
  v_period text;
  v_start_date date;
  v_end_date date;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  v_period := coalesce(p_payout_period, to_char(now(), 'YYYY-MM'));
  v_start_date := (v_period || '-01')::date;
  v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;

  return query
  with period_bookings as (
    select
      coalesce(
        b.stylist_id,
        nullif(b.metadata->>'stylist_id','')::uuid,
        nullif(b.metadata->>'staff_id','')::uuid
      ) as b_staff_id,
      count(b.id) filter (where b.status = 'completed') as b_completed_count,
      coalesce(sum((b.price)::numeric) filter (where b.status = 'completed'), 0.00) as b_gross_sales,
      coalesce(
        sum(
          public.calculate_staff_booking_commission(
            (b.price)::numeric,
            coalesce((b.discount_amount)::numeric, (b.metadata->>'discount_amount')::numeric, 0),
            s_sub.commission_rate,
            s_sub.fixed_commission_amount,
            s_sub.commission_type,
            s_sub.commission_basis
          )
        ) filter (where b.status = 'completed'), 0.00
      ) as b_calculated_commission
    from public.stylists s_sub
    left join public.bookings b on
      (b.stylist_id = s_sub.id or (b.metadata->>'staff_id')::uuid = s_sub.id or (b.metadata->>'stylist_id')::uuid = s_sub.id)
      and b.owner_id = v_owner_id
      and (b.booking_date)::date >= v_start_date
      and (b.booking_date)::date <= v_end_date
    where s_sub.owner_id = v_owner_id
    group by s_sub.id
  )
  select
    p.id as payout_id,
    s.id as staff_id,
    s.name::text as staff_name,
    coalesce(s.role, 'Service Provider')::text as staff_role,
    coalesce(s.avatar_url, '')::text as avatar_url,
    v_period as payout_period,
    coalesce(s.commission_rate, 0)::numeric as commission_rate,
    coalesce(s.commission_type, 'percentage')::text as commission_type,
    coalesce(s.commission_basis, 'net')::text as commission_basis,
    coalesce(s.fixed_commission_amount, 0)::numeric as fixed_commission_amount,
    coalesce(pb.b_completed_count, 0)::bigint as completed_bookings_count,
    coalesce(p.gross_sales, pb.b_gross_sales, 0.00)::numeric as gross_sales,
    coalesce(p.commission_earned, pb.b_calculated_commission, 0.00)::numeric as calculated_commission,
    coalesce(p.bonus_amount, 0.00)::numeric as bonus_amount,
    coalesce(p.deductions_amount, 0.00)::numeric as deductions_amount,
    coalesce(p.net_payout, pb.b_calculated_commission, 0.00)::numeric as net_payout,
    coalesce(p.status, 'Pending')::text as status,
    coalesce(p.payment_method, 'Bank Transfer')::text as payment_method,
    coalesce(p.payment_reference, '')::text as payment_reference,
    p.paid_at as paid_at,
    coalesce(p.notes, '')::text as notes
  from public.stylists s
  left join period_bookings pb on pb.b_staff_id = s.id
  left join public.staff_payouts p on p.staff_id = s.id and p.payout_period = v_period and p.owner_id = v_owner_id
  where s.owner_id = v_owner_id
  order by s.name asc;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC: owner_mark_payout_paid
-- Idempotent upsert to update or mark a staff payout as Paid.
-- ----------------------------------------------------------------------------
create or replace function public.owner_mark_payout_paid(
  p_staff_id uuid,
  p_payout_period text,
  p_gross_sales numeric default 0.00,
  p_commission_earned numeric default 0.00,
  p_bonus_amount numeric default 0.00,
  p_deductions_amount numeric default 0.00,
  p_net_payout numeric default 0.00,
  p_status text default 'Paid',
  p_payment_method text default 'Bank Transfer',
  p_payment_reference text default null,
  p_notes text default null
)
returns public.staff_payouts
language plpgsql
security definer
as $$
declare
  v_owner_id uuid;
  v_record public.staff_payouts;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  if p_staff_id is null or p_payout_period is null then
    raise exception 'Missing required staff_id or payout_period';
  end if;

  insert into public.staff_payouts (
    owner_id,
    staff_id,
    payout_period,
    gross_sales,
    commission_earned,
    bonus_amount,
    deductions_amount,
    net_payout,
    status,
    payment_method,
    payment_reference,
    paid_at,
    notes,
    updated_at
  )
  values (
    v_owner_id,
    p_staff_id,
    p_payout_period,
    coalesce(p_gross_sales, 0.00),
    coalesce(p_commission_earned, 0.00),
    coalesce(p_bonus_amount, 0.00),
    coalesce(p_deductions_amount, 0.00),
    coalesce(p_net_payout, (coalesce(p_commission_earned, 0.00) + coalesce(p_bonus_amount, 0.00) - coalesce(p_deductions_amount, 0.00))),
    coalesce(p_status, 'Paid'),
    coalesce(p_payment_method, 'Bank Transfer'),
    p_payment_reference,
    case when coalesce(p_status, 'Paid') = 'Paid' then now() else null end,
    p_notes,
    now()
  )
  on conflict (owner_id, staff_id, payout_period) do update set
    gross_sales = excluded.gross_sales,
    commission_earned = excluded.commission_earned,
    bonus_amount = excluded.bonus_amount,
    deductions_amount = excluded.deductions_amount,
    net_payout = excluded.net_payout,
    status = excluded.status,
    payment_method = excluded.payment_method,
    payment_reference = excluded.payment_reference,
    paid_at = case when excluded.status = 'Paid' then coalesce(staff_payouts.paid_at, now()) else null end,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_record;

  return v_record;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: owner_get_payout_history
-- Retrieves all historical payout records for staff under owner's account.
-- ----------------------------------------------------------------------------
create or replace function public.owner_get_payout_history(
  p_staff_id uuid default null
)
returns table (
  payout_id uuid,
  staff_id uuid,
  staff_name text,
  payout_period text,
  gross_sales numeric,
  commission_earned numeric,
  bonus_amount numeric,
  deductions_amount numeric,
  net_payout numeric,
  status text,
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
as $$
declare
  v_owner_id uuid;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  return query
  select
    p.id as payout_id,
    p.staff_id as staff_id,
    s.name::text as staff_name,
    p.payout_period::text as payout_period,
    p.gross_sales::numeric as gross_sales,
    p.commission_earned::numeric as commission_earned,
    p.bonus_amount::numeric as bonus_amount,
    p.deductions_amount::numeric as deductions_amount,
    p.net_payout::numeric as net_payout,
    p.status::text as status,
    p.payment_method::text as payment_method,
    p.payment_reference::text as payment_reference,
    p.paid_at as paid_at,
    coalesce(p.notes, '')::text as notes,
    p.created_at as created_at
  from public.staff_payouts p
  join public.stylists s on s.id = p.staff_id
  where p.owner_id = v_owner_id
    and (p_staff_id is null or p.staff_id = p_staff_id)
  order by p.payout_period desc, p.created_at desc;
end;
$$;
