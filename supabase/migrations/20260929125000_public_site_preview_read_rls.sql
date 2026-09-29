-- Public live-site reads: only published, active rows are exposed to anon.
-- The API still prefers the service-role server client. These narrowly scoped
-- policies make the anonymous fallback safe when that server credential is
-- absent, without exposing owner/editor state or inactive salons.

do $$
declare
  salon_predicate text;
  service_predicate text;
  staff_predicate text;
begin
  if to_regclass('public.salons') is not null then
    execute 'alter table public.salons enable row level security';
    execute 'grant select on table public.salons to anon, authenticated';
    execute 'drop policy if exists public_live_site_salons_read on public.salons';
    salon_predicate := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'is_active') then 'is_active is true' else 'true' end;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'salons' and column_name = 'white_label_enabled') then
      salon_predicate := salon_predicate || ' and coalesce(white_label_enabled, true) is true';
    end if;
    execute format('create policy public_live_site_salons_read on public.salons for select to anon, authenticated using (%s)', salon_predicate);
  end if;

  if to_regclass('public.services') is not null then
    execute 'alter table public.services enable row level security';
    execute 'grant select on table public.services to anon, authenticated';
    execute 'drop policy if exists public_live_site_services_read on public.services';
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'salon_id') then
      service_predicate := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'is_active') then 'is_active is true' else 'true' end;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'is_bookable_online') then service_predicate := service_predicate || ' and coalesce(is_bookable_online, true) is true'; end if;
      execute format('create policy public_live_site_services_read on public.services for select to anon, authenticated using ((%s) and exists (select 1 from public.salons salon where salon.id = services.salon_id and (%s)))', service_predicate, salon_predicate);
    end if;
  end if;

  if to_regclass('public.staff') is not null then
    execute 'alter table public.staff enable row level security';
    execute 'grant select on table public.staff to anon, authenticated';
    execute 'drop policy if exists public_live_site_staff_read on public.staff';
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'salon_id') then
      staff_predicate := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'is_active') then 'is_active is true' else 'true' end;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'is_public') then staff_predicate := staff_predicate || ' and is_public is true'; end if;
      execute format('create policy public_live_site_staff_read on public.staff for select to anon, authenticated using ((%s) and exists (select 1 from public.salons salon where salon.id = staff.salon_id and (%s)))', staff_predicate, salon_predicate);
    end if;
  end if;
end
$$;
