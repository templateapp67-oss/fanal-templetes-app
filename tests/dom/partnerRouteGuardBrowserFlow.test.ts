import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';
import { PartnerRouteGuard } from '../../src/components/PartnerRouteGuard';
import { GROWTH_PARTNER_SECTIONS, growthPartnerPath, PARTNER_PORTAL_SECTIONS, partnerPortalPath } from '../../src/lib/router';

after(() => dom.window.close());
const settle = async (check:()=>boolean) => {
  for (let i=0;i<100&&!check();i++) await act(async()=>{await new Promise(r=>setTimeout(r,5));});
  assert.ok(check(),'guard settled');
};

test('every canonical and legacy partner page blocks denied accounts before private reads and redirects expired sessions',async()=>{
  const oldFetch=globalThis.fetch;
  const paths=[...PARTNER_PORTAL_SECTIONS.map(partnerPortalPath),...GROWTH_PARTNER_SECTIONS.map(growthPartnerPath),'/partner'];
  try {
    for(const state of ['anonymous','normal','suspended','pending','rejected','expired'] as const) {
      for(const path of paths) {
        const privateCalls:string[]=[], navigated:string[]=[];
        globalThis.fetch=async url=>{
          const fn=new URL(String(url),'http://localhost').pathname.split('/').at(-1)!;
          if(fn==='get_my_growth_partner') return state==='expired'
            ? Response.json({code:'PGRST301',message:'JWT expired'},{status:401})
            : Response.json(state==='suspended'?{user_id:'partner',is_active:false,referral_code:'PRIVATE-CODE'}:null);
          if(fn==='growth_partner_applications') return Response.json(state==='pending'||state==='rejected'?[{status:state}]:[]);
          if(fn.startsWith('get_my_partner_')||fn==='get_my_growth_partner_profile')privateCalls.push(fn);
          return Response.json({});
        };
        const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
        try {
          await act(async()=>root.render(React.createElement(GrowthPartnerPage,{path,user:state==='anonymous'?null:{id:'partner'},navigate:(to:string)=>navigated.push(to)})));
          if(state==='anonymous'||state==='expired') {
            await settle(()=>navigated.length>0);
            assert.equal(navigated.at(-1),path.startsWith('/growth-partner')?'/growth-partner/login':'/partner/login');
          } else {
            const expected={normal:'Growth Partners only',suspended:'Your Growth Partner account is currently suspended.',pending:'Your Growth Partner application is under review.',rejected:'Your Growth Partner application was not approved.'}[state];
            await settle(()=>!!host.textContent?.includes(expected));
          }
          assert.deepEqual(privateCalls,[],`${state} must not fetch private data at ${path}`);
          assert.doesNotMatch(host.textContent!,/PRIVATE-CODE|Total Referrals|Referred Users/);
        } finally {await act(async()=>root.unmount());host.remove();}
      }
    }
  } finally {globalThis.fetch=oldFetch;}
});

test('pending approval retries the same shared gate before loading the dashboard',async()=>{
  const oldFetch=globalThis.fetch;let approved=false,metrics=0;
  globalThis.fetch=async url=>{
    const fn=new URL(String(url),'http://localhost').pathname.split('/').at(-1);
    if(fn==='get_my_growth_partner')return Response.json(approved?{user_id:'partner',is_active:true,referral_code:'NEXORA-APPROVED'}:null);
    if(fn==='growth_partner_applications')return Response.json([{status:'pending'}]);
    if(fn==='get_my_partner_dashboard'){metrics++;return Response.json({partner:{is_active:true,referral_code:'NEXORA-APPROVED'},kpis:{total_referrals:7},recent_activity:[]});}
    return Response.json({});
  };
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(React.createElement(GrowthPartnerPage,{path:'/partner/dashboard',user:{id:'partner'},navigate(){}})));
    await settle(()=>!!host.textContent?.includes('under review'));
    assert.equal(metrics,0);approved=true;
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Check status')!.click());
    await settle(()=>!!host.textContent?.includes('Total Referrals'));
    assert.equal(metrics,1);assert.match(host.textContent!,/NEXORA-APPROVED/);
  } finally {await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});

test('guard never mounts denied children, and switching identities hides cached private content synchronously',async()=>{
  const oldFetch=globalThis.fetch;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  let mounts=0,resolveB!:(r:Response)=>void, actor='a';
  const privateChild=()=>{mounts++;return React.createElement('p',null,'PRIVATE CHILD');};
  try {
    for(const gate of ['loading','unauthenticated','unauthorized','pending','rejected','inactive','error','session-expired'] as const) {
      await act(async()=>root.render(React.createElement(PartnerRouteGuard,{gate},React.createElement(privateChild))));
      assert.equal(mounts,0);
    }
    await act(async()=>root.render(React.createElement(PartnerRouteGuard,{gate:'ready'},React.createElement(privateChild))));
    assert.equal(mounts,1);
    globalThis.fetch=async url=>{
      const fn=new URL(String(url),'http://localhost').pathname.split('/').at(-1);
      if(fn==='get_my_growth_partner')return actor==='a'?Response.json({user_id:'a',is_active:true,referral_code:'NEXORA-PRIVATEA'}):new Promise<Response>(r=>resolveB=r);
      if(fn==='growth_partner_applications')return Response.json([{status:'rejected'}]);
      return Response.json({partner:{is_active:true,referral_code:'NEXORA-PRIVATEA'},kpis:{total_referrals:44},recent_activity:[]});
    };
    await act(async()=>root.render(React.createElement(GrowthPartnerPage,{path:'/partner/dashboard',user:{id:'a'},navigate(){}})));
    await settle(()=>!!host.textContent?.includes('NEXORA-PRIVATEA'));
    actor='b';
    await act(async()=>root.render(React.createElement(GrowthPartnerPage,{path:'/partner/dashboard',user:{id:'b'},navigate(){}})));
    assert.doesNotMatch(host.textContent!,/NEXORA-PRIVATEA|Total Referrals/);
    await act(async()=>resolveB(Response.json(null)));
    await settle(()=>!!host.textContent?.includes('was not approved'));
    assert.doesNotMatch(host.textContent!,/NEXORA-PRIVATEA|Total Referrals/);
  } finally {await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
