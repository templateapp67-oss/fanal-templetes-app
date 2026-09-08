-- ============================================================================
-- Nexora Salon OS — Staff Performance Dashboard Backend
-- Migration: 20260908_staff_performance_dashboard.sql
-- ----------------------------------------------------------------------------
-- Idempotent PostgreSQL migration delivering comprehensive staff performance,
-- commission calculation, booking details, payment breakdown, review analytics,
-- and owner security for Nexora SalonOS owner portal.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions (Stylists & Bookings)
-- ----------------------------------------------------------------------------

-- Add staff commission configuration columns to public.stylists
alter table if exists public.stylists
  add column if not exists fixed_commission_amount numeric(12,2) default 0;

alter table if exists public.stylists
  add column if not exists commission_type text default 'percentage';

alter table if exists public.stylists
  add column if not exists commission_basis text default 'net';

alter table if exists public.stylists
  add column if not exists is_active boolean default true;

-- Add direct stylist reference to public.bookings if missing
alter table if exists public.bookings
  add column if not exists stylist_id uuid references public.stylists(id) on delete set null;

-- Safe performance indexes
create index if not exists idx_bookings_owner_stylist on public.bookings(owner_id, stylist_id);
create index if not exists idx_bookings_owner_date on public.bookings(owner_id, booking_date);
create index if not exists idx_appointments_owner_stylist on public.appointments(owner_id, stylist_id);
create index if not exists idx_stylists_owner_active on public.stylists(owner_id, is_active);

-- ----------------------------------------------------------------------------
-- 2. Reviews Unified View
-- ----------------------------------------------------------------------------
create or replace view public.reviews as
select
  b.id as id,
  b.owner_id as owner_id,
  b.user_id as user_id,
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

-- ----------------------------------------------------------------------------
-- 3. Server-side Commission Calculation Function
-- ----------------------------------------------------------------------------
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
      when p_type = 'fixed' then coalesce(p_fixed, 0)
      when p_type = 'both' then
        ((case when coalesce(p_basis, 'net') = 'gross' then coalesce(p_gross, 0) else greatest(coalesce(p_gross, 0) - coalesce(p_discount, 0), 0) end) * coalesce(p_rate, 0) / 100.0) + coalesce(p_fixed, 0)
      else -- 'percentage'
        ((case when coalesce(p_basis, 'net') = 'gross' then coalesce(p_gross, 0) else greatest(coalesce(p_gross, 0) - coalesce(p_discount, 0), 0) end) * coalesce(p_rate, 0) / 100.0)
    end, 2
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: owner_staff_performance_summary
-- ----------------------------------------------------------------------------
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
    raise exception 'Unauthorized: Owner session required';
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
    where st.owner_id = v_owner_id
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
    where b.owner_id = v_owner_id
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
    where a.owner_id = v_owner_id
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

-- ----------------------------------------------------------------------------
-- 5. RPC: owner_seven_day_leaderboard
-- ----------------------------------------------------------------------------
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
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception 'Unauthorized: Owner session required';
  end if;

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

-- ----------------------------------------------------------------------------
-- 6. RPC: owner_staff_booking_details
-- ----------------------------------------------------------------------------
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
    raise exception 'Unauthorized: Owner session required';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.stylists st where st.id = p_staff_id and st.owner_id = v_owner_id) then
      raise exception 'Forbidden: Staff member does not belong to your salon';
    end if;
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
  where b.owner_id = v_owner_id
    and (p_staff_id is null or st.id = p_staff_id)
    and (p_status is null or lower(b.status) = lower(p_status))
  order by b.booking_date desc, b.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC: owner_staff_payment_details
-- ----------------------------------------------------------------------------
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
    raise exception 'Unauthorized: Owner session required';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.stylists st where st.id = p_staff_id and st.owner_id = v_owner_id) then
      raise exception 'Forbidden: Staff member does not belong to your salon';
    end if;
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
  where b.owner_id = v_owner_id
    and (p_staff_id is null or st.id = p_staff_id)
  order by b.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. RPC: owner_staff_review_details
-- ----------------------------------------------------------------------------
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
    raise exception 'Unauthorized: Owner session required';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.stylists st where st.id = p_staff_id and st.owner_id = v_owner_id) then
      raise exception 'Forbidden: Staff member does not belong to your salon';
    end if;
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
  where r.owner_id = v_owner_id
    and (p_staff_id is null or r.stylist_id = p_staff_id)
  order by r.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. RPC: owner_update_staff_commission
-- ----------------------------------------------------------------------------
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
  if v_owner_id is null then
    raise exception 'Unauthorized: Owner session required';
  end if;

  if not exists (select 1 from public.stylists st where st.id = p_staff_id and st.owner_id = v_owner_id) then
    raise exception 'Forbidden: Target staff member does not belong to your salon';
  end if;

  update public.stylists
  set
    commission_rate = greatest(coalesce(p_commission_rate, 0), 0),
    fixed_commission_amount = greatest(coalesce(p_fixed_amount, 0), 0),
    commission_type = coalesce(p_commission_type, 'percentage'),
    commission_basis = coalesce(p_commission_basis, 'net'),
    updated_at = now()
  where id = p_staff_id
    and owner_id = v_owner_id;

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

-- ----------------------------------------------------------------------------
-- 10. RLS Verification & Grants
-- ----------------------------------------------------------------------------
alter table public.stylists enable row level security;
alter table public.bookings enable row level security;
alter table public.appointments enable row level security;

-- Execute grant access for RPCs to authenticated role
grant execute on function public.calculate_staff_booking_commission to authenticated, service_role;
grant execute on function public.owner_staff_performance_summary to authenticated, service_role;
grant execute on function public.owner_seven_day_leaderboard to authenticated, service_role;
grant execute on function public.owner_staff_booking_details to authenticated, service_role;
grant execute on function public.owner_staff_payment_details to authenticated, service_role;
grant execute on function public.owner_staff_review_details to authenticated, service_role;
grant execute on function public.owner_update_staff_commission to authenticated, service_role;
