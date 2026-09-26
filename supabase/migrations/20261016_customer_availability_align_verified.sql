-- Align customer availability with the authoritative booking contract.
--
-- nexora_customer_booking_options() is the read-only slot preview the public
-- booking modal calls. It used to require `salons.verified`, but the booking
-- path it previews — create_customer_booking / nexora_create_customer_booking
-- (20260911_customer_booking_rpc.sql) and the createNormalizedBooking service
-- (server/normalizedBookingCreate.ts) — gates ONLY on is_active +
-- accepts_online_bookings. Nothing in this product ever sets salons.verified
-- (complete_shop_onboarding writes verified=false and there is no approval
-- flow), so the stricter availability gate blocked EVERY onboarded salon behind
-- a permanent "This salon is not accepting online bookings" error even though a
-- booking would actually have succeeded.
--
-- Drop the `verified` requirement so availability mirrors booking exactly. An
-- explicit accepts_online_bookings = false still pauses customer booking; a
-- missing value keeps the product default of true (20261013_online_booking_defaults.sql).
-- This is a `create or replace` of the routine installed by
-- 20260911110000_customer_availability_bridge.sql; only the salon guard changes.
create or replace function public.nexora_customer_booking_options(p_salon_id uuid,p_service_ids uuid[],p_staff_id uuid,p_date date)
returns table(slot_start timestamptz,slot_end timestamptz,staff_id uuid,total_paise bigint)
language plpgsql security definer set search_path='' as $$
declare salon public.salons%rowtype; hours public.salon_hours%rowtype; specialist record; candidate timestamp; starts timestamptz; duration integer; price bigint;
begin
 if p_date is null or p_date < current_date-1 or p_date > current_date+366 then raise exception 'Select a date within the next year' using errcode='22023'; end if;
 if cardinality(p_service_ids) is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>20 then raise exception 'Select between 1 and 20 services' using errcode='22023'; end if;
 select * into salon from public.salons where id=p_salon_id and is_active and coalesce(accepts_online_bookings,true) and deleted_at is null;
 if not found then raise exception 'This salon is not accepting online bookings' using errcode='22023'; end if;
 select * into hours from public.salon_hours where salon_id=p_salon_id and day_of_week=extract(dow from p_date)::integer and not is_closed;
 if not found or hours.opens_at is null or hours.closes_at is null then return; end if;
 for specialist in select st.id from public.staff st where st.salon_id=p_salon_id and st.is_active and st.is_public and st.deleted_at is null and st.employment_status='active' and (p_staff_id is null or st.id=p_staff_id) order by st.id loop
  duration:=private.booking_effective_duration_minutes(p_salon_id,p_service_ids,specialist.id);
  if duration is null or duration<=0 then continue; end if;
  select sum(coalesce(ss.custom_price_paise,s.price_paise)) into price from public.services s join public.staff_services ss on ss.service_id=s.id and ss.staff_id=specialist.id and ss.is_active where s.id=any(p_service_ids) and s.salon_id=p_salon_id;
  candidate:=p_date+hours.opens_at;
  while candidate+make_interval(mins=>duration)<=p_date+hours.closes_at loop
   starts:=candidate at time zone salon.timezone;
   if starts>now() and private.booking_slot_validation_error(p_salon_id,p_service_ids,specialist.id,starts,null,true) is null then
    slot_start:=starts; slot_end:=starts+make_interval(mins=>duration);staff_id:=specialist.id;total_paise:=price;return next;
   end if;
   candidate:=candidate+interval '30 minutes';
  end loop;
 end loop;
end;$$;
revoke all on function public.nexora_customer_booking_options(uuid,uuid[],uuid,date) from public,anon,authenticated;
grant execute on function public.nexora_customer_booking_options(uuid,uuid[],uuid,date) to service_role;
notify pgrst,'reload schema';
