-- Physical referral ledger, including pre-signup attribution.
-- Existing user_id-based workflow/RPC contracts are preserved. Writes flow
-- transactionally from the existing validated attribution/onboarding paths.
begin;

-- The deployed contract uses user_id as the partner PK. Introduce a separate,
-- stable internal ID for the requested FK without changing any legacy FK.
alter table public.growth_partners add column if not exists id uuid default gen_random_uuid();
alter table public.growth_partners alter column id set default gen_random_uuid();
update public.growth_partners set id=gen_random_uuid() where id is null;
alter table public.growth_partners alter column id set not null;
create unique index if not exists growth_partners_id_key on public.growth_partners(id);

create or replace function public.guard_growth_partner_record_id()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Partner record identity cannot be changed' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_growth_partner_record_id() from public, anon, authenticated;
drop trigger if exists trg_growth_partner_record_id on public.growth_partners;
create trigger trg_growth_partner_record_id before update of id on public.growth_partners
for each row execute function public.guard_growth_partner_record_id();

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.growth_partners(id) on delete cascade,
  referred_user_id uuid references auth.users(id) on delete cascade,
  referral_code text not null,
  status text not null default 'clicked',
  conversion_status text not null default 'not_converted',
  first_clicked_at timestamptz,
  registered_at timestamptz,
  converted_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_referrals_code_format check (referral_code ~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$'),
  constraint partner_referrals_status_valid check (status in ('clicked','registered','pending','active','converted','inactive','cancelled','rejected')),
  constraint partner_referrals_conversion_valid check (conversion_status in ('not_converted','converted')),
  constraint partner_referrals_conversion_consistent check (
    (conversion_status='converted') = (converted_at is not null)
    and (status <> 'converted' or conversion_status='converted')
  ),
  constraint partner_referrals_registration_consistent check (
    (referred_user_id is null and registered_at is null and conversion_status='not_converted'
      and status in ('clicked','inactive','cancelled','rejected'))
    or (referred_user_id is not null and registered_at is not null and status <> 'clicked')
  )
);

-- One successful attribution per account globally, not merely per partner and
-- not merely while converted/active. NULL allows distinct anonymous visitors.
create unique index if not exists partner_referrals_referred_user_key
  on public.partner_referrals(referred_user_id) where referred_user_id is not null;
-- A referral code is intentionally NOT unique here: many users share a code.
create index if not exists partner_referrals_partner_status_joined_idx
  on public.partner_referrals(partner_id,status,registered_at desc,id desc);
create index if not exists partner_referrals_partner_created_idx
  on public.partner_referrals(partner_id,created_at desc,id desc);
create index if not exists partner_referrals_partner_activity_idx
  on public.partner_referrals(partner_id,last_activity_at desc,id desc);

alter table public.partner_referrals enable row level security;
revoke all on public.partner_referrals from public, anon, authenticated;
grant select on public.partner_referrals to authenticated;
drop policy if exists partner_referrals_select_own on public.partner_referrals;
create policy partner_referrals_select_own on public.partner_referrals for select to authenticated
using (exists (
  select 1 from public.growth_partners gp
  where gp.id=partner_referrals.partner_id and gp.user_id=(select auth.uid()) and gp.is_active
));

create or replace function public.guard_partner_referral_identity()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id
       or (old.referred_user_id is not null and new.referred_user_id is distinct from old.referred_user_id) then
      raise exception 'Successful referral account identity cannot be changed' using errcode='42501';
    end if;
    if old.referred_user_id is not null
       and (new.partner_id,new.referral_code,new.registered_at) is distinct from
           (old.partner_id,old.referral_code,old.registered_at)
       and not coalesce(private.is_admin(),false) then
      raise exception 'Referral attribution is immutable; administrator action required' using errcode='42501';
    end if;
  end if;
  if new.referred_user_id is not null and exists (
    select 1 from public.growth_partners where id=new.partner_id and user_id=new.referred_user_id
  ) then
    raise exception 'You cannot refer yourself' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_partner_referral_identity() from public, anon, authenticated;
drop trigger if exists trg_partner_referral_identity on public.partner_referrals;
create trigger trg_partner_referral_identity before insert or update on public.partner_referrals
for each row execute function public.guard_partner_referral_identity();
drop trigger if exists trg_partner_referrals_updated_at on public.partner_referrals;
create trigger trg_partner_referrals_updated_at before update on public.partner_referrals
for each row execute function public.growth_touch_updated_at();

-- Single write-through adapter, not a second independent attribution service.
-- Each existing milestone/admin correction and this backfill use the same code.
create or replace function public.sync_partner_referral(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  insert into public.partner_referrals as pr
    (id,partner_id,referred_user_id,referral_code,status,conversion_status,
     first_clicked_at,registered_at,converted_at,last_activity_at,created_at,updated_at)
  select o.referral_id,gp.id,o.user_id,o.referral_code,
    public.growth_effective_referral_status(o.status,o.referral_status_override),
    case when o.status='template_completed' then 'converted' else 'not_converted' end,
    o.referral_clicked_at,u.created_at,o.template_completed_at,
    greatest(o.linked_at,o.template_started_at,o.template_completed_at),
    coalesce(o.referral_clicked_at,o.linked_at,o.created_at),o.updated_at
  from public.growth_onboarding o
  join public.growth_partners gp on gp.user_id=o.growth_partner_id
  join auth.users u on u.id=o.user_id
  where o.user_id=p_user_id and o.growth_partner_id is not null
  on conflict(id) do update set
    partner_id=excluded.partner_id,referred_user_id=excluded.referred_user_id,
    referral_code=excluded.referral_code,status=excluded.status,conversion_status=excluded.conversion_status,
    first_clicked_at=least(pr.first_clicked_at,excluded.first_clicked_at),
    registered_at=excluded.registered_at,converted_at=excluded.converted_at,
    last_activity_at=excluded.last_activity_at
  where (pr.partner_id,pr.referred_user_id,pr.referral_code,pr.status,pr.conversion_status,
         pr.first_clicked_at,pr.registered_at,pr.converted_at,pr.last_activity_at)
    is distinct from
        (excluded.partner_id,excluded.referred_user_id,excluded.referral_code,excluded.status,excluded.conversion_status,
         least(pr.first_clicked_at,excluded.first_clicked_at),excluded.registered_at,excluded.converted_at,excluded.last_activity_at);
end;
$$;
revoke all on function public.sync_partner_referral(uuid) from public, anon, authenticated;

create or replace function public.sync_onboarding_partner_referral()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op='DELETE' then
    delete from public.partner_referrals where id=old.referral_id and referred_user_id=old.user_id;
    return old;
  end if;
  if new.growth_partner_id is not null then
    perform public.sync_partner_referral(new.user_id);
  elsif tg_op='UPDATE' and old.growth_partner_id is not null then
    delete from public.partner_referrals where id=old.referral_id and referred_user_id=old.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_onboarding_partner_referral() from public, anon, authenticated;
drop trigger if exists trg_sync_partner_referral on public.growth_onboarding;
create trigger trg_sync_partner_referral after insert or update or delete on public.growth_onboarding
for each row execute function public.sync_onboarding_partner_referral();

create or replace function public.guard_onboarding_referral_record_id()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.growth_partner_id is not null and new.referral_id is distinct from old.referral_id then
    raise exception 'Referral record identity cannot be changed' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_onboarding_referral_record_id() from public, anon, authenticated;
drop trigger if exists trg_guard_onboarding_referral_record_id on public.growth_onboarding;
create trigger trg_guard_onboarding_referral_record_id before update of referral_id on public.growth_onboarding
for each row execute function public.guard_onboarding_referral_record_id();

-- Backfill successful attribution without rotating existing detail IDs or codes.
select public.sync_partner_referral(user_id) from public.growth_onboarding where growth_partner_id is not null;

-- One temporary capability promotes one ledger row. Consumed capabilities whose
-- account was already deleted remain historical, with no artificial signup row.
alter table public.growth_referral_attributions add column if not exists referral_id uuid;
update public.growth_referral_attributions a set referral_id=o.referral_id
from public.growth_onboarding o where a.consumed_by=o.user_id and a.referral_id is null and o.growth_partner_id is not null;
update public.growth_referral_attributions set referral_id=gen_random_uuid()
where referral_id is null and consumed_at is null;
insert into public.partner_referrals
  (id,partner_id,referral_code,status,first_clicked_at,last_activity_at,created_at,updated_at)
select a.referral_id,gp.id,a.referral_code,'clicked',a.created_at,a.created_at,a.created_at,a.created_at
from public.growth_referral_attributions a join public.growth_partners gp on gp.user_id=a.partner_id
where a.consumed_at is null and a.referral_id is not null
on conflict(id) do nothing;
create unique index if not exists growth_referral_attributions_referral_id_key
  on public.growth_referral_attributions(referral_id) where referral_id is not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.growth_referral_attributions'::regclass and conname='growth_attribution_referral_fk') then
    alter table public.growth_referral_attributions add constraint growth_attribution_referral_fk
      foreign key(referral_id) references public.partner_referrals(id) on delete set null;
  end if;
end $$;

create or replace function public.create_clicked_partner_referral()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_partner_id uuid;
begin
  select id into v_partner_id from public.growth_partners where user_id=new.partner_id;
  new.referral_id := coalesce(new.referral_id,gen_random_uuid());
  insert into public.partner_referrals(id,partner_id,referral_code,status,first_clicked_at,last_activity_at,created_at,updated_at)
  values(new.referral_id,v_partner_id,new.referral_code,'clicked',new.created_at,new.created_at,new.created_at,new.created_at);
  return new;
end;
$$;
revoke all on function public.create_clicked_partner_referral() from public, anon, authenticated;
drop trigger if exists trg_create_clicked_partner_referral on public.growth_referral_attributions;
create trigger trg_create_clicked_partner_referral before insert on public.growth_referral_attributions
for each row execute function public.create_clicked_partner_referral();

-- Promote the same clicked row when Auth creates the account, in one transaction.
create or replace function public.consume_signup_growth_referral()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_token text := new.raw_user_meta_data ->> 'growth_referral_token';
  v_attr public.growth_referral_attributions;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then return new; end if;
  select * into v_attr from public.growth_referral_attributions
  where token_hash = md5(v_token) and expires_at > now() and consumed_at is null for update;
  if not found or v_attr.partner_id = new.id then return new; end if;
  -- Reject stale tokens after a code rotation or partner deactivation. Never
  -- resolve an old code to a different partner, even if an admin reassigns it.
  perform 1 from public.growth_partners where user_id = v_attr.partner_id
    and referral_code = v_attr.referral_code and is_active for share;
  if not found then return new; end if;
  insert into public.growth_onboarding as o(user_id, growth_partner_id, referral_code, linked_at, status, referral_clicked_at, referral_id)
  values (new.id, v_attr.partner_id, v_attr.referral_code, now(), 'linked', v_attr.created_at, coalesce(v_attr.referral_id,gen_random_uuid()))
  on conflict (user_id) do update set
    growth_partner_id = excluded.growth_partner_id, referral_code = excluded.referral_code,
    linked_at = excluded.linked_at, referral_clicked_at = excluded.referral_clicked_at,
    referral_id = excluded.referral_id,
    status = case when o.status = 'not_started' then 'linked' else o.status end
  where o.growth_partner_id is null;
  update public.growth_referral_attributions set consumed_by = new.id, consumed_at = now()
  where token_hash = v_attr.token_hash;
  return new;
end;
$$;
revoke all on function public.consume_signup_growth_referral() from public, anon, authenticated;
comment on table public.partner_referrals is
'Physical referral ledger: partner_id references growth_partners.id (not its legacy user_id). Anonymous captures promote to one globally unique referred_user_id on signup. Written transactionally by the validated attribution/onboarding flows; use existing admin RPCs for corrections, not independent table edits.';
notify pgrst, 'reload schema';
commit;
