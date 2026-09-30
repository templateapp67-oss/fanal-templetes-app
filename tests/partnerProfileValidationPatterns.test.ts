import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('repair photo and phone patterns without changing caller scope or security',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table profiles(id uuid primary key,phone text,partner_avatar_path text);
 insert into profiles(id) values('00000000-0000-0000-0000-000000000001');
 alter table profiles enable row level security;
 create policy self on profiles to authenticated using(id=auth.uid()) with check(id=auth.uid());
 grant select,update on profiles to authenticated;`);
 const sql=readFileSync(new URL('../supabase/migrations/20260930053609_partner_profile_validation_patterns.sql',import.meta.url),'utf8');
 const actor='00000000-0000-0000-0000-000000000001';const photo=actor+'/00000000-0000-0000-0000-000000000002.png';
 for(const escapes of [1,2,4]){
 const slash='\\'.repeat(escapes);
 await db.exec(`create or replace function save_my_growth_partner_profile(p_patch jsonb) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
 declare actor uuid:=auth.uid(); path text:=p_patch->>'photo_path';v_phone text:=p_patch->>'phone';begin
 if actor is null then raise exception 'Sign in required';end if;
 if path is not null and path !~ ('^'||actor::text||'/[a-f0-9-]{36}${slash}.(jpg|png|webp)$') then raise exception 'Invalid photo path';end if;
 if v_phone is not null and v_phone !~ '^${slash}+?[0-9]{7,15}$' then raise exception 'Invalid phone number';end if;
 update profiles set partner_avatar_path=path,phone=v_phone where id=actor;
 return (select to_jsonb(p) from profiles p where id=actor);end $$;
 revoke all on function save_my_growth_partner_profile(jsonb) from public,anon;
 grant execute on function save_my_growth_partner_profile(jsonb) to authenticated;`);
 await db.exec(sql);await db.exec(sql);
 await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false);set role authenticated`);
 const call=(path:string|null,phone:string|null)=>db.query<any>('select save_my_growth_partner_profile($1::jsonb) as p',[JSON.stringify({photo_path:path,phone})]);
 assert.equal((await call(photo,'+919876543210')).rows[0].p.partner_avatar_path,photo);
 assert.equal((await db.query<any>('select partner_avatar_path from profiles')).rows[0].partner_avatar_path,photo);
 await assert.rejects(()=>call(photo.replace('.png','xpng'),'9876543210'),/Invalid photo path/);
 await assert.rejects(()=>call(photo.replace(actor,'00000000-0000-0000-0000-000000000003'),'9876543210'),/Invalid photo path/);
 await assert.rejects(()=>call(photo,'invalid'),/Invalid phone number/);
 assert.equal((await call(null,null)).rows[0].p.partner_avatar_path,null);
 await db.exec('reset role');
 assert.equal((await db.query<any>("select prosecdef from pg_proc where proname='save_my_growth_partner_profile'")).rows[0].prosecdef,false);
 assert.equal((await db.query<any>("select has_function_privilege('anon','save_my_growth_partner_profile(jsonb)','execute') as allowed")).rows[0].allowed,false);
 }
 }finally{await db.close();}
});
