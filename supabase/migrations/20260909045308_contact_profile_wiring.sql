-- Durable editor state: the deployed schema stores salons/services separately,
-- so legacy upserts into profiles/stylists must not be used as an editor backup.
create table public.owner_editor_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check(jsonb_typeof(state)='object'),
  updated_at timestamptz not null default now()
);
alter table public.owner_editor_state enable row level security;
grant select,insert,update on public.owner_editor_state to authenticated;
create policy editor_owner on public.owner_editor_state for all to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

grant update(phone,mobile,whatsapp,pincode,city,preferred_city,area,preferred_area,full_name,avatar_url,photo_url) on public.profiles to authenticated;
grant update(phone,mobile,whatsapp,email,address,city,area,state,pincode,latitude,longitude,landmark,data) on public.salons to authenticated;

create function public.sync_owner_contact(p_profile jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare actor uuid := auth.uid(); changed integer; patch jsonb;
begin
  if actor is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(p_profile) <> 'object' or p_profile is null then raise exception 'Invalid profile'; end if;
  if octet_length(p_profile::text)>4000000 then raise exception 'Profile is too large; use image uploads'; end if;
  update public.profiles set
    full_name=case when p_profile ? 'ownerName' then p_profile->>'ownerName' else full_name end,
    phone=case when p_profile ? 'phone' then p_profile->>'phone' else phone end,
    mobile=case when p_profile ? 'phone' then p_profile->>'phone' else mobile end,
    whatsapp=case when p_profile ? 'whatsapp' then p_profile->>'whatsapp' else whatsapp end,
    pincode=case when p_profile ? 'postalCode' then p_profile->>'postalCode' else pincode end,
    city=case when p_profile ? 'city' then p_profile->>'city' else city end,
    preferred_city=case when p_profile ? 'city' then p_profile->>'city' else preferred_city end,
    area=case when p_profile ? 'areaLocality' then p_profile->>'areaLocality' else area end,
    preferred_area=case when p_profile ? 'areaLocality' then p_profile->>'areaLocality' else preferred_area end,
    avatar_url=case when p_profile ? 'ownerPhotoUrl' then p_profile->>'ownerPhotoUrl' else avatar_url end,
    photo_url=case when p_profile ? 'ownerPhotoUrl' then p_profile->>'ownerPhotoUrl' else photo_url end
  where id=actor;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Your account profile could not be updated'; end if;
  -- Email here is a BUSINESS contact address, never an auth.users email change.
  patch := p_profile - array['dateOfBirth','dob','notifications','whatsappNotifications'];
  insert into public.owner_editor_state(owner_id,state) values(actor,jsonb_build_object('profile',patch))
  on conflict(owner_id) do update set state=jsonb_set(owner_editor_state.state,'{profile}',coalesce(owner_editor_state.state->'profile','{}'::jsonb)||patch),updated_at=now();
  update public.salons set
    phone=case when patch ? 'phone' then patch->>'phone' else phone end,
    mobile=case when patch ? 'phone' then patch->>'phone' else mobile end,
    whatsapp=case when patch ? 'whatsapp' then patch->>'whatsapp' else whatsapp end,
    email=case when patch ? 'email' then patch->>'email' else email end,
    address=case when patch ? 'address' then patch->>'address' else address end,
    city=case when patch ? 'city' then patch->>'city' else city end,
    area=case when patch ? 'areaLocality' then patch->>'areaLocality' else area end,
    state=case when patch ? 'state' then patch->>'state' else state end,
    pincode=case when patch ? 'postalCode' then patch->>'postalCode' else pincode end,
    landmark=case when patch ? 'landmark' then patch->>'landmark' else landmark end,
    latitude=case when patch ? 'latitude' then (patch->>'latitude')::numeric else latitude end,
    longitude=case when patch ? 'longitude' then (patch->>'longitude')::numeric else longitude end,
    data=coalesce(data,'{}'::jsonb)||jsonb_build_object('owner_photo_url',coalesce(patch->>'ownerPhotoUrl',data->>'owner_photo_url'),'owner_name',coalesce(patch->>'ownerName',data->>'owner_name'))
  where owner_id=actor and (slug=patch->>'subdomain' or (select count(*) from public.salons where owner_id=actor)=1);
end;
$$;

create function public.save_owner_editor_state(p_state jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(p_state->'profile') is distinct from 'object' then raise exception 'Profile is required'; end if;
  if octet_length(p_state::text)>8000000 then raise exception 'Editor data is too large; upload images first'; end if;
  insert into public.owner_editor_state(owner_id,state) values(auth.uid(),p_state-'ownerId')
  on conflict(owner_id) do update set state=excluded.state,updated_at=now();
  perform public.sync_owner_contact(p_state->'profile');
end;
$$;

create function public.get_owner_editor_state()
returns jsonb language sql stable security invoker set search_path=public as $$
  select state from public.owner_editor_state where owner_id=auth.uid();
$$;

create function public.save_partner_profile_details(p_details jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform public.save_partner_profile(p_details->>'ownerName',p_details->>'whatsapp',p_details->>'postalCode',p_details->>'city',p_details->>'ownerPhotoUrl',(p_details->>'dob')::date,p_details->>'areaLocality',(p_details->>'notifications')::boolean);
  perform public.sync_owner_contact(p_details);
end;
$$;

-- All functions use the authenticated caller and preserve existing role guards/RLS.
revoke all on function public.sync_owner_contact(jsonb),public.save_owner_editor_state(jsonb),public.get_owner_editor_state(),public.save_partner_profile_details(jsonb) from public,anon;
grant execute on function public.sync_owner_contact(jsonb),public.save_owner_editor_state(jsonb),public.get_owner_editor_state(),public.save_partner_profile_details(jsonb) to authenticated;
