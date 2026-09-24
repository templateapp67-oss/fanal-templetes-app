-- Resilient, caller-owned Growth Partner/profile initialization.
-- This is intentionally the one entry point used by portal/profile clients.
begin;

create or replace function public.get_or_create_my_growth_partner()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  partner public.growth_partners%rowtype;
  display_name text;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into partner from public.growth_partners where user_id = actor;
  if partner.user_id is null then
    -- The only id used here is auth.uid(); clients cannot provision anyone else.
    perform public.provision_growth_partner(actor);
    select * into partner from public.growth_partners where user_id = actor;
  end if;

  select coalesce(
    nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(email, '@', 1), ''),
    'Growth Partner'
  ) into display_name
  from auth.users where id = actor;

  insert into public.profiles (id, full_name)
  values (actor, display_name)
  on conflict (id) do nothing;

  insert into public.growth_onboarding (user_id, status)
  values (actor, 'not_started')
  on conflict (user_id) do nothing;

  return jsonb_build_object(
    'user_id', partner.user_id,
    'referral_code', partner.referral_code,
    'is_active', partner.is_active,
    'created_at', partner.created_at,
    'updated_at', partner.updated_at,
    'tier', 'Starter',
    'stats', jsonb_build_object('referred_users', 0, 'completed_onboarding', 0),
    'onboarding_status', 'not_started'
  );
end;
$$;

create or replace function public.get_or_create_my_growth_partner_profile()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.get_or_create_my_growth_partner();
  return public.get_my_growth_partner_profile();
end;
$$;

revoke all on function public.get_or_create_my_growth_partner() from public, anon;
revoke all on function public.get_or_create_my_growth_partner_profile() from public, anon;
grant execute on function public.get_or_create_my_growth_partner() to authenticated;
grant execute on function public.get_or_create_my_growth_partner_profile() to authenticated;

notify pgrst, 'reload schema';
commit;
