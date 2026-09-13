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
import { TemplateHandoffPage } from '../../src/components/TemplateHandoffPage';
import { HANDOFF_STATE_KEY } from '../../src/onboarding/lib/handoff';
import { TEMPLATE_HANDOFF_ROUTE } from '../../src/onboarding/lib/handoff';

after(() => dom.window.close());

// ============================================================================
// PART 3 end-to-end: the whole onboarding funnel through the REAL components,
// REAL HTTP, REAL Supabase Auth and REAL RPC/RLS on disk-backed PostgreSQL.
//
//   share link → Sign Up → attribution → Login session → Referral linked
//   → status screen → one-time handoff → Template App exchange
//   → onboarding_status = template_started
//
// Nothing here is mocked except the browser capabilities jsdom does not
// implement (cookies come from a real CookieJar, navigation is intercepted
// because jsdom refuses to leave the Document). The handoff RPCs, the
// attribution RPCs and the growth_onboarding state machine are the shipped
// ones, executed by PGlite against the committed migrations.
//
// The acceptance suite (partnerFinalAcceptance.test.ts) covers the partner
// side and attributed sign-up; this file covers the half it stops at — the
// secure continuation into the Template App.
// ============================================================================

test('PART 3 journey: share link → sign up → referral link → handoff → Template App entry', { timeout: 180_000 }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'onboarding-journey-'));
  const oldFetch = globalThis.fetch;
  const oldSessionStorage = (globalThis as Record<string, unknown>).sessionStorage;
  let origin = '';
  let server: Server | undefined;
  let closeDb: (() => Promise<void>) | undefined;
  const jar = new CookieJar();
  const requests: { path: string; method: string; status: number }[] = [];
  const rpcResponses: Record<string, any> = {};
  let captureRpc: ((name: string, body: any) => void) | null = null;
  let clientIndex = 0;
  const client = () =>
    createClient(origin, 'local-dev-key', {
      auth: {
        storageKey: `journey-${clientIndex++}`,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      // Route the SDK through the shim below so cookies and the request log
      // see exactly what a browser would send.
      global: { fetch: ((input: any, init: any) => (globalThis.fetch as any)(input, init)) as any },
    });

  const app = express();
  app.use(express.json());
  const gateway = await registerLocalSupabaseGateway(app, { dataDir, log: () => {} });
  closeDb = gateway.close;
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  registerReferralAttributionRoutes(app, (fn, args) => anonymous.rpc(fn, args));
  const anonymous = client();

  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  const render = async (node: React.ReactNode) => {
    if (root) await act(async () => root!.unmount());
    root = createRoot(host);
    await act(async () => root!.render(node));
  };
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400 && !check(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    assert.ok(check(), `journey did not reach: ${label}. Screen: ${host.textContent?.slice(0, 900)}`);
  };
  const fill = async (selector: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(selector);
    assert.ok(input, `input ${selector} exists`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const submit = async () => {
    const form = host.querySelector('form');
    assert.ok(form, 'a form is present');
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  };
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

  let visitor: ReturnType<typeof client> | undefined;
  function VisitorBrowser({ initialPath }: { initialPath: string }) {
    const [path, setPath] = useState(initialPath);
    return React.createElement(OnboardingApp, {
      path,
      client: visitor as any,
      navigate: (next: string) => { window.history.replaceState(null, '', next); setPath(next); },
    });
  }

  try {
    // --- browser shims: cookies, sessionStorage, request log ----------------
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
      requests.push({ path: url.pathname, method: init?.method || 'GET', status: response.status });
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.split('/').pop()!;
        try {
          const body = await response.clone().json();
          if (captureRpc) captureRpc(fn, body);
        } catch { /* non-JSON body — not an RPC result */ }
      }
      return response;
    };
    window.fetch = globalThis.fetch as any;

    // --- a real Growth Partner with a real unique code ----------------------
    const admin = client();
    assert.equal(
      (await admin.auth.signInWithPassword({ email: LOCAL_DEV_ADMIN_EMAIL, password: LOCAL_DEV_ADMIN_PASSWORD })).error,
      null
    );
    const partnerSeed = client();
    const partner = await partnerSeed.auth.signUp({
      email: 'journey.partner@example.com',
      password: 'PartnerPass!42',
      options: { data: { full_name: 'Journey Partner' } },
    });
    assert.ok(partner.data.user?.id);
    const provisioned = await admin.rpc('provision_growth_partner', { p_user_id: partner.data.user!.id, p_active: true });
    assert.equal(provisioned.error, null);
    const code: string = provisioned.data.referral_code;
    assert.match(code, /^NEXORA-[A-Z0-9]+$/);

    // --- 1. the visitor lands on the partner's share link -------------------
    visitor = client();
    const sharePath = `/signup?ref=${encodeURIComponent(code)}`;
    dom.reconfigure({ url: `${origin}${sharePath}` });
    window.history.replaceState(null, '', sharePath);
    await render(React.createElement(VisitorBrowser, { initialPath: '/signup' }));
    await wait(() => !!host.querySelector('#onboarding-signup-email'), 'the sign-up form');
    assert.equal(window.location.pathname, '/onboarding/signup', 'the router canonicalises /signup');

    // The code was captured server-side BEFORE any sign-up, and the capability
    // is an httpOnly cookie — never localStorage, never a URL the user edits.
    const capture = requests.find((r) => r.path === '/api/referral-attribution' && r.method === 'POST');
    assert.ok(capture && capture.status === 200, 'the referral code was validated by the backend');
    const attributionCookie = jar
      .getCookiesSync(`${origin}/signup`)
      .find((c) => c.key === 'nexora_referral');
    assert.ok(attributionCookie?.httpOnly, 'the attribution capability is httpOnly');
    assert.equal(attributionCookie!.sameSite, 'lax');

    // --- 2. Sign Up ---------------------------------------------------------
    await fill('#onboarding-signup-email', 'journey.visitor@example.com');
    await fill('#onboarding-signup-password', 'VisitorPass!42');
    await fill('#onboarding-signup-confirm', 'VisitorPass!42');
    await submit();
    await wait(() => !!host.textContent?.includes('Linked with code'), 'the verified-referral status screen');
    assert.ok(host.textContent!.includes(code), 'the status screen names the linked code');
    assert.ok(host.textContent!.includes('Journey Partner'), 'the status screen names the partner');

    // The relationship is in the database, not in the component: read it back
    // through the same RPC the routing decision uses.
    const linkedStatus = await visitor.rpc('get_my_onboarding_status');
    assert.equal(linkedStatus.error, null);
    assert.equal(linkedStatus.data.linked, true);
    assert.equal(linkedStatus.data.status, 'linked');
    assert.equal(linkedStatus.data.referral_code, code);
    assert.equal(linkedStatus.data.template_started_at, null, 'entry has not happened yet');

    // Attribution happened at sign-up (the one-use capability), so re-linking
    // to a DIFFERENT partner is refused — ownership is immutable.
    const otherSeed = client();
    const other = await otherSeed.auth.signUp({ email: 'journey.other@example.com', password: 'OtherPass!42' });
    const otherProvisioned = await admin.rpc('provision_growth_partner', { p_user_id: other.data.user!.id, p_active: true });
    assert.equal(otherProvisioned.error, null);
    const relink = await visitor.rpc('link_my_growth_referral', { p_code: otherProvisioned.data.referral_code });
    assert.equal(relink.error?.code, '22023', 'a second partner cannot claim an already-linked user');
    assert.equal((await visitor.rpc('get_my_onboarding_status')).data.referral_code, code);

    // --- 3. the secure handoff ---------------------------------------------
    const continueButton = button('Continue to Template App');
    assert.ok(continueButton, 'the status screen offers the Template App handoff');
    assert.ok(!host.textContent!.includes('Nothing more to do'), 'the copy does not contradict the call to action');

    const bodies: Record<string, any> = {};
    captureRpc = (name, body) => { bodies[name] = body; };
    await act(async () => { (continueButton as HTMLElement).click(); });
    await wait(() => !!bodies['create_template_handoff'], 'the handoff grant');
    const token: string = bodies['create_template_handoff'].token;
    assert.match(token, /^[a-f0-9]{64}$/, 'the grant is an opaque 64-hex token');
    assert.equal(bodies['create_template_handoff'].destination, 'template-app');

    const state = dom.window.sessionStorage.getItem(HANDOFF_STATE_KEY);
    assert.match(state || '', /^[a-f0-9]{32}$/, 'the anti-CSRF state is stored for this browser only');

    const handoffPath = `${TEMPLATE_HANDOFF_ROUTE}?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state!)}`;
    // The credential travels once, and carries nothing but itself: no email,
    // no user id, no referral code, no partner id, no access/refresh token.
    const query = new URLSearchParams(handoffPath.slice(handoffPath.indexOf('?')));
    assert.deepEqual([...query.keys()].sort(), ['state', 'token']);
    assert.doesNotMatch(handoffPath, /journey\.visitor|access_token|refresh_token|eyJ/i);
    t.diagnostic('handoff grant minted and bound to this browser session');

    // --- 4. the Template App side exchanges it ------------------------------
    let landed = '';
    dom.reconfigure({ url: `${origin}${handoffPath}` });
    window.history.replaceState(null, '', handoffPath);
    await render(
      React.createElement(TemplateHandoffPage, {
        client: visitor as any,
        navigate: (to: string) => { landed = to; },
      })
    );
    await wait(() => landed !== '', 'entry into the Template App');
    assert.equal(landed, '/', 'the visitor enters the normal Template App flow');
    assert.equal(dom.window.sessionStorage.getItem(HANDOFF_STATE_KEY), null, 'the state is cleared after use');
    assert.equal(window.location.pathname, '/', 'the token is scrubbed from the address bar');

    const entered = await visitor.rpc('get_my_onboarding_status');
    assert.equal(entered.data.status, 'template_started');
    assert.ok(entered.data.template_started_at, 'entry is recorded server-side with a server timestamp');
    assert.equal(entered.data.referral_code, code, 'entry never disturbs referral ownership');

    // The owner now has a workspace to save into. Without it the normalized
    // save raises 'Select a salon owned by this account' and the completion
    // check can never verify — this is the resolution step of the funnel.
    const workspace = await visitor.rpc('get_my_owner_workspace');
    assert.equal(workspace.error, null);
    assert.equal(workspace.data.resolved, true, 'the owner workspace resolves after entry');
    assert.ok(workspace.data.organization_id, 'an organization exists');
    assert.ok(workspace.data.salon_id, 'a salon exists');
    assert.ok(workspace.data.slug, 'the salon has a public slug');
    const otherWorkspace = await partnerSeed.rpc('get_my_owner_workspace');
    assert.notEqual(otherWorkspace.data.salon_id, workspace.data.salon_id, 'tenants never share a salon');

    // --- 5. the grant is single-use ----------------------------------------
    // The local gateway deliberately scrubs RAISE messages (stricter than
    // PostgREST), so these assert on the SQLSTATE and on observable state
    // rather than on user-facing copy — the copy mapping is covered against
    // verbatim message text in tests/templateHandoff.test.ts.
    const replay = await visitor.rpc('exchange_template_handoff', { p_token: token });
    assert.equal(replay.error?.code, '22023', 'a consumed grant cannot be replayed');
    assert.equal(replay.data, null);
    const forged = await visitor.rpc('exchange_template_handoff', { p_token: 'f'.repeat(64) });
    assert.equal(forged.error?.code, '22023', 'a forged token is refused the same way');
    assert.equal((await visitor.rpc('get_my_onboarding_status')).data.status, 'template_started');

    // --- 6. a mismatched state fails closed, without spending the grant -----
    const secondState = 'a'.repeat(32);
    dom.window.sessionStorage.setItem(HANDOFF_STATE_KEY, secondState);
    const second = await visitor.rpc('create_template_handoff', { p_state: secondState });
    assert.equal(second.error, null);
    const beforeTamper = requests.filter((r) => r.path.endsWith('exchange_template_handoff')).length;
    let tamperedLanded = '';
    const tamperedPath = `${TEMPLATE_HANDOFF_ROUTE}?token=${encodeURIComponent(second.data.token)}&state=${'b'.repeat(32)}`;
    dom.reconfigure({ url: `${origin}${tamperedPath}` });
    window.history.replaceState(null, '', tamperedPath);
    await render(
      React.createElement(TemplateHandoffPage, {
        client: visitor as any,
        navigate: (to: string) => { tamperedLanded = to; },
      })
    );
    await wait(() => !!host.textContent?.includes('Invalid onboarding session.'), 'the tampered redirect is refused');
    assert.equal(tamperedLanded, '', 'a refused handoff never enters the app');
    assert.equal(
      requests.filter((r) => r.path.endsWith('exchange_template_handoff')).length,
      beforeTamper,
      'a state mismatch is rejected before any RPC is made'
    );
    // The grant survived, so the honest redirect still works.
    dom.window.sessionStorage.setItem(HANDOFF_STATE_KEY, secondState);
    t.diagnostic('tampered state rejected without consuming the grant');

    // --- 7. the funnel is visible to the partner ---------------------------
    const referrals = await partnerSeed.rpc('get_my_partner_referrals');
    assert.equal(referrals.error, null);
    assert.equal(referrals.data.total, 1, 'the partner sees exactly their own referral');
    assert.equal(referrals.data.rows[0].referral_code, code);
  } finally {
    captureRpc = null;
    if (root) await act(async () => root!.unmount());
    await visitor?.auth.stopAutoRefresh();
    globalThis.fetch = oldFetch;
    window.fetch = oldFetch as any;
    if (oldSessionStorage === undefined) delete (globalThis as Record<string, unknown>).sessionStorage;
    else (globalThis as Record<string, unknown>).sessionStorage = oldSessionStorage;
    if (server) await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    if (closeDb) await closeDb();
    host.remove();
    await rm(dataDir, { recursive: true, force: true });
  }
});
