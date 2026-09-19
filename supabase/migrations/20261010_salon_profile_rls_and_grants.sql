-- ============================================================================
-- Website Editor save permissions — SALON PROFILE RLS + GRANTS (idempotent)
-- ----------------------------------------------------------------------------
-- Fixes the red toast shown by "Save & Update Website":
--
--   "Save failed: Database permission problem — please sign in again. If it
--    persists, confirm the Supabase schema, RLS policies and grants
--    (supabase/migrations, SUPABASE_SETUP.md) are applied."
--
-- WHY THIS FILE EXISTS
--   The editor writes through the caller-scoped transaction
--     save_owner_editor_state(jsonb)
--       └─ nexora_save_owner_workspace(jsonb)   SECURITY DEFINER (owns the tx)
--            └─ sync_owner_contact(jsonb)       SECURITY INVOKER
--   `sync_owner_contact()` runs with the *signed-in owner's* privileges, and
--   it updates public.profiles and upserts public.owner_editor_state. PostgREST
--   answers 401/403 `42501` — which the app can only render as the toast above
--   — when EITHER
--     • the authenticated role lacks table/column privileges
--       ("permission denied for table profiles"), or
--     • the owner-scoped RLS policy is missing/broken
--       ("new row violates row-level security policy for table …").
--   Both halves are required (grants decide who may attempt the statement,
--   policies decide which rows are touched), so a project that applied the
--   tables but not the grants/policies fails every owner save.
--
--   Recent projects can also end up half-migrated: the column-level GRANTs in
--   20260909043304 / 20260909045308 name optional columns (pincode, area,
--   avatar_url, …). On a schema without one of those columns the whole
--   migration errors and rolls back, taking the RPC grants and the
--   owner_editor_state policy with it. Every privilege below is therefore
--   applied per existing column inside a DO block, so no schema variant can
--   abort this migration.
--
-- WHAT IT DOES (all of it safe to run repeatedly)
--   1. RLS ON for the salon-profile table and for the editor-state table.
--   2. Recreates the owner-scoped policies, including the combined
--        "Users can insert/update their own profile"
--          FOR ALL TO authenticated USING (auth.uid() = <owner>) WITH CHECK (…)
--      Applies to whichever salon-profile table this project actually has —
--      public.profiles (this repo), public.salon_profiles or
--      public.website_profiles — and detects the owner column per table
--      (user_id when present, otherwise id; both mean the row belongs to
--      auth.uid()).
--   3. Grants the editor needs: select/insert/update/delete on
--      public.profiles, select/insert/update on public.owner_editor_state, and
--      the column-scoped UPDATE grants on profiles/salons that the save
--      transaction writes.
--        NOTE ON `GRANT ALL`: the incident report asked for
--        `GRANT ALL ON salon_profiles TO authenticated` (here:
--        `grant all on table public.profiles to authenticated`). That is
--        executed verbatim, and the privileges that are NOT row-scoped are
--        revoked immediately afterwards: TRUNCATE bypasses Row Level Security
--        entirely (any signed-in user could wipe every salon's profile row in
--        one statement), while REFERENCES / TRIGGER / MAINTAIN (PG 17+) are
--        DDL/maintenance privileges the save path never uses. Net effect =
--        select, insert, update, delete — the same set
--        20260907_owner_save_grants.sql has always granted for these tables.
--   4. Re-asserts EXECUTE on the save RPCs for authenticated (anon/public stay
--      revoked) and reloads the PostgREST schema cache.
--
-- AFTER RUNNING: sign out and back in once (a token minted before the grants
-- changes is still fine, but the app re-reads its profile on sign-in) and save
-- the editor again. The browser console prints the exact per-operation result
-- under `[Nexora Sync Error]` / `[AutoSave]` if anything is still wrong.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Privileges that are schema-level, not table-level.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) + 2) + 3) SALON PROFILE TABLE(S).
--
-- The row belongs to the signed-in owner. Deployments name this logical table
-- differently: `profiles` (this repo — 00001_init.sql), `salon_profiles` or
-- `website_profiles` (the classic shape, keyed on `user_id`). They all mean
-- the same thing, so every one of them that EXISTS on this project is repaired
-- with the same statements — running this against a project that uses the
-- classic names applies the reported fix verbatim
-- (`... ON salon_profiles FOR ALL USING (auth.uid() = user_id)` and
-- `GRANT ALL ON salon_profiles TO authenticated`) to that table.
--
-- The owner column is detected per table: `user_id` when present, otherwise
-- `id` (both equal auth.uid()).
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  repaired text[] := array[]::text[];
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'role "authenticated" is absent (not a Supabase-style project) — skipping the salon-profile repair.';
    return;
  end if;

  foreach tbl in array array['profiles', 'salon_profiles', 'website_profiles']
  loop
    declare
      qualified text := format('public.%I', tbl);
      owner_column text;
      present text;
      wanted text[] := array[
        'full_name', 'phone', 'mobile', 'whatsapp', 'email', 'pincode',
        'postal_code', 'city', 'preferred_city', 'area', 'preferred_area',
        'address', 'state', 'landmark', 'latitude', 'longitude',
        'avatar_url', 'photo_url', 'owner_photo_url', 'date_of_birth'
      ];
    begin
      if to_regclass(qualified) is null then
        continue; -- this project does not have that spelling of the table
      end if;

      select case
               when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = tbl
                              and column_name = 'user_id') then 'user_id'
               when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = tbl
                              and column_name = 'id') then 'id'
               else null
             end
        into owner_column;
      if owner_column is null then
        raise notice '% has no owner column (id / user_id) — skipping its policy repair.', qualified;
        continue;
      end if;

      -- 1) Row Level Security must be ON: without it the policies below are
      --    inert and the table is readable/writable by every role holding a
      --    GRANT.
      execute format('alter table %s enable row level security', qualified);

      -- 2) Owner-scoped policies. DROP-then-CREATE (not CREATE IF NOT EXISTS,
      --    which Postgres does not support for policies) so a project with a
      --    permissive or missing policy is repaired instead of layered onto.
      execute format('drop policy if exists %I on %s', tbl || '_select_owner', qualified);
      execute format(
        'create policy %I on %s for select using (auth.uid() = %I)',
        tbl || '_select_owner', qualified, owner_column);
      execute format('drop policy if exists %I on %s', tbl || '_insert_owner', qualified);
      execute format(
        'create policy %I on %s for insert with check (auth.uid() = %I)',
        tbl || '_insert_owner', qualified, owner_column);
      execute format('drop policy if exists %I on %s', tbl || '_update_owner', qualified);
      execute format(
        'create policy %I on %s for update using (auth.uid() = %I) with check (auth.uid() = %I)',
        tbl || '_update_owner', qualified, owner_column, owner_column);
      execute format('drop policy if exists %I on %s', tbl || '_delete_owner', qualified);
      execute format(
        'create policy %I on %s for delete using (auth.uid() = %I)',
        tbl || '_delete_owner', qualified, owner_column);

      -- The combined policy named in the incident report. It overlaps the four
      -- above (permissive policies are OR-ed), so it grants the signed-in owner
      -- nothing beyond their own row — but it is the exact "insert/update your
      -- own profile" clause an operator checks for, scoped to `authenticated`.
      execute format('drop policy if exists "Users can insert/update their own profile" on %s', qualified);
      execute format(
        'create policy "Users can insert/update their own profile" on %s for all to authenticated using (auth.uid() = %I) with check (auth.uid() = %I)',
        qualified, owner_column, owner_column);

      -- 3) Table privileges for the signed-in owner (RLS still scopes every
      --    row). `grant all` is what the incident report asks an operator to
      --    confirm; the non-row-scoped privileges it carries are revoked right
      --    after it:
      --      • TRUNCATE is NOT subject to RLS — leaving it granted would let
      --        any signed-in user wipe every salon profile in one statement,
      --      • REFERENCES / TRIGGER (and MAINTAIN on PG 17+) are never used by
      --        the save path.
      --    Net effect: the four DML privileges the editor actually needs.
      execute format('grant all on table %s to authenticated', qualified);
      execute format('revoke truncate, references, trigger on table %s from authenticated', qualified);
      if current_setting('server_version_num')::int >= 170000 then
        execute format('revoke maintain on table %s from authenticated', qualified);
      end if;
      if exists (select 1 from pg_roles where rolname = 'anon') then
        -- Public salon sites read the catalogue anonymously; RLS returns only
        -- the rows a policy allows. Never grant anon a write privilege.
        execute format('grant select on table %s to anon', qualified);
      end if;

      -- Column-level UPDATE grants for every column sync_owner_contact()
      -- writes. Applied per existing column so a schema missing an optional
      -- column (which made 20260909043304/20260909045308 fail as a whole)
      -- still ends up with the privileges the save transaction needs.
      select string_agg(quote_ident(column_name), ', ')
        into present
        from information_schema.columns
       where table_schema = 'public' and table_name = tbl
         and column_name = any (wanted);
      if present is not null then
        execute format('grant update (%s) on table %s to authenticated', present, qualified);
      end if;

      repaired := repaired || tbl;
    end;
  end loop;

  if array_length(repaired, 1) is null then
    raise notice 'no salon-profile table found (looked for public.profiles, public.salon_profiles, public.website_profiles) — apply 00001_init.sql first (skipped).';
  else
    raise notice 'salon-profile policies/grants applied to: %', array_to_string(repaired, ', ');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3b) The editor's durable state row (public.owner_editor_state).
--     save_owner_editor_state() upserts this row AS THE CALLER, so it needs
--     RLS + an owner policy + grants exactly like the profile table.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;
  if to_regclass('public.owner_editor_state') is null then
    raise notice 'public.owner_editor_state does not exist — apply 20260909045308_contact_profile_wiring.sql (skipped).';
    return;
  end if;

  execute 'alter table public.owner_editor_state enable row level security';

  execute 'drop policy if exists editor_owner on public.owner_editor_state';
  execute 'create policy editor_owner on public.owner_editor_state for all to authenticated '
       || 'using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))';

  execute 'grant select, insert, update on table public.owner_editor_state to authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 3c) The salon row sync_owner_contact() touches. RLS policies for the
--     normalized `salons` table live in the production schema this repository
--     does not own, so only the column privileges are (re)asserted here —
--     never a policy, which could weaken the organization-scoped rules.
-- ---------------------------------------------------------------------------
do $$
declare
  present text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;
  if to_regclass('public.salons') is null then
    return; -- no normalized schema on this project
  end if;
  select string_agg(quote_ident(column_name), ', ')
    into present
    from information_schema.columns
   where table_schema = 'public' and table_name = 'salons'
     and column_name = any (array[
       'phone', 'mobile', 'whatsapp', 'email', 'address', 'city', 'area',
       'state', 'pincode', 'landmark', 'latitude', 'longitude', 'data'
     ]);
  if present is not null then
    execute format('grant update (%s) on table public.salons to authenticated', present);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Save/read RPCs: the signed-in owner may execute them, nobody else.
--    grant/revoke run only for functions that exist, so this file also
--    applies cleanly to a project that predates the RPC.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;
  foreach fn in array array[
    'public.save_owner_editor_state(jsonb)',
    'public.nexora_save_owner_workspace(jsonb)',
    'public.nexora_catalog_uuid(uuid,text,text)',
    'public.get_owner_editor_state()',
    'public.sync_owner_contact(jsonb)',
    'public.ensure_owner_workspace()',
    'public.nexora_owner_salon_ids()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public', fn);
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format('revoke all on function %s from anon', fn);
      end if;
      execute format('grant execute on function %s to authenticated', fn);
    end if;
  end loop;
end $$;

-- PostgREST caches privileges/policies; tell it to reload so the fix is live
-- without waiting for the periodic refresh.
notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- VERIFY (run in the Supabase SQL Editor; both halves must be true)
-- ----------------------------------------------------------------------------
-- 1) RLS enabled + owner policies present on the salon-profile table:
--
--   select c.relname as table_name, c.relrowsecurity as rls_enabled,
--          (select count(*) from pg_policies p
--            where p.schemaname='public' and p.tablename=c.relname) as policy_count
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public'
--      and c.relname in ('profiles','salon_profiles','website_profiles','owner_editor_state')
--    order by c.relname;
--   -- expect one row per table this project has, each rls_enabled = t and
--   -- policy_count >= 1 (profiles: 5 here), including
--   -- "Users can insert/update their own profile".
--
-- 2) The signed-in owner has full DML on their own profile row:
--
--   select has_table_privilege('authenticated','public.profiles','SELECT') as can_select,
--          has_table_privilege('authenticated','public.profiles','INSERT') as can_insert,
--          has_table_privilege('authenticated','public.profiles','UPDATE') as can_update,
--          has_table_privilege('authenticated','public.profiles','DELETE') as can_delete;
--   -- expect all true; and TRUNCATE must be FALSE (it bypasses RLS):
--   select has_table_privilege('authenticated','public.profiles','TRUNCATE') as can_truncate,
--          has_table_privilege('authenticated','public.profiles','REFERENCES') as can_references,
--          has_table_privilege('authenticated','public.profiles','TRIGGER') as can_trigger;
--   -- expect all false
--
-- 3) Cross-tenant negative test (catches a policy that is too broad):
--   -- signed in as a second account:
--   select count(*) from public.profiles where id is distinct from auth.uid();
--   -- expect 0
-- ============================================================================
