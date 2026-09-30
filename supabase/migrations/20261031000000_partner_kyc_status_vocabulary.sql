-- ============================================================================
-- Growth Partner applications — reconcile the KYC status vocabulary.
--
-- The reported bug: submitting an application failed with a generic "Check your
-- application details and try again." and nothing was ever stored. Cause:
--
--   • The write path (`submit_growth_partner_application`, and the direct
--     RLS-scoped INSERT fallback in src/lib/growthPartnerLogin.ts) stores the
--     KYC state as 'submitted' — the canonical value the KYC migration
--     (20260911101201) and the hardening migration (20261030) both use.
--   • A project whose `growth_partner_applications.kyc_status` column was
--     created by an older build still carries a CHECK that only allows
--     ('pending','approved','rejected'). Postgres refuses the row with 23514
--     (check_violation), PostgREST returns it to the browser, and the UI — which
--     cannot name a field for that refusal — falls back to its generic sentence.
--
-- This migration makes the database accept the vocabulary the code actually
-- writes, and normalizes what is already stored:
--
--   1. drop EVERY check constraint that pins kyc_status (whatever its name: a
--      column-level check is auto-named, older builds used other names),
--   2. normalize legacy rows — a stored 'pending' with a KYC reference becomes
--      'submitted'; without one it becomes 'not_submitted',
--   3. re-add one canonical constraint that accepts the canonical states AND the
--      legacy 'pending' alias, so a client or function deployed before this
--      migration can no longer be blocked by the database,
--   4. reload PostgREST's schema cache.
--
-- `status` (pending / approved / rejected) is a different column and is already
-- correct; it is deliberately untouched here.
--
-- Idempotent: every run drops the kyc_status check it finds and re-adds the same
-- reconciled one, so a project converges on one vocabulary however it started.
-- Already-canonical rows are untouched (the backfill matches only values outside
-- the canonical set).
-- ============================================================================

-- 1. Drop every check constraint that pins kyc_status. This MUST happen before
--    the backfill below: rewriting a row to 'submitted' while a constraint
--    allows only 'pending' would itself fail with 23514.
--
--    Dropping unconditionally (instead of guessing which definition is stale)
--    keeps this deterministic: the constraint is re-added in step 3, so the
--    table always ends with the same single constraint whatever it started
--    with. Matching is by definition (the column name in the expression) and
--    not by name, because a column-level CHECK is auto-named and older builds
--    used different names.
do $$
declare
  con record;
begin
  for con in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.growth_partner_applications'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '\mkyc_status\M'
  loop
    execute format(
      'alter table public.growth_partner_applications drop constraint %I',
      con.conname
    );
  end loop;
end $$;

-- 2. Backfill anything the canonical vocabulary does not know. A legacy
--    'pending' meant "KYC submitted, waiting for review", so it maps to
--    'submitted' when a document reference was stored with it.
update public.growth_partner_applications
   set kyc_status = case
         when nullif(btrim(coalesce(kyc_document_reference, '')), '') is not null then 'submitted'
         else 'not_submitted'
       end
 where kyc_status is null
    or kyc_status not in ('not_submitted', 'submitted', 'under_review', 'approved', 'rejected');

-- 3. One constraint, the canonical states plus the legacy alias. Nulls cannot
--    occur (the column is NOT NULL with a default), but the guard keeps the
--    migration installable on a project that dropped that default.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.growth_partner_applications'::regclass
       and conname = 'growth_partner_applications_kyc_status_check'
  ) then
    if exists (
      select 1 from public.growth_partner_applications
       where kyc_status is null
          or kyc_status not in
             ('not_submitted', 'pending', 'submitted', 'under_review', 'approved', 'rejected')
    ) then
      raise notice 'skipped growth_partner_applications_kyc_status_check: rows outside the reconciled KYC states exist';
    else
      alter table public.growth_partner_applications
        add constraint growth_partner_applications_kyc_status_check
        check (
          kyc_status is null
          or kyc_status in
             ('not_submitted', 'pending', 'submitted', 'under_review', 'approved', 'rejected')
        );
    end if;
  end if;
end $$;

comment on column public.growth_partner_applications.kyc_status is
'KYC review state. Canonical values: not_submitted, submitted, under_review, approved, rejected. '
'Legacy ''pending'' (pre-20260911101201 builds) is accepted but normalized to ''submitted'' by '
'20261031000000_partner_kyc_status_vocabulary.sql.';

-- 4. The vocabulary a client sees is cached by PostgREST; make the new
--    constraint visible without a restart.
notify pgrst, 'reload schema';
