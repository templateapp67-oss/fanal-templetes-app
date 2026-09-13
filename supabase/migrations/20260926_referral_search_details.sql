-- Search/filter/sort and read-only referral details. Caller identity never comes from input.
begin;
alter table public.growth_onboarding add column if not exists referral_id uuid not null default gen_random_uuid();
create unique index if not exists growth_onboarding_referral_id_key on public.growth_onboarding(referral_id);
alter table public.growth_onboarding add column if not exists referral_clicked_at timestamptz;
-- Preserve known click timestamps before temporary attribution cleanup. Do not invent manual-link clicks.
update public.growth_onboarding o set referral_clicked_at = a.clicked_at
from (select consumed_by, partner_id, min(created_at) as clicked_at from public.growth_referral_attributions
      where consumed_at is not null group by consumed_by, partner_id) a
where o.user_id = a.consumed_by and o.growth_partner_id = a.partner_id and o.referral_clicked_at is null;
create or replace function public.consume_signup_growth_referral()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_token text := new.raw_user_meta_data ->> 'growth_referral_token';
  v_attr public.growth_referral_attributions;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then return new; end if;
  select * into v_attr from public.growth_referral_attributions
  where token_hash = md5(v_token) and expires_at > now() and consumed_at is null for update;
  if not found or v_attr.partner_id = new.id then return new; end if;
  -- Reject stale tokens after a code rotation or partner deactivation. Never
  -- resolve an old code to a different partner, even if an admin reassigns it.
  perform 1 from public.growth_partners where user_id = v_attr.partner_id
    and referral_code = v_attr.referral_code and is_active for share;
  if not found then return new; end if;
  insert into public.growth_onboarding as o(user_id, growth_partner_id, referral_code, linked_at, status, referral_clicked_at)
  values (new.id, v_attr.partner_id, v_attr.referral_code, now(), 'linked', v_attr.created_at)
  on conflict (user_id) do update set
    growth_partner_id = excluded.growth_partner_id, referral_code = excluded.referral_code,
    linked_at = excluded.linked_at, referral_clicked_at = excluded.referral_clicked_at,
    status = case when o.status = 'not_started' then 'linked' else o.status end
  where o.growth_partner_id is null;
  update public.growth_referral_attributions set consumed_by = new.id, consumed_at = now()
  where token_hash = v_attr.token_hash;
  return new;
end;
$$;

create or replace function public.get_my_partner_referrals_filtered(
  p_status_filter text default null, p_search text default null,
  p_limit int default 20, p_offset int default 0,
  p_joined_from timestamptz default null, p_joined_before timestamptz default null,
  p_conversion text default 'all', p_sort text default 'newest'
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_partner public.growth_partners := public.partner_dashboard_caller();
  v_status text := coalesce(nullif(lower(btrim(p_status_filter)), ''), 'all');
  v_search text := nullif(lower(btrim(p_search)), '');
  v_conversion text := coalesce(p_conversion, 'all');
  v_sort text := coalesce(p_sort, 'newest');
  v_limit int := least(greatest(coalesce(p_limit,20),1),100);
  v_offset int := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  v_status := case v_status when 'in_progress' then 'active' when 'completed' then 'converted' else v_status end;
  if v_status not in ('all','pending','active','converted','inactive','cancelled','rejected')
     or v_conversion not in ('all','converted','not_converted')
     or v_sort not in ('newest','oldest','recently_active')
     or length(v_search) > 254
     or (p_joined_from is not null and p_joined_before is not null and p_joined_from >= p_joined_before)
     or (p_joined_from is not null and not isfinite(p_joined_from))
     or (p_joined_before is not null and not isfinite(p_joined_before)) then
    raise exception 'Invalid referral filters' using errcode = '22023';
  end if;
  with matching as materialized (
    select o.user_id as tie_id, o.referral_id,
      '…' || right(o.user_id::text, 8) as ref,
      nullif(btrim(p.full_name), '') as display_name,
      public.growth_mask_referral_email(u.email) as masked_contact,
      u.created_at as joined_at, o.linked_at, o.referral_clicked_at,
      o.referral_code, o.status,
      public.growth_effective_referral_status(o.status, o.referral_status_override) as referral_status,
      case when o.status = 'template_completed' then 'converted' else 'not_converted' end as conversion_status,
      greatest(o.linked_at, o.template_started_at, o.template_completed_at) as last_activity_at,
      o.template_started_at, o.template_completed_at
    from public.growth_onboarding o
    join auth.users u on u.id = o.user_id
    left join public.profiles p on p.id = o.user_id
    where o.growth_partner_id = v_partner.user_id
      -- Literal substring search. No SQL interpolation or LIKE wildcard probes.
      and (v_search is null or strpos(lower(coalesce(p.full_name,'')),v_search)>0
        or strpos(lower(coalesce(u.email,'')),v_search)>0 or strpos(lower(o.referral_code),v_search)>0)
      and (p_joined_from is null or u.created_at >= p_joined_from)
      and (p_joined_before is null or u.created_at < p_joined_before)
      and (v_conversion = 'all' or (v_conversion = 'converted') = (o.status = 'template_completed'))
  ), filtered as (
    select * from matching where v_status = 'all' or referral_status = v_status
  ), page as (
    select * from filtered order by
      case when v_sort = 'oldest' then joined_at end asc nulls last,
      case when v_sort = 'newest' then joined_at end desc nulls last,
      case when v_sort = 'recently_active' then last_activity_at end desc nulls last,
      tie_id desc
    limit v_limit offset v_offset
  ) select jsonb_build_object(
    'total',(select count(*) from filtered), 'limit',v_limit,'offset',v_offset,
    'rows',coalesce((select jsonb_agg(to_jsonb(page)-'tie_id' order by
      case when v_sort='oldest' then joined_at end asc nulls last,
      case when v_sort='newest' then joined_at end desc nulls last,
      case when v_sort='recently_active' then last_activity_at end desc nulls last, tie_id desc) from page),'[]'::jsonb),
    'status_counts',(select jsonb_build_object(
      'all',count(*),
      'pending',count(*) filter (where referral_status='pending'),
      'active',count(*) filter (where referral_status='active'),
      'converted',count(*) filter (where referral_status='converted'),
      'inactive',count(*) filter (where referral_status='inactive'),
      'cancelled',count(*) filter (where referral_status='cancelled'),
      'rejected',count(*) filter (where referral_status='rejected')
    ) from matching)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_my_partner_referrals_filtered(text,text,int,int,timestamptz,timestamptz,text,text) from public, anon;
grant execute on function public.get_my_partner_referrals_filtered(text,text,int,int,timestamptz,timestamptz,text,text) to authenticated;

-- Existing callers retain the same signature; all reads share the same implementation.
create or replace function public.get_my_partner_referrals(
  p_status_filter text default null,p_search text default null,p_limit int default 20,p_offset int default 0
) returns jsonb language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select public.get_my_partner_referrals_filtered(p_status_filter,p_search,p_limit,p_offset);
$$;
revoke all on function public.get_my_partner_referrals(text,text,int,int) from public, anon;
grant execute on function public.get_my_partner_referrals(text,text,int,int) to authenticated;

create or replace function public.get_my_partner_referral_detail(p_referral_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_partner public.growth_partners := public.partner_dashboard_caller();
  v_result jsonb;
begin
  select to_jsonb(r)-'tie_id' into v_result from (
    select o.user_id as tie_id, o.referral_id,
      '…' || right(o.user_id::text, 8) as ref,
      nullif(btrim(p.full_name), '') as display_name,
      public.growth_mask_referral_email(u.email) as masked_contact,
      u.created_at as joined_at, o.linked_at, o.referral_clicked_at,
      o.referral_code, o.status,
      public.growth_effective_referral_status(o.status, o.referral_status_override) as referral_status,
      case when o.status = 'template_completed' then 'converted' else 'not_converted' end as conversion_status,
      greatest(o.linked_at, o.template_started_at, o.template_completed_at) as last_activity_at,
      o.template_started_at, o.template_completed_at
    from public.growth_onboarding o join auth.users u on u.id=o.user_id
    left join public.profiles p on p.id=o.user_id
    where o.referral_id=p_referral_id and o.growth_partner_id=v_partner.user_id
  ) r;
  -- Same result for unknown IDs and another partner's IDs: no existence oracle.
  return v_result;
end;
$$;
revoke all on function public.get_my_partner_referral_detail(uuid) from public, anon;
grant execute on function public.get_my_partner_referral_detail(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
