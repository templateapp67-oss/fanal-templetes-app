import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';
import { GrowthPartnerProfilePage } from '../../src/components/GrowthPartnerProfilePage';
import { ReferralDetailsDrawer } from '../../src/components/ReferralDetailsDrawer';
import { PartnerReferralCodeSection } from '../../src/components/PartnerPortalSections';
import { GrowthPartnerReferrals } from '../../src/components/GrowthPartnerSections';

after(() => dom.window.close());
const wait = async (check: () => boolean) => {
  for (let i=0; i<100 && !check(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  assert.ok(check(), 'UI settled');
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return {promise, resolve}; };

test('pending dashboard has skeletons, authoritative totals ignore activity size, refresh failures keep labelled data', async () => {
  const oldFetch = globalThis.fetch;
  let pending = deferred<Response>();
  globalThis.fetch = async url => {
    const fn = String(url).split('/').at(-1);
    if (fn === 'get_my_growth_partner') return Response.json({user_id:'partner',referral_code:'NEXORA-TEST01',is_active:true});
    if (fn === 'get_my_partner_dashboard') return pending.promise;
    return Response.json({});
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(GrowthPartnerPage, {user:{id:'partner',email:'p@example.com'},path:'/partner/dashboard',navigate(){},onLogout(){}} as any)));
    await wait(() => !!host.querySelector('[data-partner-skeleton="dashboard"]'));
    assert.equal(host.querySelector('[aria-label="Referral summary"]'), null);
    assert.doesNotMatch(host.querySelector('[data-partner-skeleton]')!.textContent!, /\b0\b/);
    await act(async () => pending.resolve(Response.json({totalReferrals:127,activeReferrals:72,pendingReferrals:13,convertedReferrals:38,partner:{referral_code:'NEXORA-TEST01',is_active:true},kpis:{total_referrals:127,active_onboarding:85,completed:38},recent_activity:[]})));
    await wait(() => !!host.querySelector('[aria-label="Referral summary"]'));
    const summary = host.querySelector('[aria-label="Referral summary"]')!;
    for (const n of ['127','72','13','38']) assert.ok(summary.textContent!.includes(n));
    assert.match(summary.className, /grid-cols-1.*sm:grid-cols-2.*xl:grid-cols-4/);
    pending = deferred<Response>();
    await act(async () => (host.querySelector('[aria-label="Refresh dashboard"]') as HTMLElement).click());
    await wait(() => !!host.textContent?.includes('Refreshing…'));
    assert.match(host.querySelector('[aria-label="Referral summary"]')!.textContent!, /127/);
    await act(async () => pending.resolve(new Response(JSON.stringify({message:'offline'}), {status:500})));
    await wait(() => !!host.textContent?.includes('Showing previously loaded totals'));
    assert.ok(host.querySelector('[role="alert"]'));
  } finally { await act(async () => root.unmount()); host.remove(); globalThis.fetch = oldFetch; }
});

test('referral link, table, profile and detail requests use non-numeric skeletons; copy has accessible confirmation', async () => {
  const oldFetch = globalThis.fetch;
  const pendingDetails = deferred<Response>();
  globalThis.fetch = async () => pendingDetails.promise;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
  const check = (kind: string) => {
    const skeleton = document.querySelector(`[data-partner-skeleton="${kind}"]`)!;
    assert.ok(skeleton); assert.equal(skeleton.getAttribute('aria-busy'), 'true');
    assert.doesNotMatch(skeleton.textContent!, /\b0\b/);
  };
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async () => {}}});
  try {
    await render(React.createElement(PartnerReferralCodeSection, {code:null,loading:true})); check('link');
    assert.doesNotMatch(host.textContent!, /unavailable/i);
    await render(React.createElement(GrowthPartnerReferrals, {list:null,loading:true,error:null,onPage(){},onRetry(){}})); check('table');
    assert.doesNotMatch(host.textContent!, /No referrals yet/);
    const profile = deferred<any>();
    await render(React.createElement(GrowthPartnerProfilePage, {client:{rpc:() => profile.promise} as any})); check('profile');
    assert.equal(host.querySelector('input'), null);
    await render(React.createElement(ReferralDetailsDrawer, {referralId:'00000000-0000-4000-8000-000000000001',onClose(){}})); check('details');
    await act(async () => pendingDetails.resolve(new Response(JSON.stringify({message:'offline'}), {status:500})));
    await wait(() => !!document.querySelector('dialog [role="alert"]'));
    assert.match(document.querySelector('dialog')!.textContent!, /Retry details/);
    await render(React.createElement(PartnerReferralCodeSection, {code:'NEXORA-TEST01'}));
    const copy = [...host.querySelectorAll('button')].find(b => b.textContent === 'Copy Code')!;
    assert.match(copy.className, /min-h-11/);
    await act(async () => copy.click());
    assert.match(host.querySelector('[role="status"]')!.textContent!, /Referral code copied/);
    await act(async () => (host.querySelector('[aria-label="Dismiss notification"]') as HTMLElement).click());
    assert.equal(host.querySelector('[aria-label="Dismiss notification"]'), null);
  } finally {
    await act(async () => root.unmount()); host.remove(); globalThis.fetch = oldFetch;
    if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard); else delete (navigator as any).clipboard;
  }
});
