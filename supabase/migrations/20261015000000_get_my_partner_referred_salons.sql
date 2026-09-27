-- ============================================================================
-- Migration: Add get_my_partner_referred_salons RPC for Referral History
-- Project: qwaehqsmodekbgvnaavz
-- ============================================================================

begin;

alter table public.growth_partners add column if not exists partner_code text;

create or replace function public.get_my_partner_referred_salons()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_partner public.growth_partners;
  v_partner_code text;
  v_referral_code text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into v_partner
  from public.growth_partners
  where user_id = v_uid and (is_active = true or is_active is null);

  if v_partner.id is null then
    -- Check if user is registered by partner_code or user_id
    select * into v_partner
    from public.growth_partners
    where user_id = v_uid;
  end if;

  if v_partner.id is null then
    return '[]'::jsonb;
  end if;

  v_partner_code := upper(coalesce(v_partner.partner_code, ''));
  v_referral_code := upper(coalesce(v_partner.referral_code, ''));

  with referred_users as (
    -- 1. Users from growth_onboarding
    select
      o.user_id,
      o.referral_code as ref_code_used,
      o.status as onboarding_status,
      o.linked_at,
      o.created_at as onboarding_created_at
    from public.growth_onboarding o
    where o.growth_partner_id = v_partner.user_id
       or (v_referral_code <> '' and upper(o.referral_code) = v_referral_code)
       or (v_partner_code <> '' and upper(o.referral_code) = v_partner_code)
       or (v_referral_code <> '' and upper(o.referral_code) = replace(v_referral_code, 'NEXORA-', ''))
       or (v_partner_code <> '' and upper(o.referral_code) = replace(v_partner_code, 'NEX-', ''))
    union
    -- 2. Users from profiles referral_code attribution
    select
      p.id as user_id,
      p.referral_code as ref_code_used,
      'completed' as onboarding_status,
      p.created_at as linked_at,
      p.created_at as onboarding_created_at
    from public.profiles p
    where (v_referral_code <> '' and upper(coalesce(p.referral_code, '')) = v_referral_code)
       or (v_partner_code <> '' and upper(coalesce(p.referral_code, '')) = v_partner_code)
  ),
  salons_data as (
    select
      s.id as salon_id,
      s.name as salon_name,
      s.slug,
      s.city,
      s.address,
      s.phone,
      s.email as salon_email,
      s.is_active,
      s.created_at as salon_created_at,
      coalesce(p.full_name, u.email, s.name) as owner_name,
      u.email as raw_owner_email,
      public.growth_mask_referral_email(u.email) as masked_owner_email,
      coalesce(ru.ref_code_used, v_partner_code) as partner_code,
      v_referral_code as referral_code,
      case
        when s.is_active = true then 'active'
        when ru.onboarding_status = 'template_completed' then 'active'
        else 'onboarding'
      end as status,
      coalesce(ru.linked_at, s.created_at) as joined_at
    from referred_users ru
    join auth.users u on u.id = ru.user_id
    left join public.profiles p on p.id = ru.user_id
    left join public.salons s on s.owner_id = ru.user_id or lower(s.email) = lower(u.email)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', coalesce(salon_id::text, gen_random_uuid()::text),
        'salon_id', salon_id,
        'name', coalesce(salon_name, owner_name || '''s Salon', 'Referred Salon'),
        'slug', slug,
        'city', coalesce(city, 'Jaipur'),
        'address', address,
        'phone', phone,
        'owner_name', owner_name,
        'owner_email', masked_owner_email,
        'partner_code', coalesce(nullif(partner_code, ''), v_partner_code),
        'referral_code', v_referral_code,
        'status', status,
        'joined_at', joined_at,
        'created_at', salon_created_at
      ) order by joined_at desc nulls last
    ),
    '[]'::jsonb
  ) into v_result
  from salons_data;

  return v_result;
end;
$$;

revoke all on function public.get_my_partner_referred_salons() from public, anon;
grant execute on function public.get_my_partner_referred_salons() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
