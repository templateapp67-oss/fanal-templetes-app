import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PartnerReferralCodeSection } from '../../src/components/PartnerPortalSections';
import { PartnerReferralActivity } from '../../src/components/PartnerReferralActivity';
import { ReferralCodeCard } from '../../src/components/GrowthPartnerSections';
import { ReferralEmptyState } from '../../src/components/ReferralEmptyState';

after(()=>dom.window.close());
test('copy code/link use exact snackbars, repeat after dismiss, last action wins and failures never claim success',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const original=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  const oldAlert=window.alert;
  window.alert=()=>{throw new Error('alert popups are forbidden');};
  let mode:'ok'|'fail'|'defer'='ok', resolveFirst!:()=>void;
  const writes:string[]=[];
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{writes.push(text);if(mode==='fail')throw new Error('denied');if(mode==='defer')await new Promise<void>(r=>resolveFirst=r);}}});
  const click=async(label:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);await act(async()=>b.click());};
  const toast=()=>host.querySelector('[role="status"]')?.textContent;
  try {
    await act(async()=>root.render(React.createElement(PartnerReferralCodeSection,{code:'NEXORA-ABC123'})));
    await click('Copy Code');assert.equal(toast(),'Referral code copied');assert.equal(writes.at(-1),'NEXORA-ABC123');
    await click('Copy Link');assert.equal(toast(),'Referral link copied');assert.match(writes.at(-1)!,/\/onboarding\/signup\?ref=NEXORA-ABC123$/);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click());
    assert.equal(toast(),undefined);
    await click('Copy Code');assert.equal(toast(),'Referral code copied');
    // Repeated same code after dismissal also re-announces (a fresh notice ID).
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click());
    await click('Copied');assert.equal(toast(),'Referral code copied');
    mode='defer';await click('Copy Link');mode='ok';await click('Copy Code');
    await act(async()=>resolveFirst());assert.equal(toast(),'Referral code copied','late link completion cannot replace the latest feedback');
    mode='fail';await click('Copy Link');assert.equal(toast(),undefined);assert.match(host.querySelector('[role="alert"]')!.textContent!,/Could not copy/);
    mode='ok';await act(async()=>root.render(React.createElement(ReferralCodeCard,{code:'NEXORA-ABC123'})));
    await click('Copy Code');assert.equal(toast(),'Referral code copied');
    await act(async()=>root.render(React.createElement(ReferralEmptyState,{filtered:false,referralCode:'NEXORA-ABC123'})));
    await click('Copy Referral Link');assert.equal(toast(),'Referral link copied');
  } finally {
    await act(async()=>root.unmount());host.remove();window.alert=oldAlert;
    if(original)Object.defineProperty(navigator,'clipboard',original);else delete(navigator as any).clipboard;
  }
});

test('activity renders backend values instead of counting the ten-row preview, with responsive columns and safe names',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    const activity:any={last7DaysReferrals:127,recentReferrals:[{referralId:'opaque',name:'<script>unsafe()</script>',date:'2026-09-13T00:00:00Z',status:'active'}],dailyReferrals:[],window:{timeZone:'UTC'}};
    await act(async()=>root.render(React.createElement(PartnerReferralActivity,{activity})));
    assert.match(host.textContent!,/Last 7 Days Referrals127/);
    assert.match(host.textContent!,/Recent Referrals/);
    assert.deepEqual([...host.querySelectorAll('th')].map(t=>t.textContent),['Name','Date','Status']);
    assert.equal(host.querySelectorAll('tbody tr').length,1);assert.equal(host.querySelector('script'),null);
    assert.match(host.querySelector('[role="region"]')!.className,/overflow-x-auto/);
    await act(async()=>root.render(React.createElement(PartnerReferralActivity,{})));
    assert.match(host.textContent!,/not available yet/);assert.doesNotMatch(host.textContent!,/Last 7 Days Referrals0/);
    await act(async()=>root.render(React.createElement(PartnerReferralActivity,{activity:{...activity,last7DaysReferrals:0,recentReferrals:[]}})));
    assert.match(host.textContent!,/Last 7 Days Referrals0/);assert.match(host.textContent!,/No referrals yet/);
  } finally {await act(async()=>root.unmount());host.remove();}
});
