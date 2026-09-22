-- Direct partner-dashboard enrollment. A signed-in account provisions only
-- itself; callers cannot choose another user id or bypass suspended rows.
begin;

create or replace function public.ensure_my_growth_partner()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  existing public.growth_partners;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into existing
  from public.growth_partners
  where user_id = actor;

  -- Never reactivate a partner that an administrator explicitly suspended.
  if existing.user_id is not null then
    return jsonb_build_object(
      'user_id', existing.user_id,
      'referral_code', existing.referral_code,
      'is_active', existing.is_active
    );
  end if;

  return public.provision_growth_partner(actor);
end;
$$;

revoke all on function public.ensure_my_growth_partner() from public, anon;
grant execute on function public.ensure_my_growth_partner() to authenticated;

comment on function public.ensure_my_growth_partner() is
'Direct dashboard enrollment for auth.uid() only. Existing inactive partners remain inactive.';

notify pgrst, 'reload schema';
commit;
