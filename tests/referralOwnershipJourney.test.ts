import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase';

test('signup promotes one referral through Registered, Active and Converted; links cannot replace ownership, only audited admin correction can', async () => {
  const local=await createLocalDatabase(), db=local.db;
  const rpc=(actor:string|null,fn:string,args:any[]=[],admin=false):Promise<any> => local.asRequest({sub:actor,isAdmin:admin},async conn =>
    (await conn.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r);
  const user=async(token?:string) => {
    const id=randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'test-only',$3::jsonb)",[id,`${id}@example.com`,JSON.stringify({growth_referral_token:token})]);return id;
  };
  try {
    const a=await user(), b=await user();
    await db.query("select public.provision_growth_partner($1,'NEXORA-OWNER01')",[a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-OWNER02')",[b]);
    const capture=await rpc(null,'capture_growth_referral',['NEXORA-OWNER01',null]);
    const id=(await db.query('select referral_id from public.growth_referral_attributions where token_hash=md5($1)',[capture.token])).rows[0].referral_id;
    const ledger=async()=>(await db.query('select * from public.partner_referrals where id=$1',[id])).rows[0];
    assert.equal((await ledger()).status,'clicked');
    const account=await user(capture.token), registered=await ledger();
    assert.equal(registered.referred_user_id,account);assert.ok(registered.registered_at);
    assert.equal(registered.status,'pending','Registered retains the existing Pending UI/storage status');
    const second=await rpc(account,'capture_growth_referral',['NEXORA-OWNER02',null]);
    await db.query('update auth.users set raw_user_meta_data=$2::jsonb where id=$1',[account,JSON.stringify({growth_referral_token:second.token,referral_code:'NEXORA-OWNER02',partner_id:b})]);
    await assert.rejects(rpc(account,'link_my_growth_referral',['NEXORA-OWNER02']),/already linked/);
    assert.deepEqual(await ledger(),registered,'clicking, auth metadata and linking retries never reassign the registered ledger');
    await rpc(account,'update_my_onboarding_progress',['start_template']);
    assert.equal((await ledger()).status,'active');
    await db.query("update public.profiles set subdomain='verified-journey',salon_name='Verified Journey' where id=$1",[account]);
    await db.query('insert into public.services(id,owner_id) values($1,$2)',[randomUUID(),account]);
    await rpc(account,'update_my_onboarding_progress',['complete_template']);
    assert.equal((await ledger()).status,'converted');
    for(const actor of [null,account,a,b]) await assert.rejects(rpc(actor,'admin_correct_growth_referral',[account,'NEXORA-OWNER02','Verified correction request']),/permission denied/);
    await assert.rejects(rpc(a,'admin_correct_growth_referral',[account,'NEXORA-OWNER02',''],true),/audit reason/);
    await assert.rejects(db.query('update public.growth_onboarding set growth_partner_id=$1 where user_id=$2',[b,account]),/immutable/);
    await rpc(a,'admin_correct_growth_referral',[account,'NEXORA-OWNER02','Verified support correction'],true);
    const corrected=await ledger();
    assert.equal(corrected.id,id);assert.equal(corrected.referred_user_id,account);
    assert.notEqual(corrected.partner_id,registered.partner_id);assert.equal(corrected.status,'converted');
    assert.equal(corrected.registered_at.getTime(),registered.registered_at.getTime());
    const audit=(await db.query('select * from public.growth_referral_admin_audit where referred_user_id=$1',[account])).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].old_partner_id,a);assert.equal(audit[0].new_partner_id,b);
    assert.equal(audit[0].reason,'Verified support correction');assert.equal(audit[0].actor_id,a);
    const types=(await db.query('select event_type from public.partner_referral_events where referral_id=$1',[id])).rows.map((r:any)=>r.event_type);
    for(const milestone of ['signup_completed','account_activated','converted'])assert.ok(types.includes(milestone));
  } finally {await local.close();}
});
