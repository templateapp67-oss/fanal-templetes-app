-- Durable owner profile settings shared by the Header modal and the website
-- editor. These canonical names coexist with legacy profiles columns; the
-- sync trigger below keeps both spellings aligned for older save paths.

begin;

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists whatsapp_number text,
  add column if not exists dob date,
  add column if not exists pin_code text,
  add column if not exists city text,
  add column if not exists area text,
  add column if not exists phone_number text,
  add column if not exists contact_email text,
  add column if not exists address text,
  add column if not exists state text,
  add column if not exists landmark text,
  add column if not exists avatar_url text,
  add column if not exists phone text,
  add column if not exists mobile text,
  add column if not exists whatsapp text,
  add column if not exists postal_code text,
  add column if not exists pincode text,
  add column if not exists preferred_city text,
  add column if not exists preferred_area text,
  add column if not exists email text,
  add column if not exists full_address text,
  add column if not exists owner_photo_url text,
  add column if not exists photo_url text,
  add column if not exists date_of_birth date,
  add column if not exists whatsapp_notifications_enabled boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- One-time compatibility backfill. Keep any already-populated canonical value;
-- otherwise copy the equivalent value from the older column spelling.
update public.profiles
set
  phone_number = coalesce(nullif(btrim(phone_number), ''), nullif(btrim(phone), ''), nullif(btrim(mobile), '')),
  whatsapp_number = coalesce(nullif(btrim(whatsapp_number), ''), nullif(btrim(whatsapp), '')),
  pin_code = coalesce(nullif(btrim(pin_code), ''), nullif(btrim(postal_code), ''), nullif(btrim(pincode), '')),
  city = coalesce(nullif(btrim(city), ''), nullif(btrim(preferred_city), '')),
  area = coalesce(nullif(btrim(area), ''), nullif(btrim(preferred_area), '')),
  contact_email = coalesce(nullif(btrim(contact_email), ''), nullif(btrim(email), '')),
  address = coalesce(nullif(btrim(address), ''), nullif(btrim(full_address), '')),
  avatar_url = coalesce(nullif(btrim(avatar_url), ''), nullif(btrim(owner_photo_url), ''), nullif(btrim(photo_url), ''));

create or replace function public.sync_profile_settings_aliases()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_value text;
begin
  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.phone_number), ''), nullif(btrim(new.phone), ''), nullif(btrim(new.mobile), ''));
  elsif new.phone_number is distinct from old.phone_number then
    v_value := new.phone_number;
  elsif new.phone is distinct from old.phone then
    v_value := new.phone;
  elsif new.mobile is distinct from old.mobile then
    v_value := new.mobile;
  else
    v_value := new.phone_number;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.phone_number := v_value;
  new.phone := v_value;
  new.mobile := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.whatsapp_number), ''), nullif(btrim(new.whatsapp), ''));
  elsif new.whatsapp_number is distinct from old.whatsapp_number then
    v_value := new.whatsapp_number;
  elsif new.whatsapp is distinct from old.whatsapp then
    v_value := new.whatsapp;
  else
    v_value := new.whatsapp_number;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.whatsapp_number := v_value;
  new.whatsapp := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.pin_code), ''), nullif(btrim(new.postal_code), ''), nullif(btrim(new.pincode), ''));
  elsif new.pin_code is distinct from old.pin_code then
    v_value := new.pin_code;
  elsif new.postal_code is distinct from old.postal_code then
    v_value := new.postal_code;
  elsif new.pincode is distinct from old.pincode then
    v_value := new.pincode;
  else
    v_value := new.pin_code;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.pin_code := v_value;
  new.postal_code := v_value;
  new.pincode := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.city), ''), nullif(btrim(new.preferred_city), ''));
  elsif new.city is distinct from old.city then
    v_value := new.city;
  elsif new.preferred_city is distinct from old.preferred_city then
    v_value := new.preferred_city;
  else
    v_value := new.city;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.city := v_value;
  new.preferred_city := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.area), ''), nullif(btrim(new.preferred_area), ''));
  elsif new.area is distinct from old.area then
    v_value := new.area;
  elsif new.preferred_area is distinct from old.preferred_area then
    v_value := new.preferred_area;
  else
    v_value := new.area;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.area := v_value;
  new.preferred_area := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.contact_email), ''), nullif(btrim(new.email), ''));
  elsif new.contact_email is distinct from old.contact_email then
    v_value := new.contact_email;
  elsif new.email is distinct from old.email then
    v_value := new.email;
  else
    v_value := new.contact_email;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.contact_email := v_value;
  new.email := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.address), ''), nullif(btrim(new.full_address), ''));
  elsif new.address is distinct from old.address then
    v_value := new.address;
  elsif new.full_address is distinct from old.full_address then
    v_value := new.full_address;
  else
    v_value := new.address;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.address := v_value;
  new.full_address := v_value;

  if tg_op = 'INSERT' then
    v_value := coalesce(nullif(btrim(new.avatar_url), ''), nullif(btrim(new.owner_photo_url), ''), nullif(btrim(new.photo_url), ''));
  elsif new.avatar_url is distinct from old.avatar_url then
    v_value := new.avatar_url;
  elsif new.owner_photo_url is distinct from old.owner_photo_url then
    v_value := new.owner_photo_url;
  elsif new.photo_url is distinct from old.photo_url then
    v_value := new.photo_url;
  else
    v_value := new.avatar_url;
  end if;
  v_value := nullif(btrim(v_value), '');
  new.avatar_url := v_value;
  new.owner_photo_url := v_value;
  new.photo_url := v_value;

  -- DOB has existed as both dob and date_of_birth. Use the explicitly changed
  -- value as the source of truth, while safely ignoring invalid legacy text.
  if tg_op = 'INSERT' then
    if nullif(new.dob::text, '') is null and new.date_of_birth is not null then
      new.dob := new.date_of_birth;
    elsif new.date_of_birth is null and nullif(new.dob::text, '') is not null then
      begin
        new.date_of_birth := nullif(new.dob::text, '')::date;
      exception when others then
        new.date_of_birth := null;
      end;
    end if;
  elsif new.dob::text is distinct from old.dob::text then
    if nullif(new.dob::text, '') is null then
      new.date_of_birth := null;
    else
      begin
        new.date_of_birth := nullif(new.dob::text, '')::date;
      exception when others then
        new.date_of_birth := null;
      end;
    end if;
  elsif new.date_of_birth is distinct from old.date_of_birth then
    new.dob := new.date_of_birth;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_settings_aliases on public.profiles;
create trigger trg_profiles_sync_settings_aliases
  before insert or update on public.profiles
  for each row execute function public.sync_profile_settings_aliases();

-- Data API privileges and owner-only policies are both required for the
-- browser's SELECT + upsert (INSERT/UPDATE) requests.
alter table public.profiles enable row level security;
grant usage on schema public to authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists profiles_select_owner on public.profiles;
create policy profiles_select_owner
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_insert_owner on public.profiles;
create policy profiles_insert_owner
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on function public.sync_profile_settings_aliases() from public, anon, authenticated;
notify pgrst, 'reload schema';

commit;
