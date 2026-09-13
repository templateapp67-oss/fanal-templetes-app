import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLocalDatabase } from '../server/localSupabase';
import { GrowthPartnerReferrals } from '../src/components/GrowthPartnerSections';
import { partnerPortalPath, matchPartnerPortalRoute } from '../src/lib/router';

test('fraud guards, audited admin correction, and server-side referral privacy over full migrations', async () => {
  const local = await createLocalDatabase();
  const db = local.db;
  const user = async (name: string, email: string) => {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values ($1,$2,'SECRET-PASSWORD',$3::jsonb)",
      [id, email, JSON.stringify({ full_name: name, secret: 'SECRET-TOKEN', payment: 'SECRET-CARD' })]);
    return id;
  };
  const rpc = async (actor: string | null, fn: string, args: any[] = [], admin = false): Promise<any> =>
    local.asRequest({ sub: actor, isAdmin: admin }, async conn =>
      (await conn.query(`select public.${fn}(${args.map((_,i) => `$${i+1}`).join(',')}) as result`, args)).rows[0].result);
  try {
    const a = await user('Partner A','partner-a@example.com');
    const b = await user('Partner B','partner-b@example.com');
    const u1 = await user('Rahul','rahul@gmail.com');
    const u2 = await user('Anita','anita@example.com');
    const u3 = await user('Other partner user','elsewhere@example.com');
    await db.query("select public.provision_growth_partner($1,'NEXORA-RAHUL25')", [a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-OTHER25')", [b]);
    await assert.rejects(rpc(a,'link_my_growth_referral',['NEXORA-RAHUL25']), /own referral/);
    await assert.rejects(db.query("insert into public.growth_onboarding(user_id,growth_partner_id,referral_code,linked_at,status) values ($1,$1,'NEXORA-RAHUL25',now(),'linked')", [a]), /no_self_referral/);
    await rpc(u1,'link_my_growth_referral',['nexora-rahul25']);
    await rpc(u2,'link_my_growth_referral',['NEXORA-RAHUL25']);
    await rpc(u3,'link_my_growth_referral',['NEXORA-OTHER25']);
    await assert.rejects(rpc(u1,'link_my_growth_referral',['NEXORA-RAHUL25']), /already linked/);
    await db.query("update public.growth_onboarding set status='template_completed', template_started_at=now(), template_completed_at=now() where user_id=$1", [u1]);
    await assert.rejects(rpc(u1,'link_my_growth_referral',['NEXORA-OTHER25']), /already linked/);
    assert.equal((await db.query('select count(*)::int as n from public.growth_onboarding where user_id=$1',[u1])).rows[0].n, 1);
    // Defense in depth even if a future SECURITY DEFINER RPC attempts an edit.
    await assert.rejects(db.query("update public.growth_onboarding set growth_partner_id=$1,referral_code='NEXORA-OTHER25' where user_id=$2",[b,u1]), /immutable/);
    await assert.rejects(db.query("update public.growth_onboarding set linked_at=now()+interval '1 day' where user_id=$1",[u1]), /immutable/);
    await assert.rejects(local.asRequest({sub:u1,isAdmin:false}, conn => conn.query('delete from public.growth_onboarding where user_id=$1',[u1])), /permission denied/);
    await assert.rejects(rpc(u1,'admin_correct_growth_referral',[u1,'NEXORA-OTHER25','Fraud review']), /permission denied/);
    await assert.rejects(rpc(null,'admin_correct_growth_referral',[u1,'NEXORA-OTHER25','Fraud review']), /permission denied/);
    await assert.rejects(rpc(a,'get_my_partner_referrals',['all',null,20,0,b]), /does not exist/);
    await assert.rejects(rpc(u1,'get_my_partner_referrals'), /Growth Partner access required/);
    await assert.rejects(rpc(null,'get_my_partner_referrals'), /permission denied/);

    const list = await rpc(a,'get_my_partner_referrals',['all',null,20,0]);
    assert.equal(list.total, 2);
    const rahul = list.rows.find((r: any) => r.display_name === 'Rahul');
    assert.equal(rahul.masked_contact, 'ra***@gmail.com');
    assert.equal(rahul.conversion_status, 'converted');
    assert.equal(rahul.referral_code, 'NEXORA-RAHUL25');
    assert.ok(rahul.joined_at && rahul.last_activity_at);
    assert.deepEqual(Object.keys(rahul).sort(), ['ref','referral_id','referral_clicked_at','referral_status','display_name','masked_contact','joined_at','referral_code','status','conversion_status','last_activity_at','linked_at','template_started_at','template_completed_at'].sort());
    for (const secret of ['rahul@gmail.com','anita@example.com','elsewhere@example.com','SECRET-',u1,u2,u3,b,'Other partner user']) assert.ok(!JSON.stringify(list).includes(secret), secret);
    const page = await rpc(a,'get_my_partner_referrals',['all',null,1,1]);
    assert.equal(page.rows.length, 1); assert.equal(page.total, 2);
    assert.equal((await rpc(a,'get_my_partner_referrals',['completed',null,20,0])).total, 1);
    assert.equal((await rpc(a,'get_my_partner_referrals',['all','Other partner',20,0])).total, 0);
    assert.equal((await rpc(a,'get_my_partner_referrals',['all','%',20,0])).total, 0);
    assert.equal((await rpc(b,'get_my_partner_referrals')).total, 1);
    const raw = await local.asRequest<{ rows: { user_id: string }[] }>({sub:a,isAdmin:false}, conn => conn.query('select user_id from public.growth_onboarding where user_id=$1',[u3]));
    assert.equal(raw.rows.length, 0);
    for (const table of ['auth.users','public.growth_referral_attributions','public.growth_referral_admin_audit']) {
      await assert.rejects(local.asRequest({sub:a,isAdmin:false}, conn => conn.query(`select * from ${table}`)), /permission denied/);
    }
    // Authorized correction resolves the new owner from code, preserves dates,
    // and creates exactly one private audit record.
    await assert.rejects(rpc(a,'admin_correct_growth_referral',[u1,'nexora-other25',''], true), /audit reason/);
    await rpc(a,'admin_correct_growth_referral',[u1,'nexora-other25','Corrected after support verification'], true);
    const corrected = (await db.query('select * from public.growth_onboarding where user_id=$1',[u1])).rows[0];
    assert.equal(corrected.growth_partner_id,b);
    assert.equal(new Date(corrected.linked_at).toISOString(), new Date(rahul.linked_at).toISOString());
    assert.equal(corrected.status,'template_completed');
    assert.equal((await db.query('select count(*)::int as n from public.growth_referral_admin_audit')).rows[0].n, 1);
    assert.equal((await rpc(a,'get_my_partner_referrals')).total, 1);
    assert.equal((await rpc(b,'get_my_partner_referrals')).total, 2);
    await db.query('update public.growth_partners set is_active=false where user_id=$1',[a]);
    await assert.rejects(rpc(a,'get_my_partner_referrals'), /paused/);
    for (const email of ['a@gmail.com','ab@gmail.com','bad','',null]) {
      const masked = (await db.query('select public.growth_mask_referral_email($1) as m',[email])).rows[0].m;
      assert.notEqual(masked,email || '');
    }
  } finally { await local.close(); }
});

test('referrals route renders all seven columns with masked contact and no prominent internal identifier', () => {
  assert.equal(partnerPortalPath('referred-users'), '/partner/referrals');
  assert.equal(matchPartnerPortalRoute('/partner/referrals'), 'referred-users');
  assert.equal(matchPartnerPortalRoute('/partner/referred-users'), 'referred-users');
  const html = renderToStaticMarkup(React.createElement(GrowthPartnerReferrals, {
    list: { total:1, limit:20, offset:0, rows:[{
      ref:'…12345678', display_name:'Rahul', masked_contact:'ra***@gmail.com',
      joined_at:'2026-09-13T00:00:00Z', referral_code:'NEXORA-RAHUL25', status:'template_completed',
      conversion_status:'converted', last_activity_at:'2026-09-14T00:00:00Z', linked_at:'2026-09-13T00:00:00Z', template_started_at:null, template_completed_at:'2026-09-14T00:00:00Z',
    }] }, loading:false, error:null, onPage() {}, onRetry() {},
  }));
  for (const heading of ['User','Email / masked contact','Joined Date','Referral Code','Status','Conversion Status','Last Activity']) assert.ok(html.includes(heading));
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /scope="col"/);
  assert.match(html, /ra\*\*\*@gmail.com/);
  assert.match(html, /Converted/);
  assert.doesNotMatch(html, /12345678|rahul@gmail.com/);
});
