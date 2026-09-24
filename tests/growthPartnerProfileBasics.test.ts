import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase';
import { fetchGrowthPartnerProfile, saveGrowthPartnerProfile, requestGrowthPartnerEmailChange, growthPartnerPhotoUrl, type GrowthPartnerProfileClient } from '../src/lib/growthPartnerProfile';

test('profile RPCs scope to the active caller and reject every protected attribute', async () => {
  const local=await createLocalDatabase(), db=local.db;
  const user=async(name:string)=>{const id=randomUUID();await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'SECRET-PASSWORD',$3::jsonb)",[id,`${name}@example.com`,JSON.stringify({full_name:name,secret:'SECRET-TOKEN'})]);return id;};
  const rpc=(actor:string|null,fn:string,args:any[]=[]):Promise<any>=>local.asRequest({sub:actor,isAdmin:false},async conn=>(await conn.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).rows[0].r);
  try {
    const a=await user('Rahul'), b=await user('Anita'), normal=await user('Visitor');
    await db.query("select public.provision_growth_partner($1,'NEXORA-RAHUL25')",[a]);
    await db.query("select public.provision_growth_partner($1,'NEXORA-ANITA25')",[b]);
    const before=await rpc(a,'get_my_growth_partner_profile');
    assert.deepEqual(Object.keys(before).sort(),['full_name','email','phone','photo_path','partner_id','referral_code','account_status','partner_role','approval_status','joined_at'].sort());
    assert.equal(before.partner_id,a); assert.equal(before.email,'Rahul@example.com'); assert.equal(before.full_name,'Rahul');
    assert.ok(!JSON.stringify(before).includes('SECRET-')); assert.ok(!JSON.stringify(before).includes(b));
    const saved=await rpc(a,'save_my_growth_partner_profile',[{full_name:'  Rahul Kumar  ',phone:'+91 (98765) 43210'}]);
    assert.equal(saved.full_name,'Rahul Kumar');assert.equal(saved.phone,'+919876543210');
    assert.equal(saved.referral_code,before.referral_code);assert.equal(saved.partner_id,a);assert.equal(saved.joined_at,before.joined_at);
    assert.equal((await rpc(b,'get_my_growth_partner_profile')).full_name,'Anita');
    for(const key of ['partner_id','user_id','id','role','partner_role','referral_code','approval_status','status','is_active','email','account_status','joined_at']){
      await assert.rejects(rpc(a,'save_my_growth_partner_profile',[{full_name:'Hijacked',[key]:b}]),/Only full name/);
    }
    for(const patch of [{full_name:''},{full_name:'x'.repeat(121)},{full_name:null},{phone:'bad phone'},{photo_path:'https://evil.test/x.jpg'},{phone:{}},[]])await assert.rejects(rpc(a,'save_my_growth_partner_profile',[patch]));
    assert.equal((await rpc(a,'get_my_growth_partner_profile')).full_name,'Rahul Kumar');
    assert.equal((await rpc(a,'get_my_growth_partner_profile')).email,'Rahul@example.com','email cannot be changed through profile data');
    await assert.rejects(rpc(a,'get_my_growth_partner_profile',[b]),/does not exist/);
    await assert.rejects(rpc(normal,'get_my_growth_partner_profile'),/Growth Partner access required/);
    await assert.rejects(rpc(normal,'save_my_growth_partner_profile',[{full_name:'Visitor'}]),/Growth Partner access required/);
    await assert.rejects(rpc(null,'get_my_growth_partner_profile'),/permission denied/);
    await assert.rejects(rpc(null,'save_my_growth_partner_profile',[{full_name:'Anonymous'}]),/permission denied/);
    // Simulate the Storage metadata contract; files still need real Storage in production.
    await db.exec('create schema storage; create table storage.objects(bucket_id text,name text)');
    const ownPath=`${a}/${randomUUID()}.webp`, otherPath=`${b}/${randomUUID()}.webp`;
    await db.query("insert into storage.objects(bucket_id,name) values('partner-avatars',$1),('partner-avatars',$2)",[ownPath,otherPath]);
    assert.equal((await rpc(a,'save_my_growth_partner_profile',[{photo_path:ownPath}])).photo_path,ownPath);
    await assert.rejects(rpc(a,'save_my_growth_partner_profile',[{photo_path:otherPath}]),/own account folder/);
    await assert.rejects(rpc(a,'save_my_growth_partner_profile',[{photo_path:`${a}/${randomUUID()}.png`}]),/Upload the profile photo/);
    assert.equal((await rpc(a,'save_my_growth_partner_profile',[{photo_path:null,phone:null}])).photo_path,null);
    await assert.rejects(local.asRequest({sub:a,isAdmin:false},conn=>conn.query("update public.growth_partners set referral_code='NEXORA-HACKED' where user_id=$1",[a])),/permission denied/);
    await db.query('update public.growth_partners set is_active=false where user_id=$1',[a]);
    await assert.rejects(rpc(a,'save_my_growth_partner_profile',[{full_name:'Paused'}]),/paused/);
  } finally {await local.close();}
});

test('profile client only sends basic fields, uploads to the session owner and uses Auth for email changes', async () => {
  const id=randomUUID();let saved:any={partner_id:id,full_name:'Rahul',phone:null,photo_path:null,email:'rahul@example.com'};
  const calls:any[]=[], uploads:any[]=[], removed:string[][]=[];
  let failSave=false, lostResponse=false;
  const client:GrowthPartnerProfileClient={
    auth:{getUser:async()=>({data:{user:{id,email:'rahul@example.com'}},error:null}),updateUser:async(attributes,options)=>{calls.push({auth:attributes,options});return{data:{user:{id}},error:null};}},
    rpc:async(fn,args)=>{
      calls.push({fn,args});if(fn==='get_my_growth_partner_profile')return{data:saved,error:null};
      if(failSave)return{data:null,error:{message:'failed'}};
      const patch=args!.p_patch as any;saved={...saved,...patch};
      return lostResponse?{data:null,error:{message:'lost response'}}:{data:saved,error:null};
    },
    storage:{from:bucket=>({upload:async(path,file,options)=>{uploads.push({bucket,path,file,options});return{error:null};},remove:async(paths)=>{removed.push(paths);return{error:null};},getPublicUrl:path=>({data:{publicUrl:`https://example.supabase.co/storage/v1/object/public/${bucket}/${path}`}})})},
  };
  await saveGrowthPartnerProfile({fullName:'Rahul Kumar',phone:'+91 98765 43210',expectedUserId:id},client);
  // A temporary offline/demo partner id must not override the authenticated user.
  await saveGrowthPartnerProfile({fullName:'Rahul Kumar',phone:'+91 98765 43210',expectedUserId:'ptr-active-partner'},client);
  const patchCall=calls.find(c=>c.fn==='save_my_growth_partner_profile');
  assert.deepEqual(patchCall.args,{p_patch:{full_name:'Rahul Kumar',phone:'+919876543210'}});
  const photo=new Blob(['image bytes'],{type:'image/webp'});
  const withPhoto=await saveGrowthPartnerProfile({fullName:'Rahul',phone:'',expectedUserId:id,photo},client);
  assert.ok(withPhoto.photo_path.startsWith(`${id}/`));assert.equal(uploads[0].bucket,'partner-avatars');assert.equal(uploads[0].options.upsert,false);
  assert.ok(growthPartnerPhotoUrl(withPhoto.photo_path,client).startsWith('https://example.supabase.co/'));
  assert.equal(growthPartnerPhotoUrl('https://evil.test/pic',client),'');
  await assert.rejects(saveGrowthPartnerProfile({fullName:'Rahul',phone:'',expectedUserId:'another-account'},client),/session changed/);
  await assert.rejects(saveGrowthPartnerProfile({fullName:'Rahul',phone:'',expectedUserId:id,photo:new Blob(['svg'],{type:'image/svg+xml'})},client),/JPG, PNG or WebP/);
  failSave=true;
  await assert.rejects(saveGrowthPartnerProfile({fullName:'Rahul',phone:'',expectedUserId:id,photo},client),/Could not save/);
  assert.equal(removed.length,1,'confirmed uncommitted upload cleaned up');
  failSave=false;lostResponse=true;
  const recovered=await saveGrowthPartnerProfile({fullName:'Rahul',phone:'',expectedUserId:id,photo},client);
  assert.ok(recovered.photo_path);assert.equal(removed.length,1,'committed photo not deleted after response loss');
  lostResponse=false;
  await saveGrowthPartnerProfile({fullName:'Rahul',phone:'',expectedUserId:id,removePhoto:true},client);
  assert.equal((await fetchGrowthPartnerProfile(client)).photo_path,null);
  await requestGrowthPartnerEmailChange('new@example.com',id,client);
  assert.deepEqual(calls.find(c=>c.auth).auth,{email:'new@example.com'});
  assert.equal(saved.email,'rahul@example.com','no direct/optimistic auth-email mutation');
  await assert.rejects(requestGrowthPartnerEmailChange('bad',id,client),/valid email/);
  await assert.rejects(requestGrowthPartnerEmailChange('rahul@example.com',id,client),/different email/);
});
