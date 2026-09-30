import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('legacy database supports named referral filters with caller isolation',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table growth_partners(user_id uuid,is_active boolean);
 create table growth_onboarding(user_id uuid,growth_partner_id uuid,referral_code text,status text,created_at timestamptz default now(),updated_at timestamptz default now(),linked_at timestamptz,template_started_at timestamptz,template_completed_at timestamptz);
 insert into growth_partners values('00000000-0000-0000-0000-000000000001',true);
 insert into growth_onboarding(user_id,growth_partner_id,referral_code,status) values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','MINE','linked'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','MINE','template_completed'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','OTHER','linked');
 grant select on growth_partners,growth_onboarding to authenticated;
 create function get_my_partner_referrals(p_limit integer default 100,p_offset integer default 0) returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 const sql=readFileSync(new URL('../supabase/migrations/20260930052139_partner_referrals_rpc_compatibility.sql',import.meta.url),'utf8');
 await db.exec(sql); await db.exec(sql);
 await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set role authenticated");
 const call=async(status:string,search:string|null=null)=>(await db.query<any>('select get_my_partner_referrals(p_limit=>20,p_offset=>0,p_search=>$1,p_status_filter=>$2) as payload',[search,status])).rows[0].payload;
 const all=await call('all'); assert.equal(all.total,2);assert.equal(all.rows.length,2);assert.equal(all.status_counts.converted,1);assert.doesNotMatch(JSON.stringify(all),/OTHER/);
 assert.equal((await call('completed')).total,1);assert.equal((await call('all','missing')).total,0);assert.equal((await call('all','%')).total,0);
 await assert.rejects(()=>call('invalid'),/Invalid referral filters/);
 await db.exec('reset role');
 assert.equal((await db.query<any>("select has_function_privilege('anon','get_my_partner_referrals(text,text,integer,integer)','execute') as allowed")).rows[0].allowed,false);
 assert.ok((await db.query<any>("select to_regprocedure('get_my_partner_referrals(integer,integer)') as legacy")).rows[0].legacy);
 }finally{await db.close();}
});
