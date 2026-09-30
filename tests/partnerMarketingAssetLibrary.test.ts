import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {test} from 'node:test';import {PGlite} from '@electric-sql/pglite';
test('asset library replay, publication filtering and authorization',async()=>{const db=new PGlite();try{
await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;create table growth_partners(user_id uuid,is_active boolean);
insert into growth_partners values('00000000-0000-0000-0000-000000000001',true);grant select on growth_partners to authenticated;`);
const sql=readFileSync(new URL('../supabase/migrations/20260930062019_partner_marketing_asset_library.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
await db.exec(`insert into partner_marketing_assets(category,title,storage_path,mime_type,is_published,published_at) values
('banner','Published','published.png','image/png',true,now()),('banner','Draft','draft.png','image/png',false,null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set role authenticated;`);
assert.equal((await db.query<any>('select get_partner_marketing_assets(null) as p')).rows[0].p.length,1);
assert.equal((await db.query<any>("select get_partner_marketing_assets('video_demo') as p")).rows[0].p.length,0);
assert.equal((await db.query<any>('select get_partner_marketing_asset_categories() as p')).rows[0].p[0].asset_count,1);
await assert.rejects(()=>db.exec("insert into partner_marketing_assets(category,title,storage_path,mime_type) values('banner','Unauthorized','x','image/png')"),/permission denied/);
await db.exec("reset role;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);set role authenticated");await assert.rejects(()=>db.query('select get_partner_marketing_assets(null)'),/Active Growth Partner required/);
await db.exec('reset role');assert.equal((await db.query<any>("select has_function_privilege('anon','get_partner_marketing_assets(text)','execute') as allowed")).rows[0].allowed,false);
}finally{await db.close();}});
