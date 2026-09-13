import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase';

test('tab counts are partner-scoped, independent of selected status/page, and refresh with lifecycle changes', async () => {
  const local = await createLocalDatabase();
  const db = local.db;
  const user = async (name: string) => {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'test-only',$3::jsonb)",[id,`${id}@example.com`,JSON.stringify({full_name:name})]);
    return id;
  };
  const rpc = (actor: string | null, name: string, args: any[] = [], admin = false): Promise<any> => local.asRequest({sub:actor,isAdmin:admin}, async conn =>
    (await conn.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`, args)).rows[0].r);
  try {
    const a = await user('Partner A'), b = await user('Partner B');
    await db.query("select public.provision_growth_partner($1,'NEXORA-TABS01')",[a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-TABS02')",[b]);
    const users: string[] = [];
    for (let i=0;i<9;i++) {
      const id = await user(`User ${i}`); users.push(id);
      await rpc(id,'link_my_growth_referral',['NEXORA-TABS01']);
    }
    for (const id of users.slice(2,5)) await db.query("update public.growth_onboarding set status='template_started',template_started_at=now() where user_id=$1",[id]);
    await db.query("update public.growth_onboarding set status='template_completed',template_started_at=now(),template_completed_at=now() where user_id=$1",[users[5]]);
    for (const [i,status] of [[6,'inactive'],[7,'cancelled'],[8,'rejected']] as const) await rpc(a,'admin_set_growth_referral_status',[users[i],status,'Verified by support'],true);
    const expected = {all:9,pending:2,active:3,converted:1,inactive:1,cancelled:1,rejected:1};
    for (const [status,count] of Object.entries(expected)) {
      const result = await rpc(a,'get_my_partner_referrals',[status,null,1,0]);
      assert.deepEqual(result.status_counts,expected);
      assert.equal(result.total,count);
      assert.equal(result.rows.length,1);
    }
    const page = await rpc(a,'get_my_partner_referrals',['active',null,1,2]);
    assert.equal(page.total,3); assert.equal(page.rows.length,1); assert.deepEqual(page.status_counts,expected);
    const emptyPage = await rpc(a,'get_my_partner_referrals',['active',null,1,10]);
    assert.equal(emptyPage.rows.length,0); assert.deepEqual(emptyPage.status_counts,expected);
    const other = await rpc(b,'get_my_partner_referrals');
    assert.deepEqual(other.status_counts,{all:0,pending:0,active:0,converted:0,inactive:0,cancelled:0,rejected:0});
    const search = await rpc(a,'get_my_partner_referrals',['active','User 0',20,0]);
    assert.equal(search.total,0); assert.equal(search.status_counts.all,1); assert.equal(search.status_counts.pending,1);
    await rpc(a,'admin_set_growth_referral_status',[users[6],null,'Resume this referral'],true);
    const refreshed = await rpc(a,'get_my_partner_referrals',['inactive']);
    assert.equal(refreshed.total,0);
    assert.deepEqual(refreshed.status_counts,{...expected,inactive:0,pending:3});
    await assert.rejects(rpc(null,'get_my_partner_referrals'),/permission denied/);
    await assert.rejects(rpc(users[0],'get_my_partner_referrals'),/Growth Partner access required/);
  } finally { await local.close(); }
});
