alter table public.growth_partner_applications
  add column if not exists kyc_status text not null default 'not_submitted'
    check (kyc_status in ('not_submitted','submitted','under_review','approved','rejected')),
  add column if not exists kyc_document_type text,
  add column if not exists kyc_document_reference text,
  add column if not exists kyc_submitted_at timestamptz,
  add column if not exists kyc_reviewed_at timestamptz,
  add column if not exists kyc_reviewed_by uuid references public.profiles(id) on delete set null;

-- KYC metadata is visible only to the applicant and admins. Actual documents
-- belong in a private storage bucket; this table stores only a safe reference.
create or replace function public.submit_growth_partner_application(
  p_full_name text, p_phone text default null,
  p_kyc_document_type text default null, p_kyc_document_reference text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); row public.growth_partner_applications;
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if nullif(btrim(p_full_name), '') is null then raise exception 'Full name is required' using errcode='22023'; end if;
  if lower(btrim(coalesce(p_kyc_document_type,''))) not in ('pan','aadhaar','passport','driving_license','business_registration') then
    raise exception 'Select a valid KYC document type' using errcode='22023';
  end if;
  if nullif(btrim(p_kyc_document_reference), '') is null then raise exception 'KYC document reference is required' using errcode='22023'; end if;
  insert into public.growth_partner_applications(user_id,full_name,phone,kyc_status,kyc_document_type,kyc_document_reference,kyc_submitted_at)
  values(actor,left(btrim(p_full_name),120),nullif(left(btrim(coalesce(p_phone,'')),30),''),'submitted',lower(btrim(p_kyc_document_type)),left(btrim(p_kyc_document_reference),160),now())
  on conflict (user_id) do update set full_name=excluded.full_name,phone=excluded.phone,kyc_status='submitted',kyc_document_type=excluded.kyc_document_type,kyc_document_reference=excluded.kyc_document_reference,kyc_submitted_at=now(),status='pending',review_note=null,updated_at=now()
  returning * into row;
  return jsonb_build_object('id',row.id,'status',row.status,'kyc_status',row.kyc_status,'created_at',row.created_at);
end $$;
revoke all on function public.submit_growth_partner_application(text,text) from public,anon,authenticated;
revoke all on function public.submit_growth_partner_application(text,text,text,text) from public,anon;
grant execute on function public.submit_growth_partner_application(text,text,text,text) to authenticated;

create or replace function public.review_growth_partner_application(p_application_id uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); app public.growth_partner_applications; code text; ref text;
begin
  if actor is null or not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  select * into app from public.growth_partner_applications where id=p_application_id for update;
  if app.id is null then raise exception 'Application not found' using errcode='22023'; end if;
  if p_approve then
    if app.kyc_status <> 'submitted' or nullif(btrim(app.kyc_document_reference),'') is null then raise exception 'KYC must be submitted before approval' using errcode='22023'; end if;
    code:='NXGP-'||upper(substr(replace(app.user_id::text,'-',''),1,10)); ref:='REF-'||upper(substr(replace(app.user_id::text,'-',''),11,10));
    insert into public.growth_partners(user_id,partner_code,referral_code,status) values(app.user_id,code,ref,'approved') on conflict(user_id) do update set status='approved',partner_code=excluded.partner_code,referral_code=excluded.referral_code;
    update public.growth_partner_applications set status='approved',kyc_status='approved',review_note=nullif(btrim(p_note),''),reviewed_by=actor,reviewed_at=now(),kyc_reviewed_by=actor,kyc_reviewed_at=now(),updated_at=now() where id=app.id;
  else
    update public.growth_partner_applications set status='rejected',kyc_status='rejected',review_note=nullif(btrim(p_note),''),reviewed_by=actor,reviewed_at=now(),kyc_reviewed_by=actor,kyc_reviewed_at=now(),updated_at=now() where id=app.id;
  end if;
  return jsonb_build_object('id',app.id,'status',case when p_approve then 'approved' else 'rejected' end,'kyc_status',case when p_approve then 'approved' else 'rejected' end);
end $$;
revoke all on function public.review_growth_partner_application(uuid,boolean,text) from public,anon,authenticated;
notify pgrst,'reload schema';
