import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { LOCAL_DATABASE_BOOTSTRAP, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';
import { asUser } from './liveSchemaFixture';

const file='20261001_partner_dashboard_activity.sql';
const migration=readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
test('analytics safely upgrades populated schema: bounded private recent users, UTC buckets, idempotency and preservation',async()=>{
  const db:any=new PGlite();
  try {
    await db.exec(LOCAL_DATABASE_BOOTSTRAP);
    for(const name of LOCAL_GROWTH_CHAIN.slice(0,LOCAL_GROWTH_CHAIN.indexOf(file))) await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    // Unrelated production-shape sentinels must not be touched by analytics.
    await db.exec("create table public.salons(id uuid primary key, name text); create table public.bookings(id uuid primary key, status text); insert into public.salons values(gen_random_uuid(),'Preserve salon'); insert into public.bookings values(gen_random_uuid(),'confirmed'); insert into public.services values(gen_random_uuid(),gen_random_uuid());");
    const user=async(name:string)=>{const id=randomUUID();await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'test-only',$3::jsonb)",[id,`${id}@example.com`,JSON.stringify({full_name:name})]);return id;};
    const a=await user('Partner A'),b=await user('Partner B'),ordinary=await user('Ordinary'),empty=await user('Empty partner');
    await db.query("select public.provision_growth_partner($1,'NEXORA-ANALYTICA')",[a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-ANALYTICB')",[b]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-ANALYTICE')",[empty]);
    const call=async(actor:string,fn:string,args:any[]=[]) => (await asUser(db,actor,`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r;
    const start=(await db.query("select (date_trunc('day',now() at time zone 'UTC') - interval '6 days') at time zone 'UTC' as start")).rows[0].start;
    const ids:string[]=[];
    for(let i=0;i<13;i++) {
      const id=await user(i===12?'PEER PRIVATE':i===10?'':`User ${i}`);ids.push(id);
      // Eleven within window, one just outside. Identical times test tie order.
      const date=i===11?new Date(start.getTime()-1):new Date(start.getTime()+i*3600000);
      await db.query("insert into public.growth_onboarding(user_id,growth_partner_id,referral_code,linked_at,status) values($1,$2,$3,$4,'linked') on conflict(user_id) do update set growth_partner_id=excluded.growth_partner_id,referral_code=excluded.referral_code,linked_at=excluded.linked_at,status=excluded.status",[id,i===12?b:a,i===12?'NEXORA-ANALYTICB':'NEXORA-ANALYTICA',date]);
    }
    await db.query("update public.growth_onboarding set status='template_started',template_started_at=now() where user_id=$1",[ids[1]]);
    const snapshot=async()=>{
      const rows:any={};for(const table of ['auth.users','public.profiles','public.growth_partners','public.growth_onboarding','public.partner_referrals','public.partner_referral_events','public.salons','public.bookings','public.services'])rows[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows[0].rows;
      return rows;
    };
    const before=await snapshot();
    const relations=async()=>(await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and relkind in ('r','p','v') order by relname")).rows;
    const beforeRelations=await relations();
    assert.equal((await call(a,'get_my_partner_dashboard')).referralActivity,undefined);
    await db.exec(migration);
    const activity=(await call(a,'get_my_partner_dashboard')).referralActivity;
    assert.equal(activity.recentReferrals.length,10);assert.equal(activity.last7DaysReferrals,11);
    assert.equal(activity.dailyReferrals.length,7);
    assert.equal(activity.dailyReferrals.reduce((sum:number,r:any)=>sum+r.count,0),11);
    assert.equal(activity.dailyReferrals[0].count,11);assert.equal(activity.dailyReferrals[6].count,0);
    assert.equal(activity.window.timeZone,'UTC');assert.equal(new Date(activity.window.from).getTime(),start.getTime());
    assert.deepEqual(activity.recentReferrals.map((r:any)=>r.name),Array.from({length:10},(_,i)=>i===0?'Referred user':`User ${10-i}`));
    assert.equal(activity.recentReferrals.at(-1).status,'active');
    for(const row of activity.recentReferrals) assert.deepEqual(Object.keys(row).sort(),['date','name','referralId','status']);
    assert.ok(!JSON.stringify(activity).includes('PEER PRIVATE'));assert.ok(!JSON.stringify(activity).includes('@example.com'));
    assert.equal((await call(b,'get_my_partner_dashboard')).referralActivity.last7DaysReferrals,1);
    await assert.rejects(call('', 'get_my_partner_dashboard'),/permission denied/);
    await assert.rejects(call(ordinary, 'get_my_partner_dashboard'),/access required/);
    const noActivity=(await call(empty,'get_my_partner_dashboard')).referralActivity;
    assert.deepEqual(noActivity.recentReferrals,[]);assert.equal(noActivity.last7DaysReferrals,0);
    assert.deepEqual(noActivity.dailyReferrals.map((r:any)=>r.count),[0,0,0,0,0,0,0]);
    await db.exec("set time zone 'Asia/Kolkata'");
    assert.equal((await call(a,'get_my_partner_dashboard')).referralActivity.last7DaysReferrals,11);
    await db.exec("set time zone 'UTC'");
    await db.exec(migration);
    assert.deepEqual(await snapshot(),before,'no account, referral, event or unrelated business rows rewritten');
    assert.deepEqual(await relations(),beforeRelations,'no duplicate tables or views created');
    assert.equal((await call(a,'get_my_partner_dashboard')).referralActivity.last7DaysReferrals,11);
    await db.query('update public.growth_partners set is_active=false where user_id=$1',[a]);
    await assert.rejects(call(a,'get_my_partner_dashboard'),/paused/);
  } finally {await db.close();}
});

test('analytics preflight fails closed on an incomplete schema without creating replacement tables',async()=>{
  const db=new PGlite();
  try {
    await db.exec("create table public.salons(id int primary key, name text);insert into public.salons values(1,'Existing business');");
    await assert.rejects(db.exec(migration),/Partner schema incomplete/);
    await db.exec('rollback');
    assert.deepEqual((await db.query('select * from public.salons')).rows,[{id:1,name:'Existing business'}]);
    assert.equal((await db.query<{relation:string|null}>("select to_regclass('public.growth_onboarding') as relation")).rows[0].relation,null);
  } finally {await db.close();}
});
