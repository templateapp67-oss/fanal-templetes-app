-- Preserve authorization/balance column restrictions; grant only editable personal fields.
do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='pincode') then
    grant update(full_name,whatsapp,pincode,city,preferred_city,avatar_url,photo_url,date_of_birth,area,preferred_area) on public.profiles to authenticated;
  else
    grant update(full_name,whatsapp,postal_code,city,owner_photo_url) on public.profiles to authenticated;
  end if;
end;
$$;
