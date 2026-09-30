-- Install the asset library independently of the incompatible legacy partner ledger.
begin;
create table if not exists public.partner_marketing_assets (
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in ('banner','email_template','social_graphic','video_demo')),
 title text not null,description text,storage_bucket text not null default 'partner-marketing-assets',
 storage_path text not null unique,mime_type text not null,file_size_bytes bigint check(file_size_bytes>=0),
 is_published boolean not null default false,published_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(not is_published or published_at is not null)
);
create index if not exists partner_marketing_assets_published_idx
 on public.partner_marketing_assets(category,published_at desc) where is_published;
alter table public.partner_marketing_assets enable row level security;
revoke all on public.partner_marketing_assets from public,anon,authenticated;
grant select on public.partner_marketing_assets to authenticated;
drop policy if exists partner_assets_select_published on public.partner_marketing_assets;
create policy partner_assets_select_published on public.partner_marketing_assets for select to authenticated
 using(is_published and exists(select 1 from public.growth_partners where user_id=auth.uid() and is_active));
create or replace function public.get_partner_marketing_assets(p_category text default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.growth_partners where user_id=auth.uid() and is_active) then
 raise exception 'Active Growth Partner required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,
 'description',description,'storage_bucket',storage_bucket,'storage_path',storage_path,
 'mime_type',mime_type,'file_size_bytes',file_size_bytes,'published_at',published_at)
 order by published_at desc,id desc),'[]'::jsonb) from public.partner_marketing_assets
 where is_published and (p_category is null or category=p_category));
end $$;
create or replace function public.get_partner_marketing_asset_categories()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.growth_partners where user_id=auth.uid() and is_active) then
 raise exception 'Active Growth Partner required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(c) order by category),'[]'::jsonb)
 from (select category,count(*)::integer as asset_count from public.partner_marketing_assets where is_published group by category)c);
end $$;
revoke all on function public.get_partner_marketing_assets(text),public.get_partner_marketing_asset_categories() from public,anon;
grant execute on function public.get_partner_marketing_assets(text),public.get_partner_marketing_asset_categories() to authenticated,service_role;
-- Downloads use the existing authorized server route to issue signed URLs.
do $$ begin
 if to_regclass('storage.buckets') is not null then
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('partner-marketing-assets','partner-marketing-assets',false,26214400,
 array['image/png','image/jpeg','image/webp','application/pdf','video/mp4','text/plain','application/zip'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
