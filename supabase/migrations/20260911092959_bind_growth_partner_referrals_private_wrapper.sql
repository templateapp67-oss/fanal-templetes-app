-- Parse the wrapper at creation time so callers need EXECUTE on the
-- private helper, without granting general USAGE on the private schema.
create or replace function public.get_my_partner_referrals(
 p_status_filter text default null,p_search text default null,
 p_limit int default 20,p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = ''
return private.partner_referred_users_page(p_status_filter,p_search,p_limit,p_offset);
revoke all on function public.get_my_partner_referrals(text,text,int,int) from public,anon;
grant execute on function public.get_my_partner_referrals(text,text,int,int) to authenticated;
notify pgrst, 'reload schema';
