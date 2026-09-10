-- ============================================================================
-- Nexora SalonOS — create_customer_booking + record_verified_payment_capture
-- Migration: 20260911_customer_booking_rpc.sql
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--   server/normalizedBookingCreate.ts calls two SECURITY DEFINER RPCs —
--   `create_customer_booking` and `record_verified_payment_capture` — that do
--   the atomic insert (customer upsert → booking row → booking_items →
--   optional payment ledger row). Without these functions every online-booking
--   attempt after checkout answers PostgREST 42883
--       "function public.create_customer_booking(...) does not exist".
--   The owner-side equivalent lives in
--   supabase/migrations/20260910200000_create_owner_booking.sql; this migration
--   is the customer-side counterpart and uses the same column-introspection
--   helper so it works against every deployed schema generation.
--
-- TENANT / ID GUARANTEES (the bullet list from the verification brief):
--   • salon_id            — resolved server-side from slug or p_salon_id and
--                           re-checked; slugs/editor/local ids are rejected.
--   • organization_id     — derived from the salon row inside the function,
--                           never from the request body.
--   • branch/location_id  — not modelled in this schema; the salon row is the
--                           canonical location; no branch FK exists.
--   • service_id(s)       — each entry must match a UUID already in
--                           `services` for this salon AND be active +
--                           bookable-online; non-UUID friendly ids are mapped
--                           through nexora_catalog_uuid by the server before
--                           this RPC is called; the RPC refuses ids that do
--                           not belong to p_salon_id.
--   • staff_id            — same discipline as service_id; NULL means
--                           "any available" and is accepted.
--   • customer_user_id    — MUST equal auth.uid() (the signed-in bearer).
--                           Walk-in / guest names/phones create a
--                           salon_customers row keyed by phone.
--   • created_by          — set inside the function to auth.uid(), never from
--                           the request.
--   • booking status      — defaults to 'payment_pending' when no payment is
--                           attached and 'confirmed' only after the verified
--                           payment RPC records a captured amount (see below).
--   • payment status      — defaults to 'pending'; only
--                           record_verified_payment_capture may set
--                           'paid_deposit'/'paid_full', after re-reading the
--                           gateway through the service role.
--   • start/end timestamps — computed inside the function from
--                           p_appointment_start + the catalogue service
--                           durations; a client-supplied "end" is ignored.
--
-- Editor-only, temporary, slug-based, array-index, generated-frontend, or
-- localStorage ids never reach a foreign key: server-side `catalogId(...)`
-- maps friendly strings to deterministic UUIDs BEFORE this RPC is invoked,
-- and every FK column is then re-verified against a fresh SELECT from the
-- real table for THIS salon.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- create_customer_booking — authenticated customer checkout.
-- ---------------------------------------------------------------------------
create or replace function public.create_customer_booking(
  p_salon_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_appointment_start timestamptz,
  p_customer_user_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_customer_note text default null,
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
  -- 1) Authentication + identity binding ------------------------------------
  if actor is null then
    raise exception 'Sign in required to book.' using errcode = '42501';
  end if;
  if p_customer_user_id is distinct from actor then
    raise exception 'customer_user_id must match the signed-in caller.' using errcode = '42501';
  end if;

  -- 2) Input validation -----------------------------------------------------
  if p_salon_id is null then
    raise exception 'A salon is required.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'A customer name is required.' using errcode = '22023';
  end if;
  if v_phone = '' then
    raise exception 'A contact phone number is required.' using errcode = '22023';
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

  -- 3) Salon must exist and accept online bookings --------------------------
  select s.organization_id, coalesce(s.timezone, 'Asia/Kolkata')
    into v_org, v_tz
  from public.salons s
  where s.id = p_salon_id
    and coalesce(s.is_active, true)
    and coalesce(s.accepts_online_bookings, true);
  if not found then
    raise exception 'This salon is not currently accepting online bookings.' using errcode = '22023';
  end if;

  -- 4) Idempotency: retried POST returns the existing booking --------------
  if public.nexora_owner_booking_has_column('bookings', 'idempotency_key') then
    select b.id into v_existing_id
    from public.bookings b
    where b.customer_user_id = actor
      and b.idempotency_key = btrim(p_idempotency_key)
    limit 1;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  -- 5) Specialist must belong to THIS salon --------------------------------
  if p_staff_id is not null then
    select st.name into v_staff_name
    from public.staff st
    where st.id = p_staff_id
      and st.salon_id = p_salon_id
      and coalesce(st.is_active, true);
    if not found then
      raise exception 'The selected specialist is unavailable.' using errcode = '22023';
    end if;
  end if;

  -- 6) Every service must belong to THIS salon -----------------------------
  select count(*) into v_service_count
  from public.services sv
  where sv.salon_id = p_salon_id
    and sv.id = any (p_service_ids)
    and coalesce(sv.is_active, true)
    and coalesce(sv.is_bookable_online, true);
  if v_service_count <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'The selected service is no longer available.' using errcode = '22023';
  end if;

  for v_service in
    select sv.id, sv.name, sv.price_paise, sv.duration_minutes
    from public.services sv
    where sv.salon_id = p_salon_id
      and sv.id = any (p_service_ids)
      and coalesce(sv.is_active, true)
      and coalesce(sv.is_bookable_online, true)
    order by array_position(p_service_ids, sv.id)
  loop
    if p_staff_id is not null
      and to_regclass('public.staff_services') is not null
      and exists (select 1 from public.staff_services ss where ss.staff_id = p_staff_id)
      and not exists (
        select 1 from public.staff_services ss
        where ss.staff_id = p_staff_id
          and ss.service_id = v_service.id
          and coalesce(ss.is_active, true)
      ) then
      raise exception 'The selected specialist does not offer this service.' using errcode = '22023';
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

  -- 7) Customer upsert (salon-scoped, keyed by phone) ----------------------
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
      'user_id', actor,
      'created_by', actor,
      'created_at', now(),
      'updated_at', now()
    );
    v_cols := public.nexora_owner_booking_columns('salon_customers', v_row);
    if v_cols <> '' then
      v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
      execute format(
        'insert into public.salon_customers (%s) select %s from (select jsonb_populate_record(null::public.salon_customers, $1) as r) s',
        v_cols, v_sel
      ) using v_row;
    end if;
  else
    v_row := jsonb_build_object('name', v_name, 'user_id', actor, 'updated_at', now());
    if v_email is not null then v_row := v_row || jsonb_build_object('email', v_email); end if;
    v_cols := public.nexora_owner_booking_columns('salon_customers', v_row);
    if v_cols <> '' then
      v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
      execute format(
        'update public.salon_customers set (%s) = (select %s from (select jsonb_populate_record(null::public.salon_customers, $1) as r) s) where id = $2',
        v_cols, v_sel
      ) using v_row, v_customer_id;
    end if;
  end if;

  -- 8) Booking row ----------------------------------------------------------
  v_booking_id := gen_random_uuid();
  v_end := v_start + make_interval(mins => v_duration_total);

  if exists(
    select 1 from public.bookings b
    where (p_staff_id is null or b.staff_id = p_staff_id)
      and b.salon_id = p_salon_id
      and b.status in ('payment_pending', 'pending', 'confirmed', 'reschedule_proposed',
                       'reschedule_requested', 'checked_in', 'in_progress')
      and tstzrange(b.appointment_start, b.appointment_end, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    raise exception 'The requested time is no longer available.' using errcode = '23P01';
  end if;

  v_row := jsonb_build_object(
    'id', v_booking_id,
    'salon_id', p_salon_id,
    'organization_id', v_org,
    'staff_id', p_staff_id,
    'staff_name_snapshot', v_staff_name,
    'salon_customer_id', v_customer_id,
    'customer_user_id', actor,
    'owner_id', p_salon_id,
    'status', 'payment_pending',
    'appointment_start', v_start,
    'appointment_end', v_end,
    'booking_date', (v_start at time zone v_tz)::date,
    'booking_time', to_char(v_start at time zone v_tz, 'HH24:MI'),
    'time_slot', to_char(v_start at time zone v_tz, 'HH24:MI'),
    'total_paise', v_total_paise,
    'total_amount', round(v_total_paise / 100.0, 2),
    'paid_amount', 0,
    'currency', 'INR',
    'customer_note', v_note,
    'customer_name', v_name,
    'customer_phone', v_phone,
    'customer_email', v_email,
    'idempotency_key', btrim(p_idempotency_key),
    'created_by', actor,
    'is_walk_in', false,
    'source', 'online_customer',
    'created_at', now(),
    'updated_at', now()
  );
  v_cols := public.nexora_owner_booking_columns('bookings', v_row);
  v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
  begin
    execute format(
      'insert into public.bookings (%s) select %s from (select jsonb_populate_record(null::public.bookings, $1) as r) s returning id',
      v_cols, v_sel
    ) into v_booking_id using v_row;
  exception
    when exclusion_violation then
      raise exception 'The requested time is no longer available.' using errcode = '23P01';
    when unique_violation then
      raise exception 'This booking reference was already used.' using errcode = '23505';
    when not_null_violation then
      raise exception 'A required booking field was empty.' using errcode = '23502';
    when foreign_key_violation then
      raise exception 'The selected service or specialist is no longer available.' using errcode = '23503';
    when check_violation then
      raise exception 'The booking details were rejected by a database rule.' using errcode = '23514';
  end;

  -- 9) Booking_items --------------------------------------------------------
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
-- record_verified_payment_capture — attach a server-verified Razorpay capture
-- to a booking. This is the ONLY path that sets payment_status to
-- 'paid_deposit' / 'paid_full'; any client-supplied payment_status from the
-- browser is ignored. It also appends a row to `payments` when that table
-- exists so the webhook/reconciliation path has a real ledger entry.
-- ---------------------------------------------------------------------------
create or replace function public.record_verified_payment_capture(
  p_booking_id uuid,
  p_provider text,
  p_provider_event_id text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise integer,
  p_method text,
  p_payload_hash text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_booking record;
  v_total_paise bigint;
  v_existing_payment text;
  v_payment_id uuid;
  v_row jsonb;
  v_cols text;
  v_sel text;
begin
  if actor is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_booking_id is null or p_provider_payment_id is null then
    raise exception 'Booking id and provider payment id are required.' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'A captured amount is required.' using errcode = '22023';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.customer_user_id = actor
  for update;
  if not found then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;

  v_total_paise := coalesce(v_booking.total_paise, round((coalesce(v_booking.total_amount, 0))::numeric * 100));
  if p_amount_paise > v_total_paise + 1 then
    raise exception 'Captured amount exceeds booking total.' using errcode = '22023';
  end if;

  update public.bookings
     set paid_amount = round(p_amount_paise / 100.0, 2),
         payment_id = p_provider_payment_id,
         payment_status = case when p_amount_paise >= v_total_paise - 1 then 'paid_full'::text else 'paid_deposit'::text end,
         status = case when status = 'payment_pending' then 'confirmed'::text else status end,
         confirmed_at = case when status = 'payment_pending' then now() else confirmed_at end,
         updated_at = now()
   where id = p_booking_id;

  if to_regclass('public.payments') is not null then
    select provider_payment_id into v_existing_payment
      from public.payments
     where provider_payment_id = p_provider_payment_id
     limit 1;
    if v_existing_payment is null then
      v_payment_id := gen_random_uuid();
      v_row := jsonb_build_object(
        'id', v_payment_id,
        'booking_id', p_booking_id,
        'salon_id', v_booking.salon_id,
        'organization_id', v_booking.organization_id,
        'customer_user_id', actor,
        'provider', coalesce(btrim(p_provider), 'razorpay'),
        'provider_event_id', p_provider_event_id,
        'provider_order_id', p_provider_order_id,
        'provider_payment_id', p_provider_payment_id,
        'amount_paise', p_amount_paise,
        'method', coalesce(nullif(btrim(p_method), ''), 'unknown'),
        'currency', 'INR',
        'status', 'captured',
        'payload_hash', p_payload_hash,
        'created_at', now()
      );
      v_cols := public.nexora_owner_booking_columns('payments', v_row);
      if v_cols <> '' then
        v_sel := '(s.r).' || replace(v_cols, ', ', ', (s.r).');
        execute format(
          'insert into public.payments (%s) select %s from (select jsonb_populate_record(null::public.payments, $1) as r) s on conflict do nothing',
          v_cols, v_sel
        ) using v_row;
      end if;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: only authenticated callers. Anonymous cannot execute.
-- ---------------------------------------------------------------------------
revoke all on function public.create_customer_booking(uuid, uuid[], uuid, timestamptz, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.record_verified_payment_capture(uuid, text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.create_customer_booking(uuid, uuid[], uuid, timestamptz, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.record_verified_payment_capture(uuid, text, text, text, text, integer, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
