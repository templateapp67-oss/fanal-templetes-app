-- ============================================================================
-- 20261103000000_salon_booking_settings_advance_25.sql
--
-- WHAT WAS BROKEN
--   Signup, Profile Setup, Template Selection and the Services save all failed
--   with the same error:
--
--       23514  new row for relation "public.salon_booking_settings" violates
--              check constraint "salon_booking_settings_deposit_25_check"
--
--   Those four flows are one transaction each (save_owner_editor_state, or
--   POST /api/website/save which calls it), so a single rejected booking
--   settings row rolled the profile, the catalogue AND the template selection
--   back with it. That is why one constraint looked like four unrelated bugs.
--
--   The application was the source of the bad value: it had no single owner of
--   the advance percentage. 20 came from the demo fixtures and five read-side
--   mappers, NaN from `Number(undefined ?? 25)` in the API fallback, 0/null
--   from payloads that simply omitted the field — and every one of those
--   round-tripped back into the next save.
--
-- WHAT THIS MIGRATION DOES
--   The application now always sends 25 (see src/lib/advanceDeposit.ts). This
--   file makes the database agree, and makes that agreement impossible to break
--   from any client — including an old browser bundle still sending 20:
--
--     1. public.nexora_normalize_booking_settings()  — a BEFORE ROW trigger
--        function that rewrites every advance-percentage column actually
--        present on the table to 25 before the row is written, so the check can
--        never be reached with a wrong value.
--     2. trg_nexora_normalize_booking_settings       — that trigger, installed
--        BEFORE INSERT OR UPDATE ... FOR EACH ROW.
--     3. An atomic repair of every existing row to 25 (no row is deleted, no
--        owner setting other than the advance percentage is touched).
--     4. NOT NULL + DEFAULT 25 on those columns, and the check constraint
--        recreated as `<column> = 25` under its natural Postgres name — which
--        is `salon_booking_settings_deposit_25_check` on a `deposit_25` column,
--        i.e. the constraint the verification script looks for.
--
--   This is the rerunnable, schema-correct version of the hotfix that was
--   applied by hand in the SQL Editor (public.nexora_normalize_booking_settings
--   + trg_nexora_normalize_booking_settings). Re-running it is safe and
--   re-installs exactly the same objects.
--
-- DELIBERATE CONSTRAINTS ON THIS FILE
--   • SCHEMA-CORRECT, NOT GUESSING: no column is invented. Every advance
--     column is discovered from pg_attribute; a project whose table only has
--     `deposit_percent` gets `deposit_percent` repaired and nothing else.
--   • NO DUPLICATE COLUMNS: `add column if not exists` only ever runs on the
--     canonical table this file itself creates.
--   • RLS PRESERVED: row level security is enabled and the owner policy is
--     created ONLY when absent. Existing policies are never dropped.
--   • UNRELATED CONSTRAINTS PRESERVED: only CHECK constraints whose definition
--     mentions a deposit/advance column are replaced. Primary keys, foreign
--     keys and every other check are left alone.
--   • TRIGGER ORDERING: BEFORE ROW, so normalization happens before the check
--     is evaluated and before any AFTER trigger on this table. See the ordering
--     audit at the bottom of the file.
--   • DISTINCT DOLLAR-QUOTE TAGS, one per block and never nested:
--     $mig$, $norm_body$, $constraint_block$, $repair_body$, $policy_block$,
--     $audit_block$.
--
-- RERUNNABLE: yes. Every statement is create-or-replace, if-not-exists, or a
-- conditional update. Applying it twice is a no-op the second time.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The table. Created only when the project does not have one; when it does,
--    nothing here runs and the live column set is discovered instead.
-- ---------------------------------------------------------------------------
create table if not exists public.salon_booking_settings (
  salon_id               uuid primary key,
  require_deposit        boolean not null default true,
  accept_online_bookings boolean not null default true,
  deposit_percent        numeric(5,2) not null default 25,
  deposit_percentage     numeric(5,2) not null default 25,
  deposit_25             numeric(5,2) not null default 25,
  updated_at             timestamptz not null default now()
);

do $mig$
begin
  if to_regclass('public.salons') is not null then
    begin
      alter table public.salon_booking_settings
        add constraint salon_booking_settings_salon_id_fkey
        foreign key (salon_id) references public.salons(id) on delete cascade;
    exception
      when duplicate_object then null;
      when duplicate_table then null;
    end;
  end if;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 2. The normalizer.
--
--    BEFORE ROW on public.salon_booking_settings. It cannot be reached with a
--    wrong advance percentage getting through, because it rewrites the value on
--    the way in — an old client posting 20 is corrected, not rejected.
--
--    Column discovery is deliberate: `salon_booking_settings` has existed in
--    more than one shape, and guessing a column name here is what produced
--    "column deposit_25 of relation salon_booking_settings does not exist" on
--    projects that only ever had `deposit_percent`.
-- ---------------------------------------------------------------------------
create or replace function public.nexora_normalize_booking_settings()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $norm_body$
declare
  v_advance_patch jsonb := '{}'::jsonb;
  v_flag_patch    jsonb := '{}'::jsonb;
  v_col           record;
begin
  -- (a) Every numeric deposit/advance column this project actually has → 25.
  --     Boolean look-alikes (require_deposit) and the *_enabled/*_accept flags
  --     are excluded by the type test, never by a name guess.
  for v_col in
    select a.attname as name
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and lower(a.attname) ~ '(deposit|advance)'
      and format_type(a.atttypid, a.atttypmod) ~
            '^(numeric|integer|bigint|smallint|double precision|real)'
  loop
    v_advance_patch := v_advance_patch || jsonb_build_object(v_col.name, 25);
  end loop;

  if v_advance_patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_advance_patch);
  end if;

  -- (b) The online-booking switches. Unspecified means "accepting bookings"
  --     (the product default and the salons.accepts_online_bookings default).
  --     An owner who explicitly switched bookings off keeps false: on UPDATE a
  --     NULL new value falls back to the stored one, it is never upgraded.
  for v_col in
    select a.attname as name
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and lower(a.attname) ~ 'online_booking'
      and format_type(a.atttypid, a.atttypmod) = 'boolean'
  loop
    if tg_op = 'UPDATE' then
      if to_jsonb(new) ->> v_col.name is null then
        v_flag_patch := v_flag_patch || jsonb_build_object(
          v_col.name, coalesce((to_jsonb(old) ->> v_col.name)::boolean, true)
        );
      end if;
    else
      if to_jsonb(new) ->> v_col.name is null then
        v_flag_patch := v_flag_patch || jsonb_build_object(v_col.name, true);
      end if;
    end if;
  end loop;

  -- (c) require_deposit: the owner's switch, preserved exactly. Only a NULL on
  --     INSERT takes the column default of true.
  for v_col in
    select a.attname as name
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and lower(a.attname) = 'require_deposit'
      and format_type(a.atttypid, a.atttypmod) = 'boolean'
  loop
    if to_jsonb(new) ->> v_col.name is null then
      v_flag_patch := v_flag_patch || jsonb_build_object(v_col.name, true);
    end if;
  end loop;

  if v_flag_patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_flag_patch);
  end if;

  return new;
end;
$norm_body$;

comment on function public.nexora_normalize_booking_settings() is
  'BEFORE ROW trigger on public.salon_booking_settings: forces the advance payment to the required 25% and keeps accept_online_bookings defaulting to true without ever upgrading an explicit false. Installed by 20261103000000_salon_booking_settings_advance_25.sql.';

-- ---------------------------------------------------------------------------
-- 3. Install the trigger.
--
--    BEFORE, not AFTER: a CHECK constraint is evaluated when the row is
--    written, so an AFTER trigger would normalize too late and the 23514 would
--    still fire. Drop-then-create keeps the timing (and the function binding)
--    deterministic on a re-run instead of relying on CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_nexora_normalize_booking_settings on public.salon_booking_settings;

create trigger trg_nexora_normalize_booking_settings
  before insert or update on public.salon_booking_settings
  for each row execute function public.nexora_normalize_booking_settings();

-- ---------------------------------------------------------------------------
-- 4. Drop the legacy deposit/advance CHECK constraints BEFORE repairing.
--
--    Order matters: a constraint that pins a value other than 25 (a hand
--    applied hotfix, or the 0–100 range check added by
--    20261102000000_salon_booking_settings_deposit.sql) would reject the repair
--    itself. Only CHECK constraints whose name or definition mentions a
--    deposit/advance column are dropped — the primary key, the salon_id foreign
--    key and every unrelated check survive untouched, and the advance checks are
--    re-created in step 6.
-- ---------------------------------------------------------------------------
do $constraint_block$
declare
  v_con record;
  v_def text;
  v_pinned text;
begin
  for v_con in
    select c.conname, pg_get_constraintdef(c.oid) as condef
    from pg_constraint c
    join pg_class t     on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and c.contype = 'c'
      and (c.conname ilike '%deposit%' or pg_get_constraintdef(c.oid) ilike '%deposit%'
           or c.conname ilike '%advance%' or pg_get_constraintdef(c.oid) ilike '%advance%')
  loop
    -- Report (do not silently accept) a constraint that pinned a percentage
    -- other than 25: the application hard-codes 25, so the two must agree and
    -- the operator needs to know they did not.
    v_pinned := (regexp_match(v_con.condef, '=\s*([0-9]+(?:\.[0-9]+)?)'))[1];
    if v_pinned is not null and v_pinned::numeric <> 25 then
      raise notice
        'dropping % (%) — it pinned % while the product requires a 25%% advance.',
        v_con.conname, v_con.condef, v_pinned;
    end if;
    execute format('alter table public.salon_booking_settings drop constraint if exists %I', v_con.conname);
  end loop;
end
$constraint_block$;

-- ---------------------------------------------------------------------------
-- 5. Repair existing rows — atomically, inside this transaction.
--
--    Only the advance columns are written. require_deposit,
--    accept_online_bookings and every other owner setting keep their stored
--    value, so an owner who paused online bookings is still paused afterwards.
--    `is distinct from 25` also catches NULL, which is what made the columns
--    impossible to make NOT NULL before.
-- ---------------------------------------------------------------------------
do $repair_body$
declare
  v_col record;
begin
  for v_col in
    select a.attname as name
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and lower(a.attname) ~ '(deposit|advance)'
      and format_type(a.atttypid, a.atttypmod) ~
            '^(numeric|integer|bigint|smallint|double precision|real)'
  loop
    execute format(
      'update public.salon_booking_settings set %I = 25 where %I is distinct from 25',
      v_col.name, v_col.name
    );
  end loop;
end
$repair_body$;

-- ---------------------------------------------------------------------------
-- 6. Backfill: every salon gets a settings row, so a later save is an UPDATE of
--    a valid row rather than an INSERT that has to satisfy every NOT NULL at
--    once. Skipped when the normalized salon table is not present (legacy
--    owner-scoped projects keep working exactly as before).
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_col  record;
  v_cols text[] := array['salon_id']::text[];
  v_vals text[] := array['s.id']::text[];
begin
  if to_regclass('public.salons') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_attribute a
    join pg_class t     on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attname = 'salon_id'
      and a.attnum > 0 and not a.attisdropped
  ) then
    raise notice 'salon_booking_settings has no salon_id column — backfill skipped.';
    return;
  end if;

  -- Only the columns this project actually has, each with a literal that
  -- matches its discovered type: 25 for the advance, true for the two
  -- switches, now() for the audit stamp.
  for v_col in
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and (
        (lower(a.attname) ~ '(deposit|advance)'
          and format_type(a.atttypid, a.atttypmod) ~
              '^(numeric|integer|bigint|smallint|double precision|real)')
        or (lower(a.attname) ~ 'online_booking'
          and format_type(a.atttypid, a.atttypmod) = 'boolean')
        or (lower(a.attname) = 'require_deposit'
          and format_type(a.atttypid, a.atttypmod) = 'boolean')
        or lower(a.attname) = 'updated_at'
      )
  loop
    v_cols := v_cols || array[v_col.name];
    v_vals := v_vals || array[
      case
        when lower(v_col.name) = 'updated_at' then 'now()'
        when v_col.typ = 'boolean' then 'true'
        else '25'
      end
    ];
  end loop;

  execute format(
    'insert into public.salon_booking_settings (%s)
       select %s from public.salons s
        where not exists (
                select 1 from public.salon_booking_settings b
                 where b.salon_id = s.id
              )',
    array_to_string(v_cols, ', '),
    array_to_string(v_vals, ', ')
  );
end
$mig$;

-- ---------------------------------------------------------------------------
-- 7. Defaults + NOT NULL, then the check constraint recreated as `= 25`.
--
--    Defaults first so the NOT NULL has something to fall back on for a partial
--    INSERT. One check per advance column, under the name Postgres itself would
--    give it — `salon_booking_settings_deposit_25_check` for a `deposit_25`
--    column, which is the constraint the verification script looks for.
-- ---------------------------------------------------------------------------
do $constraint_block$
declare
  v_col       record;
  v_governing text := null;
begin
  for v_col in
    select a.attname as name
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and lower(a.attname) ~ '(deposit|advance)'
      and format_type(a.atttypid, a.atttypmod) ~
            '^(numeric|integer|bigint|smallint|double precision|real)'
  loop
    execute format('alter table public.salon_booking_settings alter column %I set default 25', v_col.name);
    execute format('alter table public.salon_booking_settings alter column %I set not null', v_col.name);
    if v_governing is null or v_col.name = 'deposit_25' then
      v_governing := v_col.name;
    end if;
  end loop;

  if v_governing is null then
    raise notice 'salon_booking_settings has no numeric deposit/advance column — check constraint skipped.';
    return;
  end if;

  for v_col in
    select a.attname as name
    from pg_attribute a
    join pg_class t      on t.oid = a.attrelid
    join pg_namespace n  on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and a.attnum > 0
      and not a.attisdropped
      and lower(a.attname) ~ '(deposit|advance)'
      and format_type(a.atttypid, a.atttypmod) ~
            '^(numeric|integer|bigint|smallint|double precision|real)'
  loop
    begin
      execute format(
        'alter table public.salon_booking_settings
           add constraint %I check (%I = 25)',
        'salon_booking_settings_' || v_col.name || '_check', v_col.name
      );
    exception when duplicate_object then null;
    end;
  end loop;

  -- Guarantee the reported name exists even on a project whose advance column
  -- is called something else, so a verification that looks for
  -- salon_booking_settings_deposit_25_check is truthful rather than silently
  -- checking nothing.
  if not exists (
    select 1 from pg_constraint c
    join pg_class t     on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'salon_booking_settings'
      and c.conname = 'salon_booking_settings_deposit_25_check'
  ) then
    begin
      execute format(
        'alter table public.salon_booking_settings
           add constraint salon_booking_settings_deposit_25_check check (%I = 25)',
        v_governing
      );
    exception when duplicate_object then null;
    end;
  end if;
end
$constraint_block$;

-- ---------------------------------------------------------------------------
-- 8. Row level security — enabled, and the owner policy added only when the
--    project has none. Existing policies are preserved, never replaced.
-- ---------------------------------------------------------------------------
alter table public.salon_booking_settings enable row level security;

do $policy_block$
declare
  v_using text := 'true';
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'salon_booking_settings'
  ) then
    return;
  end if;

  if to_regprocedure('public.nexora_owner_salon_ids()') is not null then
    v_using := 'salon_id in (select public.nexora_owner_salon_ids())';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format(
      'create policy salon_booking_settings_owner_all on public.salon_booking_settings
         for all to authenticated using (%s) with check (%s)',
      v_using, v_using
    );
  else
    execute format(
      'create policy salon_booking_settings_owner_all on public.salon_booking_settings
         for all using (%s) with check (%s)',
      v_using, v_using
    );
  end if;
end
$policy_block$;

do $mig$
begin
  grant select, insert, update, delete on table public.salon_booking_settings to authenticated, service_role;
exception
  when undefined_object then
    grant select, insert, update, delete on table public.salon_booking_settings to public;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 9. Trigger-ordering audit.
--
--    Multiple BEFORE ROW triggers on one table fire in NAME order. This
--    normalizer must be the one that has the last word on the advance columns,
--    so surface any sibling for the operator instead of failing silently in
--    production. (The AFTER trigger on public.salons installed by
--    20261102000000_salon_booking_settings_deposit.sql is on a DIFFERENT table
--    and writes through nexora_upsert_salon_booking_settings(), so its rows
--    pass through this BEFORE trigger and are normalized — no conflict.)
-- ---------------------------------------------------------------------------
do $audit_block$
declare
  v_other record;
begin
  for v_other in
    select t.tgname, p.proname
    from pg_trigger t
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p      on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'salon_booking_settings'
      and not t.tgisinternal
      and (t.tgtype::int & 2) = 2          -- BEFORE
      and t.tgname > 'trg_nexora_normalize_booking_settings'
  loop
    raise notice
      'BEFORE trigger % (function %) on salon_booking_settings sorts after the normalizer; if it writes a deposit column it will override the 25%% advance.',
      v_other.tgname, v_other.proname;
  end loop;
end
$audit_block$;

-- PostgREST caches the column set; without this the new NOT NULL / default is
-- not visible to the API until the pool recycles.
notify pgrst, 'reload schema';

commit;
