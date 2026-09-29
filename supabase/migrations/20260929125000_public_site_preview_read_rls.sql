-- Public live-site reads: only published, active rows are exposed to anon.
-- The API still prefers the service-role server client. These narrowly scoped
-- policies make the anonymous fallback safe when that server credential is
-- absent, without exposing owner/editor state or inactive salons.

do $$
begin
  if to_regclass('public.salons') is not null then
    execute 'alter table public.salons enable row level security';
    execute 'grant select on table public.salons to anon, authenticated';
    execute 'drop policy if exists public_live_site_salons_read on public.salons';
    execute $policy$
      create policy public_live_site_salons_read on public.salons
      for select to anon, authenticated
      using (is_active is true and coalesce(white_label_enabled, true) is true)
    $policy$;
  end if;

  if to_regclass('public.services') is not null then
    execute 'alter table public.services enable row level security';
    execute 'grant select on table public.services to anon, authenticated';
    execute 'drop policy if exists public_live_site_services_read on public.services';
    execute $policy$
      create policy public_live_site_services_read on public.services
      for select to anon, authenticated
      using (
        is_active is true
        and coalesce(is_bookable_online, true) is true
        and exists (
          select 1 from public.salons salon
          where salon.id = services.salon_id
            and salon.is_active is true
            and coalesce(salon.white_label_enabled, true) is true
        )
      )
    $policy$;
  end if;

  if to_regclass('public.staff') is not null then
    execute 'alter table public.staff enable row level security';
    execute 'grant select on table public.staff to anon, authenticated';
    execute 'drop policy if exists public_live_site_staff_read on public.staff';
    execute $policy$
      create policy public_live_site_staff_read on public.staff
      for select to anon, authenticated
      using (
        is_active is true and is_public is true
        and exists (
          select 1 from public.salons salon
          where salon.id = staff.salon_id
            and salon.is_active is true
            and coalesce(salon.white_label_enabled, true) is true
        )
      )
    $policy$;
  end if;
end
$$;
