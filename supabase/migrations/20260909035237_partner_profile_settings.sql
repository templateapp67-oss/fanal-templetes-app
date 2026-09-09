-- Compatible with the deployed normalized Nexora schema and the repository legacy schema.
alter table public.profiles add column if not exists whatsapp text;
create table if not exists public.partner_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null check (date_of_birth <= current_date),
  area text not null check (length(trim(area)) between 1 and 120),
  whatsapp_notifications boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.partner_settings enable row level security;
grant select, insert, update on public.partner_settings to authenticated;
create policy partner_settings_read on public.partner_settings for select to authenticated using (owner_id = (select auth.uid()));
create policy partner_settings_insert on public.partner_settings for insert to authenticated with check (owner_id = (select auth.uid()));
create policy partner_settings_update on public.partner_settings for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create or replace function public.save_partner_profile(p_name text, p_whatsapp text, p_postal text, p_city text, p_avatar text, p_dob date, p_area text, p_notifications boolean)
returns void language plpgsql security invoker set search_path = public as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Sign in to save your profile'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120
    or p_city is null or length(trim(p_city)) not between 1 and 120
    or p_whatsapp is null or p_whatsapp !~ '^\+[1-9][0-9]{7,14}$'
    or p_postal is null or p_postal !~ '^[1-9][0-9]{5}$'
    or p_avatar is null or p_avatar !~ '^https://'
    or p_dob is null or p_dob > current_date
    or p_area is null or length(trim(p_area)) not between 1 and 120
    or p_notifications is null then raise exception 'Invalid profile fields'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='pincode') then
    -- Existing accounts are provisioned by auth triggers; never bypass their role guards.
    execute 'update public.profiles set full_name=$1,whatsapp=$2,pincode=$3,city=$4,preferred_city=$4,avatar_url=$5,photo_url=$5,date_of_birth=$6,area=$7,preferred_area=$7 where id=$8'
      using trim(p_name),p_whatsapp,p_postal,trim(p_city),p_avatar,p_dob,trim(p_area),auth.uid();
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Account profile is missing or not editable'; end if;
    insert into public.user_preferences(user_id,whatsapp_notifications)
      values(auth.uid(),p_notifications)
      on conflict(user_id) do update set whatsapp_notifications=excluded.whatsapp_notifications;
  else
    insert into public.profiles (id, full_name, whatsapp, postal_code, city, owner_photo_url)
    values (auth.uid(), trim(p_name), p_whatsapp, p_postal, trim(p_city), p_avatar)
    on conflict (id) do update set full_name = excluded.full_name, whatsapp = excluded.whatsapp,
      postal_code = excluded.postal_code, city = excluded.city, owner_photo_url = excluded.owner_photo_url;
  end if;
  insert into public.partner_settings(owner_id,date_of_birth,area,whatsapp_notifications)
  values(auth.uid(),p_dob,trim(p_area),p_notifications)
  on conflict(owner_id) do update set date_of_birth=excluded.date_of_birth,area=excluded.area,
    whatsapp_notifications=excluded.whatsapp_notifications,updated_at=now();
end;
$$;
revoke all on function public.save_partner_profile(text,text,text,text,text,date,text,boolean) from public, anon;
grant execute on function public.save_partner_profile(text,text,text,text,text,date,text,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('partner-avatars','partner-avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy partner_avatar_insert on storage.objects for insert to authenticated
with check(bucket_id='partner-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy partner_avatar_read on storage.objects for select to authenticated
using(bucket_id='partner-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy partner_avatar_delete on storage.objects for delete to authenticated
using(bucket_id='partner-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.get_partner_profile()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare p jsonb; s jsonb; preferences jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to read your profile'; end if;
  select to_jsonb(profiles) into p from public.profiles where id=auth.uid();
  select to_jsonb(partner_settings) into s from public.partner_settings where owner_id=auth.uid();
  if to_regclass('public.user_preferences') is not null then
    execute 'select to_jsonb(u) from public.user_preferences u where user_id=$1' into preferences using auth.uid();
  end if;
  return jsonb_build_object(
    'name',p->>'full_name','whatsapp',coalesce(p->>'whatsapp',p->>'phone',p->>'phone_number'),
    'postal',coalesce(p->>'pincode',p->>'postal_code'),'city',coalesce(p->>'city',p->>'preferred_city'),
    'avatar',coalesce(p->>'avatar_url',p->>'photo_url',p->>'owner_photo_url'),
    'dob',coalesce(s->>'date_of_birth',p->>'date_of_birth'),
    'area',coalesce(s->>'area',p->>'area',p->>'preferred_area'),
    'notifications',coalesce(preferences->'whatsapp_notifications',s->'whatsapp_notifications','false'::jsonb));
end;
$$;
revoke all on function public.get_partner_profile() from public,anon;
grant execute on function public.get_partner_profile() to authenticated;
