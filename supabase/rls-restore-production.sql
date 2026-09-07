-- ============================================================================
-- NEXORA SALON OS — RLS RESTORE / PRODUCTION POLICIES (idempotent)
-- ----------------------------------------------------------------------------
-- The PROPER, production-safe fix for RLS-caused save failures:
--   1. re-enable Row Level Security on the five editor-save tables (closes
--      the hole left by supabase/rls-test-disable.sql — ALWAYS run this
--      file after the test file), and
--   2. (re)create the canonical owner-scoped policies + role grants, so a
--      project with missing/broken policies is repaired without re-running
--      the full 00001_init.sql migration.
--
-- Idempotent — safe to run at any time:
--   • policies are dropped-and-recreated (only the canonical names below),
--   • grants are re-asserted,
--   • RLS is enabled (enable is a no-op when already on).
--
-- Run it via `supabase db push` (it is a normal script) or by pasting the
-- whole file into Dashboard → SQL Editor. It mirrors:
--   • supabase/migrations/00001_init.sql           — RLS + owner policies
--   • supabase/migrations/20260907_owner_save_grants.sql — role grants
-- for the five tables the Website Editor save writes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Re-enable RLS (this is what closes the test hole):
-- ----------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.services        enable row level security;
alter table public.stylists        enable row level security;
alter table public.loyalty_config  enable row level security;
alter table public.loyalty_rewards enable row level security;

-- ----------------------------------------------------------------------------
-- 2) Canonical owner-scoped policies (identical to 00001_init.sql).
--    profiles is keyed on its own id; the other tables on owner_id.
--    Every policy is scoped to auth.uid() — no cross-owner access, ever.
-- ----------------------------------------------------------------------------

-- profiles (1:1 with auth.users)
drop policy if exists "profiles_select_owner" on public.profiles;
drop policy if exists "profiles_insert_owner" on public.profiles;
drop policy if exists "profiles_update_owner" on public.profiles;
drop policy if exists "profiles_delete_owner" on public.profiles;
create policy "profiles_select_owner" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_insert_owner" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_owner" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_owner" on public.profiles
  for delete using (id = auth.uid());

-- services
drop policy if exists "services_select_owner" on public.services;
drop policy if exists "services_insert_owner" on public.services;
drop policy if exists "services_update_owner" on public.services;
drop policy if exists "services_delete_owner" on public.services;
create policy "services_select_owner" on public.services
  for select using (owner_id = auth.uid());
create policy "services_insert_owner" on public.services
  for insert with check (owner_id = auth.uid());
create policy "services_update_owner" on public.services
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "services_delete_owner" on public.services
  for delete using (owner_id = auth.uid());

-- stylists (the team-members table in this schema)
drop policy if exists "stylists_select_owner" on public.stylists;
drop policy if exists "stylists_insert_owner" on public.stylists;
drop policy if exists "stylists_update_owner" on public.stylists;
drop policy if exists "stylists_delete_owner" on public.stylists;
create policy "stylists_select_owner" on public.stylists
  for select using (owner_id = auth.uid());
create policy "stylists_insert_owner" on public.stylists
  for insert with check (owner_id = auth.uid());
create policy "stylists_update_owner" on public.stylists
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "stylists_delete_owner" on public.stylists
  for delete using (owner_id = auth.uid());

-- loyalty_config (owner_id is the primary key)
drop policy if exists "loyalty_config_select_owner" on public.loyalty_config;
drop policy if exists "loyalty_config_insert_owner" on public.loyalty_config;
drop policy if exists "loyalty_config_update_owner" on public.loyalty_config;
drop policy if exists "loyalty_config_delete_owner" on public.loyalty_config;
create policy "loyalty_config_select_owner" on public.loyalty_config
  for select using (owner_id = auth.uid());
create policy "loyalty_config_insert_owner" on public.loyalty_config
  for insert with check (owner_id = auth.uid());
create policy "loyalty_config_update_owner" on public.loyalty_config
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "loyalty_config_delete_owner" on public.loyalty_config
  for delete using (owner_id = auth.uid());

-- loyalty_rewards
drop policy if exists "rewards_select_owner" on public.loyalty_rewards;
drop policy if exists "rewards_insert_owner" on public.loyalty_rewards;
drop policy if exists "rewards_update_owner" on public.loyalty_rewards;
drop policy if exists "rewards_delete_owner" on public.loyalty_rewards;
create policy "rewards_select_owner" on public.loyalty_rewards
  for select using (owner_id = auth.uid());
create policy "rewards_insert_owner" on public.loyalty_rewards
  for insert with check (owner_id = auth.uid());
create policy "rewards_update_owner" on public.loyalty_rewards
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "rewards_delete_owner" on public.loyalty_rewards
  for delete using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3) Role grants (same as 20260907_owner_save_grants.sql, editor subset).
--    RLS decides WHICH rows are visible; grants decide which roles may
--    attempt queries at all. Both are required for saves to work.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- Signed-in salon owners: full DML (RLS still scopes every row to the owner).
grant select, insert, update, delete on table
  public.profiles,
  public.services,
  public.stylists,
  public.loyalty_config,
  public.loyalty_rewards
to authenticated;

-- Anonymous visitors: read-only (RLS returns zero rows for non-owners).
grant select on table
  public.profiles,
  public.services,
  public.stylists,
  public.loyalty_config,
  public.loyalty_rewards
to anon;

-- ----------------------------------------------------------------------------
-- 4) VERIFY — run these in the SQL Editor after the script (or look at the
--    results the script produces):
-- ----------------------------------------------------------------------------
-- Expected: rls_enabled = t AND policy_count = 4 for EVERY table.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'services', 'stylists', 'loyalty_config', 'loyalty_rewards')
order by c.relname;

-- Expected: authenticated → select, insert, update, delete;  anon → select.
select table_name,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where schemaname = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('profiles', 'services', 'stylists', 'loyalty_config', 'loyalty_rewards')
group by table_name, grantee
order by table_name, grantee;

-- After running, sign out and back in in the app once, then save. The
-- browser console shows the exact per-table result under
-- [Nexora Sync Error] / [AutoSave] if anything is still wrong.
