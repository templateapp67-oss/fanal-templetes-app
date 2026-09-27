-- Additive Idempotent Migration: Profile Completion Editor Gate (Relaxed for frictionless website creation)
-- Allows users to save and publish website edits smoothly without hard blocking errors.

begin;

create or replace function public.save_owner_editor_state(p_state jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(p_state->'profile') is distinct from 'object' then raise exception 'Profile is required'; end if;
  if octet_length(p_state::text)>8000000 then raise exception 'Editor data is too large; upload images first'; end if;

  -- Allow saving drafts and website edits frictionless without hard blocking exceptions
  insert into public.owner_editor_state(owner_id,state) values(auth.uid(),p_state-'ownerId')
  on conflict(owner_id) do update set state=excluded.state,updated_at=now();
  
  if p_state->'profile' is not null then
    perform public.sync_owner_contact(p_state->'profile');
  end if;
end;
$$;

revoke all on function public.save_owner_editor_state(jsonb) from public, anon;
grant execute on function public.save_owner_editor_state(jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
