-- Growth Partner Premium Reward Programme
-- Rules: ₹1,000 daily QR, 10% company commission, 15 consecutive days,
-- milestone-plus-one claim unlock, non-cash rewards, Day 16-30 processing.
-- Additive and idempotent; preserves existing partner/payment data.

create table if not exists public.partner_shop_daily_qualification (
  shop_attribution_id uuid not null references public.shop_attributions(id) on delete cascade,
  growth_partner_id uuid not null references public.growth_partners(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete restrict,
  business_date date not null,
  qr_transaction_paise bigint not null default 0 check (qr_transaction_paise >= 0),
  company_commission_rate_bps integer not null default 1000 check (company_commission_rate_bps = 1000),
  company_commission_paise bigint not null default 0 check (company_commission_paise >= 0),
  settlement_confirmed boolean not null default false,
  refund_or_reversal boolean not null default false,
  daily_status text not null default 'not_passed' check (daily_status in ('passed','not_passed','rejected')),
  rejection_reason text,
  calculated_at timestamptz not null default now(),
  primary key (shop_attribution_id,business_date)
);
create index if not exists partner_shop_daily_partner_date_idx
  on public.partner_shop_daily_qualification(growth_partner_id,business_date desc);
alter table public.partner_shop_daily_qualification enable row level security;
revoke all on public.partner_shop_daily_qualification from public,anon,authenticated;

insert into public.partner_reward_milestones
(code,name,milestone_shop_count,claim_unlock_shop_count,maximum_value_paise,description,specifications,checklist,claim_options,sort_order,is_active)
values
('WELCOME_25','Professional Welcome Package',25,26,1750000,'Company-approved professional welcome package; non-cash reward.',
 '["Company ID Card","Branded Pen","Branded Diary","Branded Cap","Branded Bag","Branded T-Shirt","Visiting Cards","Achievement Certificate","Smartwatch or Earbuds"]',
 '["25 qualifying shops","26 verified shops","15-day qualification","Commission settled","KYC and fraud clearance"]','["Company-approved package"]',25,true),
('TABLET_50','Work Tablet Package',50,51,1750000,'Company-approved tablet package; specifications subject to catalogue and availability.',
 '["Tablet","Cover","Screen Guard","Power Bank","Limited-period SIM or data support"]',
 '["50 qualifying shops","51 verified shops","15-day qualification","Commission settled","KYC and fraud clearance"]','["Company-approved tablet package"]',50,true),
('LAPTOP_100','Laptop Reward',100,101,3500000,'Company-approved laptop; non-cash reward subject to catalogue and availability.',
 '["Laptop up to approved invoice value"]','["100 qualifying shops","101 verified shops","15-day qualification","Commission settled","KYC and fraud clearance"]','["Company-approved laptop"]',100,true),
('SCOOTER_250','Electric Scooter Purchase Contribution',250,251,10500000,'Maximum company contribution to an authorised dealer; no cash equivalent.',
 '["Maximum contribution ₹1,05,000","Authorised dealer purchase","Difference paid directly by partner"]',
 '["250 qualifying shops","251 verified shops","Documents and driving eligibility","KYC, tax and fraud clearance"]','["Company-approved electric scooter"]',250,true),
('IPHONE_500','Approved Latest iPhone',500,501,17500000,'Latest company-approved iPhone available within the approved budget on approval date.',
 '["Maximum approved invoice value ₹1,75,000","Authorised seller","Model, colour and storage subject to availability"]',
 '["500 qualifying shops","501 verified shops","KYC, tax and fraud clearance"]','["Approved iPhone catalogue option"]',500,true),
('ROYAL_ENFIELD_750','Royal Enfield Motorcycle Contribution',750,751,35000000,'Maximum company contribution to an authorised dealership; no cash equivalent.',
 '["Maximum contribution ₹3,50,000","Company-approved model","Difference paid directly by partner"]',
 '["750 qualifying shops","751 verified shops","Driving licence","KYC, tax and fraud clearance"]','["Company-approved Royal Enfield model"]',750,true),
('BREZZA_1000','Maruti Suzuki Brezza Purchase Contribution',1000,1001,55000000,'Maximum ₹5,50,000 company contribution through an authorised dealership; not a free car.',
 '["Maximum contribution ₹5,50,000","Authorised dealership","Variant and colour subject to availability","Difference paid directly by partner"]',
 '["1000 qualifying shops","1001 verified shops","Driving licence","KYC, tax and fraud clearance"]','["Brezza purchase contribution"]',1000,true)
on conflict (code) do update set
 name=excluded.name,milestone_shop_count=excluded.milestone_shop_count,
 claim_unlock_shop_count=excluded.claim_unlock_shop_count,maximum_value_paise=excluded.maximum_value_paise,
 description=excluded.description,specifications=excluded.specifications,checklist=excluded.checklist,
 claim_options=excluded.claim_options,sort_order=excluded.sort_order,is_active=true,updated_at=now();

create or replace function public.refresh_partner_shop_reward_qualification(p_shop_attribution_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_attr public.shop_attributions%rowtype; v_max_streak int:=0; v_verified boolean:=false;
begin
 if not private.is_trusted_server_or_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into v_attr from public.shop_attributions where id=p_shop_attribution_id for update;
 if not found then raise exception 'Shop attribution not found' using errcode='P0002'; end if;
 insert into public.partner_shop_daily_qualification
 (shop_attribution_id,growth_partner_id,salon_id,business_date,qr_transaction_paise,company_commission_paise,
 settlement_confirmed,refund_or_reversal,daily_status,rejection_reason,calculated_at)
 select v_attr.id,v_attr.growth_partner_id,v_attr.salon_id,q.business_date,sum(q.eligible_amount_paise),
 floor(sum(q.eligible_amount_paise)*0.10)::bigint,bool_and(q.qualification_status='eligible'),
 bool_or(q.qualification_status='reversed' or q.reversed_at is not null),
 case when bool_or(q.qualification_status='reversed' or q.reversed_at is not null) then 'rejected'
 when bool_and(q.qualification_status='eligible') and sum(q.eligible_amount_paise)>=100000
 and floor(sum(q.eligible_amount_paise)*0.10)>=10000 then 'passed' else 'not_passed' end,
 case when bool_or(q.qualification_status='reversed' or q.reversed_at is not null) then 'refund_or_reversal'
 when sum(q.eligible_amount_paise)<100000 then 'daily_qr_below_1000'
 when floor(sum(q.eligible_amount_paise)*0.10)<10000 then 'daily_commission_below_100' else null end,now()
 from public.qualifying_transactions q where q.shop_attribution_id=v_attr.id group by q.business_date
 on conflict (shop_attribution_id,business_date) do update set
 qr_transaction_paise=excluded.qr_transaction_paise,company_commission_paise=excluded.company_commission_paise,
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
  select 1 from public.shop_onboarding_applications a where a.id=v_attr.onboarding_application_id
  and a.status in ('approved','published') and a.owner_phone_verified_at is not null and a.reviewed_at is not null
 ))) into v_verified from public.salons s where s.id=v_attr.salon_id;
 insert into public.partner_reward_shop_qualifications
 (growth_partner_id,shop_attribution_id,status,active_scan_count,qualified_at,reviewed_at,reason_code,source_event_id)
 values(v_attr.growth_partner_id,v_attr.id,case when v_verified and v_max_streak>=15 then 'qualified' else 'pending' end,
 v_max_streak,case when v_verified and v_max_streak>=15 then now() else null end,now(),
 case when not v_verified then 'shop_or_kyc_not_verified' when v_max_streak<15 then '15_day_cycle_running' else null end,
 'reward-refresh:'||v_attr.id::text)
 on conflict (growth_partner_id,shop_attribution_id) do update set
 status=excluded.status,active_scan_count=excluded.active_scan_count,
 qualified_at=coalesce(public.partner_reward_shop_qualifications.qualified_at,excluded.qualified_at),
 reviewed_at=now(),reason_code=excluded.reason_code,updated_at=now();
 return jsonb_build_object('shop_attribution_id',v_attr.id,'consecutive_days',v_max_streak,
 'verified',v_verified,'qualified',v_verified and v_max_streak>=15);
end $$;
revoke all on function public.refresh_partner_shop_reward_qualification(uuid) from public,anon,authenticated;

create or replace function public.get_my_partner_reward_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_gp_id uuid; v_verified int; v_qualified int; v_running int; v_rejected int; v_current int; v_next int;
begin
 select id into v_gp_id from public.growth_partners where user_id=auth.uid() and is_active and status='approved';
 if v_gp_id is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 select count(*) filter(where sa.status='active' and s.verified and s.is_active and s.deleted_at is null),
 count(*) filter(where rq.status='qualified'),count(*) filter(where rq.status='pending' and rq.active_scan_count>0),
 count(*) filter(where rq.status='disqualified') into v_verified,v_qualified,v_running,v_rejected
 from public.shop_attributions sa join public.salons s on s.id=sa.salon_id
 left join public.partner_reward_shop_qualifications rq on rq.shop_attribution_id=sa.id and rq.growth_partner_id=v_gp_id
 where sa.growth_partner_id=v_gp_id;
 select coalesce(max(milestone_shop_count) filter(where milestone_shop_count<=v_qualified),0),
 min(milestone_shop_count) filter(where milestone_shop_count>v_qualified)
 into v_current,v_next from public.partner_reward_milestones where is_active;
 return jsonb_build_object('verified_shops',coalesce(v_verified,0),'qualifying_shops',coalesce(v_qualified,0),
 'cycles_running',coalesce(v_running,0),'rejected_shops',coalesce(v_rejected,0),'current_milestone',v_current,
 'next_milestone',v_next,'remaining_qualifying_shops',greatest(coalesce(v_next,v_current)-v_qualified,0),
 'rules',jsonb_build_object('daily_qr_paise',100000,'commission_rate_bps',1000,'daily_commission_paise',10000,
 'consecutive_days',15,'processing_day_from',16,'processing_day_to',30),
 'milestones',(select jsonb_agg(jsonb_build_object('id',m.id,'code',m.code,'name',m.name,
 'required_qualifying_shops',m.milestone_shop_count,'claim_unlock_verified_shops',m.claim_unlock_shop_count,
 'maximum_value_paise',m.maximum_value_paise,'eligible',(v_qualified>=m.milestone_shop_count and v_verified>=m.claim_unlock_shop_count),
 'plus_one_complete',(v_verified>=m.claim_unlock_shop_count),
 'claim',(select jsonb_build_object('id',c.id,'claim_number',c.claim_number,'status',c.status,'reason',c.status_reason,
 'created_at',c.created_at) from public.partner_reward_claims c where c.growth_partner_id=v_gp_id and c.milestone_id=m.id))
 order by m.sort_order) from public.partner_reward_milestones m where m.is_active));
end $$;
revoke all on function public.get_my_partner_reward_dashboard() from public,anon;
grant execute on function public.get_my_partner_reward_dashboard() to authenticated,service_role;

create or replace function public.get_my_partner_qr_commission(p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_gp_id uuid;
begin
 select id into v_gp_id from public.growth_partners where user_id=auth.uid() and is_active and status='approved';
 if v_gp_id is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 return jsonb_build_object('currency','INR','rate_bps',1000,
 'totals',(select jsonb_build_object('qr_transaction_paise',coalesce(sum(qr_transaction_paise),0),
 'company_commission_paise',coalesce(sum(company_commission_paise),0),
 'passed_days',count(*) filter(where daily_status='passed'),'rejected_days',count(*) filter(where daily_status='rejected'))
 from public.partner_shop_daily_qualification where growth_partner_id=v_gp_id),
 'days',(select coalesce(jsonb_agg(x.row_data order by x.business_date desc),'[]'::jsonb) from (
  select d.business_date,to_jsonb(d)-'growth_partner_id' row_data from public.partner_shop_daily_qualification d
  where d.growth_partner_id=v_gp_id order by d.business_date desc
  limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)) x));
end $$;
revoke all on function public.get_my_partner_qr_commission(integer,integer) from public,anon;
grant execute on function public.get_my_partner_qr_commission(integer,integer) to authenticated,service_role;

comment on function public.get_my_partner_reward_dashboard() is
'Partner reward progress: ₹1000 daily QR, 10% company commission, 15 consecutive days and milestone-plus-one.';
comment on function public.get_my_partner_qr_commission(integer,integer) is
'Partner-scoped company QR commission ledger; not a partner cash-income promise.';
