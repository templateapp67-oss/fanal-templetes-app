-- Generic owner-name repair. Never hardcodes an account, email or salon.
-- profiles.id is the Auth user FK in this deployment. user_id is not used
-- as an alternative: conflicting aliases must never select another identity.
begin;

create or replace function public.nexora_real_profile_name(value text)
returns text language sql immutable set search_path = pg_catalog
as $$
  select case when lower(btrim(coalesce(value,''))) in
    ('','user','owner','salon owner','unknown') then null else btrim(value) end
$$;

create or replace function public.nexora_guard_profile_owner_name()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare candidate text;
begin
  candidate := public.nexora_real_profile_name(new.full_name);
  if candidate is not null then
    new.full_name := candidate;
    return new;
  end if;
  -- A stale editor snapshot must not erase an already-saved real name.
  if tg_op = 'UPDATE' then
    candidate := public.nexora_real_profile_name(old.full_name);
  end if;
  if candidate is null then
    select coalesce(
      public.nexora_real_profile_name(u.raw_user_meta_data->>'full_name'),
      public.nexora_real_profile_name(u.raw_user_meta_data->>'name')
    ) into candidate from auth.users u where u.id = new.id;
  end if;
  -- No real name available? Leave the field empty for the user to complete.
  -- Do not invent a name from their email or business name.
  new.full_name := candidate;
  return new;
end
$$;
revoke all on function public.nexora_guard_profile_owner_name() from public;

drop trigger if exists nexora_profile_owner_name_guard on public.profiles;
create trigger nexora_profile_owner_name_guard
before insert or update of full_name on public.profiles
for each row execute function public.nexora_guard_profile_owner_name();

-- Existing placeholders are repaired only from the SAME user's Auth metadata.
-- Real names are untouched. Accounts without a usable source stay unchanged
-- until their next profile write (the UI asks them to enter their real name).
update public.profiles p
set full_name = coalesce(
  public.nexora_real_profile_name(u.raw_user_meta_data->>'full_name'),
  public.nexora_real_profile_name(u.raw_user_meta_data->>'name')
)
from auth.users u
where u.id = p.id
  and public.nexora_real_profile_name(p.full_name) is null
  and coalesce(
    public.nexora_real_profile_name(u.raw_user_meta_data->>'full_name'),
    public.nexora_real_profile_name(u.raw_user_meta_data->>'name')
  ) is not null;

notify pgrst, 'reload schema';
commit;
