import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingApp } from '../../src/onboarding/OnboardingApp';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';

after(() => dom.window.close());
const wait = async (check: () => boolean) => {
  for(let i=0;i<100&&!check();i++) await act(async () => { await new Promise(r => setTimeout(r,10)); });
  assert.ok(check(),'UI settled');
};

test('registered visitors get an explicit notice and neither capture nor prefill another partner, linked or unlinked', async () => {
  const oldFetch = globalThis.fetch;
  let captures = 0;
  globalThis.fetch = async () => { captures++; throw new Error('unexpected capture'); };
  try {
    for (const linked of [true,false]) {
      const calls: string[] = [], paths: string[] = [];
      const client: any = {
        auth:{getSession:async () => ({data:{session:{user:{id:'existing',email:'existing@example.com'}}},error:null}),onAuthStateChange:() => ({data:{subscription:{unsubscribe(){}}}})},
        rpc:async (fn:string) => {calls.push(fn); return {error:null,data:fn==='get_my_onboarding_status' ? {linked,status:linked?'linked':'not_started',referral_code:linked?'NEXORA-ORIGINAL':null} : linked?{referral_code:'NEXORA-ORIGINAL'}:null};},
      };
      window.history.replaceState(null,'','/register?ref=NEXORA-OTHER123');
      const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
      try {
        await act(async () => root.render(React.createElement(OnboardingApp,{path:'/register',client,navigate:path => paths.push(path)})));
        await wait(() => !!host.textContent?.includes('This account is already registered.'));
        assert.equal(captures,0); assert.equal(paths.length,0,'notice precedes redirect');
        assert.equal(host.querySelector('input'),null);
        assert.ok(!calls.includes('link_my_growth_referral'));
        await act(async () => (host.querySelector('button') as HTMLElement).click());
        await wait(() => !host.textContent?.includes('This account is already registered.') && !!host.querySelector('input, [data-onboarding-shell], main'));
        assert.equal(captures,0);
        if (linked) { assert.match(host.textContent!,/NEXORA-ORIGINAL/); assert.ok(!host.textContent?.includes('NEXORA-OTHER123')); }
        else { assert.equal(host.querySelector<HTMLInputElement>('input')?.value,'','no new-link prefill for a registered account'); }
        assert.ok(!calls.includes('link_my_growth_referral'));
      } finally { await act(async () => root.unmount()); host.remove(); }
    }
  } finally { globalThis.fetch = oldFetch; }
});

test('register validates before redirect, shows invalid-code recovery and hides technical boot failures', async () => {
  const oldFetch = globalThis.fetch;
  let mode: 'invalid'|'database'|'valid' = 'invalid', captured = false;
  globalThis.fetch = async () => {
    if(mode==='database') throw new Error('SQL secret_table SUPERSECRET');
    captured = mode==='valid';
    return Response.json(mode==='valid'?{valid:true,referralCode:'NEXORA-ABC123'}:{valid:false});
  };
  const client:any = {auth:{getSession:async () => ({data:{session:null},error:null}),onAuthStateChange:() => ({data:{subscription:{unsubscribe(){}}}})},rpc:async () => ({data:null,error:null})};
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    window.history.replaceState(null,'','/register?ref=NEXORA-ABC123');
    await act(async () => root.render(React.createElement(OnboardingApp,{path:'/register',client,navigate(){assert.equal(captured,true,'cookie validated before navigation');}})));
    await wait(() => !!host.textContent?.includes('Invalid referral code'));
    assert.ok([...host.querySelectorAll('button')].some(b => b.textContent==='Continue without a referral'));
    mode='database';
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent==='Retry')!.click());
    await wait(() => !!host.textContent?.includes('Network error'));
    assert.doesNotMatch(host.textContent!,/SUPERSECRET|secret_table|SQL/);
    mode='valid';
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent==='Retry')!.click());
    await wait(() => host.querySelectorAll('input').length===5);
    assert.equal(captured,true);
  } finally { await act(async () => root.unmount()); host.remove(); globalThis.fetch=oldFetch; }
});

test('partner gate database errors never render driver messages and remain retryable', async () => {
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async () => Response.json({code:'42P01',message:'relation SECRET_TABLE does not exist SQL password=SECRET'},{status:500});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async () => root.render(React.createElement(GrowthPartnerPage,{path:'/partner/dashboard',user:{id:'partner'},navigate(){}} as any)));
    await wait(() => !!host.textContent?.includes('Retry'));
    assert.doesNotMatch(host.textContent!,/SECRET|42P01|SQL|relation/);
    // This assertion used to read /Please try again/. The screen answered EVERY
    // failure with that sentence — including the ones a retry cannot fix, which
    // is the dead end `/partner/dashboard` was reported for. A driver message
    // that names a missing relation is a setup problem, so the screen now names
    // it; the safety properties of this test (no driver text, a Retry
    // affordance, nothing driver-shaped rendered) are asserted here and below.
    assert.match(host.textContent!,/database setup is missing/);
    assert.ok(
      [...host.querySelectorAll('button')].some((button) => /Retry/.test(button.textContent ?? '')),
      'retry stays available even when it cannot fix the cause alone'
    );
  } finally {await act(async () => root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
