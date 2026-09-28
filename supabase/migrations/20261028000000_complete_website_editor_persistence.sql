-- Complete Website Editor persistence for the reported mixed schema.
-- Run this WHOLE file after backup. Supersedes the 20261026 bridge.
-- Requires existing profiles, salons, organization membership, services/staff
-- tables and nexora_owner_salon_ids(). Does not invent ownership or seed demos.
-- Canonical state is JSONB, not a second set of snake_case website columns.
begin;
create table if not exists public.owner_editor_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state)='object'),
  updated_at timestamptz not null default now()
);
alter table public.owner_editor_state enable row level security;
drop policy if exists nexora_editor_state_owner on public.owner_editor_state;
create policy nexora_editor_state_owner on public.owner_editor_state
for all to authenticated
using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
grant select,insert,update on public.owner_editor_state to authenticated;

alter table public.salons
  add column if not exists address text,
  add column if not exists area text,
  add column if not exists city text,
  add column if not exists email text,
  add column if not exists landmark text,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists mobile text,
  add column if not exists pincode text,
  add column if not exists state text,
  add column if not exists whatsapp text;

alter table public.services
  add column if not exists salon_id uuid references public.salons(id),
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists price_paise bigint,
  add column if not exists is_active boolean default false,
  add column if not exists is_bookable_online boolean default false,
  add column if not exists is_featured boolean default false,
  add column if not exists display_order integer;
-- Existing rows remain unassigned: an owner may own multiple salons.
-- Newly saved services receive both salon_id and the authenticated owner_id.
create index if not exists nexora_services_salon_lookup on public.services(salon_id);

alter table public.staff_schedules
  add column if not exists is_working boolean default false;

-- This helper only updates the caller's profile. The enclosing atomic save
-- resolves and updates exactly one authorized salon, avoiding multi-salon
-- writes from an independent contact sync operation.
create or replace function public.sync_owner_contact(p_profile jsonb)
returns void language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare actor uuid := auth.uid(); changed integer;
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception 'Profile must be an object' using errcode='22023'; end if;
  if nullif(p_profile->>'ownerId','') is not null and p_profile->>'ownerId' <> actor::text then
    raise exception 'Profile belongs to another account' using errcode='42501'; end if;
  update public.profiles set
    full_name=case when lower(btrim(coalesce(p_profile->>'ownerName',''))) not in ('','user','owner','salon owner','unknown') then btrim(p_profile->>'ownerName') else full_name end,
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
  if changed<>1 then raise exception 'Your account profile could not be updated' using errcode='42501'; end if;
end $$;
revoke all on function public.sync_owner_contact(jsonb) from public, anon;
grant execute on function public.sync_owner_contact(jsonb) to authenticated;

-- Restore the vetted atomic website save (20261022), with two bridge changes:
-- 1. supply owner_id on service INSERT for legacy NOT NULL constraints;
-- 2. reject unlinked legacy UUID collisions rather than silently skipping them.
create or replace function public.nexora_catalog_uuid(p_salon uuid, p_kind text, p_id text)
returns uuid language sql immutable strict set search_path = pg_catalog
as $$ select case when p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then p_id::uuid else md5(p_salon::text || ':' || p_kind || ':' || p_id)::uuid end $$;

-- Canonical YouTube links are the only video source accepted by direct RPCs.
create or replace function public.nexora_website_youtube_id(p_url text)
returns text language plpgsql immutable strict set search_path=pg_catalog
as $$
declare url text := btrim(p_url); parts text[];
begin
 if url ~ '[[:space:]]' then return null; end if;
 if url ~* '^(https?://)?(www\.|m\.)?youtu\.be/' then
  parts := regexp_match(url,'^(?:https?://)?(?:www\.|m\.)?youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#]|$)','i');
 elsif url ~* '^(https?://)?(www\.)?youtube-nocookie\.com/embed/' then
  parts := regexp_match(url,'^(?:https?://)?(?:www\.)?youtube-nocookie\.com/embed/([A-Za-z0-9_-]{11})(?:[/?#]|$)','i');
 elsif url ~* '^(https?://)?(www\.|m\.|music\.|gaming\.)?youtube\.com/' then
  parts := regexp_match(url,'^(?:https?://)?(?:www\.|m\.|music\.|gaming\.)?youtube\.com/(?:shorts|embed|v|live|e)/([A-Za-z0-9_-]{11})(?:[/?#]|$)','i');
  if parts is null and url ~* '/watch\?' then parts := regexp_match(url,'[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)'); end if;
 end if;
 return parts[1];
end $$;

create or replace function public.nexora_website_image_url(p_url text)
returns boolean language sql immutable strict set search_path=pg_catalog
as $$ select p_url='' or
 (p_url ~ '^/([^/]|$)' and p_url !~ E'[\\\\\r\n]') or
 p_url ~ '^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+=*$' or
 p_url ~* '^https?://[^/@[:space:]]+([/?#].*)?$' $$;

create or replace function public.nexora_save_owner_workspace(p_state jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
 actor uuid := auth.uid(); target uuid; candidate_count integer; profile jsonb; canonical_owner_name text;
 previous jsonb; item jsonb; old_item jsonb; schedule jsonb; local_id uuid; selected_service_id uuid; normalized_slug text; effective_state jsonb; image_key text; public_profile jsonb;
 service_ids uuid[] := '{}'; staff_ids uuid[] := '{}'; days text[] := array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']; day_index integer;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_state->'profile') is distinct from 'object' then
  raise exception 'A profile object is required' using errcode='22023'; end if;
 profile := p_state->'profile';
 -- Account identity comes from the caller's own saved profile, never templates.
 -- Rename the account in Profile Settings; stale editor snapshots cannot undo it.
 select nullif(btrim(full_name),'') into canonical_owner_name
 from public.profiles where id=actor
   and lower(btrim(coalesce(full_name,''))) not in ('','user','owner','salon owner','unknown');
 if canonical_owner_name is not null then
   profile := jsonb_set(profile,'{ownerName}',to_jsonb(canonical_owner_name));
 end if;
 if octet_length(p_state::text)>8000000 or octet_length(profile::text)>4000000 then raise exception 'Website content is too large; use smaller images' using errcode='22023'; end if;
 if nullif(profile->>'ownerId','') is not null and profile->>'ownerId' <> actor::text then raise exception 'Profile belongs to another account' using errcode='42501'; end if;
 if nullif(p_state->>'ownerId','') is not null and p_state->>'ownerId' <> actor::text then raise exception 'State belongs to another account' using errcode='42501'; end if;
 -- Direct RPC and HTTP saves enforce the same operational profile fields.
 foreach image_key in array array['businessName','businessType','address','city','phone'] loop
  if jsonb_typeof(profile->image_key) is distinct from 'string' then raise exception 'PROFILE_INCOMPLETE: Operational profile fields must be text' using errcode='22023'; end if;
 end loop;
 if nullif(btrim(profile->>'businessName'),'') is null or nullif(btrim(profile->>'businessType'),'') is null
    or nullif(btrim(profile->>'address'),'') is null or nullif(btrim(profile->>'city'),'') is null
    or coalesce(profile->>'phone','') !~ '^[+0-9 ().-]+$'
    or regexp_replace(coalesce(profile->>'phone',''),'[^0-9]','','g') !~ '^[0-9]{7,15}$' then
  raise exception 'PROFILE_INCOMPLETE: Add salon name, contact number, category, address and city' using errcode='22023';
 end if;
 normalized_slug := lower(btrim(coalesce(profile->>'subdomain','')));
 if normalized_slug !~ '^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$' then raise exception 'Choose a website address of 2-63 lowercase letters, numbers or hyphens' using errcode='22023'; end if;
 profile := jsonb_set(profile,'{subdomain}',to_jsonb(normalized_slug));
 foreach image_key in array array['ownerPhotoUrl','coverImageUrl','logoUrl','socialShareImageUrl','customFaviconUrl'] loop
  if profile ? image_key and (jsonb_typeof(profile->image_key) is distinct from 'string' or not public.nexora_website_image_url(profile->>image_key)) then raise exception 'Invalid profile image URL' using errcode='22023'; end if;
 end loop;
 if profile ? 'gallery' then
  if jsonb_typeof(profile->'gallery') is distinct from 'array' then raise exception 'Invalid gallery' using errcode='22023'; end if;
  if jsonb_array_length(profile->'gallery')>100 then raise exception 'Invalid gallery' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(profile->'gallery') g where jsonb_typeof(g->'id') is distinct from 'string' or btrim(g->>'id')='' or jsonb_typeof(g->'url') is distinct from 'string' or not public.nexora_website_image_url(g->>'url')) then raise exception 'Invalid gallery image' using errcode='22023'; end if;
  if (select count(*)<>count(distinct g->>'id') from jsonb_array_elements(profile->'gallery') g) then raise exception 'Duplicate gallery IDs' using errcode='22023'; end if;
 end if;
 if profile ? 'lookbookPhotos' then
  if jsonb_typeof(profile->'lookbookPhotos') is distinct from 'array' then raise exception 'Lookbook must be an array' using errcode='22023'; end if;
  if jsonb_array_length(profile->'lookbookPhotos')>100 then raise exception 'Too many lookbook photos' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(profile->'lookbookPhotos') g where jsonb_typeof(g->'id') is distinct from 'string' or btrim(g->>'id')='' or jsonb_typeof(g->'url') is distinct from 'string' or not public.nexora_website_image_url(g->>'url')) then raise exception 'Invalid lookbook image' using errcode='22023'; end if;
  if (select count(*)<>count(distinct g->>'id') from jsonb_array_elements(profile->'lookbookPhotos') g) then raise exception 'Duplicate lookbook IDs' using errcode='22023'; end if;
 end if;
 if profile ? 'socialVideos' and jsonb_typeof(profile->'socialVideos') is distinct from 'array' then raise exception 'Videos must be an array' using errcode='22023'; end if;
 if (select count(*) from jsonb_array_elements(coalesce(profile->'socialVideos','[]')) v where v->>'categoryTag'='SHORT')>14 or
    (select count(*) from jsonb_array_elements(coalesce(profile->'socialVideos','[]')) v where v->>'categoryTag' in ('LONG','SHOWCASE'))>14 then raise exception 'Video placement limit exceeded' using errcode='22023'; end if;
 if (select count(*)<>count(distinct v->>'id') from jsonb_array_elements(coalesce(profile->'socialVideos','[]')) v) then raise exception 'Duplicate video IDs' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(coalesce(profile->'socialVideos','[]')) loop
  if jsonb_typeof(item->'id') is distinct from 'string' or nullif(btrim(item->>'id'),'') is null or nullif(btrim(item->>'title'),'') is null or coalesce(item->>'categoryTag','') not in ('SHORT','LONG','SHOWCASE') or public.nexora_website_youtube_id(item->>'youtubeUrl') is null then raise exception 'Use a valid YouTube link, title and video placement' using errcode='22023'; end if;
 end loop;
 if profile ? 'testimonials' then
  if jsonb_typeof(profile->'testimonials') is distinct from 'array' then raise exception 'Testimonials must be an array' using errcode='22023'; end if;
  if jsonb_array_length(profile->'testimonials')>100 then raise exception 'Too many testimonials' using errcode='22023'; end if;
  if (select count(*)<>count(distinct r->>'id') from jsonb_array_elements(profile->'testimonials') r) then raise exception 'Duplicate testimonial IDs' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(profile->'testimonials') loop
   if nullif(btrim(item->>'id'),'') is null or nullif(btrim(item->>'name'),'') is null or nullif(btrim(item->>'comment'),'') is null then raise exception 'Invalid testimonial' using errcode='22023'; end if;
   if jsonb_typeof(item->'rating') is distinct from 'number' or (item->>'rating')::numeric not between 1 and 5 or (item->>'rating')::numeric<>trunc((item->>'rating')::numeric) then raise exception 'Invalid testimonial rating' using errcode='22023'; end if;
   if item ? 'avatarUrl' and (jsonb_typeof(item->'avatarUrl') is distinct from 'string' or not public.nexora_website_image_url(item->>'avatarUrl')) then raise exception 'Invalid testimonial image' using errcode='22023'; end if;
  end loop;
 end if;
 -- An allowlist, not a copy of arbitrary owner JSON, becomes per-site metadata.
 select coalesce(jsonb_object_agg(key,value),'{}') into public_profile from jsonb_each(profile) where key=any(array[
  'businessType','businessName','ownerName','ownerRole','ownerBio','ownerExperience','ownerQualifications','phone','whatsapp','email','tagline','about','ownerPhotoUrl','coverImageUrl','logoUrl','themePreset','currency','subdomain','customDomain',
  'address','city','postalCode','shopFlatNo','areaLocality','state','latitude','longitude','homeService','promotionalBanner','instagramHandle','facebookPage','youtubeChannel','tiktokProfile','tiktokHandle','tiktokUrl','googleBusinessUrl','socialVideos','testimonials','gallery','sectionVisibility','sectionHeadings',
  'themeAccentKey','customAccentColor','primaryColor','secondaryColor','backgroundColor','headingStyle','buttonStyle','borderRadius','appearance','landmark','foundingYear','workingHoursMonFri','workingHoursSat','workingHoursSun','whiteLabelEnabled','offers','faviconLetter','faviconColor','customFaviconUrl','socialShareImageUrl','seoKeywords','seoTitle','seoDescription','headingFont','bodyFont','scentProfile','soundscape','consultationStyle','lookbookPhotos'
 ]);
 -- Serialize saves before reading the previous snapshot, including first save.
 perform pg_advisory_xact_lock(hashtext('owner-website-save:' || actor::text));
 if p_state ? 'services' and jsonb_typeof(p_state->'services') <> 'array' then raise exception 'services must be an array' using errcode='22023'; end if;
 if p_state ? 'stylists' and jsonb_typeof(p_state->'stylists') <> 'array' then raise exception 'stylists must be an array' using errcode='22023'; end if;
 if jsonb_array_length(coalesce(p_state->'services','[]')) > 500 or jsonb_array_length(coalesce(p_state->'stylists','[]')) > 200 then raise exception 'Catalogue too large' using errcode='22023'; end if;
 select count(*), min(id::text)::uuid into candidate_count,target from public.salons
 where id in (select public.nexora_owner_salon_ids()) and slug=profile->>'subdomain';
 if candidate_count <> 1 then
  select count(*), min(id::text)::uuid into candidate_count,target from public.salons where id in (select public.nexora_owner_salon_ids());
 end if;
 if candidate_count <> 1 then
  target := null;
  if to_regprocedure('public.owner_workspace_pick_salon()') is not null then
   execute 'select (public.owner_workspace_pick_salon() ->> ''salon_id'')::uuid' into target;
  end if;
 end if;
 if target is null or target not in (select public.nexora_owner_salon_ids()) then raise exception 'Select a salon owned by this account' using errcode='42501'; end if;
 if exists(select 1 from public.salons where lower(slug)=normalized_slug and id<>target) then raise exception 'That website address is already in use' using errcode='23505'; end if;
 perform 1 from public.salons where id=target for update;
 select state into previous from public.owner_editor_state where owner_id=actor for update;
 -- An owner can own several salons. Never retire items from their other site.
 if previous->>'salonId' is distinct from target::text and previous->'profile'->>'subdomain' is distinct from (select slug from public.salons where id=target) then
  select jsonb_build_object('profile',data->'editor_profile','services',coalesce(data->'editor_services','[]'),'stylists',coalesce(data->'editor_staff_ids','[]'),'selectedTemplateId',data->'selected_template_id') into previous from public.salons where id=target;
 end if;
 -- Existing function updates the user's contact and authorized salon contact together.
 perform public.sync_owner_contact(profile);
 update public.salons set
  name=coalesce(nullif(btrim(profile->>'businessName'),''),name),
  description=case when profile ? 'about' then profile->>'about' else description end,
  slug=normalized_slug,
  phone=profile->>'phone',
  mobile=profile->>'phone',
  whatsapp=case when profile ? 'whatsapp' then profile->>'whatsapp' else whatsapp end,
  email=case when profile ? 'email' then profile->>'email' else email end,
  address=profile->>'address', city=profile->>'city',
  state=case when profile ? 'state' then profile->>'state' else state end,
  area=case when profile ? 'areaLocality' then profile->>'areaLocality' else area end,
  pincode=case when profile ? 'postalCode' then profile->>'postalCode' else pincode end,
  landmark=case when profile ? 'landmark' then profile->>'landmark' else landmark end,
  latitude=case when profile ? 'latitude' then (profile->>'latitude')::numeric when (previous->'profile'->>'address',previous->'profile'->>'city',previous->'profile'->>'areaLocality',previous->'profile'->>'state',previous->'profile'->>'postalCode',previous->'profile'->>'shopFlatNo') is distinct from (profile->>'address',profile->>'city',profile->>'areaLocality',profile->>'state',profile->>'postalCode',profile->>'shopFlatNo') then null else latitude end,
  longitude=case when profile ? 'longitude' then (profile->>'longitude')::numeric when (previous->'profile'->>'address',previous->'profile'->>'city',previous->'profile'->>'areaLocality',previous->'profile'->>'state',previous->'profile'->>'postalCode',previous->'profile'->>'shopFlatNo') is distinct from (profile->>'address',profile->>'city',profile->>'areaLocality',profile->>'state',profile->>'postalCode',profile->>'shopFlatNo') then null else longitude end,
  data=coalesce(data,'{}') || jsonb_build_object('editor_profile',public_profile,'website_content_version',1,'selected_template_id',p_state->>'selectedTemplateId'),
  updated_at=now()
 where id=target;
 if p_state ? 'services' then
  for item in select value from jsonb_array_elements(p_state->'services') loop
   if nullif(btrim(item->>'id'),'') is null or nullif(btrim(item->>'name'),'') is null then raise exception 'Service id and name required' using errcode='22023'; end if;
   if item ? 'imageUrl' and (jsonb_typeof(item->'imageUrl') is distinct from 'string' or not public.nexora_website_image_url(item->>'imageUrl')) then raise exception 'Invalid service image URL' using errcode='22023'; end if;
   local_id := public.nexora_catalog_uuid(target,'service',item->>'id');
   if local_id=any(service_ids) then raise exception 'Duplicate service id' using errcode='22023'; end if;
   service_ids := array_append(service_ids,local_id);
   if exists(select 1 from public.services where id=local_id and salon_id is distinct from target) then raise exception 'Service belongs to another salon' using errcode='42501'; end if;
   if jsonb_typeof(item->'price') is distinct from 'number' or jsonb_typeof(item->'durationMinutes') is distinct from 'number' or (item->>'price')::numeric < 0 or (item->>'durationMinutes')::numeric <> trunc((item->>'durationMinutes')::numeric) or (item->>'durationMinutes')::numeric <= 0 then raise exception 'Invalid service price or duration' using errcode='22023'; end if;
   insert into public.services(id,salon_id,owner_id,name,description,price_paise,price,duration_minutes,is_active,is_bookable_online,is_featured,display_order)
   values(local_id,target,actor,btrim(item->>'name'),coalesce(item->>'description',''),round((item->>'price')::numeric*100)::bigint,(item->>'price')::numeric,(item->>'durationMinutes')::integer,true,true,coalesce((item->>'popular')::boolean,false),array_length(service_ids,1)-1)
   on conflict(id) do update set name=excluded.name,description=excluded.description,price_paise=excluded.price_paise,price=excluded.price,duration_minutes=excluded.duration_minutes,is_active=true,is_bookable_online=true,is_featured=excluded.is_featured,display_order=excluded.display_order,updated_at=now()
   where public.services.salon_id=target;
  end loop;
  -- Only retire entries that were part of this editor's previous saved catalogue.
  for old_item in select value from jsonb_array_elements(coalesce(previous->'services','[]')) loop
   local_id := public.nexora_catalog_uuid(target,'service',old_item->>'id');
   if not(local_id=any(service_ids)) then
    update public.services set is_active=false,is_bookable_online=false,updated_at=now() where id=local_id and salon_id=target;
    update public.staff_services set is_active=false where service_id=local_id and staff_id in (select id from public.staff where salon_id=target);
   end if;
  end loop;
 end if;
 if p_state ? 'stylists' then
  for item in select value from jsonb_array_elements(p_state->'stylists') loop
   if nullif(btrim(item->>'id'),'') is null or nullif(btrim(item->>'name'),'') is null then raise exception 'Staff id and name required' using errcode='22023'; end if;
   local_id := public.nexora_catalog_uuid(target,'staff',item->>'id');
   if local_id=any(staff_ids) then raise exception 'Duplicate staff id' using errcode='22023'; end if;
   staff_ids := array_append(staff_ids,local_id);
   if exists(select 1 from public.staff where id=local_id and salon_id is distinct from target) then raise exception 'Staff belongs to another salon' using errcode='42501'; end if;
   insert into public.staff(id,salon_id,name,full_name,role_title,phone,bio,avatar_path,profile_photo_url,is_active)
   values(local_id,target,btrim(item->>'name'),btrim(item->>'name'),item->>'role',item->>'phone',item->>'bio',item->>'avatarUrl',item->>'avatarUrl',coalesce(item->>'status','Available')<>'Inactive')
   on conflict(id) do update set name=excluded.name,full_name=excluded.full_name,role_title=excluded.role_title,phone=excluded.phone,bio=excluded.bio,avatar_path=excluded.avatar_path,profile_photo_url=excluded.profile_photo_url,is_active=excluded.is_active,updated_at=now()
   where public.staff.salon_id=target;
   if item ? 'assignedServices' then
    if jsonb_typeof(item->'assignedServices')<>'array' then raise exception 'assignedServices must be an array' using errcode='22023'; end if;
    delete from public.staff_services where staff_id=local_id;
    for selected_service_id in select public.nexora_catalog_uuid(target,'service',value) from jsonb_array_elements_text(item->'assignedServices') loop
     if not exists(select 1 from public.services where id=selected_service_id and salon_id=target) then raise exception 'Assigned service is not available in this salon' using errcode='22023'; end if;
     -- Service deletion must not fail because an older staff form still lists it.
     if exists(select 1 from public.services where id=selected_service_id and salon_id=target and not is_active) then continue; end if;
     insert into public.staff_services(staff_id,service_id,is_active) values(local_id,selected_service_id,true) on conflict(staff_id,service_id) do update set is_active=true;
    end loop;
   end if;
   if item ? 'schedule' then
    if jsonb_typeof(item->'schedule')<>'array' then raise exception 'schedule must be an array' using errcode='22023'; end if;
    delete from public.staff_schedules where staff_id=local_id;
    for schedule in select value from jsonb_array_elements(item->'schedule') loop
     day_index := array_position(days,schedule->>'day')-1;
     if day_index is null then raise exception 'Unknown schedule day' using errcode='22023'; end if;
     insert into public.staff_schedules(staff_id,day_of_week,start_time,end_time,is_working)
     values(local_id,day_index,nullif(schedule->>'fromTime','')::time,nullif(schedule->>'toTime','')::time,coalesce((schedule->>'enabled')::boolean,false));
    end loop;
   end if;
  end loop;
  for old_item in select value from jsonb_array_elements(coalesce(previous->'stylists','[]')) loop
   local_id := public.nexora_catalog_uuid(target,'staff',old_item->>'id');
   if not(local_id=any(staff_ids)) then update public.staff set is_active=false,updated_at=now() where id=local_id and salon_id=target; end if;
  end loop;
 end if;
 effective_state := (coalesce(previous,'{}') || p_state) - 'ownerId';
 effective_state := jsonb_set(effective_state,'{profile}',profile);
 effective_state := jsonb_set(effective_state,'{salonId}',to_jsonb(target::text));
 update public.salons set data=coalesce(data,'{}') || jsonb_build_object(
   'editor_services', coalesce(effective_state->'services','[]'),
   'selected_template_id',effective_state->>'selectedTemplateId',
   'editor_staff_ids',(select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id')),'[]') from jsonb_array_elements(coalesce(effective_state->'stylists','[]')))
 ) where id=target;
 insert into public.owner_editor_state(owner_id,state,updated_at) values(actor,effective_state,now())
 on conflict(owner_id) do update set state=excluded.state,updated_at=excluded.updated_at;
end $$;

-- Deployed versions may return json/jsonb rather than void. PostgreSQL
-- cannot change a function return type with CREATE OR REPLACE (42P13).
-- Replace only the API wrapper inside this transaction; never use CASCADE.
-- RESTRICT (the default) aborts safely if another object depends on it.
-- The browser/API consume the RPC error status, not its return payload.
drop function if exists public.save_owner_editor_state(jsonb);
create function public.save_owner_editor_state(p_state jsonb)
returns void language sql security invoker set search_path=pg_catalog,public
as $$ select public.nexora_save_owner_workspace(p_state) $$;
revoke all on function public.nexora_catalog_uuid(uuid,text,text) from public,anon;
revoke all on function public.nexora_save_owner_workspace(jsonb) from public,anon;
revoke all on function public.save_owner_editor_state(jsonb) from public,anon;
grant execute on function public.nexora_save_owner_workspace(jsonb),public.save_owner_editor_state(jsonb) to authenticated;

-- Caller-only hydration: full JSON round-trip, including arrays, empty values,
-- visibility flags and typography. No slug supplied by a browser authorizes it.
-- Drop only this wrapper to tolerate deployed return-type variants (no CASCADE).
drop function if exists public.get_owner_editor_state();
create function public.get_owner_editor_state()
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare actor uuid := auth.uid(); saved jsonb; owner_name text;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select state into saved from public.owner_editor_state where owner_id=actor;
 if saved is null then return null; end if;
 select nullif(btrim(full_name),'') into owner_name from public.profiles where id=actor
   and lower(btrim(coalesce(full_name,''))) not in ('','user','owner','salon owner','unknown');
 if owner_name is not null and jsonb_typeof(saved->'profile')='object' then
   saved := jsonb_set(saved,'{profile,ownerName}',to_jsonb(owner_name));
 end if;
 return saved;
end $$;
revoke all on function public.get_owner_editor_state() from public,anon;
grant execute on function public.get_owner_editor_state() to authenticated;
notify pgrst,'reload schema';
commit;
