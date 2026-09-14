import './jsdomSetup';
import { dom, nativeFetch } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CookieJar } from 'jsdom';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  registerLocalSupabaseGateway,
  LOCAL_DEV_ADMIN_EMAIL,
  LOCAL_DEV_ADMIN_PASSWORD,
} from '../../server/localSupabase';
import { registerReferralAttributionRoutes } from '../../server/referralAttribution';
import { OnboardingApp } from '../../src/onboarding/OnboardingApp';

after(() => dom.window.close());

// ============================================================================
// PHASE 3.2 — RESUME EXISTING ONBOARDING
//
//   signup -> partial setup -> logout -> login again
//
// Expected: continue from the existing authoritative state. Do not restart
// onboarding from zero.
//
// Real components, real HTTP, real Supabase Auth, real RPC/RLS on disk-backed
// PostgreSQL — the same harness as onboardingJourneyBrowserFlow. Nothing is
// mocked except the browser capabilities jsdom does not implement.
//
// The authoritative state here is `growth_onboarding`, written by
// link_my_growth_referral and read back by get_my_onboarding_status, which is
// what resolveOnboardingRoute routes on.
// ============================================================================

test('PHASE 3.2: signup -> partial setup -> logout -> login resumes, does not restart', { timeout: 180_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'resume-onboarding-'));
  const oldFetch = globalThis.fetch;
  const oldSessionStorage = (globalThis as Record<string, unknown>).sessionStorage;
  let origin = '';
  let server: Server | undefined;
  let closeDb: (() => Promise<void>) | undefined;
  const jar = new CookieJar();
  let clientIndex = 0;
  const client = () =>
    createClient(origin, 'local-dev-key', {
      auth: {
        storageKey: `resume-${clientIndex++}`,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: ((input: any, init: any) => (globalThis.fetch as any)(input, init)) as any },
    });

  let host: HTMLElement | undefined;
  let root: Root | undefined;
  const wait = async (check: () => boolean, what: string) => {
    for (let i = 0; i < 300 && !check(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    assert.ok(check(), `UI settled: ${what}`);
  };
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  const fill = async (id: string, value: string) => {
    const input = host!.querySelector<HTMLInputElement>(`#${id}`)!;
    assert.ok(input, `${id} exists`);
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => {
      host!.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
  };
  const text = () => host?.textContent || '';

  try {
    // --- a real gateway on a real port --------------------------------------
    const app = express();
    // Without this the gateway's handlers see an empty req.body, and every
    // credential check fails as "Invalid login credentials".
    app.use(express.json());
    const gateway = await registerLocalSupabaseGateway(app, { dataDir, log: () => {} });
    closeDb = gateway.close;
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // The second argument is an RPC function, not an options bag.
    const anonymous = client();
    registerReferralAttributionRoutes(app, (fn, args) => anonymous.rpc(fn, args));

    dom.reconfigure({ url: `${origin}/` });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: dom.window.sessionStorage,
    });
    globalThis.fetch = async (input: any, init: any) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, origin);
      const target = `${origin}${url.pathname}${url.search}`;
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const cookie = jar.getCookieStringSync(target);
      if (cookie) headers.set('cookie', cookie);
      if (url.pathname === '/api/referral-attribution') headers.set('origin', origin);
      const response = await nativeFetch(target, { ...init, headers });
      for (const value of response.headers.getSetCookie()) jar.setCookieSync(value, target);
      return response;
    };
    window.fetch = globalThis.fetch as any;

    // --- a real Growth Partner with a real code ------------------------------
    const admin = client();
    assert.equal(
      (await admin.auth.signInWithPassword({ email: LOCAL_DEV_ADMIN_EMAIL, password: LOCAL_DEV_ADMIN_PASSWORD })).error,
      null
    );
    const partnerSeed = client();
    const partner = await partnerSeed.auth.signUp({
      email: 'resume.partner@example.com',
      password: 'PartnerPass!42',
      options: { data: { full_name: 'Resume Partner' } },
    });
    assert.ok(partner.data.user?.id);
    const provisioned = await admin.rpc('provision_growth_partner', {
      p_user_id: partner.data.user!.id,
      p_active: true,
    });
    assert.equal(provisioned.error, null);
    const code: string = provisioned.data.referral_code;
    assert.match(code, /^NEXORA-[A-Z0-9]+$/);

    // === 1. SIGNUP ==========================================================
    const email = `resume.owner-${Date.now()}@example.com`;
    const password = 'OwnerPass!42';
    const owner = client();
    const signedUp = await owner.auth.signUp({
      email,
      password,
      options: { data: { full_name: 'Uma Rao', phone_number: '+919845077654', growth_referral_token: code } },
    });
    assert.ok(signedUp.data.session, 'auto-confirm is off locally, so signup yields a session');
    const ownerId = signedUp.data.user!.id;

    // === 2. PARTIAL SETUP — link the referral ===============================
    const linked = await owner.rpc('link_my_growth_referral', { p_code: code });
    assert.equal(linked.error, null, `link succeeded: ${JSON.stringify(linked.error)}`);

    const beforeLogout = await owner.rpc('get_my_onboarding_status');
    assert.equal(beforeLogout.data.linked, true);
    assert.equal(beforeLogout.data.referral_code, code);
    const authoritativeBefore = JSON.stringify(beforeLogout.data);

    // === 3. LOGOUT ==========================================================
    assert.equal((await owner.auth.signOut()).error, null);
    const afterLogout = await owner.auth.getSession();
    assert.equal(afterLogout.data.session, null, 'really signed out');

    // === 4. LOGIN AGAIN =====================================================
    const returning = client();
    const back = await returning.auth.signInWithPassword({ email, password });
    assert.equal(back.error, null, `login again: ${JSON.stringify(back.error)}`);
    assert.equal(back.data.user!.id, ownerId, 'the SAME account, not a new one');

    // === 5. THE AUTHORITATIVE STATE SURVIVED ================================
    const afterLogin = await returning.rpc('get_my_onboarding_status');
    assert.equal(afterLogin.error, null);
    assert.equal(afterLogin.data.linked, true, 'the referral link is still there');
    assert.equal(afterLogin.data.referral_code, code, 'and it is the same code');
    assert.equal(afterLogin.data.growth_partner_id, beforeLogout.data.growth_partner_id);
    assert.equal(
      JSON.stringify(afterLogin.data),
      authoritativeBefore,
      'logout + login changed nothing in the authoritative row'
    );
    const profiles = await returning.from('profiles').select('full_name,phone_number').eq('id', ownerId).maybeSingle();
    assert.equal((profiles.data as any)?.full_name, 'Uma Rao', 'the signup identity survived too');

    // === 6. AND THE FUNNEL ROUTES ON IT, NOT BACK TO STEP ONE ===============
    let visitor: ReturnType<typeof client> = returning;
    let currentPath = '/onboarding/status';
    function ResumeBrowser() {
      const [path, setPath] = useState(currentPath);
      currentPath = path;
      return React.createElement(OnboardingApp, {
        path,
        client: visitor as any,
        navigate: (next: string) => {
          window.history.replaceState(null, '', next);
          setPath(new URL(next, window.location.origin).pathname);
        },
      });
    }
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    dom.reconfigure({ url: `${origin}/onboarding/status` });
    window.history.replaceState(null, '', '/onboarding/status');
    await act(async () => root!.render(React.createElement(ResumeBrowser)));

    // The linked owner lands on the STATUS screen. Routing back to the referral
    // screen would be restarting onboarding from zero. Wait on the owner's own
    // referral code rather than on generic page copy, which would match either
    // screen.
    const codePattern = new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    await wait(() => codePattern.test(text()), 'the status screen showing their code');
    assert.ok(
      !host.querySelector('#onboarding-referral-code'),
      'the returning owner is NOT asked to enter a referral code again'
    );
    assert.match(text(), codePattern, 'their code is shown back to them');

    // And if they navigate to the referral route deliberately, the resolver
    // still forwards them to status — the relationship is never re-asked for.
    await act(async () => {
      window.history.replaceState(null, '', '/onboarding/referral');
      root!.render(React.createElement(ResumeBrowser, { key: 'referral' }));
    });
    await wait(() => window.location.pathname.includes('/onboarding/status') || !host!.querySelector('#onboarding-referral-code'), 'forwarded to status');
    assert.ok(
      !host.querySelector('#onboarding-referral-code'),
      'the referral screen is not re-shown to an already-linked owner'
    );
  } finally {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    globalThis.fetch = oldFetch;
    (globalThis as Record<string, unknown>).sessionStorage = oldSessionStorage;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await closeDb?.();
    await rm(dataDir, { recursive: true, force: true });
  }
});
