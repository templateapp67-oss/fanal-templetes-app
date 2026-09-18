-- Phase 1: Growth Partner portal operational model.
-- All browser-facing reads are scoped to the caller's own active partner row.
-- Financial state and payout status are server/admin controlled; clients cannot
-- write ledger rows or approve their own payout.
begin;

create table if not exists public.partner_earnings (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.growth_partners(id) on delete restrict,
  referral_id uuid references public.partner_referrals(id) on delete set null,
  source_event_id uuid references public.partner_referral_events(id) on delete set null,
  source_key text not null,
  earning_type text not null check (earning_type in ('recurring_subscription_commission','onboarding_reward','tier_bonus','manual_adjustment')),
  commission_bps integer not null default 1500 check (commission_bps = 1500),
  payment_cleared_at timestamptz,
  status text not null default 'pending' check (status in ('pending','available_for_withdrawal','held','paid','reversed')),
  amount_paise bigint not null check (amount_paise <> 0),
  earned_at timestamptz not null default now(),
  available_at timestamptz,
  paid_at timestamptz,
  reversal_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, source_key),
  check ((status = 'paid') = (paid_at is not null)),
  check ((status <> 'available_for_withdrawal') or (payment_cleared_at is not null and available_at >= payment_cleared_at + interval '7 days'))
);
create index if not exists partner_earnings_partner_status_available_idx on public.partner_earnings(partner_id, status, available_at desc, id desc);
create index if not exists partner_earnings_partner_earned_idx on public.partner_earnings(partner_id, earned_at desc, id desc);

create table if not exists public.partner_payout_requests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.growth_partners(id) on delete restrict,
  amount_paise bigint not null check (amount_paise >= 50000),
  payout_method text not null check (payout_method in ('upi','bank_transfer','paypal')),
  destination_label text not null check (length(destination_label) between 2 and 120),
  status text not null default 'pending' check (status in ('pending','in_review','paid','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  rejection_reason text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null))
);
create unique index if not exists partner_payout_requests_one_open_per_partner on public.partner_payout_requests(partner_id) where status in ('pending','in_review');
create index if not exists partner_payout_requests_partner_requested_idx on public.partner_payout_requests(partner_id, requested_at desc, id desc);

create table if not exists public.partner_level_definitions (
  code text primary key check (code in ('bronze','silver','gold','platinum')),
  sort_order smallint not null unique check (sort_order > 0),
  minimum_paid_referrals integer not null check (minimum_paid_referrals >= 0),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  perks jsonb not null default '[]'::jsonb check (jsonb_typeof(perks) = 'array'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.partner_level_definitions(code,sort_order,minimum_paid_referrals,commission_bps,perks) values
 ('bronze',1,0,1000,'["0–5 active referrals","Partner resources"]'),('silver',2,6,1500,'["6–20 active referrals","Priority support"]'),
 ('gold',3,21,2000,'["21–49 active referrals","Priority support","Campaign reviews"]'),('platinum',4,50,2500,'["50+ active referrals","Dedicated partner manager"]')
on conflict (code) do nothing;

create table if not exists public.partner_notifications (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.growth_partners(id) on delete cascade,
  notification_type text not null check (notification_type in ('system','payout','referral','reward')),
  title text not null check (length(title) between 1 and 160), body text not null check (length(body) between 1 and 2000),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  is_read boolean not null default false, read_at timestamptz, created_at timestamptz not null default now(),
  check ((is_read and read_at is not null) or (not is_read and read_at is null))
);
create index if not exists partner_notifications_unread_idx on public.partner_notifications(partner_id, created_at desc) where not is_read;

create table if not exists public.partner_notification_preferences (
  partner_id uuid primary key references public.growth_partners(id) on delete cascade,
  email_enabled boolean not null default true, in_app_enabled boolean not null default true, updated_at timestamptz not null default now()
);

create table if not exists public.partner_marketing_assets (
  id uuid primary key default gen_random_uuid(), category text not null check (category in ('banner','email_template','social_graphic','video_demo')),
  title text not null, description text, storage_bucket text not null default 'partner-marketing-assets', storage_path text not null unique,
  mime_type text not null, file_size_bytes bigint check (file_size_bytes >= 0), is_published boolean not null default false,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((is_published and published_at is not null) or (not is_published))
);
create index if not exists partner_marketing_assets_published_idx on public.partner_marketing_assets(category, published_at desc) where is_published;

create table if not exists public.partner_support_tickets (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.growth_partners(id) on delete restrict,
  ticket_number bigint generated always as identity unique, subject text not null check (length(subject) between 3 and 180),
  message text not null check (length(message) between 10 and 5000), status text not null default 'open' check (status in ('open','in_progress','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','high')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create index if not exists partner_support_tickets_partner_idx on public.partner_support_tickets(partner_id, created_at desc, id desc);
create table if not exists public.partner_support_attachments (
  id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.partner_support_tickets(id) on delete cascade,
  partner_id uuid not null references public.growth_partners(id) on delete cascade, storage_bucket text not null default 'partner-support',
  storage_path text not null unique, original_filename text not null, mime_type text not null, size_bytes bigint not null check (size_bytes between 1 and 10485760), created_at timestamptz not null default now()
);
create index if not exists partner_support_attachments_ticket_idx on public.partner_support_attachments(ticket_id);

create or replace function public.notify_partner_ticket_status_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status then
   insert into public.partner_notifications(partner_id,notification_type,title,body,data)
   values(new.partner_id,'system','Support ticket updated',format('Ticket #%s is now %s.',new.ticket_number,replace(new.status,'_',' ')),jsonb_build_object('ticket_id',new.id,'status',new.status));
 end if;
 return new;
end $$;
revoke all on function public.notify_partner_ticket_status_change() from public, anon, authenticated;
drop trigger if exists trg_partner_ticket_status_notification on public.partner_support_tickets;
create trigger trg_partner_ticket_status_notification after update of status on public.partner_support_tickets for each row execute function public.notify_partner_ticket_status_change();

-- RLS: clients can only select their own operational data. Writes use RPCs or
-- privileged service routes; a restrictive policy prevents accidental broad grants.
do $$ declare t text; begin
 foreach t in array array['partner_earnings','partner_payout_requests','partner_notifications','partner_notification_preferences','partner_support_tickets','partner_support_attachments'] loop
   execute format('alter table public.%I enable row level security', t);
   execute format('revoke all on public.%I from public, anon, authenticated', t);
   execute format('grant select on public.%I to authenticated', t);
 end loop;
end $$;
alter table public.partner_marketing_assets enable row level security;
revoke all on public.partner_marketing_assets from public, anon, authenticated;
grant select on public.partner_marketing_assets to authenticated;
alter table public.partner_level_definitions enable row level security;
revoke all on public.partner_level_definitions from public, anon, authenticated;
grant select on public.partner_level_definitions to authenticated;

create or replace function public.my_active_partner_id() returns uuid language sql stable security definer set search_path='' as $$
 select gp.id from public.growth_partners gp where gp.user_id=(select auth.uid()) and gp.is_active and gp.status='approved'
$$;
revoke all on function public.my_active_partner_id() from public, anon;
grant execute on function public.my_active_partner_id() to authenticated, service_role;

create policy partner_earnings_select_own on public.partner_earnings for select to authenticated using (partner_id = public.my_active_partner_id());
create policy partner_payout_select_own on public.partner_payout_requests for select to authenticated using (partner_id = public.my_active_partner_id());
create policy partner_notifications_select_own on public.partner_notifications for select to authenticated using (partner_id = public.my_active_partner_id());
create policy partner_preferences_select_own on public.partner_notification_preferences for select to authenticated using (partner_id = public.my_active_partner_id());
create policy partner_tickets_select_own on public.partner_support_tickets for select to authenticated using (partner_id = public.my_active_partner_id());
create policy partner_attachments_select_own on public.partner_support_attachments for select to authenticated using (partner_id = public.my_active_partner_id());
create policy partner_levels_select_active on public.partner_level_definitions for select to authenticated using (is_active);
create policy partner_assets_select_published on public.partner_marketing_assets for select to authenticated using (is_published);

-- Private support uploads are organised as <partner-record-id>/<uuid>/<file>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('partner-support','partner-support',false,10485760,array['image/png','image/jpeg','application/pdf','text/plain'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists partner_support_objects_select_own on storage.objects;
create policy partner_support_objects_select_own on storage.objects for select to authenticated using (bucket_id='partner-support' and (storage.foldername(name))[1]=public.my_active_partner_id()::text);
drop policy if exists partner_support_objects_insert_own on storage.objects;
create policy partner_support_objects_insert_own on storage.objects for insert to authenticated with check (bucket_id='partner-support' and (storage.foldername(name))[1]=public.my_active_partner_id()::text);
drop policy if exists partner_support_objects_delete_own on storage.objects;
create policy partner_support_objects_delete_own on storage.objects for delete to authenticated using (bucket_id='partner-support' and (storage.foldername(name))[1]=public.my_active_partner_id()::text);

-- RPC contracts consumed by the next UI wiring phase.
create or replace function public.get_my_partner_earnings(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_partner uuid := public.my_active_partner_id(); begin
 if v_partner is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 return jsonb_build_object('currency','INR','totals',(select jsonb_build_object(
  'lifetime_paise',coalesce(sum(amount_paise) filter(where status not in ('reversed')),0),
  'pending_paise',coalesce(sum(amount_paise) filter(where status='pending'),0),
  'available_paise',coalesce(sum(amount_paise) filter(where status='available_for_withdrawal'),0)) from public.partner_earnings where partner_id=v_partner),
  'transactions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select id,earning_type,commission_bps,status,amount_paise,earned_at,payment_cleared_at,available_at,paid_at from public.partner_earnings where partner_id=v_partner order by earned_at desc,id desc limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)) x));
end $$;

-- Called by the authoritative subscription-payment worker after a payment
-- clears. The 15% rate is frozen on each ledger row for auditability.
create or replace function public.record_partner_subscription_commission(p_referral_id uuid,p_payment_reference text,p_paid_amount_paise bigint,p_payment_cleared_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_partner uuid; v_earning uuid; begin
 if p_paid_amount_paise <= 0 or length(trim(coalesce(p_payment_reference,'')))=0 or p_payment_cleared_at is null then raise exception 'Invalid cleared subscription payment' using errcode='22023'; end if;
 select partner_id into v_partner from public.partner_referrals where id=p_referral_id and status='active' for share;
 if v_partner is null then raise exception 'Active partner referral required' using errcode='22023'; end if;
 insert into public.partner_earnings(partner_id,referral_id,source_key,earning_type,commission_bps,status,amount_paise,earned_at,payment_cleared_at,available_at)
 values(v_partner,p_referral_id,'subscription:'||trim(p_payment_reference),'recurring_subscription_commission',1500,'pending',floor(p_paid_amount_paise * 0.15)::bigint,p_payment_cleared_at,p_payment_cleared_at,null)
 on conflict(partner_id,source_key) do update set source_key=excluded.source_key returning id into v_earning;
 return v_earning;
end $$;

create or replace function public.release_partner_earnings(p_as_of timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$ declare n integer; begin
 if not private.is_trusted_server_or_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.partner_earnings set status='available_for_withdrawal',available_at=payment_cleared_at + interval '7 days',updated_at=now()
 where status='pending' and payment_cleared_at is not null and payment_cleared_at + interval '7 days' <= p_as_of;
 get diagnostics n=row_count; return n;
end $$;

create or replace function public.admin_mark_partner_payout_paid(p_payout_id uuid,p_transaction_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$ declare v public.partner_payout_requests%rowtype; begin
 if not private.is_trusted_server_or_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 if length(trim(coalesce(p_transaction_reference,'')))<3 then raise exception 'Transaction reference is required' using errcode='22023'; end if;
 update public.partner_payout_requests set status='paid',paid_at=now(),reviewed_at=coalesce(reviewed_at,now()),provider_reference=trim(p_transaction_reference),updated_at=now()
 where id=p_payout_id and status in ('pending','in_review') returning * into v;
 if not found then raise exception 'Pending payout request not found' using errcode='P0002'; end if;
 insert into public.partner_notifications(partner_id,notification_type,title,body,data) values(v.partner_id,'payout','Payout completed',format('Your payout of ₹%s has been paid.',(v.amount_paise/100)::text),jsonb_build_object('payout_id',v.id,'transaction_reference',v.provider_reference));
 return jsonb_build_object('id',v.id,'status',v.status,'paid_at',v.paid_at,'transaction_reference',v.provider_reference);
end $$;

create or replace function public.request_my_partner_payout(p_amount_paise bigint, p_method text, p_destination_label text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_partner uuid := public.my_active_partner_id(); v_available bigint; v_id uuid; begin
 if v_partner is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 if p_amount_paise < 50000 then raise exception 'Minimum withdrawal is ₹500' using errcode='22023'; end if;
 if p_method not in ('upi','bank_transfer','paypal') or length(trim(coalesce(p_destination_label,''))) < 2 then raise exception 'Invalid payout destination' using errcode='22023'; end if;
 select coalesce(sum(amount_paise) filter(where status='available_for_withdrawal'),0) - coalesce((select sum(amount_paise) from public.partner_payout_requests where partner_id=v_partner and status in ('pending','in_review')),0) into v_available from public.partner_earnings where partner_id=v_partner;
 if p_amount_paise > v_available then raise exception 'Withdrawal exceeds available balance' using errcode='22023'; end if;
 insert into public.partner_payout_requests(partner_id,amount_paise,payout_method,destination_label) values(v_partner,p_amount_paise,p_method,trim(p_destination_label)) returning id into v_id;
 return jsonb_build_object('id',v_id,'status','pending','amount_paise',p_amount_paise);
end $$;

create or replace function public.get_my_partner_notifications(p_type text default null, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unread_count',(select count(*) from public.partner_notifications where partner_id=public.my_active_partner_id() and not is_read),'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,notification_type,title,body,data,is_read,read_at,created_at from public.partner_notifications where partner_id=public.my_active_partner_id() and (p_type is null or notification_type=p_type) order by created_at desc limit least(greatest(p_limit,1),100)) x),'[]'::jsonb))
$$;

create or replace function public.mark_my_partner_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path='' as $$ declare n integer; begin
 update public.partner_notifications set is_read=true,read_at=now() where partner_id=public.my_active_partner_id() and not is_read and (p_ids is null or id=any(p_ids)); get diagnostics n=row_count; return n; end $$;

create or replace function public.get_my_partner_levels()
returns jsonb language sql stable security definer set search_path='' as $$
 with mine as (select count(*)::integer active_referrals from public.partner_referrals pr join public.growth_partners gp on gp.id=pr.partner_id where gp.id=public.my_active_partner_id() and pr.status='active')
 select jsonb_build_object('active_referrals',(select active_referrals from mine),'levels',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order) from (select code,sort_order,minimum_paid_referrals,commission_bps,perks,(select active_referrals from mine)>=minimum_paid_referrals as unlocked from public.partner_level_definitions where is_active) x),'[]'::jsonb))
$$;

create or replace function public.get_partner_leaderboard(p_limit integer default 25)
returns jsonb language sql stable security definer set search_path='' as $$
 with totals as (select e.partner_id,sum(e.amount_paise) filter(where e.status not in ('reversed','held'))::bigint earnings_paise from public.partner_earnings e group by e.partner_id), ranked as (select gp.id,gp.user_id,coalesce(t.earnings_paise,0) earnings_paise,dense_rank() over(order by coalesce(t.earnings_paise,0) desc) rank from public.growth_partners gp left join totals t on t.partner_id=gp.id where gp.is_active and gp.status='approved')
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('rank',rank,'partner_id',id,'earnings_paise',earnings_paise) order by rank) from (select * from ranked order by rank limit least(greatest(p_limit,1),100)) x),'[]'::jsonb),'my_rank',(select rank from ranked where id=public.my_active_partner_id()))
$$;

create or replace function public.get_partner_marketing_assets(p_category text default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,'description',description,'storage_bucket',storage_bucket,'storage_path',storage_path,'mime_type',mime_type,'file_size_bytes',file_size_bytes,'published_at',published_at) order by published_at desc),'[]'::jsonb) from public.partner_marketing_assets where is_published and (p_category is null or category=p_category)
$$;

create or replace function public.submit_my_partner_support_ticket(p_subject text,p_message text,p_priority text default 'normal')
returns jsonb language plpgsql security definer set search_path='' as $$ declare v_partner uuid:=public.my_active_partner_id(); v_ticket public.partner_support_tickets%rowtype; begin
 if v_partner is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 if length(trim(coalesce(p_subject,'')))<3 or length(trim(coalesce(p_message,'')))<10 or p_priority not in ('low','normal','high') then raise exception 'Invalid ticket' using errcode='22023'; end if;
 insert into public.partner_support_tickets(partner_id,subject,message,priority) values(v_partner,trim(p_subject),trim(p_message),p_priority) returning * into v_ticket;
 return jsonb_build_object('id',v_ticket.id,'ticket_number',v_ticket.ticket_number,'status',v_ticket.status,'created_at',v_ticket.created_at);
end $$;

revoke all on function public.get_my_partner_earnings(integer,integer), public.request_my_partner_payout(bigint,text,text), public.get_my_partner_notifications(text,integer), public.mark_my_partner_notifications_read(uuid[]), public.get_my_partner_levels(), public.get_partner_leaderboard(integer), public.get_partner_marketing_assets(text), public.submit_my_partner_support_ticket(text,text,text) from public, anon;
grant execute on function public.get_my_partner_earnings(integer,integer), public.request_my_partner_payout(bigint,text,text), public.get_my_partner_notifications(text,integer), public.mark_my_partner_notifications_read(uuid[]), public.get_my_partner_levels(), public.get_partner_leaderboard(integer), public.get_partner_marketing_assets(text), public.submit_my_partner_support_ticket(text,text,text) to authenticated, service_role;
revoke all on function public.record_partner_subscription_commission(uuid,text,bigint,timestamptz), public.release_partner_earnings(timestamptz), public.admin_mark_partner_payout_paid(uuid,text) from public, anon, authenticated;
grant execute on function public.record_partner_subscription_commission(uuid,text,bigint,timestamptz), public.release_partner_earnings(timestamptz), public.admin_mark_partner_payout_paid(uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
