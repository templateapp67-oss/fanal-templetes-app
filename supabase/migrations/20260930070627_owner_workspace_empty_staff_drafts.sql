-- Blank template staff rows remain editor drafts, not bookable staff records.
begin;
do $migration$
declare definition text; repaired text;
begin
 definition:=pg_get_functiondef('public.nexora_save_owner_workspace(jsonb)'::regprocedure);
 repaired:=replace(definition,
   'raise exception ''Staff name is required'' using errcode = ''22023'';',
   'continue;');
 if repaired is distinct from definition then execute repaired; end if;
end $migration$;
notify pgrst,'reload schema';
commit;
