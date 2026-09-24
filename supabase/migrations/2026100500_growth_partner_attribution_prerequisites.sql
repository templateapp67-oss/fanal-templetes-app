-- ============================================================================
-- The three relations the committed chain READS/WRITES (and foreign-keys) but
-- no migration in this repository CREATED: shop_attributions,
-- partner_reward_milestones and user_preferences.
--
-- WHY THIS EXISTS
--
--   `shop_attributions` is referenced by six migrations —
--   20260911092650 (legacy, do not apply), 20260918100100, 20260918100200,
--   20261007, 20261008, 20261009 — and `partner_reward_milestones` is seeded by
--   20261007 and read by 20261007/20261008. Neither table had a CREATE anywhere
--   in `supabase/migrations` (verified by scanning every `public.<relation>`
--   reference in all 71 migrations against every `create table`):
--
--     * `20261007` needs `shop_attributions` at APPLY time, not just at runtime:
--       its `partner_shop_daily_qualification.shop_attribution_id uuid not null
--       references public.shop_attributions(id)` is resolved when the file runs,
--       and the file then seeds `partner_reward_milestones`.
--     * `20260918100100` / `20260918100200` (shop-owner onboarding → partner
--       rewards) insert into `shop_attributions` on the same path.
--
--   On the production project these tables predate the repository (the legacy
--   `20260911092650` generation was written against them), so nothing ever
--   failed there. On a project built from this repository — and on the local
--   PGlite gateway — those three migrations could not apply at all.
--
-- WHAT THIS FILE IS, AND IS NOT
--
--   * `create table if not exists`: on a project that already carries the legacy
--     tables this file is a no-op. It never alters, drops or back-fills them.
--   * Every column below is one the committed migrations actually use (quoted in
--     the column comments). Nothing is invented: if a legacy table has more
--     columns, they stay untouched.
--   * The reward RPCs (`get_my_partner_reward_dashboard`,
--     `get_my_partner_onboarding_rewards`, `get_my_partner_qr_commission`) are
--     SECURITY DEFINER with `search_path = ''`, so these tables stay
--     server/RPC-only: RLS is on, no policy grants them to `anon` or
--     `authenticated`, and only `service_role` keeps explicit data grants.
--
-- ORDER: this is the prerequisite for 20261007+ (and for the shop-onboarding
-- pair). Apply it after 20261002 (which creates `public.salons`, the FK target
-- below) and before 20261007. `tests/growthPartnerMigrationPrerequisites.test.ts`
-- replays bootstrap + the Growth Partner chain + this file + 20261007/08/09 on a
-- bare PGlite to pin exactly that.
-- ============================================================================

create table if not exists public.shop_attributions (
  -- id is the FK target of partner_shop_daily_qualification.shop_attribution_id.
  id uuid primary key default gen_random_uuid(),
  growth_partner_id uuid not null references public.growth_partners(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete restrict,
  -- Set when the attribution came from a shop-owner onboarding application
  -- (20260911092650 joins shop_onboarding_applications on it; 20261007 checks
  -- that the application is approved/published and phone-verified).
  onboarding_application_id uuid,
  -- 'shop_owner_onboarding' (20260918100100) and 'deep_link' (20260918100200).
  attribution_method text not null default 'deep_link',
  -- 'pending' when the attribution is created, 'active' once verified
  -- (20260911092650 filters `status='active'`).
  status text not null default 'active',
  attributed_at timestamptz not null default now(),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  -- e.g. 'shop-onboarding:<owner uuid>' in both onboarding migrations.
  source_event_id text,
  reason text,
  created_at timestamptz not null default now()
);

-- The lookups the migrations and RPCs perform: partner → salon, and salon alone.
create index if not exists shop_attributions_partner_salon_idx
  on public.shop_attributions(growth_partner_id, salon_id);
create index if not exists shop_attributions_salon_idx
  on public.shop_attributions(salon_id);

alter table public.shop_attributions enable row level security;
revoke all on table public.shop_attributions from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_attributions to service_role;

comment on table public.shop_attributions is
  'Which Growth Partner a salon was attributed to, and when it became effective. Read by the partner dashboard, referral and reward RPCs; written by the shop-onboarding RPCs. Server/RPC-only: RLS on, no client policy, service_role grants keep the definer paths working.';

create table if not exists public.partner_reward_milestones (
  id uuid primary key default gen_random_uuid(),
  -- 20261007 seeds with `on conflict (code) do update`, so `code` must be unique.
  code text not null unique,
  name text not null,
  -- 25 / 50 / 100 / 250 / 500 / 750 / 1000 in the committed seed.
  milestone_shop_count integer not null check (milestone_shop_count > 0),
  claim_unlock_shop_count integer not null check (claim_unlock_shop_count >= milestone_shop_count),
  -- Always paise (₹1,75,000 → 17500000). Never a currency-scoped float.
  maximum_value_paise bigint not null check (maximum_value_paise >= 0),
  description text not null,
  specifications jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  claim_options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partner_reward_milestones enable row level security;
revoke all on table public.partner_reward_milestones from public, anon, authenticated;
grant select, insert, update, delete on table public.partner_reward_milestones to service_role;

comment on table public.partner_reward_milestones is
  'Premium-reward catalogue (code, shop thresholds, maximum value in paise). Seeded and read by 20261007/20261008; the partner-facing RPCs are SECURITY DEFINER, so no client read policy exists by design.';

-- ---------------------------------------------------------------------------
-- user_preferences — the third relation no migration created.
--
--   20260909035237_partner_profile_settings.sql writes it from
--   `save_partner_profile()` (`insert into public.user_preferences(user_id,
--   whatsapp_notifications) … on conflict (user_id) do update`), and
--   `get_partner_profile()` reads it behind a `to_regclass` probe. The function
--   is SECURITY INVOKER, so the CALLER's role needs the grants and an own-row
--   policy — unlike the reward tables, which only the SECURITY DEFINER RPCs
--   touch. On a project that already carries it this is a no-op.
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whatsapp_notifications boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
grant select, insert, update on public.user_preferences to authenticated;
drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.user_preferences is
  'Per-account notification preferences written by save_partner_profile(). Own-row RLS: a caller sees and writes only their own row.';
