-- Keep Auth user creation independent from optional profile/referral data.
-- The previous trigger could make `auth.signUp()` fail whenever a profile
-- schema/constraint drifted. Referral attribution remains token-based in
-- `trg_signup_growth_referral`; this trigger never resolves raw referral code.
do $do$
declare
  v_columns text := 'id, email, full_name';
  v_values text := 'new.id, new.email, v_full_name';
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_number') then
    v_columns := v_columns || ', phone_number';
    v_values := v_values || ', v_phone';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'salon_name') then
    v_columns := v_columns || ', salon_name';
    v_values := v_values || ', v_salon_name';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'city') then
    v_columns := v_columns || ', city';
    v_values := v_values || ', v_city';
  end if;

  execute format($fn$
    create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, public, pg_temp
    as $body$
    declare
      v_full_name text := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), ''), 120);
      v_phone text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'phone_number', new.raw_user_meta_data ->> 'phone', '')), 32), '');
      v_salon_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'salon_name', '')), 160), '');
      v_city text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'city', '')), 120), '');
    begin
      begin
        insert into public.profiles (%s)
        values (%s)
        on conflict (id) do nothing;
      exception when others then
        -- Never reject a valid Auth signup because an optional profile write
        -- drifted. The warning includes SQLSTATE for operator diagnosis.
        raise warning 'handle_new_user profile creation skipped (%%): %%', SQLSTATE, SQLERRM;
      end;
      return new;
    end;
    $body$;
  $fn$, v_columns, v_values);

  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
end
$do$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
notify pgrst, 'reload schema';
