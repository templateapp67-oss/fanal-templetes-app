-- Canonical owner workspace transaction for the EXISTING normalized database.
-- No tables/data are dropped. Every write is restricted to auth.uid() and its salons.
begin;
create or replace function public.nexora_catalog_uuid(p_salon uuid, p_kind text, p_id text)
returns uuid language sql immutable strict set search_path = pg_catalog
as $$ select case when p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then p_id::uuid else md5(p_salon::text || ':' || p_kind || ':' || p_id)::uuid end $$;

create or replace function public.nexora_save_owner_workspace(p_state jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
 actor uuid := auth.uid(); target uuid; candidate_count integer; profile jsonb;
 previous jsonb; item jsonb; old_item jsonb; schedule jsonb; local_id uuid; selected_service_id uuid;
 service_ids uuid[] := '{}'; staff_ids uuid[] := '{}'; days text[] := array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']; day_index integer;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_state->'profile') <> 'object' then
  raise exception 'A profile object is required' using errcode='22023'; end if;
 profile := p_state->'profile';
 if p_state ? 'services' and jsonb_typeof(p_state->'services') <> 'array' then raise exception 'services must be an array' using errcode='22023'; end if;
 if p_state ? 'stylists' and jsonb_typeof(p_state->'stylists') <> 'array' then raise exception 'stylists must be an array' using errcode='22023'; end if;
 if jsonb_array_length(coalesce(p_state->'services','[]')) > 500 or jsonb_array_length(coalesce(p_state->'stylists','[]')) > 200 then raise exception 'Catalogue too large' using errcode='22023'; end if;
 select count(*), min(id::text)::uuid into candidate_count,target from public.salons
 where id in (select public.nexora_owner_salon_ids()) and slug=profile->>'subdomain';
 if candidate_count <> 1 then
  select count(*), min(id::text)::uuid into candidate_count,target from public.salons where id in (select public.nexora_owner_salon_ids());
 end if;
 if candidate_count <> 1 then raise exception 'Select a salon owned by this account' using errcode='42501'; end if;
 perform 1 from public.salons where id=target for update;
 select state into previous from public.owner_editor_state where owner_id=actor for update;
 -- Existing function updates the user's contact and authorized salon contact together.
 perform public.sync_owner_contact(profile);
 update public.salons set
  name=coalesce(nullif(btrim(profile->>'businessName'),''),name),
  description=case when profile ? 'about' then profile->>'about' else description end,
  data=coalesce(data,'{}') || jsonb_build_object('editor_profile',profile-array['ownerId','dob','dateOfBirth','date_of_birth']),
  updated_at=now()
 where id=target;
 if p_state ? 'services' then
  for item in select value from jsonb_array_elements(p_state->'services') loop
   if nullif(btrim(item->>'id'),'') is null or nullif(btrim(item->>'name'),'') is null then raise exception 'Service id and name required' using errcode='22023'; end if;
   local_id := public.nexora_catalog_uuid(target,'service',item->>'id');
   if local_id=any(service_ids) then raise exception 'Duplicate service id' using errcode='22023'; end if;
   service_ids := array_append(service_ids,local_id);
   if exists(select 1 from public.services where id=local_id and salon_id<>target) then raise exception 'Service belongs to another salon' using errcode='42501'; end if;
   if (item->>'price')::numeric < 0 or (item->>'durationMinutes')::integer <= 0 then raise exception 'Invalid service price or duration' using errcode='22023'; end if;
   insert into public.services(id,salon_id,name,description,price_paise,price,duration_minutes,is_active,is_bookable_online,is_featured,display_order)
   values(local_id,target,btrim(item->>'name'),coalesce(item->>'description',''),round((item->>'price')::numeric*100)::bigint,(item->>'price')::numeric,(item->>'durationMinutes')::integer,true,true,coalesce((item->>'popular')::boolean,false),array_length(service_ids,1)-1)
   on conflict(id) do update set name=excluded.name,description=excluded.description,price_paise=excluded.price_paise,price=excluded.price,duration_minutes=excluded.duration_minutes,is_active=true,is_featured=excluded.is_featured,display_order=excluded.display_order,updated_at=now()
   where public.services.salon_id=target;
  end loop;
  -- Only retire entries that were part of this editor's previous saved catalogue.
  for old_item in select value from jsonb_array_elements(coalesce(previous->'services','[]')) loop
   local_id := public.nexora_catalog_uuid(target,'service',old_item->>'id');
   if not(local_id=any(service_ids)) then update public.services set is_active=false,is_bookable_online=false,updated_at=now() where id=local_id and salon_id=target; end if;
  end loop;
 end if;
 if p_state ? 'stylists' then
  for item in select value from jsonb_array_elements(p_state->'stylists') loop
   if nullif(btrim(item->>'id'),'') is null or nullif(btrim(item->>'name'),'') is null then raise exception 'Staff id and name required' using errcode='22023'; end if;
   local_id := public.nexora_catalog_uuid(target,'staff',item->>'id');
   if local_id=any(staff_ids) then raise exception 'Duplicate staff id' using errcode='22023'; end if;
   staff_ids := array_append(staff_ids,local_id);
   if exists(select 1 from public.staff where id=local_id and salon_id<>target) then raise exception 'Staff belongs to another salon' using errcode='42501'; end if;
   insert into public.staff(id,salon_id,name,full_name,role_title,phone,bio,avatar_path,profile_photo_url,is_active)
   values(local_id,target,btrim(item->>'name'),btrim(item->>'name'),item->>'role',item->>'phone',item->>'bio',item->>'avatarUrl',item->>'avatarUrl',coalesce(item->>'status','Available')<>'Inactive')
   on conflict(id) do update set name=excluded.name,full_name=excluded.full_name,role_title=excluded.role_title,phone=excluded.phone,bio=excluded.bio,avatar_path=excluded.avatar_path,profile_photo_url=excluded.profile_photo_url,is_active=excluded.is_active,updated_at=now()
   where public.staff.salon_id=target;
   if item ? 'assignedServices' then
    if jsonb_typeof(item->'assignedServices')<>'array' then raise exception 'assignedServices must be an array' using errcode='22023'; end if;
    delete from public.staff_services where staff_id=local_id;
    for selected_service_id in select public.nexora_catalog_uuid(target,'service',value) from jsonb_array_elements_text(item->'assignedServices') loop
     if not exists(select 1 from public.services where id=selected_service_id and salon_id=target and is_active) then raise exception 'Assigned service is not available in this salon' using errcode='22023'; end if;
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
 insert into public.owner_editor_state(owner_id,state,updated_at) values(actor,coalesce(previous,'{}') || p_state,now())
 on conflict(owner_id) do update set state=excluded.state,updated_at=excluded.updated_at;
end $$;

create or replace function public.save_owner_editor_state(p_state jsonb)
returns void language sql security invoker set search_path=pg_catalog,public
as $$ select public.nexora_save_owner_workspace(p_state) $$;
revoke all on function public.nexora_catalog_uuid(uuid,text,text) from public,anon;
revoke all on function public.nexora_save_owner_workspace(jsonb) from public,anon;
revoke all on function public.save_owner_editor_state(jsonb) from public,anon;
grant execute on function public.nexora_save_owner_workspace(jsonb),public.save_owner_editor_state(jsonb) to authenticated;

-- Prior compatibility migrations added a second staff FK to the empty salon_staff
-- table. Keep the original FK to public.staff and remove only contradictory FKs.
do $$ declare fk record; begin
 if exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass and confrelid='public.staff'::regclass and contype='f') then
  for fk in select conname from pg_constraint where conrelid='public.bookings'::regclass and confrelid='public.salon_staff'::regclass and contype='f' loop
   execute format('alter table public.bookings drop constraint %I',fk.conname);
  end loop;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
