-- One snapshot for selected rows, filtered total, and partner-scoped tab counts.
-- Counts respect name search but not the status filter or page boundaries.
begin;
create or replace function public.get_my_partner_referrals(
  p_status_filter text default null,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_partner public.growth_partners%rowtype := public.partner_dashboard_caller();
  v_filter text := lower(btrim(coalesce(p_status_filter, 'all')));
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 64)), '');
  v_like text;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  -- Keep old filter keys working for existing clients.
  v_filter := case v_filter when 'in_progress' then 'active' when 'completed' then 'converted' else v_filter end;
  if v_filter not in ('all', 'pending', 'active', 'converted', 'inactive', 'cancelled', 'rejected') then
    raise exception 'Unknown referral filter' using errcode = '22023';
  end if;
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
    from public.growth_onboarding o
    left join public.profiles p on p.id = o.user_id
    where o.growth_partner_id = v_partner.user_id
      and (v_filter = 'all' or public.growth_effective_referral_status(o.status, o.referral_status_override) = v_filter)
      and (v_search is null or p.full_name ilike v_like escape '\');

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select '…' || right(o.user_id::text, 8) as ref,
           nullif(btrim(coalesce(p.full_name, '')), '') as display_name,
           public.growth_mask_referral_email(u.email) as masked_contact,
           u.created_at as joined_at,
           o.referral_code as referral_code,
           case when o.status = 'template_completed' then 'converted' else 'not_converted' end as conversion_status,
           greatest(o.linked_at, o.template_started_at, o.template_completed_at) as last_activity_at,
           public.growth_effective_referral_status(o.status, o.referral_status_override) as referral_status,
           o.status as status,
           o.linked_at as linked_at,
           o.template_started_at as template_started_at,
           o.template_completed_at as template_completed_at
      from public.growth_onboarding o
      left join public.profiles p on p.id = o.user_id
      join auth.users u on u.id = o.user_id
      where o.growth_partner_id = v_partner.user_id
        and (v_filter = 'all' or public.growth_effective_referral_status(o.status, o.referral_status_override) = v_filter)
        and (v_search is null or p.full_name ilike v_like escape '\')
      order by o.linked_at desc nulls last, o.user_id desc
      limit v_limit offset v_offset
  ) r;

  return jsonb_build_object(
    'status_counts', (
      select jsonb_build_object(
        'all', count(*),
        'pending', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'pending'),
        'active', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'active'),
        'converted', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'converted'),
        'inactive', count(*) filter (where o.referral_status_override = 'inactive'),
        'cancelled', count(*) filter (where o.referral_status_override = 'cancelled'),
        'rejected', count(*) filter (where o.referral_status_override = 'rejected')
      ) from public.growth_onboarding o
      left join public.profiles p on p.id = o.user_id
      where o.growth_partner_id = v_partner.user_id
        and (v_search is null or p.full_name ilike v_like escape '\')
    ),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows
  );
end;
$$;
revoke all on function public.get_my_partner_referrals(text, text, int, int) from public, anon;
grant execute on function public.get_my_partner_referrals(text, text, int, int) to authenticated;
notify pgrst, 'reload schema';
commit;
