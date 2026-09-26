-- Database-backed referral eligibility. Never creates a partner or a referral code.
-- Historical links and already-consumed attributions are left untouched.
create or replace function public.is_approved_growth_referrer(p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.growth_partners gp
    where gp.user_id = p_user_id and gp.is_active is true
      and gp.status = 'approved'
      and nullif(to_jsonb(gp)->>'deleted_at', '') is null
      and nullif(to_jsonb(gp)->>'disabled_at', '') is null
  )
$$;
revoke all on function public.is_approved_growth_referrer(uuid) from public, anon;
grant execute on function public.is_approved_growth_referrer(uuid) to authenticated;

create or replace function public.validate_growth_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_stored text;
begin
  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    return jsonb_build_object('valid', false, 'referral_code', null);
  end if;
  select gp.referral_code into v_stored from public.growth_partners gp
  where upper(btrim(gp.referral_code)) = v_code
    and public.is_approved_growth_referrer(gp.user_id)
  limit 1;
  return jsonb_build_object('valid', v_stored is not null, 'referral_code', v_stored);
end $$;
revoke all on function public.validate_growth_referral_code(text) from public, anon;
grant execute on function public.validate_growth_referral_code(text) to authenticated;

create or replace function public.capture_growth_referral(p_code text, p_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_partner public.growth_partners%rowtype;
  v_old public.growth_referral_attributions%rowtype;
  v_token text;
begin
  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    return jsonb_build_object('valid', false);
  end if;
  select gp.* into v_partner from public.growth_partners gp
  where upper(btrim(gp.referral_code)) = v_code
    and public.is_approved_growth_referrer(gp.user_id)
  limit 1;
  if not found then return jsonb_build_object('valid', false); end if;

  -- Reuse a capability only for this same approved partner AND stored code.
  if p_token ~ '^[a-f0-9]{64}$' then
    select * into v_old from public.growth_referral_attributions
    where token_hash = md5(p_token) and expires_at > now() and consumed_at is null
      and partner_id = v_partner.user_id and referral_code = v_partner.referral_code;
    if found then
      return jsonb_build_object('valid', true, 'token', p_token,
        'referral_code', v_partner.referral_code, 'expires_at', v_old.expires_at);
    end if;
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.growth_referral_attributions(token_hash, partner_id, referral_code)
  values (md5(v_token), v_partner.user_id, v_partner.referral_code);
  return jsonb_build_object('valid', true, 'token', v_token,
    'referral_code', v_partner.referral_code, 'expires_at', now() + interval '7 days');
end $$;
revoke all on function public.capture_growth_referral(text,text) from public;
grant execute on function public.capture_growth_referral(text,text) to anon, authenticated;

create or replace function public.prepare_growth_referral_signup(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attr public.growth_referral_attributions%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('valid',false); end if;
  select * into v_attr from public.growth_referral_attributions
  where token_hash=md5(p_token) and consumed_at is null and expires_at>now() for update;
  if not found or not public.is_approved_growth_referrer(v_attr.partner_id) then
    return jsonb_build_object('valid',false);
  end if;
  perform 1 from public.growth_partners gp where gp.user_id=v_attr.partner_id
    and gp.referral_code=v_attr.referral_code for share;
  if not found then return jsonb_build_object('valid',false); end if;
  if v_attr.referral_id is not null then
    perform public.record_partner_referral_event(v_attr.referral_id,'signup_started','{"source":"signup"}',now());
  end if;
  return jsonb_build_object('valid',true,'token',p_token,
    'referral_code',v_attr.referral_code,'expires_at',v_attr.expires_at);
end $$;
revoke all on function public.prepare_growth_referral_signup(text) from public;
grant execute on function public.prepare_growth_referral_signup(text) to anon, authenticated, service_role;

create or replace function public.consume_signup_growth_referral()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_token text := new.raw_user_meta_data ->> 'growth_referral_token';
  v_attr public.growth_referral_attributions%rowtype;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then return new; end if;
  select * into v_attr from public.growth_referral_attributions
  where token_hash=md5(v_token) and expires_at>now() and consumed_at is null for update;
  if not found or v_attr.partner_id=new.id or
     not public.is_approved_growth_referrer(v_attr.partner_id) then return new; end if;
  perform 1 from public.growth_partners gp where gp.user_id=v_attr.partner_id
    and gp.referral_code=v_attr.referral_code for share;
  if not found then return new; end if;
  insert into public.growth_onboarding as o(user_id,growth_partner_id,referral_code,linked_at,status)
  values(new.id,v_attr.partner_id,v_attr.referral_code,now(),'linked')
  on conflict(user_id) do update set growth_partner_id=excluded.growth_partner_id,
    referral_code=excluded.referral_code,linked_at=excluded.linked_at,
    status=case when o.status='not_started' then 'linked' else o.status end
  where o.growth_partner_id is null;
  update public.growth_referral_attributions set consumed_by=new.id,consumed_at=now()
  where token_hash=v_attr.token_hash and consumed_at is null;
  return new;
end $$;
revoke all on function public.consume_signup_growth_referral() from public, anon, authenticated;
notify pgrst, 'reload schema';

-- Both outgoing partner-code reads use the identical eligibility predicate.
create or replace function public.get_my_referral_code()
returns text language sql stable security definer set search_path = '' as $$
  select gp.referral_code from public.growth_partners gp
  where gp.user_id = (select auth.uid())
    and public.is_approved_growth_referrer(gp.user_id)
  limit 1
$$;
revoke all on function public.get_my_referral_code() from public, anon;
grant execute on function public.get_my_referral_code() to authenticated;

create or replace function public.get_my_growth_partner()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id',gp.user_id,'referral_code',gp.referral_code,
    'status',gp.status,'is_active',gp.is_active,
    'created_at',gp.created_at,'updated_at',gp.updated_at)
  from public.growth_partners gp
  where gp.user_id=(select auth.uid()) and public.is_approved_growth_referrer(gp.user_id)
  limit 1
$$;
revoke all on function public.get_my_growth_partner() from public, anon;
grant execute on function public.get_my_growth_partner() to authenticated;

-- Legacy dashboard/profile RPCs call this gate; deny referred users and any
-- unapproved/inactive/deleted partner even if a legacy function forgets a check.
create or replace function public.partner_dashboard_caller()
returns public.growth_partners language plpgsql stable security definer set search_path = '' as $$
declare v_partner public.growth_partners%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select * into v_partner from public.growth_partners gp
  where gp.user_id=(select auth.uid()) and public.is_approved_growth_referrer(gp.user_id);
  if not found then raise exception 'Partner access required' using errcode='42501'; end if;
  return v_partner;
end $$;
revoke all on function public.partner_dashboard_caller() from public, anon, authenticated;

create or replace function public.my_active_partner_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select gp.id from public.growth_partners gp
  where gp.user_id=(select auth.uid()) and public.is_approved_growth_referrer(gp.user_id)
  limit 1
$$;
revoke all on function public.my_active_partner_id() from public, anon;
grant execute on function public.my_active_partner_id() to authenticated, service_role;

-- Restrictive fences compose with all pre-existing permissive policies. A
-- referred owner still sees their own onboarding row, never partner-only rows.
alter table public.growth_onboarding enable row level security;
drop policy if exists approved_partner_onboarding_fence on public.growth_onboarding;
create policy approved_partner_onboarding_fence on public.growth_onboarding as restrictive
  for select to authenticated using (
    user_id=(select auth.uid()) or
    (growth_partner_id=(select auth.uid()) and
     public.is_approved_growth_referrer((select auth.uid())))
  );

do $$ begin
  if to_regclass('public.partner_referrals') is not null then
    drop policy if exists approved_partner_referrals_fence on public.partner_referrals;
    create policy approved_partner_referrals_fence on public.partner_referrals as restrictive
      for select to authenticated using (
        exists(select 1 from public.growth_partners gp
          where gp.id=partner_referrals.partner_id and gp.user_id=(select auth.uid())
            and public.is_approved_growth_referrer(gp.user_id))
      );
  end if;
  if to_regclass('public.partner_referral_events') is not null then
    drop policy if exists approved_partner_events_fence on public.partner_referral_events;
    create policy approved_partner_events_fence on public.partner_referral_events as restrictive
      for select to authenticated using (
        exists(select 1 from public.partner_referrals pr
          join public.growth_partners gp on gp.id=pr.partner_id
          where pr.id=partner_referral_events.referral_id and gp.user_id=(select auth.uid())
            and public.is_approved_growth_referrer(gp.user_id))
      );
  end if;
end $$;
