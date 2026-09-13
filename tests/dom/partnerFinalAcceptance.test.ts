import './jsdomSetup';
import { dom, nativeFetch } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CookieJar } from 'jsdom';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { registerLocalSupabaseGateway, LOCAL_DEV_ADMIN_EMAIL, LOCAL_DEV_ADMIN_PASSWORD } from '../../server/localSupabase';
import { registerReferralAttributionRoutes } from '../../server/referralAttribution';
import { supabase } from '../../src/lib/supabaseClient';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';
import { OnboardingApp } from '../../src/onboarding/OnboardingApp';

after(()=>dom.window.close());

// No API responses, Auth results, SQL results or app service functions are mocked.
// The adapter supplies browser cookie behavior and maps the unit-test SDK origin
// to the isolated gateway. Clipboard is the only simulated browser capability.
test('Section 40: all fifteen acceptance steps through React, real HTTP/Auth/RPC/RLS and disk-backed PostgreSQL', {timeout:120000}, async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'partner-acceptance-'));
  const oldFetch=globalThis.fetch, oldClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  let origin='',port=0,server:Server|undefined,closeDb:(()=>Promise<void>)|undefined;
  const jars={partner:new CookieJar(),visitor:new CookieJar()};
  let browser:'partner'|'visitor'='partner',clipboard='';
  const requests:{path:string;method:string;status:number;args?:Record<string,unknown>}[]=[];
  const steps:number[]=[];
  const passed=(n:number)=>{steps.push(n);t.diagnostic(`Acceptance step ${n} passed`);};
  let clientIndex=0;
  const client=()=>createClient(origin,'local-dev-key',{auth:{storageKey:`acceptance-${clientIndex++}`,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:nativeFetch}});
  const boot=async()=>{
    const app=express();app.use(express.json());
    const gateway=await registerLocalSupabaseGateway(app,{dataDir,log:()=>{}});closeDb=gateway.close;
    server=createServer(app);await new Promise<void>(resolve=>server!.listen(port,'127.0.0.1',resolve));
    port=(server.address() as AddressInfo).port;origin=`http://127.0.0.1:${port}`;
    const anonymous=client();
    registerReferralAttributionRoutes(app,(fn,args)=>anonymous.rpc(fn,args));
  };
  const stop=async()=>{
    if(server){await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server=undefined;}
    if(closeDb){await closeDb();closeDb=undefined;}
  };
  const host=document.createElement('div');document.body.append(host);
  let root:Root|undefined;
  const unmount=async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}};
  const render=async(node:React.ReactNode)=>{await unmount();root=createRoot(host);await act(async()=>root!.render(node));};
  const wait=async(check:()=>boolean,label:string)=>{
    for(let i=0;i<400&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    assert.ok(check(),`Acceptance flow did not reach: ${label}. Screen: ${host.textContent?.slice(0,1200)}`);
  };
  const click=async(element:Element|null|undefined)=>{assert.ok(element,'required UI control exists');await act(async()=>{(element as HTMLElement).click();});};
  const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);
  const fill=async(selector:string,value:string)=>{
    const input=host.querySelector<HTMLInputElement>(selector);assert.ok(input,selector);
    await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  };
  const submit=async(selector='form')=>{const form=host.querySelector(selector);assert.ok(form,selector);await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});};
  function PartnerBrowser({initialPath}:{initialPath:string}) {
    const [path,setPath]=useState(initialPath),[user,setUser]=useState<any>(null),[restoring,setRestoring]=useState(true);
    const navigate=(next:string)=>{window.history.replaceState(null,'',next);setPath(next);};
    useEffect(()=>{
      let mounted=true;
      void supabase.auth.getSession().then(({data})=>{if(mounted){setUser(data.session?.user??null);setRestoring(false);}});
      const {data}=supabase.auth.onAuthStateChange((_event,session)=>{if(mounted)setUser(session?.user??null);});
      return()=>{mounted=false;data.subscription.unsubscribe();};
    },[]);
    return restoring?React.createElement('p',null,'Restoring session'):React.createElement(GrowthPartnerPage,{path,user,navigate,onLogout:()=>{void supabase.auth.signOut().then(()=>navigate('/partner/login'));}});
  }
  let visitor:ReturnType<typeof client>|undefined;
  function VisitorBrowser({initialPath}:{initialPath:string}) {
    const [path,setPath]=useState(initialPath);
    return React.createElement(OnboardingApp,{path,client:visitor as any,navigate:(next:string)=>{window.history.replaceState(null,'',next);setPath(next);}});
  }
  try {
    await boot();dom.reconfigure({url:`${origin}/partner/login`});
    globalThis.fetch=async(input,init)=>{
      const originalUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      const url=new URL(originalUrl,origin);
      assert.ok(/^\/(auth\/v1|rest\/v1|api\/referral-attribution)(\/|$)/.test(url.pathname),'only local app APIs may be requested');
      const target=`${origin}${url.pathname}${url.search}`;
      const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
      const jar=jars[browser];const cookie=jar.getCookieStringSync(target);if(cookie)headers.set('cookie',cookie);
      if(url.pathname==='/api/referral-attribution')headers.set('origin',origin);
      const response=await nativeFetch(target,{...init,headers});
      for(const value of response.headers.getSetCookie())jar.setCookieSync(value,target);
      requests.push({path:url.pathname,method:init?.method||'GET',status:response.status,
        ...(url.pathname.startsWith('/rest/v1/rpc/')?{args:JSON.parse(String(init?.body||'{}'))}:{})});
      return response;
    };
    window.fetch=globalThis.fetch as any;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{clipboard=value;}}});
    await supabase.auth.stopAutoRefresh();
    const admin=client();assert.equal((await admin.auth.signInWithPassword({email:LOCAL_DEV_ADMIN_EMAIL,password:LOCAL_DEV_ADMIN_PASSWORD})).error,null);
    const partnerSeed=client(),otherSeed=client(),peer=client();
    const created=await partnerSeed.auth.signUp({email:'acceptance.partner@example.com',password:'AcceptancePass!42',options:{data:{full_name:'Acceptance Partner'}}});
    const other=await otherSeed.auth.signUp({email:'acceptance.other@example.com',password:'AcceptancePass!42',options:{data:{full_name:'Other Partner'}}});
    assert.ok(created.data.user?.id);assert.ok(other.data.user?.id);
    const provisioned=await admin.rpc('provision_growth_partner',{p_user_id:created.data.user!.id,p_active:true});
    const second=await admin.rpc('provision_growth_partner',{p_user_id:other.data.user!.id,p_active:true});
    assert.equal(provisioned.error,null);assert.equal(second.error,null);
    const code=provisioned.data.referral_code,otherCode=second.data.referral_code;
    assert.match(code,/^NEXORA-[A-Z0-9]+$/);assert.notEqual(code,otherCode);
    const peerSignup=await peer.auth.signUp({email:'peer.private@example.com',password:'AcceptancePass!42',options:{data:{full_name:'Peer Private Customer'}}});
    assert.ok(peerSignup.data.user);
    assert.equal((await peer.rpc('link_my_growth_referral',{p_code:otherCode})).error,null);
    const peerList=await otherSeed.rpc('get_my_partner_referrals');
    assert.equal(peerList.data.total,1);const peerReferralId=peerList.data.rows[0].referral_id;
    passed(1);

    await render(React.createElement(PartnerBrowser,{initialPath:'/partner/login'}));
    await wait(()=>!!host.querySelector('#partner-login-email'),'partner login form');
    await fill('#partner-login-email','acceptance.partner@example.com');await fill('#partner-login-password','AcceptancePass!42');
    await submit();
    await wait(()=>window.location.pathname==='/partner/dashboard','partner login redirect');passed(2);
    await wait(()=>!!host.querySelector('[aria-label="Referral summary"]'),'dashboard overview');passed(3);
    assert.ok(host.textContent!.includes(code));
    assert.ok(!host.textContent!.includes(otherCode));passed(4);
    // Future modules are labels only: no link, button, input or live control.
    for(const item of host.querySelectorAll('[data-partner-planned]'))assert.equal(item.querySelector('a,button,input'),null);
    await click(host.querySelector('[data-partner-nav="referral-code"]'));
    await wait(()=>!!host.querySelector('[aria-label="Your referral link"]'),'referral-link screen');
    await click(button('Copy Link'));
    await wait(()=>clipboard.includes('/signup?ref='),'clipboard referral URL');
    assert.equal(new URL(clipboard).searchParams.get('ref'),code);
    assert.equal(host.querySelector('[role="status"]')?.textContent,'Referral link copied');passed(5);

    await unmount();browser='visitor';visitor=client();
    window.history.replaceState(null,'',clipboard);await render(React.createElement(VisitorBrowser,{initialPath:'/signup'}));passed(6);
    await wait(()=>!!host.querySelector('#onboarding-signup-email'),'visitor signup after validation');
    assert.ok(requests.some(r=>r.path==='/api/referral-attribution'&&r.method==='POST'&&r.status===200));
    const referralCookie=jars.visitor.getCookiesSync(`${origin}/signup`).find(c=>c.key==='nexora_referral');
    assert.ok(referralCookie?.httpOnly);assert.equal(referralCookie!.sameSite,'lax');passed(7);
    // A real remount without ?ref keeps the capability in the visitor cookie jar.
    await render(React.createElement(VisitorBrowser,{initialPath:'/onboarding/signup'}));
    await wait(()=>!!host.querySelector('#onboarding-signup-email'),'signup after navigation');
    await fill('#onboarding-signup-full-name','New Visitor');await fill('#onboarding-signup-email','new.visitor@example.com');await fill('#onboarding-signup-phone','+919845077654');await fill('#onboarding-signup-password','VisitorPass!42');await fill('#onboarding-signup-confirm','VisitorPass!42');await submit();
    await wait(()=>!!host.textContent?.includes('Linked with code'),'attributed signup status');
    const visitorUser=await visitor.auth.getUser();assert.ok(visitorUser.data.user?.id);passed(8);
    const ledger=await partnerSeed.from('partner_referrals').select('*').eq('referred_user_id',visitorUser.data.user!.id);
    assert.equal(ledger.error,null);assert.equal(ledger.data!.length,1);const saved=ledger.data![0];
    assert.equal(saved.referral_code,code);assert.ok(saved.registered_at);assert.equal(saved.status,'pending');
    assert.equal((await visitor.rpc('link_my_growth_referral',{p_code:otherCode})).error?.code,'22023');
    assert.equal((await partnerSeed.from('partner_referrals').select('id').eq('referred_user_id',visitorUser.data.user!.id)).data!.length,1);passed(9);

    await unmount();browser='partner';window.history.replaceState(null,'','/partner/dashboard');await render(React.createElement(PartnerBrowser,{initialPath:'/partner/dashboard'}));
    await wait(()=>!!host.querySelector('[aria-label="Referral summary"]'),'updated partner dashboard');
    assert.match(host.querySelector('[aria-label="Referral summary"]')!.textContent!,/1Total Referrals/);
    assert.equal(host.querySelectorAll('[aria-label="Referral activity"] tbody tr').length,1);passed(10);
    assert.match(host.querySelector('[aria-label="Referral activity"] tbody')!.textContent!,/Pending/);passed(11);
    await click(host.querySelector('[data-partner-nav="referred-users"]'));
    await wait(()=>host.querySelectorAll('tbody tr').length===1,'referred user list');
    await click([...host.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent?.startsWith('Pending')));
    await wait(()=>requests.some(r=>r.path.includes('get_my_partner_referrals')&&r.args?.p_status_filter==='pending'),'server status filter');
    await fill('input[type="search"]','new.visitor@example.com');await submit('form[aria-label="Search and filter referrals"]');
    await wait(()=>requests.some(r=>r.args?.p_search==='new.visitor@example.com'),'server search');
    await wait(()=>host.querySelectorAll('tbody tr').length===1,'filtered referral result');passed(12);
    // PHASE 2: signup now records the owner's full name, so the partner's
    // referral row is labelled with it instead of the anonymous fallback.
    const detailsButton=host.querySelector('[aria-label^="View referral details for "]');
    assert.equal(detailsButton?.getAttribute('aria-label'),'View referral details for New Visitor');
    await click(detailsButton);
    await wait(()=>!!document.querySelector('dialog')?.textContent?.includes('Status timeline'),'referral details');
    assert.ok(document.querySelector('dialog')!.textContent!.includes(code));
    assert.ok(!document.querySelector('dialog')!.textContent!.includes('new.visitor@example.com'),'contact is masked');passed(13);
    await click(document.querySelector('[aria-label="Close referral details"]'));
    const denied=await supabase.rpc('get_my_partner_referral_detail',{p_referral_id:peerReferralId});
    assert.equal(denied.error,null);assert.equal(denied.data,null);
    assert.deepEqual((await supabase.from('partner_referrals').select('id').eq('id',peerReferralId)).data,[]);
    assert.ok(!host.textContent!.includes('Peer Private Customer'));passed(14);

    await render(React.createElement(PartnerBrowser,{initialPath:'/partner/dashboard'}));
    await wait(()=>!!host.querySelector('[aria-label="Referral summary"]'),'refresh keeps data');
    assert.match(host.querySelector('[aria-label="Referral summary"]')!.textContent!,/1Total Referrals/);
    await act(async()=>{await supabase.auth.signOut();});await unmount();
    await stop();await boot(); // Re-open the same disk-backed database, reapplying the chain.
    window.history.replaceState(null,'','/partner/login');await render(React.createElement(PartnerBrowser,{initialPath:'/partner/login'}));
    await wait(()=>!!host.querySelector('#partner-login-email'),'re-login after server restart');
    await fill('#partner-login-email','acceptance.partner@example.com');await fill('#partner-login-password','AcceptancePass!42');await submit();
    await wait(()=>!!host.querySelector('[aria-label="Referral summary"]'),'persistent dashboard after re-login');
    assert.match(host.querySelector('[aria-label="Referral summary"]')!.textContent!,/1Total Referrals/);
    const persisted=await supabase.from('partner_referrals').select('*').eq('id',saved.id);
    assert.equal(persisted.error,null);assert.equal(persisted.data!.length,1);
    assert.equal(persisted.data![0].referral_code,code);assert.equal(persisted.data![0].referred_user_id,visitorUser.data.user!.id);
    assert.equal(persisted.data![0].registered_at,saved.registered_at);passed(15);
    assert.deepEqual(steps,Array.from({length:15},(_,i)=>i+1));
  } finally {
    await unmount();await supabase.auth.stopAutoRefresh();await visitor?.auth.stopAutoRefresh();
    await stop();host.remove();globalThis.fetch=oldFetch;window.fetch=oldFetch as any;
    if(oldClipboard)Object.defineProperty(navigator,'clipboard',oldClipboard);else delete(navigator as any).clipboard;
    await rm(dataDir,{recursive:true,force:true});
  }
});
