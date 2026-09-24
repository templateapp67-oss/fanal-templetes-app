-- Unified owner website provisioning: one owner-scoped, idempotent setup RPC.
-- The caller identity is always auth.uid(); no user_id or organization_id is accepted.

begin;

create or replace function public.provision_my_website(
  p_salon_name text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  workspace jsonb;
  target_salon uuid;
  target_org uuid;
  normalized_name text := nullif(btrim(coalesce(p_salon_name, '')), '');
  normalized_slug text := lower(regexp_replace(btrim(coalesce(p_slug, '')), '[^a-z0-9]+', '-', 'g'));
  owned_count integer := 0;
  conflicting_salon uuid;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if normalized_name is null or char_length(normalized_name) < 2 or char_length(normalized_name) > 120 then
    raise exception 'Enter a business name between 2 and 120 characters' using errcode = '22023';
  end if;
  normalized_slug := trim(both '-' from normalized_slug);
  if normalized_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'Choose a valid website address (2-63 lowercase letters, numbers or hyphens)' using errcode = '22023';
  end if;

  -- Serialize each owner's first setup. ensure_owner_workspace is itself
  -- idempotent and creates at most one organization/membership/salon.
  perform pg_advisory_xact_lock(hashtext('owner-website:' || actor::text));
  workspace := public.ensure_owner_workspace();
  target_salon := nullif(workspace->>'salon_id', '')::uuid;
  target_org := nullif(workspace->>'organization_id', '')::uuid;
  if target_salon is null or target_org is null then
    raise exception 'Your website workspace could not be prepared. Please retry.' using errcode = 'P0001';
  end if;

  select count(*) into owned_count
  from public.salons s
  where s.id in (select public.nexora_owner_salon_ids());

  -- Setup only ever renames the caller's single initial workspace. If the
  -- caller already has multiple sites, this avoids silently changing another
  -- website and never creates a duplicate record.
  if owned_count > 1 then
    raise exception 'Choose the website you want to edit from your dashboard' using errcode = 'P0001';
  end if;

  select s.id into conflicting_salon
  from public.salons s
  where lower(s.slug) = normalized_slug
    and s.id <> target_salon
  limit 1;
  if conflicting_salon is not null then
    raise exception 'That website address is already in use. Try another one.' using errcode = '23505';
  end if;

  update public.salons
     set name = normalized_name,
         slug = normalized_slug
   where id = target_salon
     and id in (select public.nexora_owner_salon_ids());

  if not found then
    raise exception 'You do not have access to this website' using errcode = '42501';
  end if;

  -- Keep the user's primary business name in sync when those optional profile
  -- columns exist. This does not insert another profile row.
  if to_regclass('public.profiles') is not null then
    if public.owner_workspace_has_column('profiles', 'salon_name') then
      execute 'update public.profiles set salon_name = $1 where id = $2' using normalized_name, actor;
    elsif public.owner_workspace_has_column('profiles', 'business_name') then
      execute 'update public.profiles set business_name = $1 where id = $2' using normalized_name, actor;
    end if;
  end if;

  return jsonb_build_object(
    'salon_id', target_salon,
    'organization_id', target_org,
    'slug', normalized_slug,
    'name', normalized_name
  );
end;
$$;

revoke all on function public.provision_my_website(text, text) from public, anon;
grant execute on function public.provision_my_website(text, text) to authenticated;
comment on function public.provision_my_website(text, text) is
'Idempotently names the signed-in owner''s single initial workspace. auth.uid() is the only identity input; it refuses multi-site mutation and never inserts duplicate profiles or salons.';

notify pgrst, 'reload schema';
commit;
