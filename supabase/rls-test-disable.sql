-- ============================================================================
-- NEXORA SALON OS — RLS QUICK-TEST HELPER (TESTING ONLY — NOT A MIGRATION)
-- ----------------------------------------------------------------------------
-- Purpose: isolate whether Website Editor save failures are caused by RLS
-- policies / table grants, or by something else (network, data shape,
-- missing tables).
--
-- !!! SECURITY WARNING — READ THIS FIRST !!!
-- Disabling RLS opens these tables to EVERY role that holds a grant:
--   • the `anon` key (shipped inside every browser bundle!) can then read —
--     and on standard Supabase projects also WRITE — ALL owners' rows;
--   • the `authenticated` role is no longer scoped to auth.uid(), so any
--     signed-in user could touch another owner's data.
-- Use this ONLY on a throwaway/test project, or for a FEW MINUTES on a live
-- project — and run supabase/rls-restore-production.sql IMMEDIATELY after.
-- Never leave a production project in this state.
--
-- This file is intentionally NOT in supabase/migrations — do NOT
-- `supabase db push` it. Run it manually: Dashboard → SQL Editor → paste →
-- run the whole file, or only the sections you need.
--
-- NOTE ON TABLE NAMES: this schema has NO `team_members` table — the team /
-- staff table is `stylists`. The five tables the Website Editor save writes
-- (see src/lib/salonSync.ts SALON_SYNC_TABLES) are:
--   profiles, services, stylists, loyalty_config, loyalty_rewards
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 (safe, read-only) — DIAGNOSE FIRST. You often don't need to disable
-- anything at all:
--   • The browser console already prints the failing table + HTTP status
--     under [Nexora Sync Error] / [AutoSave] (e.g. status 401, code 42501,
--     table "stylists").
--   • The service-role API (POST /api/website/save) persists the same state
--     and BYPASSES RLS — so "direct sync returns 401/403 but the save still
--     succeeds via the API" already PROVES RLS/grants are the cause, with
--     zero SQL changes.
-- These two queries show the full picture regardless:
-- ----------------------------------------------------------------------------

-- RLS status + per-table policy count for the five editor-save tables:
select c.relname            as table_name,
       c.relrowsecurity     as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'services', 'stylists', 'loyalty_config', 'loyalty_rewards')
order by c.relname;
--   rls_enabled = t AND policy_count = 0  →  every client write is denied
--   (the classic 401 "permission denied for table …" / 403 RLS symptom).

-- Grants for the roles that talk to PostgREST:
select table_name,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where schemaname = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('profiles', 'services', 'stylists', 'loyalty_config', 'loyalty_rewards')
group by table_name, grantee
order by table_name, grantee;
--   `authenticated` missing insert/update on a table  →  401 (code 42501) on save.
--   (service_role holds BYPASSRLS — it only needs a grant, which the
--   platform always grants to it.)

-- ----------------------------------------------------------------------------
-- STEP 1 (TESTING ONLY) — DISABLE RLS ON THE FIVE EDITOR-SAVE TABLES.
-- Now use the app: sign in and save. If saving works, RLS policies / grants
-- WERE the cause — the permanent fix is supabase/rls-restore-production.sql
-- (which re-enables RLS AND recreates the correct owner-scoped policies),
-- not leaving RLS off.
-- ----------------------------------------------------------------------------
alter table public.profiles        disable row level security;
alter table public.services        disable row level security;
alter table public.stylists        disable row level security;
alter table public.loyalty_config  disable row level security;
alter table public.loyalty_rewards disable row level security;

-- OPTIONAL — only if you also want the other owner-scoped screens to bypass
-- RLS during the test (appointments / clients / social-views dashboards):
-- alter table public.appointments         disable row level security;
-- alter table public.clients              disable row level security;
-- alter table public.social_videos        disable row level security;
--
-- Do NOT disable RLS on public.bookings: guest traffic is supposed to reach
-- it only through the trusted server / service-role path, and it is the
-- riskiest table to open.
--
-- WHEN DONE: run supabase/rls-restore-production.sql immediately.
