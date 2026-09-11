do $$ declare definition text; marker text:='where public.staff.salon_id=target;'; addition text:='where public.staff.salon_id=target;
   update public.staff set is_public=is_active where id=local_id and salon_id=target;';
begin
 select pg_get_functiondef('public.nexora_save_owner_workspace(jsonb)'::regprocedure) into definition;
 if strpos(definition,addition)=0 then
  if strpos(definition,marker)=0 then raise exception 'Workspace function changed; no visibility changes applied';end if;
  execute replace(definition,marker,addition);
 end if;
end;$$;
-- Only staff explicitly present in this owner's website catalogue are published.
update public.staff st set is_public=st.is_active
from public.owner_editor_state editor, lateral jsonb_array_elements(coalesce(editor.state->'stylists','[]'::jsonb)) item
where editor.owner_id='5a900556-605a-4501-9655-a332f7339a34'
and st.salon_id='96e8fed2-9581-4c6f-bb9c-3c86deb941e0'
and st.id=public.nexora_catalog_uuid(st.salon_id,'staff',item->>'id');
notify pgrst,'reload schema';
