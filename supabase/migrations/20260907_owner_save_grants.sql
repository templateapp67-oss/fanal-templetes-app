-- ============================================================================
-- Nexora Salon OS — Owner save/load privileges (migration 20260907)
-- ----------------------------------------------------------------------------
-- Fixes persistent "Save failed" errors caused by missing table privileges:
--
--   • PostgREST returns 401 "permission denied for table …" when the
--     `authenticated` role has no GRANT on a table — even though RLS policies
--     exist. Fresh Supabase projects grant default privileges, but projects
--     created earlier, projects whose default privileges were altered, or
--     tables created through tools that skip defaults can silently lack them.
--   • Without these grants every editor save fails on ALL five tables
--     (profiles, services, stylists, loyalty_config, loyalty_rewards) and the
--     app can only ever report a generic save failure.
--
-- RLS (migration 00001) still scopes every row to auth.uid() — these grants
-- only decide WHICH roles may attempt queries; the policies decide which rows
-- are visible/writable. The `anon` role is given read-only access to the
-- public catalogue tables (RLS returns zero rows for non-owners), and the
-- `authenticated` role (the signed-in salon owner) gets full DML.
--
-- Idempotent: safe to run repeatedly (supabase db push applies it once).
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Signed-in salon owners: full DML on every tenant-scoped table.
-- (Row Level Security from 00001_init.sql still restricts all of this to the
-- owner's own rows via auth.uid().)
grant select, insert, update, delete on table
  public.profiles,
  public.services,
  public.stylists,
  public.bookings,
  public.appointments,
  public.clients,
  public.in_app_notifications,
  public.loyalty_config,
  public.loyalty_rewards,
  public.loyalty_point_transactions,
  public.loyalty_redeemed_rewards,
  public.social_videos,
  public.salon_youtube_videos
to authenticated;

-- Anonymous visitors: read-only on the public catalogue tables. RLS policies
-- still prevent anon from seeing anything beyond what they may read; the
-- editor's own reads/writes always run as `authenticated` or the server-side
-- service_role.
grant select on table
  public.profiles,
  public.services,
  public.stylists,
  public.bookings,
  public.clients,
  public.loyalty_config,
  public.loyalty_rewards,
  public.social_videos,
  public.salon_youtube_videos
to anon;

-- ----------------------------------------------------------------------------
-- Diagnostics helper (optional): run this from the Supabase SQL editor to
-- verify privileges + RLS for the authenticated role after applying:
--
--   select schemaname, tablename, privilege_type
--   from information_schema.role_table_grants
--   where grantee in ('authenticated', 'anon') and schemaname = 'public'
--   order by tablename, grantee, privilege_type;
--
--   select tablename, policyname
--   from pg_policies
--   where schemaname = 'public'
--   order by tablename;
-- ----------------------------------------------------------------------------
