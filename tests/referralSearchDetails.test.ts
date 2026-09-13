import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase';
import { DEFAULT_REFERRAL_FILTERS, referralDateBounds } from '../src/lib/referralFilters';

test('date presets use inclusive local calendar days and validate custom ranges', () => {
  const now = new Date(2026, 8, 13, 16, 30);
  const bounds = (datePreset: any, extra = {}) => referralDateBounds({...DEFAULT_REFERRAL_FILTERS,datePreset,...extra},now);
  assert.deepEqual(bounds('all'),{});
  assert.deepEqual(bounds('today'),{joinedFrom:new Date(2026,8,13).toISOString(),joinedBefore:new Date(2026,8,14).toISOString()});
  assert.equal(bounds('last7').joinedFrom,new Date(2026,8,7).toISOString());
  assert.equal(bounds('last30').joinedFrom,new Date(2026,7,15).toISOString());
  assert.deepEqual(bounds('custom',{startDate:'2026-09-01',endDate:'2026-09-13'}),{joinedFrom:new Date(2026,8,1).toISOString(),joinedBefore:new Date(2026,8,14).toISOString()});
  for (const extra of [{startDate:'',endDate:''},{startDate:'2026-02-30',endDate:'2026-03-01'},{startDate:'2026-09-14',endDate:'2026-09-13'}]) assert.throws(()=>bounds('custom',extra));
});

test('database search/filter/sort, masked own-referral details and durable recorded timeline', async () => {
  const local = await createLocalDatabase(); const db = local.db;
  const rpc = (actor: string | null, fn: string, args: any[] = []): Promise<any> => local.asRequest({sub:actor,isAdmin:false},async conn =>
    (await conn.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r);
  const user = async (name: string,email: string, created: string, token?: string) => {
    const id=randomUUID();
    await db.query("insert into auth.users(id,email,encrypted_password,created_at,raw_user_meta_data) values($1,$2,'SECRET-PASSWORD',$3,$4::jsonb)",[id,email,created,JSON.stringify({full_name:name,growth_referral_token:token,secret:'SECRET-TOKEN'})]);
    return id;
  };
  const search = (actor:string, term:string|null=null, from:string|null=null, before:string|null=null, conversion='all',sort='newest',status='all',limit=20,offset=0) =>
    rpc(actor,'get_my_partner_referrals_filtered',[status,term,limit,offset,from,before,conversion,sort]);
  try {
    const partner=await user('Partner','partner@example.com','2026-08-01T00:00:00Z');
    const other=await user('Other','other@example.com','2026-08-01T00:00:00Z');
    await db.query("select public.provision_growth_partner($1,'NEXORA-RAHUL25')",[partner]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-OTHER25')",[other]);
    const captured=await rpc(null,'capture_growth_referral',['NEXORA-RAHUL25',null]);
    await db.query("update public.growth_referral_attributions set created_at='2026-09-01T08:00:00Z' where token_hash=md5($1)",[captured.token]);
    const a=await user('Rahul','rahul@gmail.com','2026-09-01T09:00:00Z',captured.token);
    const b=await user('Anita','anita@example.com','2026-09-07T00:00:00Z');
    const c=await user('Casey','casey@example.com','2026-09-13T23:59:59Z');
    const d=await user('Hidden user','hidden@example.com','2026-09-13T12:00:00Z');
    for (const id of [b,c]) await rpc(id,'link_my_growth_referral',['NEXORA-RAHUL25']);
    await rpc(d,'link_my_growth_referral',['NEXORA-OTHER25']);
    await db.query("update public.growth_onboarding set status='template_started',template_started_at=now()+interval '2 days' where user_id=$1",[b]);
    await db.query("update public.growth_onboarding set status='template_completed',template_started_at=now(),template_completed_at=now()+interval '1 day' where user_id=$1",[a]);
    for (const term of ['RAHUL','rahul@gmail.com','nexora-rahul25']) {
      const result=await search(partner,term); assert.ok(result.total>0);
      assert.ok(!JSON.stringify(result).includes('rahul@gmail.com'));
      assert.ok(!JSON.stringify(result).includes('SECRET-'));
    }
    for (const term of ['hidden@example.com','NEXORA-OTHER25','%','_',"' OR true --"]) assert.equal((await search(partner,term)).total,0);
    assert.deepEqual((await search(partner,null,null,null,'all','newest')).rows.map((r:any)=>r.display_name),['Casey','Anita','Rahul']);
    assert.deepEqual((await search(partner,null,null,null,'all','oldest')).rows.map((r:any)=>r.display_name),['Rahul','Anita','Casey']);
    assert.equal((await search(partner,null,null,null,'all','recently_active')).rows[0].display_name,'Anita');
    const range=await search(partner,null,'2026-09-07T00:00:00Z','2026-09-14T00:00:00Z');
    assert.equal(range.total,2); assert.equal(range.status_counts.all,2);
    assert.equal((await search(partner,null,null,'2026-09-07T00:00:00Z')).total,1,'upper date boundary is exclusive');
    const converted=await search(partner,null,null,null,'converted');
    assert.equal(converted.total,1); assert.equal(converted.status_counts.all,1);
    assert.equal((await search(partner,null,null,null,'not_converted')).total,2);
    assert.equal((await search(partner,null,null,null,'converted','newest','pending')).total,0);
    const paged=await search(partner,null,null,null,'all','oldest','all',1,1);
    assert.equal(paged.total,3); assert.equal(paged.rows[0].display_name,'Anita'); assert.equal(paged.status_counts.all,3);
    for (const args of [[null,'2026-09-14','2026-09-01','all','newest'],[null,null,null,'wrong','newest'],[null,null,null,'all','wrong']] as const)
      await assert.rejects(search(partner,...args),/Invalid referral filters/);
    const referral=converted.rows[0];
    assert.notEqual(referral.referral_id,a,'record ID is independent from auth identity');
    const detail=await rpc(partner,'get_my_partner_referral_detail',[referral.referral_id]);
    assert.equal(detail.masked_contact,'ra***@gmail.com'); assert.equal(detail.referral_code,'NEXORA-RAHUL25');
    assert.equal(new Date(detail.referral_clicked_at).toISOString(),'2026-09-01T08:00:00.000Z');
    assert.ok(detail.template_started_at && detail.template_completed_at);
    assert.ok(!JSON.stringify(detail).includes(a)); assert.ok(!JSON.stringify(detail).includes('SECRET-'));
    await db.query('delete from public.growth_referral_attributions where consumed_by=$1',[a]);
    assert.equal((await rpc(partner,'get_my_partner_referral_detail',[referral.referral_id])).referral_clicked_at,detail.referral_clicked_at);
    const manual=(await search(partner,'Anita')).rows[0];
    assert.equal((await rpc(partner,'get_my_partner_referral_detail',[manual.referral_id])).referral_clicked_at,null);
    assert.equal(await rpc(other,'get_my_partner_referral_detail',[referral.referral_id]),null);
    assert.equal(await rpc(partner,'get_my_partner_referral_detail',[randomUUID()]),null);
    await assert.rejects(rpc(null,'get_my_partner_referral_detail',[referral.referral_id]),/permission denied/);
    await assert.rejects(rpc(a,'get_my_partner_referral_detail',[referral.referral_id]),/Growth Partner access required/);
    await db.query('update public.growth_partners set is_active=false where user_id=$1',[partner]);
    await assert.rejects(search(partner),/paused/);
    await assert.rejects(rpc(partner,'get_my_partner_referral_detail',[referral.referral_id]),/paused/);
  } finally { await local.close(); }
});
