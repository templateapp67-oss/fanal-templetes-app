-- ============================================================================
-- 20260919 — Growth Partner area: application → KYC review → partner reads,
--            aligned with the schema this repository actually ships.
-- ============================================================================
-- What was incomplete before this file (all three defects were invisible at
-- apply time, so the chain looked finished and only failed when used):
--
--   1. `submit_growth_partner_application(text,text,text,text)` was created
--      SECURITY INVOKER (20260911101201), so its upsert ran with the CALLER's
--      table privileges. `authenticated` holds only SELECT+INSERT on
--      public.growth_partner_applications and the table has no UPDATE policy,
--      while INSERT … ON CONFLICT DO UPDATE requires UPDATE. Every submission
--      therefore failed with
--          42501 permission denied for table "growth_partner_applications"
--      — i.e. the partner sign-up form on /growth-partner/login could never
--      store an application. (Reproduced against PGlite with the committed
--      migrations; pinned by tests/growthPartnerApproval.test.ts.)
--
--   2. `review_growth_partner_application(uuid,boolean,text)` approved an
--      application with
--          insert into public.growth_partners(user_id, partner_code,
--                                             referral_code, status) …
--      but public.growth_partners (20260912) has only
--      user_id / referral_code / is_active / created_at / updated_at, and its
--      referral_code carries CHECK '^[A-Z0-9]{6,12}$' while the generated
--      value was 'REF-' || … (hyphen, 14 characters). plpgsql bodies are not
--      validated at CREATE time, so the function was created happily and then
--      failed on the first real approval:
--          column "partner_code" of relation "growth_partners" does not exist
--      No partner row was ever created, so no applicant could ever reach the
--      Growth Partner area (`partner_dashboard_caller` requires that row).
--
--   3. `get_my_growth_partner()` — the FIRST call the area makes
--      (fetchMyGrowthPartnerRow → the sign-in / partner-only / ready gate) —
--      was written by 20260911092650 against a different growth_partners
--      generation: it reads `gp.status = 'approved'` (and its sibling
--      private.partner_referred_users_page reads `gp.id`). The table this
--      repository creates (20260912, and the one ARCHITECTURE.md,
--      SUPABASE_SETUP.md and every Growth Partner test pin) has `is_active`
--      and no `status`/`id`. 20260915 later redefines the dashboard and
--      referrals RPCs against `is_active`, so on a project built from these
--      migrations the area's very first read failed with
--          column gp.status does not exist
--      i.e. the page could not open even for a correctly approved partner.
--
-- The fix, in the style the rest of this area already uses:
--   • submit becomes SECURITY DEFINER with a pinned search_path — the pattern
--     of every other Growth Partner RPC. It still resolves the caller from
--     auth.uid() and can only ever touch that caller's own row, so no extra
--     table privilege is handed to `authenticated` (granting UPDATE there
--     would have widened direct client writes instead of removing them).
--   • review writes the REAL partner schema through the existing admin helper
--     public.provision_growth_partner(), which generates a valid unique code
--     and keeps `is_active` as the single source of truth for access. An
--     existing partner keeps the referral code its referrals were linked
--     against — approving twice never rotates it.
--   • get_my_growth_partner() keeps its exact JSON contract but resolves the
--     active flag from whichever column the deployed table actually has, so a
--     project on either generation returns the same shape instead of failing.
--     It stays SECURITY INVOKER, so the SELECT-own-row RLS policy — not this
--     function — still decides which row the caller may see.
--
-- Safety properties:
--   • Three CREATE OR REPLACE with identical signatures, return types and
--     owner.
--     No DROP FUNCTION/TABLE/COLUMN, no data rewrite, no policy removed.
--   • Grants are re-asserted exactly as before (submit: authenticated only;
--     review: nobody — service_role/SQL Editor), never widened.
--   • Idempotent: safe to re-run in the SQL Editor or `supabase db push`.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Ordering guards — the KYC approval migration and the partner table must
--    already exist, otherwise this file would silently define functions that
--    cannot run (exactly the failure mode being corrected here).
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.growth_partner_applications') is null then
    raise exception 'Apply 20260911094853_growth_partner_signup_approval.sql first'
      using errcode = '0A000';
  end if;
  if to_regclass('public.growth_partners') is null then
    raise exception 'Apply 20260912_growth_partner_onboarding.sql first'
      using errcode = '0A000';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'review_growth_partner_application'
  ) then
    raise exception 'Apply 20260911101201_growth_partner_kyc_approval.sql first'
      using errcode = '0A000';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'growth_partner_applications'
      and column_name = 'kyc_status'
  ) then
    raise exception 'growth_partner_applications.kyc_status is missing — apply the KYC migration first'
      using errcode = '0A000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. submit_growth_partner_application — SECURITY DEFINER, own row only.
--    Same validations, same result shape as the KYC version; the caller's
--    identity still comes from auth.uid() and is never a parameter.
-- ---------------------------------------------------------------------------
create or replace function public.submit_growth_partner_application(
  p_full_name text,
  p_phone text default null,
  p_kyc_document_type text default null,
  p_kyc_document_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  row public.growth_partner_applications;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null then
    raise exception 'Full name is required' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_kyc_document_type, ''))) not in
     ('pan', 'aadhaar', 'passport', 'driving_license', 'business_registration') then
    raise exception 'Select a valid KYC document type' using errcode = '22023';
  end if;
  if nullif(btrim(p_kyc_document_reference), '') is null then
    raise exception 'KYC document reference is required' using errcode = '22023';
  end if;

  -- growth_partner_applications.user_id references public.profiles(id), which
  -- the on_auth_user_created trigger normally creates at sign-up. If a project
  -- does not have that trigger, create the caller's own row instead of failing
  -- the application with a raw foreign-key violation. Existing rows are never
  -- modified (do nothing).
  insert into public.profiles(id, full_name)
  values (actor, left(btrim(p_full_name), 120))
  on conflict (id) do nothing;

  insert into public.growth_partner_applications(
    user_id, full_name, phone,
    kyc_status, kyc_document_type, kyc_document_reference, kyc_submitted_at
  )
  values (
    actor,
    left(btrim(p_full_name), 120),
    nullif(left(btrim(coalesce(p_phone, '')), 30), ''),
    'submitted',
    lower(btrim(p_kyc_document_type)),
    left(btrim(p_kyc_document_reference), 160),
    now()
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    kyc_status = 'submitted',
    kyc_document_type = excluded.kyc_document_type,
    kyc_document_reference = excluded.kyc_document_reference,
    kyc_submitted_at = now(),
    -- A rejected applicant may reapply; an approved one is never reopened.
    status = case
      when public.growth_partner_applications.status = 'rejected' then 'pending'
      else public.growth_partner_applications.status
    end,
    review_note = case
      when public.growth_partner_applications.status = 'rejected' then null
      else public.growth_partner_applications.review_note
    end,
    updated_at = now()
  returning * into row;

  return jsonb_build_object(
    'id', row.id,
    'status', row.status,
    'kyc_status', row.kyc_status,
    'created_at', row.created_at
  );
end;
$$;

-- Exactly the previous grants: applicants may submit, nobody else may.
revoke all on function public.submit_growth_partner_application(text, text, text, text) from public, anon;
grant execute on function public.submit_growth_partner_application(text, text, text, text) to authenticated;

comment on function public.submit_growth_partner_application(text, text, text, text) is
'Growth Partner self-application with KYC metadata. SECURITY DEFINER: writes only the caller''s own row (auth.uid()), never a parameter identity.';

-- ---------------------------------------------------------------------------
-- 2. review_growth_partner_application — admin-only, writes the real schema.
--    Approval provisions the partner through the existing admin helper, so the
--    referral code format/uniqueness rules stay in one place.
-- ---------------------------------------------------------------------------
create or replace function public.review_growth_partner_application(
  p_application_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  app public.growth_partner_applications;
  v_code text;
begin
  if actor is null or not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into app
  from public.growth_partner_applications
  where id = p_application_id
  for update;

  if app.id is null then
    raise exception 'Application not found' using errcode = '22023';
  end if;

  if not p_approve then
    update public.growth_partner_applications
      set status = 'rejected',
          kyc_status = 'rejected',
          review_note = nullif(btrim(p_note), ''),
          reviewed_by = actor,
          reviewed_at = now(),
          kyc_reviewed_by = actor,
          kyc_reviewed_at = now(),
          updated_at = now()
      where id = app.id;
    return jsonb_build_object('id', app.id, 'status', 'rejected', 'kyc_status', 'rejected');
  end if;

  -- KYC must be on file. An already-approved application may be re-reviewed
  -- (the call stays idempotent) but still needs its document reference.
  if app.kyc_status not in ('submitted', 'approved')
     or nullif(btrim(app.kyc_document_reference), '') is null then
    raise exception 'KYC must be submitted before approval' using errcode = '22023';
  end if;

  -- Reuse the partner's existing code (growth_onboarding rows were linked
  -- against it) or mint a fresh valid one. provision_growth_partner enforces
  -- the ^[A-Z0-9]{6,12}$ format, uniqueness and is_active = true.
  select gp.referral_code into v_code
  from public.growth_partners gp
  where gp.user_id = app.user_id;

  if v_code is null then
    select public.provision_growth_partner(app.user_id) ->> 'referral_code' into v_code;
  else
    select public.provision_growth_partner(app.user_id, v_code, true) ->> 'referral_code' into v_code;
  end if;

  update public.growth_partner_applications
    set status = 'approved',
        kyc_status = 'approved',
        review_note = nullif(btrim(p_note), ''),
        reviewed_by = actor,
        reviewed_at = now(),
        kyc_reviewed_by = actor,
        kyc_reviewed_at = now(),
        updated_at = now()
    where id = app.id;

  return jsonb_build_object(
    'id', app.id,
    'status', 'approved',
    'kyc_status', 'approved',
    'referral_code', v_code
  );
end;
$$;

-- Unchanged: admins run this with service_role / the SQL Editor, never a client.
revoke all on function public.review_growth_partner_application(uuid, boolean, text) from public, anon, authenticated;

comment on function public.review_growth_partner_application(uuid, boolean, text) is
'ADMIN ONLY: approve (provisions the growth_partners row via provision_growth_partner, preserving an existing referral code) or reject a partner application.';

-- ---------------------------------------------------------------------------
-- 3. get_my_growth_partner — same JSON contract, resolved from the columns the
--    deployed table actually has. SECURITY INVOKER on purpose: the
--    SELECT-own-row RLS policy on growth_partners stays the access control.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_growth_partner()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_result jsonb;
  v_has_is_active boolean;
begin
  if actor is null then
    return null;
  end if;
  if to_regclass('public.growth_partners') is null then
    return null;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'growth_partners'
      and column_name = 'is_active'
  ) into v_has_is_active;

  -- Only the matching branch is ever planned, so a deployment carrying the
  -- other generation never has its columns resolved.
  if v_has_is_active then
    select jsonb_build_object(
             'user_id', gp.user_id,
             'referral_code', gp.referral_code,
             'is_active', gp.is_active,
             'created_at', gp.created_at,
             'updated_at', gp.updated_at
           )
      into v_result
      from public.growth_partners gp
      where gp.user_id = actor;
  else
    select jsonb_build_object(
             'user_id', gp.user_id,
             'referral_code', gp.referral_code,
             'is_active', gp.status = 'approved',
             'created_at', gp.created_at,
             'updated_at', gp.updated_at
           )
      into v_result
      from public.growth_partners gp
      where gp.user_id = actor;
  end if;

  -- Null (not an error) when the caller is not a partner: that is the
  -- "Growth Partners only" state the area renders.
  return v_result;
end;
$$;

revoke all on function public.get_my_growth_partner() from public, anon;
grant execute on function public.get_my_growth_partner() to authenticated;

comment on function public.get_my_growth_partner() is
'The caller''s own Growth Partner row (or null). SECURITY INVOKER: the SELECT-own-row RLS policy decides visibility. Active flag resolved from is_active or status, so both growth_partners generations return the same shape.';

notify pgrst, 'reload schema';

commit;
