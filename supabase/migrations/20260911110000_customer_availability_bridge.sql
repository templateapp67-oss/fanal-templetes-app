-- Reuse the installed booking validator, including shifts, leave, breaks and blocks.
-- Only the backend service role can query this projection; no customer data is returned.
create or replace function public.nexora_customer_booking_options(p_salon_id uuid,p_service_ids uuid[],p_staff_id uuid,p_date date)
returns table(slot_start timestamptz,slot_end timestamptz,staff_id uuid,total_paise bigint)
language plpgsql security definer set search_path='' as $$
declare salon public.salons%rowtype; hours public.salon_hours%rowtype; specialist record; candidate timestamp; starts timestamptz; duration integer; price bigint;
begin
 if p_date is null or p_date < current_date-1 or p_date > current_date+366 then raise exception 'Select a date within the next year' using errcode='22023'; end if;
 if cardinality(p_service_ids) is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>20 then raise exception 'Select between 1 and 20 services' using errcode='22023'; end if;
 select * into salon from public.salons where id=p_salon_id and is_active and verified and accepts_online_bookings and deleted_at is null;
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

-- Preserve the deployed six-argument routine and its availability/concurrency checks.
create or replace function public.nexora_create_customer_booking(p_salon_id uuid,p_service_ids uuid[],p_staff_id uuid,p_appointment_start timestamptz,p_customer_user_id uuid,p_customer_name text,p_customer_phone text,p_customer_email text default null,p_customer_note text default null,p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); saved uuid;
begin
 if actor is null or p_customer_user_id is distinct from actor then raise exception 'Authentication required' using errcode='42501';end if;
 if p_staff_id is null then raise exception 'Choose an available specialist' using errcode='22023';end if;
 if nullif(btrim(p_customer_name),'') is null or length(p_customer_name)>120 or p_customer_phone is null or p_customer_phone !~ '^[+0-9]{7,20}$' then raise exception 'Valid contact details are required' using errcode='22023';end if;
 if not exists(select 1 from public.staff where id=p_staff_id and salon_id=p_salon_id and is_public and is_active and deleted_at is null) then raise exception 'Choose a public specialist for this salon' using errcode='22023';end if;
 saved:=public.create_customer_booking(p_salon_id,p_service_ids,p_staff_id,p_appointment_start,p_customer_note,p_idempotency_key);
 if not exists(select 1 from public.bookings where id=saved and salon_id=p_salon_id and customer_user_id=actor) then raise exception 'Booking reference belongs to a different salon' using errcode='22023';end if;
 update public.salon_customers sc set name=btrim(p_customer_name),phone=p_customer_phone,email=nullif(btrim(p_customer_email),'')
 where sc.customer_user_id=actor and sc.salon_id=p_salon_id and sc.id in(select b.salon_customer_id from public.bookings b where b.id=saved and b.customer_user_id=actor);
 return saved;
end;$$;
revoke all on function public.nexora_create_customer_booking(uuid,uuid[],uuid,timestamptz,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.nexora_create_customer_booking(uuid,uuid[],uuid,timestamptz,uuid,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
