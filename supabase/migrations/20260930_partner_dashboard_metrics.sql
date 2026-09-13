-- Section 23: caller-scoped database aggregates. Preserve legacy payload keys.
-- Totals count registered referrals, not anonymous clicks or paginated results.
begin;

create or replace function public.get_my_partner_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_partner public.growth_partners%rowtype := public.partner_dashboard_caller();
  v_total int := 0;
  v_completed int := 0;
  v_counts jsonb;
  v_activity jsonb := '[]'::jsonb;
begin
  select count(*), count(*) filter (where o.status = 'template_completed')
    into v_total, v_completed
    from public.growth_onboarding o
    where o.growth_partner_id = v_partner.user_id;

  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_activity
  from (
    select s.type, s.ref, s.display_name, s.at from (
      select 'referral_added'::text as type,
             '…' || right(o.user_id::text, 8) as ref,
             nullif(btrim(coalesce(p.full_name, '')), '') as display_name,
             o.linked_at as at
        from public.growth_onboarding o
        left join public.profiles p on p.id = o.user_id
        where o.growth_partner_id = v_partner.user_id and o.linked_at is not null
      union all
      select 'website_started'::text,
             '…' || right(o.user_id::text, 8),
             nullif(btrim(coalesce(p.full_name, '')), ''),
             o.template_started_at
        from public.growth_onboarding o
        left join public.profiles p on p.id = o.user_id
        where o.growth_partner_id = v_partner.user_id and o.template_started_at is not null
      union all
      select 'website_completed'::text,
             '…' || right(o.user_id::text, 8),
             nullif(btrim(coalesce(p.full_name, '')), ''),
             o.template_completed_at
        from public.growth_onboarding o
        left join public.profiles p on p.id = o.user_id
        where o.growth_partner_id = v_partner.user_id and o.template_completed_at is not null
    ) s
    order by s.at desc
    limit 8
  ) e;

  select jsonb_build_object(
        'pending', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'pending'),
        'active', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'active'),
        'converted', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'converted'),
        'inactive', count(*) filter (where o.referral_status_override = 'inactive'),
        'cancelled', count(*) filter (where o.referral_status_override = 'cancelled'),
        'rejected', count(*) filter (where o.referral_status_override = 'rejected')
      ) into v_counts from public.growth_onboarding o where o.growth_partner_id = v_partner.user_id;

  return jsonb_build_object(
    'totalReferrals', v_total,
    'activeReferrals', (v_counts->>'active')::bigint,
    'pendingReferrals', (v_counts->>'pending')::bigint,
    'convertedReferrals', (v_counts->>'converted')::bigint,
    'partner', jsonb_build_object(
      'referral_code', v_partner.referral_code,
      'is_active', v_partner.is_active,
      'partner_since', v_partner.created_at
    ),
    'kpis', jsonb_build_object(
      'total_referrals', v_total,
      'active_onboarding', v_total - v_completed,
      'completed', v_completed
    ),
    'referral_status_counts', v_counts,
    'recent_activity', v_activity
  );
end;
$$;

revoke all on function public.get_my_partner_dashboard() from public, anon;
grant execute on function public.get_my_partner_dashboard() to authenticated;
commit;
