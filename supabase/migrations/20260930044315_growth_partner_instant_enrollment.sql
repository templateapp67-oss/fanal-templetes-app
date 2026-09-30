-- Dashboard enrollment is immediate; KYC verification remains separate.
begin;
set local lock_timeout = '5s';

-- The committed normalization trigger calls the two-argument overload; older
-- installations only define the single-reference helper. Preserve an existing
-- document-aware implementation and bridge the older schema when needed.
do $bridge$
begin
  if to_regprocedure('public.normalize_partner_kyc_reference(text,text)') is null then
    execute $definition$
      create function public.normalize_partner_kyc_reference(p_document_type text, p_reference text)
      returns text language plpgsql immutable set search_path = pg_catalog, public, pg_temp
      as $body$begin return public.normalize_partner_kyc_reference(p_reference); end$body$
    $definition$;
    revoke all on function public.normalize_partner_kyc_reference(text,text) from public, anon;
    grant execute on function public.normalize_partner_kyc_reference(text,text) to authenticated;
  end if;
end;
$bridge$;

create or replace function public.enroll_submitted_growth_partner()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status <> 'pending' or new.kyc_status not in ('submitted', 'under_review', 'approved')
     or nullif(btrim(new.kyc_document_reference), '') is null then
    return new;
  end if;
  if exists (select 1 from auth.users where id = new.user_id and banned_until > now()) then
    return new;
  end if;
  -- Preserve existing referral codes and administratively paused accounts.
  if exists (select 1 from public.growth_partners where user_id = new.user_id and is_active = false) then
    return new;
  end if;
  if not exists (select 1 from public.growth_partners where user_id = new.user_id) then
    perform public.provision_growth_partner(new.user_id);
  end if;
  -- Some installations include a lifecycle column, others use is_active only.
  if exists (select 1 from information_schema.columns where table_schema='public'
             and table_name='growth_partners' and column_name='status') then
    execute 'update public.growth_partners set status = ''approved'' where user_id = $1'
      using new.user_id;
  end if;
  new.status := 'approved';
  -- Do not claim that submitted KYC has been reviewed or verified.
  return new;
end;
$$;
revoke all on function public.enroll_submitted_growth_partner() from public, anon, authenticated;
drop trigger if exists zz_instant_growth_partner_enrollment on public.growth_partner_applications;
create trigger zz_instant_growth_partner_enrollment before insert or update
  on public.growth_partner_applications for each row
  execute function public.enroll_submitted_growth_partner();

-- Upgrade existing submitted applicants using the same enrollment rules.
update public.growth_partner_applications set status = status
where status = 'pending' and kyc_status in ('submitted', 'under_review', 'approved')
  and nullif(btrim(kyc_document_reference), '') is not null;

create or replace function public.ensure_my_growth_partner()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare actor uuid := auth.uid(); partner public.growth_partners;
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if exists (select 1 from auth.users where id=actor and banned_until > now()) then
    raise exception 'Your account is suspended' using errcode='42501';
  end if;
  update public.growth_partner_applications set status = status
    where user_id=actor and status='pending';
  select * into partner from public.growth_partners where user_id=actor;
  if partner.user_id is null then
    raise exception 'Submit your Growth Partner application first' using errcode='22023';
  end if;
  return to_jsonb(partner);
end;
$$;
revoke all on function public.ensure_my_growth_partner() from public, anon;
grant execute on function public.ensure_my_growth_partner() to authenticated;
notify pgrst, 'reload schema';
commit;
