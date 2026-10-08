-- Restore the factual signup-start milestone lost by the referral lookup
-- replacement. No historical event times are inferred or backfilled.
begin;
create or replace function public.prepare_growth_referral_signup(p_token text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare attribution public.growth_referral_attributions;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('valid', false);
  end if;
  select a.* into attribution
  from public.growth_referral_attributions a
  join public.growth_partners gp on gp.user_id = a.partner_id
  join auth.users u on u.id = gp.user_id
  where a.token_hash = md5(p_token) and a.consumed_at is null
    and a.expires_at > now() and gp.is_active
    and gp.status in ('approved', 'applied', 'active')
    and gp.referral_code = a.referral_code
    and (u.banned_until is null or u.banned_until <= now())
  for update of a;
  if not found then return jsonb_build_object('valid', false); end if;
  if attribution.referral_id is not null then
    perform public.record_partner_referral_event(
      attribution.referral_id, 'signup_started', '{"source":"signup"}', now());
  end if;
  return jsonb_build_object('valid', true, 'token', p_token,
    'referral_code', attribution.referral_code, 'expires_at', attribution.expires_at);
end $$;
revoke all on function public.prepare_growth_referral_signup(text) from public;
grant execute on function public.prepare_growth_referral_signup(text) to anon, authenticated, service_role;
-- Provisioning is idempotent and must never claim a requested code was saved
-- when the existing canonical code was preserved by the conflict clause.
create or replace function public.provision_growth_partner(
  p_user_id uuid,
  p_code text default null::text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_code text;
  v_partner_code text;
  v_active boolean := coalesce(p_active, true);
  v_attempts int := 0;
begin
  perform pg_advisory_xact_lock(72650125);

  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select gp.partner_code, gp.referral_code
    into v_partner_code, v_code
  from public.growth_partners gp
  where gp.user_id = p_user_id;

  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    v_code := public.growth_normalize_code(p_code);
  elsif v_code is null then
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      v_code := 'NEXORA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

      exit when not exists (
        select 1 from public.growth_partners gp where gp.referral_code = v_code
      );

      if v_attempts >= 10 then
        raise exception 'Could not generate a unique referral code' using errcode = '23505';
      end if;
    end loop;
  end if;

  if nullif(btrim(coalesce(v_partner_code, '')), '') is null then
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      v_partner_code := 'NXGP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

      exit when not exists (
        select 1 from public.growth_partners gp where gp.partner_code = v_partner_code
      );

      if v_attempts >= 10 then
        raise exception 'Could not generate a unique partner code' using errcode = '23505';
      end if;
    end loop;
  end if;

  if v_code !~ '^[A-Z0-9-]{6,32}$' then
    raise exception 'Invalid referral code format' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.growth_partners gp
    where gp.referral_code = v_code
      and gp.user_id <> p_user_id
  ) then
    raise exception 'Referral code is already in use' using errcode = '23505';
  end if;

  insert into public.growth_partners as gp (
    user_id, partner_code, referral_code, status, is_active
  )
  values (
    p_user_id, v_partner_code, v_code, 'approved', v_active
  )
  on conflict (user_id) do update set
    partner_code = coalesce(nullif(gp.partner_code, ''), excluded.partner_code),
    referral_code = coalesce(nullif(gp.referral_code, ''), excluded.referral_code),
    status = 'approved',
    is_active = excluded.is_active,
    updated_at = now();

  -- Return the canonical stored codes; ON CONFLICT deliberately preserves them.
  select gp.partner_code, gp.referral_code, gp.is_active
    into v_partner_code, v_code, v_active
  from public.growth_partners gp where gp.user_id = p_user_id;

  return jsonb_build_object(
    'user_id', p_user_id,
    'partner_code', v_partner_code,
    'referral_code', v_code,
    'is_active', v_active
  );
end
$function$;
revoke all on function public.provision_growth_partner(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.provision_growth_partner(uuid,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
