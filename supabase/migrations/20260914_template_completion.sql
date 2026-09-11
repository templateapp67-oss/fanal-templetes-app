-- ============================================================================
-- Nexora Salon OS — Template website completion tracking (Phase 5)
-- Migration: 20260914_template_completion.sql
-- ----------------------------------------------------------------------------
-- WHAT THIS SCRIPT DOES
--   • Adds `template_website_is_complete()` — the ONE server-side definition
--     of "required website setup finished", evaluated against committed
--     database state (never client claims):
--       normalized production: the caller is an ACTIVE owner/manager of an
--         organization with a salon that has a non-empty slug AND name, plus
--         at least one active service in such salons;
--       legacy owner-scoped generation: the caller's profiles row carries a
--         non-empty subdomain AND salon/business name, plus at least one
--         services row they own.
--     Every table/column is probed defensively (information_schema +
--     dynamic SQL), so each generation evaluates only its own branch and a
--     missing generation can never error — it simply does not verify.
--   • Adds `complete_template_onboarding()` — the Template App completion
--     event (called after the existing explicit cloud save that opens
--     "Website saved successfully!"). Advances the caller's funnel row to
--     template_completed with server timestamps, idempotently. Users with no
--     funnel row are a no-op (nothing created). Referral ownership is never
--     touched; completed rows are never regressed or re-timestamped.
--   • Extends `update_my_onboarding_progress()` (CREATE OR REPLACE, same
--     signature and start-action behavior): its complete_template branch now
--     enforces the SAME website verification, closing the only path that
--     could otherwise mark completion without a finished website.
--
-- WHAT THIS SCRIPT DOES NOT DO (strict Phase 5 boundary)
--   • No new tables (growth_onboarding already stores status + timestamps),
--     no RLS/policy/grant changes, no existing-table alterations, no event
--     framework (the repo has only domain notification tables — booking and
--     staff alerts — and no generic audit log, so the onboarding row itself
--     remains the completion record per the minimal-scope instruction).
--   • No commission/payout/analytics logic; completion state is merely
--     exposed through the existing shared rows for future modules.
--
-- IDEMPOTENCY: safe to re-run. Only functions are created/replaced; all
-- existing data is preserved; nothing is dropped.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Private helpers (no EXECUTE grants: SECURITY DEFINER RPCs + owner only).
-- ---------------------------------------------------------------------------
create or replace function public.template_completion_has_column(p_table text, p_column text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_column
  )
$$;
revoke all on function public.template_completion_has_column(text, text) from public, anon, authenticated;

create or replace function public.template_website_is_complete(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_orgs uuid[] := '{}';
  v_salons uuid[] := '{}';
  v_found boolean := false;
  v_name_col text;
begin
  if p_user_id is null then return false; end if;

  -- Branch 1: normalized production (organization membership + salons + services).
  if public.template_completion_has_column('organization_members', 'organization_id')
     and public.template_completion_has_column('organization_members', 'user_id')
     and public.template_completion_has_column('organization_members', 'status')
     and public.template_completion_has_column('organization_members', 'role')
     and public.template_completion_has_column('salons', 'organization_id')
     and public.template_completion_has_column('salons', 'slug')
     and public.template_completion_has_column('salons', 'name')
     and public.template_completion_has_column('services', 'salon_id')
     and public.template_completion_has_column('services', 'is_active') then
    execute $q$select coalesce(array_agg(distinct m.organization_id), '{}')
      from public.organization_members m
      where m.user_id = $1 and m.status = 'active' and m.role in ('owner', 'manager')$q$
      into v_orgs using p_user_id;
    if coalesce(array_length(v_orgs, 1), 0) > 0 then
      execute $q$select coalesce(array_agg(s.id), '{}') from public.salons s
        where s.organization_id = any($1)
          and btrim(coalesce(s.slug, '')) <> ''
          and btrim(coalesce(s.name, '')) <> ''$q$
        into v_salons using v_orgs;
      if coalesce(array_length(v_salons, 1), 0) > 0 then
        execute $q$select exists (select 1 from public.services v
          where v.salon_id = any($1) and v.is_active is distinct from false)$q$
          into v_found using v_salons;
        if v_found then return true; end if;
      end if;
    end if;
  end if;

  -- Branch 2: legacy owner-scoped generation (profiles + services.owner_id).
  v_name_col := case
    when public.template_completion_has_column('profiles', 'salon_name') then 'salon_name'
    when public.template_completion_has_column('profiles', 'business_name') then 'business_name'
    else null end;
  if v_name_col is not null
     and public.template_completion_has_column('profiles', 'subdomain')
     and public.template_completion_has_column('services', 'owner_id') then
    execute format($q$select exists (select 1 from public.profiles p where p.id = $1
      and btrim(coalesce(p.subdomain, '')) <> '' and btrim(coalesce(p.%I, '')) <> '')$q$, v_name_col)
      into v_found using p_user_id;
    if v_found then
      execute $q$select exists (select 1 from public.services v where v.owner_id = $1)$q$
        into v_found using p_user_id;
      if v_found then return true; end if;
    end if;
  end if;

  return false;
end;
$$;
revoke all on function public.template_website_is_complete(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. complete_template_onboarding — the verified Template App completion event.
--
-- Called after the existing explicit cloud save (the path that opens
-- "Website saved successfully!"). The backend — not the browser — decides:
--   • no funnel row → success no-op (nothing created, completed=false);
--   • already completed → idempotent success (no writes, timestamps kept);
--   • otherwise the live website MUST verify or a safe "not complete yet"
--     error is raised and NOTHING changes (single statement = atomic).
-- On success the row advances to template_completed with server timestamps
-- (template_started_at backfilled only when the user entered via direct
-- Template App use instead of the handoff). Referral ownership columns are
-- never written here.
-- ---------------------------------------------------------------------------
create or replace function public.complete_template_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_row public.growth_onboarding%rowtype;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into v_row from public.growth_onboarding where user_id = actor for update;

  if v_row.user_id is null then
    return jsonb_build_object(
      'status', 'not_started',
      'linked', false,
      'growth_partner_id', null,
      'referral_code', null,
      'linked_at', null,
      'template_started_at', null,
      'template_completed_at', null,
      'completed', false
    );
  end if;

  if v_row.status = 'template_completed' then
    return jsonb_build_object(
      'status', v_row.status,
      'linked', v_row.growth_partner_id is not null,
      'growth_partner_id', v_row.growth_partner_id,
      'referral_code', v_row.referral_code,
      'linked_at', v_row.linked_at,
      'template_started_at', v_row.template_started_at,
      'template_completed_at', v_row.template_completed_at,
      'completed', true
    );
  end if;

  if not public.template_website_is_complete(actor) then
    raise exception 'Your website setup is not complete yet.' using errcode = '22023';
  end if;

  update public.growth_onboarding
  set status = 'template_completed',
      template_started_at = coalesce(template_started_at, now()),
      template_completed_at = now(),
      updated_at = now()
  where user_id = actor;

  select * into v_row from public.growth_onboarding where user_id = actor;
  return jsonb_build_object(
    'status', v_row.status,
    'linked', v_row.growth_partner_id is not null,
    'growth_partner_id', v_row.growth_partner_id,
    'referral_code', v_row.referral_code,
    'linked_at', v_row.linked_at,
    'template_started_at', v_row.template_started_at,
    'template_completed_at', v_row.template_completed_at,
    'completed', true
  );
end;
$$;
revoke all on function public.complete_template_onboarding() from public, anon;
grant execute on function public.complete_template_onboarding() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. update_my_onboarding_progress — same contract, with completion now bound
--    to the verified website check (closes the bypass the task forbids).
--    Start-action behavior, idempotency and response shape are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_onboarding_progress(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_row public.growth_onboarding%rowtype;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_action not in ('start_template', 'complete_template') then
    raise exception 'Unknown onboarding action' using errcode = '22023';
  end if;

  insert into public.growth_onboarding as o (user_id) values (actor)
  on conflict (user_id) do nothing;

  select * into v_row from public.growth_onboarding where user_id = actor for update;

  if v_action = 'start_template' then
    if v_row.status in ('not_started', 'linked') then
      update public.growth_onboarding as o
      set status = 'template_started',
          template_started_at = now(),
          updated_at = now()
      where o.user_id = actor;
      select * into v_row from public.growth_onboarding where user_id = actor;
    end if;
  else
    if v_row.status in ('not_started', 'linked') or v_row.template_started_at is null then
      raise exception 'Start the template before completing it' using errcode = '22023';
    end if;
    if v_row.status <> 'template_completed' then
      -- Phase 5: completion requires a verified finished website — the same
      -- check as complete_template_onboarding(), no bypass.
      if not public.template_website_is_complete(actor) then
        raise exception 'Your website setup is not complete yet.' using errcode = '22023';
      end if;
      update public.growth_onboarding as o
      set status = 'template_completed',
          template_completed_at = now(),
          updated_at = now()
      where o.user_id = actor;
      select * into v_row from public.growth_onboarding where user_id = actor;
    end if;
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'linked', v_row.growth_partner_id is not null,
    'growth_partner_id', v_row.growth_partner_id,
    'referral_code', v_row.referral_code,
    'linked_at', v_row.linked_at,
    'template_started_at', v_row.template_started_at,
    'template_completed_at', v_row.template_completed_at
  );
end;
$$;
revoke all on function public.update_my_onboarding_progress(text) from public, anon;
grant execute on function public.update_my_onboarding_progress(text) to authenticated;

comment on function public.template_website_is_complete(uuid) is
'Phase 5: true iff the user has a finished website in committed DB state (normalized: active owner/manager org + named slugged salon + active service; legacy: profiles subdomain+name + owned service). Branches probe their own schema generation.';
comment on function public.complete_template_onboarding() is
'Phase 5: verified Template App completion event. Advances the caller funnel row to template_completed with server timestamps (idempotent); no row → no-op; referral ownership untouched.';
comment on function public.update_my_onboarding_progress(text) is
'Phase 1 progress stepper as extended by Phase 5: complete_template now requires the verified website check (template_website_is_complete). Start behavior unchanged.';

notify pgrst, 'reload schema';

commit;
