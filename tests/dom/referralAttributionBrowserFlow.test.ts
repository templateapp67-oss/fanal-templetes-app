import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingApp } from '../../src/onboarding/OnboardingApp';
import { prepareSignupAttribution } from '../../src/onboarding/lib/referralAttribution';

after(() => dom.window.close());

test('incoming link is validated before navigation; cookie attribution reaches signup after remount without ref', async () => {
  const oldFetch = globalThis.fetch;
  const token = 'a'.repeat(64);
  const requests: RequestInit[] = [];
  let cookieExists = false;
  let signup: any;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== '/api/referral-attribution') return oldFetch(url, init);
    requests.push(init!);
    assert.equal(init?.credentials, 'same-origin');
    if (init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { code: 'nexora-rahul25' });
      cookieExists = true;
      return Response.json({ valid: true, referralCode: 'NEXORA-RAHUL25' });
    }
    return Response.json({ valid: cookieExists, token: cookieExists ? token : null });
  };
  const client: any = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signUp: async (args: any) => { signup = args; return { data: { user: { id: 'new-user' }, session: null }, error: null }; },
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const host = document.createElement('div');
  document.body.append(host);
  let root = createRoot(host);
  try {
    window.history.replaceState(null, '', '/signup?ref=nexora-rahul25');
    await act(async () => root.render(React.createElement(OnboardingApp, {
      path: '/signup', client, navigate: (path: string) => {
        assert.equal(cookieExists, true, 'capture completed before query was dropped');
        window.history.replaceState(null, '', path);
      },
    })));
    assert.equal(requests[0].method, 'POST');
    assert.equal(window.location.search, '');
    // Simulate a reload after ordinary login/signup navigation. No React state,
    // query string or localStorage attribution survives; only the cookie does.
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(React.createElement(OnboardingApp, { path: '/onboarding/signup', client, navigate: () => {} })));
    const inputs = [...host.querySelectorAll('input')];
    assert.equal(inputs.length, 3);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      for (const [i, value] of ['new@example.com', 'Secret123!', 'Secret123!'].entries()) {
        setter.call(inputs[i], value);
        inputs[i].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      }
    });
    await act(async () => { host.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(requests.at(-1)?.method, 'GET');
    assert.equal(signup.options.data.growth_referral_token, token);
    assert.equal(signup.options.data.partner_id, undefined);
    assert.match(host.textContent!, /Check your inbox/);
    // Failure is actionable, not silently dropped attribution.
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(prepareSignupAttribution(), /Please retry/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = oldFetch;
  }
});
