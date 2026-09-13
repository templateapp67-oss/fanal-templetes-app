import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createLocalDatabase, LOCAL_DATABASE_BOOTSTRAP, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';
import { asUser } from './liveSchemaFixture';

const migration = readFileSync(new URL('../supabase/migrations/20260928_partner_referrals_table.sql', import.meta.url), 'utf8');

async function addUser(db: any, token?: string): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'test-only',$3::jsonb)",
    [id,`${id}@example.com`,JSON.stringify({growth_referral_token:token})]);
  return id;
}

test('physical partner_referrals has correct FKs, RLS, unique success, atomic promotion and synchronized milestones', async () => {
  const local = await createLocalDatabase(); const db = local.db;
  const rpc = (actor: string | null, name: string, args: any[] = [], admin = false): Promise<any> =>
    local.asRequest({sub:actor,isAdmin:admin}, async conn =>
      (await conn.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r);
  const ledger = async (id: string) => (await db.query('select * from public.partner_referrals where id=$1',[id])).rows[0];
  try {
    assert.equal((await db.query("select relkind from pg_class where oid='public.partner_referrals'::regclass")).rows[0].relkind,'r','a real table, not a view');
    const a = await addUser(db), b = await addUser(db);
    await db.query("select public.provision_growth_partner($1,'NEXORA-TABLE01')",[a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-TABLE02')",[b]);
    const partnerA = (await db.query('select * from public.growth_partners where user_id=$1',[a])).rows[0];
    const partnerB = (await db.query('select * from public.growth_partners where user_id=$1',[b])).rows[0];
    assert.notEqual(partnerA.id,a,'partner record ID differs from Auth identity');
    await db.query('select public.provision_growth_partner($1)',[a]);
    assert.equal((await db.query('select id from public.growth_partners where user_id=$1',[a])).rows[0].id,partnerA.id);
    await assert.rejects(db.query('update public.growth_partners set id=$1 where user_id=$2',[randomUUID(),a]),/identity cannot be changed/);
    const fks = (await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.partner_referrals'::regclass and contype='f'")).rows.map((r:any)=>r.definition).join('\n');
    assert.match(fks,/FOREIGN KEY \(partner_id\) REFERENCES growth_partners\(id\)/);
    assert.match(fks,/FOREIGN KEY \(referred_user_id\) REFERENCES auth.users\(id\)/);
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='partner_referrals' order by ordinal_position")).rows.map((r:any)=>r.column_name);
    assert.deepEqual(columns,['id','partner_id','referred_user_id','referral_code','status','conversion_status','first_clicked_at','registered_at','converted_at','last_activity_at','created_at','updated_at']);

    const capture = await rpc(null,'capture_growth_referral',[' nexora-table01 ',null]);
    const attribution = (await db.query('select * from public.growth_referral_attributions where token_hash=md5($1)',[capture.token])).rows[0];
    const clicked = await ledger(attribution.referral_id);
    assert.equal(clicked.partner_id,partnerA.id); assert.equal(clicked.status,'clicked');
    assert.equal(clicked.referred_user_id,null); assert.equal(clicked.registered_at,null);
    assert.equal(clicked.referral_code,'NEXORA-TABLE01'); assert.ok(clicked.first_clicked_at);
    await rpc(null,'capture_growth_referral',['NEXORA-TABLE02',capture.token]);
    assert.equal((await db.query('select count(*)::int as n from public.partner_referrals')).rows[0].n,1,'navigation does not duplicate a click');
    const user = await addUser(db,capture.token);
    const registered = await ledger(clicked.id);
    assert.equal(registered.referred_user_id,user); assert.equal(registered.partner_id,partnerA.id);
    assert.equal(registered.status,'pending'); assert.ok(registered.registered_at);
    assert.equal(registered.created_at.getTime(),clicked.created_at.getTime());
    assert.equal(registered.first_clicked_at.getTime(),clicked.first_clicked_at.getTime());
    assert.equal((await db.query('select referral_id from public.growth_onboarding where user_id=$1',[user])).rows[0].referral_id,clicked.id);
    assert.equal((await rpc(a,'get_my_partner_referrals')).rows[0].referral_id,clicked.id);
    await addUser(db,capture.token);
    assert.equal((await db.query('select count(*)::int as n from public.partner_referrals where referred_user_id is not null')).rows[0].n,1,'completed signup replay is not another attribution');

    // Global uniqueness holds even for another partner and for terminal statuses.
    await assert.rejects(db.query("insert into public.partner_referrals(partner_id,referred_user_id,referral_code,status,registered_at) values($1,$2,'NEXORA-TABLE02','inactive',now())",[partnerB.id,user]),/partner_referrals_referred_user_key/);
    await assert.rejects(db.query("insert into public.partner_referrals(partner_id,referred_user_id,referral_code,status,registered_at) values($1,$2,'NEXORA-TABLE01','pending',now())",[partnerA.id,a]),/cannot refer yourself/);
    await assert.rejects(db.query("insert into public.partner_referrals(partner_id,referral_code) values($1,'NEXORA-TABLE01')",[a]),/foreign key/,'Auth ID cannot be used as the new partner FK');
    const manual = await addUser(db);
    await rpc(manual,'link_my_growth_referral',['NEXORA-TABLE01']);
    const manualLedger = (await db.query('select * from public.partner_referrals where referred_user_id=$1',[manual])).rows[0];
    assert.equal(manualLedger.first_clicked_at,null,'manual linking does not fabricate a click');
    assert.equal(manualLedger.partner_id,partnerA.id,'multiple real users can share a referral code');
    await rpc(user,'update_my_onboarding_progress',['start_template']);
    assert.equal((await ledger(clicked.id)).status,'active');
    await db.query("update public.growth_onboarding set status='template_completed',template_completed_at=now() where user_id=$1",[user]);
    const completed = await ledger(clicked.id);
    assert.equal(completed.status,'converted'); assert.equal(completed.conversion_status,'converted'); assert.ok(completed.converted_at);
    await rpc(a,'admin_set_growth_referral_status',[user,'inactive','Verified account pause'],true);
    assert.equal((await ledger(clicked.id)).status,'inactive');
    assert.equal((await ledger(clicked.id)).conversion_status,'converted','historical conversion survives disposition changes');
    await rpc(a,'admin_correct_growth_referral',[user,'NEXORA-TABLE02','Verified attribution correction'],true);
    assert.equal((await ledger(clicked.id)).partner_id,partnerB.id); assert.equal((await ledger(clicked.id)).referral_code,'NEXORA-TABLE02');
    assert.equal((await ledger(clicked.id)).registered_at.getTime(),registered.registered_at.getTime());
    await assert.rejects(db.query('update public.partner_referrals set partner_id=$1 where id=$2',[partnerA.id,clicked.id]),/immutable/);
    await assert.rejects(db.query('update public.partner_referrals set referred_user_id=$1 where id=$2',[manual,clicked.id]),/identity cannot be changed/);
    await assert.rejects(db.query('update public.growth_onboarding set referral_id=$1 where user_id=$2',[randomUUID(),user]),/identity cannot be changed/);

    const readOwn = (actor:string)=>local.asRequest<{rows:any[]}>({sub:actor,isAdmin:false},conn=>conn.query('select * from public.partner_referrals'));
    assert.deepEqual((await readOwn(a)).rows.map(r=>r.id),[manualLedger.id]);
    assert.deepEqual((await readOwn(b)).rows.map(r=>r.id),[clicked.id]);
    assert.equal((await readOwn(user)).rows.length,0);
    for (const statement of ["insert into public.partner_referrals(partner_id,referral_code) values($1,'NEXORA-TABLE01')",'update public.partner_referrals set partner_id=$1','delete from public.partner_referrals where partner_id=$1'])
      await assert.rejects(local.asRequest({sub:a,isAdmin:false},conn=>conn.query(statement,[partnerA.id])),/permission denied/);
    await assert.rejects(local.asRequest({sub:null,isAdmin:false},conn=>conn.query('select * from public.partner_referrals')),/permission denied/);
    await assert.rejects(rpc(a,'sync_partner_referral',[manual]),/permission denied/);
    await db.query('update public.growth_partners set is_active=false where user_id=$1',[b]);
    assert.equal((await readOwn(b)).rows.length,0,'paused partners cannot read ledger rows directly');
    await db.query('delete from public.growth_referral_attributions where consumed_by=$1',[user]);
    assert.equal((await ledger(clicked.id)).referred_user_id,user,'temporary cleanup preserves successful attribution');
    await db.query('delete from auth.users where id=$1',[user]);
    assert.equal(await ledger(clicked.id),undefined,'account deletion cascades consistently');
  } finally { await local.close(); }
});

test('signup rollback and retries leave one clicked/promoted ledger row, never partial success', async () => {
  const local=await createLocalDatabase();const db=local.db;
  try {
    const partner=await addUser(db);await db.query("select public.provision_growth_partner($1,'NEXORA-ATOMIC1')",[partner]);
    const captured=(await db.query("select public.capture_growth_referral('NEXORA-ATOMIC1',null) as r")).rows[0].r;
    const read=async()=>(await db.query('select pr.* from public.partner_referrals pr join public.growth_referral_attributions a on a.referral_id=pr.id where a.token_hash=md5($1)',[captured.token])).rows[0];
    const initial=await read();
    await db.exec('begin');
    await addUser(db,captured.token);
    assert.ok((await read()).referred_user_id);
    await db.exec('rollback');
    assert.equal((await read()).status,'clicked');assert.equal((await read()).referred_user_id,null);
    const user=await addUser(db,captured.token);
    assert.equal((await read()).id,initial.id);assert.equal((await read()).referred_user_id,user);
    await addUser(db,captured.token);
    assert.equal((await db.query('select count(*)::int as n from public.partner_referrals')).rows[0].n,1);
  } finally {await local.close();}
});

test('upgrade backfills existing users and unconsumed clicks, and reruns without changing IDs or timestamps', async () => {
  const db=new PGlite();
  try {
    await db.exec(LOCAL_DATABASE_BOOTSTRAP);
    for(const file of LOCAL_GROWTH_CHAIN.slice(0, LOCAL_GROWTH_CHAIN.indexOf('20260928_partner_referrals_table.sql')))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
    const partner=await addUser(db);await db.query<any>("select public.provision_growth_partner($1,'NEXORA-BACKFILL')",[partner]);
    const capture=async()=> (await db.query<any>("select public.capture_growth_referral('NEXORA-BACKFILL',null) as r")).rows[0].r;
    const consumed=await capture();const user=await addUser(db,consumed.token);const pending=await capture();
    const old=(await db.query<any>('select * from public.growth_onboarding where user_id=$1',[user])).rows[0];
    await db.query<any>("select public.provision_growth_partner($1,'NEXORA-ROTATED')",[partner]);
    await db.exec(migration);
    const registered=(await db.query<any>('select * from public.partner_referrals where referred_user_id=$1',[user])).rows[0];
    assert.equal(registered.id,old.referral_id);assert.equal(registered.referral_code,'NEXORA-BACKFILL','historic code is not rotated');
    const clicked=(await db.query<any>('select pr.* from public.partner_referrals pr join public.growth_referral_attributions a on a.referral_id=pr.id where a.token_hash=md5($1)',[pending.token])).rows[0];
    assert.equal(clicked.status,'clicked');assert.equal(clicked.referred_user_id,null);
    assert.equal((await db.query<any>('select referral_id from public.growth_referral_attributions where token_hash=md5($1)',[consumed.token])).rows[0].referral_id,registered.id);
    const before=(await db.query<any>('select * from public.partner_referrals order by id')).rows;
    const partnerId=(await db.query<any>('select id from public.growth_partners where user_id=$1',[partner])).rows[0].id;
    await db.exec(migration);
    assert.deepEqual((await db.query<any>('select * from public.partner_referrals order by id')).rows,before);
    assert.equal((await db.query<any>('select id from public.growth_partners where user_id=$1',[partner])).rows[0].id,partnerId);
    // Historical completed rows still progress under the original code after rotation.
    await asUser(db,user,"select public.update_my_onboarding_progress('start_template')");
    assert.equal((await db.query<any>('select status from public.partner_referrals where id=$1',[registered.id])).rows[0].status,'active');
  } finally {await db.close();}
});
