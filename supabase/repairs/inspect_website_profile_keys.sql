-- Read-only inspection. No assumptions about either table's primary key.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('salon_public_websites', 'profiles')
order by table_name, ordinal_position;

select c.relname as table_name, con.conname as constraint_name,
       con.contype as constraint_type, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('salon_public_websites', 'profiles')
  and con.contype in ('p', 'f', 'u')
order by c.relname, con.contype, con.conname;
