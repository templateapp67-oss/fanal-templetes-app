-- Additive Idempotent Migration: Robust Profile RPC with dynamic column checks
-- Prevents any schema cache errors for 'dob', 'date_of_birth', or other profile columns.

begin;

create or replace function public.save_partner_profile(p_name text, p_whatsapp text, p_postal text, p_city text, p_avatar text, p_dob date, p_area text, p_notifications boolean)
returns void language plpgsql security invoker set search_path = public as $$
declare
  changed integer;
  has_dob boolean;
  has_date_of_birth boolean;
  has_whatsapp boolean;
  has_pincode boolean;
  has_city boolean;
  has_avatar boolean;
  has_area boolean;
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

  -- Check existing columns on public.profiles dynamically
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='dob') into has_dob;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='date_of_birth') into has_date_of_birth;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='whatsapp') into has_whatsapp;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='pincode') into has_pincode;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='city') into has_city;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='avatar_url') into has_avatar;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='area') into has_area;

  -- Update profiles with only existing columns
  update public.profiles set
    full_name = coalesce(trim(p_name), full_name),
    whatsapp = case when has_whatsapp then p_whatsapp else whatsapp end,
    pincode = case when has_pincode then p_postal else pincode end,
    city = case when has_city then trim(p_city) else city end,
    preferred_city = case when has_city then trim(p_city) else preferred_city end,
    avatar_url = case when has_avatar then p_avatar else avatar_url end,
    photo_url = case when has_avatar then p_avatar else photo_url end,
    dob = case when has_dob then p_dob::text else dob end,
    date_of_birth = case when has_date_of_birth then p_dob else date_of_birth end,
    area = case when has_area then trim(p_area) else area end,
    preferred_area = case when has_area then trim(p_area) else preferred_area end
  where id = auth.uid();

  get diagnostics changed = row_count;
  if changed <> 1 then
    insert into public.profiles (id, full_name)
    values (auth.uid(), trim(p_name))
    on conflict (id) do update set full_name = excluded.full_name;
  end if;

  if to_regclass('public.partner_settings') is not null then
    insert into public.partner_settings(owner_id,date_of_birth,area,whatsapp_notifications)
    values(auth.uid(),p_dob,trim(p_area),p_notifications)
    on conflict(owner_id) do update set date_of_birth=excluded.date_of_birth,area=excluded.area,
      whatsapp_notifications=excluded.whatsapp_notifications,updated_at=now();
  end if;
end;
$$;

revoke all on function public.save_partner_profile(text,text,text,text,text,date,text,boolean) from public, anon;
grant execute on function public.save_partner_profile(text,text,text,text,text,date,text,boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
