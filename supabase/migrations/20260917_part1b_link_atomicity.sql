-- ============================================================================
-- 20260917 — Part 1B link hardening (atomic single-winner + account check).
-- ============================================================================
-- Corrective migration for the Growth Partner / referral link path.
--
-- What was incomplete before this file:
--   1. No atomic single-winner backstop: link_my_growth_referral() serialized
--      racers with SELECT … FOR UPDATE and then ran an UNCONDITIONAL update.
--      Under concurrent double-submits (two tabs, retries, network replays)
--      safety rested on the row lock alone. The update is now conditional
--      (… AND growth_partner_id IS NULL) with a GET DIAGNOSTICS row_count
--      guard, so exactly one concurrent request can win even if the
--      pre-check ever races — the same pattern exchange_template_handoff()
--      (20260913) already uses for its single-use grant.
--   2. No account-existence check: the RPC required auth.uid() but never
--      verified the caller still exists in auth.users (Part 1B Step 5:
--      "authenticated user exists"). A fail-closed existence check is added;
--      it reuses the generic 'Sign in required' / 42501 outcome so the
--      error reveals nothing about account state (no oracle).
--
-- Safety properties:
--   • Additive/convergent only: one CREATE OR REPLACE (same signature,
--     same return shape, same SECURITY DEFINER + pinned search_path), one
--     re-asserted EXECUTE grant. No DROP TABLE/COLUMN, no data rewrite,
--     no RLS/policy/grant weakening anywhere.
--   • No behavior change for sequential callers: same inputs, same outputs,
--     same error messages ('already linked' included).
--   • Idempotent: safe to re-run (SQL Editor / supabase db push).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Ordering guard — the Part 1 base backend must be applied first.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.growth_partners') is null
     or to_regclass('public.growth_onboarding') is null then
    raise exception 'Apply supabase/migrations/20260912_growth_partner_onboarding.sql before this file (growth_partners / growth_onboarding missing).'
      using errcode = '44000';
  end if;
  if to_regprocedure('public.link_my_growth_referral(text)') is null then
    raise exception 'Part 1 backend is incomplete: public.link_my_growth_referral(text) is missing. Re-apply supabase/migrations/20260912_growth_partner_onboarding.sql, then re-run this file.'
      using errcode = '44000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. link_my_growth_referral — hardened (same contract, atomic claim).
--
-- One-way, one-time: succeeds only when the caller's row is currently
-- unlinked. An already-linked account can NEVER change its referral owner
-- through this RPC (ownership is immutable). Self-referral is rejected.
-- Identity comes ONLY from auth.uid() — there is no user_id / partner_id /
-- owner_id parameter to inject. Returns {growth_partner_id, referral_code,
-- linked_at, status, partner_name}.
-- ---------------------------------------------------------------------------
create or replace function public.link_my_growth_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_code text := public.growth_normalize_code(p_code);
  v_partner uuid;
  v_status text;
  v_linked_at timestamptz;
  v_current_partner uuid;
  v_updated integer := 0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  -- Fail closed when the JWT subject has no live account row. Same message
  -- and code as the missing-session branch: callers cannot distinguish the
  -- two, so this check is not an account-existence oracle.
  if not exists (select 1 from auth.users where id = actor) then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'Invalid referral code' using errcode = '22023';
  end if;
  select gp.user_id into v_partner
  from public.growth_partners gp
  where gp.referral_code = v_code and gp.is_active;
  if v_partner is null then
    raise exception 'Invalid or inactive referral code' using errcode = '22023';
  end if;
  if v_partner = actor then
    raise exception 'You cannot use your own referral code' using errcode = '22023';
  end if;

  insert into public.growth_onboarding as o (user_id) values (actor)
  on conflict (user_id) do nothing;

  -- Serialize racers on the caller's own row; refuse fast when already linked.
  select o.growth_partner_id into v_current_partner
  from public.growth_onboarding as o where o.user_id = actor for update;
  if v_current_partner is not null then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  -- Atomic claim: the predicate is the backstop that lets exactly one
  -- concurrent request win (the lock above serializes; this decides).
  update public.growth_onboarding as o
  set growth_partner_id = v_partner,
      referral_code = v_code,
      linked_at = now(),
      status = case when o.status = 'not_started' then 'linked' else o.status end,
      updated_at = now()
  where o.user_id = actor
    and o.growth_partner_id is null
  returning o.status, o.linked_at into v_status, v_linked_at;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'growth_partner_id', v_partner,
    'referral_code', v_code,
    'linked_at', v_linked_at,
    'status', v_status,
    'partner_name', public.growth_partner_display_name(v_partner)
  );
end;
$$;

comment on function public.link_my_growth_referral(text) is
'Phase 1 shared onboarding: one-time link of the caller to a Growth Partner. Refuses to overwrite an existing link (ownership immutable). Atomic single-winner claim (conditional update + row_count backstop) plus a fail-closed auth.users existence check.';

-- ---------------------------------------------------------------------------
-- 2. Grant convergence — least privilege for the hardened RPC (identical to
--    the designed state; CREATE OR REPLACE already preserves grants, this
--    re-assertion only repairs drift).
-- ---------------------------------------------------------------------------
revoke all on function public.link_my_growth_referral(text) from public, anon;
grant execute on function public.link_my_growth_referral(text) to authenticated;

notify pgrst, 'reload schema';

commit;
