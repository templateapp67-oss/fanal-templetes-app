import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';

after(() => dom.window.close());

test('search/filter controls send server parameters; user opens read-only accessible timeline drawer', async () => {
  const oldFetch=globalThis.fetch;
  const calls: {fn:string;args:any}[]=[];
  const rows=Array.from({length:21},(_,i)=>({ref:`ref-${i}`,referral_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,display_name:i===0?'Rahul':`User ${i}`,masked_contact:'ra***@gmail.com',referral_code:'NEXORA-RAHUL25',status:'template_started',referral_status:'active',conversion_status:'not_converted',linked_at:'2026-09-01T10:00:00Z',joined_at:'2026-09-01T09:00:00Z',referral_clicked_at:null,template_started_at:'2026-09-02T10:00:00Z',template_completed_at:null,last_activity_at:'2026-09-02T10:00:00Z'}));
  let failDetails=false;
  globalThis.fetch=async(url,init)=>{
    const fn=String(url).split('/').at(-1)!; const args=JSON.parse(String(init?.body||'{}')); calls.push({fn,args});
    if(fn==='get_my_growth_partner')return Response.json({user_id:'partner',referral_code:'NEXORA-RAHUL25',is_active:true});
    if(fn==='get_my_partner_dashboard')return Response.json({partner:{referral_code:'NEXORA-RAHUL25',is_active:true},kpis:{total_referrals:21,active_onboarding:21,completed:0},recent_activity:[]});
    if(fn==='get_my_partner_referrals'||fn==='get_my_partner_referrals_filtered'){
      const selected=args.p_search?rows.filter(row=>row.display_name==='Rahul'):rows;
      return Response.json({total:selected.length,offset:args.p_offset,limit:args.p_limit,rows:selected.slice(args.p_offset,args.p_offset+args.p_limit),status_counts:{all:selected.length,pending:0,active:selected.length,converted:0,inactive:0}});
    }
    if(fn==='get_my_partner_referral_detail')return failDetails?new Response(JSON.stringify({message:'Database unavailable'}),{status:500}):Response.json(rows.find(row=>row.referral_id===args.p_referral_id)||null);
    return new Response('{}',{status:400});
  };
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const wait=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(check(),'UI settled');};
  const click=async(el:Element|undefined|null)=>{assert.ok(el);await act(async()=>{(el as HTMLElement).click();});};
  const btn=(text:string)=>[...host.querySelectorAll('button')].find(el=>el.textContent?.trim()===text);
  const control=(label:string)=>[...host.querySelectorAll('label')].find(el=>el.textContent?.startsWith(label))?.querySelector('input,select') as HTMLInputElement|HTMLSelectElement;
  const set=async(el:HTMLInputElement|HTMLSelectElement,value:string)=>{
    assert.ok(el);const proto=el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;
    await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});
  };
  const apply=async()=>{await act(async()=>{host.querySelector('form[aria-label="Search and filter referrals"]')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});};
  const listCall=()=>calls.filter(call=>call.fn.startsWith('get_my_partner_referrals')).at(-1)!;
  try{
    await act(async()=>root.render(React.createElement(GrowthPartnerPage,{user:{id:'partner',email:'partner@example.com'},path:'/partner/referrals',navigate(){},onLogout(){}} as any)));
    await wait(()=>!!host.querySelector('[aria-label="View referral details for Rahul"]'));
    await click(btn('Next'));await wait(()=>host.textContent!.includes('Showing 21–21 of 21'));
    await set(control('Search referrals'),'rahul@gmail.com');await apply();await wait(()=>host.textContent!.includes('Showing 1–1 of 1'));
    assert.equal(listCall().args.p_search,'rahul@gmail.com');assert.equal(listCall().args.p_offset,0);
    await set(control('Joined Date'),'custom');await set(control('Start date'),'2026-09-01');await set(control('End date'),'2026-09-13');
    await set(control('Conversion Status'),'not_converted');await set(control('Sort by'),'recently_active');await apply();
    await wait(()=>listCall().fn==='get_my_partner_referrals_filtered');
    assert.equal(listCall().args.p_joined_from,new Date(2026,8,1).toISOString());
    assert.equal(listCall().args.p_joined_before,new Date(2026,8,14).toISOString());
    assert.equal(listCall().args.p_sort,'recently_active');assert.equal(listCall().args.p_conversion,'not_converted');
    const beforeInvalid=calls.length;
    await set(control('Start date'),'2026-09-14');await apply();
    assert.match(host.textContent!,/Start date must be on or before/);assert.equal(calls.length,beforeInvalid);
    await click(btn('Clear filters'));await wait(()=>host.textContent!.includes('Showing 1–20 of 21'));
    assert.equal(control('Search referrals').value,'');assert.equal(control('Joined Date').value,'all');assert.equal(control('Sort by').value,'newest');
    const opener=host.querySelector<HTMLElement>('[aria-label="View referral details for Rahul"]')!;opener.focus();
    await click(opener);await wait(()=>!!document.querySelector('dialog')?.textContent?.includes('Status timeline'));
    const modal=document.querySelector('dialog')!;
    assert.equal(calls.at(-1)!.fn,'get_my_partner_referral_detail');assert.equal(calls.at(-1)!.args.p_referral_id,rows[0].referral_id);
    assert.match(modal.textContent!,/ra\*\*\*@gmail.com/);assert.ok(!modal.textContent!.includes('rahul@gmail.com'));
    for(const label of ['User Name','Referral Date','Signup Date','Current Status','Conversion Status','Last Activity','Referral Code Used','Referral Clicked','Account Registered','Account Activated','Converted','Not recorded','Not yet recorded'])assert.ok(modal.textContent!.includes(label),label);
    assert.equal(modal.querySelectorAll('input,select,textarea').length,0,'details cannot edit referral status');
    assert.equal(document.activeElement?.getAttribute('aria-label'),'Close referral details');
    await act(async()=>modal.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement,opener);
    failDetails=true;await click(opener);await wait(()=>!!document.querySelector('dialog [role="alert"]'));
    failDetails=false;await click([...document.querySelectorAll('dialog button')].find(el=>el.textContent==='Retry details'));
    await wait(()=>!!document.querySelector('dialog')?.textContent?.includes('Status timeline'));
    await click(document.querySelector('[aria-label="Close referral details"]'));
    assert.ok(calls.every(call=>!('partner_id' in call.args)));
  }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
