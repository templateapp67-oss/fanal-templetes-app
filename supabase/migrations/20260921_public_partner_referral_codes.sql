-- Public partner codes. Existing codes and referral ownership remain unchanged.
-- Approval delegates to provision_growth_partner; client write grants remain revoked.
begin;
alter table public.growth_partners drop constraint growth_partners_code_format;
alter table public.growth_partners add constraint growth_partners_code_format
  check (referral_code ~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$');
create unique index if not exists growth_partners_code_case_insensitive_key
  on public.growth_partners (upper(referral_code));
alter table public.growth_onboarding drop constraint growth_onboarding_referral_consistent;
alter table public.growth_onboarding add constraint growth_onboarding_referral_consistent check (
  (growth_partner_id is null and referral_code is null and linked_at is null)
  or (growth_partner_id is not null and referral_code ~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' and linked_at is not null)
);


create or replace function public.validate_growth_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := public.growth_normalize_code(p_code);
  v_valid boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_code ~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    select exists (
      select 1 from public.growth_partners gp
      where gp.referral_code = v_code and gp.is_active
    ) into v_valid;
  end if;
  return jsonb_build_object(
    'valid', v_valid,
    'referral_code', case when v_valid then v_code else null end
  );
end;
$$;

create or replace function public.link_my_growth_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_code text := public.growth_normalize_code(p_code);
  v_partner uuid;
  v_status text;
  v_linked_at timestamptz;
  v_current_partner uuid;
  v_updated integer := 0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  -- Fail closed when the JWT subject has no live account row. Same message
  -- and code as the missing-session branch: callers cannot distinguish the
  -- two, so this check is not an account-existence oracle.
  if not exists (select 1 from auth.users where id = actor) then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    raise exception 'Invalid referral code' using errcode = '22023';
  end if;
  select gp.user_id into v_partner
  from public.growth_partners gp
  where gp.referral_code = v_code and gp.is_active;
  if v_partner is null then
    raise exception 'Invalid or inactive referral code' using errcode = '22023';
  end if;
  if v_partner = actor then
    raise exception 'You cannot use your own referral code' using errcode = '22023';
  end if;

  insert into public.growth_onboarding as o (user_id) values (actor)
  on conflict (user_id) do nothing;

  -- Serialize racers on the caller's own row; refuse fast when already linked.
  select o.growth_partner_id into v_current_partner
  from public.growth_onboarding as o where o.user_id = actor for update;
  if v_current_partner is not null then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  -- Atomic claim: the predicate is the backstop that lets exactly one
  -- concurrent request win (the lock above serializes; this decides).
  update public.growth_onboarding as o
  set growth_partner_id = v_partner,
      referral_code = v_code,
      linked_at = now(),
      status = case when o.status = 'not_started' then 'linked' else o.status end,
      updated_at = now()
  where o.user_id = actor
    and o.growth_partner_id is null
  returning o.status, o.linked_at into v_status, v_linked_at;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'growth_partner_id', v_partner,
    'referral_code', v_code,
    'linked_at', v_linked_at,
    'status', v_status,
    'partner_name', public.growth_partner_display_name(v_partner)
  );
end;
$$;

create or replace function public.provision_growth_partner(
  p_user_id uuid,
  p_code text default null,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text;
  v_active boolean := coalesce(p_active, true);
  v_attempts int := 0;
begin
  -- Serialize provisioning/rotation, including simultaneous first approvals.
  perform pg_advisory_xact_lock(72650125);
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    -- Explicit code: intentional set/rotation (duplicate-checked below).
    v_code := public.growth_normalize_code(p_code);
  else
    -- Omitted code: keep the partner's current code; auto-generate (with
    -- bounded collision retry) only for brand-new partners.
    select gp.referral_code into v_code
    from public.growth_partners gp where gp.user_id = p_user_id;
    if v_code is null then
      loop
        v_attempts := v_attempts + 1;
        v_code := 'NEXORA-' || upper(substr(md5(gen_random_uuid()::text), 1, 12));
        exit when not exists (
          select 1 from public.growth_partners gp where gp.referral_code = v_code
        );
        if v_attempts >= 10 then
          raise exception 'Could not generate a unique referral code' using errcode = '23505';
        end if;
      end loop;
    end if;
  end if;

  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    raise exception 'Invalid referral code format' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.growth_partners gp
    where gp.referral_code = v_code and gp.user_id <> p_user_id
  ) then
    raise exception 'Referral code is already in use' using errcode = '23505';
  end if;

  insert into public.growth_partners as gp (user_id, referral_code, is_active)
  values (p_user_id, v_code, v_active)
  on conflict (user_id) do update set
    referral_code = excluded.referral_code,
    is_active = excluded.is_active,
    updated_at = now();

  return jsonb_build_object(
    'user_id', p_user_id,
    'referral_code', v_code,
    'is_active', v_active
  );
end;
$$;

commit;
