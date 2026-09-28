-- Profiles is used directly by the signed-in web app.  Both the Data API
-- grant and the RLS policy are required: a policy alone still returns 42501.
grant select, insert, update, delete on table public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_owner on public.profiles;
drop policy if exists profiles_insert_owner on public.profiles;
drop policy if exists profiles_update_owner on public.profiles;
drop policy if exists profiles_delete_owner on public.profiles;

create policy profiles_select_owner
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_owner
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_owner
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy profiles_delete_owner
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);
