-- Production staff reporting: read-only, authenticated owner-scoped.
create or replace function public.is_staff_dashboard_owner(target_salon_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.salons s where s.owner_id=auth.uid() and (s.id=target_salon_id or s.owner_id=target_salon_id))
$$;
create or replace function public.get_owner_staff_performance(target_salon_id uuid,from_date date,to_date date,target_staff_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
if not public.is_staff_dashboard_owner(target_salon_id) then raise exception 'Owner access denied' using errcode='42501'; end if;
if from_date is null or to_date is null or to_date<from_date or to_date-from_date>366 then raise exception 'Invalid date range' using errcode='22023'; end if;
return query
with owned as (select id from public.salons where owner_id=auth.uid() and (id=target_salon_id or owner_id=target_salon_id)),
b as (select b.* from public.bookings b join owned o on o.id=b.salon_id
where (b.appointment_start at time zone 'Asia/Kolkata')::date between from_date and to_date and (target_staff_id is null or b.staff_id=target_staff_id)),
pay as (select p.booking_id,sum(p.amount_paise)::numeric/100 amount from public.payments p join b on b.id=p.booking_id and b.salon_id=p.salon_id where lower(p.status) in ('paid','success','successful','captured') group by p.booking_id),
comm as (select c.booking_id,sum(c.commission_amount) amount from public.staff_payroll_commissions c join b on b.id=c.booking_id and b.staff_id=c.staff_id where lower(coalesce(c.status,'')) not in ('cancelled','void','voided','reversed','rejected') group by c.booking_id),
agg as (select b.staff_id,count(*) total_bookings,count(*) filter(where b.status='completed') completed_bookings,count(*) filter(where b.status='cancelled') cancelled_bookings,
sum(b.subtotal_paise)::numeric/100 gross_amount,sum(b.discount_paise)::numeric/100 discount_amount,sum(b.total_paise)::numeric/100 net_amount,
sum(coalesce(pay.amount,0)) paid_amount,sum(coalesce(comm.amount,0)) commission_amount
from b left join pay on pay.booking_id=b.id left join comm on comm.booking_id=b.id group by b.staff_id),
rev as (select coalesce(r.staff_id,b.staff_id) staff_id,count(*) review_count,avg(r.rating) average_rating from public.reviews r join owned o on o.id=r.salon_id left join public.bookings b on b.id=r.booking_id and b.salon_id=r.salon_id
where (r.created_at at time zone 'Asia/Kolkata')::date between from_date and to_date and r.status='published'
group by coalesce(r.staff_id,b.staff_id)),
dim as (select s.id,s.name from public.staff s join owned o on o.id=s.salon_id
union select distinct b.staff_id,coalesce(b.staff_name_snapshot,'Unassigned staff') from b where b.staff_id is null or not exists(select 1 from public.staff s where s.id=b.staff_id))
select jsonb_build_object('staff_id',coalesce(d.id::text,'unassigned'),'staff_name',d.name,
'total_bookings',coalesce(a.total_bookings,0),'completed_bookings',coalesce(a.completed_bookings,0),'cancelled_bookings',coalesce(a.cancelled_bookings,0),
'gross_amount',coalesce(a.gross_amount,0),'discount_amount',coalesce(a.discount_amount,0),'net_amount',coalesce(a.net_amount,0),'paid_amount',coalesce(a.paid_amount,0),
'commission_amount',coalesce(a.commission_amount,0),'salon_amount',coalesce(a.paid_amount,0)-coalesce(a.commission_amount,0),
'review_count',coalesce(r.review_count,0),'average_rating',coalesce(r.average_rating,0))
from dim d left join agg a on a.staff_id is not distinct from d.id left join rev r on r.staff_id is not distinct from d.id
where target_staff_id is null or d.id=target_staff_id;
end $$;
create or replace function public.get_owner_staff_daily_performance(target_salon_id uuid,from_date date,to_date date,target_staff_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare day date;
begin
if not public.is_staff_dashboard_owner(target_salon_id) then raise exception 'Owner access denied' using errcode='42501'; end if;
if from_date is null or to_date is null or to_date<from_date or to_date-from_date>366 then raise exception 'Invalid date range' using errcode='22023'; end if;
for day in select generate_series(from_date,to_date,interval '1 day')::date loop
return query select r || jsonb_build_object('performance_date',day,'bookings',r->'total_bookings','reviews',r->'review_count') from public.get_owner_staff_performance(target_salon_id,day,day,target_staff_id) r;
end loop;
end $$;
create or replace function public.get_owner_staff_export(target_salon_id uuid,from_date date,to_date date,target_staff_id uuid default null)
returns setof jsonb language sql stable security invoker set search_path='' as $$
select * from public.get_owner_staff_performance(target_salon_id,from_date,to_date,target_staff_id)
$$;
revoke all on function public.is_staff_dashboard_owner(uuid) from public,anon;
revoke all on function public.get_owner_staff_performance(uuid,date,date,uuid) from public,anon;
revoke all on function public.get_owner_staff_daily_performance(uuid,date,date,uuid) from public,anon;
revoke all on function public.get_owner_staff_export(uuid,date,date,uuid) from public,anon;
grant execute on function public.is_staff_dashboard_owner(uuid),public.get_owner_staff_performance(uuid,date,date,uuid),public.get_owner_staff_daily_performance(uuid,date,date,uuid),public.get_owner_staff_export(uuid,date,date,uuid) to authenticated;
notify pgrst,'reload schema';
