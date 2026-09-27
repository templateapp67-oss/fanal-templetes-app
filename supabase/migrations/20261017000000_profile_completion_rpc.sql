-- Additive Idempotent Migration: Profile Completion RPC for Website Editor Gate
-- Ensures authenticated users satisfy core operational profile requirements before website edits/publishing.

begin;

create or replace function public.get_my_profile_completion_status()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_org uuid;
  v_salon uuid;
  v_salon_name text;
  v_owner_name text;
  v_phone text;
  v_city text;
  v_address text;
  v_postal_code text;
  v_business_type text;
  v_is_complete boolean := true;
  v_missing_fields text[] := array[]::text[];
begin
  if actor is null then
    return jsonb_build_object(
      'isComplete', false,
      'missingFields', array['Sign in required'],
      'profile', null,
      'salonId', null,
      'organizationId', null
    );
  end if;

  -- 1. Get user profile fields dynamically from public.profiles to be resilient to column schema variations
  declare
    v_full_name_col text := 'full_name';
    v_city_col text := 'city';
    v_phone_cols text[] := array[]::text[];
    v_postal_cols text[] := array[]::text[];
    v_phone_expr text := 'null';
    v_postal_expr text := 'null';
  begin
    -- Detect full_name/name
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'name') then
      v_full_name_col := 'name';
    end if;

    -- Detect phone columns
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone') then
      v_phone_cols := array_append(v_phone_cols, 'phone');
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_number') then
      v_phone_cols := array_append(v_phone_cols, 'phone_number');
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'whatsapp') then
      v_phone_cols := array_append(v_phone_cols, 'whatsapp');
    end if;

    if array_length(v_phone_cols, 1) > 0 then
      v_phone_expr := 'coalesce(' || array_to_string(v_phone_cols, ', ') || ')';
    end if;

    -- Detect city columns
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'preferred_city') then
      v_city_col := 'preferred_city';
    end if;

    -- Detect postal columns
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'postal_code') then
      v_postal_cols := array_append(v_postal_cols, 'postal_code');
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'pincode') then
      v_postal_cols := array_append(v_postal_cols, 'pincode');
    end if;

    if array_length(v_postal_cols, 1) > 0 then
      v_postal_expr := 'coalesce(' || array_to_string(v_postal_cols, ', ') || ')';
    end if;

    execute 'select ' || quote_ident(v_full_name_col) || ', ' || v_phone_expr || ', ' || quote_ident(v_city_col) || ', ' || v_postal_expr || ' from public.profiles where id = $1'
      into v_owner_name, v_phone, v_city, v_postal_code
      using actor;
  exception when others then
    -- Fallback in case of any dynamic SQL error
    v_owner_name := null;
    v_phone := null;
    v_city := null;
    v_postal_code := null;
  end;

  -- 2. Get primary salon fields via organization_members mapping
  select m.organization_id
    into v_org
    from public.organization_members m
   where m.user_id = actor and m.role = 'owner' and m.status = 'active'
   limit 1;

  if v_org is not null then
    declare
      v_salon_phone_cols text[] := array[]::text[];
      v_salon_phone_expr text := 'null';
      v_salon_address_expr text := 'null';
      v_salon_postal_expr text := 'null';
      v_salon_phone text;
      v_salon_postal_code text;
    begin
      -- Detect salon phone columns
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'phone') then
        v_salon_phone_cols := array_append(v_salon_phone_cols, 'phone');
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'mobile') then
        v_salon_phone_cols := array_append(v_salon_phone_cols, 'mobile');
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'whatsapp') then
        v_salon_phone_cols := array_append(v_salon_phone_cols, 'whatsapp');
      end if;

      if array_length(v_salon_phone_cols, 1) > 0 then
        v_salon_phone_expr := 'coalesce(' || array_to_string(v_salon_phone_cols, ', ') || ')';
      end if;

      -- Detect salon address column
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'address') then
        v_salon_address_expr := 'address';
      else
        v_salon_address_expr := 'coalesce(data->''editor_profile''->>''address'', data->>>''address'', ''Not provided'')';
      end if;

      -- Detect salon postal_code or postalCode
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'postal_code') then
        v_salon_postal_expr := 'postal_code';
      elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'postalCode') then
        v_salon_postal_expr := 'postalCode';
      else
        v_salon_postal_expr := 'coalesce(data->''editor_profile''->>''postalCode'', data->''editor_profile''->>''postal_code'')';
      end if;

      execute 'select id, name, ' || v_salon_phone_expr || ', ' ||
              'coalesce(data->''editor_profile''->>''businessType'', data->>''businessType''), ' ||
              v_salon_address_expr || ', ' || v_salon_postal_expr || ' ' ||
              'from public.salons ' ||
              'where organization_id = $1 and deleted_at is null ' ||
              'limit 1'
        into v_salon, v_salon_name, v_salon_phone, v_business_type, v_address, v_salon_postal_code
        using v_org;

      v_phone := coalesce(nullif(v_phone, ''), nullif(v_salon_phone, ''));
      v_postal_code := coalesce(nullif(v_postal_code, ''), nullif(v_salon_postal_code, ''));
    exception when others then
      raise notice 'SALONS QUERY EXCEPTION: %, SQLSTATE %', sqlerrm, sqlstate;
      -- Fallback in case of salons query failure
      v_salon := null;
      v_salon_name := null;
    end;
  end if;

  -- 3. Hydrate from user metadata fallback if still missing
  if v_owner_name is null or btrim(v_owner_name) = '' then
    v_owner_name := (select full_name from public.profiles where id = actor);
  end if;

  -- 4. Enforce strict required-field definition
  -- Full Name / Owner Name
  if v_owner_name is null or btrim(v_owner_name) = '' then
    v_is_complete := false;
    v_missing_fields := array_append(v_missing_fields, 'ownerName');
  end if;

  -- Salon / Business Name
  if v_salon_name is null or btrim(v_salon_name) = '' then
    v_is_complete := false;
    v_missing_fields := array_append(v_missing_fields, 'businessName');
  end if;

  -- Phone Number / Mobile
  if v_phone is null or btrim(v_phone) = '' or length(btrim(v_phone)) < 7 then
    v_is_complete := false;
    v_missing_fields := array_append(v_missing_fields, 'phone');
  end if;

  -- City / Location
  if v_city is null or btrim(v_city) = '' then
    v_is_complete := false;
    v_missing_fields := array_append(v_missing_fields, 'city');
  end if;

  return jsonb_build_object(
    'isComplete', v_is_complete,
    'missingFields', to_jsonb(v_missing_fields),
    'salonId', v_salon,
    'organizationId', v_org,
    'profile', jsonb_build_object(
      'ownerName', coalesce(v_owner_name, ''),
      'businessName', coalesce(v_salon_name, ''),
      'phone', coalesce(v_phone, ''),
      'city', coalesce(v_city, ''),
      'address', coalesce(v_address, ''),
      'postalCode', coalesce(v_postal_code, ''),
      'businessType', coalesce(v_business_type, 'hair_salon')
    )
  );
end;
$$;

revoke all on function public.get_my_profile_completion_status() from public, anon;
grant execute on function public.get_my_profile_completion_status() to authenticated;

commit;
