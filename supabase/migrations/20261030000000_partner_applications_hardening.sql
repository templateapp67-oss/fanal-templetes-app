-- ===========================================================================
-- Growth Partner applications — hardening: schema, RLS, indexes, validation.
--
-- Fixes the reported failure at `/partner/dashboard`:
--
--   Application failed. Please try again.
--
-- …which was every failure at once. The old `submit_growth_partner_application`
-- accepted anything that was not empty (an 11-digit "Aadhaar" was stored, a
-- phone of "91234" was stored, the same KYC number could be registered by two
-- different accounts), silently OVERWROTE an existing application on resubmit,
-- and raised raw 22023 messages the frontend had already thrown away.
--
-- What this migration changes, and nothing else:
--
--   1. `public.growth_partner_applications` — the canonical table — gets its
--      column types, length limits and CHECK constraints made explicit and
--      idempotent, so a project that created it from an older migration lands
--      on the same shape.
--   2. Indexes: one application per user (UNIQUE), one application per KYC
--      document number (UNIQUE, created only when the existing data allows it),
--      plus the read indexes the gate and the queue scan by.
--   3. RLS: authenticated users may INSERT their own row (`auth.uid() = user_id`,
--      status forced to `pending`) and SELECT their own row. No UPDATE/DELETE
--      from the client — the review path is the admin-only RPC.
--   4. `public.partner_applications` — a `security_invoker` VIEW exposing the
--      product's column names (`id, user_id, full_name, phone, kyc_type,
--      kyc_number, status, created_at`) over the same rows. Reporting and
--      dashboards can query it; there is still exactly one table of truth.
--   5. `submit_growth_partner_application` is replaced with a hardened version
--      that validates the SAME rules the client validates (12-digit Aadhaar,
--      PAN format, 10-digit phone), refuses duplicates with SQLSTATE 23505
--      (unique_violation → HTTP 409, "You have already submitted an
--      application"), and still writes only `auth.uid()`'s own row.
--
-- Safe to run on an existing project: every statement is idempotent, the CHECK
-- constraints are skipped (with a NOTICE) when legacy rows would violate them,
-- and no data is deleted or rewritten.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Canonical table (kept compatible with every earlier migration)
-- ---------------------------------------------------------------------------
create table if not exists public.growth_partner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  full_name text not null,
  phone text,
  status text not null default 'pending',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.growth_partner_applications
  add column if not exists kyc_status text not null default 'not_submitted',
  add column if not exists kyc_document_type text,
  add column if not exists kyc_document_reference text,
  add column if not exists kyc_submitted_at timestamptz,
  add column if not exists kyc_reviewed_at timestamptz,
  add column if not exists kyc_reviewed_by uuid;

-- The row belongs to the authenticated user's own profile. Earlier migrations
-- created this reference; add it only when the table has none yet, so a project
-- whose `profiles` table lives elsewhere is not broken by this migration.
do $$
begin
  if to_regclass('public.profiles') is not null
     and not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.growth_partner_applications'::regclass
       and c.contype = 'f'
       and c.conkey @> (
         select array_agg(attnum)
           from pg_attribute
          where attrelid = 'public.growth_partner_applications'::regclass
            and attname = 'user_id'
       )
  ) then
    alter table public.growth_partner_applications
      add constraint growth_partner_applications_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints — added only when the existing rows already satisfy them
--    (an old row outside the range is reported with a NOTICE, never deleted).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.growth_partner_applications'::regclass
       and conname = 'growth_partner_applications_status_check'
  ) then
    if exists (
      select 1 from public.growth_partner_applications
       where status is null or status not in ('pending', 'approved', 'rejected')
    ) then
      raise notice 'skipped growth_partner_applications_status_check: rows outside (pending, approved, rejected) exist — normalize them, then re-run this migration';
    else
      alter table public.growth_partner_applications
        add constraint growth_partner_applications_status_check
        check (status in ('pending', 'approved', 'rejected'));
    end if;
  end if;
end $$;

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
          or kyc_status not in ('not_submitted', 'submitted', 'under_review', 'approved', 'rejected')
    ) then
      raise notice 'skipped growth_partner_applications_kyc_status_check: rows outside the allowed KYC states exist';
    else
      alter table public.growth_partner_applications
        add constraint growth_partner_applications_kyc_status_check
        check (kyc_status in ('not_submitted', 'submitted', 'under_review', 'approved', 'rejected'));
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.growth_partner_applications'::regclass
       and conname = 'growth_partner_applications_kyc_document_type_check'
  ) then
    if exists (
      select 1 from public.growth_partner_applications
       where kyc_document_type is not null
         and lower(btrim(kyc_document_type)) not in
             ('pan', 'aadhaar', 'passport', 'driving_license', 'business_registration')
    ) then
      raise notice 'skipped growth_partner_applications_kyc_document_type_check: unsupported document types are already stored';
    else
      alter table public.growth_partner_applications
        add constraint growth_partner_applications_kyc_document_type_check
        check (
          kyc_document_type is null
          or lower(btrim(kyc_document_type)) in
             ('pan', 'aadhaar', 'passport', 'driving_license', 'business_registration')
        );
    end if;
  end if;
end $$;

-- Length limits mirrored by the client (partnerApplicationValidation.ts).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.growth_partner_applications'::regclass
       and conname = 'growth_partner_applications_full_name_length_check'
  ) then
    if exists (
      select 1 from public.growth_partner_applications
       where char_length(full_name) < 2 or char_length(full_name) > 120
    ) then
      raise notice 'skipped growth_partner_applications_full_name_length_check: names outside 2-120 characters exist';
    else
      alter table public.growth_partner_applications
        add constraint growth_partner_applications_full_name_length_check
        check (char_length(full_name) between 2 and 120);
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.growth_partner_applications'::regclass
       and conname = 'growth_partner_applications_field_length_check'
  ) then
    if exists (
      select 1 from public.growth_partner_applications
       where (phone is not null and char_length(phone) > 30)
          or (kyc_document_reference is not null and char_length(kyc_document_reference) > 160)
    ) then
      raise notice 'skipped growth_partner_applications_field_length_check: over-long phone/KYC values exist';
    else
      alter table public.growth_partner_applications
        add constraint growth_partner_applications_field_length_check
        check (
          (phone is null or char_length(phone) <= 30)
          and (kyc_document_reference is null or char_length(kyc_document_reference) <= 160)
        );
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

-- One application per account. The RPC upserts on this key, and it is what
-- turns a repeat submission into a single row instead of a growing history.
create unique index if not exists growth_partner_applications_user_id_key
  on public.growth_partner_applications (user_id);

-- Read paths: the gate's newest-own-row lookup and the admin review queue.
create index if not exists growth_partner_applications_user_created_idx
  on public.growth_partner_applications (user_id, created_at desc);
create index if not exists growth_partner_applications_status_created_idx
  on public.growth_partner_applications (status, created_at desc);

-- One KYC document number per applicant. Created only when the data already
-- satisfies it; otherwise the operator gets a NOTICE and the duplicate is still
-- refused by the RPC below (so the guarantee holds either way).
do $$
begin
  if not exists (
    select 1 from pg_class
     where relname = 'growth_partner_applications_kyc_document_key'
       and relkind = 'i'
  ) then
    if exists (
      select 1
        from public.growth_partner_applications
       where kyc_document_type is not null
         and btrim(coalesce(kyc_document_reference, '')) <> ''
       group by lower(btrim(kyc_document_type)), upper(btrim(kyc_document_reference))
      having count(*) > 1
    ) then
      raise notice 'skipped growth_partner_applications_kyc_document_key: the same KYC document is already registered by more than one account — resolve those rows, then re-run this migration';
    else
      create unique index growth_partner_applications_kyc_document_key
        on public.growth_partner_applications (
          lower(btrim(kyc_document_type)), upper(btrim(kyc_document_reference))
        )
        where kyc_document_type is not null
          and btrim(coalesce(kyc_document_reference, '')) <> '';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.growth_partner_applications enable row level security;

revoke all on public.growth_partner_applications from public, anon;
grant select, insert on public.growth_partner_applications to authenticated;

drop policy if exists growth_partner_applications_self_select on public.growth_partner_applications;
create policy growth_partner_applications_self_select
  on public.growth_partner_applications
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists growth_partner_applications_self_insert on public.growth_partner_applications;
create policy growth_partner_applications_self_insert
  on public.growth_partner_applications
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
  );

comment on table public.growth_partner_applications is
'One Growth Partner application per account. INSERT + SELECT are RLS-scoped to the caller (auth.uid() = user_id); approval is admin-only through review_growth_partner_application().';

-- ---------------------------------------------------------------------------
-- 5. partner_applications — the product-facing column names.
--
-- A `security_invoker` view over the same rows: reads and writes through it are
-- checked as the calling user, so the base table's RLS policies above decide
-- what is visible/insertable. There is deliberately no second table to keep in
-- step.
-- ---------------------------------------------------------------------------
create or replace view public.partner_applications
with (security_invoker = true) as
select
  a.id,
  a.user_id,
  a.full_name,
  a.phone,
  a.kyc_document_type as kyc_type,
  a.kyc_document_reference as kyc_number,
  a.status,
  a.created_at
from public.growth_partner_applications a;

revoke all on public.partner_applications from public, anon;
grant select, insert on public.partner_applications to authenticated;

comment on view public.partner_applications is
'Product-facing view of public.growth_partner_applications (kyc_type = kyc_document_type, kyc_number = kyc_document_reference). security_invoker: the base table RLS policies apply to the caller.';

-- ---------------------------------------------------------------------------
-- 6. Normalization helpers (the DB mirror of partnerApplicationValidation.ts)
-- ---------------------------------------------------------------------------

/** Strip every non-digit, then drop an Indian country/trunk prefix. */
create or replace function public.normalize_partner_phone(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as value
  )
  select case
    when value ~ '^0091[0-9]{10}$' then substring(value from 5)
    when value ~ '^91[0-9]{10}$' then substring(value from 3)
    when value ~ '^0[0-9]{10}$' then substring(value from 2)
    else value
  end
  from digits;
$$;

/** Uppercase and drop separators, so "1234-5678-9012" == "123456789012". */
create or replace function public.normalize_partner_kyc_reference(p_reference text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select upper(regexp_replace(coalesce(p_reference, ''), '[\s\-_/.]', '', 'g'));
$$;

revoke all on function public.normalize_partner_phone(text) from public, anon;
revoke all on function public.normalize_partner_kyc_reference(text) from public, anon;
grant execute on function public.normalize_partner_phone(text) to authenticated;
grant execute on function public.normalize_partner_kyc_reference(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. submit_growth_partner_application — hardened
--
-- SECURITY DEFINER because an upsert (INSERT … ON CONFLICT DO UPDATE) needs
-- UPDATE on the table, which `authenticated` deliberately does not have. It is
-- safe because the identity always comes from `auth.uid()` — never from a
-- parameter — and `search_path` is pinned.
--
-- Error contract the frontend maps to exact copy:
--   42501  Sign in required                      → "Your session expired…"
--   22023  field validation                      → the message, on the field
--   23505  duplicate application / KYC in use    → "You have already submitted an application."
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
  -- Control characters removed, whitespace runs collapsed, trimmed, capped —
  -- the same sanitization src/lib/partnerApplicationValidation.ts applies,
  -- so the stored name is the name the user saw validated.
  v_name text := left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_full_name, ''), '[[:cntrl:]]+', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    ),
    120
  );
  v_phone text := nullif(left(public.normalize_partner_phone(p_phone), 30), '');
  v_kyc_type text := lower(btrim(coalesce(p_kyc_document_type, '')));
  v_kyc_ref text := left(public.normalize_partner_kyc_reference(p_kyc_document_reference), 160);
  v_existing public.growth_partner_applications;
  v_application public.growth_partner_applications;
begin
  -- 7.1 Authentication: the row is owned by the JWT subject, never by an argument.
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  -- 7.2 Already a partner? There is nothing left to apply for.
  if exists (
    select 1
      from public.growth_partners
     where user_id = actor
       and coalesce(is_active, true) is true
       and coalesce(lower(status), 'approved') in ('approved', 'active')
  ) then
    raise exception 'Growth Partner access is already active' using errcode = '23505';
  end if;

  -- 7.3 Field validation (mirrors src/lib/partnerApplicationValidation.ts).
  if v_name = '' then
    raise exception 'Full name is required' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Enter your full name as it appears on your KYC document' using errcode = '22023';
  end if;
  if v_kyc_type not in ('pan', 'aadhaar', 'passport', 'driving_license', 'business_registration') then
    raise exception 'Select a valid KYC document type' using errcode = '22023';
  end if;
  if v_kyc_ref = '' then
    raise exception 'KYC document reference is required' using errcode = '22023';
  end if;
  if v_kyc_type = 'aadhaar' and v_kyc_ref !~ '^[0-9]{12}$' then
    raise exception 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card' using errcode = '22023';
  end if;
  if v_kyc_type = 'pan' and v_kyc_ref !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'Invalid PAN. Enter it as ABCDE1234F' using errcode = '22023';
  end if;
  if v_kyc_type in ('passport', 'driving_license', 'business_registration')
     and v_kyc_ref !~ '^[A-Z0-9]{6,20}$' then
    raise exception 'Invalid % number. Use 6-20 letters or digits',
      case v_kyc_type
        when 'driving_license' then 'driving licence'
        else replace(v_kyc_type, '_', ' ')
      end
      using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit mobile number' using errcode = '22023';
  end if;

  -- 7.4 Duplicate application for THIS account (HTTP 409 in the UI). A rejected
  --     applicant may reapply; pending and approved applications are final
  --     until an administrator reviews them.
  select * into v_existing
    from public.growth_partner_applications
   where user_id = actor;

  if v_existing.id is not null and v_existing.status in ('pending', 'approved') then
    raise exception 'Application already submitted' using errcode = '23505';
  end if;

  -- 7.5 The same KYC document registered by a DIFFERENT account.
  if exists (
    select 1
      from public.growth_partner_applications
     where user_id <> actor
       and lower(btrim(coalesce(kyc_document_type, ''))) = v_kyc_type
       and public.normalize_partner_kyc_reference(kyc_document_reference) = v_kyc_ref
       and status in ('pending', 'approved')
  ) then
    raise exception 'KYC document already used' using errcode = '23505';
  end if;

  -- 7.6 The caller's profile row (the FK target). Existing rows are never touched.
  insert into public.profiles (id, full_name)
  values (actor, v_name)
  on conflict (id) do nothing;

  -- 7.7 Upsert: one row per account, always re-opened as pending + KYC submitted.
  insert into public.growth_partner_applications (
    user_id, full_name, phone, status,
    kyc_status, kyc_document_type, kyc_document_reference, kyc_submitted_at,
    review_note, reviewed_by, reviewed_at, updated_at
  )
  values (
    actor, v_name, v_phone, 'pending',
    'submitted', v_kyc_type, v_kyc_ref, now(),
    null, null, null, now()
  )
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        status = 'pending',
        kyc_status = 'submitted',
        kyc_document_type = excluded.kyc_document_type,
        kyc_document_reference = excluded.kyc_document_reference,
        kyc_submitted_at = now(),
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        updated_at = now()
  returning * into v_application;

  return jsonb_build_object(
    'id', v_application.id,
    'status', v_application.status,
    'kyc_status', v_application.kyc_status,
    'created_at', v_application.created_at
  );
end;
$$;

-- The stale 2-argument overload (created before KYC existed, already revoked
-- from every role) can only cause ambiguous-call errors: drop it.
drop function if exists public.submit_growth_partner_application(text, text);

revoke all on function public.submit_growth_partner_application(text, text, text, text)
  from public, anon;
grant execute on function public.submit_growth_partner_application(text, text, text, text)
  to authenticated;

comment on function public.submit_growth_partner_application(text, text, text, text) is
'Validates and stores the caller-owned Growth Partner application. SECURITY DEFINER (upsert needs UPDATE); identity is auth.uid() only. Duplicates raise 23505 (HTTP 409), invalid fields raise 22023.';

notify pgrst, 'reload schema';
commit;
