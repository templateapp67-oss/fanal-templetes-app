-- Additive Idempotent Migration: Ensure dob column on public.profiles and update sync_owner_contact RPC

begin;

-- 1. Ensure dob and date_of_birth columns exist on public.profiles
alter table public.profiles add column if not exists dob text;
alter table public.profiles add column if not exists date_of_birth date;
alter table public.profiles add column if not exists whatsapp text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists photo_url text;
alter table public.profiles add column if not exists owner_photo_url text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists postal_code text;
alter table public.profiles add column if not exists pincode text;
alter table public.profiles add column if not exists area text;

-- 2. Update sync_owner_contact to safely handle dob and date_of_birth without schema errors
create or replace function public.sync_owner_contact(p_profile jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  changed integer;
  patch jsonb;
  v_dob text;
  v_dob_date date;
begin
  if actor is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(p_profile) <> 'object' or p_profile is null then raise exception 'Invalid profile'; end if;

  v_dob := coalesce(p_profile->>'dob', p_profile->>'dateOfBirth');
  begin
    v_dob_date := nullif(v_dob, '')::date;
  exception when others then
    v_dob_date := null;
  end;

  if to_regclass('public.profiles') is not null then
    update public.profiles set
      full_name = case when p_profile ? 'ownerName' then p_profile->>'ownerName' else full_name end,
      phone = case when p_profile ? 'phone' then p_profile->>'phone' else phone end,
      mobile = case when p_profile ? 'phone' then p_profile->>'phone' else mobile end,
      whatsapp = case when p_profile ? 'whatsapp' then p_profile->>'whatsapp' else whatsapp end,
      pincode = case when p_profile ? 'postalCode' then p_profile->>'postalCode' else pincode end,
      city = case when p_profile ? 'city' then p_profile->>'city' else city end,
      area = case when p_profile ? 'areaLocality' then p_profile->>'areaLocality' else area end,
      avatar_url = case when p_profile ? 'ownerPhotoUrl' then p_profile->>'ownerPhotoUrl' else avatar_url end,
      photo_url = case when p_profile ? 'ownerPhotoUrl' then p_profile->>'ownerPhotoUrl' else photo_url end,
      dob = case when v_dob is not null then v_dob else dob end,
      date_of_birth = case when v_dob_date is not null then v_dob_date else date_of_birth end
    where id = actor;

    get diagnostics changed = row_count;
    if changed <> 1 then
      insert into public.profiles (
        id, full_name, phone, mobile, whatsapp, pincode, city, area, avatar_url, photo_url, dob, date_of_birth
      ) values (
        actor,
        p_profile->>'ownerName',
        p_profile->>'phone',
        p_profile->>'phone',
        p_profile->>'whatsapp',
        p_profile->>'postalCode',
        p_profile->>'city',
        p_profile->>'areaLocality',
        p_profile->>'ownerPhotoUrl',
        p_profile->>'ownerPhotoUrl',
        v_dob,
        v_dob_date
      ) on conflict (id) do update set
        full_name = coalesce(excluded.full_name, profiles.full_name),
        phone = coalesce(excluded.phone, profiles.phone),
        whatsapp = coalesce(excluded.whatsapp, profiles.whatsapp),
        pincode = coalesce(excluded.pincode, profiles.pincode),
        city = coalesce(excluded.city, profiles.city),
        area = coalesce(excluded.area, profiles.area),
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
        photo_url = coalesce(excluded.photo_url, profiles.photo_url),
        dob = coalesce(excluded.dob, profiles.dob),
        date_of_birth = coalesce(excluded.date_of_birth, profiles.date_of_birth);
    end if;
  end if;

  patch := p_profile - array['notifications','whatsappNotifications'];
  if to_regclass('public.owner_editor_state') is not null then
    insert into public.owner_editor_state(owner_id, state) values(actor, jsonb_build_object('profile', patch))
    on conflict(owner_id) do update set
      state = jsonb_set(owner_editor_state.state, '{profile}', coalesce(owner_editor_state.state->'profile', '{}'::jsonb) || patch),
      updated_at = now();
  end if;
end;
$$;

revoke all on function public.sync_owner_contact(jsonb) from public, anon;
grant execute on function public.sync_owner_contact(jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
