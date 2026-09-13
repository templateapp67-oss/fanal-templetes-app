-- Sections 31/34: reuse existing onboarding/profile relations; no new tables or data rewrites.
begin;

-- Fail before changing anything if the deployed contract is incomplete. Never
-- create an alternative analytics/referrals table to hide schema drift.
do $$
begin
  if to_regclass('public.growth_onboarding') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.get_my_partner_dashboard()') is null
     or to_regprocedure('public.partner_dashboard_caller()') is null then
    raise exception 'Partner schema incomplete; apply and reconcile the existing migration chain first';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='growth_onboarding' and column_name='referral_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='growth_onboarding' and column_name='linked_at' and data_type='timestamp with time zone') then
    raise exception 'Partner schema incompatible; reconcile referral_id and linked_at before analytics';
  end if;
end;
$$;

create index if not exists growth_onboarding_partner_recent_idx
  on public.growth_onboarding(growth_partner_id,linked_at desc,referral_id desc)
  where growth_partner_id is not null;

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
  v_as_of timestamptz := statement_timestamp();
  v_from timestamptz := (date_trunc('day', statement_timestamp() at time zone 'UTC') - interval '6 days') at time zone 'UTC';
  v_recent jsonb;
  v_daily jsonb;
  v_last_seven bigint;
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

  -- Referral date means credited/linked date, matching the referral list.
  -- One account per canonical row, not one event or one click per account.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.date desc, r."referralId" desc), '[]'::jsonb)
    into v_recent
    from (
      select o.referral_id as "referralId",
             coalesce(nullif(btrim(p.full_name), ''), 'Referred user') as name,
             o.linked_at as date,
             public.growth_effective_referral_status(o.status,o.referral_status_override) as status
      from public.growth_onboarding o
      left join public.profiles p on p.id=o.user_id
      where o.growth_partner_id=v_partner.user_id and o.linked_at <= v_as_of
      order by o.linked_at desc,o.referral_id desc limit 10
    ) r;

  select count(*) into v_last_seven from public.growth_onboarding o
    where o.growth_partner_id=v_partner.user_id and o.linked_at >= v_from and o.linked_at <= v_as_of;

  -- Graph-ready, zero-filled calendar buckets. All dates use UTC; today is
  -- partial. Counts and bounds use the same statement snapshot as the cards.
  select jsonb_agg(jsonb_build_object('date',to_char(d.day,'YYYY-MM-DD'), 'count',(
    select count(*) from public.growth_onboarding o
    where o.growth_partner_id=v_partner.user_id
      and o.linked_at >= d.day at time zone 'UTC'
      and o.linked_at < (d.day + interval '1 day') at time zone 'UTC'
      and o.linked_at <= v_as_of
  )) order by d.day) into v_daily
  from generate_series(v_from at time zone 'UTC', date_trunc('day',v_as_of at time zone 'UTC'), interval '1 day') d(day);

  return jsonb_build_object(
    'referralActivity', jsonb_build_object(
      'recentReferrals',v_recent,
      'last7DaysReferrals',v_last_seven,
      'dailyReferrals',v_daily,
      'window',jsonb_build_object('from',v_from,'asOf',v_as_of,'timeZone','UTC')
    ),
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
