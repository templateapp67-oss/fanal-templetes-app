-- ============================================================================
-- Nexora Salon OS — Growth Partner operational dashboard reads (Phase 6)
-- Migration: 20260915_growth_partner_dashboard.sql
-- ----------------------------------------------------------------------------
-- WHAT THIS SCRIPT DOES
--   Adds three read-only SECURITY DEFINER RPCs that power /growth-partner:
--     get_my_partner_dashboard  — partner card + server-side KPI counts +
--                                 recent activity (one call, no N+1)
--     get_my_partner_referrals  — own referrals with server-side status
--                                 filter, name search and limit/offset
--                                 pagination (serves Referrals AND Customers;
--                                 there is no second customer entity)
--     get_my_partner_performance — server-side aggregates: totals, started
--                                 count, completion rate, trailing-6-month
--                                 buckets from real linked/completed instants
--   Every RPC derives the caller from auth.uid(), requires a row in
--   growth_partners (fail-closed for non-partners), and scopes every query
--   to growth_partner_id = caller. There are NO partner/user id parameters,
--   so URL or argument manipulation cannot reach another partner's data.
--
-- DELIBERATE MINIMAL DISCLOSURE
--   Referred users' profiles are otherwise owner-only reads. These RPCs
--   disclose ONLY profiles.full_name (display name, blank/NULL when absent)
--   for the caller's OWN referrals — the operational minimum for a partner
--   to tell referrals apart, mirroring the existing reverse disclosure of
--   partner_name to the referred user. No email, phone, address, business
--   data or full user UUIDs are returned: rows carry a masked reference
--   ('…' + last 8 id chars) instead of user_id.
--
-- WHAT THIS SCRIPT DOES NOT DO (strict Phase 6 boundary)
--   • No tables, no RLS/policy/grant changes to existing tables, no new
--     indexes: partner-scoped reads are already covered by
--     growth_onboarding_partner_idx (growth_partner_id), and per-partner
--     row counts make further indexes immaterial.
--   • No commission RPC: NO Growth Partner commission model exists in this
--     backend (the staff_commission_* engine is the salon-owner payroll
--     domain and is never partner-readable). Inventing a partner payout
--     formula here is forbidden, so the dashboard shows an honest empty
--     state until a real model is specified.
--   • Read-only: no INSERT/UPDATE/DELETE anywhere. Partners cannot modify
--     amounts, statuses, payouts or referral ownership through this API.
--
-- IDEMPOTENCY: safe to re-run. Only functions are created/replaced; all
-- existing data is preserved; nothing is dropped.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Private gate: the caller must be a signed-in Growth Partner.
--    No EXECUTE grants: SECURITY DEFINER RPCs + owner only.
-- ---------------------------------------------------------------------------
create or replace function public.partner_dashboard_caller()
returns public.growth_partners
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_partner public.growth_partners%rowtype;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select * into v_partner from public.growth_partners where user_id = actor;
  if v_partner.user_id is null then
    raise exception 'Growth Partner access required' using errcode = '42501';
  end if;
  return v_partner;
end;
$$;
revoke all on function public.partner_dashboard_caller() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. get_my_partner_dashboard — one call for the dashboard section.
--    {partner, kpis, recent_activity}. Activity is newest-first, max 8.
-- ---------------------------------------------------------------------------
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

  return jsonb_build_object(
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
    'recent_activity', v_activity
  );
end;
$$;
revoke all on function public.get_my_partner_dashboard() from public, anon;
grant execute on function public.get_my_partner_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_my_partner_referrals — own referrals, filtered + paginated server-side.
--    p_status_filter: all|pending|in_progress|completed (backend statuses
--      linked|template_started|template_completed; anything else is rejected).
--    p_search: case-insensitive display-name match (LIKE metacharacters are
--      escaped, so a search can never become a wildcard probe).
--    Returns {total, limit, offset, rows[]} with masked refs (no user ids).
-- ---------------------------------------------------------------------------
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
  if v_filter not in ('all', 'pending', 'in_progress', 'completed') then
    raise exception 'Unknown referral filter' using errcode = '22023';
  end if;
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
    from public.growth_onboarding o
    left join public.profiles p on p.id = o.user_id
    where o.growth_partner_id = v_partner.user_id
      and (v_filter = 'all'
        or (v_filter = 'pending' and o.status = 'linked')
        or (v_filter = 'in_progress' and o.status = 'template_started')
        or (v_filter = 'completed' and o.status = 'template_completed'))
      and (v_search is null or p.full_name ilike v_like escape '\');

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select '…' || right(o.user_id::text, 8) as ref,
           nullif(btrim(coalesce(p.full_name, '')), '') as display_name,
           o.status as status,
           o.linked_at as linked_at,
           o.template_started_at as template_started_at,
           o.template_completed_at as template_completed_at
      from public.growth_onboarding o
      left join public.profiles p on p.id = o.user_id
      where o.growth_partner_id = v_partner.user_id
        and (v_filter = 'all'
          or (v_filter = 'pending' and o.status = 'linked')
          or (v_filter = 'in_progress' and o.status = 'template_started')
          or (v_filter = 'completed' and o.status = 'template_completed'))
        and (v_search is null or p.full_name ilike v_like escape '\')
      order by o.linked_at desc nulls last, o.user_id desc
      limit v_limit offset v_offset
  ) r;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows
  );
end;
$$;
revoke all on function public.get_my_partner_referrals(text, text, int, int) from public, anon;
grant execute on function public.get_my_partner_referrals(text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_my_partner_performance — server-side aggregates + real monthly history.
--    completion_rate_pct is rounded to 1 decimal (0 when there are no
--    referrals — a fact, never a placeholder). monthly covers the trailing 6
--    calendar months including the current one; months without events carry
--    real zeros, and months are never invented beyond that window.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_partner_performance()
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
  v_started int := 0;
  v_monthly jsonb := '[]'::jsonb;
begin
  select count(*),
         count(*) filter (where o.status = 'template_completed'),
         count(*) filter (where o.template_started_at is not null)
    into v_total, v_completed, v_started
    from public.growth_onboarding o
    where o.growth_partner_id = v_partner.user_id;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb) into v_monthly
  from (
    select to_char(g.m, 'YYYY-MM') as month,
           count(o.user_id) filter (where date_trunc('month', o.linked_at) = g.m) as referred,
           count(o.user_id) filter (where date_trunc('month', o.template_completed_at) = g.m) as completed
      from (
        select date_trunc('month', now()) - (n || ' months')::interval as m
          from generate_series(0, 5) n
      ) g
      left join public.growth_onboarding o
        on o.growth_partner_id = v_partner.user_id
       and (date_trunc('month', o.linked_at) = g.m
         or date_trunc('month', o.template_completed_at) = g.m)
      group by g.m
  ) m;

  return jsonb_build_object(
    'total_referrals', v_total,
    'completed', v_completed,
    'active_onboarding', v_total - v_completed,
    'websites_started', v_started,
    'completion_rate_pct', case
      when v_total = 0 then 0
      else round(v_completed::numeric * 100 / v_total, 1)
    end,
    'monthly', v_monthly
  );
end;
$$;
revoke all on function public.get_my_partner_performance() from public, anon;
grant execute on function public.get_my_partner_performance() to authenticated;

comment on function public.get_my_partner_dashboard() is
'Phase 6: one-call dashboard read for the caller Growth Partner (server KPIs + recent activity). Identity from auth.uid(); own referrals only.';
comment on function public.get_my_partner_referrals(text, text, int, int) is
'Phase 6: own referrals with server-side status filter, display-name search and pagination. Masked refs only — no user ids, no contact data.';
comment on function public.get_my_partner_performance() is
'Phase 6: server-side partner aggregates (totals, completion rate, trailing-6-month history from real instants).';

notify pgrst, 'reload schema';

commit;
