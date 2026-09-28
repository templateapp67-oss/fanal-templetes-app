-- READ ONLY. Run this entire query in SQL Editor; returns ONE result grid.
-- Checks direct dependencies of the current atomic website save migration.
-- Does not execute a save, provision a salon, expose personal data or change RLS.
-- OK is not an end-to-end guarantee: installed function bodies, constraints,
-- triggers, types, grants and account ownership still require verification.
with functions(signature) as (values
 ('public.save_owner_editor_state(jsonb)'),
 ('public.get_owner_editor_state()'),
 ('public.nexora_save_owner_workspace(jsonb)'),
 ('public.sync_owner_contact(jsonb)'),
 ('public.nexora_owner_salon_ids()'),
 ('public.nexora_catalog_uuid(uuid,text,text)'),
 ('public.nexora_website_image_url(text)'),
 ('public.nexora_website_youtube_id(text)')
), required_tables(table_name, columns) as (values
 ('owner_editor_state', array['owner_id','state','updated_at']),
 ('salons', array['id','organization_id','slug','name','description','phone','mobile','whatsapp','email','address','city','state','area','pincode','landmark','latitude','longitude','data','updated_at']),
 ('services', array['id','salon_id','name','description','price_paise','price','duration_minutes','is_active','is_bookable_online','is_featured','display_order','updated_at']),
 ('staff', array['id','salon_id','name','full_name','role_title','phone','bio','avatar_path','profile_photo_url','is_active','updated_at']),
 ('staff_services', array['staff_id','service_id','is_active']),
 ('staff_schedules', array['staff_id','day_of_week','start_time','end_time','is_working']),
 ('profiles', array['id','full_name']),
 ('organization_members', array['organization_id','user_id','role','status'])
), checks as (
 select 'FUNCTION' as kind, signature as resource,
   case when to_regprocedure(signature) is null then 'MISSING' else 'OK' end as status
 from functions
 union all
 select 'TABLE', 'public.' || table_name,
   case when to_regclass('public.' || table_name) is null then 'MISSING' else 'OK' end
 from required_tables
 union all
 select 'COLUMN', 'public.' || t.table_name || '.' || col,
   case when exists (
     select 1 from information_schema.columns c
     where c.table_schema='public' and c.table_name=t.table_name and c.column_name=col
   ) then 'OK' else 'MISSING' end
 from required_tables t cross join lateral unnest(t.columns) as cols(col)
)
select kind, resource, status from checks
order by case when status='MISSING' then 0 else 1 end, kind, resource;
