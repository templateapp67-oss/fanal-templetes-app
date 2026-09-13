import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createLocalDatabase } from '../server/localSupabase';

test('dashboard camelCase aggregates are caller-scoped, independent of pagination/events, and retain lifecycle semantics', async () => {
  const local = await createLocalDatabase(), db = local.db;
  const rpc = (actor: string | null, fn: string, args: any[] = [], admin = false): Promise<any> => local.asRequest({sub: actor, isAdmin: admin}, async conn =>
    (await conn.query(`select public.${fn}(${args.map((_,i) => `$${i+1}`).join(',')}) as r`, args)).rows[0].r);
  const user = async () => {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password) values($1,$2,'test-only')", [id, `${id}@example.com`]);
    return id;
  };
  const metrics = (data: any) => [data.totalReferrals, data.activeReferrals, data.pendingReferrals, data.convertedReferrals];
  try {
    const a = await user(), b = await user(), ordinary = await user();
    await db.query("select public.provision_growth_partner($1,'NEXORA-METRICA')", [a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-METRICB')", [b]);
    assert.deepEqual(metrics(await rpc(a, 'get_my_partner_dashboard')), [0,0,0,0]);
    const ids: string[] = [];
    for (let i=0; i<7; i++) {
      const id = await user(); ids.push(id);
      await rpc(id, 'link_my_growth_referral', [i===6 ? 'NEXORA-METRICB' : 'NEXORA-METRICA']);
    }
    await db.query("update public.growth_onboarding set status='template_started',template_started_at=now() where user_id=$1", [ids[1]]);
    await db.query("update public.growth_onboarding set status='template_completed',template_started_at=now(),template_completed_at=now() where user_id=$1", [ids[2]]);
    for (const [i,status] of [[3,'inactive'],[4,'cancelled'],[5,'rejected']] as const)
      await rpc(a, 'admin_set_growth_referral_status', [ids[i], status, 'Verified test disposition'], true);
    await rpc(null, 'capture_growth_referral', ['NEXORA-METRICA', null]);
    const result = await rpc(a, 'get_my_partner_dashboard');
    assert.deepEqual(metrics(result), [6,1,1,1]);
    assert.equal(result.kpis.total_referrals, result.totalReferrals);
    assert.equal(result.referral_status_counts.active, result.activeReferrals);
    assert.deepEqual(metrics(await rpc(b, 'get_my_partner_dashboard')), [1,0,1,0]);
    const page = await rpc(a, 'get_my_partner_referrals', ['all', null, 1, 0]);
    assert.equal(page.rows.length, 1);
    assert.deepEqual(metrics(await rpc(a, 'get_my_partner_dashboard')), [6,1,1,1]);
    // Disposition overrides current lifecycle counts without erasing a past conversion.
    await rpc(a, 'admin_set_growth_referral_status', [ids[2], 'inactive', 'Pause after verified conversion'], true);
    assert.deepEqual(metrics(await rpc(a, 'get_my_partner_dashboard')), [6,1,1,0]);
    assert.equal((await rpc(a, 'get_my_partner_dashboard')).kpis.completed, 1);
    await assert.rejects(rpc(null, 'get_my_partner_dashboard'), /permission denied/);
    await assert.rejects(rpc(ordinary, 'get_my_partner_dashboard'));
    await db.query('update public.growth_partners set is_active=false where user_id=$1', [a]);
    await assert.rejects(rpc(a, 'get_my_partner_dashboard'), /inactive|paused/i);
    await db.exec(readFileSync(new URL('../supabase/migrations/20260930_partner_dashboard_metrics.sql', import.meta.url), 'utf8'));
    assert.deepEqual(metrics(await rpc(b, 'get_my_partner_dashboard')), [1,0,1,0]);
  } finally { await local.close(); }
});
