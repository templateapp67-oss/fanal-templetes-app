-- Phase 1: close self-enrollment and make the caller's partner lookup fail closed.
-- Preserve all existing partner rows and referral relationships.
-- 20261010000000 supplied an unrestricted ensure_my_growth_partner() that
-- creates an active row for any authenticated account. It must not be callable.
revoke execute on function public.ensure_my_growth_partner() from public, anon, authenticated;

create or replace function public.get_my_growth_partner()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', gp.user_id, 'referral_code', gp.referral_code,
    'is_active', gp.is_active, 'status', gp.status,
    'created_at', gp.created_at, 'updated_at', gp.updated_at
  )
  from public.growth_partners gp
  where gp.user_id = (select auth.uid())
    and gp.is_active is true and gp.status = 'approved'
  limit 1
$$;
revoke all on function public.get_my_growth_partner() from public, anon;
grant execute on function public.get_my_growth_partner() to authenticated;

-- The header sharing code is not the incoming referral relationship.
create or replace function public.get_my_referral_code()
returns text language sql stable security definer set search_path = ''
as $$
  select gp.referral_code from public.growth_partners gp
  where gp.user_id = (select auth.uid())
    and gp.is_active is true and gp.status = 'approved'
  limit 1
$$;
revoke all on function public.get_my_referral_code() from public, anon;
grant execute on function public.get_my_referral_code() to authenticated;

-- Direct table reads: even if another permissive policy is present, only
-- the caller's approved, active partner id may read partner-private rows.
create or replace function public.is_my_approved_partner(p_partner_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.growth_partners gp
    where gp.id = p_partner_id and gp.user_id = (select auth.uid())
      and gp.is_active is true and gp.status = 'approved'
  )
$$;
revoke all on function public.is_my_approved_partner(uuid) from public, anon;
grant execute on function public.is_my_approved_partner(uuid) to authenticated;

do $$
begin
  if to_regclass('public.growth_partners') is not null then
    drop policy if exists approved_partner_read_fence on public.growth_partners;
    create policy approved_partner_read_fence on public.growth_partners as restrictive
      for select to authenticated using (public.is_my_approved_partner(id));
  end if;
  if to_regclass('public.referrals') is not null then
    drop policy if exists approved_partner_read_fence on public.referrals;
    create policy approved_partner_read_fence on public.referrals as restrictive
      for select to authenticated using (public.is_my_approved_partner(growth_partner_id));
  end if;
  if to_regclass('public.partner_referrals') is not null then
    drop policy if exists approved_partner_read_fence on public.partner_referrals;
    create policy approved_partner_read_fence on public.partner_referrals as restrictive
      for select to authenticated using (public.is_my_approved_partner(partner_id));
  end if;
  if to_regclass('public.payouts') is not null then
    drop policy if exists approved_partner_read_fence on public.payouts;
    create policy approved_partner_read_fence on public.payouts as restrictive
      for select to authenticated using (public.is_my_approved_partner(partner_id));
  end if;
  if to_regclass('public.partner_payout_requests') is not null then
    drop policy if exists approved_partner_read_fence on public.partner_payout_requests;
    create policy approved_partner_read_fence on public.partner_payout_requests as restrictive
      for select to authenticated using (public.is_my_approved_partner(partner_id));
  end if;
end $$;
