-- Read-only deployment/schema compatibility audit. No writes or privileges change.
-- Run against the Supabase project configured on the actual Vercel deployment.
with required_tables(name) as (
  values ('salons'),('profiles'),('services'),('staff'),('bookings'),
         ('payments'),('salon_customers'),('staff_time_off'),
         ('partner_security_events'),('partner_deactivation_requests'),
         ('growth_referral_attributions')
), required_columns(table_name,column_name) as (
  values ('salons','accepts_online_bookings'),('bookings','customer_user_id'),
         ('bookings','total_paise'),('bookings','appointment_start'),
         ('bookings','appointment_end'),('bookings','idempotency_key')
), required_rpcs(name) as (
  values ('get_my_owner_workspace'),('save_owner_editor_state'),
         ('get_owner_editor_state'),('nexora_customer_booking_options'),
         ('nexora_create_customer_booking'),('record_verified_payment_capture'),
         ('capture_growth_referral'),('prepare_growth_referral_signup'),
         ('get_my_growth_partner'),('ensure_my_growth_partner'),
         ('get_my_referral_code'),('get_my_partner_referrals'),
         ('get_my_partner_security_overview')
)
select 'table' kind,name object_name,
       case when to_regclass('public.'||name) is null then 'MISSING' else 'PRESENT' end status
from required_tables
union all
select 'column',r.table_name||'.'||r.column_name,
       case when exists(select 1 from information_schema.columns c
         where c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name)
         then 'PRESENT' else 'MISSING' end
from required_columns r
union all
select 'rpc',r.name,
       case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=r.name) then 'PRESENT' else 'MISSING' end
from required_rpcs r
order by kind,object_name;

-- Inspect signatures as well: the availability API expects row results with
-- slot_start, slot_end, staff_id, total_paise. A jsonb-returning overload is
-- a different contract even when the function name is present.
select p.proname,pg_get_function_identity_arguments(p.oid) arguments,
       pg_get_function_result(p.oid) result,
       has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'nexora_customer_booking_options','nexora_create_customer_booking',
 'record_verified_payment_capture','get_my_partner_security_overview')
order by p.proname;
