-- Keep the public website slug in sync with the Website Editor's
-- "Sub-domain (white-label)" field.
--
-- The SPA opens public sites as /?site=<slug>. Older save functions stored the
-- edited value only inside salons.data.editor_profile.subdomain, while the
-- public lookup route primarily reads salons.slug. That made a freshly edited
-- slug (e.g. hellosalon -> star-salon) look missing until a provisioning RPC
-- happened separately. This patch makes the normal editor save commit the slug
-- atomically in the same transaction.

begin;

create or replace function public.sync_owner_contact(p_profile jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changed integer;
  patch jsonb;
  normalized_slug text := null;
  conflicting_salon uuid;
begin
  if actor is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(p_profile) <> 'object' or p_profile is null then raise exception 'Invalid profile'; end if;
  if octet_length(p_profile::text)>4000000 then raise exception 'Profile is too large; use image uploads'; end if;

  if nullif(btrim(coalesce(p_profile->>'subdomain', '')), '') is not null then
    normalized_slug := lower(regexp_replace(btrim(p_profile->>'subdomain'), '[^a-z0-9]+', '-', 'g'));
    normalized_slug := trim(both '-' from normalized_slug);
    if normalized_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
      raise exception 'Choose a valid website address (2-63 lowercase letters, numbers or hyphens)' using errcode = '22023';
    end if;

    select s.id into conflicting_salon
      from public.salons s
     where lower(s.slug) = normalized_slug
       and s.id not in (select public.nexora_owner_salon_ids())
     limit 1;
    if conflicting_salon is not null then
      raise exception 'That website address is already in use. Try another one.' using errcode = '23505';
    end if;
  end if;

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
    slug=coalesce(normalized_slug, slug),
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
    data=coalesce(data,'{}'::jsonb)||jsonb_build_object(
      'owner_photo_url',coalesce(patch->>'ownerPhotoUrl',data->>'owner_photo_url'),
      'owner_name',coalesce(patch->>'ownerName',data->>'owner_name')
    ),
    updated_at=now()
  where id in (select public.nexora_owner_salon_ids())
    and (
      (normalized_slug is not null and (slug = normalized_slug or (select count(*) from public.salons where id in (select public.nexora_owner_salon_ids())) = 1))
      or (normalized_slug is null and (slug=patch->>'subdomain' or (select count(*) from public.salons where id in (select public.nexora_owner_salon_ids()))=1))
    );
end;
$$;

revoke all on function public.sync_owner_contact(jsonb) from public, anon;
grant execute on function public.sync_owner_contact(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
