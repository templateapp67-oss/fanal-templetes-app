-- ============================================================================
-- 20260916 — Part 1 referral backend hardening (convergence + provisioning).
-- ============================================================================
-- Corrective migration for the shared Growth Partner / referral backend.
--
-- What was incomplete before this file:
--   1. Silent code rotation: provision_growth_partner() with p_code omitted
--      generated a NEW random code even for an EXISTING partner — so an admin
--      call meant only to deactivate (p_active := false) also rotated the
--      partner's public code. Omitted codes now keep the current code and
--      auto-generate only for brand-new partners (explicit p_code still
--      rotates intentionally).
--   2. No usable first-partner bootstrap: provisioning required a raw
--      auth.users UUID. Adds provision_growth_partner_by_email() (admin-only,
--      revoked from every client role).
--   3. No convergence: a partial/failed earlier apply (or later drift) could
--      leave the backend with a missing index, check, trigger, policy or
--      grant — or, worse, with an over-broad grant. This file re-asserts
--      every Part 1 object to its designed state and is safe to re-run.
--   4. No collision protection: CREATE TABLE IF NOT EXISTS silently reuses a
--      pre-existing table of the same name. Ordering + shape guards below
--      fail the migration loudly instead of building on a wrong object.
--
-- Safety properties:
--   • Additive/convergent only: no DROP TABLE/COLUMN, no data rewrite.
--   • Never weakens: grants/policies are re-asserted to the designed
--     least-privilege state (SELECT-only tables, EXECUTE-only user RPCs,
--     provision/helpers revoked from all clients).
--   • Never clobbers later phases: update_my_onboarding_progress() is NOT
--     redefined here (20260914 binds its complete-branch to server-side
--     verification); only its EXECUTE grant is re-asserted.
--   • Idempotent: re-running repairs drift and succeeds.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Ordering guard — 20260912 must be applied first.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.growth_partners') is null
     or to_regclass('public.growth_onboarding') is null then
    raise exception 'Apply supabase/migrations/20260912_growth_partner_onboarding.sql before this file (growth_partners / growth_onboarding missing).'
      using errcode = '44000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Shape guards — refuse to build on a wrong pre-existing table.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cols text[];
begin
  select coalesce(array_agg(c.column_name::text), '{}') into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'growth_partners';
  if not (v_cols @> array['user_id', 'referral_code', 'is_active', 'created_at', 'updated_at']) then
    raise exception 'Refusing to converge: public.growth_partners has an unexpected shape (%). Resolve the name collision before migrating.', array_to_string(v_cols, ', ')
      using errcode = '44000';
  end if;

  select coalesce(array_agg(c.column_name::text), '{}') into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'growth_onboarding';
  if not (v_cols @> array['user_id', 'growth_partner_id', 'referral_code', 'status', 'linked_at', 'template_started_at', 'template_completed_at', 'created_at', 'updated_at']) then
    raise exception 'Refusing to converge: public.growth_onboarding has an unexpected shape (%). Resolve the name collision before migrating.', array_to_string(v_cols, ', ')
      using errcode = '44000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Function-existence assertion — fail loudly (not cryptically) when a
--    Part 1 routine was dropped after 20260912.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.growth_normalize_code(text)',
    'public.growth_partner_display_name(uuid)',
    'public.growth_touch_updated_at()',
    'public.validate_growth_referral_code(text)',
    'public.link_my_growth_referral(text)',
    'public.get_my_growth_referral()',
    'public.get_my_onboarding_status()',
    'public.update_my_onboarding_progress(text)',
    'public.provision_growth_partner(uuid, text, boolean)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Part 1 backend is incomplete: % is missing. Re-apply supabase/migrations/20260912_growth_partner_onboarding.sql, then re-run this file.', v_fn
        using errcode = '44000';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Convergence — indexes, checks, triggers (identical to 20260912).
-- ---------------------------------------------------------------------------
create unique index if not exists growth_partners_referral_code_key
  on public.growth_partners(referral_code);

create index if not exists growth_onboarding_partner_idx
  on public.growth_onboarding(growth_partner_id) where growth_partner_id is not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'growth_partners_code_format'
      and conrelid = 'public.growth_partners'::regclass
  ) then
    alter table public.growth_partners
      add constraint growth_partners_code_format check (referral_code ~ '^[A-Z0-9]{6,12}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'growth_onboarding_status_check'
      and conrelid = 'public.growth_onboarding'::regclass
  ) then
    alter table public.growth_onboarding
      add constraint growth_onboarding_status_check
      check (status in ('not_started', 'linked', 'template_started', 'template_completed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'growth_onboarding_referral_consistent'
      and conrelid = 'public.growth_onboarding'::regclass
  ) then
    alter table public.growth_onboarding
      add constraint growth_onboarding_referral_consistent check (
        (growth_partner_id is null and referral_code is null and linked_at is null)
        or (growth_partner_id is not null and referral_code ~ '^[A-Z0-9]{6,12}$' and linked_at is not null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'growth_onboarding_timestamps_check'
      and conrelid = 'public.growth_onboarding'::regclass
  ) then
    alter table public.growth_onboarding
      add constraint growth_onboarding_timestamps_check check (
        (template_started_at is null or template_completed_at is null
          or template_started_at <= template_completed_at)
        and (status <> 'template_started' or template_started_at is not null)
        and (status <> 'template_completed'
          or (template_started_at is not null and template_completed_at is not null))
      );
  end if;
end $$;

drop trigger if exists trg_growth_partners_updated_at on public.growth_partners;
create trigger trg_growth_partners_updated_at
  before update on public.growth_partners
  for each row execute procedure public.growth_touch_updated_at();

drop trigger if exists trg_growth_onboarding_updated_at on public.growth_onboarding;
create trigger trg_growth_onboarding_updated_at
  before update on public.growth_onboarding
  for each row execute procedure public.growth_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Convergence — RLS, policies, table grants (designed least privilege).
-- ---------------------------------------------------------------------------
alter table public.growth_partners enable row level security;
alter table public.growth_onboarding enable row level security;

drop policy if exists growth_partners_select_own on public.growth_partners;
create policy growth_partners_select_own on public.growth_partners
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists growth_onboarding_select_own_or_partner on public.growth_onboarding;
create policy growth_onboarding_select_own_or_partner on public.growth_onboarding
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or growth_partner_id = (select auth.uid())
  );

-- Strip every role (including authenticated) first so an over-broad drifted
-- grant can never survive convergence; then re-grant the designed set.
revoke all on table public.growth_partners, public.growth_onboarding from public, anon, authenticated;
grant select on table public.growth_partners, public.growth_onboarding to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Provisioning fix — keep the current code when p_code is omitted.
--    Same signature (safe CREATE OR REPLACE); admin-only, unreachable from
--    any client, so no production call path changes.
-- ---------------------------------------------------------------------------
create or replace function public.provision_growth_partner(
  p_user_id uuid,
  p_code text default null,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text;
  v_active boolean := coalesce(p_active, true);
  v_attempts int := 0;
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    -- Explicit code: intentional set/rotation (duplicate-checked below).
    v_code := public.growth_normalize_code(p_code);
  else
    -- Omitted code: keep the partner's current code; auto-generate (with
    -- bounded collision retry) only for brand-new partners.
    select gp.referral_code into v_code
    from public.growth_partners gp where gp.user_id = p_user_id;
    if v_code is null then
      loop
        v_attempts := v_attempts + 1;
        v_code := public.growth_normalize_code(substr(md5(gen_random_uuid()::text), 1, 8));
        exit when not exists (
          select 1 from public.growth_partners gp where gp.referral_code = v_code
        );
        if v_attempts >= 10 then
          raise exception 'Could not generate a unique referral code' using errcode = '23505';
        end if;
      end loop;
    end if;
  end if;

  if v_code !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'Invalid referral code format' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.growth_partners gp
    where gp.referral_code = v_code and gp.user_id <> p_user_id
  ) then
    raise exception 'Referral code is already in use' using errcode = '23505';
  end if;

  insert into public.growth_partners as gp (user_id, referral_code, is_active)
  values (p_user_id, v_code, v_active)
  on conflict (user_id) do update set
    referral_code = excluded.referral_code,
    is_active = excluded.is_active,
    updated_at = now();

  return jsonb_build_object(
    'user_id', p_user_id,
    'referral_code', v_code,
    'is_active', v_active
  );
end;
$$;

comment on function public.provision_growth_partner(uuid, text, boolean) is
'ADMIN ONLY: create/update/deactivate a Growth Partner. No EXECUTE grant for anon/authenticated. Omitted p_code keeps the current code (auto-generates only for new partners); pass an explicit p_code to rotate intentionally.';

-- ---------------------------------------------------------------------------
-- 6. First-partner bootstrap — provision by email (admin-only).
--    Resolves the user inside the database so admins never hand-write UUIDs.
--    Zero matches -> Unknown user; multiple matches -> loud TOO_MANY_ROWS
--    (never silently picks one).
-- ---------------------------------------------------------------------------
create or replace function public.provision_growth_partner_by_email(
  p_email text,
  p_code text default null,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'An email address is required' using errcode = '22023';
  end if;
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'Unknown user' using errcode = '22023';
  end if;
  return public.provision_growth_partner(v_user_id, p_code, p_active);
end;
$$;

comment on function public.provision_growth_partner_by_email(text, text, boolean) is
'ADMIN ONLY: provision a Growth Partner by login email (delegates to provision_growth_partner). No EXECUTE grant for anon/authenticated.';

-- ---------------------------------------------------------------------------
-- 7. Convergence — function grants (re-assert least privilege; repairs drift
--    such as an accidentally granted provision/helper EXECUTE).
-- ---------------------------------------------------------------------------
revoke all on function public.growth_normalize_code(text) from public, anon, authenticated;
revoke all on function public.growth_partner_display_name(uuid) from public, anon, authenticated;
revoke all on function public.growth_touch_updated_at() from public, anon, authenticated;
revoke all on function public.provision_growth_partner(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.provision_growth_partner_by_email(text, text, boolean) from public, anon, authenticated;

revoke all on function public.validate_growth_referral_code(text) from public, anon;
grant execute on function public.validate_growth_referral_code(text) to authenticated;
revoke all on function public.link_my_growth_referral(text) from public, anon;
grant execute on function public.link_my_growth_referral(text) to authenticated;
revoke all on function public.get_my_growth_referral() from public, anon;
grant execute on function public.get_my_growth_referral() to authenticated;
revoke all on function public.get_my_onboarding_status() from public, anon;
grant execute on function public.get_my_onboarding_status() to authenticated;
revoke all on function public.update_my_onboarding_progress(text) from public, anon;
grant execute on function public.update_my_onboarding_progress(text) to authenticated;

notify pgrst, 'reload schema';

commit;
