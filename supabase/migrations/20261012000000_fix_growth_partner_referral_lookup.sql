-- ============================================================================
-- Migration: Fix Growth Partner Referral Lookup & Status Alignment
-- Safe, idempotent script for Supabase SQL Editor
-- ============================================================================

begin;

-- 1. Ensure required columns exist on public.growth_partners
alter table public.growth_partners add column if not exists partner_code text;
alter table public.growth_partners add column if not exists referral_code text;
alter table public.growth_partners add column if not exists is_active boolean default true;
alter table public.growth_partners add column if not exists status text default 'approved';

-- 2. Update any active growth partners whose status is 'applied' or null to 'approved'
update public.growth_partners
set status = 'approved'
where is_active = true and (status is null or status = 'applied');

-- 3. Ensure growth_referral_attributions table exists with required schema
create table if not exists public.growth_referral_attributions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  partner_id uuid not null references public.growth_partners(user_id) on delete cascade,
  referral_code text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  consumed_at timestamptz default null,
  created_at timestamptz not null default now()
);

create index if not exists idx_growth_referral_attributions_token
  on public.growth_referral_attributions (token_hash, expires_at);

-- 4. Enable RLS on attribution table and add service-level policy
alter table public.growth_referral_attributions enable row level security;

-- 5. Canonical referral capture function
-- Resolves both raw codes and 'NEXORA-' prefixed codes against referral_code and partner_code
create or replace function public.capture_growth_referral(p_code text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_input text := upper(btrim(coalesce(p_code, '')));
  v_raw_code text;
  v_prefixed_code text;
  v_partner uuid;
  v_canonical_code text;
  v_token text;
  v_existing public.growth_referral_attributions;
begin
  -- Validate existing token if provided
  if p_token is not null and p_token ~ '^[a-f0-9]{64}$' then
    select a.* into v_existing
    from public.growth_referral_attributions a
    join public.growth_partners gp
      on gp.user_id = a.partner_id
     and gp.is_active = true
     and gp.status in ('approved', 'applied', 'active')
    where a.token_hash = md5(p_token)
      and a.expires_at > now()
      and a.consumed_at is null;

    if found then
      return jsonb_build_object(
        'valid', true,
        'token', p_token,
        'referral_code', upper(btrim(v_existing.referral_code)),
        'expires_at', v_existing.expires_at
      );
    end if;
  end if;

  if v_input = '' then
    return jsonb_build_object('valid', false);
  end if;

  -- Extract both raw and prefixed versions
  if v_input like 'NEXORA-%' then
    v_prefixed_code := v_input;
    v_raw_code := substr(v_input, 8);
  else
    v_prefixed_code := 'NEXORA-' || v_input;
    v_raw_code := v_input;
  end if;

  -- Find matching partner: checks referral_code, partner_code, with or without NEXORA- prefix
  select gp.user_id, upper(btrim(gp.referral_code))
    into v_partner, v_canonical_code
  from public.growth_partners gp
  where (
    upper(btrim(gp.referral_code)) = v_input
    or upper(btrim(gp.referral_code)) = v_prefixed_code
    or upper(btrim(gp.referral_code)) = v_raw_code
    or upper(btrim(coalesce(gp.partner_code, ''))) = v_input
    or upper(btrim(coalesce(gp.partner_code, ''))) = v_raw_code
  )
  and gp.is_active = true
  and gp.status in ('approved', 'applied', 'active')
  limit 1;

  if v_partner is null then
    return jsonb_build_object('valid', false);
  end if;

  -- Use partner canonical referral code if available, fallback to prefixed
  if v_canonical_code is null or v_canonical_code = '' then
    v_canonical_code := v_prefixed_code;
  end if;

  -- Generate 64-hex capability token
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.growth_referral_attributions (token_hash, partner_id, referral_code, expires_at)
  values (md5(v_token), v_partner, v_canonical_code, now() + interval '7 days');

  return jsonb_build_object(
    'valid', true,
    'token', v_token,
    'referral_code', v_canonical_code,
    'expires_at', now() + interval '7 days'
  );
end;
$$;

revoke all on function public.capture_growth_referral(text, text) from public;
grant execute on function public.capture_growth_referral(text, text) to anon, authenticated, service_role;

-- 6. Canonical get_my_referral_code function
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
  limit 1;
$$;

grant execute on function public.get_my_referral_code() to authenticated, service_role;

-- 7. Ensure prepare_growth_referral_signup is present and callable
create or replace function public.prepare_growth_referral_signup(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attribution public.growth_referral_attributions;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('valid', false, 'token', null);
  end if;

  select a.* into v_attribution
  from public.growth_referral_attributions a
  join public.growth_partners gp
    on gp.user_id = a.partner_id
   and gp.is_active = true
   and gp.status in ('approved', 'applied', 'active')
  where a.token_hash = md5(p_token)
    and a.expires_at > now()
    and a.consumed_at is null;

  if not found then
    return jsonb_build_object('valid', false, 'token', null);
  end if;

  return jsonb_build_object(
    'valid', true,
    'token', p_token,
    'referral_code', upper(btrim(v_attribution.referral_code)),
    'expires_at', v_attribution.expires_at
  );
end;
$$;

revoke all on function public.prepare_growth_referral_signup(text) from public;
grant execute on function public.prepare_growth_referral_signup(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
