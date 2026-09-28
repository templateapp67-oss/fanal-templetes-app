-- Growth Partner dashboard access is opt-in and reviewed. Completing the
-- application is required, but never by itself creates an active partner row.
-- Only the existing admin review function may provision a growth_partners row.
begin;

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
  application public.growth_partner_applications;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.growth_partners
    where user_id = actor and coalesce(is_active, true) is true
      and coalesce(lower(status), 'approved') in ('approved', 'active')
  ) then
    raise exception 'Growth Partner access is already active' using errcode = '22023';
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

  insert into public.profiles(id, full_name)
  values (actor, left(btrim(p_full_name), 120))
  on conflict (id) do nothing;

  insert into public.growth_partner_applications(
    user_id, full_name, phone, status, kyc_status, kyc_document_type,
    kyc_document_reference, kyc_submitted_at, reviewed_at, reviewed_by,
    review_note, updated_at
  ) values (
    actor, left(btrim(p_full_name), 120),
    nullif(left(btrim(coalesce(p_phone, '')), 30), ''),
    'pending', 'submitted', lower(btrim(p_kyc_document_type)),
    left(btrim(p_kyc_document_reference), 160), now(), null, null, null, now()
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    status = 'pending',
    kyc_status = 'submitted',
    kyc_document_type = excluded.kyc_document_type,
    kyc_document_reference = excluded.kyc_document_reference,
    kyc_submitted_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    review_note = null,
    updated_at = now()
  returning * into application;

  return jsonb_build_object(
    'id', application.id,
    'status', application.status,
    'kyc_status', application.kyc_status,
    'created_at', application.created_at
  );
end;
$$;

revoke all on function public.submit_growth_partner_application(text, text, text, text)
  from public, anon;
grant execute on function public.submit_growth_partner_application(text, text, text, text)
  to authenticated;

comment on function public.submit_growth_partner_application(text, text, text, text) is
'Stores the caller-owned Growth Partner application as pending. Admin review is required before provision_growth_partner creates dashboard access.';

notify pgrst, 'reload schema';
commit;
