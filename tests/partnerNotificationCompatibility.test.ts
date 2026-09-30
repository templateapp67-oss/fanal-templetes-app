import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('user-id partner schema persists preferences and scopes notifications',async()=>{
const db=new PGlite();try{
await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table growth_partners(user_id uuid primary key,is_active boolean);
insert into growth_partners values('00000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000002',true);
create table partner_notifications(id uuid primary key,partner_user_id uuid,title text,body text,notification_type text,read_at timestamptz,created_at timestamptz default now());
insert into partner_notifications(id,partner_user_id,title,notification_type) values
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','mine','system'),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','other','system');`);
const sql=readFileSync(new URL('../supabase/migrations/20260930053037_partner_notification_preferences_compatibility.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);
await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set role authenticated");
assert.equal((await db.query<any>('select get_my_partner_notification_preferences() as p')).rows[0].p.email_enabled,true);
await db.query('select update_my_partner_notification_preferences(false,false)');
const saved=(await db.query<any>('select get_my_partner_notification_preferences() as p')).rows[0].p;
assert.equal(saved.email_enabled,false);assert.equal(saved.in_app_enabled,false);
const notices=(await db.query<any>('select get_my_partner_notifications(null,50) as p')).rows[0].p;
assert.equal(notices.items.length,1);assert.equal(notices.unread_count,1);assert.equal(notices.items[0].is_read,false);
assert.equal((await db.query<any>("select mark_my_partner_notifications_read(array['00000000-0000-0000-0000-000000000012'::uuid]) as n")).rows[0].n,0);
assert.equal((await db.query<any>('select mark_my_partner_notifications_read(null) as n')).rows[0].n,1);
await db.exec("reset role;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);set role authenticated");
assert.equal((await db.query<any>('select get_my_partner_notification_preferences() as p')).rows[0].p.email_enabled,true);
await db.exec('reset role');assert.equal((await db.query<any>("select has_function_privilege('anon','update_my_partner_notification_preferences(boolean,boolean)','execute') as allowed")).rows[0].allowed,false);
}finally{await db.close();}});
