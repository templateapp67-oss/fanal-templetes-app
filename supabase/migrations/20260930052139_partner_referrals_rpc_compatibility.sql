-- Supply the named RPC contract used by the partner portal on older deployments.
-- Keep existing implementations and the legacy two-argument shop RPC intact.
begin;
do $migration$
begin
if to_regprocedure('public.get_my_partner_referrals_filtered(text,text,integer,integer,timestamp with time zone,timestamp with time zone,text,text)') is null then
execute $ddl$
create function public.get_my_partner_referrals_filtered(
 p_status_filter text default null,p_search text default null,p_limit integer default 20,p_offset integer default 0,
 p_joined_from timestamptz default null,p_joined_before timestamptz default null,p_conversion text default 'all',p_sort text default 'newest'
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $body$
declare
 actor uuid:=auth.uid(); result jsonb;
 status_filter text:=coalesce(nullif(lower(btrim(p_status_filter)),''),'all');
 search_term text:=nullif(lower(btrim(p_search)),'');
 page_limit integer:=least(greatest(coalesce(p_limit,20),1),100);
 page_offset integer:=greatest(coalesce(p_offset,0),0);
begin
 if actor is null or not exists(select 1 from public.growth_partners where user_id=actor and is_active) then
 raise exception 'Growth Partner access required' using errcode='42501'; end if;
 status_filter:=case status_filter when 'in_progress' then 'active' when 'completed' then 'converted' else status_filter end;
 if status_filter not in ('all','pending','active','converted','inactive','cancelled','rejected')
 or coalesce(p_conversion,'all') not in ('all','converted','not_converted')
 or coalesce(p_sort,'newest') not in ('newest','oldest','recently_active') or length(search_term)>254
 or (p_joined_from is not null and not isfinite(p_joined_from))
 or (p_joined_before is not null and not isfinite(p_joined_before))
 or (p_joined_from is not null and p_joined_before is not null and p_joined_from>=p_joined_before) then
 raise exception 'Invalid referral filters' using errcode='22023'; end if;
 with matching as materialized (
 select o.user_id as referral_id,'…'||right(o.user_id::text,8) as ref,
 o.created_at as joined_at,o.linked_at,o.referral_code,o.status,o.template_started_at,o.template_completed_at,
 case when o.status='template_completed' then 'converted' when o.status='template_started' then 'active'
 when o.status in ('inactive','cancelled','rejected') then o.status else 'pending' end as referral_status,
 case when o.status='template_completed' then 'converted' else 'not_converted' end as conversion_status,
 greatest(o.updated_at,o.linked_at,o.template_started_at,o.template_completed_at) as last_activity_at
 from public.growth_onboarding o where o.growth_partner_id=actor
 and (search_term is null or strpos(lower(o.referral_code),search_term)>0 or strpos(o.user_id::text,search_term)>0)
 and (p_joined_from is null or o.created_at>=p_joined_from)
 and (p_joined_before is null or o.created_at<p_joined_before)
 and (coalesce(p_conversion,'all')='all' or (p_conversion='converted')=(o.status='template_completed'))
 ), filtered as (select * from matching where status_filter='all' or referral_status=status_filter),
 page as (select * from filtered order by
 case when p_sort='oldest' then joined_at end asc nulls last,
 case when coalesce(p_sort,'newest')='newest' then joined_at end desc nulls last,
 case when p_sort='recently_active' then last_activity_at end desc nulls last,referral_id desc limit page_limit offset page_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'limit',page_limit,'offset',page_offset,
 'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
 'status_counts',(select jsonb_build_object('all',count(*),'pending',count(*) filter(where referral_status='pending'),
 'active',count(*) filter(where referral_status='active'),'converted',count(*) filter(where referral_status='converted'),
 'inactive',count(*) filter(where referral_status='inactive'),'cancelled',count(*) filter(where referral_status='cancelled'),
 'rejected',count(*) filter(where referral_status='rejected')) from matching)) into result;
 return result;
end $body$;
$ddl$;
end if;
if to_regprocedure('public.get_my_partner_referrals(text,text,integer,integer)') is null then
execute $ddl$
create function public.get_my_partner_referrals(p_status_filter text,p_search text,p_limit integer,p_offset integer)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $body$
select public.get_my_partner_referrals_filtered(p_status_filter,p_search,p_limit,p_offset);
$body$;
$ddl$;
end if;
end $migration$;
revoke all on function public.get_my_partner_referrals(text,text,integer,integer) from public,anon;
grant execute on function public.get_my_partner_referrals(text,text,integer,integer) to authenticated;
revoke all on function public.get_my_partner_referrals_filtered(text,text,integer,integer,timestamptz,timestamptz,text,text) from public,anon;
grant execute on function public.get_my_partner_referrals_filtered(text,text,integer,integer,timestamptz,timestamptz,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
