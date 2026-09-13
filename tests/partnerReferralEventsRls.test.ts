import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createLocalDatabase, LOCAL_DATABASE_BOOTSTRAP, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';
import { asUser } from './liveSchemaFixture';

const file='20260929_partner_referral_events_rls.sql';
const migration=readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
const addUser=async(db:any,token?:string)=>{
  const id=randomUUID();await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'SECRET-PASSWORD',$3::jsonb)",[id,`${id}@example.com`,JSON.stringify({growth_referral_token:token,secret:'SECRET-TOKEN'})]);return id;
};

test('referral events record real first milestones atomically with safe metadata and trusted future-event hooks',async()=>{
  const local=await createLocalDatabase();const db=local.db;
  const rpc=(actor:string|null,fn:string,args:any[]=[],admin=false):Promise<any>=>local.asRequest({sub:actor,isAdmin:admin},async conn=>(await conn.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r);
  const events=async(ref:string)=>(await db.query('select * from public.partner_referral_events where referral_id=$1 order by created_at,event_type',[ref])).rows;
  try{
    assert.equal((await db.query("select relkind from pg_class where oid='public.partner_referral_events'::regclass")).rows[0].relkind,'r');
    const cols=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='partner_referral_events' order by ordinal_position")).rows.map((r:any)=>r.column_name);
    assert.deepEqual(cols,['id','referral_id','event_type','event_metadata','created_at']);
    const partner=await addUser(db);await db.query("select public.provision_growth_partner($1,'NEXORA-EVENT01')",[partner]);
    const cap=await rpc(null,'capture_growth_referral',['NEXORA-EVENT01',null]);
    const ref=(await db.query('select referral_id from public.growth_referral_attributions where token_hash=md5($1)',[cap.token])).rows[0].referral_id;
    assert.deepEqual((await events(ref)).map((e:any)=>e.event_type),['link_clicked']);
    await rpc(null,'capture_growth_referral',['NEXORA-EVENT01',cap.token]);
    await rpc(null,'prepare_growth_referral_signup',[cap.token]);await rpc(null,'prepare_growth_referral_signup',[cap.token]);
    assert.deepEqual((await events(ref)).map((e:any)=>e.event_type),['link_clicked','signup_started']);
    await db.exec('begin');await addUser(db,cap.token);
    assert.ok((await events(ref)).some((e:any)=>e.event_type==='signup_completed'));
    await db.exec('rollback');assert.equal((await events(ref)).length,2,'failed account transaction leaves no successful-signup event');
    const user=await addUser(db,cap.token);
    assert.deepEqual((await events(ref)).map((e:any)=>e.event_type),['link_clicked','signup_started','signup_completed']);
    assert.deepEqual(await rpc(null,'prepare_growth_referral_signup',[cap.token]),{valid:false});
    await addUser(db,cap.token);assert.equal((await events(ref)).length,3,'token replay cannot duplicate signup completion');
    await rpc(user,'update_my_onboarding_progress',['start_template']);
    await db.query("update public.profiles set subdomain='verified-site',salon_name='Verified Business' where id=$1",[user]);
    await db.query('insert into public.services(id,owner_id) values($1,$2)',[randomUUID(),user]);
    await rpc(user,'update_my_onboarding_progress',['complete_template']);
    const complete=await events(ref);
    assert.deepEqual(complete.map((e:any)=>e.event_type),['link_clicked','signup_started','signup_completed','account_activated','converted']);
    await rpc(user,'update_my_onboarding_progress',['complete_template']);
    assert.deepEqual(await events(ref),complete,'retries do not change first event IDs/times/metadata');
    assert.ok(!JSON.stringify(complete).includes('SECRET-'));assert.ok(!JSON.stringify(complete).includes(cap.token));
    assert.ok(!complete.some((e:any)=>e.event_type==='business_created'||e.event_type==='subscription_started'),'completion does not invent business/subscription event times');
    const external=await rpc(partner,'record_partner_referral_event',[ref,'subscription_started',{source:'subscription'}],true);
    const retried=await rpc(partner,'record_partner_referral_event',[ref,'subscription_started',{source:'subscription'}],true);
    assert.equal(external,retried);
    await rpc(partner,'record_partner_referral_event',[ref,'business_created',{source:'business'}],true);
    for(const metadata of [{token:'SECRET'},{email:'user@example.com'},{source:'user@example.com'},{backfilled:{secret:'x'}},[]])
      await assert.rejects(rpc(partner,'record_partner_referral_event',[ref,'business_created',metadata],true),/metadata_safe/);
    await assert.rejects(rpc(partner,'record_partner_referral_event',[ref,'unknown',{}],true),/event_type_valid/);
    await assert.rejects(db.query("update public.partner_referral_events set event_metadata='{}' where referral_id=$1",[ref]),/append-only/);
    for(const actor of [null,user,partner]) await assert.rejects(rpc(actor,'record_partner_referral_event',[ref,'converted',{}]),/permission denied/);
    const invalidBefore=(await db.query('select count(*)::int as n from public.partner_referral_events')).rows[0].n;
    assert.deepEqual(await rpc(null,'prepare_growth_referral_signup',['f'.repeat(64)]),{valid:false});
    assert.equal((await db.query('select count(*)::int as n from public.partner_referral_events')).rows[0].n,invalidBefore);
    const expired=await rpc(null,'capture_growth_referral',['NEXORA-EVENT01',null]);
    await db.query("update public.growth_referral_attributions set expires_at=now()-interval '1 second' where token_hash=md5($1)",[expired.token]);
    assert.deepEqual(await rpc(null,'prepare_growth_referral_signup',[expired.token]),{valid:false});
    await db.query('delete from auth.users where id=$1',[user]);assert.deepEqual(await events(ref),[],'deletion cascades to events');
  }finally{await local.close();}
});

test('RLS isolates owned partners, referrals, events and legacy reads even after permissive-policy/grant drift',async()=>{
  const local=await createLocalDatabase();const db=local.db;
  const rpc=(actor:string|null,fn:string,args:any[]=[],admin=false):Promise<any>=>local.asRequest({sub:actor,isAdmin:admin},async conn=>(await conn.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r);
  const read=(actor:string|null,table:string):Promise<any[]>=>local.asRequest({sub:actor,isAdmin:false},async conn=>(await conn.query(`select * from public.${table}`)).rows);
  try{
    const a=await addUser(db),b=await addUser(db);await db.query("select public.provision_growth_partner($1,'NEXORA-OWNER01'),public.provision_growth_partner($2,'NEXORA-OWNER02')",[a,b]);
    const ca=await rpc(null,'capture_growth_referral',['NEXORA-OWNER01',null]),cb=await rpc(null,'capture_growth_referral',['NEXORA-OWNER02',null]);
    const ua=await addUser(db,ca.token),ub=await addUser(db,cb.token);
    const ra=(await db.query('select * from public.partner_referrals where referred_user_id=$1',[ua])).rows[0];
    const rb=(await db.query('select * from public.partner_referrals where referred_user_id=$1',[ub])).rows[0];
    const verify=async()=>{
      assert.deepEqual((await read(a,'growth_partners')).map(r=>r.user_id),[a]);
      assert.deepEqual((await read(b,'growth_partners')).map(r=>r.user_id),[b]);
      assert.deepEqual((await read(a,'partner_referrals')).map(r=>r.id),[ra.id]);
      assert.deepEqual((await read(b,'partner_referrals')).map(r=>r.id),[rb.id]);
      assert.ok((await read(a,'partner_referral_events')).every(r=>r.referral_id===ra.id));
      assert.equal((await read(a,'partner_referral_events')).length,2);
      assert.deepEqual((await read(a,'growth_onboarding')).map(r=>r.user_id),[ua]);
      assert.deepEqual(await read(ua,'partner_referrals'),[]);assert.deepEqual(await read(ua,'partner_referral_events'),[]);
      assert.deepEqual((await read(ua,'growth_onboarding')).map(r=>r.user_id),[ua],'personal onboarding stays available');
    };
    await verify();
    for(const table of ['growth_partners','partner_referrals','partner_referral_events','growth_onboarding']){
      await assert.rejects(read(null,table),/permission denied/);
      await db.exec(`create policy accidental_broad_access on public.${table} for all to public using(true) with check(true); grant select,insert,update,delete on public.${table} to authenticated,anon;`);
    }
    await verify();
    for(const table of ['growth_partners','partner_referrals','partner_referral_events','growth_onboarding'])assert.deepEqual(await read(null,table),[],'anonymous fence defeats accidental broad grants/policies');
    const hidden=await local.asRequest<{rows:any[]}>({sub:a,isAdmin:false},conn=>conn.query('select * from public.partner_referral_events where referral_id=$1',[rb.id]));
    assert.deepEqual(hidden.rows,[],'direct guessed referral ID is filtered by the database');
    await assert.rejects(local.asRequest({sub:a,isAdmin:false},conn=>conn.query("insert into public.partner_referral_events(referral_id,event_type) values($1,'subscription_started')",[ra.id])),/row-level security/);
    const attempted=await local.asRequest<{rows:any[]}>({sub:a,isAdmin:false},conn=>conn.query('update public.growth_partners set is_active=false returning user_id'));
    assert.deepEqual(attempted.rows,[]);
    await local.asRequest({sub:a,isAdmin:false},conn=>conn.query('delete from public.partner_referrals'));
    assert.equal((await read(a,'partner_referrals')).length,1);
    // Trusted corrections move event visibility with the actual owned referral,
    // not a stale partner snapshot stored inside an event.
    await rpc(a,'admin_correct_growth_referral',[ua,'NEXORA-OWNER02','Verified support correction'],true);
    assert.deepEqual(await read(a,'partner_referral_events'),[]);
    assert.equal((await read(b,'partner_referral_events')).length,4);
    await db.query('update public.growth_partners set is_active=false where user_id=$1',[b]);
    assert.equal((await read(b,'growth_partners')).length,1,'paused partner can still read their own gate row');
    assert.deepEqual(await read(b,'partner_referrals'),[]);assert.deepEqual(await read(b,'partner_referral_events'),[]);assert.deepEqual(await read(b,'growth_onboarding'),[]);
  }finally{await local.close();}
});

test('event backfill is factual and rerunnable, including activation under an inactive disposition',async()=>{
  const db=new PGlite();
  try{
    await db.exec(LOCAL_DATABASE_BOOTSTRAP);
    for(const name of LOCAL_GROWTH_CHAIN.slice(0,LOCAL_GROWTH_CHAIN.indexOf(file)))await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    const p=await addUser(db);await db.query("select public.provision_growth_partner($1,'NEXORA-HISTORY')",[p]);
    const c=(await db.query<any>("select public.capture_growth_referral('NEXORA-HISTORY',null) as r")).rows[0].r;
    const u=await addUser(db,c.token);
    const r=(await db.query<any>('select * from public.partner_referrals where referred_user_id=$1',[u])).rows[0];
    await db.exec(migration);
    const before=(await db.query<any>('select * from public.partner_referral_events order by event_type')).rows;
    assert.deepEqual(before.map(e=>e.event_type),['link_clicked','signup_completed']);
    assert.ok(before.every(e=>e.event_metadata.backfilled===true));
    assert.equal(new Date(before[0].created_at).getTime(),new Date(r.first_clicked_at).getTime());
    await db.exec(migration);assert.deepEqual((await db.query('select * from public.partner_referral_events order by event_type')).rows,before);
    // A legacy activation timestamp earlier than linking doesn't change the
    // inactive ledger's last activity, but is still a real activation event.
    await db.query("select set_config('app.is_admin','true',false)");
    await db.query("select public.admin_set_growth_referral_status($1,'inactive','Verified legacy pause')",[u]);
    await db.query("select set_config('app.is_admin','false',false)");
    await db.query("update public.growth_onboarding set status='template_started',template_started_at=linked_at-interval '1 day' where user_id=$1",[u]);
    assert.equal((await db.query<any>("select count(*)::int as n from public.partner_referral_events where event_type='account_activated'")).rows[0].n,1);
    assert.equal((await db.query<any>('select status from public.partner_referrals where id=$1',[r.id])).rows[0].status,'inactive');
    await assert.rejects(asUser(db,p,'select public.record_partner_referral_event($1,$2)',[r.id,'converted']),/permission denied/);
  }finally{await db.close();}
});
