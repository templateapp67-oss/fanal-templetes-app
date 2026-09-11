-- Reconcile the inspected orphan public duplicate with the actual salon owner.
-- Preserve all rows/history; abort if ownership or matching contacts changed.
do $$
declare canonical public.salons%rowtype; duplicate public.salons%rowtype;
begin
 select * into canonical from public.salons where id='96e8fed2-9581-4c6f-bb9c-3c86deb941e0' for update;
 select * into duplicate from public.salons where id='c3d45232-4519-4106-9d76-4814df9cc626' for update;
 if canonical.slug='arts-by-uma' and duplicate.slug='archived-arts-by-uma-c3d45232' then return;end if;
 if canonical.slug<>'cors-studio-2' or duplicate.slug<>'arts-by-uma' or canonical.email is distinct from duplicate.email or canonical.phone is distinct from duplicate.phone or nullif(canonical.email,'') is null then raise exception 'Salon identities changed; reconciliation aborted';end if;
 if not exists(select 1 from public.organization_members where organization_id=canonical.organization_id and user_id='5a900556-605a-4501-9655-a332f7339a34' and role='owner' and status='active') then raise exception 'Expected owner missing';end if;
 if exists(select 1 from public.organization_members where organization_id=duplicate.organization_id) or exists(select 1 from public.bookings where salon_id=duplicate.id) then raise exception 'Duplicate has membership or bookings; manual review required';end if;
 update public.salons set slug='archived-arts-by-uma-c3d45232',is_active=false,accepts_online_bookings=false where id=duplicate.id;
 update public.salons set slug='arts-by-uma',verified=duplicate.verified,accepts_online_bookings=duplicate.accepts_online_bookings where id=canonical.id;
end;$$;
notify pgrst,'reload schema';
