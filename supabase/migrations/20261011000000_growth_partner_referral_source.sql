-- Canonical Growth Partner referral-code source of truth.
-- Existing referral codes are preserved. New codes are random and are never
-- derived from auth.users.id. Browser reads stay RLS-scoped to auth.uid().

create or replace function public.get_my_referral_code()
returns text
language sql
stable
security invoker
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $$
  select gp.referral_code
  from public.growth_partners gp
  where gp.user_id = (select auth.uid())
  limit 1
$$;

revoke all on function public.get_my_referral_code() from public;
revoke all on function public.get_my_referral_code() from anon;
grant execute on function public.get_my_referral_code() to authenticated;

create or replace function public.ensure_growth_partner_identity()
returns table(id uuid, user_id uuid, partner_code text, referral_code text, status text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
  profile_role text;
  existing public.growth_partners%rowtype;
  generated_code text;
  generated_referral text;
begin
  if caller is null then
    raise exception 'authentication required';
  end if;

  select p.platform_role
    into profile_role
  from public.profiles p
  where p.id = caller
    and p.is_active = true;

  if profile_role is distinct from 'growth_partner' then
    raise exception 'active Growth Partner role required';
  end if;

  select gp.* into existing
  from public.growth_partners gp
  where gp.user_id = caller
  limit 1;

  if found then
    return query
      select existing.id, existing.user_id, existing.partner_code, existing.referral_code, existing.status;
    return;
  end if;

  loop
    generated_code := 'NXGP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (
      select 1 from public.growth_partners gp where gp.partner_code = generated_code
    );
  end loop;

  loop
    generated_referral := 'NEXORA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    exit when not exists (
      select 1 from public.growth_partners gp where gp.referral_code = generated_referral
    );
  end loop;

  insert into public.growth_partners (user_id, partner_code, referral_code, status)
  values (caller, generated_code, generated_referral, 'applied')
  returning * into existing;

  return query
    select existing.id, existing.user_id, existing.partner_code, existing.referral_code, existing.status;
end
$function$;

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
    p_user_id, v_partner_code, v_code, 'applied', v_active
  )
  on conflict (user_id) do update set
    partner_code = coalesce(nullif(gp.partner_code, ''), excluded.partner_code),
    referral_code = coalesce(nullif(gp.referral_code, ''), excluded.referral_code),
    is_active = excluded.is_active,
    updated_at = now();

  return jsonb_build_object(
    'user_id', p_user_id,
    'partner_code', v_partner_code,
    'referral_code', v_code,
    'is_active', v_active
  );
end
$function$;
