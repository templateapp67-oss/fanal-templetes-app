-- Durable self-service Growth Partner profile saving.
-- The browser always writes through this RPC with the authenticated JWT. No
-- service_role key is ever exposed to the client.

begin;

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists partner_avatar_path text;
alter table public.profiles enable row level security;

grant select, insert, update on table public.profiles to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'growth_partner_profile_read_self'
  ) then
    create policy growth_partner_profile_read_self
      on public.profiles for select to authenticated
      using ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'growth_partner_profile_insert_self'
  ) then
    create policy growth_partner_profile_insert_self
      on public.profiles for insert to authenticated
      with check ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'growth_partner_profile_update_self'
  ) then
    create policy growth_partner_profile_update_self
      on public.profiles for update to authenticated
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  end if;
end $$;

create or replace function public.save_my_growth_partner_profile(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_partner public.growth_partners := public.partner_dashboard_caller();
  v_name text;
  v_phone text;
  v_path text;
  v_exists boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in again before saving your partner profile' using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['full_name', 'phone', 'photo_path'] <> '{}'::jsonb then
    raise exception 'Only full name, phone and profile photo may be edited' using errcode = '22023';
  end if;

  if p_patch ? 'full_name' then
    v_name := btrim(p_patch->>'full_name');
    if jsonb_typeof(p_patch->'full_name') <> 'string'
       or v_name is null
       or length(v_name) not between 1 and 120
       or v_name ~ '[[:cntrl:]]' then
      raise exception 'Enter a full name of 1–120 characters' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'phone' then
    if jsonb_typeof(p_patch->'phone') not in ('string', 'null') then
      raise exception 'Invalid phone number' using errcode = '22023';
    end if;
    v_phone := nullif(regexp_replace(coalesce(p_patch->>'phone', ''), '[[:space:]().-]', '', 'g'), '');
    if v_phone is not null and v_phone !~ '^\\+?[0-9]{7,15}$' then
      raise exception 'Enter a phone number with 7–15 digits' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'photo_path' then
    if jsonb_typeof(p_patch->'photo_path') not in ('string', 'null') then
      raise exception 'Invalid profile photo' using errcode = '22023';
    end if;
    v_path := nullif(btrim(coalesce(p_patch->>'photo_path', '')), '');
    if v_path is not null then
      if v_path !~ ('^' || v_partner.user_id::text || '/[a-f0-9-]{36}\\.(jpg|png|webp)$') then
        raise exception 'Profile photo must be uploaded to your own account folder' using errcode = '22023';
      end if;
      if to_regclass('storage.objects') is null then
        raise exception 'Photo storage requires a live Supabase connection' using errcode = '22023';
      end if;
      execute 'select exists(select 1 from storage.objects where bucket_id = $1 and name = $2)'
        into v_exists using 'partner-avatars', v_path;
      if not v_exists then
        raise exception 'Upload the profile photo before saving' using errcode = '22023';
      end if;
    end if;
  end if;

  -- Provision only the caller's profile record when legacy sign-up data omitted
  -- it; all later writes stay scoped to the authenticated partner.
  insert into public.profiles (id, full_name, phone, partner_avatar_path)
  values (
    v_partner.user_id,
    coalesce(v_name, ''),
    case when p_patch ? 'phone' then v_phone else null end,
    case when p_patch ? 'photo_path' then v_path else null end
  )
  on conflict (id) do update set
    full_name = case when p_patch ? 'full_name' then excluded.full_name else public.profiles.full_name end,
    phone = case when p_patch ? 'phone' then excluded.phone else public.profiles.phone end,
    partner_avatar_path = case when p_patch ? 'photo_path' then excluded.partner_avatar_path else public.profiles.partner_avatar_path end;

  return public.get_my_growth_partner_profile();
end;
$$;

revoke all on function public.save_my_growth_partner_profile(jsonb) from public, anon;
grant execute on function public.save_my_growth_partner_profile(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
