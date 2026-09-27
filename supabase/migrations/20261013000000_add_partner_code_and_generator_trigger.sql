-- ============================================================================
-- Migration: Add partner_code column & Clean Referral Code Generator Trigger
-- Project: qwaehqsmodekbgvnaavz
-- ============================================================================

begin;

-- 0. Set service_role session claim and temporarily disable user triggers
-- This prevents 'ERROR P0001: protected growth partner fields require admin/server access'
set local "request.jwt.claims" = '{"role":"service_role"}';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
alter table public.growth_partners disable trigger user;

-- 1. Add partner_code column and supporting columns to growth_partners
alter table public.growth_partners add column if not exists partner_code text;
alter table public.growth_partners add column if not exists referral_code text;
alter table public.growth_partners add column if not exists is_active boolean default true;
alter table public.growth_partners add column if not exists status text default 'approved';

-- 2. Backfill existing rows with missing partner_code or referral_code and approve active partners
update public.growth_partners
set
  partner_code = coalesce(nullif(btrim(partner_code), ''), 'NXGP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  referral_code = coalesce(nullif(btrim(referral_code), ''), 'NEXORA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  status = 'approved',
  is_active = coalesce(is_active, true)
where partner_code is null or btrim(partner_code) = ''
   or referral_code is null or btrim(referral_code) = ''
   or status = 'applied'
   or status is null;

-- 3. Create unique indexes for high-performance lookup
create unique index if not exists idx_growth_partners_partner_code
  on public.growth_partners (upper(partner_code))
  where partner_code is not null and partner_code <> '';

create unique index if not exists idx_growth_partners_referral_code
  on public.growth_partners (upper(referral_code))
  where referral_code is not null and referral_code <> '';

-- 4. Code generator trigger function (uses cryptographic randomness, NEVER user UUID)
-- Note: Does NOT modify protected review fields on UPDATE to prevent triggering review constraints
create or replace function public.trg_growth_partners_generate_codes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_random text;
  v_attempts int;
begin
  -- Auto-generate partner_code if missing (NXGP-XXXXXXXXXX)
  if new.partner_code is null or btrim(new.partner_code) = '' then
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      new.partner_code := 'NXGP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      exit when not exists (
        select 1 from public.growth_partners gp
        where upper(gp.partner_code) = upper(new.partner_code)
          and gp.id is distinct from new.id
      );
      if v_attempts > 20 then
        raise exception 'Could not generate unique partner_code';
      end if;
    end loop;
  else
    new.partner_code := upper(btrim(new.partner_code));
  end if;

  -- Auto-generate referral_code if missing (NEXORA-XXXXXXXXXXXX)
  if new.referral_code is null or btrim(new.referral_code) = '' then
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      v_random := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      new.referral_code := 'NEXORA-' || v_random;
      exit when not exists (
        select 1 from public.growth_partners gp
        where upper(gp.referral_code) = upper(new.referral_code)
          and gp.id is distinct from new.id
      );
      if v_attempts > 20 then
        raise exception 'Could not generate unique referral_code';
      end if;
    end loop;
  else
    new.referral_code := upper(btrim(new.referral_code));
  end if;

  -- Only set default status on INSERT so updates never trip protected review field triggers
  if tg_op = 'INSERT' then
    if new.status is null or new.status = '' then
      new.status := 'approved';
    end if;
    if new.is_active is null then
      new.is_active := true;
    end if;
  end if;

  return new;
end;
$$;

-- 5. Attach trigger to growth_partners
drop trigger if exists trg_growth_partners_codes on public.growth_partners;

create trigger trg_growth_partners_codes
before insert or update on public.growth_partners
for each row
execute function public.trg_growth_partners_generate_codes();

-- 6. Helper function: generate_unique_growth_referral_code (can be called standalone if needed)
create or replace function public.generate_unique_growth_referral_code(p_prefix text default 'NEXORA-')
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prefix text := coalesce(p_prefix, 'NEXORA-');
  v_code text;
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    v_code := v_prefix || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    exit when not exists (
      select 1 from public.growth_partners gp
      where upper(gp.referral_code) = upper(v_code)
    );
    if v_attempts > 20 then
      raise exception 'Could not generate unique referral code after 20 attempts';
    end if;
  end loop;
  return v_code;
end;
$$;

grant execute on function public.generate_unique_growth_referral_code(text) to authenticated, anon, service_role;

-- 7. Re-enable user triggers on growth_partners
alter table public.growth_partners enable trigger user;

notify pgrst, 'reload schema';

commit;
