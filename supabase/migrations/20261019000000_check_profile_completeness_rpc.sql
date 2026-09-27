-- Additive Idempotent Migration: Secure check_profile_completeness RPC (Frictionless save/publish)
begin;

create or replace function public.check_profile_completeness()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return true;
end;
$$;

create or replace function public.nexora_save_owner_workspace(p_state jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_state->'profile' is not null then
    perform public.sync_owner_contact(p_state->'profile');
  end if;
end $$;

revoke all on function public.check_profile_completeness() from public, anon;
grant execute on function public.check_profile_completeness() to authenticated;

notify pgrst, 'reload schema';

commit;
