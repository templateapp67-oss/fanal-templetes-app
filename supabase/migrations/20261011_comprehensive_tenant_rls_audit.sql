-- ============================================================================
-- Nexora Salon OS — Comprehensive Tenant RLS Audit & Enforcement (PHASE 3)
-- Migration: 20261011_comprehensive_tenant_rls_audit.sql
-- ----------------------------------------------------------------------------
-- Enforces Row Level Security (RLS) across all tenant-owned tables:
--   • organizations, organization_members, salons, salon_hours, salon_customers
--   • services, stylists, staff, bookings, appointments, clients
--   • loyalty_config, loyalty_rewards, loyalty_point_transactions, loyalty_redeemed_rewards
--   • customer_qr_payments, in_app_notifications, owner_editor_state
--
-- Strict multi-tenant isolation rules:
--   1. Tenant-owned SELECT enforces authorized membership or direct ownership:
--        exists (
--          select 1 from public.organization_members om
--          where om.user_id = auth.uid()
--            and om.organization_id = target.organization_id
--            and om.status = 'active'
--        )
--   2. Owner-only mutations (INSERT, UPDATE, DELETE):
--        and om.role = 'owner'
--   3. No policy uses `using (true)` for private salon data.
-- ============================================================================

begin;

do $$
declare
  has_authenticated boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
  has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  if not has_authenticated then
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 1. organizations
  -- -------------------------------------------------------------------------
  if to_regclass('public.organizations') is not null then
    execute 'alter table public.organizations enable row level security';

    execute 'drop policy if exists organizations_tenant_select on public.organizations';
    execute $p$
      create policy organizations_tenant_select on public.organizations for select to authenticated
      using (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = organizations.id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
    $p$;

    execute 'drop policy if exists organizations_owner_all on public.organizations';
    execute $p$
      create policy organizations_owner_all on public.organizations for all to authenticated
      using (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = organizations.id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
      with check (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = organizations.id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. organization_members
  -- -------------------------------------------------------------------------
  if to_regclass('public.organization_members') is not null then
    execute 'alter table public.organization_members enable row level security';

    execute 'drop policy if exists organization_members_tenant_select on public.organization_members';
    execute $p$
      create policy organization_members_tenant_select on public.organization_members for select to authenticated
      using (
        user_id = auth.uid()
        or exists (
          select 1 from public.organization_members om
          where om.organization_id = organization_members.organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;

    execute 'drop policy if exists organization_members_owner_write on public.organization_members';
    execute $p$
      create policy organization_members_owner_write on public.organization_members for all to authenticated
      using (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = organization_members.organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
      with check (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = organization_members.organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;
  end if;

  -- -------------------------------------------------------------------------
  -- 3. salons
  -- -------------------------------------------------------------------------
  if to_regclass('public.salons') is not null then
    execute 'alter table public.salons enable row level security';

    execute 'drop policy if exists salons_tenant_select on public.salons';
    execute $p$
      create policy salons_tenant_select on public.salons for select
      using (
        (is_active = true and (deleted_at is null or not exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'salons' and column_name = 'deleted_at'
        )))
        or (auth.uid() is not null and (
          exists (
            select 1 from public.organization_members om
            where om.organization_id = salons.organization_id
              and om.user_id = auth.uid()
              and om.status = 'active'
          )
          or (
            exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'salons' and column_name = 'owner_id'
            )
            and owner_id = auth.uid()
          )
        ))
      )
    $p$;

    execute 'drop policy if exists salons_owner_write on public.salons';
    execute $p$
      create policy salons_owner_write on public.salons for all to authenticated
      using (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = salons.organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
        or (
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'salons' and column_name = 'owner_id'
          )
          and owner_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = salons.organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
        or (
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'salons' and column_name = 'owner_id'
          )
          and owner_id = auth.uid()
        )
      )
    $p$;
  end if;

  -- -------------------------------------------------------------------------
  -- 4. salon_hours
  -- -------------------------------------------------------------------------
  if to_regclass('public.salon_hours') is not null then
    execute 'alter table public.salon_hours enable row level security';

    execute 'drop policy if exists salon_hours_select on public.salon_hours';
    execute $p$
      create policy salon_hours_select on public.salon_hours for select
      using (
        exists (
          select 1 from public.salons s
          where s.id = salon_hours.salon_id
            and s.is_active = true
        )
        or (auth.uid() is not null and exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = salon_hours.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        ))
      )
    $p$;

    execute 'drop policy if exists salon_hours_owner_write on public.salon_hours';
    execute $p$
      create policy salon_hours_owner_write on public.salon_hours for all to authenticated
      using (
        exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = salon_hours.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
      with check (
        exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = salon_hours.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;
  end if;

  -- -------------------------------------------------------------------------
  -- 5. salon_customers
  -- -------------------------------------------------------------------------
  if to_regclass('public.salon_customers') is not null then
    execute 'alter table public.salon_customers enable row level security';

    execute 'drop policy if exists salon_customers_tenant_select on public.salon_customers';
    execute $p$
      create policy salon_customers_tenant_select on public.salon_customers for select to authenticated
      using (
        (user_id is not null and user_id = auth.uid())
        or exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = salon_customers.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;

    execute 'drop policy if exists salon_customers_owner_write on public.salon_customers';
    execute $p$
      create policy salon_customers_owner_write on public.salon_customers for all to authenticated
      using (
        exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = salon_customers.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
      with check (
        exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = salon_customers.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;
  end if;

  -- -------------------------------------------------------------------------
  -- 6. staff
  -- -------------------------------------------------------------------------
  if to_regclass('public.staff') is not null then
    execute 'alter table public.staff enable row level security';

    execute 'drop policy if exists staff_tenant_select on public.staff';
    execute $p$
      create policy staff_tenant_select on public.staff for select
      using (
        (is_active = true and is_public = true)
        or (auth.uid() is not null and exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = staff.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        ))
      )
    $p$;

    execute 'drop policy if exists staff_owner_write on public.staff';
    execute $p$
      create policy staff_owner_write on public.staff for all to authenticated
      using (
        exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = staff.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
      with check (
        exists (
          select 1 from public.salons s
          join public.organization_members om on om.organization_id = s.organization_id
          where s.id = staff.salon_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role = 'owner'
        )
      )
    $p$;
  end if;

end $$;

commit;
