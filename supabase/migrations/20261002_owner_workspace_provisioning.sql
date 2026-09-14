-- ============================================================================
-- Nexora Salon OS — Owner / salon workspace resolution + provisioning
-- Migration: 20261002_owner_workspace_provisioning.sql
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- --------------------
-- The PART 3 funnel ends with a verified one-time handoff into the Template
-- App, and everything the owner does next assumes a resolved workspace:
--
--   • public.nexora_save_owner_workspace()  (20260909142000) resolves the
--     target salon through public.nexora_owner_salon_ids() and RAISES
--     'Select a salon owned by this account' when the caller has none.
--   • public.template_website_is_complete() (20260914) branch 1 needs an
--     ACTIVE owner/manager row in public.organization_members, a named +
--     slugged row in public.salons, and an active public.services row.
--   • server/backendContext.ts, server/ownerBookings.ts,
--     server/ownerDashboard.ts and server/siteLookup.ts all read
--     organization_members → salons.
--
-- No committed migration ever created those objects, and nothing in the
-- application ever inserted a row into them: a user who signs up through the
-- Onboarding App arrives in the Template App with a public.profiles row (from
-- handle_new_user) and NO organization, NO membership and NO salon. Saving
-- then fails on the normalized path and completion can never verify on it.
-- This file closes that gap.
--
-- WHAT IT DOES
--   1. Creates public.organizations, public.organization_members and
--      public.salons ONLY IF THEY DO NOT ALREADY EXIST. An existing table is
--      never altered: no column is added, dropped or retyped, no constraint,
--      index, policy or row is touched. On a project that already has the
--      normalized generation these three statements are no-ops.
--   2. Creates public.nexora_owner_salon_ids() ONLY IF IT DOES NOT EXIST, so
--      an existing definition (whatever its shape) is never replaced.
--   3. Adds public.ensure_owner_workspace() — idempotent provisioning of the
--      CALLER's own organization + owner membership + salon — and
--      public.get_my_owner_workspace() — the read side of resolution.
--      Both derive the user from auth.uid(); neither accepts a user id, an
--      organization id or a salon id as a parameter.
--
-- SAFETY
--   • Every column this file writes is probed in information_schema first and
--     interpolated with format('%I'), so a live table with a different or
--     larger column set is written with only the columns it actually has.
--   • ensure_owner_workspace() never raises for a provisioning problem: it
--     returns jsonb with provisioned=false and a safe reason, so a caller in
--     the middle of the handoff can log and continue instead of stranding the
--     user. The only exception it raises is 'Sign in required'.
--   • Writes are serialised per caller with a transaction-level advisory lock,
--     so two concurrent entries cannot create two organizations.
--   • Idempotent and re-runnable: safe for the SQL Editor and `supabase db
--     push`. Nothing is dropped.
-- ============================================================================

begin;

-- gen_random_uuid() is core since PostgreSQL 13; pgcrypto is only a fallback
-- for older projects, so a failure to create it must not fail the migration.
do $ext$
begin
  create extension if not exists pgcrypto;
exception when others then
  null;
end
$ext$;

-- ---------------------------------------------------------------------------
-- 0. Private helpers.
-- ---------------------------------------------------------------------------

create or replace function public.owner_workspace_has_column(p_table text, p_column text)
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
revoke all on function public.owner_workspace_has_column(text, text) from public, anon, authenticated;

-- Deterministic ordering that survives a table without the column: an
-- existing normalized generation is not required to carry created_at, and a
-- bare `order by created_at` would abort the whole resolution.
create or replace function public.owner_workspace_order_by(p_table text, p_column text)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when public.owner_workspace_has_column(p_table, p_column) then format(' order by %I', p_column)
    else ''
  end
$$;
revoke all on function public.owner_workspace_order_by(text, text) from public, anon, authenticated;

-- Canonical, collision-resistant slug: lowercase alphanumerics, dashes
-- between words, truncated, with a random suffix appended by the caller when
-- the candidate is already taken.
create or replace function public.owner_workspace_slugify(p_value text, p_suffix text default null)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_base text;
begin
  v_base := lower(btrim(coalesce(p_value, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  if char_length(v_base) > 40 then v_base := left(v_base, 40); end if;
  v_base := btrim(v_base, '-');
  if v_base = '' then v_base := 'salon'; end if;
  if p_suffix is not null and btrim(p_suffix) <> '' then
    v_base := v_base || '-' || lower(btrim(p_suffix));
  end if;
  return v_base;
end;
$$;
revoke all on function public.owner_workspace_slugify(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Normalized workspace tables — created ONLY when absent.
--
-- The column sets below are exactly the ones this repository already reads
-- (server/backendContext.ts, server/ownerBookings.ts, server/ownerDashboard.ts,
-- server/siteLookup.ts, server/customerAvailability.ts and
-- template_website_is_complete). When the tables already exist this block does
-- nothing at all — no ALTER, no policy, no grant.
-- ---------------------------------------------------------------------------

do $block$
declare
  v_created boolean;
begin
  -- organizations -----------------------------------------------------------
  v_created := to_regclass('public.organizations') is null;
  create table if not exists public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'My Salon',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  if v_created then
    alter table public.organizations enable row level security;
    comment on table public.organizations is
      'Normalized workspace root (created by 20261002 only when absent). Read by clients through get_my_owner_workspace(); written only by ensure_owner_workspace().';
  end if;

  -- organization_members ----------------------------------------------------
  v_created := to_regclass('public.organization_members') is null;
  create table if not exists public.organization_members (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null default 'owner' check (role in ('owner', 'manager', 'staff')),
    status text not null default 'active' check (status in ('active', 'invited', 'removed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, user_id)
  );
  if v_created then
    create index if not exists organization_members_user_idx on public.organization_members(user_id);
    alter table public.organization_members enable row level security;
    comment on table public.organization_members is
      'Normalized workspace membership (created by 20261002 only when absent). owner/manager + active is what nexora_owner_salon_ids() and template_website_is_complete() require.';
  end if;

  -- salons ------------------------------------------------------------------
  v_created := to_regclass('public.salons') is null;
  create table if not exists public.salons (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    slug text not null unique,
    name text not null,
    description text,
    phone text,
    timezone text not null default 'UTC',
    is_active boolean not null default true,
    verified boolean not null default false,
    accepts_online_bookings boolean not null default true,
    data jsonb not null default '{}'::jsonb,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  if v_created then
    create index if not exists salons_organization_idx on public.salons(organization_id);
    alter table public.salons enable row level security;
    comment on table public.salons is
      'Normalized salon/tenant row (created by 20261002 only when absent). slug is the public site address; data.editor_profile carries the editor payload written by nexora_save_owner_workspace().';
  end if;
end
$block$;

-- ---------------------------------------------------------------------------
-- 2. nexora_owner_salon_ids — created ONLY when absent.
--
-- nexora_save_owner_workspace() already calls this; on a project built from
-- this repository alone it did not exist, which made every normalized save
-- fail with "function public.nexora_owner_salon_ids() does not exist".
-- ---------------------------------------------------------------------------

do $fn$
begin
  if to_regprocedure('public.nexora_owner_salon_ids()') is null then
    create function public.nexora_owner_salon_ids()
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
        and s.deleted_at is null
    $body$;
    revoke all on function public.nexora_owner_salon_ids() from public, anon;
    grant execute on function public.nexora_owner_salon_ids() to authenticated;
  end if;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3. ensure_owner_workspace — idempotent provisioning for the CALLER.
--
-- Returns jsonb:
--   { provisioned: boolean,      -- true only when this call created rows
--     reason: text,              -- 'created' | 'existing' | 'legacy-schema'
--                                -- | 'schema-incomplete' | 'failed'
--     organization_id: uuid|null,
--     salon_id: uuid|null,
--     slug: text|null,
--     name: text|null }
--
-- Contract:
--   • identity is auth.uid() only — there is no parameter through which a
--     caller could provision or attach to somebody else's workspace;
--   • a caller who already has an active owner/manager membership with at
--     least one live salon gets it back unchanged (no writes at all);
--   • the normalized objects must all exist, otherwise this is a no-op with
--     reason 'legacy-schema' — the legacy owner-scoped generation
--     (profiles + services.owner_id) keeps working exactly as before;
--   • never raises except for 'Sign in required'.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_owner_workspace()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_org uuid;
  v_salon uuid;
  v_slug text;
  v_name text;
  v_candidate text;
  v_display text;
  v_columns text;
  v_values text;
  v_attempt integer := 0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  -- Nothing to do on a project without the normalized generation.
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_members') is null
     or to_regclass('public.salons') is null then
    return jsonb_build_object(
      'provisioned', false, 'reason', 'legacy-schema',
      'organization_id', null, 'salon_id', null, 'slug', null, 'name', null
    );
  end if;

  -- The columns resolution depends on. Without them the shape is not the one
  -- this repository reads, so refuse rather than write something unexpected.
  if not public.owner_workspace_has_column('organization_members', 'organization_id')
     or not public.owner_workspace_has_column('organization_members', 'user_id')
     or not public.owner_workspace_has_column('organization_members', 'status')
     or not public.owner_workspace_has_column('organization_members', 'role')
     or not public.owner_workspace_has_column('salons', 'organization_id')
     or not public.owner_workspace_has_column('salons', 'slug')
     or not public.owner_workspace_has_column('salons', 'name') then
    return jsonb_build_object(
      'provisioned', false, 'reason', 'schema-incomplete',
      'organization_id', null, 'salon_id', null, 'slug', null, 'name', null
    );
  end if;

  -- Two concurrent entries must not create two organizations.
  perform pg_advisory_xact_lock(hashtext('owner_workspace:' || actor::text));

  -- Already resolved? Return it and write nothing.
  execute format($q$select m.organization_id
      from public.organization_members m
      where m.user_id = $1 and m.status = 'active' and m.role in ('owner', 'manager')
      %s limit 1$q$, public.owner_workspace_order_by('organization_members', 'created_at'))
    into v_org using actor;

  -- No usable membership yet. Reuse one of the caller's EXISTING memberships
  -- only when they are that organization's sole member — i.e. it is their own
  -- empty workspace left in a non-active state. A membership in an
  -- organization that has anybody else in it is somebody else's tenant, and
  -- promoting into it would be a privilege escalation, so that case falls
  -- through and gets a fresh organization instead.
  if v_org is null then
    execute format($q$select m.organization_id
        from public.organization_members m
        where m.user_id = $1
          and not exists (
            select 1 from public.organization_members o
            where o.organization_id = m.organization_id and o.user_id <> m.user_id
          )
        %s limit 1$q$, public.owner_workspace_order_by('organization_members', 'created_at'))
      into v_org using actor;
  end if;

  if v_org is not null then
    execute format($q$select s.id from public.salons s
        where s.organization_id = $1
          and (not public.owner_workspace_has_column('salons', 'deleted_at') or s.deleted_at is null)
        %s limit 1$q$, public.owner_workspace_order_by('salons', 'created_at'))
      into v_salon using v_org;
    if v_salon is not null
       and exists (
         select 1 from public.organization_members m
         where m.organization_id = v_org and m.user_id = actor
           and m.status = 'active' and m.role in ('owner', 'manager')
       ) then
      execute 'select slug, name from public.salons where id = $1' into v_slug, v_name using v_salon;
      return jsonb_build_object(
        'provisioned', false, 'reason', 'existing',
        'organization_id', v_org, 'salon_id', v_salon, 'slug', v_slug, 'name', v_name
      );
    end if;
  end if;

  -- Display name: the best available from the caller's own profile.
  v_display := null;
  if to_regclass('public.profiles') is not null then
    if public.owner_workspace_has_column('profiles', 'salon_name') then
      execute 'select nullif(btrim(salon_name), '''') from public.profiles where id = $1' into v_display using actor;
    end if;
    if v_display is null and public.owner_workspace_has_column('profiles', 'business_name') then
      execute 'select nullif(btrim(business_name), '''') from public.profiles where id = $1' into v_display using actor;
    end if;
    if v_display is null and public.owner_workspace_has_column('profiles', 'full_name') then
      execute 'select nullif(btrim(full_name), '''') from public.profiles where id = $1' into v_display using actor;
    end if;
  end if;
  if v_display is null then v_display := 'My Salon'; end if;

  begin
    -- organization ----------------------------------------------------------
    if v_org is null then
      v_org := gen_random_uuid();
      v_columns := 'id';
      v_values := format('%L', v_org);
      if public.owner_workspace_has_column('organizations', 'name') then
        v_columns := v_columns || ', name';
        v_values := v_values || format(', %L', v_display);
      end if;
      execute format('insert into public.organizations (%s) values (%s)', v_columns, v_values);
    end if;

    -- membership ------------------------------------------------------------
    if not exists (
      select 1 from public.organization_members m
      where m.organization_id = v_org and m.user_id = actor
    ) then
      v_columns := 'organization_id, user_id';
      v_values := format('%L, %L', v_org, actor);
      if public.owner_workspace_has_column('organization_members', 'role') then
        v_columns := v_columns || ', role';
        v_values := v_values || ', ''owner''';
      end if;
      if public.owner_workspace_has_column('organization_members', 'status') then
        v_columns := v_columns || ', status';
        v_values := v_values || ', ''active''';
      end if;
      if public.owner_workspace_has_column('organization_members', 'id') then
        v_columns := 'id, ' || v_columns;
        v_values := format('%L, ', gen_random_uuid()) || v_values;
      end if;
      execute format('insert into public.organization_members (%s) values (%s)', v_columns, v_values);
    else
      -- A pre-existing but inactive/limited row is promoted to an active
      -- owner, so resolution succeeds instead of silently provisioning a
      -- second organization.
      execute $q$update public.organization_members
          set status = 'active',
              role = case when role in ('owner', 'manager') then role else 'owner' end
          where organization_id = $1 and user_id = $2$q$
        using v_org, actor;
    end if;

    -- salon (slug retried on collision) -------------------------------------
    if v_salon is null then
      loop
        v_attempt := v_attempt + 1;
        if v_attempt > 8 then
          return jsonb_build_object(
            'provisioned', false, 'reason', 'failed',
            'organization_id', v_org, 'salon_id', null, 'slug', null, 'name', v_display
          );
        end if;
        v_candidate := public.owner_workspace_slugify(
          v_display,
          case when v_attempt = 1 then null else substr(replace(gen_random_uuid()::text, '-', ''), 1, 6) end
        );
        begin
          v_columns := 'organization_id, slug, name';
          v_values := format('%L, %L, %L', v_org, v_candidate, v_display);
          if public.owner_workspace_has_column('salons', 'id') then
            v_salon := gen_random_uuid();
            v_columns := 'id, ' || v_columns;
            v_values := format('%L, ', v_salon) || v_values;
          end if;
          execute format('insert into public.salons (%s) values (%s)', v_columns, v_values);
          if not public.owner_workspace_has_column('salons', 'id') then
            execute 'select id from public.salons where slug = $1' into v_salon using v_candidate;
          end if;
          v_slug := v_candidate;
          v_name := v_display;
          exit;
        exception
          when unique_violation then
            v_salon := null;
          when check_violation then
            v_salon := null;
        end;
      end loop;
    else
      execute 'select slug, name from public.salons where id = $1' into v_slug, v_name using v_salon;
    end if;

    return jsonb_build_object(
      'provisioned', true, 'reason', 'created',
      'organization_id', v_org, 'salon_id', v_salon, 'slug', v_slug, 'name', v_name
    );
  exception
    when others then
      -- Provisioning is a convenience on top of the handoff, never a gate in
      -- front of it: report safely and let the caller continue.
      return jsonb_build_object(
        'provisioned', false, 'reason', 'failed',
        'organization_id', v_org, 'salon_id', null, 'slug', null, 'name', null
      );
  end;
end;
$$;
revoke all on function public.ensure_owner_workspace() from public, anon;
grant execute on function public.ensure_owner_workspace() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_my_owner_workspace — the read side of resolution.
--
-- SECURITY DEFINER so a client can resolve its own workspace without needing
-- direct table grants; it returns only rows reachable from auth.uid(), and
-- never exposes another tenant's salon.
--
-- It also reports AMBIGUITY instead of hiding it. nexora_save_owner_workspace()
-- picks its target by matching salons.slug to profile.subdomain and otherwise
-- requires exactly one owned salon, raising 'Select a salon owned by this
-- account' when there are two or more. Returning salon_count / ambiguous /
-- salons[] lets a caller tell "no workspace yet" apart from "several
-- workspaces and no way to choose", which are completely different problems.
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
  v_salon uuid;
  v_slug text;
  v_name text;
  v_salons jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if to_regclass('public.organization_members') is null or to_regclass('public.salons') is null then
    return jsonb_build_object(
      'resolved', false, 'organization_id', null, 'salon_id', null,
      'slug', null, 'name', null, 'salon_count', 0, 'ambiguous', false, 'salons', '[]'::jsonb
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
      'slug', null, 'name', null, 'salon_count', 0, 'ambiguous', false, 'salons', '[]'::jsonb
    );
  end if;

  -- Every live salon in the resolved organization, oldest first, so that
  -- salons[0] is the same salon the single-salon fields below report. Bounded
  -- at 25 so a pathological tenant cannot make this response unbounded.
  -- The ordering column is projected under a fixed alias because an existing
  -- normalized generation is not required to carry created_at.
  execute format($q$select coalesce(jsonb_agg(jsonb_build_object(
          'salon_id', x.id, 'slug', x.slug, 'name', x.name) order by x.ord), '[]'::jsonb),
        count(*)
      from (
        select s.id, s.slug, s.name, %s as ord from public.salons s
        where s.organization_id = $1
          and (not public.owner_workspace_has_column('salons', 'deleted_at') or s.deleted_at is null)
        order by 4 limit 25
      ) x$q$,
      case when public.owner_workspace_has_column('salons', 'created_at')
           then 's.created_at' else 'null::timestamptz' end)
    into v_salons, v_count using v_org;

  execute format($q$select s.id, s.slug, s.name from public.salons s
      where s.organization_id = $1
        and (not public.owner_workspace_has_column('salons', 'deleted_at') or s.deleted_at is null)
      %s limit 1$q$, public.owner_workspace_order_by('salons', 'created_at'))
    into v_salon, v_slug, v_name using v_org;

  return jsonb_build_object(
    'resolved', v_salon is not null,
    'organization_id', v_org,
    'salon_id', v_salon,
    'slug', v_slug,
    'name', v_name,
    'salon_count', coalesce(v_count, 0),
    -- More than one salon means the save path cannot pick a target on its own
    -- unless the editor's subdomain matches one of these slugs.
    'ambiguous', coalesce(v_count, 0) > 1,
    'salons', coalesce(v_salons, '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_owner_workspace() from public, anon;
grant execute on function public.get_my_owner_workspace() to authenticated;

comment on function public.ensure_owner_workspace() is
'Idempotent provisioning of the CALLER''s own organization + owner membership + salon. Identity is auth.uid() only. No-op with reason legacy-schema when the normalized tables are absent; never raises except for missing sign-in.';
comment on function public.get_my_owner_workspace() is
'Resolves the caller''s own active owner/manager organization and its first live salon, and reports salon_count/ambiguous/salons so a caller can distinguish "no workspace yet" from "several workspaces, no way to choose". Returns resolved=false rather than raising when there is none.';

notify pgrst, 'reload schema';

commit;
