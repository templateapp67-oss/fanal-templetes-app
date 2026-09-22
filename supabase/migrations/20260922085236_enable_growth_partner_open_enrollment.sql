-- Open enrollment: a signed-in user who submits their own validated
-- application becomes an active Growth Partner immediately. Dashboard RLS and
-- RPCs remain owner-scoped; this changes enrollment timing, not data access.
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
  partner jsonb;
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

  insert into public.profiles(id, full_name)
  values (actor, left(btrim(p_full_name), 120))
  on conflict (id) do nothing;

  insert into public.growth_partner_applications(
    user_id, full_name, phone, status,
    kyc_status, kyc_document_type, kyc_document_reference, kyc_submitted_at,
    reviewed_at, updated_at
  ) values (
    actor,
    left(btrim(p_full_name), 120),
    nullif(left(btrim(coalesce(p_phone, '')), 30), ''),
    'approved',
    'approved',
    lower(btrim(p_kyc_document_type)),
    left(btrim(p_kyc_document_reference), 160),
    now(), now(), now()
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    status = 'approved',
    kyc_status = 'approved',
    kyc_document_type = excluded.kyc_document_type,
    kyc_document_reference = excluded.kyc_document_reference,
    kyc_submitted_at = now(),
    review_note = null,
    reviewed_at = now(),
    updated_at = now()
  returning * into application;

  -- provision_growth_partner is admin-only to external callers. This wrapper
  -- may invoke it only for auth.uid(), never for a caller-supplied user id.
  select public.provision_growth_partner(actor) into partner;

  return jsonb_build_object(
    'id', application.id,
    'status', 'approved',
    'kyc_status', 'approved',
    'referral_code', partner ->> 'referral_code',
    'created_at', application.created_at
  );
end;
$$;

revoke all on function public.submit_growth_partner_application(text, text, text, text)
  from public, anon;
grant execute on function public.submit_growth_partner_application(text, text, text, text)
  to authenticated;

comment on function public.submit_growth_partner_application(text, text, text, text) is
'Open enrollment: validates KYC metadata and provisions only auth.uid() as an active Growth Partner. Other partners remain inaccessible through owner-scoped RLS.';

-- Existing pending applicants must not remain trapped on the retired review
-- screen. Provision only applicants who had already submitted KYC metadata;
-- rejected records remain rejected until the user explicitly reapplies.
do $$
declare
  application record;
begin
  for application in
    select user_id
    from public.growth_partner_applications
    where status = 'pending'
      and kyc_status in ('submitted', 'approved')
      and nullif(btrim(kyc_document_reference), '') is not null
  loop
    perform public.provision_growth_partner(application.user_id);
    update public.growth_partner_applications
      set status = 'approved',
          kyc_status = 'approved',
          review_note = null,
          reviewed_at = now(),
          updated_at = now()
      where user_id = application.user_id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
