-- ============================================================================
-- Nexora Salon OS — referral code normalization
-- Migration: 20261004_referral_code_normalization.sql
-- ----------------------------------------------------------------------------
-- PHASE 4.2. `public.growth_normalize_code()` is the canonical form every
-- referral write/read path funnels through. It was `upper(btrim(...))`, and
-- PostgreSQL's `btrim(text)` removes SPACES ONLY — so a code pasted with a
-- leading/trailing tab, newline or non-breaking space kept it:
--
--     growth_normalize_code(E'\tALPHA01\n')  ->  E'\tALPHA01\n'
--
-- That value then fails the code-format regex, so it was rejected as an
-- invalid code. JavaScript's String.prototype.trim() — which the browser uses
-- in normalizeGrowthReferralCode() — removes the whole whitespace class, so the
-- SAME code was accepted when typed into the onboarding form and rejected when
-- it arrived through the share-link attribution endpoint
-- (/api/referral-attribution -> capture_growth_referral), which forwards the
-- raw string. Two entry points, two answers for one code.
--
-- This widens the trim to the set String.prototype.trim() removes, so the
-- database is at least as permissive as the client and the two agree.
--
-- SAFETY
--   • growth_normalize_code has NO execute grants (revoked from public/anon/
--     authenticated), so it is only reachable from the SECURITY DEFINER RPCs
--     below it — no caller contract changes.
--   • Every stored referral_code already satisfies
--     '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$', which admits no whitespace,
--     so no existing row's normalized form changes and the case-insensitive
--     unique index on upper(referral_code) cannot gain a collision.
--   • The change only ever turns a previously-REJECTED input into a lookup,
--     which still has to match an active partner's row. It cannot resolve a
--     code to a different partner.
-- ============================================================================

begin;

create or replace function public.growth_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  -- E'\u00a0' and E'\ufeff' are NBSP and the BOM, both of which
  -- String.prototype.trim() strips and which survive a space-only btrim.
  select upper(btrim(coalesce(p_code, ''), E' \t\n\r\f\v\u00a0\ufeff'))
$$;

-- Keep it private: reachable only from the SECURITY DEFINER RPCs.
revoke all on function public.growth_normalize_code(text) from public, anon, authenticated;

comment on function public.growth_normalize_code(text) is
  'Canonical referral code form: every whitespace character String.prototype.trim() removes is stripped, then uppercased. Keeps the database and the client normalizer in agreement.';

notify pgrst, 'reload schema';

commit;
