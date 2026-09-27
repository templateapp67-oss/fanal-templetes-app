-- Profile photo save compatibility for deployments that predate one or more
-- historical profile aliases. This migration is additive and preserves data.

alter table public.profiles
  add column if not exists phone text,
  add column if not exists whatsapp text,
  add column if not exists postal_code text,
  add column if not exists area text,
  add column if not exists owner_photo_url text,
  add column if not exists avatar_url text,
  add column if not exists photo_url text,
  add column if not exists date_of_birth date,
  add column if not exists dob date,
  add column if not exists full_address text,
  add column if not exists state text,
  add column if not exists landmark text,
  add column if not exists whatsapp_notifications_enabled boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles enable row level security;

-- Table access is still constrained by the existing owner-only RLS policies.
grant select, insert, update on public.profiles to authenticated;

create or replace function public.save_my_profile_settings(p_patch jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_photo text := nullif(btrim(coalesce(p_patch->>'ownerPhotoUrl', '')), '');
  v_name text := nullif(btrim(coalesce(p_patch->>'ownerName', '')), '');
  v_city text := nullif(btrim(coalesce(p_patch->>'city', '')), '');
  v_phone text := nullif(btrim(coalesce(p_patch->>'phone', '')), '');
  v_whatsapp text := nullif(btrim(coalesce(p_patch->>'whatsapp', '')), '');
  v_postal text := nullif(btrim(coalesce(p_patch->>'postalCode', '')), '');
  v_area text := nullif(btrim(coalesce(p_patch->>'areaLocality', '')), '');
  v_dob date := null;
  v_notifications boolean := coalesce((p_patch->>'whatsappNotificationsEnabled')::boolean, true);
begin
  if v_owner is null then
    raise exception 'Sign in again before saving profile settings' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['ownerName', 'phone', 'whatsapp', 'dob', 'postalCode', 'city', 'areaLocality', 'email', 'address', 'state', 'landmark', 'ownerPhotoUrl', 'whatsappNotificationsEnabled'] <> '{}'::jsonb then
    raise exception 'Invalid profile settings payload' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Enter a full name of 1–120 characters' using errcode = '22023';
  end if;
  if v_postal is not null and v_postal !~ '^[1-9][0-9]{5}$' then
    raise exception 'Enter a valid six-digit PIN code' using errcode = '22023';
  end if;
  if v_photo is not null and v_photo !~ '^(https://|data:image/(jpeg|png|webp);base64,)' then
    raise exception 'Profile photo must be an HTTPS image URL or a supported image upload' using errcode = '22023';
  end if;
  if v_photo is not null and octet_length(v_photo) > 1000000 then
    raise exception 'Profile photo is too large; choose a smaller image' using errcode = '22023';
  end if;
  if nullif(p_patch->>'dob', '') is not null then
    v_dob := (p_patch->>'dob')::date;
    if v_dob > current_date then
      raise exception 'Date of birth cannot be in the future' using errcode = '22023';
    end if;
  end if;

  insert into public.profiles (
    id, full_name, phone, whatsapp, postal_code, city, area,
    owner_photo_url, avatar_url, photo_url, date_of_birth, dob, email,
    full_address, state, landmark,
    whatsapp_notifications_enabled, updated_at
  ) values (
    v_owner, v_name, v_phone, v_whatsapp, v_postal, v_city, v_area,
    v_photo, v_photo, v_photo, v_dob, v_dob,
    nullif(btrim(coalesce(p_patch->>'email', '')), ''),
    nullif(btrim(coalesce(p_patch->>'address', '')), ''),
    nullif(btrim(coalesce(p_patch->>'state', '')), ''),
    nullif(btrim(coalesce(p_patch->>'landmark', '')), ''),
    v_notifications, now()
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    whatsapp = excluded.whatsapp,
    postal_code = excluded.postal_code,
    city = excluded.city,
    area = excluded.area,
    owner_photo_url = excluded.owner_photo_url,
    avatar_url = excluded.avatar_url,
    photo_url = excluded.photo_url,
    date_of_birth = excluded.date_of_birth,
    dob = excluded.dob,
    email = excluded.email,
    full_address = excluded.full_address,
    state = excluded.state,
    landmark = excluded.landmark,
    whatsapp_notifications_enabled = excluded.whatsapp_notifications_enabled,
    updated_at = now();
end;
$$;

create or replace function public.get_my_profile_settings()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'ownerName', p.full_name,
    'phone', p.phone,
    'whatsapp', p.whatsapp,
    'postalCode', p.postal_code,
    'city', p.city,
    'area', p.area,
    'email', p.email,
    'address', p.full_address,
    'state', p.state,
    'landmark', p.landmark,
    'dob', coalesce(p.dob, p.date_of_birth),
    'notifications', p.whatsapp_notifications_enabled,
    'avatar', coalesce(p.owner_photo_url, p.avatar_url, p.photo_url)
  )
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.save_my_profile_settings(jsonb) from public, anon;
grant execute on function public.save_my_profile_settings(jsonb) to authenticated;
revoke all on function public.get_my_profile_settings() from public, anon;
grant execute on function public.get_my_profile_settings() to authenticated;
