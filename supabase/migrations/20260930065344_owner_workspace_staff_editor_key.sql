-- Legacy workspace RPCs insert staff.id but omit the required editor_key.
-- Derive the missing key from the persisted row identity without weakening
-- NOT NULL/unique constraints or changing explicit editor keys and RLS.
begin;
create or replace function public.nexora_fill_staff_editor_key()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if nullif(btrim(new.editor_key),'') is null then
   new.editor_key:=new.id::text;
 end if;
 return new;
end;
$$;
revoke all on function public.nexora_fill_staff_editor_key() from public,anon,authenticated;
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='staff' and column_name='editor_key') then
   drop trigger if exists nexora_staff_editor_key_before_insert on public.staff;
   create trigger nexora_staff_editor_key_before_insert before insert on public.staff
   for each row execute function public.nexora_fill_staff_editor_key();
 end if;
end $$;
notify pgrst,'reload schema';
commit;
