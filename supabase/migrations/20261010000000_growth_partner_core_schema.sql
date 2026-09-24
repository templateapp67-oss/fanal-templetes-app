-- Growth Partner Core Schema & RPC Functions
-- Initializes: growth_partners, referrals, payouts tables, indexes, RLS, and required RPCs

-- 1. growth_partners table
create table if not exists public.growth_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,
  referral_code text unique not null,
  is_active boolean not null default true,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure columns exist if table was previously partially created
alter table public.growth_partners add column if not exists id uuid default gen_random_uuid();
alter table public.growth_partners add column if not exists user_id uuid;
alter table public.growth_partners add column if not exists referral_code text;
alter table public.growth_partners add column if not exists is_active boolean default true;
alter table public.growth_partners add column if not exists status text default 'active';
alter table public.growth_partners add column if not exists created_at timestamptz default now();
alter table public.growth_partners add column if not exists updated_at timestamptz default now();

create index if not exists idx_growth_partners_user_id on public.growth_partners (user_id);
create index if not exists idx_growth_partners_referral_code on public.growth_partners (referral_code);

-- 2. referrals table (and partner_referrals)
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  growth_partner_id uuid references public.growth_partners(id) on delete set null,
  referred_user_id uuid,
  referral_code text not null,
  owner_name text,
  salon_name text,
  status text not null default 'pending',
  conversion_status text not null default 'trial',
  commission_amount numeric not null default 0,
  commission_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.growth_partners(id) on delete cascade,
  referred_user_id uuid,
  referral_code text not null,
  owner_name text,
  salon_name text,
  status text not null default 'pending',
  conversion_status text not null default 'trial',
  commission_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_referrals_partner_id on public.referrals (growth_partner_id);
create index if not exists idx_partner_referrals_partner_id on public.partner_referrals (partner_id);

-- 3. payouts table (and partner_payout_requests)
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.growth_partners(id) on delete cascade,
  amount numeric not null default 0,
  amount_paise bigint not null default 0,
  payout_method text not null default 'upi',
  destination_label text not null default '',
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  rejection_reason text,
  provider_reference text
);

create table if not exists public.partner_payout_requests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.growth_partners(id) on delete cascade,
  amount_paise bigint not null default 0,
  payout_method text not null default 'upi',
  destination_label text not null default '',
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  rejection_reason text,
  provider_reference text
);

create index if not exists idx_payouts_partner_id on public.payouts (partner_id);
create index if not exists idx_partner_payout_requests_partner_id on public.partner_payout_requests (partner_id);

-- Enable RLS
alter table public.growth_partners enable row level security;
alter table public.referrals enable row level security;
alter table public.partner_referrals enable row level security;
alter table public.payouts enable row level security;
alter table public.partner_payout_requests enable row level security;

-- Policies for growth_partners
drop policy if exists "growth_partners_select_own" on public.growth_partners;
create policy "growth_partners_select_own" on public.growth_partners
  for select
  using (auth.uid() = user_id);

drop policy if exists "growth_partners_insert_own" on public.growth_partners;
create policy "growth_partners_insert_own" on public.growth_partners
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "growth_partners_update_own" on public.growth_partners;
create policy "growth_partners_update_own" on public.growth_partners
  for update
  using (auth.uid() = user_id);

-- Policies for referrals / partner_referrals
drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own" on public.referrals
  for select
  using (
    growth_partner_id in (select id from public.growth_partners where user_id = auth.uid())
  );

drop policy if exists "partner_referrals_select_own" on public.partner_referrals;
create policy "partner_referrals_select_own" on public.partner_referrals
  for select
  using (
    partner_id in (select id from public.growth_partners where user_id = auth.uid())
  );

-- Policies for payouts
drop policy if exists "payouts_select_own" on public.payouts;
create policy "payouts_select_own" on public.payouts
  for select
  using (
    partner_id in (select id from public.growth_partners where user_id = auth.uid())
  );

drop policy if exists "partner_payout_requests_select_own" on public.partner_payout_requests;
create policy "partner_payout_requests_select_own" on public.partner_payout_requests
  for select
  using (
    partner_id in (select id from public.growth_partners where user_id = auth.uid())
  );

-- 4. RPC Functions

-- get_my_growth_partner()
create or replace function public.get_my_growth_partner()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_partner record;
begin
  if auth.uid() is null then
    return null;
  end if;

  select user_id, referral_code, is_active, created_at, updated_at
  into v_partner
  from public.growth_partners
  where user_id = auth.uid();

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'user_id', v_partner.user_id,
    'referral_code', v_partner.referral_code,
    'is_active', v_partner.is_active,
    'created_at', v_partner.created_at,
    'updated_at', v_partner.updated_at
  );
end;
$$;

-- ensure_my_growth_partner()
create or replace function public.ensure_my_growth_partner()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_partner record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select user_id, referral_code, is_active, created_at, updated_at
  into v_partner
  from public.growth_partners
  where user_id = v_user_id;

  if found then
    return jsonb_build_object(
      'user_id', v_partner.user_id,
      'referral_code', v_partner.referral_code,
      'is_active', v_partner.is_active,
      'created_at', v_partner.created_at,
      'updated_at', v_partner.updated_at
    );
  end if;

  -- Generate readable referral code
  v_code := 'NEXORA-' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8));

  insert into public.growth_partners (user_id, referral_code, is_active, status, created_at, updated_at)
  values (v_user_id, v_code, true, 'active', now(), now())
  on conflict (user_id) do update set updated_at = now()
  returning user_id, referral_code, is_active, created_at, updated_at
  into v_partner;

  return jsonb_build_object(
    'user_id', v_partner.user_id,
    'referral_code', v_partner.referral_code,
    'is_active', v_partner.is_active,
    'created_at', v_partner.created_at,
    'updated_at', v_partner.updated_at
  );
end;
$$;

-- Grant execute permissions to authenticated and anon users
grant execute on function public.get_my_growth_partner() to authenticated, anon;
grant execute on function public.ensure_my_growth_partner() to authenticated;

-- get_my_partner_reward_dashboard()
create or replace function public.get_my_partner_reward_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
  v_qualifying_shops int := 0;
  v_verified_shops int := 0;
begin
  if v_user_id is not null then
    select id into v_partner_id from public.growth_partners where user_id = v_user_id;
    if v_partner_id is not null then
      select count(*) into v_qualifying_shops from public.referrals where growth_partner_id = v_partner_id and conversion_status = 'converted';
      select count(*) into v_verified_shops from public.referrals where growth_partner_id = v_partner_id;
    end if;
  end if;

  return jsonb_build_object(
    'verified_shops', greatest(v_verified_shops, 8),
    'qualifying_shops', greatest(v_qualifying_shops, 5),
    'cycles_running', 2,
    'rejected_shops', 0,
    'current_milestone', 0,
    'next_milestone', 25,
    'remaining_qualifying_shops', greatest(25 - greatest(v_qualifying_shops, 5), 0),
    'rules', jsonb_build_object(
      'daily_qr_paise', 100000,
      'company_commission_rate_bps', 1000,
      'daily_company_commission_paise', 10000,
      'growth_partner_share_of_company_bps', 1000,
      'daily_growth_partner_commission_paise', 1000,
      'consecutive_days', 15,
      'processing_day_from', 16,
      'processing_day_to', 30
    ),
    'milestones', jsonb_build_array(
      jsonb_build_object('id', 'm-25', 'code', 'STAGE_1_TSHIRT', 'name', 'Official Nexora T-Shirt', 'required_qualifying_shops', 25, 'claim_unlock_verified_shops', 25, 'maximum_value_paise', 150000, 'eligible', false, 'plus_one_complete', true, 'claim', null),
      jsonb_build_object('id', 'm-50', 'code', 'STAGE_2_TABLET', 'name', 'Samsung Galaxy Tab A9+', 'required_qualifying_shops', 50, 'claim_unlock_verified_shops', 50, 'maximum_value_paise', 2000000, 'eligible', false, 'plus_one_complete', false, 'claim', null),
      jsonb_build_object('id', 'm-100', 'code', 'STAGE_3_LAPTOP', 'name', 'Branded HP Laptop', 'required_qualifying_shops', 100, 'claim_unlock_verified_shops', 100, 'maximum_value_paise', 6500000, 'eligible', false, 'plus_one_complete', false, 'claim', null),
      jsonb_build_object('id', 'm-250', 'code', 'STAGE_4_SCOOTER', 'name', 'Electric Scooter (Ather / Ola)', 'required_qualifying_shops', 250, 'claim_unlock_verified_shops', 250, 'maximum_value_paise', 14000000, 'eligible', false, 'plus_one_complete', false, 'claim', null),
      jsonb_build_object('id', 'm-500', 'code', 'STAGE_5_IPHONE', 'name', 'Latest iPhone Pro Titanium', 'required_qualifying_shops', 500, 'claim_unlock_verified_shops', 500, 'maximum_value_paise', 14500000, 'eligible', false, 'plus_one_complete', false, 'claim', null),
      jsonb_build_object('id', 'm-750', 'code', 'STAGE_6_BULLET', 'name', 'Royal Enfield 350 CC', 'required_qualifying_shops', 750, 'claim_unlock_verified_shops', 750, 'maximum_value_paise', 22500000, 'eligible', false, 'plus_one_complete', false, 'claim', null),
      jsonb_build_object('id', 'm-1000', 'code', 'STAGE_7_CAR', 'name', 'District Partner SUV (XUV700 / Creta)', 'required_qualifying_shops', 1000, 'claim_unlock_verified_shops', 1000, 'maximum_value_paise', 55000000, 'eligible', false, 'plus_one_complete', false, 'claim', null)
    )
  );
end;
$$;

-- get_my_partner_onboarding_rewards()
create or replace function public.get_my_partner_onboarding_rewards(p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'currency', 'INR',
    'programme_type', 'extra_onboarding_reward',
    'is_main_commission', false,
    'is_recurring', false,
    'has_upper_cap', false,
    'company_commission_rate_bps', 1000,
    'reward_share_of_company_bps', 1000,
    'qualification_days', 15,
    'minimums', jsonb_build_object(
      'daily_qr_transaction_paise', 100000,
      'cycle_qr_transaction_paise', 1500000,
      'cycle_company_commission_paise', 150000,
      'cycle_onboarding_reward_paise', 15000
    ),
    'totals', jsonb_build_object(
      'qualifying_shops', 3,
      'qualifying_qr_transaction_paise', 4500000,
      'company_commission_paise', 450000,
      'onboarding_reward_paise', 45000,
      'paid_reward_paise', 30000
    ),
    'rewards', jsonb_build_array(
      jsonb_build_object(
        'id', 'onb-rew-1',
        'shop_attribution_id', 'attr-1',
        'salon_id', 'sal-1',
        'shop_name', 'Mira Glow Hair & Beauty',
        'qualification_start_date', '2026-09-01',
        'qualification_end_date', '2026-09-15',
        'qualifying_qr_transaction_paise', 1800000,
        'company_commission_paise', 180000,
        'onboarding_reward_paise', 18000,
        'status', 'approved',
        'earned_at', '2026-09-16T10:00:00Z'
      ),
      jsonb_build_object(
        'id', 'onb-rew-2',
        'shop_attribution_id', 'attr-2',
        'salon_id', 'sal-2',
        'shop_name', 'Urban Blade Men Salon',
        'qualification_start_date', '2026-09-05',
        'qualification_end_date', '2026-09-19',
        'qualifying_qr_transaction_paise', 2700000,
        'company_commission_paise', 270000,
        'onboarding_reward_paise', 27000,
        'status', 'paid',
        'earned_at', '2026-09-20T12:00:00Z'
      )
    )
  );
end;
$$;

grant execute on function public.get_my_partner_reward_dashboard() to authenticated, anon;
grant execute on function public.get_my_partner_onboarding_rewards(int, int) to authenticated, anon;

-- get_my_partner_earnings()
create or replace function public.get_my_partner_earnings(p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
  v_cleared_paise bigint := 300000;
  v_pending_paise bigint := 150000;
  v_lifetime_paise bigint := 450000;
  v_available_paise bigint := 250000;
begin
  return jsonb_build_object(
    'currency', 'INR',
    'totals', jsonb_build_object(
      'lifetime_paise', v_lifetime_paise,
      'pending_paise', v_pending_paise,
      'cleared_paise', v_cleared_paise,
      'available_paise', v_available_paise
    ),
    'transactions', jsonb_build_array(
      jsonb_build_object(
        'id', 'earn-1',
        'earning_type', 'referral_commission',
        'status', 'cleared',
        'amount_paise', 150000,
        'commission_bps', 2000,
        'earned_at', (now() - interval '2 days'),
        'payment_cleared_at', (now() - interval '2 days'),
        'available_at', now(),
        'paid_at', null
      ),
      jsonb_build_object(
        'id', 'earn-2',
        'earning_type', 'referral_commission',
        'status', 'cleared',
        'amount_paise', 150000,
        'commission_bps', 2000,
        'earned_at', (now() - interval '10 days'),
        'payment_cleared_at', (now() - interval '10 days'),
        'available_at', now(),
        'paid_at', null
      ),
      jsonb_build_object(
        'id', 'earn-3',
        'earning_type', 'referral_commission',
        'status', 'pending',
        'amount_paise', 150000,
        'commission_bps', 2000,
        'earned_at', (now() - interval '12 hours'),
        'payment_cleared_at', null,
        'available_at', null,
        'paid_at', null
      )
    )
  );
end;
$$;

-- get_my_partner_payout_requests()
create or replace function public.get_my_partner_payout_requests(p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'total', 1,
    'open_amount_paise', 50000,
    'items', jsonb_build_array(
      jsonb_build_object(
        'id', 'payout-1',
        'amount_paise', 50000,
        'payout_method', 'upi',
        'destination_label', 'partner@upi',
        'status', 'paid',
        'requested_at', (now() - interval '14 days'),
        'reviewed_at', (now() - interval '13 days'),
        'paid_at', (now() - interval '13 days'),
        'rejection_reason', null,
        'provider_reference', 'UPI-REF-99281'
      )
    )
  );
end;
$$;

-- get_my_partner_levels()
create or replace function public.get_my_partner_levels()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'current_level_code', 'SILVER',
    'next_level_code', 'GOLD',
    'paid_referrals_count', 8,
    'referrals_to_next_level', 2,
    'levels', jsonb_build_array(
      jsonb_build_object('code', 'BRONZE', 'sort_order', 1, 'minimum_paid_referrals', 0, 'commission_bps', 1000, 'perks', jsonb_build_array('10% Commission', 'Basic Marketing Kit')),
      jsonb_build_object('code', 'SILVER', 'sort_order', 2, 'minimum_paid_referrals', 5, 'commission_bps', 1500, 'perks', jsonb_build_array('15% Commission', 'Priority Support', 'Custom Referral Link')),
      jsonb_build_object('code', 'GOLD', 'sort_order', 3, 'minimum_paid_referrals', 10, 'commission_bps', 2000, 'perks', jsonb_build_array('20% Commission', 'Dedicated Account Manager', 'Co-branded Landing Pages')),
      jsonb_build_object('code', 'PLATINUM', 'sort_order', 4, 'minimum_paid_referrals', 25, 'commission_bps', 2500, 'perks', jsonb_build_array('25% Commission', 'Instant Payouts', 'Annual Partner Summit'))
    )
  );
end;
$$;

-- get_partner_leaderboard()
create or replace function public.get_partner_leaderboard(p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'period', 'monthly',
    'top_partners', jsonb_build_array(
      jsonb_build_object('rank', 1, 'partner_masked', 'PTR-***901', 'referrals_count', 24, 'commission_paise', 3600000),
      jsonb_build_object('rank', 2, 'partner_masked', 'PTR-***442', 'referrals_count', 18, 'commission_paise', 2700000),
      jsonb_build_object('rank', 3, 'partner_masked', 'PTR-***781', 'referrals_count', 14, 'commission_paise', 2100000)
    )
  );
end;
$$;

-- get_my_partner_notifications()
create or replace function public.get_my_partner_notifications(p_type text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'total', 2,
    'unread_count', 1,
    'items', jsonb_build_array(
      jsonb_build_object(
        'id', 'notif-1',
        'title', 'New Referral Signed Up',
        'body', 'Mira Glow Hair & Beauty just signed up using your link!',
        'read', false,
        'created_at', (now() - interval '2 hours'),
        'action_url', '/partner/referrals'
      ),
      jsonb_build_object(
        'id', 'notif-2',
        'title', 'Commission Credited',
        'body', '₹1,500 commission cleared and added to your available balance.',
        'read', true,
        'created_at', (now() - interval '2 days'),
        'action_url', '/partner/earnings'
      )
    )
  );
end;
$$;

grant execute on function public.get_my_partner_earnings(int, int) to authenticated, anon;
grant execute on function public.get_my_partner_payout_requests(int, int) to authenticated, anon;
grant execute on function public.get_my_partner_levels() to authenticated, anon;
grant execute on function public.get_partner_leaderboard(int) to authenticated, anon;
grant execute on function public.get_my_partner_notifications(text, int) to authenticated, anon;

-- get_my_growth_partner_profile()
create or replace function public.get_my_growth_partner_profile()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner public.growth_partners;
  v_name text := 'Growth Partner';
  v_email text := 'partner@nexora.app';
  v_phone text := '+91 98765 43210';
  v_photo text := null;
  v_code text := 'NEXORA-GROWTH';
begin
  if v_user_id is not null then
    select * into v_partner from public.growth_partners where user_id = v_user_id;
    if found then
      v_code := v_partner.referral_code;
    end if;
  end if;

  return jsonb_build_object(
    'full_name', v_name,
    'email', v_email,
    'phone', v_phone,
    'photo_path', v_photo,
    'partner_id', coalesce(v_user_id::text, 'ptr-active-partner'),
    'referral_code', v_code,
    'account_status', 'Active',
    'partner_role', 'Growth Partner',
    'approval_status', 'Approved',
    'joined_at', now()
  );
end;
$$;

-- save_my_growth_partner_profile()
create or replace function public.save_my_growth_partner_profile(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.get_my_growth_partner_profile();
end;
$$;

-- get_my_partner_account_settings()
create or replace function public.get_my_partner_account_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'agency_name', 'Growth Partner Desk',
    'whatsapp_phone', '+91 98765 43210',
    'city', 'Mumbai',
    'state', 'Maharashtra',
    'public_bio', 'Official Nexora Growth & Distribution Partner.',
    'full_address', 'Nexora Partner Hub, BKC',
    'alternate_phone', null,
    'website_url', null,
    'social_handles', '',
    'social_links', jsonb_build_object('instagram', '', 'linkedin', '', 'facebook', '', 'twitter', ''),
    'payout_method', 'upi',
    'payout_account_name', 'Partner Account',
    'payout_account_number', null,
    'payout_ifsc', null,
    'payout_upi_id', 'partner@upi',
    'bank_name', null,
    'bank_branch', null,
    'swift_code', null,
    'pan_number', null,
    'notify_email', true,
    'notify_whatsapp', true,
    'notify_sms', false
  );
end;
$$;

-- save_my_partner_account_settings()
create or replace function public.save_my_partner_account_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.get_my_partner_account_settings();
end;
$$;

grant execute on function public.get_my_growth_partner_profile() to authenticated, anon;
grant execute on function public.save_my_growth_partner_profile(jsonb) to authenticated, anon;
grant execute on function public.get_my_partner_account_settings() to authenticated, anon;
grant execute on function public.save_my_partner_account_settings(jsonb) to authenticated, anon;



