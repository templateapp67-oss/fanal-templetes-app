-- ============================================================================
-- Nexora Salon OS — demo data seed.
-- Seeds staff, services, clients, and loyalty rewards for the most recently
-- created owner account (or a manual uuid). Safe to re-run.
--
-- Run with:  supabase db seed
-- or paste into the Supabase SQL Editor.
-- ============================================================================

do $$
declare
  v_owner uuid;
begin
  select id into v_owner
  from auth.users
  order by created_at desc
  limit 1;

  if v_owner is null then
    raise notice 'No auth users found yet. Create an owner account first, then run: select public.seed_demo_data(''<owner-uuid>'');';
  else
    perform public.seed_demo_data(v_owner);
    raise notice 'Seeded demo data for owner %', v_owner;
  end if;
end;
$$;
