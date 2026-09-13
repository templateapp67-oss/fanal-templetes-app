import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';

after(() => dom.window.close());

test('real referrals page tabs show counts, filter RPCs, reset pagination, handle empty results and keyboard navigation', async () => {
  const savedFetch = globalThis.fetch;
  const calls: any[] = [];
  const counts = {all:42,pending:14,active:21,converted:7,inactive:0};
  const rows = Array.from({length:42},(_,i) => ({ref:`ref-${i}`, display_name:`Referral ${i}`, status:i<14?'linked':i<35?'template_started':'template_completed', referral_status:i<14?'pending':i<35?'active':'converted',linked_at:'2026-09-01T00:00:00Z'}));
  const reply = (value: any) => Response.json(value);
  let failNext = false;
  let holdActive = false;
  let releaseActive: (() => void) | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/get_my_growth_partner')) return reply({user_id:'partner',referral_code:'NEXORA-TABS01',is_active:true});
    if (String(url).endsWith('/get_my_partner_dashboard')) return reply({partner:{referral_code:'NEXORA-TABS01',is_active:true},kpis:{total_referrals:42,completed:7,active_onboarding:35},recent_activity:[]});
    if (String(url).endsWith('/get_my_partner_referrals')) {
      const args = JSON.parse(String(init?.body)); calls.push(args);
      if (failNext) { failNext=false; return new Response(JSON.stringify({message:'Temporary database failure'}),{status:500}); }
      const status = args.p_status_filter === 'in_progress' ? 'active' : args.p_status_filter === 'completed' ? 'converted' : args.p_status_filter;
      const filtered = status === 'all' ? rows : rows.filter(r=>r.referral_status===status);
      const result = {total:filtered.length,limit:args.p_limit,offset:args.p_offset,rows:filtered.slice(args.p_offset,args.p_offset+args.p_limit),status_counts:counts};
      if (holdActive && status === 'active') {
        holdActive=false;
        return new Promise<Response>(resolve => {releaseActive=()=>resolve(reply(result));});
      }
      return reply(result);
    }
    return new Response('{}',{status:400});
  };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const wait = async (check:()=>boolean) => {
    for(let i=0;i<100&&!check();i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    assert.ok(check(),'UI settled');
  };
  const tab = (label:string) => [...host.querySelectorAll('[role="tab"]')].find(el=>el.textContent?.startsWith(label)) as HTMLButtonElement;
  const button = (label:string) => [...host.querySelectorAll('button')].find(el=>el.textContent?.trim()===label) as HTMLButtonElement;
  const click = async (el:HTMLElement) => {assert.ok(el); await act(async()=>el.click());};
  try {
    await act(async()=>root.render(React.createElement(GrowthPartnerPage, {user:{id:'partner',email:'partner@example.com'},path:'/partner/referrals',navigate(){},onLogout(){}} as any)));
    await wait(()=>!!tab('All')?.textContent?.includes('(42)'));
    for(const [label,count] of [['All',42],['Pending',14],['Active',21],['Converted',7],['Inactive',0]]) assert.equal(tab(String(label)).textContent,`${label} (${count})`);
    await click(button('Next'));
    await wait(()=>host.textContent!.includes('Showing 21–40 of 42'));
    await click(tab('Active'));
    await wait(()=>host.textContent!.includes('Showing 1–20 of 21'));
    assert.equal(calls.at(-1).p_status_filter,'in_progress'); assert.equal(calls.at(-1).p_offset,0);
    assert.equal(tab('Active').getAttribute('aria-selected'),'true');
    assert.equal(tab('All').textContent,'All (42)');
    await click(button('Next'));
    await wait(()=>host.textContent!.includes('Showing 21–21 of 21'));
    await click(tab('Inactive'));
    await wait(()=>host.textContent!.includes('No matching referrals found.'));
    assert.equal(calls.at(-1).p_offset,0); assert.equal(calls.at(-1).p_status_filter,'inactive');
    await act(async()=>tab('Inactive').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
    await wait(()=>host.textContent!.includes('Showing 1–7 of 7'));
    assert.equal(tab('Converted').getAttribute('aria-selected'),'true');
    assert.equal(document.activeElement,tab('Converted'));
    // A late response from the previous tab must not replace the current rows.
    holdActive=true;
    await click(tab('Active')); await wait(()=>!!releaseActive);
    assert.equal(tab('All').textContent,'All (42)','counts survive loading');
    await click(tab('Pending'));
    await wait(()=>host.textContent!.includes('Showing 1–14 of 14'));
    await act(async()=>releaseActive!());
    assert.equal(tab('Pending').getAttribute('aria-selected'),'true');
    assert.ok(host.textContent!.includes('Showing 1–14 of 14'));
    failNext=true;
    await click(button('Refresh'));
    await wait(()=>!!host.querySelector('[role="alert"]'));
    assert.equal(tab('All').textContent,'All (42)');
    await click(button('Retry'));
    await wait(()=>host.textContent!.includes('Showing 1–14 of 14'));
    assert.equal(calls.at(-1).p_status_filter,'pending');
    assert.ok(calls.every(args=>!('partner_id' in args)));
  } finally {
    releaseActive?.();
    await act(async()=>root.unmount()); host.remove(); globalThis.fetch=savedFetch;
  }
});
