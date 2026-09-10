-- ============================================================================
-- Nexora SalonOS — create_owner_booking RPC (owner / walk-in appointments)
-- Migration: 20260910200000_create_owner_booking.sql
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--   POST /api/owner/appointments calls
--   `rpc('create_owner_booking', …)` (server/ownerDashboard.ts), but no
--   migration ever created that function in the connected Supabase project.
--   Every manual appointment saved from the owner dashboard was therefore
--   rejected by the database with
--       PostgREST PGRST202 — "Could not find the function
--       public.create_owner_booking without parameters in the schema cache"
--       (Postgres 42883 — function public.create_owner_booking(...) does not
--       exist).
--   Reads worked (they are plain table selects), which is why the dashboard
--   correctly showed 0 real bookings while every create failed.
--
-- WHAT THIS SCRIPT DOES
--   • Creates exactly one RPC, `public.create_owner_booking`, plus two tiny
--     private column-introspection helpers. No table, column, index,
--     constraint, policy or data is created, dropped or changed.
--   • Idempotent: safe to paste into the Supabase SQL Editor and to re-run.
--   • The whole appointment is written in ONE transaction:
--         customer upsert → booking row → booking line items.
--     A failure at any step rolls everything back; no partial appointment is
--     left behind.
--   • Tenant boundaries are enforced INSIDE the function (it is SECURITY
--     DEFINER, exactly like nexora_save_owner_workspace): the caller must be
--     an ACTIVE owner/manager/receptionist of the salon's organization.
--     A caller cannot book into a salon they do not manage, and services,
--     specialists and the customer record must all belong to that salon.
--   • Only columns that exist in the LIVE table are written (verified against
--     information_schema at call time), so a schema generation that lacks an
--     optional column keeps working instead of failing with 42703.
--
-- SIGNATURE (named arguments used by the server; extra params have defaults
-- so older callers that omit them keep matching):
--   p_salon_id, p_service_ids uuid[], p_staff_id, p_appointment_start,
--   p_customer_user_id, p_customer_name, p_customer_phone,
--   p_customer_email (default null), p_customer_note (default null),
--   p_is_walk_in (default true), p_idempotency_key
--   → returns the new booking uuid (or the original booking on a retry).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Private helper 1 — does a column exist on a public.<table>?
-- (Same pattern as staff_dashboard_has_col; kept local so this migration has
-- no dependency on any other migration being applied.)
-- ---------------------------------------------------------------------------
create or replace function public.nexora_owner_booking_has_column(p_table text, p_column text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = p_column
  )
$$;

-- ---------------------------------------------------------------------------
-- Private helper 2 — comma-separated QUOTED list of the columns a jsonb row
-- and a public.<table> have in common, e.g.  "id", "salon_id", "phone".
-- Used to build INSERT/UPDATE statements that touch ONLY existing columns.
-- ---------------------------------------------------------------------------
create or replace function public.nexora_owner_booking_columns(p_table text, p_row jsonb)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    string_agg(format('%I', c.column_name), ', ' order by c.column_name),
    ''
  )
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and exists (select 1 from jsonb_object_keys(p_row) k where k = c.column_name)
$$;

-- ---------------------------------------------------------------------------
-- create_owner_booking — the caller-authorized, atomic owner booking RPC.
-- ---------------------------------------------------------------------------
create or replace function public.create_owner_booking(
  p_salon_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_appointment_start timestamptz,
  p_customer_user_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_customer_note text default null,
  p_is_walk_in boolean default true,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_org uuid;
  v_tz text;
  v_staff_name text;
  v_service record;
  v_service_count integer;
  v_duration_total integer := 0;
  v_total_paise bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_customer_id uuid;
  v_booking_id uuid;
  v_existing_id uuid;
  v_start timestamptz := p_appointment_start;
  v_end timestamptz;
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_phone text := btrim(coalesce(p_customer_phone, ''));
  v_email text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_note text := nullif(btrim(coalesce(p_customer_note, '')), '');
  v_row jsonb;
  v_cols text;
  v_sel text;
begin
  -- 1) Authentication -------------------------------------------------------
  if actor is null then
    raise exception 'Sign in required to create an appointment.'
      using errcode = '42501';
  end if;

  -- 2) Input validation -----------------------------------------------------
  if p_salon_id is null then
    raise exception 'A salon is required.' using errcode = '22023';
  end if;
  if p_staff_id is null then
    raise exception 'Select a specialist for this appointment.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'A client name is required.' using errcode = '22023';
  end if;
  if v_phone = '' then
    raise exception 'A client phone number is required.' using errcode = '22023';
  end if;
  if p_service_ids is null or coalesce(array_length(p_service_ids, 1), 0) = 0 then
    raise exception 'Select at least one service.' using errcode = '22023';
  end if;
  if v_start is null then
    raise exception 'An appointment start time is required.' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'A booking reference is required.' using errcode = '22023';
  end if;

  -- 3) Authorization — the caller must manage THIS salon ---------------------
  -- Same membership rule the API enforces (server/backendContext.ts): active
  -- owner / manager / receptionist of the salon's organization. Locking the
  -- salon row serializes concurrent writes for the same salon.
  select s.organization_id, coalesce(s.timezone, 'Asia/Kolkata')
    into v_org, v_tz
  from public.salons s
  where s.id = p_salon_id
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = actor
        and m.status = 'active'
        and m.role in ('owner', 'manager', 'receptionist')
        and m.organization_id = s.organization_id
    )
  for update;
  if not found then
    raise exception 'This appointment is outside your salon workspace.'
      using errcode = '42501';
  end if;

  -- 4) Idempotency — a retried submit returns the original booking ----------
  if public.nexora_owner_booking_has_column('bookings', 'idempotency_key') then
    select b.id into v_existing_id
    from public.bookings b
    where b.salon_id = p_salon_id
      and b.idempotency_key = btrim(p_idempotency_key)
    limit 1;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  -- 5) Specialist must belong to this salon and be active --------------------
  select st.name into v_staff_name
  from public.staff st
  where st.id = p_staff_id
    and st.salon_id = p_salon_id
    and coalesce(st.is_active, true)
  for update;
  if not found then
    raise exception 'The selected specialist is no longer available in this salon.'
      using errcode = '22023';
  end if;

  -- 6) Every requested service must belong to this salon and be active ------
  select count(*) into v_service_count
  from public.services sv
  where sv.salon_id = p_salon_id
    and sv.id = any (p_service_ids)
    and coalesce(sv.is_active, true);
  if v_service_count <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'The selected service is no longer available in this salon.'
      using errcode = '22023';
  end if;

  for v_service in
    select sv.id, sv.name, sv.price_paise, sv.duration_minutes
    from public.services sv
    where sv.salon_id = p_salon_id
      and sv.id = any (p_service_ids)
      and coalesce(sv.is_active, true)
    order by array_position(p_service_ids, sv.id)
  loop
    -- When this specialist has saved service assignments, the requested
    -- service must be one of them.
    if to_regclass('public.staff_services') is not null
      and exists (select 1 from public.staff_services ss where ss.staff_id = p_staff_id)
      and not exists (
        select 1 from public.staff_services ss
        where ss.staff_id = p_staff_id
          and ss.service_id = v_service.id
          and coalesce(ss.is_active, true)
      ) then
      raise exception 'The selected specialist does not offer this service.'
        using errcode = '22023';
    end if;
    v_duration_total := v_duration_total + greatest(coalesce(v_service.duration_minutes, 0), 5);
    v_total_paise := v_total_paise + coalesce(v_service.price_paise, 0);
    v_items := v_items || jsonb_build_object(
      'service_id', v_service.id,
      'service_name_snapshot', v_service.name,
      'duration_minutes_snapshot', greatest(coalesce(v_service.duration_minutes, 0), 5),
      'unit_price_paise', coalesce(v_service.price_paise, 0),
      'quantity', 1
    );
  end loop;

  -- 7) Customer upsert (salon-scoped, keyed by phone) ------------------------
  -- Walk-in/manual bookings do NOT need a pre-existing customer or an auth
  -- user: the canonical salon_customers row is created on demand.
  select c.id into v_customer_id
  from public.salon_customers c
  where c.salon_id = p_salon_id
    and c.phone = v_phone
  limit 1;

  if v_customer_id is null then
    v_customer_id := gen_random_uuid();
    v_row := jsonb_build_object(
      'id', v_customer_id,
      'salon_id', p_salon_id,
      'organization_id', v_org,
      'name', v_name,
      'full_name', v_name,
      'phone', v_phone,
      'email', v_email,
      'created_by', actor,
      'created_at', now(),
      'updated_at', now()
    );
    v_cols := public.nexora_owner_booking_columns('salon_customers', v_row);
    if v_cols = '' then
      raise exception 'The salon customer table has no known columns.'
        using errcode = '22023';
    end if;
    v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
    execute format(
      'insert into public.salon_customers (%s) select %s from (select jsonb_populate_record(null::public.salon_customers, $1) as r) s',
      v_cols, v_sel
    ) using v_row;
  else
    -- Keep the saved customer's identity fresh (upsert semantics).
    v_row := jsonb_build_object('name', v_name, 'updated_at', now());
    if v_email is not null then
      v_row := v_row || jsonb_build_object('email', v_email);
    end if;
    v_cols := public.nexora_owner_booking_columns('salon_customers', v_row);
    if v_cols <> '' then
      v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
      execute format(
        'update public.salon_customers set (%s) = (select %s from (select jsonb_populate_record(null::public.salon_customers, $1) as r) s) where id = $2',
        v_cols, v_sel
      ) using v_row, v_customer_id;
    end if;
  end if;

  -- 8) Booking row -----------------------------------------------------------
  v_booking_id := gen_random_uuid();
  v_end := v_start + make_interval(mins => v_duration_total);

  -- Overlap guard: mirrors the bookings_staff_active_slot_no_overlap exclusion
  -- constraint (and protects schema generations where it is absent). The
  -- specialist row is already locked (step 5), so concurrent bookings for the
  -- same specialist serialize here.
  if exists(
    select 1
    from public.bookings b
    where b.staff_id = p_staff_id
      and b.status in ('payment_pending', 'pending', 'confirmed', 'reschedule_proposed',
                       'reschedule_requested', 'checked_in', 'in_progress')
      and tstzrange(b.appointment_start, b.appointment_end, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    raise exception 'The requested time is already booked for this specialist.'
      using errcode = '23P01';
  end if;

  v_row := jsonb_build_object(
    'id', v_booking_id,
    'salon_id', p_salon_id,
    'organization_id', v_org,
    'staff_id', p_staff_id,
    'staff_name_snapshot', v_staff_name,
    'salon_customer_id', v_customer_id,
    'customer_user_id', p_customer_user_id,
    'status', 'confirmed',
    'appointment_start', v_start,
    'appointment_end', v_end,
    'confirmed_at', now(),
    'booking_date', (v_start at time zone v_tz)::date,
    'booking_time', to_char(v_start at time zone v_tz, 'HH24:MI'),
    'total_paise', v_total_paise,
    'total_amount', round(v_total_paise / 100.0, 2),
    'paid_amount', 0,
    'currency', 'INR',
    'customer_note', v_note,
    'idempotency_key', btrim(p_idempotency_key),
    'created_by', actor,
    'is_walk_in', coalesce(p_is_walk_in, true),
    'created_at', now(),
    'updated_at', now()
  );
  v_cols := public.nexora_owner_booking_columns('bookings', v_row);
  if v_cols = '' then
    raise exception 'The bookings table has no known columns.' using errcode = '22023';
  end if;
  v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
  begin
    execute format(
      'insert into public.bookings (%s) select %s from (select jsonb_populate_record(null::public.bookings, $1) as r) s returning id',
      v_cols, v_sel
    ) into v_booking_id using v_row;
  exception
    when exclusion_violation then
      raise exception 'The requested time is already booked for this specialist.'
        using errcode = '23P01';
    when unique_violation then
      raise exception 'This appointment reference was already used for another booking.'
        using errcode = '23505';
    when not_null_violation then
      raise exception 'The bookings table requires a field this workflow does not provide yet.'
        using errcode = '23502';
    when foreign_key_violation then
      raise exception 'The selected service or specialist is no longer available.'
        using errcode = '23503';
    when check_violation then
      raise exception 'The appointment could not be stored with the requested status or times.'
        using errcode = '23514';
  end;

  -- 9) Line items ------------------------------------------------------------
  if to_regclass('public.booking_items') is not null then
    for v_item in select value from jsonb_array_elements(v_items) loop
      v_row := v_item || jsonb_build_object(
        'id', gen_random_uuid(),
        'booking_id', v_booking_id,
        'salon_id', p_salon_id,
        'organization_id', v_org,
        'quantity', 1,
        'created_at', now()
      );
      v_cols := public.nexora_owner_booking_columns('booking_items', v_row);
      if v_cols <> '' then
        v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
        execute format(
          'insert into public.booking_items (%s) select %s from (select jsonb_populate_record(null::public.booking_items, $1) as r) s',
          v_cols, v_sel
        ) using v_row;
      end if;
    end loop;
  end if;

  return v_booking_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: only signed-in users may execute; anonymous callers are refused.
-- (Functions are executable by PUBLIC by default, so the revoke matters.)
-- ---------------------------------------------------------------------------
revoke all on function public.create_owner_booking(uuid, uuid[], uuid, timestamptz, uuid, text, text, text, text, boolean, text) from public, anon;
revoke all on function public.nexora_owner_booking_has_column(text, text) from public, anon;
revoke all on function public.nexora_owner_booking_columns(text, jsonb) from public, anon;
grant execute on function public.create_owner_booking(uuid, uuid[], uuid, timestamptz, uuid, text, text, text, text, boolean, text) to authenticated;

-- Make PostgREST pick the new function up immediately.
notify pgrst, 'reload schema';

commit;
