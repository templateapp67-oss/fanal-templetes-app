
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
export const actor='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
export const salon='20000000-0000-4000-8000-000000000001', foreignSalon='20000000-0000-4000-8000-000000000002';
const migration=await readFile(new URL('../../supabase/migrations/20260909142000_normalized_owner_workspace.sql',import.meta.url),'utf8');
export async function websiteDatabase(){const db=new PGlite();await db.exec(`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.salons(id uuid primary key,slug text,name text,description text,data jsonb,phone text,mobile text,whatsapp text,email text,address text,city text,state text,area text,pincode text,landmark text,latitude numeric,longitude numeric,updated_at timestamptz);
create table public.membership(actor uuid,salon_id uuid);
create function public.nexora_owner_salon_ids() returns setof uuid language sql security definer as $$ select salon_id from public.membership where actor=auth.uid() $$;
create table public.owner_editor_state(owner_id uuid primary key,state jsonb,updated_at timestamptz);
create table public.profiles(id uuid primary key,full_name text,phone text,mobile text,whatsapp text,pincode text,city text,preferred_city text,area text,preferred_area text,avatar_url text,photo_url text);
insert into public.profiles(id) values('${actor}'),('${other}');
create table public.services(id uuid primary key,salon_id uuid references salons,name text not null,description text,price_paise bigint not null check(price_paise>=0),price numeric,duration_minutes int not null check(duration_minutes>0),is_active boolean,is_bookable_online boolean,is_featured boolean,display_order int,updated_at timestamptz);
create table public.staff(id uuid primary key,salon_id uuid references salons,name text not null,full_name text,role_title text,phone text,bio text,avatar_path text,profile_photo_url text,is_active boolean,updated_at timestamptz);
create table public.staff_services(staff_id uuid references staff,service_id uuid references services,is_active boolean,primary key(staff_id,service_id));
create table public.staff_schedules(id uuid default gen_random_uuid(),staff_id uuid references staff,day_of_week int,start_time time,end_time time,is_working boolean);
create table public.salon_staff(id uuid primary key);
create table public.bookings(id uuid primary key,staff_id uuid references staff(id),constraint conflicting_staff_fk foreign key(staff_id) references salon_staff(id));
alter table public.salons enable row level security;alter table public.services enable row level security;alter table public.staff enable row level security;alter table public.owner_editor_state enable row level security;
insert into public.salons(id,slug,name,phone) values('${salon}','mine','Mine','before'),('${foreignSalon}','other','Other','private');
insert into public.membership values('${actor}','${salon}'),('${other}','${foreignSalon}');
`);await db.exec(migration);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261017_public_site_slug_save.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261018000000_profile_completion_editor_gate.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261019000000_check_profile_completeness_rpc.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261022000000_restore_atomic_website_save.sql',import.meta.url),'utf8'));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return db;}
