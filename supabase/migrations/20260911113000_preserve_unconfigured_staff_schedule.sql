do $$ declare definition text; old_clause text := 'if item ? ''schedule'' then'; new_clause text := 'if item ? ''schedule'' and item->''schedule'' <> ''[]''::jsonb then'; begin
select pg_get_functiondef('public.nexora_save_owner_workspace(jsonb)'::regprocedure) into definition;
if strpos(definition,new_clause)=0 then
 if strpos(definition,old_clause)=0 then raise exception 'Schedule clause changed';end if;
 execute replace(definition,old_clause,new_clause);
end if;
end;$$;
notify pgrst,'reload schema';
