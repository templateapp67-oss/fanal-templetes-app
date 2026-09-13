-- Basic Growth Partner profile. Partner authority is never copied from client data.
begin;
alter table public.profiles add column if not exists phone text;
-- Store a storage key, not an arbitrary external URL or embedded image data.
alter table public.profiles add column if not exists partner_avatar_path text;

create or replace function public.get_my_growth_partner_profile()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_partner public.growth_partners := public.partner_dashboard_caller();
  v_result jsonb;
begin
  select jsonb_build_object(
    'full_name',coalesce(nullif(btrim(p.full_name),''),u.raw_user_meta_data->>'full_name',''),
    'email',u.email,'phone',p.phone,'photo_path',p.partner_avatar_path,
    'partner_id',v_partner.user_id,'referral_code',v_partner.referral_code,
    'account_status',case when v_partner.is_active then 'Active' else 'Paused' end,
    'partner_role','Growth Partner','approval_status','Approved','joined_at',v_partner.created_at
  ) into v_result from auth.users u left join public.profiles p on p.id=u.id
  where u.id=v_partner.user_id;
  return v_result;
end;
$$;
revoke all on function public.get_my_growth_partner_profile() from public, anon;
grant execute on function public.get_my_growth_partner_profile() to authenticated;

create or replace function public.save_my_growth_partner_profile(p_patch jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_partner public.growth_partners := public.partner_dashboard_caller();
  v_name text;
  v_phone text;
  v_path text;
  v_exists boolean := false;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['full_name','phone','photo_path'] <> '{}'::jsonb then
    raise exception 'Only full name, phone and profile photo may be edited' using errcode='22023';
  end if;
  if p_patch ? 'full_name' then
    v_name := btrim(p_patch->>'full_name');
    if jsonb_typeof(p_patch->'full_name') <> 'string' or v_name is null
       or length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]' then
      raise exception 'Enter a full name of 1–120 characters' using errcode='22023';
    end if;
  end if;
  if p_patch ? 'phone' then
    if jsonb_typeof(p_patch->'phone') not in ('string','null') then
      raise exception 'Invalid phone number' using errcode='22023';
    end if;
    v_phone := nullif(regexp_replace(coalesce(p_patch->>'phone',''),'[[:space:]().-]','','g'),'');
    if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
      raise exception 'Enter a phone number with 7–15 digits' using errcode='22023';
    end if;
  end if;
  if p_patch ? 'photo_path' then
    if jsonb_typeof(p_patch->'photo_path') not in ('string','null') then
      raise exception 'Invalid profile photo' using errcode='22023';
    end if;
    v_path := nullif(p_patch->>'photo_path','');
    if v_path is not null then
      if v_path !~ ('^' || v_partner.user_id::text || '/[a-f0-9-]{36}\.(jpg|png|webp)$') then
        raise exception 'Profile photo must be uploaded to your own account folder' using errcode='22023';
      end if;
      if to_regclass('storage.objects') is null then
        raise exception 'Photo storage requires a live Supabase connection' using errcode='22023';
      end if;
      execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)'
        into v_exists using 'partner-avatars',v_path;
      if not v_exists then raise exception 'Upload the profile photo before saving' using errcode='22023'; end if;
    end if;
  end if;
  update public.profiles set
    full_name=case when p_patch ? 'full_name' then v_name else full_name end,
    phone=case when p_patch ? 'phone' then v_phone else phone end,
    partner_avatar_path=case when p_patch ? 'photo_path' then v_path else partner_avatar_path end
  where id=v_partner.user_id;
  if not found then raise exception 'Account profile is missing' using errcode='22023'; end if;
  return public.get_my_growth_partner_profile();
end;
$$;
revoke all on function public.save_my_growth_partner_profile(jsonb) from public, anon;
grant execute on function public.save_my_growth_partner_profile(jsonb) to authenticated;

-- Reuse the app's existing, publicly readable avatar bucket with owner-only
-- insert/delete policies. The local SQL-only gateway has no Storage service.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('partner-avatars','partner-avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
      on conflict(id) do nothing;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='partner_avatar_insert') then
      execute $policy$create policy partner_avatar_insert on storage.objects for insert to authenticated
        with check(bucket_id='partner-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text)$policy$;
    end if;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='partner_avatar_read') then
      execute $policy$create policy partner_avatar_read on storage.objects for select to authenticated
        using(bucket_id='partner-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text)$policy$;
    end if;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='partner_avatar_delete') then
      execute $policy$create policy partner_avatar_delete on storage.objects for delete to authenticated
        using(bucket_id='partner-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text)$policy$;
    end if;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
