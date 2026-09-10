-- ============================================================================
-- Nexora Salon OS — Growth Partner + shared Onboarding backend wiring
-- Migration: 20260912_growth_partner_onboarding.sql
-- ----------------------------------------------------------------------------
-- PHASE 1 ONLY: shared backend data model so the existing Template App and a
-- future separate Onboarding App can use the SAME Supabase Auth, SAME database
-- and SAME backend (production project qwaehqsmodekbgvnaavz).
--
-- WHAT THIS SCRIPT DOES
--   • Creates exactly two tables: `public.growth_partners` and
--     `public.growth_onboarding`. No existing table, column, constraint,
--     policy, function or row is created, dropped or changed.
--   • Growth Partner identity reuses auth.users (1:1 with public.profiles);
--     NO duplicate user table is created.
--   • Each partner holds one UNIQUE referral_code (server-side format check
--     + unique index). Codes are 6-12 uppercase alphanumerics.
--   • Each referred user has at most ONE Growth Partner: enforced by the
--     growth_onboarding primary key (user_id) plus a consistency check and
--     the link RPC, which refuses to overwrite an existing link.
--   • Onboarding progress (status, template_started_at, template_completed_at)
--     advances ONLY through the SECURITY DEFINER RPCs below. Timestamps are
--     set server-side with now(); the client cannot supply them.
--
-- WHAT THIS SCRIPT DOES NOT TOUCH (strict Phase 1 boundary)
--   • No Growth Partner dashboard, no Onboarding App, no UI changes.
--   • No appointment / payment / commission logic changes.
--   • The existing customer-loyalty referral flow (bookings.metadata
--     referral_code, NX-XXXXXXXX codes derived from user ids in
--     src/lib/customer/schema.ts, birthday/referral check-in credits) is a
--     SEPARATE feature and is left completely untouched. Growth Partner codes
--     never use the NX- prefix so the two flows cannot be confused.
--   • "Nexora Partner" in the Template App UI means the salon owner
--     (partner_settings / save_partner_profile). "Growth Partner" here is a
--     NEW, distinct, global referrer role. The two are unrelated.
--
-- SECURITY MODEL (mirrors the existing auth.uid()-scoped RLS model)
--   • growth_partners: authenticated users can SELECT only their OWN row.
--     There are deliberately NO insert/update/delete policies AND no
--     insert/update/delete GRANTs for authenticated/anon, so a normal client
--     can neither provision itself as a partner nor change any code. Partner
--     provisioning is done by an administrator via provision_growth_partner()
--     (SQL Editor / service_role only — EXECUTE is revoked from
--     authenticated/anon) or direct service_role writes.
--   • growth_onboarding: authenticated users can SELECT their OWN row; a
--     Growth Partner can additionally SELECT rows whose growth_partner_id is
--     their own user id (their own referrals only). All writes go through the
--     RPCs; there are no write policies/grants for authenticated/anon.
--   • All user-facing RPCs are SECURITY DEFINER with a pinned search_path,
--     require auth.uid(), revoke EXECUTE from public/anon and grant it to
--     authenticated only. The browser keeps using VITE_SUPABASE_URL and
--     VITE_SUPABASE_ANON_KEY only — no service_role key is ever needed.
--
-- IDEMPOTENCY: safe to paste into the Supabase SQL Editor repeatedly and safe
-- for `supabase db push`. All data is preserved (no DROP TABLE/COLUMN).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Private helpers (no EXECUTE grants: callable only from inside the
--    SECURITY DEFINER RPCs below, or by the database owner / service_role).
-- ---------------------------------------------------------------------------

-- Canonical code form: trimmed + uppercased. Every write/read path funnels
-- through this so '  alpha01 ' and 'ALPHA01' are the same code.
create or replace function public.growth_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select upper(btrim(coalesce(p_code, '')))
$$;
revoke all on function public.growth_normalize_code(text) from public, anon, authenticated;

-- Partner display name resolved from the EXISTING profiles table (reused, not
-- duplicated). Defensive across schema generations: returns null when the
-- table/column is absent instead of failing the calling RPC.
create or replace function public.growth_partner_display_name(p_user_id uuid)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_name text;
begin
  if p_user_id is null then return null; end if;
  if to_regclass('public.profiles') is null then return null; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
  ) then return null; end if;
  execute 'select p.full_name from public.profiles p where p.id = $1'
    into v_name using p_user_id;
  return nullif(btrim(coalesce(v_name, '')), '');
end;
$$;
revoke all on function public.growth_partner_display_name(uuid) from public, anon, authenticated;

-- Local updated_at trigger (self-contained: does not depend on any helper
-- from another migration generation).
create or replace function public.growth_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.growth_touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables (new only — existing tables are never altered here).
-- ---------------------------------------------------------------------------

create table if not exists public.growth_partners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uniqueness is enforced at the database level: a duplicate code insert or
-- provision fails with 23505 even for privileged writers.
create unique index if not exists growth_partners_referral_code_key
  on public.growth_partners(referral_code);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'growth_partners_code_format') then
    alter table public.growth_partners
      add constraint growth_partners_code_format check (referral_code ~ '^[A-Z0-9]{6,12}$');
  end if;
end $$;

comment on table public.growth_partners is
'GROWTH PARTNER wiring (Phase 1): global referrer identity. user_id reuses auth.users/public.profiles (no duplicate user table). referral_code is unique and server-validated. Distinct from the salon-owner "Nexora Partner" profile and from loyalty NX- referral codes.';

create table if not exists public.growth_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  growth_partner_id uuid references public.growth_partners(user_id) on delete restrict,
  referral_code text,
  status text not null default 'not_started',
  linked_at timestamptz,
  template_started_at timestamptz,
  template_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Growth Partners list their own referrals through this index.
create index if not exists growth_onboarding_partner_idx
  on public.growth_onboarding(growth_partner_id) where growth_partner_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'growth_onboarding_status_check') then
    alter table public.growth_onboarding
      add constraint growth_onboarding_status_check
      check (status in ('not_started', 'linked', 'template_started', 'template_completed'));
  end if;
  -- Referral ownership is all-or-nothing: a row is either unlinked (all three
  -- null) or linked to exactly one partner (all three set, code well-formed).
  if not exists (select 1 from pg_constraint where conname = 'growth_onboarding_referral_consistent') then
    alter table public.growth_onboarding
      add constraint growth_onboarding_referral_consistent check (
        (growth_partner_id is null and referral_code is null and linked_at is null)
        or (growth_partner_id is not null and referral_code ~ '^[A-Z0-9]{6,12}$' and linked_at is not null)
      );
  end if;
  -- Completion requires a prior start; timestamps are ordered. Presence (not
  -- absence) is enforced so privileged backfills stay possible.
  if not exists (select 1 from pg_constraint where conname = 'growth_onboarding_timestamps_check') then
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

comment on table public.growth_onboarding is
'SHARED ONBOARDING wiring (Phase 1): one row per auth user. Holds the referral link to at most one Growth Partner plus template progress. Written only via the link_my_growth_referral / update_my_onboarding_progress RPCs.';

drop trigger if exists trg_growth_partners_updated_at on public.growth_partners;
create trigger trg_growth_partners_updated_at
  before update on public.growth_partners
  for each row execute procedure public.growth_touch_updated_at();

drop trigger if exists trg_growth_onboarding_updated_at on public.growth_onboarding;
create trigger trg_growth_onboarding_updated_at
  before update on public.growth_onboarding
  for each row execute procedure public.growth_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security + grants.
--
-- Authenticated clients get SELECT-only access:
--   • growth_partners: own row only (code validation happens inside the
--     SECURITY DEFINER validate RPC, so codes cannot be enumerated).
--   • growth_onboarding: own row + (for partners) rows of own referrals.
-- No write policies and no write grants exist for anon/authenticated, so
-- direct INSERT/UPDATE/DELETE is denied before RLS is even consulted.
-- service_role (server/Edge Functions) bypasses RLS as usual.
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

revoke all on table public.growth_partners, public.growth_onboarding from public, anon;
grant select on table public.growth_partners, public.growth_onboarding to authenticated;

-- ---------------------------------------------------------------------------
-- 3a. validate_growth_referral_code — check a code without linking.
--
-- Returns {valid, referral_code} (referral_code is null when invalid).
-- Deliberately reveals NO partner identity: who owns the code is disclosed
-- only after a successful link via get_my_growth_referral().
-- ---------------------------------------------------------------------------
create or replace function public.validate_growth_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := public.growth_normalize_code(p_code);
  v_valid boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_code ~ '^[A-Z0-9]{6,12}$' then
    select exists (
      select 1 from public.growth_partners gp
      where gp.referral_code = v_code and gp.is_active
    ) into v_valid;
  end if;
  return jsonb_build_object(
    'valid', v_valid,
    'referral_code', case when v_valid then v_code else null end
  );
end;
$$;
revoke all on function public.validate_growth_referral_code(text) from public, anon;
grant execute on function public.validate_growth_referral_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. link_my_growth_referral — attach the caller to a Growth Partner.
--
-- One-way, one-time: succeeds only when the caller's row is currently
-- unlinked. An already-linked account can NEVER change its referral owner
-- through this RPC (ownership is immutable). Self-referral is rejected.
-- Returns {growth_partner_id, referral_code, linked_at, status, partner_name}.
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
begin
  if actor is null then
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

  select o.growth_partner_id into v_current_partner
  from public.growth_onboarding as o where o.user_id = actor for update;
  if v_current_partner is not null then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  update public.growth_onboarding as o
  set growth_partner_id = v_partner,
      referral_code = v_code,
      linked_at = now(),
      status = case when o.status = 'not_started' then 'linked' else o.status end,
      updated_at = now()
  where o.user_id = actor
  returning o.status, o.linked_at into v_status, v_linked_at;

  return jsonb_build_object(
    'growth_partner_id', v_partner,
    'referral_code', v_code,
    'linked_at', v_linked_at,
    'status', v_status,
    'partner_name', public.growth_partner_display_name(v_partner)
  );
end;
$$;
revoke all on function public.link_my_growth_referral(text) from public, anon;
grant execute on function public.link_my_growth_referral(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. get_my_growth_referral — read the caller's referral relationship.
-- Returns null when the caller has no Growth Partner.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_growth_referral()
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
  select * into v_row from public.growth_onboarding where user_id = actor;
  if v_row.user_id is null or v_row.growth_partner_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'growth_partner_id', v_row.growth_partner_id,
    'referral_code', v_row.referral_code,
    'linked_at', v_row.linked_at,
    'status', v_row.status,
    'partner_name', public.growth_partner_display_name(v_row.growth_partner_id)
  );
end;
$$;
revoke all on function public.get_my_growth_referral() from public, anon;
grant execute on function public.get_my_growth_referral() to authenticated;

-- ---------------------------------------------------------------------------
-- 3d. get_my_onboarding_status — read the caller's onboarding progress.
-- Read-only (never inserts): unknown callers get default 'not_started' state.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_onboarding_status()
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
  select * into v_row from public.growth_onboarding where user_id = actor;
  if v_row.user_id is null then
    return jsonb_build_object(
      'status', 'not_started',
      'linked', false,
      'growth_partner_id', null,
      'referral_code', null,
      'linked_at', null,
      'template_started_at', null,
      'template_completed_at', null
    );
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
revoke all on function public.get_my_onboarding_status() from public, anon;
grant execute on function public.get_my_onboarding_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 3e. update_my_onboarding_progress — safely advance the caller's progress.
--
-- p_action is 'start_template' or 'complete_template'; anything else is
-- rejected. Transitions are forward-only and idempotent (repeating a step
-- returns the current state instead of failing, so client retries are safe):
--   not_started/linked -> template_started -> template_completed (terminal).
-- Completion REQUIRES a prior start (backend validation); the client cannot
-- skip steps, cannot regress, and cannot supply timestamps — both are set
-- with now() inside this function.
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

-- ---------------------------------------------------------------------------
-- 3f. provision_growth_partner — ADMIN ONLY (no EXECUTE for anon/authenticated).
--
-- Run from the Supabase SQL Editor as a database administrator, or via the
-- service_role key from a trusted server/Edge Function. Creates (or updates)
-- the partner row for p_user_id. p_code may be omitted to auto-generate an
-- 8-character code. Duplicate codes for a DIFFERENT user fail with 23505.
-- Pass p_active := false to deactivate a partner (existing links are kept;
-- new validations/links with that code are rejected).
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
  v_code text := public.growth_normalize_code(
    coalesce(nullif(btrim(coalesce(p_code, '')), ''), substr(md5(gen_random_uuid()::text), 1, 8))
  );
  v_active boolean := coalesce(p_active, true);
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown user' using errcode = '22023';
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
-- No grant: only the database owner / service_role may provision partners.
revoke all on function public.provision_growth_partner(uuid, text, boolean) from public, anon, authenticated;

comment on function public.validate_growth_referral_code(text) is
'Phase 1 shared onboarding: validate a Growth Partner code without linking. Returns {valid, referral_code}; reveals no partner identity.';
comment on function public.link_my_growth_referral(text) is
'Phase 1 shared onboarding: one-time link of the caller to a Growth Partner. Refuses to overwrite an existing link (ownership immutable).';
comment on function public.get_my_growth_referral() is
'Phase 1 shared onboarding: read the caller referral relationship (null when unlinked).';
comment on function public.get_my_onboarding_status() is
'Phase 1 shared onboarding: read the caller onboarding progress (defaults, no insert).';
comment on function public.update_my_onboarding_progress(text) is
'Phase 1 shared onboarding: forward-only, idempotent progress steps with server-set timestamps. Completion requires a prior start.';
comment on function public.provision_growth_partner(uuid, text, boolean) is
'ADMIN ONLY: create/update/deactivate a Growth Partner. No EXECUTE grant for anon/authenticated.';

notify pgrst, 'reload schema';

commit;
