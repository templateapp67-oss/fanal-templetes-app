-- ============================================================================
-- 20260918 — E2E-B: inactive-partner guard on the Growth Partner dashboard RPCs.
-- ============================================================================
-- Corrective migration for the Growth Partner dashboard/referrals backend.
--
-- What was incomplete before this file:
--   The frontend gate (resolveGrowthPartnerGate → 'inactive') denies paused
--   partners the whole area, but the Phase 6 dashboard RPCs never checked
--   is_active: partner_dashboard_caller() only required that a growth_partners
--   row EXIST. A deactivated partner with a still-valid session could
--   therefore call get_my_partner_dashboard / get_my_partner_referrals /
--   get_my_partner_performance directly (PostgREST/anon key) and keep reading
--   their referral data, so the "inactive partner denied" rule was enforced
--   only in the UI. This file makes the backend fail closed for paused
--   partners — the same least-privilege posture the login/area gates already
--   promise.
--
-- Safety properties:
--   • One CREATE OR REPLACE (same signature, same return type, same
--     SECURITY DEFINER + pinned search_path), one re-asserted revoke.
--     No DROP TABLE/COLUMN, no data rewrite, no RLS/policy/grant weakening.
--   • No behavior change for ACTIVE partners (same inputs, same outputs).
--   • Idempotent: safe to re-run (SQL Editor / supabase db push).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Ordering guard — the Phase 6 dashboard backend must be applied first.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.growth_partners') is null then
    raise exception 'Apply supabase/migrations/20260912_growth_partner_onboarding.sql before this file (growth_partners missing).'
      using errcode = '44000';
  end if;
  if to_regprocedure('public.partner_dashboard_caller()') is null then
    raise exception 'Phase 6 backend is incomplete: public.partner_dashboard_caller() is missing. Re-apply supabase/migrations/20260915_growth_partner_dashboard.sql, then re-run this file.'
      using errcode = '44000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. partner_dashboard_caller — now fails closed for PAUSED partners.
--    An inactive partner can still read their OWN growth_partners row through
--    RLS (the gate depends on learning is_active = false), but the dashboard
--    reads — referral lists, KPI counts, activity and performance — are
--    denied exactly like the frontend gate denies the area.
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
  if v_partner.is_active is false then
    raise exception 'Growth Partner access is paused' using errcode = '42501';
  end if;
  return v_partner;
end;
$$;
revoke all on function public.partner_dashboard_caller() from public, anon, authenticated;

comment on function public.partner_dashboard_caller() is
'Phase 6 gate: the caller must be a signed-in ACTIVE Growth Partner. Fails closed (42501) for anonymous, non-partners and paused partners. No EXECUTE grants: SECURITY DEFINER RPCs + owner only.';

notify pgrst, 'reload schema';

commit;
