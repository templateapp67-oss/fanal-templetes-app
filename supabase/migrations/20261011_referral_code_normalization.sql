-- Referral-code normalization repair.
-- Makes every lookup case- and whitespace-insensitive even for historic rows
-- whose stored code predates the canonical uppercase constraint.
begin;

create or replace function public.validate_growth_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_stored_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    return jsonb_build_object('valid', false, 'referral_code', null);
  end if;

  select gp.referral_code into v_stored_code
  from public.growth_partners gp
  where upper(gp.referral_code) = v_code and gp.is_active
  limit 1;

  return jsonb_build_object(
    'valid', v_stored_code is not null,
    'referral_code', case when v_stored_code is null then null else upper(btrim(v_stored_code)) end
  );
end;
$$;

create or replace function public.capture_growth_referral(p_code text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_partner uuid;
  v_token text;
  v_existing public.growth_referral_attributions;
begin
  if p_token ~ '^[a-f0-9]{64}$' then
    select a.* into v_existing
    from public.growth_referral_attributions a
    join public.growth_partners gp
      on gp.user_id = a.partner_id
     and gp.is_active
     and upper(gp.referral_code) = upper(a.referral_code)
    where a.token_hash = md5(p_token)
      and a.expires_at > now()
      and a.consumed_at is null;
    if found then
      return jsonb_build_object(
        'valid', true, 'token', p_token,
        'referral_code', upper(btrim(v_existing.referral_code)),
        'expires_at', v_existing.expires_at
      );
    end if;
  end if;

  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    return jsonb_build_object('valid', false);
  end if;

  select gp.user_id into v_partner
  from public.growth_partners gp
  where upper(gp.referral_code) = v_code and gp.is_active
  limit 1;
  if v_partner is null then return jsonb_build_object('valid', false); end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.growth_referral_attributions(token_hash, partner_id, referral_code)
  values (md5(v_token), v_partner, v_code);

  return jsonb_build_object(
    'valid', true, 'token', v_token,
    'referral_code', v_code, 'expires_at', now() + interval '7 days'
  );
end;
$$;

revoke all on function public.validate_growth_referral_code(text) from public, anon;
grant execute on function public.validate_growth_referral_code(text) to authenticated;
revoke all on function public.capture_growth_referral(text, text) from public;
grant execute on function public.capture_growth_referral(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
