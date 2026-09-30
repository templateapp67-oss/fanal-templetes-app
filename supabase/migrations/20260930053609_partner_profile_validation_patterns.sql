-- Dollar-quoted PostgreSQL regex strings retain backslashes literally. Older
-- deployments (and a later profile-save migration) escaped them twice, rejecting
-- valid +country-code phones and every uploaded UUID.png path. Character classes
-- avoid SQL/regex escaping differences while preserving the deployed RPC body,
-- authorization, security mode, ownership and grants.
begin;
do $migration$
declare definition text; repaired text; escapes integer;
begin
 if to_regprocedure('public.save_my_growth_partner_profile(jsonb)') is null then
   raise exception 'Partner profile save RPC must be installed first';
 end if;
 definition:=pg_get_functiondef('public.save_my_growth_partner_profile(jsonb)'::regprocedure);
 repaired:=definition;
 for escapes in reverse 8..1 loop
   repaired:=replace(repaired,repeat(chr(92),escapes)||'+','[+]');
   repaired:=replace(repaired,repeat(chr(92),escapes)||'.','[.]');
 end loop;
 if repaired is distinct from definition then execute repaired; end if;
end $migration$;
notify pgrst,'reload schema';
commit;
