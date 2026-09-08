-- ============================================================================
-- Nexora SalonOS — Complete Staff Performance Dashboard Backend
-- Migration File: 20260910_complete_staff_performance_backend.sql
-- ----------------------------------------------------------------------------
-- Comprehensive, 100% Idempotent Supabase PostgreSQL Script for:
--   1. Schema extensions & safety columns (stylists, bookings, appointments, payouts)
--   2. Multi-table schema compatibility mapping (stylists/team_members, bookings/appointments)
--   3. Review unified view & fallback review handling
--   4. Server-side commission calculation engine (percentage, fixed, hybrid, net/gross)
--   5. Core RPC: owner_staff_performance_summary
--   6. Core RPC: owner_seven_day_leaderboard
--   7. Core RPC: owner_staff_booking_details
--   8. Core RPC: owner_staff_payment_details
--   9. Core RPC: owner_staff_review_details
--  10. Core RPC: owner_update_staff_commission
--  11. Core RPC: owner_get_monthly_payroll
--  12. Core RPC: owner_mark_payout_paid
--  13. Core RPC: owner_get_payout_history
--  14. Row Level Security (RLS) & Grant Permissions
-- ============================================================================

-- Ensure required PostgreSQL extensions exist
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ============================================================================
-- SECTION 1: SAFE SCHEMA EXTENSIONS (STYLISTS / STAFF TABLE)
-- ============================================================================

-- Ensure public.stylists exists or create minimal table if absent
create table if not exists public.stylists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  role text default 'Stylist',
  avatar_url text,
  status text default 'Active',
  commission_rate numeric(5,2) default 15.00,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Safely add missing columns to public.stylists
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stylists' and column_name = 'fixed_commission_amount') then
    alter table public.stylists add column fixed_commission_amount numeric(12,2) default 0.00;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stylists' and column_name = 'commission_type') then
    alter table public.stylists add column commission_type text default 'percentage';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stylists' and column_name = 'commission_basis') then
    alter table public.stylists add column commission_basis text default 'net';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stylists' and column_name = 'is_active') then
    alter table public.stylists add column is_active boolean default true;
  end if;
end $$;

-- Compatibility alias view for team_members if referenced
create or replace view public.team_members as
select
  s.id,
  s.owner_id,
  s.name,
  s.role,
  s.avatar_url,
  s.status,
  s.is_active,
  s.commission_rate,
  s.fixed_commission_amount,
  s.commission_type,
  s.commission_basis,
  s.created_at,
  s.updated_at
from public.stylists s;

-- ============================================================================
-- SECTION 2: SAFE SCHEMA EXTENSIONS (BOOKINGS & APPOINTMENTS)
-- ============================================================================

-- Ensure public.bookings exists or create minimal table if absent
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  service_name text,
  total_amount numeric(12,2) default 0.00,
  advance_paid_amount numeric(12,2) default 0.00,
  status text default 'pending',
  payment_status text default 'pending',
  booking_date date default current_date,
  time_slot text,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Safely add stylist_id reference to public.bookings
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'stylist_id') then
    alter table public.bookings add column stylist_id uuid references public.stylists(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'payment_id') then
    alter table public.bookings add column payment_id text;
  end if;
end $$;

-- Ensure public.appointments exists for legacy/hybrid support
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  stylist_id uuid references public.stylists(id) on delete set null,
  stylist_name text,
  customer_name text,
  service_name text,
  service_price numeric(12,2) default 0.00,
  amount_paid numeric(12,2) default 0.00,
  status text default 'pending',
  date date default current_date,
  created_at timestamptz default now()
);

-- Safe indexes for rapid querying
create index if not exists idx_bookings_owner_stylist on public.bookings(owner_id, stylist_id);
create index if not exists idx_bookings_owner_date on public.bookings(owner_id, booking_date);
create index if not exists idx_appointments_owner_stylist on public.appointments(owner_id, stylist_id);
create index if not exists idx_stylists_owner_active on public.stylists(owner_id, is_active);

-- ============================================================================
-- SECTION 3: STAFF PAYOUTS TABLE
-- ============================================================================

create table if not exists public.staff_payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  staff_id uuid not null references public.stylists(id) on delete cascade,
  payout_period varchar(7) not null, -- Format 'YYYY-MM'
  gross_sales numeric(12,2) not null default 0.00,
  commission_earned numeric(12,2) not null default 0.00,
  bonus_amount numeric(12,2) not null default 0.00,
  deductions_amount numeric(12,2) not null default 0.00,
  net_payout numeric(12,2) not null default 0.00,
  status varchar(20) not null default 'Pending',
  payment_method varchar(50) default 'Bank Transfer',
  payment_reference varchar(100),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_staff_payout_owner_period unique(owner_id, staff_id, payout_period)
);

create index if not exists idx_staff_payouts_owner_period on public.staff_payouts(owner_id, payout_period);
create index if not exists idx_staff_payouts_staff_period on public.staff_payouts(staff_id, payout_period);

-- ============================================================================
-- SECTION 4: UNIFIED REVIEWS VIEW
-- ============================================================================

create or replace view public.reviews as
select
  b.id as id,
  b.owner_id as owner_id,
  null::uuid as user_id,
  b.id as booking_id,
  coalesce(
    b.stylist_id,
    nullif(b.metadata->>'stylist_id','')::uuid,
    nullif(b.metadata->>'staff_id','')::uuid
  ) as stylist_id,
  coalesce(
    b.metadata->>'stylist_name',
    b.metadata->>'staff_name',
    ''
  ) as stylist_name,
  b.customer_name as customer_name,
  b.service_name as service_name,
  (b.metadata->>'review_rating')::numeric as rating,
  coalesce(b.metadata->>'review_text', b.notes, '') as comment,
  coalesce(
    nullif(b.metadata->>'reviewed_at','')::timestamptz,
    b.updated_at,
    b.created_at
  ) as created_at
from public.bookings b
where b.metadata->>'review_rating' is not null;

-- ============================================================================
-- SECTION 5: COMMISSION CALCULATOR IMMUTABLE FUNCTION
-- ============================================================================

create or replace function public.calculate_staff_booking_commission(
  p_gross numeric,
  p_discount numeric,
  p_rate numeric,
  p_fixed numeric,
  p_type text,
  p_basis text
)
returns numeric
language sql immutable
as $$
  select round(
    case
      when coalesce(p_type, 'percentage') = 'fixed' then coalesce(p_fixed, 0)
      when coalesce(p_type, 'percentage') = 'both' then
        ((case when coalesce(p_basis, 'net') = 'gross' then coalesce(p_gross, 0) else greatest(coalesce(p_gross, 0) - coalesce(p_discount, 0), 0) end) * coalesce(p_rate, 0) / 100.0) + coalesce(p_fixed, 0)
      else -- 'percentage'
        ((case when coalesce(p_basis, 'net') = 'gross' then coalesce(p_gross, 0) else greatest(coalesce(p_gross, 0) - coalesce(p_discount, 0), 0) end) * coalesce(p_rate, 0) / 100.0)
    end, 2
  );
$$;

-- ============================================================================
-- SECTION 6: RPC — owner_staff_performance_summary
-- ============================================================================

create or replace function public.owner_staff_performance_summary(
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  staff_id uuid,
  staff_name text,
  staff_role text,
  avatar_url text,
  status text,
  is_active boolean,
  commission_rate numeric,
  fixed_commission_amount numeric,
  commission_type text,
  commission_basis text,
  total_bookings bigint,
  confirmed_bookings bigint,
  pending_bookings bigint,
  completed_bookings bigint,
  cancelled_bookings bigint,
  total_gross_amount numeric,
  total_paid_amount numeric,
  total_discount_amount numeric,
  net_revenue numeric,
  commission_amount numeric,
  owner_share_amount numeric,
  total_reviews bigint,
  average_rating numeric,
  five_star_count bigint,
  four_star_count bigint,
  three_star_count bigint,
  two_star_count bigint,
  one_star_count bigint,
  last_7d_completed_bookings bigint,
  last_7d_revenue numeric,
  last_7d_commission numeric,
  last_7d_discount numeric,
  last_7d_reviews bigint,
  last_7d_average_rating numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  return query
  with owner_staff as (
    select
      st.id as s_id,
      st.name as s_name,
      st.role as s_role,
      st.avatar_url as s_avatar,
      st.status as s_status,
      coalesce(st.is_active, true) as s_is_active,
      coalesce(st.commission_rate, 0) as s_comm_rate,
      coalesce(st.fixed_commission_amount, 0) as s_fixed_comm,
      coalesce(st.commission_type, 'percentage') as s_comm_type,
      coalesce(st.commission_basis, 'net') as s_comm_basis
    from public.stylists st
    where st.owner_id = v_owner_id or v_owner_id is null
  ),
  unified_bookings as (
    select
      b.id as booking_id,
      b.owner_id,
      coalesce(
        b.stylist_id,
        nullif(b.metadata->>'stylist_id','')::uuid,
        nullif(b.metadata->>'staff_id','')::uuid,
        st.s_id
      ) as matched_staff_id,
      coalesce(b.booking_date, b.created_at::date) as b_date,
      lower(coalesce(b.status, 'pending')) as b_status,
      coalesce(b.total_amount, 0) as gross_amt,
      coalesce(b.advance_paid_amount, 0) as paid_amt,
      coalesce(
        nullif(b.metadata->>'discount_amount','')::numeric,
        nullif(b.metadata->'discount'->>'amount','')::numeric,
        0
      ) as discount_amt,
      nullif(b.metadata->>'review_rating','')::numeric as review_rating,
      coalesce(nullif(b.metadata->>'reviewed_at','')::timestamptz, b.updated_at, b.created_at) as reviewed_at
    from public.bookings b
    left join owner_staff st
      on (
        lower(st.s_name) = lower(b.metadata->>'stylist_name')
        or lower(st.s_name) = lower(b.metadata->>'staff_name')
      )
    where (b.owner_id = v_owner_id or v_owner_id is null)
      and (p_start_date is null or coalesce(b.booking_date, b.created_at::date) >= p_start_date)
      and (p_end_date is null or coalesce(b.booking_date, b.created_at::date) <= p_end_date)

    union all

    select
      a.id as booking_id,
      a.owner_id,
      coalesce(
        a.stylist_id,
        st.s_id
      ) as matched_staff_id,
      coalesce(a.date, a.created_at::date) as b_date,
      lower(coalesce(a.status, 'pending')) as b_status,
      coalesce(a.service_price, 0) as gross_amt,
      coalesce(a.amount_paid, 0) as paid_amt,
      0 as discount_amt,
      null::numeric as review_rating,
      a.created_at as reviewed_at
    from public.appointments a
    left join owner_staff st
      on lower(st.s_name) = lower(a.stylist_name)
    where (a.owner_id = v_owner_id or v_owner_id is null)
      and not exists (select 1 from public.bookings b2 where b2.id = a.id)
      and (p_start_date is null or coalesce(a.date, a.created_at::date) >= p_start_date)
      and (p_end_date is null or coalesce(a.date, a.created_at::date) <= p_end_date)
  ),
  aggregated as (
    select
      st.s_id,
      st.s_name,
      st.s_role,
      st.s_avatar,
      st.s_status,
      st.s_is_active,
      st.s_comm_rate,
      st.s_fixed_comm,
      st.s_comm_type,
      st.s_comm_basis,

      count(ub.booking_id) as total_bookings,
      count(ub.booking_id) filter (where ub.b_status = 'confirmed') as confirmed_bookings,
      count(ub.booking_id) filter (where ub.b_status = 'pending') as pending_bookings,
      count(ub.booking_id) filter (where ub.b_status = 'completed') as completed_bookings,
      count(ub.booking_id) filter (where ub.b_status in ('cancelled', 'no_show')) as cancelled_bookings,

      coalesce(sum(ub.gross_amt), 0) as total_gross_amount,
      coalesce(sum(ub.paid_amt), 0) as total_paid_amount,
      coalesce(sum(ub.discount_amt), 0) as total_discount_amount,
      coalesce(sum(greatest(ub.gross_amt - ub.discount_amt, 0)), 0) as net_revenue,

      coalesce(sum(
        case when ub.b_status = 'completed' then
          public.calculate_staff_booking_commission(ub.gross_amt, ub.discount_amt, st.s_comm_rate, st.s_fixed_comm, st.s_comm_type, st.s_comm_basis)
        else 0 end
      ), 0) as commission_amount,

      count(ub.review_rating) as total_reviews,
      coalesce(round(avg(ub.review_rating), 2), 0) as average_rating,
      count(ub.review_rating) filter (where ub.review_rating >= 5) as five_star_count,
      count(ub.review_rating) filter (where ub.review_rating >= 4 and ub.review_rating < 5) as four_star_count,
      count(ub.review_rating) filter (where ub.review_rating >= 3 and ub.review_rating < 4) as three_star_count,
      count(ub.review_rating) filter (where ub.review_rating >= 2 and ub.review_rating < 3) as two_star_count,
      count(ub.review_rating) filter (where ub.review_rating >= 1 and ub.review_rating < 2) as one_star_count,

      count(ub.booking_id) filter (where ub.b_status = 'completed' and ub.b_date >= (current_date - 7)) as last_7d_completed_bookings,
      coalesce(sum(greatest(ub.gross_amt - ub.discount_amt, 0)) filter (where ub.b_status = 'completed' and ub.b_date >= (current_date - 7)), 0) as last_7d_revenue,
      coalesce(sum(
        case when ub.b_status = 'completed' and ub.b_date >= (current_date - 7) then
          public.calculate_staff_booking_commission(ub.gross_amt, ub.discount_amt, st.s_comm_rate, st.s_fixed_comm, st.s_comm_type, st.s_comm_basis)
        else 0 end
      ), 0) as last_7d_commission,
      coalesce(sum(ub.discount_amt) filter (where ub.b_status = 'completed' and ub.b_date >= (current_date - 7)), 0) as last_7d_discount,
      count(ub.review_rating) filter (where ub.reviewed_at >= (now() - interval '7 days')) as last_7d_reviews,
      coalesce(round(avg(ub.review_rating) filter (where ub.reviewed_at >= (now() - interval '7 days')), 2), 0) as last_7d_average_rating

    from owner_staff st
    left join unified_bookings ub on ub.matched_staff_id = st.s_id
    group by
      st.s_id, st.s_name, st.s_role, st.s_avatar, st.s_status, st.s_is_active,
      st.s_comm_rate, st.s_fixed_comm, st.s_comm_type, st.s_comm_basis
  )
  select
    agg.s_id as staff_id,
    agg.s_name as staff_name,
    agg.s_role as staff_role,
    agg.s_avatar as avatar_url,
    agg.s_status as status,
    agg.s_is_active as is_active,
    agg.s_comm_rate as commission_rate,
    agg.s_fixed_comm as fixed_commission_amount,
    agg.s_comm_type as commission_type,
    agg.s_comm_basis as commission_basis,
    agg.total_bookings,
    agg.confirmed_bookings,
    agg.pending_bookings,
    agg.completed_bookings,
    agg.cancelled_bookings,
    agg.total_gross_amount,
    agg.total_paid_amount,
    agg.total_discount_amount,
    agg.net_revenue,
    agg.commission_amount,
    greatest(agg.net_revenue - agg.commission_amount, 0) as owner_share_amount,
    agg.total_reviews,
    agg.average_rating,
    agg.five_star_count,
    agg.four_star_count,
    agg.three_star_count,
    agg.two_star_count,
    agg.one_star_count,
    agg.last_7d_completed_bookings,
    agg.last_7d_revenue,
    agg.last_7d_commission,
    agg.last_7d_discount,
    agg.last_7d_reviews,
    agg.last_7d_average_rating
  from aggregated agg
  order by agg.net_revenue desc, agg.completed_bookings desc;
end;
$$;

-- ============================================================================
-- SECTION 7: RPC — owner_seven_day_leaderboard
-- ============================================================================

create or replace function public.owner_seven_day_leaderboard()
returns table (
  leaderboard_rank integer,
  staff_id uuid,
  staff_name text,
  staff_role text,
  avatar_url text,
  completed_bookings_7d bigint,
  gross_revenue_7d numeric,
  net_revenue_7d numeric,
  commission_generated_7d numeric,
  reviews_count_7d bigint,
  average_rating_7d numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with summary as (
    select * from public.owner_staff_performance_summary(current_date - 7, current_date)
  )
  select
    row_number() over (order by s.last_7d_revenue desc, s.last_7d_completed_bookings desc)::integer as leaderboard_rank,
    s.staff_id,
    s.staff_name,
    s.staff_role,
    s.avatar_url,
    s.last_7d_completed_bookings as completed_bookings_7d,
    s.total_gross_amount as gross_revenue_7d,
    s.last_7d_revenue as net_revenue_7d,
    s.last_7d_commission as commission_generated_7d,
    s.last_7d_reviews as reviews_count_7d,
    s.last_7d_average_rating as average_rating_7d
  from summary s
  order by s.last_7d_revenue desc, s.last_7d_completed_bookings desc;
end;
$$;

-- ============================================================================
-- SECTION 8: RPC — owner_staff_booking_details
-- ============================================================================

create or replace function public.owner_staff_booking_details(
  p_staff_id uuid default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  booking_id uuid,
  staff_id uuid,
  staff_name text,
  customer_name text,
  customer_phone text,
  customer_email text,
  service_name text,
  booking_date date,
  time_slot text,
  status text,
  payment_status text,
  gross_amount numeric,
  advance_paid numeric,
  discount_amount numeric,
  net_revenue numeric,
  commission_rate numeric,
  commission_amount numeric,
  owner_share numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  return query
  select
    b.id as booking_id,
    st.id as staff_id,
    coalesce(st.name, b.metadata->>'stylist_name', b.metadata->>'staff_name', 'Unassigned') as staff_name,
    b.customer_name,
    coalesce(b.customer_phone, '') as customer_phone,
    coalesce(b.customer_email, '') as customer_email,
    coalesce(b.service_name, 'Salon Service') as service_name,
    coalesce(b.booking_date, b.created_at::date) as booking_date,
    coalesce(b.time_slot, 'Scheduled') as time_slot,
    lower(coalesce(b.status, 'pending')) as status,
    lower(coalesce(b.payment_status, 'pending')) as payment_status,
    coalesce(b.total_amount, 0) as gross_amount,
    coalesce(b.advance_paid_amount, 0) as advance_paid,
    coalesce(
      nullif(b.metadata->>'discount_amount','')::numeric,
      nullif(b.metadata->'discount'->>'amount','')::numeric,
      0
    ) as discount_amount,
    greatest(coalesce(b.total_amount, 0) - coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0), 0) as net_revenue,
    coalesce(st.commission_rate, 0) as commission_rate,
    case when lower(coalesce(b.status, '')) = 'completed' then
      public.calculate_staff_booking_commission(
        coalesce(b.total_amount, 0),
        coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0),
        coalesce(st.commission_rate, 0),
        coalesce(st.fixed_commission_amount, 0),
        coalesce(st.commission_type, 'percentage'),
        coalesce(st.commission_basis, 'net')
      )
    else 0 end as commission_amount,
    case when lower(coalesce(b.status, '')) = 'completed' then
      greatest(
        greatest(coalesce(b.total_amount, 0) - coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0), 0) -
        public.calculate_staff_booking_commission(
          coalesce(b.total_amount, 0),
          coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0),
          coalesce(st.commission_rate, 0),
          coalesce(st.fixed_commission_amount, 0),
          coalesce(st.commission_type, 'percentage'),
          coalesce(st.commission_basis, 'net')
        ), 0
      )
    else greatest(coalesce(b.total_amount, 0) - coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0), 0)
    end as owner_share,
    b.created_at
  from public.bookings b
  left join public.stylists st
    on st.owner_id = b.owner_id
   and (
     b.stylist_id = st.id
     or nullif(b.metadata->>'stylist_id','')::uuid = st.id
     or nullif(b.metadata->>'staff_id','')::uuid = st.id
     or lower(st.name) = lower(b.metadata->>'stylist_name')
     or lower(st.name) = lower(b.metadata->>'staff_name')
   )
  where (b.owner_id = v_owner_id or v_owner_id is null)
    and (p_staff_id is null or st.id = p_staff_id)
    and (p_status is null or lower(b.status) = lower(p_status))
  order by b.booking_date desc, b.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

-- ============================================================================
-- SECTION 9: RPC — owner_staff_payment_details
-- ============================================================================

create or replace function public.owner_staff_payment_details(
  p_staff_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  payment_id text,
  booking_id uuid,
  staff_id uuid,
  staff_name text,
  customer_name text,
  booking_date date,
  service_name text,
  gross_amount numeric,
  advance_paid numeric,
  discount_amount numeric,
  net_revenue numeric,
  payment_status text,
  commission_amount numeric,
  owner_share numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  return query
  select
    coalesce(b.payment_id, b.id::text) as payment_id,
    b.id as booking_id,
    st.id as staff_id,
    coalesce(st.name, b.metadata->>'stylist_name', 'Unassigned') as staff_name,
    b.customer_name,
    coalesce(b.booking_date, b.created_at::date) as booking_date,
    coalesce(b.service_name, 'Salon Service') as service_name,
    coalesce(b.total_amount, 0) as gross_amount,
    coalesce(b.advance_paid_amount, 0) as advance_paid,
    coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0) as discount_amount,
    greatest(coalesce(b.total_amount, 0) - coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0), 0) as net_revenue,
    lower(coalesce(b.payment_status, 'pending')) as payment_status,
    case when lower(coalesce(b.status, '')) = 'completed' then
      public.calculate_staff_booking_commission(
        coalesce(b.total_amount, 0),
        coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0),
        coalesce(st.commission_rate, 0),
        coalesce(st.fixed_commission_amount, 0),
        coalesce(st.commission_type, 'percentage'),
        coalesce(st.commission_basis, 'net')
      )
    else 0 end as commission_amount,
    case when lower(coalesce(b.status, '')) = 'completed' then
      greatest(
        greatest(coalesce(b.total_amount, 0) - coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0), 0) -
        public.calculate_staff_booking_commission(
          coalesce(b.total_amount, 0),
          coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0),
          coalesce(st.commission_rate, 0),
          coalesce(st.fixed_commission_amount, 0),
          coalesce(st.commission_type, 'percentage'),
          coalesce(st.commission_basis, 'net')
        ), 0
      )
    else greatest(coalesce(b.total_amount, 0) - coalesce(nullif(b.metadata->>'discount_amount','')::numeric, 0), 0)
    end as owner_share,
    b.created_at
  from public.bookings b
  left join public.stylists st
    on st.owner_id = b.owner_id
   and (
     b.stylist_id = st.id
     or nullif(b.metadata->>'stylist_id','')::uuid = st.id
     or nullif(b.metadata->>'staff_id','')::uuid = st.id
     or lower(st.name) = lower(b.metadata->>'stylist_name')
     or lower(st.name) = lower(b.metadata->>'staff_name')
   )
  where (b.owner_id = v_owner_id or v_owner_id is null)
    and (p_staff_id is null or st.id = p_staff_id)
  order by b.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

-- ============================================================================
-- SECTION 10: RPC — owner_staff_review_details
-- ============================================================================

create or replace function public.owner_staff_review_details(
  p_staff_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  review_id uuid,
  booking_id uuid,
  staff_id uuid,
  staff_name text,
  customer_name text,
  service_name text,
  rating numeric,
  comment text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    select id into v_owner_id from public.profiles limit 1;
  end if;

  return query
  select
    r.id as review_id,
    r.booking_id,
    r.stylist_id,
    r.stylist_name,
    r.customer_name,
    r.service_name,
    r.rating,
    r.comment,
    r.created_at as reviewed_at
  from public.reviews r
  where (r.owner_id = v_owner_id or v_owner_id is null)
    and (p_staff_id is null or r.stylist_id = p_staff_id)
  order by r.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

-- ============================================================================
-- SECTION 11: RPC — owner_update_staff_commission
-- ============================================================================

create or replace function public.owner_update_staff_commission(
  p_staff_id uuid,
  p_commission_rate numeric,
  p_fixed_amount numeric default 0,
  p_commission_type text default 'percentage',
  p_commission_basis text default 'net'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  update public.stylists
  set
    commission_rate = greatest(coalesce(p_commission_rate, 0), 0),
    fixed_commission_amount = greatest(coalesce(p_fixed_amount, 0), 0),
    commission_type = coalesce(p_commission_type, 'percentage'),
    commission_basis = coalesce(p_commission_basis, 'net'),
    updated_at = now()
  where id = p_staff_id;

  return jsonb_build_object(
    'success', true,
    'staff_id', p_staff_id,
    'commission_rate', p_commission_rate,
    'fixed_commission_amount', p_fixed_amount,
    'commission_type', p_commission_type,
    'commission_basis', p_commission_basis
  );
end;
$$;

-- ============================================================================
-- SECTION 12: RPC — owner_get_monthly_payroll
-- ============================================================================

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
      coalesce(sum((b.total_amount)::numeric) filter (where b.status = 'completed'), 0.00) as b_gross_sales,
      coalesce(
        sum(
          public.calculate_staff_booking_commission(
            (b.total_amount)::numeric,
            coalesce((b.metadata->>'discount_amount')::numeric, 0),
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
      and (b.owner_id = v_owner_id or v_owner_id is null)
      and (b.booking_date)::date >= v_start_date
      and (b.booking_date)::date <= v_end_date
    where s_sub.owner_id = v_owner_id or v_owner_id is null
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
  left join public.staff_payouts p on p.staff_id = s.id and p.payout_period = v_period and (p.owner_id = v_owner_id or v_owner_id is null)
  where s.owner_id = v_owner_id or v_owner_id is null
  order by s.name asc;
end;
$$;

-- ============================================================================
-- SECTION 13: RPC — owner_mark_payout_paid
-- ============================================================================

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

-- ============================================================================
-- SECTION 14: RPC — owner_get_payout_history
-- ============================================================================

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
  where (p.owner_id = v_owner_id or v_owner_id is null)
    and (p_staff_id is null or p.staff_id = p_staff_id)
  order by p.payout_period desc, p.created_at desc;
end;
$$;

-- ============================================================================
-- SECTION 15: RLS POLICIES & PERMISSIONS
-- ============================================================================

alter table public.stylists enable row level security;
alter table public.bookings enable row level security;
alter table public.appointments enable row level security;
alter table public.staff_payouts enable row level security;

-- Owner Payouts RLS Policy
drop policy if exists owner_payouts_all on public.staff_payouts;
create policy owner_payouts_all on public.staff_payouts
  for all using (
    owner_id = auth.uid() or
    auth.uid() is null
  ) with check (
    owner_id = auth.uid() or
    auth.uid() is null
  );

-- Grants
grant execute on function public.calculate_staff_booking_commission to authenticated, service_role, anon;
grant execute on function public.owner_staff_performance_summary to authenticated, service_role, anon;
grant execute on function public.owner_seven_day_leaderboard to authenticated, service_role, anon;
grant execute on function public.owner_staff_booking_details to authenticated, service_role, anon;
grant execute on function public.owner_staff_payment_details to authenticated, service_role, anon;
grant execute on function public.owner_staff_review_details to authenticated, service_role, anon;
grant execute on function public.owner_update_staff_commission to authenticated, service_role, anon;
grant execute on function public.owner_get_monthly_payroll to authenticated, service_role, anon;
grant execute on function public.owner_mark_payout_paid to authenticated, service_role, anon;
grant execute on function public.owner_get_payout_history to authenticated, service_role, anon;
