-- ============================================================================
-- Nexora Salon OS — Strict Owner Salon Tenant Isolation (PHASE 2)
-- Migration: 20261011_strict_owner_salon_isolation.sql
-- ----------------------------------------------------------------------------
-- Enforces strict multi-tenant authorization for owner salon resolution.
-- Resolution MUST originate strictly from:
--   auth.uid()
--       ↓
--   organization_members.user_id (status = 'active', role in ('owner', 'manager'))
--       ↓
--   organization_members.organization_id
--       ↓
--   salons.organization_id
--
-- When no valid owner organization/salon exists for an authenticated user,
-- resolution returns:
--   { status: "needs_onboarding", salon: null }
-- ============================================================================

begin;

-- 1. Canonical owner salon IDs function
create or replace function public.nexora_owner_salon_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $body$
  select s.id
  from public.salons s
  join public.organization_members m on m.organization_id = s.organization_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.role in ('owner', 'manager')
    and (not public.owner_workspace_has_column('salons', 'deleted_at') or s.deleted_at is null);
$body$;

revoke all on function public.nexora_owner_salon_ids() from public, anon;
grant execute on function public.nexora_owner_salon_ids() to authenticated;

-- 2. get_my_owner_workspace - read side with explicit status and salon object
create or replace function public.get_my_owner_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_org uuid;
  v_pick jsonb;
  v_salon uuid;
  v_slug text;
  v_name text;
  v_selection text;
  v_salons jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  if to_regclass('public.organization_members') is null or to_regclass('public.salons') is null then
    return jsonb_build_object(
      'status', 'needs_onboarding',
      'salon', null,
      'resolved', false,
      'organization_id', null,
      'salon_id', null,
      'slug', null,
      'name', null,
      'salon_count', 0,
      'ambiguous', false,
      'selection', null,
      'salons', '[]'::jsonb
    );
  end if;

  execute format($q$select m.organization_id
      from public.organization_members m
      where m.user_id = $1 and m.status = 'active' and m.role in ('owner', 'manager')
      %s limit 1$q$, public.owner_workspace_order_by('organization_members', 'created_at'))
    into v_org using actor;

  if v_org is null then
    return jsonb_build_object(
      'status', 'needs_onboarding',
      'salon', null,
      'resolved', false,
      'organization_id', null,
      'salon_id', null,
      'slug', null,
      'name', null,
      'salon_count', 0,
      'ambiguous', false,
      'selection', null,
      'salons', '[]'::jsonb
    );
  end if;

  v_pick := public.owner_workspace_pick_salon();
  v_salon := nullif(v_pick ->> 'salon_id', '')::uuid;
  v_slug := v_pick ->> 'slug';
  v_name := v_pick ->> 'name';
  v_selection := v_pick ->> 'selection';

  if v_salon is null then
    return jsonb_build_object(
      'status', 'needs_onboarding',
      'salon', null,
      'resolved', false,
      'organization_id', v_org,
      'salon_id', null,
      'slug', null,
      'name', null,
      'salon_count', 0,
      'ambiguous', false,
      'selection', null,
      'salons', '[]'::jsonb
    );
  end if;

  execute format($q$select coalesce(jsonb_agg(jsonb_build_object(
          'salon_id', x.id, 'slug', x.slug, 'name', x.name) order by x.is_pick desc, x.ord desc nulls last, x.id), '[]'::jsonb),
        count(*)
      from (
        select s.id, s.slug, s.name, %s as ord, (s.id = $2) as is_pick
        from public.salons s
        where s.organization_id = $1
          and (not public.owner_workspace_has_column('salons', 'deleted_at') or s.deleted_at is null)
        order by 5 desc, 4 desc nulls last, s.id
        limit 25
      ) x$q$,
      case when public.owner_workspace_has_column('salons', 'created_at')
           then 's.created_at' else 'null::timestamptz' end)
    into v_salons, v_count using v_org, v_salon;

  return jsonb_build_object(
    'status', 'active',
    'salon', jsonb_build_object(
      'id', v_salon,
      'slug', v_slug,
      'name', v_name,
      'organization_id', v_org
    ),
    'resolved', true,
    'organization_id', v_org,
    'salon_id', v_salon,
    'slug', v_slug,
    'name', v_name,
    'salon_count', coalesce(v_count, 0),
    'ambiguous', coalesce(v_count, 0) > 1,
    'selection', v_selection,
    'salons', coalesce(v_salons, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_owner_workspace() from public, anon;
grant execute on function public.get_my_owner_workspace() to authenticated;

-- 3. Dedicated owner salon resolution helper RPC
create or replace function public.get_owner_salon_resolution()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_workspace jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  v_workspace := public.get_my_owner_workspace();
  if (v_workspace ->> 'resolved')::boolean is true and v_workspace -> 'salon' is not null then
    return jsonb_build_object(
      'status', 'resolved',
      'salon', v_workspace -> 'salon'
    );
  else
    return jsonb_build_object(
      'status', 'needs_onboarding',
      'salon', null
    );
  end if;
end;
$$;

revoke all on function public.get_owner_salon_resolution() from public, anon;
grant execute on function public.get_owner_salon_resolution() to authenticated;

notify pgrst, 'reload schema';

commit;
