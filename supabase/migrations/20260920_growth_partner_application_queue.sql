-- Growth Partner application queue for administrators.
--
-- The approval flow shipped with a way to apply (`submit_growth_partner_application`)
-- and a way to decide (`review_growth_partner_application`), but no supported way
-- for an admin to see what is waiting. Reviewers had to query the table directly
-- with a service-role key. This closes that gap with an admin-only function.
--
-- Safety notes, matching the rest of the chain:
--   * admin-only: `private.is_admin()` is required (see GROWTH_PARTNER_SETUP.md
--     "Prerequisites" for the definition the chain assumes), and the caller must
--     additionally be `service_role` because no EXECUTE grant exists for
--     `anon`/`authenticated`;
--   * SECURITY DEFINER so admins do not need direct table grants;
--   * returns only what a reviewer needs to decide — no password material, no
--     tokens, no other tenants' rows.

create or replace function public.list_growth_partner_applications(
  p_status text default null,
  p_limit int default 50
)
returns table (
  id uuid,
  user_id uuid,
  applicant_name text,
  applicant_email text,
  applicant_phone text,
  status text,
  kyc_status text,
  kyc_document_type text,
  kyc_document_reference text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Only administrators may list growth partner applications'
      using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown application status' using errcode = '22023';
  end if;

  return query
  select
    a.id,
    a.user_id,
    a.full_name as applicant_name,
    coalesce(nullif(btrim(pro.email), ''), '(no email on profile)') as applicant_email,
    a.phone as applicant_phone,
    a.status,
    a.kyc_status,
    a.kyc_document_type,
    a.kyc_document_reference,
    a.review_note,
    a.created_at,
    a.reviewed_at
  from public.growth_partner_applications a
  left join public.profiles pro on pro.id = a.user_id
  where p_status is null or a.status = p_status
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.list_growth_partner_applications(text, int) from public;
revoke all on function public.list_growth_partner_applications(text, int) from anon, authenticated;
grant execute on function public.list_growth_partner_applications(text, int) to service_role;

comment on function public.list_growth_partner_applications(text, int)
  is 'Admin-only queue of Growth Partner KYC applications. Requires private.is_admin() and a service_role caller.';
