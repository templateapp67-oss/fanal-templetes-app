-- get_my_partner_dashboard runs as the authenticated caller. Its reward
-- helpers must be executable by that same caller; their table reads continue
-- to use existing RLS. Do not switch the dashboard to SECURITY DEFINER.
begin;
do $$
begin
  -- The QR reward schema is optional on older installations.
  if to_regprocedure('public.gp_qualifying_shop_count(uuid)') is not null then
    revoke all on function public.gp_qualifying_shop_count(uuid) from public, anon;
    grant execute on function public.gp_qualifying_shop_count(uuid) to authenticated;
  end if;
  if to_regprocedure('public.gp_shop_qualifies(uuid)') is not null then
    revoke all on function public.gp_shop_qualifies(uuid) from public, anon;
    grant execute on function public.gp_shop_qualifies(uuid) to authenticated;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
