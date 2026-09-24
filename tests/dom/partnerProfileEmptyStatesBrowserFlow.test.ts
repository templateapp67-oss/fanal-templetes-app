import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerProfilePage } from '../../src/components/GrowthPartnerProfilePage';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';
import type { GrowthPartnerProfileClient } from '../../src/lib/growthPartnerProfile';

after(()=>dom.window.close());
const change=async(el:HTMLInputElement,value:string)=>{assert.ok(el);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
const click=async(el:Element|undefined|null,label?:string)=>{assert.ok(el,label||'element');await act(async()=>{(el as HTMLElement).click();});};
const wait=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(check(),'UI settled');};

test('profile shows protected fields read-only, persists profile + account settings together, and removes photo',async()=>{
  const id='a0000000-0000-4000-8000-000000000001';
  let profile:any={full_name:'Rahul',email:'rahul@example.com',phone:'+919876543210',partner_id:id,referral_code:'NEXORA-RAHUL25',account_status:'Active',partner_role:'Growth Partner',approval_status:'Approved',joined_at:'2026-09-01T00:00:00Z',photo_path:`${id}/a0000000-0000-4000-8000-000000000099.webp`};
  const rpcCalls:any[]=[],authCalls:any[]=[];
  const client:GrowthPartnerProfileClient={
    rpc:async(fn,args)=>{rpcCalls.push({fn,args});if(fn==='get_my_growth_partner_profile'||fn==='get_or_create_my_growth_partner_profile')return{data:profile,error:null};if(fn==='get_my_partner_account_settings')return{data:null,error:{message:'not configured'}};profile={...profile,...args!.p_patch as any};return{data:profile,error:null};},
    auth:{getUser:async()=>({data:{user:{id,email:profile.email}},error:null}),updateUser:async(args,opts)=>{authCalls.push({args,opts});return{data:{user:{id,email:profile.email}},error:null};}},
    storage:{from:()=>({upload:async()=>({error:null}),remove:async()=>({error:null}),getPublicUrl:path=>({data:{publicUrl:`https://images.example/${path}`}})})},
  };
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const input=(label:string)=>[...host.querySelectorAll('label')].find(el=>el.textContent?.startsWith(label))?.querySelector('input')!;
  const button=(label:string)=>[...host.querySelectorAll('button')].find(el=>el.textContent===label);
  try{
    await act(async()=>root.render(React.createElement(GrowthPartnerProfilePage,{client})));
    await wait(()=>!!input('Full Name'));
    for(const label of ['Partner Name','Email','Phone','Partner ID','Referral Code','Account status','Joined date','Profile Photo','Approval Status','Partner Role'])assert.ok(host.textContent!.includes(label),label);
    for(const protectedLabel of ['Partner ID','Partner Role','Referral Code','Approval Status'])assert.equal([...host.querySelectorAll('label')].some(el=>el.textContent?.startsWith(protectedLabel)),false);
    assert.equal(input('Full Name').value,'Rahul');assert.ok(host.querySelector('img[alt="Your profile photo"]'));
    // City/State/Address/binding: the account-settings fields persist WITH the
    // profile (one submit, two RPCs) — the old bug let them live in state only.
    await change(input('City Base'),'Bengaluru');
    await change(input('Full Name'),'Rahul Kumar');await change(input('Phone'),'+91 99887 76655');
    await click(button('Save Profile & Account Settings'),'save');await wait(()=>host.textContent!.includes('Profile and account settings saved.'));
    assert.deepEqual(rpcCalls.find(c=>c.fn==='save_my_growth_partner_profile').args,{p_patch:{full_name:'Rahul Kumar',phone:'+919988776655'}});
    const settingsCall=rpcCalls.find(c=>c.fn==='save_my_partner_account_settings');
    assert.ok(settingsCall,'account settings saved in the same submit');
    assert.equal(settingsCall.args.p_patch.city,'Bengaluru');
    assert.match(host.textContent!,/Rahul Kumar/);
    await click(button('Remove photo'),'remove-photo');await click(button('Save Profile & Account Settings'),'save-2');await wait(()=>profile.photo_path===null);
    assert.ok(host.querySelector('[aria-label="No profile photo"]'));
    // Unsupported image formats are rejected before any upload/save.
    const fileInput=input('Profile Photo');Object.defineProperty(fileInput,'files',{configurable:true,value:[new dom.window.File(['svg'],'avatar.svg',{type:'image/svg+xml'})]});
    await act(async()=>fileInput.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
    assert.match(host.textContent!,/Choose a JPG, PNG or WebP/);
    // Email changes moved to Account Settings: the profile page renders the
    // address read-only in the summary and hands off via the Account Settings
    // link — it never edits auth identity from here.
    assert.ok(host.textContent!.includes('rahul@example.com'));
    assert.ok(host.querySelector('[data-summary-account-settings-link]'),'the Account Settings hand-off link exists');
    assert.equal([...host.querySelectorAll('label')].some(el=>el.textContent?.startsWith('New email')),false,'no email-change form on the profile page');
    assert.ok(rpcCalls.filter(c=>c.fn==='save_my_growth_partner_profile').every(c=>!('email' in c.args.p_patch)));
    assert.equal(authCalls.length,0,'no auth email mutation from the profile page');
  }finally{await act(async()=>root.unmount());host.remove();}
});

test('empty referrals copy the real link; unmatched searches clear both criteria and form controls',async()=>{
  const oldFetch=globalThis.fetch;const copies:string[]=[];let denyCopy=false;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{if(denyCopy)throw new Error('denied');copies.push(text);}}});
  const calls:any[]=[];
  globalThis.fetch=async(url,init)=>{
    const fn=String(url).split('/').at(-1);const args=JSON.parse(String(init?.body||'{}'));
    if(fn==='get_my_growth_partner')return Response.json({user_id:'partner',referral_code:'NEXORA-RAHUL25',is_active:true});
    if(fn==='get_my_partner_dashboard')return Response.json({partner:{referral_code:'NEXORA-RAHUL25',is_active:true},kpis:{total_referrals:0,completed:0,active_onboarding:0},recent_activity:[]});
    if(fn==='get_my_partner_referrals'){calls.push(args);return Response.json({total:0,limit:20,offset:0,rows:[],status_counts:{all:0,pending:0,active:0,converted:0,inactive:0}});}
    return new Response('{}',{status:400});
  };
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const button=(label:string)=>[...host.querySelectorAll('button')].find(el=>el.textContent===label);
  try{
    await act(async()=>root.render(React.createElement(GrowthPartnerPage,{user:{id:'partner',email:'partner@example.com'},path:'/partner/referrals',navigate(){},onLogout(){}} as any)));
    await wait(()=>!!button('Copy Referral Link'));
    assert.match(host.textContent!,/No referrals yet\./);assert.match(host.textContent!,/Start sharing your referral link to grow your network\./);
    await click(button('Copy Referral Link'));assert.deepEqual(copies,['http://localhost:3000/signup?ref=NEXORA-RAHUL25']);
    assert.match(host.textContent!,/Referral link copied/);
    denyCopy=true;await click(button('Copy Referral Link'));
    assert.equal(host.querySelector<HTMLInputElement>('[aria-label="Referral link to copy manually"]')?.value,'http://localhost:3000/signup?ref=NEXORA-RAHUL25');
    const search=host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await change(search,'nobody');await click(button('Apply filters'));
    await wait(()=>host.textContent!.includes('No matching referrals found.'));
    assert.equal(calls.at(-1).p_search,'nobody');assert.equal(button('Copy Referral Link'),undefined);
    await click(button('Clear Filters'));await wait(()=>host.textContent!.includes('No referrals yet.'));
    assert.equal(calls.at(-1).p_search,null);assert.equal(calls.at(-1).p_status_filter,'all');assert.equal(calls.at(-1).p_offset,0);
    assert.equal(search.value,'');assert.ok(button('Copy Referral Link'));
  }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
