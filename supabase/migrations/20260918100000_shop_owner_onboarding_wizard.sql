begin;
alter table public.profiles add column if not exists onboarding_completed boolean not null default false;
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  shop_name text not null default '', business_type text not null default 'salon',
  address text not null default '', city text not null default '', state text not null default '',
  owner_name text not null default '', contact_phone text not null default '',
  referral_code text, partner_id uuid references public.growth_partners(id) on delete set null,
  selected_template_id text, logo_path text, theme_key text, upi_id text, qr_payload text,
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 4),
  onboarding_status text not null default 'draft' check (onboarding_status in ('draft','completed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists shops_owner_idx on public.shops(owner_id);
alter table public.shops enable row level security;
drop policy if exists shops_owner_select on public.shops;
drop policy if exists shops_owner_write on public.shops;
create policy shops_owner_select on public.shops for select to authenticated using (owner_id = auth.uid());
create policy shops_owner_write on public.shops for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.get_onboarding_progress()
returns jsonb language sql security invoker set search_path = pg_catalog, public as $$
  select coalesce((select to_jsonb(s) from public.shops s where s.owner_id = auth.uid() order by s.updated_at desc limit 1), '{}'::jsonb);
$$;
create or replace function public.save_shop_onboarding_draft(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r public.shops;
begin
  insert into public.shops(owner_id,shop_name,business_type,address,city,state,owner_name,contact_phone,referral_code,partner_id,selected_template_id,logo_path,theme_key,upi_id,qr_payload,onboarding_step)
  values(auth.uid(),coalesce(p_payload->>'shop_name',''),coalesce(p_payload->>'business_type','salon'),coalesce(p_payload->>'address',''),coalesce(p_payload->>'city',''),coalesce(p_payload->>'state',''),coalesce(p_payload->>'owner_name',''),coalesce(p_payload->>'contact_phone',''),nullif(p_payload->>'referral_code',''),nullif(p_payload->>'partner_id','')::uuid,nullif(p_payload->>'selected_template_id',''),nullif(p_payload->>'logo_path',''),nullif(p_payload->>'theme_key',''),nullif(p_payload->>'upi_id',''),nullif(p_payload->>'qr_payload',''),greatest(1,least(4,coalesce((p_payload->>'onboarding_step')::int,1)))) returning * into r;
  return to_jsonb(r);
end $$;
create or replace function public.complete_shop_onboarding(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r public.shops;
begin
  if nullif(trim(p_payload->>'shop_name'),'') is null or nullif(trim(p_payload->>'owner_name'),'') is null or nullif(trim(p_payload->>'contact_phone'),'') is null then raise exception 'Shop name, owner name and contact phone are required'; end if;
  insert into public.shops(owner_id,shop_name,business_type,address,city,state,owner_name,contact_phone,referral_code,partner_id,selected_template_id,logo_path,theme_key,upi_id,qr_payload,onboarding_step,onboarding_status,completed_at)
  values(auth.uid(),p_payload->>'shop_name',coalesce(p_payload->>'business_type','salon'),coalesce(p_payload->>'address',''),coalesce(p_payload->>'city',''),coalesce(p_payload->>'state',''),p_payload->>'owner_name',p_payload->>'contact_phone',nullif(p_payload->>'referral_code',''),nullif(p_payload->>'partner_id','')::uuid,p_payload->>'selected_template_id',nullif(p_payload->>'logo_path',''),nullif(p_payload->>'theme_key',''),nullif(p_payload->>'upi_id',''),nullif(p_payload->>'qr_payload',''),4,'completed',now()) returning * into r;
  update public.profiles set onboarding_completed = true where id = auth.uid();
  return to_jsonb(r);
end $$;
revoke all on function public.get_onboarding_progress() from public, anon;
revoke all on function public.save_shop_onboarding_draft(jsonb) from public, anon;
revoke all on function public.complete_shop_onboarding(jsonb) from public, anon;
grant execute on function public.get_onboarding_progress() to authenticated;
grant execute on function public.save_shop_onboarding_draft(jsonb) to authenticated;
grant execute on function public.complete_shop_onboarding(jsonb) to authenticated;
commit;
