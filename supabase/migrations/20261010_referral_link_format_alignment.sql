-- Align every referral entry point with the canonical format already used
-- by growth_partners and provision_growth_partner.
-- Required example: REF-5A45019655.
-- Canonical: 6-32 uppercase letters, digits and hyphens.

create or replace function public.capture_growth_referral(p_code text,p_token text default null)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_code text := public.growth_normalize_code(p_code);
  v_partner uuid;
  v_token text;
  v_existing public.growth_referral_attributions;
begin
  if p_token ~ '^[a-f0-9]{64}$' then
    select a.* into v_existing
    from public.growth_referral_attributions a
    join public.growth_partners gp
      on gp.user_id=a.partner_id
     and gp.is_active
     and gp.status='approved'
     and gp.referral_code=a.referral_code
    where a.token_hash=md5(p_token)
      and a.expires_at>now()
      and a.consumed_at is null;
    if found then
      return jsonb_build_object(
        'valid',true,'token',p_token,'referral_code',v_existing.referral_code,
        'expires_at',v_existing.expires_at
      );
    end if;
  end if;

  if v_code !~ '^[A-Z0-9-]{6,32}$' then
    return jsonb_build_object('valid',false);
  end if;

  select gp.user_id into v_partner
  from public.growth_partners gp
  where gp.referral_code=v_code
    and gp.is_active
    and gp.status='approved';

  if v_partner is null then return jsonb_build_object('valid',false); end if;

  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.growth_referral_attributions(token_hash,partner_id,referral_code)
  values(md5(v_token),v_partner,v_code);

  return jsonb_build_object(
    'valid',true,'token',v_token,'referral_code',v_code,
    'expires_at',now()+interval '7 days'
  );
end $$;

create or replace function public.link_my_growth_referral(p_code text)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  actor uuid:=auth.uid();
  v_code text:=public.growth_normalize_code(p_code);
  v_partner uuid;
  v_status text;
  v_linked_at timestamptz;
  v_current_partner uuid;
  v_updated integer:=0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users where id=actor) then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  if v_code !~ '^[A-Z0-9-]{6,32}$' then
    raise exception 'Invalid referral code' using errcode='22023';
  end if;

  select gp.user_id into v_partner
  from public.growth_partners gp
  where gp.referral_code=v_code
    and gp.is_active
    and gp.status='approved';

  if v_partner is null or not public.growth_partner_is_usable(v_partner) then
    raise exception 'Invalid or inactive referral code' using errcode='22023';
  end if;
  if v_partner=actor then
    raise exception 'You cannot use your own referral code' using errcode='22023';
  end if;

  insert into public.growth_onboarding as o(user_id) values(actor)
  on conflict(user_id) do nothing;

  select o.growth_partner_id into v_current_partner
  from public.growth_onboarding o where o.user_id=actor for update;
  if v_current_partner is not null then
    raise exception 'This account is already linked to a Growth Partner' using errcode='22023';
  end if;

  update public.growth_onboarding as o
  set growth_partner_id=v_partner,
      referral_code=v_code,
      linked_at=now(),
      status=case when o.status='not_started' then 'linked' else o.status end,
      updated_at=now()
  where o.user_id=actor and o.growth_partner_id is null
  returning o.status,o.linked_at into v_status,v_linked_at;

  get diagnostics v_updated=row_count;
  if v_updated<>1 then
    raise exception 'This account is already linked to a Growth Partner' using errcode='22023';
  end if;

  return jsonb_build_object(
    'growth_partner_id',v_partner,
    'referral_code',v_code,
    'linked_at',v_linked_at,
    'status',v_status,
    'partner_name',public.growth_partner_display_name(v_partner)
  );
end $$;

revoke all on function public.capture_growth_referral(text,text) from public,anon,authenticated;
grant execute on function public.capture_growth_referral(text,text) to service_role;
revoke all on function public.link_my_growth_referral(text) from public,anon;
grant execute on function public.link_my_growth_referral(text) to authenticated,service_role;

do $$
begin
  if public.growth_normalize_code(' ref-5a45019655 ') !~ '^[A-Z0-9-]{6,32}$' then
    raise exception 'REF code format alignment failed';
  end if;
end $$;