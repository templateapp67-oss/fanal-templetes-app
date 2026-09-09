-- Exercise the live RLS/RPC path; roll back every test write in a subtransaction.
do $$
declare actor uuid; result jsonb; verified boolean := false; denied boolean := false;
begin
  select id into actor from public.profiles limit 1;
  if actor is null then raise notice 'No existing profile: live rollback test skipped'; return; end if;
  begin
    perform set_config('request.jwt.claim.sub',actor::text,true);
    set local role authenticated;
    perform public.save_partner_profile('Profile verification','+919845077654','560038','Bengaluru','https://example.com/test-avatar.webp','1992-06-15','Test locality',false);
    result := public.get_partner_profile();
    if result->>'name' <> 'Profile verification' or result->>'postal' <> '560038'
       or result->>'dob' <> '1992-06-15' or result->>'notifications' <> 'false' then
      raise exception 'Profile save/reload verification failed';
    end if;
    begin
      perform public.save_partner_profile('Invalid','+919845077654','000000','Bengaluru','https://example.com/test-avatar.webp','1992-06-15','Test locality',false);
    exception when others then
      if sqlerrm <> 'Invalid profile fields' then raise; end if;
      denied := true;
    end;
    if not denied then raise exception 'Invalid PIN was accepted'; end if;
    if exists(select 1 from public.partner_settings where owner_id<>actor) then raise exception 'Cross-owner settings exposed'; end if;
    if has_function_privilege('anon','public.get_partner_profile()','EXECUTE') then raise exception 'Anonymous read allowed'; end if;
    verified := true;
    raise exception using errcode='ZP001',message='Rollback successful verification writes';
  exception when sqlstate 'ZP001' then null;
  end;
  if not verified then raise exception 'Verification did not complete'; end if;
end;
$$;
