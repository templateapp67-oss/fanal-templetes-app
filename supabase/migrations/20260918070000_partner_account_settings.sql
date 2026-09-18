begin;

create table if not exists public.partner_account_settings (
  partner_id uuid primary key references public.growth_partners(id) on delete cascade,
  agency_name text not null default '',
  whatsapp_phone text,
  city text not null default '',
  state text not null default '',
  public_bio text not null default '',
  full_address text not null default '',
  alternate_phone text,
  website_url text,
  social_handles text not null default '',
  kyb_status text not null default 'pending',
  payout_method text check (payout_method in ('upi','bank_transfer','paypal')),
  payout_account_name text,
  payout_account_number text,
  payout_ifsc text,
  payout_upi_id text,
  updated_at timestamptz not null default now()
);
alter table public.partner_account_settings enable row level security;
drop policy if exists partner_account_settings_owner on public.partner_account_settings;
create policy partner_account_settings_owner on public.partner_account_settings for all to authenticated using (partner_id = public.my_active_partner_id()) with check (partner_id = public.my_active_partner_id());

create or replace function public.get_my_partner_account_settings()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare p uuid := public.my_active_partner_id(); r jsonb;
begin
  insert into public.partner_account_settings(partner_id) values(p) on conflict(partner_id) do nothing;
  select jsonb_build_object('agency_name',agency_name,'whatsapp_phone',whatsapp_phone,'city',city,'state',state,'public_bio',public_bio,'full_address',full_address,'alternate_phone',alternate_phone,'website_url',website_url,'social_handles',social_handles,'kyb_status',kyb_status,'payout_method',payout_method,'payout_account_name',payout_account_name,'payout_account_number',payout_account_number,'payout_ifsc',payout_ifsc,'payout_upi_id',payout_upi_id) into r from public.partner_account_settings where partner_id=p;
  return r;
end $$;

create or replace function public.save_my_partner_account_settings(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare p uuid := public.my_active_partner_id();
begin
  if jsonb_typeof(p_patch) <> 'object' or p_patch - array['agency_name','whatsapp_phone','city','state','public_bio','full_address','alternate_phone','website_url','social_handles','payout_method','payout_account_name','payout_account_number','payout_ifsc','payout_upi_id'] <> '{}'::jsonb then raise exception 'Unsupported account setting'; end if;
  insert into public.partner_account_settings(partner_id,agency_name,whatsapp_phone,city,state,public_bio,full_address,alternate_phone,website_url,social_handles,payout_method,payout_account_name,payout_account_number,payout_ifsc,payout_upi_id)
  values(p,coalesce(p_patch->>'agency_name',''),nullif(p_patch->>'whatsapp_phone',''),coalesce(p_patch->>'city',''),coalesce(p_patch->>'state',''),coalesce(p_patch->>'public_bio',''),coalesce(p_patch->>'full_address',''),nullif(p_patch->>'alternate_phone',''),nullif(p_patch->>'website_url',''),coalesce(p_patch->>'social_handles',''),nullif(p_patch->>'payout_method','')::text,nullif(p_patch->>'payout_account_name',''),nullif(p_patch->>'payout_account_number',''),nullif(p_patch->>'payout_ifsc',''),nullif(p_patch->>'payout_upi_id',''))
  on conflict(partner_id) do update set agency_name=coalesce(p_patch->>'agency_name',partner_account_settings.agency_name), whatsapp_phone=case when p_patch ? 'whatsapp_phone' then nullif(p_patch->>'whatsapp_phone','') else partner_account_settings.whatsapp_phone end, city=coalesce(p_patch->>'city',partner_account_settings.city), state=coalesce(p_patch->>'state',partner_account_settings.state), public_bio=coalesce(p_patch->>'public_bio',partner_account_settings.public_bio), payout_method=case when p_patch ? 'payout_method' then nullif(p_patch->>'payout_method','')::text else partner_account_settings.payout_method end, payout_account_name=case when p_patch ? 'payout_account_name' then nullif(p_patch->>'payout_account_name','') else partner_account_settings.payout_account_name end, payout_account_number=case when p_patch ? 'payout_account_number' then nullif(p_patch->>'payout_account_number','') else partner_account_settings.payout_account_number end, payout_ifsc=case when p_patch ? 'payout_ifsc' then nullif(p_patch->>'payout_ifsc','') else partner_account_settings.payout_ifsc end, payout_upi_id=case when p_patch ? 'payout_upi_id' then nullif(p_patch->>'payout_upi_id','') else partner_account_settings.payout_upi_id end, updated_at=now();
  return public.get_my_partner_account_settings();
end $$;
revoke all on function public.get_my_partner_account_settings() from public, anon;
revoke all on function public.save_my_partner_account_settings(jsonb) from public, anon;
grant execute on function public.get_my_partner_account_settings() to authenticated;
grant execute on function public.save_my_partner_account_settings(jsonb) to authenticated;
commit;
