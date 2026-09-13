import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLocalDatabase } from '../server/localSupabase';
import { ReferralStatusPill, PartnerFilterPills } from '../src/components/GrowthPartnerSections';
import { REFERRAL_STATUS_DESCRIPTORS, resolveReferralStatus, referralStatusDescriptor, type ReferralStatus } from '../src/lib/referralStatus';
import { STATUS_TONE_CLASSES } from '../src/lib/statusTheme';

test('referral badges reuse shared semantic theme, readable labels, and safe unknown state', () => {
  for (const status of Object.keys(REFERRAL_STATUS_DESCRIPTORS) as ReferralStatus[]) {
    const descriptor = referralStatusDescriptor(status);
    const html = renderToStaticMarkup(React.createElement(ReferralStatusPill, { status }));
    assert.ok(html.includes(descriptor.label));
    assert.ok(html.includes(STATUS_TONE_CLASSES[descriptor.tone].badge));
    assert.match(html, /title=/);
  }
  assert.equal(resolveReferralStatus('linked'), 'pending');
  assert.equal(resolveReferralStatus('template_started'), 'active');
  assert.equal(resolveReferralStatus('template_completed'), 'converted');
  for (const invalid of [null, undefined, 'future_state', 'constructor', '__proto__']) assert.equal(resolveReferralStatus(invalid), null);
  assert.equal(referralStatusDescriptor('future_state').label, 'Unknown');
  assert.equal(referralStatusDescriptor('pending').tone, 'amber');
  assert.equal(referralStatusDescriptor('active').tone, 'blue');
  assert.equal(referralStatusDescriptor('converted').tone, 'emerald');
  assert.equal(referralStatusDescriptor('inactive').tone, 'slate');
  assert.equal(referralStatusDescriptor('rejected').tone, 'rose');
  const filters = renderToStaticMarkup(React.createElement(PartnerFilterPills, { value:'inactive', onChange() {} }));
  for (const label of ['Pending','Active','Converted','Inactive','Cancelled','Rejected']) assert.ok(filters.includes(label));
  assert.match(filters, /aria-pressed="true"[^>]*>Inactive/);
});

test('real lifecycle statuses, own-partner filters and counts, admin-only dispositions and audit', async () => {
  const local = await createLocalDatabase();
  const db = local.db;
  const rpc = (actor: string | null, name: string, args: any[] = [], admin = false): Promise<any> => local.asRequest({sub:actor,isAdmin:admin}, async conn =>
    (await conn.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`, args)).rows[0].r);
  const user = async () => {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password) values($1,$2,'test-only')",[id,`${id}@example.com`]);
    return id;
  };
  try {
    const partner = await user(), other = await user();
    await db.query("select public.provision_growth_partner($1,'NEXORA-TEST01')",[partner]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-TEST02')",[other]);
    const users: string[] = [];
    for (let i=0;i<6;i++) {
      const id = await user(); users.push(id);
      await rpc(id,'link_my_growth_referral',['NEXORA-TEST01']);
    }
    await db.query("update public.growth_onboarding set status='template_started',template_started_at=now() where user_id=$1",[users[1]]);
    await db.query("update public.growth_onboarding set status='template_completed',template_started_at=now(),template_completed_at=now() where user_id=$1",[users[2]]);
    for (const [index,status] of [[3,'inactive'],[4,'cancelled'],[5,'rejected']] as const) {
      await rpc(partner,'admin_set_growth_referral_status',[users[index],status,'Verified by support team'],true);
    }
    const list = await rpc(partner,'get_my_partner_referrals');
    assert.deepEqual(list.rows.map((r:any)=>r.referral_status).sort(), ['pending','active','converted','inactive','cancelled','rejected'].sort());
    for (const status of ['pending','active','converted','inactive','cancelled','rejected']) {
      const filtered = await rpc(partner,'get_my_partner_referrals',[status,null,1,0]);
      assert.equal(filtered.total,1); assert.equal(filtered.rows[0].referral_status,status);
    }
    assert.equal((await rpc(partner,'get_my_partner_referrals',['in_progress'])).rows[0].referral_status,'active');
    assert.equal((await rpc(partner,'get_my_partner_referrals',['completed'])).rows[0].referral_status,'converted');
    const counts = (await rpc(partner,'get_my_partner_dashboard')).referral_status_counts;
    assert.deepEqual(counts, {pending:1,active:1,converted:1,inactive:1,cancelled:1,rejected:1});
    assert.equal((await rpc(other,'get_my_partner_referrals',['inactive'])).total,0);
    assert.equal((await rpc(other,'get_my_partner_dashboard')).referral_status_counts.inactive,0);
    await assert.rejects(rpc(users[0],'admin_set_growth_referral_status',[users[0],'converted','Forged promotion']), /permission denied/);
    await assert.rejects(rpc(partner,'admin_set_growth_referral_status',[users[0],'inactive','Forged pause']), /permission denied/);
    await assert.rejects(rpc(null,'admin_set_growth_referral_status',[users[0],'inactive','Forged pause']), /permission denied/);
    await assert.rejects(rpc(partner,'admin_set_growth_referral_status',[users[0],'converted','Cannot fake conversion'],true), /Unsupported/);
    await assert.rejects(rpc(partner,'admin_set_growth_referral_status',[users[0],'inactive',''],true), /audit reason/);
    await assert.rejects(db.query("update public.growth_onboarding set referral_status_override='inactive' where user_id=$1",[users[0]]), /Administrator action/);
    // Continuing website work cannot undo an administrative disposition.
    await db.query("update public.growth_onboarding set status='template_started',template_started_at=now() where user_id=$1",[users[3]]);
    assert.equal((await rpc(partner,'get_my_partner_referrals',['inactive'])).total,1);
    const before = (await db.query('select growth_partner_id,referral_code,linked_at from public.growth_onboarding where user_id=$1',[users[3]])).rows[0];
    await rpc(partner,'admin_set_growth_referral_status',[users[3],null,'Resume verified referral'],true);
    assert.equal((await rpc(partner,'get_my_partner_referrals',['inactive'])).total,0);
    assert.equal((await rpc(partner,'get_my_partner_referrals',['active'])).total,2);
    const after = (await db.query('select growth_partner_id,referral_code,linked_at from public.growth_onboarding where user_id=$1',[users[3]])).rows[0];
    assert.deepEqual(after,before);
    assert.equal((await db.query('select count(*)::int as n from public.growth_referral_status_audit')).rows[0].n,4);
    await assert.rejects(local.asRequest({sub:partner,isAdmin:false},conn=>conn.query('select * from public.growth_referral_status_audit')), /permission denied/);
  } finally { await local.close(); }
});
