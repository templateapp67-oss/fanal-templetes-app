-- ============================================================================
-- Nexora Salon OS — Canonical owner→salon resolution (PHASE 10)
-- Migration: 20261006_owner_salon_resolution.sql
-- ----------------------------------------------------------------------------
-- THE PROBLEM THIS CLOSES
--   Ownership authority is already the canonical membership model
--   (`organization_members.user_id/organization_id/role/status` →
--   `nexora_owner_salon_ids()`), and 20261002 created the workspace when an
--   owner has none. What was missing is a RESOLUTION RULE for an owner who has
--   MORE THAN ONE authorized salon:
--
--     • nexora_save_owner_workspace() (20260909142000) picks a target by
--       matching `salons.slug` to `profile.subdomain`, and otherwise requires
--       EXACTLY ONE owned salon — with two or more it raises 'Select a salon
--       owned by this account'. The client turned that into "This account has
--       more than one salon, so the save could not pick one automatically",
--       i.e. a dead end for a perfectly valid account.
--     • get_my_owner_workspace() (20261002) reported `ambiguous = true` and
--       ordered the list oldest-first, so routing refused to move a multi-salon
--       owner off the landing page.
--
-- WHAT IT DOES (functions only — no table, column, index or policy is touched)
--   1. `public.owner_workspace_pick_salon()` — the ONE canonical rule, applied
--      to the caller's AUTHORIZED salons only (the set
--      `nexora_owner_salon_ids()` returns: active owner/manager membership,
--      not deleted):
--        tier 1  the salon this deployment marks primary (only when the
--                deployment actually carries an `is_primary` column) and active
--        tier 2  the most recently created ACTIVE salon
--        tier 3  the first authorized ACTIVE salon (deterministic: oldest, then id)
--        tier 4  the first authorized salon even when inactive — an authorized
--                owner is never dead-ended, and nothing unauthorized is ever
--                returned at any tier
--      The tier that fired is reported as `selection`.
--   2. `public.get_my_owner_workspace()` — same response shape (plus
--      `selection`), the picked salon in the scalar fields AND first in
--      `salons[]`; `ambiguous` is retained but is now purely informational
--      ("more than one live salon exists"), never a reason a caller cannot act.
--   3. `nexora_save_owner_workspace()` — patched through the same
--      pg_get_functiondef + strpos/replace idiom 20260911112000 and
--      20260911113000 already use, so the fallback target is the canonical
--      rule instead of "exactly one salon". The explicit `profile.subdomain`
--      match still wins when it identifies a single authorized salon (that is
--      the owner telling us which salon they mean), and the function still
--      raises 'Select a salon owned by this account' when — and only when —
--      the picker finds NOTHING authorized.
--
-- IDEMPOTENCY / RACES
--   The rule is a read; provisioning stays where it was (ensure_owner_workspace,
--   serialised per caller by a transaction-level advisory lock). Re-running this
--   file is a no-op: the patch is skipped when the replacement is already
--   present, and every function is create-or-replace.
--
-- SAFETY
--   Every column read (is_primary, is_active, deleted_at, created_at) is probed
--   in information_schema first, so this applies to any normalized generation
--   without assuming its exact shape. The save-function patch is skipped
--   entirely on a database that does not have that function (the local gateway
--   chain does not create it), so applying this file can never fail for a
--   missing legacy object.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. The canonical resolution rule.
--
-- Authorization is NOT re-implemented here: every candidate comes from
-- public.nexora_owner_salon_ids(), the existing membership authority. A salon
-- in another organization, a salon of a removed/invited membership, a staff
-- membership's organization and a deleted salon can therefore never be picked.
-- ---------------------------------------------------------------------------
create or replace function public.owner_workspace_pick_salon()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_live text;
  v_active text;
  v_newest text;
  v_oldest text;
  v_id uuid;
  v_slug text;
  v_name text;
begin
  if actor is null then return null; end if;
  if to_regclass('public.salons') is null then return null; end if;
  if to_regprocedure('public.nexora_owner_salon_ids()') is null then return null; end if;

  -- Column probes: a normalized generation is not required to carry any of these.
  v_live := case when public.owner_workspace_has_column('salons', 'deleted_at')
                 then ' and s.deleted_at is null' else '' end;
  v_active := case when public.owner_workspace_has_column('salons', 'is_active')
                 then ' and s.is_active is distinct from false' else '' end;
  v_newest := case when public.owner_workspace_has_column('salons', 'created_at')
                 then ' order by s.created_at desc nulls last, s.id' else ' order by s.id desc' end;
  v_oldest := case when public.owner_workspace_has_column('salons', 'created_at')
                 then ' order by s.created_at asc nulls last, s.id' else ' order by s.id' end;

  -- Tier 1 — primary + active, where the deployment has a primary marker.
  if public.owner_workspace_has_column('salons', 'is_primary') then
    execute format($q$select s.id, s.slug, s.name
        from public.salons s
        where s.id in (select public.nexora_owner_salon_ids())
          and s.is_primary is true%s%s%s
        limit 1$q$, v_live, v_active, v_newest)
      into v_id, v_slug, v_name;
    if v_id is not null then
      return jsonb_build_object('salon_id', v_id, 'slug', v_slug, 'name', v_name, 'selection', 'primary');
    end if;
  end if;

  -- Tier 2 — most recently created active salon.
  execute format($q$select s.id, s.slug, s.name
      from public.salons s
      where s.id in (select public.nexora_owner_salon_ids())%s%s%s
      limit 1$q$, v_live, v_active, v_newest)
    into v_id, v_slug, v_name;
  if v_id is not null then
    return jsonb_build_object('salon_id', v_id, 'slug', v_slug, 'name', v_name, 'selection', 'most-recent');
  end if;

  -- Tier 3 — first authorized active salon.
  execute format($q$select s.id, s.slug, s.name
      from public.salons s
      where s.id in (select public.nexora_owner_salon_ids())%s%s%s
      limit 1$q$, v_live, v_active, v_oldest)
    into v_id, v_slug, v_name;
  if v_id is not null then
    return jsonb_build_object('salon_id', v_id, 'slug', v_slug, 'name', v_name, 'selection', 'first-authorized');
  end if;

  -- Tier 4 — first authorized salon even when the deployment marked it
  -- inactive. Editing a deactivated salon is still the owner's own workspace;
  -- refusing would be a dead end for an authorized account.
  execute format($q$select s.id, s.slug, s.name
      from public.salons s
      where s.id in (select public.nexora_owner_salon_ids())%s%s
      limit 1$q$, v_live, v_oldest)
    into v_id, v_slug, v_name;
  if v_id is not null then
    return jsonb_build_object('salon_id', v_id, 'slug', v_slug, 'name', v_name, 'selection', 'first-authorized-inactive');
  end if;

  return null;
end;
$$;
revoke all on function public.owner_workspace_pick_salon() from public, anon, authenticated;
comment on function public.owner_workspace_pick_salon() is
'PHASE 10: the canonical owner->salon rule (primary active -> most recently created active -> first authorized active -> first authorized), applied ONLY to the salons nexora_owner_salon_ids() authorizes. Returns {salon_id, slug, name, selection} or null. Internal helper: no client grants.';

-- ---------------------------------------------------------------------------
-- 1. get_my_owner_workspace — same shape, canonical target.
--
-- `ambiguous` keeps its old value (more than one live salon exists) but its
-- MEANING changed with this migration: it is information a caller may display,
-- never a reason it cannot act — `resolved` is true whenever an authorized
-- salon exists, because one has already been chosen for it.
-- ---------------------------------------------------------------------------
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
      'resolved', false, 'organization_id', null, 'salon_id', null,
      'slug', null, 'name', null, 'salon_count', 0, 'ambiguous', false,
      'selection', null, 'salons', '[]'::jsonb
    );
  end if;

  execute format($q$select m.organization_id
      from public.organization_members m
      where m.user_id = $1 and m.status = 'active' and m.role in ('owner', 'manager')
      %s limit 1$q$, public.owner_workspace_order_by('organization_members', 'created_at'))
    into v_org using actor;
  if v_org is null then
    return jsonb_build_object(
      'resolved', false, 'organization_id', null, 'salon_id', null,
      'slug', null, 'name', null, 'salon_count', 0, 'ambiguous', false,
      'selection', null, 'salons', '[]'::jsonb
    );
  end if;

  -- PHASE 10: one canonical choice, made from the authorized set.
  v_pick := public.owner_workspace_pick_salon();
  v_salon := nullif(v_pick ->> 'salon_id', '')::uuid;
  v_slug := v_pick ->> 'slug';
  v_name := v_pick ->> 'name';
  v_selection := v_pick ->> 'selection';

  -- Every live salon in the resolved organization, the CHOSEN one first and the
  -- rest newest-first, bounded at 25 so a pathological tenant cannot make this
  -- response unbounded. The ordering column is projected under a fixed alias
  -- because a normalized generation is not required to carry created_at.
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
    'resolved', v_salon is not null,
    'organization_id', v_org,
    'salon_id', v_salon,
    'slug', v_slug,
    'name', v_name,
    'salon_count', coalesce(v_count, 0),
    -- Informational only. Migration 20261006 always picks a target when the
    -- caller has an authorized salon, so several salons no longer block a save.
    'ambiguous', coalesce(v_count, 0) > 1,
    'selection', v_selection,
    'salons', coalesce(v_salons, '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_owner_workspace() from public, anon;
grant execute on function public.get_my_owner_workspace() to authenticated;
comment on function public.get_my_owner_workspace() is
'PART 3 read side of owner workspace resolution, PHASE 10: resolved=true whenever an authorized salon exists and one has been chosen by owner_workspace_pick_salon() (reported as `selection`). ambiguous is informational.';

-- ---------------------------------------------------------------------------
-- 2. nexora_save_owner_workspace — the fallback target is now the canonical
--    rule instead of "exactly one salon".
--
--    Patched in place (pg_get_functiondef + replace) exactly like
--    20260911112000 and 20260911113000 do, so this file never has to restate
--    (and silently diverge from) a 90-line transaction. Missing function =
--    legacy/simplified generation: nothing to patch, and that is not an error.
-- ---------------------------------------------------------------------------
do $patch$
declare
  definition text;
  marker text := 'if candidate_count <> 1 then raise exception ''Select a salon owned by this account'' using errcode=''42501''; end if;';
  replacement text := E'if candidate_count <> 1 then\n  select (public.owner_workspace_pick_salon() ->> ''salon_id'')::uuid into target;\n end if;\n if target is null then raise exception ''Select a salon owned by this account'' using errcode=''42501''; end if;';
begin
  if to_regprocedure('public.nexora_save_owner_workspace(jsonb)') is null then
    return;
  end if;
  select pg_get_functiondef('public.nexora_save_owner_workspace(jsonb)'::regprocedure) into definition;
  if strpos(definition, 'owner_workspace_pick_salon() ->> ''salon_id''') > 0 then
    return; -- already patched
  end if;
  if strpos(definition, marker) = 0 then
    raise exception 'Workspace function changed; no resolution changes applied';
  end if;
  execute replace(definition, marker, replacement);
end
$patch$;

notify pgrst, 'reload schema';

commit;
