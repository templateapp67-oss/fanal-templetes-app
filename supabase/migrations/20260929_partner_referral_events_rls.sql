-- First-occurrence funnel events and database-enforced partner isolation.
begin;

create table if not exists public.partner_referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.partner_referrals(id) on delete cascade,
  event_type text not null,
  event_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint partner_referral_event_type_valid check (event_type in (
    'link_clicked','signup_started','signup_completed','account_activated',
    'business_created','subscription_started','converted'
  )),
  -- These rows can be read by a partner: arbitrary Auth/payment/admin payloads
  -- must never be copied into metadata. Extend this allowlist deliberately.
  constraint partner_referral_event_metadata_safe check (
    jsonb_typeof(event_metadata)='object'
    and event_metadata - array['source','backfilled'] = '{}'::jsonb
    and (not (event_metadata ? 'source') or (
      jsonb_typeof(event_metadata->'source')='string'
      and event_metadata->>'source' in ('attribution','signup','onboarding','business','subscription','migration')
    ))
    and (not (event_metadata ? 'backfilled') or jsonb_typeof(event_metadata->'backfilled')='boolean')
  ),
  constraint partner_referral_event_time_valid check (isfinite(created_at))
);
-- A funnel milestone is first-occurrence, not a counter of refreshes/retries.
create unique index if not exists partner_referral_events_milestone_key
  on public.partner_referral_events(referral_id,event_type);
create index if not exists partner_referral_events_timeline_idx
  on public.partner_referral_events(referral_id,created_at,id);
create index if not exists partner_referral_events_analytics_idx
  on public.partner_referral_events(event_type,created_at);

-- Idempotent trusted-server recorder; browser roles cannot forge milestones.
create or replace function public.record_partner_referral_event(
  p_referral_id uuid, p_event_type text,
  p_event_metadata jsonb default '{}'::jsonb, p_created_at timestamptz default now()
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_id uuid;
begin
  if p_event_type in ('signup_completed','account_activated','business_created','subscription_started','converted')
     and not exists(select 1 from public.partner_referrals where id=p_referral_id and referred_user_id is not null) then
    raise exception 'Registered referral required for this event' using errcode='22023';
  end if;
  insert into public.partner_referral_events(referral_id,event_type,event_metadata,created_at)
    values(p_referral_id,p_event_type,coalesce(p_event_metadata,'{}'::jsonb),coalesce(p_created_at,now()))
    on conflict(referral_id,event_type) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.partner_referral_events
    where referral_id=p_referral_id and event_type=p_event_type;
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_partner_referral_event(uuid,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.record_partner_referral_event(uuid,text,jsonb,timestamptz) to service_role;

create or replace function public.guard_partner_referral_event_update()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  raise exception 'Referral events are append-only' using errcode='42501';
end;
$$;
revoke all on function public.guard_partner_referral_event_update() from public, anon, authenticated;
drop trigger if exists trg_partner_referral_events_append_only on public.partner_referral_events;
create trigger trg_partner_referral_events_append_only before update on public.partner_referral_events
for each row execute function public.guard_partner_referral_event_update();

create or replace function public.record_partner_referral_milestones()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_started timestamptz;
begin
  if new.first_clicked_at is not null then
    perform public.record_partner_referral_event(new.id,'link_clicked','{"source":"attribution"}',new.first_clicked_at);
  end if;
  if new.registered_at is not null then
    perform public.record_partner_referral_event(new.id,'signup_completed','{"source":"signup"}',new.registered_at);
  end if;
  select template_started_at into v_started from public.growth_onboarding where referral_id=new.id;
  if v_started is not null then
    perform public.record_partner_referral_event(new.id,'account_activated','{"source":"onboarding"}',v_started);
  end if;
  if new.converted_at is not null then
    perform public.record_partner_referral_event(new.id,'converted','{"source":"onboarding"}',new.converted_at);
  end if;
  return new;
end;
$$;
revoke all on function public.record_partner_referral_milestones() from public, anon, authenticated;
drop trigger if exists trg_partner_referral_milestones on public.partner_referrals;
create trigger trg_partner_referral_milestones after insert or update on public.partner_referrals
for each row execute function public.record_partner_referral_milestones();

-- A historical activation can be added while an admin disposition keeps the
-- effective ledger status/last-activity unchanged. Capture that source change
-- too; this trigger sorts after the existing ledger synchronization trigger.
create or replace function public.record_onboarding_referral_activation()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.growth_partner_id is not null and new.template_started_at is not null then
    perform public.record_partner_referral_event(new.referral_id,'account_activated','{"source":"onboarding"}',new.template_started_at);
  end if;
  return new;
end;
$$;
revoke all on function public.record_onboarding_referral_activation() from public, anon, authenticated;
drop trigger if exists trg_zz_partner_referral_activation on public.growth_onboarding;
create trigger trg_zz_partner_referral_activation after insert or update of template_started_at on public.growth_onboarding
for each row execute function public.record_onboarding_referral_activation();

-- Backfill only known times. In particular, do not fabricate signup_started,
-- business_created or subscription_started from website/signup completion.
select public.record_partner_referral_event(pr.id,e.event_type,'{"source":"migration","backfilled":true}',e.event_at)
from public.partner_referrals pr
left join public.growth_onboarding o on o.referral_id=pr.id
cross join lateral (values
  ('link_clicked',pr.first_clicked_at), ('signup_completed',pr.registered_at),
  ('account_activated',o.template_started_at), ('converted',pr.converted_at)
) e(event_type,event_at)
where e.event_at is not null;

-- Used only when the signup form prepares its validated cookie capability.
-- Token ownership/expiry/code checks are server-side; no referral/partner ID
-- or arbitrary event metadata is accepted from the browser.
create or replace function public.prepare_growth_referral_signup(p_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_attr public.growth_referral_attributions;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('valid',false); end if;
  select * into v_attr from public.growth_referral_attributions
  where token_hash=md5(p_token) and consumed_at is null and expires_at>now() for update;
  if not found or v_attr.referral_id is null then return jsonb_build_object('valid',false); end if;
  perform 1 from public.growth_partners where user_id=v_attr.partner_id
    and referral_code=v_attr.referral_code and is_active for share;
  if not found then return jsonb_build_object('valid',false); end if;
  perform public.record_partner_referral_event(v_attr.referral_id,'signup_started','{"source":"signup"}',now());
  return jsonb_build_object('valid',true,'token',p_token,'referral_code',v_attr.referral_code,'expires_at',v_attr.expires_at);
end;
$$;
revoke all on function public.prepare_growth_referral_signup(text) from public;
grant execute on function public.prepare_growth_referral_signup(text) to anon, authenticated, service_role;

-- Reset known grants/policies. Restrictive fences additionally prevent a
-- stray permissive USING(true) policy from widening authenticated visibility.
alter table public.growth_partners enable row level security;
alter table public.partner_referrals enable row level security;
alter table public.partner_referral_events enable row level security;
alter table public.growth_onboarding enable row level security;
revoke all on public.growth_partners, public.partner_referrals, public.partner_referral_events, public.growth_onboarding from public, anon, authenticated;
grant select on public.growth_partners, public.partner_referrals, public.partner_referral_events, public.growth_onboarding to authenticated;

drop policy if exists growth_partners_select_own on public.growth_partners;
create policy growth_partners_select_own on public.growth_partners for select to authenticated
using(user_id=(select auth.uid()));
drop policy if exists growth_partners_owner_fence on public.growth_partners;
create policy growth_partners_owner_fence on public.growth_partners as restrictive for select to authenticated
using(user_id=(select auth.uid()));

drop policy if exists partner_referrals_select_own on public.partner_referrals;
create policy partner_referrals_select_own on public.partner_referrals for select to authenticated
using(exists(select 1 from public.growth_partners gp
  where gp.id=partner_referrals.partner_id and gp.user_id=(select auth.uid()) and gp.is_active));
drop policy if exists partner_referrals_owner_fence on public.partner_referrals;
create policy partner_referrals_owner_fence on public.partner_referrals as restrictive for select to authenticated
using(exists(select 1 from public.growth_partners gp
  where gp.id=partner_referrals.partner_id and gp.user_id=(select auth.uid()) and gp.is_active));

drop policy if exists partner_referral_events_select_own on public.partner_referral_events;
create policy partner_referral_events_select_own on public.partner_referral_events for select to authenticated
using(exists(select 1 from public.partner_referrals pr join public.growth_partners gp on gp.id=pr.partner_id
  where pr.id=partner_referral_events.referral_id and gp.user_id=(select auth.uid()) and gp.is_active));
drop policy if exists partner_referral_events_owner_fence on public.partner_referral_events;
create policy partner_referral_events_owner_fence on public.partner_referral_events as restrictive for select to authenticated
using(exists(select 1 from public.partner_referrals pr join public.growth_partners gp on gp.id=pr.partner_id
  where pr.id=partner_referral_events.referral_id and gp.user_id=(select auth.uid()) and gp.is_active));

-- Preserve the normal user's personal onboarding read, while requiring an
-- owned ACTIVE partner record for every partner-side legacy referral read.
drop policy if exists growth_onboarding_select_own_or_partner on public.growth_onboarding;
create policy growth_onboarding_select_own_or_partner on public.growth_onboarding for select to authenticated
using(user_id=(select auth.uid()) or exists(select 1 from public.growth_partners gp
  where gp.user_id=growth_onboarding.growth_partner_id and gp.user_id=(select auth.uid()) and gp.is_active));
drop policy if exists growth_onboarding_owner_fence on public.growth_onboarding;
create policy growth_onboarding_owner_fence on public.growth_onboarding as restrictive for select to authenticated
using(user_id=(select auth.uid()) or exists(select 1 from public.growth_partners gp
  where gp.user_id=growth_onboarding.growth_partner_id and gp.user_id=(select auth.uid()) and gp.is_active));

-- Even accidentally restored column/table write grants + broad policies must
-- not turn frontend clients into ledger/role editors. Trusted definer workflows
-- still execute as their owner; no FORCE RLS that would break those workflows.
do $$ declare t text;
begin
  foreach t in array array['growth_partners','partner_referrals','partner_referral_events','growth_onboarding'] loop
    execute format('drop policy if exists partner_anonymous_fence on public.%I',t);
    execute format('create policy partner_anonymous_fence on public.%I as restrictive for all to anon using(false) with check(false)',t);
    execute format('drop policy if exists partner_client_insert_fence on public.%I',t);
    execute format('create policy partner_client_insert_fence on public.%I as restrictive for insert to authenticated with check(false)',t);
    execute format('drop policy if exists partner_client_update_fence on public.%I',t);
    execute format('create policy partner_client_update_fence on public.%I as restrictive for update to authenticated using(false) with check(false)',t);
    execute format('drop policy if exists partner_client_delete_fence on public.%I',t);
    execute format('create policy partner_client_delete_fence on public.%I as restrictive for delete to authenticated using(false)',t);
  end loop;
end $$;
comment on table public.partner_referral_events is
'First-occurrence referral milestones, append-only through trusted server/DB workflows. Safe metadata only. Partner SELECT resolves event -> referral -> owned active growth_partners record; no client write/recorder grants. Business/subscription events require an authoritative server integration.';
notify pgrst, 'reload schema';
commit;
