-- Reuse production shop attribution. No parallel referral/onboarding store.
create or replace function public.get_my_growth_partner()
returns jsonb language sql stable security invoker set search_path = ''
as $$
 select jsonb_build_object('user_id',gp.user_id,'referral_code',gp.referral_code,
 'is_active',gp.status='approved','created_at',gp.created_at,'updated_at',gp.updated_at)
 from public.growth_partners gp where gp.user_id=(select auth.uid())
$$;
revoke all on function public.get_my_growth_partner() from public, anon;
grant execute on function public.get_my_growth_partner() to authenticated;

-- Private definer is required to read salon ownership without granting broad
-- salon/profile access. Every row is explicitly scoped to the session partner.
create or replace function private.partner_referred_users_page(
 p_status_filter text default null, p_search text default null,
 p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
 actor uuid := auth.uid();
 partner_id uuid;
 page_limit int := least(greatest(coalesce(p_limit,20),1),100);
 page_offset int := greatest(coalesce(p_offset,0),0);
 result jsonb;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select gp.id into partner_id from public.growth_partners gp where gp.user_id=actor;
 if partner_id is null then raise exception 'Growth Partner access required' using errcode='42501'; end if;
 if coalesce(nullif(lower(btrim(p_status_filter)),''),'all') <> 'all' then
   raise exception 'Status filtering is not available' using errcode='22023';
 end if;
 with own_users as (
   select s.owner_id, min(a.attributed_at) as linked_at,
          max(nullif(btrim(oa.owner_name),'')) as display_name
   from public.shop_attributions a
   join public.salons s on s.id=a.salon_id
   left join public.shop_onboarding_applications oa
     on oa.id=a.onboarding_application_id and oa.submitted_by_partner_id=partner_id
   where a.growth_partner_id=partner_id
     and a.status='active' and a.effective_from<=now()
     and (a.effective_until is null or a.effective_until>now())
     and s.owner_id is not null and s.owner_id<>actor
   group by s.owner_id
 ), matched as (
   select * from own_users
   where nullif(btrim(p_search),'') is null
      or strpos(lower(coalesce(display_name,'')),lower(left(btrim(p_search),64)))>0
 ), page as (
   select '…'||right(owner_id::text,8) as ref, display_name, linked_at,
          null::text as status, null::timestamptz as template_started_at,
          null::timestamptz as template_completed_at
   from matched order by linked_at desc nulls last,owner_id desc
   limit page_limit offset page_offset
 )
 select jsonb_build_object('total',(select count(*) from matched),
   'limit',page_limit,'offset',page_offset,
   'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb))
 into result;
 return result;
end
$$;
revoke all on function private.partner_referred_users_page(text,text,int,int) from public,anon;
grant execute on function private.partner_referred_users_page(text,text,int,int) to authenticated;

create or replace function public.get_my_partner_referrals(
 p_status_filter text default null,p_search text default null,
 p_limit int default 20,p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.partner_referred_users_page(p_status_filter,p_search,p_limit,p_offset) $$;
revoke all on function public.get_my_partner_referrals(text,text,int,int) from public,anon;
grant execute on function public.get_my_partner_referrals(text,text,int,int) to authenticated;

create or replace function public.get_my_partner_dashboard()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare partner jsonb; referrals jsonb;
begin
 partner := public.get_my_growth_partner();
 -- The referral RPC enforces signed-in partner membership.
 referrals := public.get_my_partner_referrals('all',null,8,0);
 return jsonb_build_object(
   'partner',jsonb_build_object('referral_code',partner->'referral_code',
     'is_active',partner->'is_active','partner_since',partner->'created_at'),
   'kpis',jsonb_build_object('total_referrals',referrals->'total',
     'active_onboarding',null,'completed',null),
   'recent_activity',coalesce((select jsonb_agg(jsonb_build_object(
     'type','referral_added','ref',r->'ref','display_name',r->'display_name','at',r->'linked_at'))
     from jsonb_array_elements(referrals->'rows') r),'[]'::jsonb));
end
$$;
revoke all on function public.get_my_partner_dashboard() from public,anon;
grant execute on function public.get_my_partner_dashboard() to authenticated;
notify pgrst, 'reload schema';
