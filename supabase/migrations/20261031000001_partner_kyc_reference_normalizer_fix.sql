-- ============================================================================
-- Growth Partner applications — repair the KYC reference normalizer signature.
--
-- 20261030000000_partner_applications_hardening.sql installs a BEFORE INSERT OR
-- UPDATE trigger whose function calls
--
--     public.normalize_partner_kyc_reference(new.kyc_document_type,
--                                            new.kyc_document_reference)
--
-- with TWO arguments, but the same migration creates only the ONE-argument
-- function (public.normalize_partner_kyc_reference(text)), which the RPC uses.
-- Postgres resolves a function call by signature, so on every project where that
-- migration has been applied, EVERY insert into
-- public.growth_partner_applications fails with:
--
--     42883  function public.normalize_partner_kyc_reference(text, text)
--            does not exist
--
-- Nothing is stored, whatever the applicant types, and PostgREST hands the
-- browser a code the UI can only render as a setup/schema error. That is the
-- second, independent database cause of the reported "application submission
-- fails" bug — the first (the legacy kyc_status vocabulary) is reconciled by
-- 20261031000000_partner_kyc_status_vocabulary.sql.
--
-- Fix: create the two-argument form the trigger already calls. It is the
-- authoritative normalizer; the one-argument form is preserved (the hardened RPC
-- and the duplicate-KYC lookup call it) and now delegates to the two-argument
-- one, so every call site produces exactly the same canonical reference.
--
-- Idempotent: both functions are CREATE OR REPLACE, grants are restated, and no
-- stored data is touched.
-- ============================================================================

-- The signature the trigger resolves, and the single place the normalization
-- rule lives: uppercase, and drop the separators people type in documents
-- ("1234-5678-9012" and "1234 5678 9012" both become "123456789012").
-- `p_document_type` is accepted because the trigger passes the stored document
-- type alongside the value; normalization is deliberately type-independent so a
-- reference always has one canonical form to compare and to store.
create or replace function public.normalize_partner_kyc_reference(
  p_document_type text,
  p_reference text
)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select upper(regexp_replace(coalesce(p_reference, ''), '[\s\-_/.]', '', 'g'));
$$;

-- Keep the one-argument entry point working (the RPC, the duplicate-KYC check and
-- any deployed client) by delegating to the authoritative rule above.
create or replace function public.normalize_partner_kyc_reference(p_reference text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select public.normalize_partner_kyc_reference(null::text, p_reference);
$$;

-- The trigger function is not SECURITY DEFINER, so it runs with the caller's
-- privileges: an `authenticated` applicant inserting their own application needs
-- EXECUTE on the two-argument form or the insert fails with 42501 instead.
revoke all on function public.normalize_partner_kyc_reference(text, text) from public, anon;
grant execute on function public.normalize_partner_kyc_reference(text, text) to authenticated;

comment on function public.normalize_partner_kyc_reference(text, text) is
'Canonical KYC reference form (uppercase, separators removed). Called by the growth_partner_applications normalize trigger; the one-argument overload delegates here.';

notify pgrst, 'reload schema';
