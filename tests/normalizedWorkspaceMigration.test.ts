import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const actor='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
const salon='20000000-0000-4000-8000-000000000001', foreignSalon='20000000-0000-4000-8000-000000000002';
const migration=await readFile(new URL('../supabase/migrations/20260909142000_normalized_owner_workspace.sql',import.meta.url),'utf8');
async function setup(){const db=new PGlite();await db.exec(`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.salons(id uuid primary key,slug text,name text,description text,data jsonb,phone text,updated_at timestamptz);
create table public.membership(actor uuid,salon_id uuid);
create function public.nexora_owner_salon_ids() returns setof uuid language sql security definer as $$ select salon_id from public.membership where actor=auth.uid() $$;
create table public.owner_editor_state(owner_id uuid primary key,state jsonb,updated_at timestamptz);
create function public.sync_owner_contact(p jsonb) returns void language sql as $$ update public.salons set phone=p->>'phone' where id in(select public.nexora_owner_salon_ids()) $$;
create table public.services(id uuid primary key,salon_id uuid references salons,name text not null,description text,price_paise bigint not null check(price_paise>=0),price numeric,duration_minutes int not null check(duration_minutes>0),is_active boolean,is_bookable_online boolean,is_featured boolean,display_order int,updated_at timestamptz);
create table public.staff(id uuid primary key,salon_id uuid references salons,name text not null,full_name text,role_title text,phone text,bio text,avatar_path text,profile_photo_url text,is_active boolean,updated_at timestamptz);
create table public.staff_services(staff_id uuid references staff,service_id uuid references services,is_active boolean,primary key(staff_id,service_id));
create table public.staff_schedules(id uuid default gen_random_uuid(),staff_id uuid references staff,day_of_week int,start_time time,end_time time,is_working boolean);
create table public.salon_staff(id uuid primary key);
create table public.bookings(id uuid primary key,staff_id uuid references staff(id),constraint conflicting_staff_fk foreign key(staff_id) references salon_staff(id));
alter table public.salons enable row level security;alter table public.services enable row level security;alter table public.staff enable row level security;alter table public.owner_editor_state enable row level security;
insert into public.salons(id,slug,name,phone) values('${salon}','mine','Mine','before'),('${foreignSalon}','other','Other','private');
insert into public.membership values('${actor}','${salon}'),('${other}','${foreignSalon}');
`);await db.exec(migration);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return db;}
const state=()=>({profile:{subdomain:'mine',businessName:'Saved',phone:'after'},services:[{id:'local-service',name:'Cut',price:499,durationMinutes:30}],stylists:[{id:'local-staff',name:'Stylist',assignedServices:['local-service'],schedule:[{day:'Monday',enabled:true,fromTime:'09:00',toTime:'18:00'}]}]});
test('atomic workspace persists catalogue with stable ids and repairs only duplicate staff FK',async()=>{const db=await setup();try{
 await db.exec('set role authenticated');await db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(state())]);await db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(state())]);await db.exec('reset role');
 assert.equal((await db.query('select * from public.services')).rows.length,1);assert.equal((await db.query('select * from public.staff')).rows.length,1);assert.equal((await db.query('select * from public.staff_schedules')).rows.length,1);
 const row:any=(await db.query('select * from public.services')).rows[0];assert.equal(Number(row.price_paise),49900);
 const fks:any=(await db.query("select confrelid::regclass::text as target from pg_constraint where conrelid='public.bookings'::regclass and contype='f'")).rows;assert.deepEqual(fks.map((f:any)=>f.target),['staff']);
}finally{await db.close();}});
test('invalid catalogue rolls back contact, editor state and earlier catalogue writes',async()=>{const db=await setup();try{const bad=state();bad.services.push({id:'bad',name:'Bad',price:-1,durationMinutes:30});await assert.rejects(db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(bad)]));assert.equal((await db.query<{phone:string}>(`select phone from salons where id='${salon}'`)).rows[0].phone,'before');assert.equal((await db.query('select * from services')).rows.length,0);assert.equal((await db.query('select * from owner_editor_state')).rows.length,0);}finally{await db.close();}});
test('cross-salon UUID substitution and anonymous execution are denied',async()=>{const db=await setup();try{const id='30000000-0000-4000-8000-000000000002';await db.query('insert into services(id,salon_id,name,price_paise,duration_minutes) values($1,$2,$3,100,20)',[id,foreignSalon,'Other service']);const bad=state();bad.services[0].id=id;await assert.rejects(db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(bad)]),/another salon/);await db.exec('set role anon');await assert.rejects(db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(state())]),/permission denied/);}finally{await db.close();}});
test('removed editor services are retired without deleting historical or external records',async()=>{const db=await setup();try{await db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(state())]);const next=state();next.services=[];next.stylists[0].assignedServices=[];await db.query('select public.save_owner_editor_state($1::jsonb)',[JSON.stringify(next)]);assert.equal((await db.query<{is_active:boolean}>('select is_active from services')).rows[0].is_active,false);}finally{await db.close();}});
