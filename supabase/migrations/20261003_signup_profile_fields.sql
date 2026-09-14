-- ============================================================================
-- 20261003 — Signup profile fields (PHASE 2: owner signup audit & fix)
--
-- WHAT WAS WRONG
--   `handle_new_user()` (00001_init.sql:84-105) builds the new owner's
--   `profiles` row from `raw_user_meta_data ->> 'full_name'` — but the
--   onboarding sign-up form only ever sent `{ email, password }`, so every
--   account created through the funnel got:
--       full_name    = ''      (never NULL, so `full_name || fallback` in the
--                               client never even fired)
--       phone_number = NULL
--   The Template App's own `AuthModal.tsx` signup already sent `full_name`,
--   `salon_name`, `phone_number` and `city` as metadata, so the trigger was
--   correct and the onboarding gateway was simply not feeding it.
--
-- WHAT THIS DOES
--   Replaces `handle_new_user()` so it also persists `phone_number`, using a
--   value the sign-up form now sends. The column is probed rather than
--   assumed, so the migration is safe against a project whose `profiles`
--   predates 00001's full shape.
--
-- WHAT THIS DELIBERATELY DOES *NOT* DO
--   * No new table, no new signup path, no new trigger name — the existing
--     `on_auth_user_created` trigger keeps pointing at the same function.
--   * NO `profiles.role` COLUMN, and `profiles.owner_role` is NOT seeded here.
--
--     The canonical owner role in this schema is
--     `public.organization_members.role`
--       (20261002:160 — `text not null default 'owner'
--                        check (role in ('owner','manager','staff'))`),
--     resolved through `public.nexora_owner_salon_ids()`. That is what
--     `nexora_save_owner_workspace()`, `template_website_is_complete()`,
--     `server/backendContext.ts`, `server/ownerBookings.ts`,
--     `server/ownerDashboard.ts` and `server/siteLookup.ts` all consult.
--     `ensure_owner_workspace()` grants it at the handoff boundary.
--
--     `profiles.owner_role` is a DISPLAY TITLE, not a role: no RLS policy or
--     authorization check anywhere in these migrations reads it (the only
--     occurrence before this file is the column declaration at 00001:33). Its
--     source of truth is the template the owner picks
--     (`src/categoryTemplates.ts` via `mergeTemplatePreservingUserData`) and
--     the editor (`src/components/SidePanelCustomizer.tsx`), persisted by
--     `src/lib/salonSync.ts:87`. Seeding it from signup would give the field a
--     second writer and make the DB value beat the template default at
--     `src/App.tsx:762` (`ownerRole: data.owner_role || prev.ownerRole`),
--     changing every new owner's public site title until their first editor
--     save. NULL is the designed value: it falls through to the template.
--
--   * Existing rows are untouched: the trigger only fires on `auth.users`
--     INSERT, so backfilling historical owners is a separate concern.
-- ============================================================================

-- Column probe, kept local to this migration so it applies even on a project
-- where 20261002 has not been run yet.
create or replace function public.owner_signup_profiles_has_column(p_column text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = p_column
  );
$$;
revoke all on function public.owner_signup_profiles_has_column(text) from public, anon, authenticated;

do $do$
declare
  v_columns text := 'id, email, full_name';
  v_values  text := 'new.id, new.email, v_full_name';
begin
  if public.owner_signup_profiles_has_column('phone_number') then
    v_columns := v_columns || ', phone_number';
    v_values  := v_values  || ', v_phone';
  end if;

  execute format($fn$
    create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      -- '' (not NULL) keeps 00001_init's contract for full_name; phone_number
      -- stays NULL when the signup carried none.
      v_full_name text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), '');
      v_phone     text := nullif(btrim(new.raw_user_meta_data ->> 'phone_number'), '');
    begin
      insert into public.profiles (%s)
      values (%s)
      on conflict (id) do nothing;
      return new;
    end;
    $body$;
  $fn$, v_columns, v_values);

  -- Re-attach idempotently: 00001_init already created this, and replacing the
  -- function body above leaves the trigger in place. Recreating it only costs
  -- a no-op on a healthy project and repairs one that lost it.
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();
end
$do$;
