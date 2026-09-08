-- ============================================================================
-- Member bonuses (repo-native: columns on existing rows, no new tables)
-- ----------------------------------------------------------------------------
-- 1. `profiles.date_of_birth` — the customer's birthday, used by the annual
--    birthday bonus. Nullable: a check-in simply skips the bonus when the
--    customer has not shared their birthday yet.
-- 2. `loyalty_config` bonus amounts — owner-configurable next to the existing
--    points-per-visit/spend numbers (edited in the Loyalty rules tab):
--      • birthday_bonus_points — credited at check-in when the visit date
--        matches the customer's birthday (once per wallet per year).
--      • referral_bonus_points — credited to the referrer's wallet when a
--        booking carrying their referral code is checked in (once per
--        booking).
-- ============================================================================

alter table public.profiles
  add column if not exists date_of_birth date;

comment on column public.profiles.date_of_birth is
  'Customer birthday (YYYY-MM-DD). Month/day decides the annual birthday bonus at check-in; null means no bonus is due.';

alter table public.loyalty_config
  add column if not exists birthday_bonus_points integer default 250;

alter table public.loyalty_config
  add column if not exists referral_bonus_points integer default 100;

comment on column public.loyalty_config.birthday_bonus_points is
  'Points credited at check-in when the visit date matches the customer birthday.';
comment on column public.loyalty_config.referral_bonus_points is
  'Points credited to the referrer wallet when a referred booking is checked in.';
