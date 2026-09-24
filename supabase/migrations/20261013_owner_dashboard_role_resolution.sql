-- Owner dashboard access reconciliation.
-- Uses database-owned profile/membership data only; browser metadata never grants access.

begin;

create or replace function public.is_staff_dashboard_owner(target_salon_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  allowed_roles constant text[] := array[
    'owner', 'salon_owner', 'admin', 'super_admin',
    'manager', 'partner', 'growth_partner', 'nexora_partner'
  ];
  matched boolean := false;
  role_filter text := '';
  active_filter text := '';
begin
  if actor is null or target_salon_id is null then
    return false;
  end if;

  -- Normalized multi-tenant membership is the primary authority. It supports
  -- historical labels such as OWNER, NEXORA PARTNER and salon-owner without
  -- making a client-provided role part of the decision.
  if to_regclass('public.organization_members') is not null
     and to_regclass('public.salons') is not null
     and public.staff_dashboard_has_col('organization_members', 'organization_id')
     and public.staff_dashboard_has_col('organization_members', 'user_id')
     and public.staff_dashboard_has_col('salons', 'organization_id') then
    if public.staff_dashboard_has_col('organization_members', 'role') then
      role_filter := ' and regexp_replace(lower(btrim(coalesce(m.role, ''''))), ''[^a-z0-9]+'', ''_'', ''g'') = any ($3)';
    end if;
    if public.staff_dashboard_has_col('organization_members', 'status') then
      active_filter := active_filter || ' and lower(coalesce(m.status, '''')) = ''active''';
    end if;
    if public.staff_dashboard_has_col('organization_members', 'is_active') then
      active_filter := active_filter || ' and m.is_active is true';
    end if;
    execute 'select exists (
      select 1
      from public.organization_members m
      join public.salons s on s.organization_id = m.organization_id
      where s.id = $1 and m.user_id = $2' || role_filter || active_filter || ')'
      into matched using target_salon_id, actor, allowed_roles;
    if matched then return true; end if;
  end if;

  -- Some deployments still model a salon as directly owned by a user.
  if to_regclass('public.salons') is not null then
    if public.staff_dashboard_has_col('salons', 'owner_id') then
      execute 'select exists (select 1 from public.salons where id = $1 and owner_id = $2)'
        into matched using target_salon_id, actor;
      if matched then return true; end if;
    end if;
    if public.staff_dashboard_has_col('salons', 'owner_user_id') then
      execute 'select exists (select 1 from public.salons where id = $1 and owner_user_id = $2)'
        into matched using target_salon_id, actor;
      if matched then return true; end if;
    end if;
    if public.staff_dashboard_has_col('salons', 'user_id') then
      execute 'select exists (select 1 from public.salons where id = $1 and user_id = $2)'
        into matched using target_salon_id, actor;
      if matched then return true; end if;
    end if;
  end if;

  -- Legacy schema: profile.id was the salon id. If profiles has an explicit
  -- role, it must be a recognized owner/partner variant; missing role preserves
  -- the legacy single-owner model without opening another user's profile.
  if to_regclass('public.profiles') is not null
     and public.staff_dashboard_has_col('profiles', 'id') then
    if public.staff_dashboard_has_col('profiles', 'role') then
      execute 'select exists (
        select 1 from public.profiles p
        where p.id = $1 and p.id = $2
          and regexp_replace(lower(btrim(coalesce(p.role, ''''))), ''[^a-z0-9]+'', ''_'', ''g'') = any ($3)
      )' into matched using target_salon_id, actor, allowed_roles;
    else
      execute 'select exists (select 1 from public.profiles p where p.id = $1 and p.id = $2)'
        into matched using target_salon_id, actor;
    end if;
    if matched then return true; end if;
  end if;

  return false;
end;
$$;

revoke all on function public.is_staff_dashboard_owner(uuid) from public, anon;
grant execute on function public.is_staff_dashboard_owner(uuid) to authenticated;
comment on function public.is_staff_dashboard_owner(uuid) is
'Verifies the caller owns the requested salon through active organization membership or a direct legacy owner relationship. Role labels are normalized server-side; owner, manager, partner and NEXORA PARTNER variants are accepted only for the caller''s own tenant.';

notify pgrst, 'reload schema';
commit;
