-- ============================================================================
-- Migration: Add partner_code Column with 'NEX-XXXXXX' Code Generator & Trigger
-- Project: qwaehqsmodekbgvnaavz
-- ============================================================================

begin;

-- 1. Ensure partner_code and supporting columns exist on public.growth_partners
alter table public.growth_partners add column if not exists partner_code text;
alter table public.growth_partners add column if not exists referral_code text;
alter table public.growth_partners add column if not exists is_active boolean default true;
alter table public.growth_partners add column if not exists status text default 'approved';

-- 2. Custom Function: generate unique 'NEX-XXXXXX' code without using user UUID
create or replace function public.generate_unique_partner_code(p_prefix text default 'NEX-')
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prefix text := coalesce(p_prefix, 'NEX-');
  v_code text;
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    -- 6 cryptographically random uppercase alphanumeric characters (never user UUID)
    v_code := v_prefix || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

    -- Collision check against existing partner codes
    exit when not exists (
      select 1 from public.growth_partners gp
      where upper(gp.partner_code) = upper(v_code)
    );

    -- Safety expansion if collision density is unusually high
    if v_attempts > 30 then
      v_code := v_prefix || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (
        select 1 from public.growth_partners gp
        where upper(gp.partner_code) = upper(v_code)
      );
    end if;

    if v_attempts > 50 then
      raise exception 'Could not generate unique partner code after 50 attempts';
    end if;
  end loop;

  return v_code;
end;
$$;

grant execute on function public.generate_unique_partner_code(text) to authenticated, anon, service_role;

-- 4. Custom Trigger Function: automatically assigns 'NEX-XXXXXX' if partner_code is empty
create or replace function public.trg_growth_partners_assign_partner_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Auto-generate partner_code if missing
  if new.partner_code is null or btrim(new.partner_code) = '' then
    new.partner_code := public.generate_unique_partner_code('NEX-');
  else
    new.partner_code := upper(btrim(new.partner_code));
  end if;

  -- Auto-generate referral_code if missing
  if new.referral_code is null or btrim(new.referral_code) = '' then
    new.referral_code := 'NEXORA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  else
    new.referral_code := upper(btrim(new.referral_code));
  end if;

  -- Default status & active flags only on INSERT (never mutates status on UPDATE)
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

-- 5. Attach trigger to public.growth_partners
drop trigger if exists trg_growth_partners_partner_code on public.growth_partners;

create trigger trg_growth_partners_partner_code
before insert or update on public.growth_partners
for each row
execute function public.trg_growth_partners_assign_partner_code();

-- 6. Backfill existing records missing a partner_code
update public.growth_partners
set partner_code = public.generate_unique_partner_code('NEX-')
where partner_code is null or btrim(partner_code) = '';

-- 7. High-performance unique index on partner_code
create unique index if not exists idx_growth_partners_partner_code_nex
  on public.growth_partners (upper(partner_code))
  where partner_code is not null and partner_code <> '';

-- 8. Re-enable user triggers
alter table public.growth_partners enable trigger user;

notify pgrst, 'reload schema';

commit;
