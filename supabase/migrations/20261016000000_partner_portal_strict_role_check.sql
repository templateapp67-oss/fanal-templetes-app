-- ============================================================================
-- Migration: Enforce strict Growth Partner role authorization across portal RPCs
-- Project: qwaehqsmodekbgvnaavz
-- ============================================================================

begin;

drop function if exists public.get_my_partner_earnings(int, int);
drop function if exists public.get_my_partner_earnings(integer, integer);
drop function if exists public.get_my_partner_earnings();

-- 1. get_my_partner_earnings
create or replace function public.get_my_partner_earnings(p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select user_id into v_partner_id
  from public.growth_partners
  where user_id = v_user_id and (is_active = true or is_active is null);

  if v_partner_id is null then
    raise exception 'Active Growth Partner required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'currency', 'INR',
    'totals', jsonb_build_object(
      'lifetime_paise', 0,
      'pending_paise', 0,
      'cleared_paise', 0,
      'available_paise', 0
    ),
    'transactions', jsonb_build_array()
  );
end;
$$;

drop function if exists public.get_my_partner_levels();

-- 2. get_my_partner_levels
create or replace function public.get_my_partner_levels()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select user_id into v_partner_id
  from public.growth_partners
  where user_id = v_user_id and (is_active = true or is_active is null);

  if v_partner_id is null then
    raise exception 'Active Growth Partner required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'current_level_code', 'BRONZE',
    'next_level_code', 'SILVER',
    'paid_referrals_count', 0,
    'referrals_to_next_level', 5,
    'levels', jsonb_build_array()
  );
end;
$$;

drop function if exists public.get_my_partner_notifications(text, int);
drop function if exists public.get_my_partner_notifications(text, integer);
drop function if exists public.get_my_partner_notifications();

-- 3. get_my_partner_notifications
create or replace function public.get_my_partner_notifications(p_type text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select user_id into v_partner_id
  from public.growth_partners
  where user_id = v_user_id and (is_active = true or is_active is null);

  if v_partner_id is null then
    raise exception 'Active Growth Partner required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total', 0,
    'unread_count', 0,
    'notifications', jsonb_build_array()
  );
end;
$$;

revoke all on function public.get_my_partner_earnings(int, int) from public, anon;
grant execute on function public.get_my_partner_earnings(int, int) to authenticated;

revoke all on function public.get_my_partner_levels() from public, anon;
grant execute on function public.get_my_partner_levels() to authenticated;

revoke all on function public.get_my_partner_notifications(text, int) from public, anon;
grant execute on function public.get_my_partner_notifications(text, int) to authenticated;

drop function if exists public.get_my_partner_payout_requests(int, int);
drop function if exists public.get_my_partner_payout_requests(integer, integer);
drop function if exists public.get_my_partner_payout_requests();

-- 4. get_my_partner_payout_requests
create or replace function public.get_my_partner_payout_requests(p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select user_id into v_partner_id
  from public.growth_partners
  where user_id = v_user_id and (is_active = true or is_active is null);

  if v_partner_id is null then
    raise exception 'Active Growth Partner required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total', coalesce((select count(*) from public.partner_payout_requests where partner_id = public.my_active_partner_id()), 0),
    'open_amount_paise', coalesce((select sum(amount_paise) from public.partner_payout_requests where partner_id = public.my_active_partner_id() and status in ('pending','in_review')), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', x.id, 'amount_paise', x.amount_paise, 'payout_method', x.payout_method,
                         'destination_label', x.destination_label, 'status', x.status,
                         'requested_at', x.requested_at, 'reviewed_at', x.reviewed_at, 'paid_at', x.paid_at,
                         'rejection_reason', x.rejection_reason, 'provider_reference', x.provider_reference
                       ) order by x.requested_at desc, x.id desc) from (
       select id, amount_paise, payout_method, destination_label, status,
              requested_at, reviewed_at, paid_at, rejection_reason, provider_reference
         from public.partner_payout_requests
        where partner_id = public.my_active_partner_id()
        order by requested_at desc, id desc
        limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_partner_payout_requests(int, int) from public, anon;
grant execute on function public.get_my_partner_payout_requests(int, int) to authenticated;

commit;
