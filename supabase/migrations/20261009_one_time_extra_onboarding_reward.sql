-- One-time Extra Onboarding Reward per newly qualifying shop.
-- This is NOT the Growth Partner's main or recurring commission.
-- First valid 15 consecutive days are locked:
-- minimum ₹15,000 QR -> ₹1,500 company commission -> ₹150 onboarding reward.
-- There is no upper cap: ₹50,000 QR -> ₹5,000 company -> ₹500 reward.

create table if not exists public.partner_shop_onboarding_rewards (
  id uuid primary key default gen_random_uuid(),
  growth_partner_id uuid not null references public.growth_partners(id) on delete cascade,
  shop_attribution_id uuid not null references public.shop_attributions(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  qualification_start_date date not null,
  qualification_end_date date not null,
  qualifying_days integer not null default 15 check (qualifying_days = 15),
  qualifying_qr_transaction_paise bigint not null check (qualifying_qr_transaction_paise >= 1500000),
  company_commission_paise bigint not null check (company_commission_paise >= 150000),
  onboarding_reward_rate_bps integer not null default 1000 check (onboarding_reward_rate_bps = 1000),
  onboarding_reward_paise bigint not null check (onboarding_reward_paise >= 15000),
  status text not null default 'earned' check (status in ('earned','approved','paid','held','revoked')),
  earned_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_attribution_id),
  check (qualification_end_date = qualification_start_date + 14),
  check (onboarding_reward_paise = floor(company_commission_paise * 0.10)::bigint)
);

comment on table public.partner_shop_onboarding_rewards is
  'One-time uncapped Extra Onboarding Reward for each newly qualifying shop; not recurring/main commission.';
comment on column public.partner_shop_onboarding_rewards.onboarding_reward_paise is
  '10% of company commission earned during the first valid 15-day consecutive qualification window.';

create index if not exists partner_shop_onboarding_rewards_partner_status_idx
  on public.partner_shop_onboarding_rewards(growth_partner_id,status,earned_at desc);

alter table public.partner_shop_onboarding_rewards enable row level security;
revoke all on table public.partner_shop_onboarding_rewards from public,anon,authenticated;
grant select,insert,update,delete on table public.partner_shop_onboarding_rewards to service_role;

create or replace function public.refresh_partner_shop_reward_qualification(p_shop_attribution_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_attr public.shop_attributions%rowtype;
 v_max_streak int:=0;
 v_verified boolean:=false;
 v_window_start date;
 v_window_qr bigint;
 v_window_company bigint;
 v_onboarding_reward bigint;
begin
 if not private.is_trusted_server_or_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into v_attr from public.shop_attributions where id=p_shop_attribution_id for update;
 if not found then raise exception 'Shop attribution not found' using errcode='P0002'; end if;

 insert into public.partner_shop_daily_qualification
 (shop_attribution_id,growth_partner_id,salon_id,business_date,qr_transaction_paise,company_commission_paise,
  growth_partner_commission_paise,settlement_confirmed,refund_or_reversal,daily_status,rejection_reason,calculated_at)
 select v_attr.id,v_attr.growth_partner_id,v_attr.salon_id,q.business_date,
   sum(q.eligible_amount_paise),
   floor(sum(q.eligible_amount_paise)*0.10)::bigint,
   0,
   bool_and(q.qualification_status='eligible'),
   bool_or(q.qualification_status='reversed' or q.reversed_at is not null),
   case when bool_or(q.qualification_status='reversed' or q.reversed_at is not null) then 'rejected'
        when bool_and(q.qualification_status='eligible') and sum(q.eligible_amount_paise)>=100000
             and floor(sum(q.eligible_amount_paise)*0.10)>=10000 then 'passed' else 'not_passed' end,
   case when bool_or(q.qualification_status='reversed' or q.reversed_at is not null) then 'refund_or_reversal'
        when sum(q.eligible_amount_paise)<100000 then 'daily_qr_below_1000'
        when floor(sum(q.eligible_amount_paise)*0.10)<10000 then 'daily_company_commission_below_100' else null end,now()
 from public.qualifying_transactions q
 where q.shop_attribution_id=v_attr.id
 group by q.business_date
 on conflict (shop_attribution_id,business_date) do update set
 qr_transaction_paise=excluded.qr_transaction_paise,
 company_commission_paise=excluded.company_commission_paise,
 growth_partner_commission_paise=0,
 settlement_confirmed=excluded.settlement_confirmed,refund_or_reversal=excluded.refund_or_reversal,
 daily_status=excluded.daily_status,rejection_reason=excluded.rejection_reason,calculated_at=now();

 select coalesce(max(streak),0) into v_max_streak from (
   select count(*)::int streak from (
     select business_date,business_date-(row_number() over(order by business_date))::int grp
     from public.partner_shop_daily_qualification
     where shop_attribution_id=v_attr.id and daily_status='passed' and settlement_confirmed and not refund_or_reversal
   ) d group by grp
 ) s;

 select (v_attr.status='active' and s.verified and s.is_active and s.deleted_at is null
   and (v_attr.onboarding_application_id is null or exists(
     select 1 from public.shop_onboarding_applications a
     where a.id=v_attr.onboarding_application_id and a.status in ('approved','published')
       and a.owner_phone_verified_at is not null and a.reviewed_at is not null
   ))) into v_verified from public.salons s where s.id=v_attr.salon_id;

 insert into public.partner_reward_shop_qualifications
 (growth_partner_id,shop_attribution_id,status,active_scan_count,qualified_at,reviewed_at,reason_code,source_event_id)
 values(v_attr.growth_partner_id,v_attr.id,
   case when v_verified and v_max_streak>=15 then 'qualified' else 'pending' end,
   v_max_streak,case when v_verified and v_max_streak>=15 then now() else null end,now(),
   case when not v_verified then 'shop_or_kyc_not_verified' when v_max_streak<15 then '15_day_cycle_running' else null end,
   'reward-refresh:'||v_attr.id::text)
 on conflict (growth_partner_id,shop_attribution_id) do update set
 status=excluded.status,active_scan_count=excluded.active_scan_count,
 qualified_at=coalesce(public.partner_reward_shop_qualifications.qualified_at,excluded.qualified_at),
 reviewed_at=now(),reason_code=excluded.reason_code,updated_at=now();

 if v_verified and v_max_streak>=15 then
   with passed as (
     select business_date,
       business_date-(row_number() over(order by business_date))::int as grp
     from public.partner_shop_daily_qualification
     where shop_attribution_id=v_attr.id
       and daily_status='passed' and settlement_confirmed and not refund_or_reversal
   ), first_window as (
     select min(business_date) as start_date
     from passed group by grp having count(*)>=15
     order by min(business_date) limit 1
   )
   select w.start_date,sum(d.qr_transaction_paise)::bigint,sum(d.company_commission_paise)::bigint
   into v_window_start,v_window_qr,v_window_company
   from first_window w
   join public.partner_shop_daily_qualification d
     on d.shop_attribution_id=v_attr.id
    and d.business_date between w.start_date and w.start_date+14
    and d.daily_status='passed' and d.settlement_confirmed and not d.refund_or_reversal
   group by w.start_date;

   if v_window_start is not null then
     v_onboarding_reward:=floor(v_window_company*0.10)::bigint;
     insert into public.partner_shop_onboarding_rewards
       (growth_partner_id,shop_attribution_id,salon_id,qualification_start_date,qualification_end_date,
        qualifying_qr_transaction_paise,company_commission_paise,onboarding_reward_paise,status,earned_at)
     values
       (v_attr.growth_partner_id,v_attr.id,v_attr.salon_id,v_window_start,v_window_start+14,
        v_window_qr,v_window_company,v_onboarding_reward,'earned',now())
     on conflict (shop_attribution_id) do nothing;
   end if;
 end if;

 return jsonb_build_object(
   'shop_attribution_id',v_attr.id,'consecutive_days',v_max_streak,
   'verified',v_verified,'qualified',v_verified and v_max_streak>=15,
   'extra_onboarding_reward_paise',v_onboarding_reward,
   'extra_onboarding_reward_one_time',true);
end $$;

create or replace function public.get_my_partner_onboarding_rewards(p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_gp_id uuid;
begin
 select id into v_gp_id from public.growth_partners
 where user_id=auth.uid() and is_active and status='approved';
 if v_gp_id is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;

 return jsonb_build_object(
  'currency','INR',
  'programme_type','one_time_extra_onboarding_reward_per_qualifying_shop',
  'is_main_commission',false,
  'is_recurring',false,
  'has_upper_cap',false,
  'company_commission_rate_bps',1000,
  'reward_share_of_company_bps',1000,
  'qualification_days',15,
  'minimums',jsonb_build_object(
    'daily_qr_transaction_paise',100000,
    'cycle_qr_transaction_paise',1500000,
    'cycle_company_commission_paise',150000,
    'cycle_onboarding_reward_paise',15000
  ),
  'totals',(select jsonb_build_object(
    'qualifying_shops',count(*),
    'qualifying_qr_transaction_paise',coalesce(sum(qualifying_qr_transaction_paise),0),
    'company_commission_paise',coalesce(sum(company_commission_paise),0),
    'onboarding_reward_paise',coalesce(sum(onboarding_reward_paise) filter(where status<>'revoked'),0),
    'paid_reward_paise',coalesce(sum(onboarding_reward_paise) filter(where status='paid'),0))
   from public.partner_shop_onboarding_rewards where growth_partner_id=v_gp_id),
  'rewards',(select coalesce(jsonb_agg(x.row_data order by x.earned_at desc),'[]'::jsonb) from (
    select r.earned_at,to_jsonb(r)-'growth_partner_id' ||
      jsonb_build_object('shop_name',s.name) as row_data
    from public.partner_shop_onboarding_rewards r
    join public.salons s on s.id=r.salon_id
    where r.growth_partner_id=v_gp_id
    order by r.earned_at desc
    limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
  ) x)
 );
end $$;

-- Keep the old RPC available for one release, but make its semantics explicit
-- and prevent the UI from treating daily rows as recurring partner income.
create or replace function public.get_my_partner_qr_commission(p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=''
as $$
 select public.get_my_partner_onboarding_rewards(p_limit,p_offset)
$$;

revoke all on function public.get_my_partner_onboarding_rewards(integer,integer) from public,anon;
grant execute on function public.get_my_partner_onboarding_rewards(integer,integer) to authenticated,service_role;
revoke all on function public.get_my_partner_qr_commission(integer,integer) from public,anon;
grant execute on function public.get_my_partner_qr_commission(integer,integer) to authenticated,service_role;
revoke all on function public.refresh_partner_shop_reward_qualification(uuid) from public,anon,authenticated;
grant execute on function public.refresh_partner_shop_reward_qualification(uuid) to service_role;

do $$
begin
 if floor(150000::numeric*0.10)<>15000 then raise exception 'Minimum onboarding reward contract failed'; end if;
 if floor(500000::numeric*0.10)<>50000 then raise exception 'Uncapped onboarding reward example failed'; end if;
end $$;