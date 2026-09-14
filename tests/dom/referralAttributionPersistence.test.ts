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
import { createRememberAwareAuthStorage } from '../../src/lib/authRememberStorage';

after(() => dom.window.close());

// ============================================================================
// PHASE 6 — THE REFERRAL RELATIONSHIP IS SERVER-SIDE.
//
//   ?ref=CODE -> validate -> capture -> sign up -> ... does it survive
//   refresh, logout, login, browser restart, server restart?
//
// This is the browser half of the question; tests/referralAttributionLock.test.ts
// answers the same question at the database/RLS level. Both drive REAL
// components against REAL HTTP, REAL Supabase Auth and REAL RPC/RLS on
// disk-backed PostgreSQL — nothing about the referral path is mocked. The only
// simulated browser capabilities are the cookie jar and localStorage, because
// jsdom's fetch implements neither.
//
// The claim under test: the authoritative relationship is the `growth_onboarding`
// row (plus the `partner_referrals` ledger) written server-side by the signup
// trigger. localStorage holds the AUTH SESSION and nothing else, so clearing it
// can only cost a login — never a referral. And once PARTNER-A owns the account,
// a later ?ref=PARTNER-B link must leave the attribution exactly as it was.
// ============================================================================

test(
  'PHASE 6: the referral link survives refresh, logout, login, a browser restart and a server restart — and cannot be re-attributed by a later ?ref=',
  { timeout: 300_000 },
  async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'referral-persistence-'));
    const oldFetch = globalThis.fetch;
    const oldWindowFetch = window.fetch;
    const oldSessionStorage = (globalThis as Record<string, unknown>).sessionStorage;
    let origin = '';
    let port = 0;
    let server: Server | undefined;
    let closeDb: (() => Promise<void>) | undefined;
    // The browser: its own cookie jar and its own localStorage. A "browser
    // restart" below replaces both, which is exactly what a user would do.
    let jar = new CookieJar();
    let clientIndex = 0;
    const requests: { path: string; method: string; status: number }[] = [];

    const browserFetch = async (input: any, init: any) => {
      const originalUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(originalUrl, origin);
      assert.ok(
        /^\/(auth\/v1|rest\/v1|api\/referral-attribution)(\/|$)/.test(url.pathname),
        `only local app APIs may be requested (${url.pathname})`
      );
      const target = `${origin}${url.pathname}${url.search}`;
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const cookie = jar.getCookieStringSync(target);
      if (cookie) headers.set('cookie', cookie);
      if (url.pathname === '/api/referral-attribution') headers.set('origin', origin);
      const response = await nativeFetch(target, { ...init, headers });
      for (const value of response.headers.getSetCookie()) jar.setCookieSync(value, target);
      requests.push({ path: url.pathname, method: init?.method || 'GET', status: response.status });
      return response;
    };

    // A real browser client: same storage as the app ships (localStorage by
    // default, sessionStorage when "Remember me" is unchecked), so the storage
    // assertions below are about the real thing rather than an in-memory stub.
    // The "browser restart" steps deliberately create new clients over the same
    // storage key (that is what a new browser start is); supabase-js logs an
    // informational "Multiple GoTrueClient instances" note for it — which is
    // exactly the situation the test is modelling.
    const browserAuthStorage = createRememberAwareAuthStorage({
      local: dom.window.localStorage as any,
      session: dom.window.sessionStorage as any,
    })!;
    const browserClient = () =>
      createClient(origin, 'local-dev-key', {
        auth: {
          persistSession: true,
          storage: browserAuthStorage as any,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { fetch: browserFetch as any },
      });
    // Server-side / test-side clients talk straight to the gateway.
    const directClient = () =>
      createClient(origin, 'local-dev-key', {
        auth: {
          storageKey: `phase6-direct-${clientIndex++}`,
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { fetch: nativeFetch },
      });

    const boot = async () => {
      const app = express();
      app.use(express.json());
      const gateway = await registerLocalSupabaseGateway(app, { dataDir, log: () => {} });
      closeDb = gateway.close;
      server = createServer(app);
      await new Promise<void>((resolve) => server!.listen(port, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
      origin = `http://127.0.0.1:${port}`;
      registerReferralAttributionRoutes(app, (fn, args) => directClient().rpc(fn, args));
    };
    const stop = async () => {
      if (server) {
        await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
        server = undefined;
      }
      if (closeDb) {
        await closeDb();
        closeDb = undefined;
      }
    };

    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    let browser!: ReturnType<typeof browserClient>;
    const render = async (node: React.ReactNode) => {
      if (root) await act(async () => root!.unmount());
      root = createRoot(host);
      await act(async () => root!.render(node));
    };
    const wait = async (check: () => boolean, what: string) => {
      for (let i = 0; i < 500 && !check(); i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      assert.ok(check(), `UI never reached: ${what}. Screen: ${host.textContent?.slice(0, 600)}`);
    };
    const text = () => host.textContent || '';
    const click = async (element: Element | null | undefined) => {
      assert.ok(element, 'required UI control exists');
      await act(async () => {
        (element as HTMLElement).click();
      });
    };
    const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    const fill = async (selector: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(selector);
      assert.ok(input, `required input ${selector} exists`);
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    };
    const submit = async () => {
      const form = host.querySelector('form');
      assert.ok(form, 'form exists');
      await act(async () => {
        form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      });
    };
    const navigateTo = (path: string) => {
      window.history.replaceState(null, '', `${origin}${path}`);
      return path;
    };
    function VisitorBrowser({ initialPath }: { initialPath: string }) {
      const [path, setPath] = useState(initialPath);
      return React.createElement(OnboardingApp, {
        path,
        client: browser as any,
        navigate: (next: string) => {
          window.history.replaceState(null, '', next);
          setPath(next);
        },
      });
    }
    const signInThroughTheForm = async (email: string, password: string) => {
      await wait(() => !!host.querySelector('#onboarding-login-email'), 'login form');
      await fill('#onboarding-login-email', email);
      await fill('#onboarding-login-password', password);
      await submit();
    };
    /** Everything the browser is remembering, as key/value pairs. */
    const browserStorage = () =>
      Object.keys(dom.window.localStorage).map(
        (key) => [key, String(dom.window.localStorage.getItem(key))] as [string, string]
      );
    const sessionKeys = () => browserStorage().filter(([key]) => /^sb-.*-auth-token$/.test(key));
    const captureAttempts = () =>
      requests.filter((request) => request.path === '/api/referral-attribution' && request.method === 'POST').length;

    const ownerEmail = 'phase6.owner@example.com';
    const ownerPassword = 'Phase6Pass!42';
    const partnerEmailA = 'phase6.partner.a@example.com';
    const partnerEmailB = 'phase6.partner.b@example.com';
    let ownerId = '';
    let codeA = '';
    let codeB = '';
    let authoritative = '';
    let linkedAt = '';
    let partnerIdA = '';
    let partnerIdB = '';

    try {
      await boot();
      browser = browserClient();
      dom.reconfigure({ url: `${origin}/onboarding/signup` });
      globalThis.fetch = browserFetch as any;
      window.fetch = browserFetch as any;

      // --- seed two real Growth Partners -----------------------------------
      const admin = directClient();
      assert.equal((await admin.auth.signInWithPassword({ email: LOCAL_DEV_ADMIN_EMAIL, password: LOCAL_DEV_ADMIN_PASSWORD })).error, null);
      const seedA = directClient();
      const seedB = directClient();
      const partnerUserA = await seedA.auth.signUp({
        email: partnerEmailA,
        password: 'Phase6Pass!42',
        options: { data: { full_name: 'Phase Six Partner A' } },
      });
      const partnerUserB = await seedB.auth.signUp({
        email: partnerEmailB,
        password: 'Phase6Pass!42',
        options: { data: { full_name: 'Phase Six Partner B' } },
      });
      assert.ok(partnerUserA.data.user && partnerUserB.data.user);
      const provisionA = await admin.rpc('provision_growth_partner', { p_user_id: partnerUserA.data.user!.id, p_active: true });
      const provisionB = await admin.rpc('provision_growth_partner', { p_user_id: partnerUserB.data.user!.id, p_active: true });
      assert.equal(provisionA.error, null);
      assert.equal(provisionB.error, null);
      codeA = provisionA.data.referral_code;
      codeB = provisionB.data.referral_code;
      partnerIdA = partnerUserA.data.user!.id;
      partnerIdB = partnerUserB.data.user!.id;
      assert.match(codeA, /^NEXORA-/);
      assert.notEqual(codeA, codeB);

      // === 1. THE REFERRAL LINK: validate -> capture -> sign up =============
      navigateTo('/onboarding/signup');
      window.history.replaceState(null, '', `${origin}/onboarding/signup?ref=${codeA}`);
      await render(React.createElement(VisitorBrowser, { initialPath: '/onboarding/signup' }));
      await wait(() => !!host.querySelector('#onboarding-signup-email'), 'signup screen after the referral code validated');
      assert.equal(captureAttempts(), 1, 'the code was validated and captured once');
      const capabilityCookie = jar.getCookiesSync(`${origin}/onboarding/signup`).find((c) => c.key === 'nexora_referral');
      assert.ok(capabilityCookie?.httpOnly, 'the anonymous capability stays in an HttpOnly cookie');

      await fill('#onboarding-signup-full-name', 'Phase Six Owner');
      await fill('#onboarding-signup-email', ownerEmail);
      await fill('#onboarding-signup-phone', '+919845077654');
      await fill('#onboarding-signup-password', ownerPassword);
      await fill('#onboarding-signup-confirm', ownerPassword);
      await submit();
      await wait(() => host.textContent!.includes('Linked with code'), 'status screen showing the linked code');

      const signedIn = await browser.auth.getUser();
      ownerId = signedIn.data.user!.id;
      assert.ok(ownerId, 'signup produced a real account');
      const first = await browser.rpc('get_my_onboarding_status');
      assert.equal(first.error, null);
      assert.equal(first.data.linked, true);
      assert.equal(first.data.referral_code, codeA);
      assert.equal(first.data.growth_partner_id, partnerIdA);
      authoritative = JSON.stringify(first.data);
      linkedAt = String(first.data.linked_at);
      t.diagnostic(`1. signed up through ?ref=${codeA} — attribution stored server-side`);

      // === 2. REFRESH ======================================================
      // A reload: same browser, same session, no ?ref in the URL at all.
      const capturesBeforeRefresh = captureAttempts();
      navigateTo('/onboarding/status');
      await render(React.createElement(VisitorBrowser, { initialPath: '/onboarding/status' }));
      await wait(() => text().includes(codeA), 'status screen after a refresh');
      assert.equal(captureAttempts(), capturesBeforeRefresh, 'a refresh with no ?ref captures nothing');
      const refreshed = await browser.rpc('get_my_onboarding_status');
      assert.equal(JSON.stringify(refreshed.data), authoritative, 'the refresh read the same authoritative row');
      assert.equal(window.location.search, '', 'no referral URL is kept around after the fact');
      t.diagnostic('2. refresh: attributed to the same partner, from the server');

      // === 3. WHAT THE BROWSER REMEMBERS ===================================
      const storage = browserStorage();
      assert.equal(sessionKeys().length, 1, 'exactly one remembered item: the auth session');
      const session = JSON.parse(sessionKeys()[0][1]);
      assert.ok(session.access_token && session.refresh_token, 'the stored item is the Supabase session');
      assert.equal(session.user.id, ownerId);
      for (const [key, value] of storage) {
        assert.ok(!/refer|partner|attribut|growth_onboarding|ledger/i.test(key), `localStorage key "${key}" is not attribution state`);
        assert.ok(!value.includes(codeA) && !value.includes(codeB), `localStorage value "${key}" carries no referral code`);
        assert.ok(!value.includes(partnerIdA) && !value.includes(partnerIdB), `localStorage value "${key}" carries no partner identity`);
        assert.ok(!/NEXORA-/.test(value), `localStorage value "${key}" carries no partner code pattern`);
      }
      // What the browser CAN read is the server's own row, scoped by RLS to this
      // account: a read, never a store. Nothing in the browser is authoritative.
      const ownRow = await browser.from('growth_onboarding').select('growth_partner_id, referral_code, status').eq('user_id', ownerId);
      assert.equal(ownRow.error, null);
      assert.deepEqual(ownRow.data, [{ growth_partner_id: partnerIdA, referral_code: codeA, status: 'linked' }]);
      // The relationship ledger itself is not exposed to the referred account at
      // all (the only SELECT policy belongs to the owning partner), so there is
      // no client-side copy that could ever be treated as the source of truth.
      const ownerLedgerView = await browser.from('partner_referrals').select('referral_code, status');
      assert.equal(ownerLedgerView.error, null);
      assert.deepEqual(ownerLedgerView.data, [], 'the referred account holds no readable ledger copy');
      const ledgerTruth = await seedA.from('partner_referrals').select('referral_code, status, referred_user_id').eq('referred_user_id', ownerId);
      assert.equal(ledgerTruth.error, null);
      assert.equal(ledgerTruth.data!.length, 1, 'the ledger row exists — on the partner who owns it');
      assert.equal(ledgerTruth.data![0].referral_code, codeA);
      assert.equal(ledgerTruth.data![0].status, 'pending');
      t.diagnostic('3. localStorage holds the auth session only — no attribution state');

      // === 4. LOGOUT -> LOGIN ==============================================
      await click(button('Sign out'));
      await wait(() => !!host.querySelector('#onboarding-login-email'), 'login screen after signing out');
      assert.equal((await browser.auth.getSession()).data.session, null, 'really signed out');
      assert.equal(sessionKeys().length, 0, 'the remembered session was removed');
      await signInThroughTheForm(ownerEmail, ownerPassword);
      await wait(() => text().includes(codeA), 'status screen after logging back in');
      const afterLogin = await browser.rpc('get_my_onboarding_status');
      assert.equal(afterLogin.data.growth_partner_id, partnerIdA);
      assert.equal(afterLogin.data.referral_code, codeA);
      assert.equal(JSON.stringify(afterLogin.data), authoritative, 'logout + login changed nothing in the authoritative row');
      t.diagnostic('4. logout -> login: same account, same attribution');

      // === 5. BROWSER RESTART ==============================================
      // New browser: no cookies, no localStorage, a brand new client instance.
      // Nothing of the previous session survives except the server-side row.
      dom.window.localStorage.clear();
      dom.window.sessionStorage.clear();
      jar = new CookieJar();
      browser = browserClient();
      navigateTo('/onboarding/status');
      await render(React.createElement(VisitorBrowser, { initialPath: '/onboarding/status' }));
      await wait(() => !!host.querySelector('#onboarding-login-email'), 'login screen in a browser that remembers nothing');
      assert.equal((await browser.auth.getSession()).data.session, null, 'the restart really wiped the login');
      await signInThroughTheForm(ownerEmail, ownerPassword);
      await wait(() => text().includes(codeA), 'status screen after the browser restart');
      const afterBrowserRestart = await browser.rpc('get_my_onboarding_status');
      assert.equal(JSON.stringify(afterBrowserRestart.data), authoritative, 'the browser restart changed nothing');
      t.diagnostic('5. browser restart: wiping the browser costs a login, never the referral');

      // === 6. A LATER ?ref=PARTNER-B LINK ==================================
      const capturesBeforeLaterLink = captureAttempts();
      const laterRef = `${origin}/onboarding/signup?ref=${codeB}`;
      window.history.replaceState(null, '', laterRef);
      await render(React.createElement(VisitorBrowser, { initialPath: `/onboarding/signup?ref=${codeB}` }));
      await wait(() => text().includes('This account is already registered.'), 'existing-account notice for a signed-in owner');
      assert.ok(
        text().includes('Opening a referral link does not change your existing attribution.'),
        'the notice states the attribution rule'
      );
      assert.equal(captureAttempts(), capturesBeforeLaterLink, 'a signed-in owner captures nothing from a referral link');
      assert.ok(
        !jar.getCookiesSync(`${origin}/onboarding/signup`).some((c) => c.key === 'nexora_referral'),
        'no capability cookie was issued to an existing account'
      );
      const afterLaterLink = await browser.rpc('get_my_onboarding_status');
      assert.equal(afterLaterLink.data.growth_partner_id, partnerIdA, 'PARTNER-A still owns the account');
      assert.equal(afterLaterLink.data.referral_code, codeA);
      assert.equal(JSON.stringify(afterLaterLink.data), authoritative, 'the later link changed nothing');
      // And the account still cannot be re-pointed by asking the RPC directly.
      const relink = await browser.rpc('link_my_growth_referral', { p_code: codeB });
      assert.equal(relink.error?.code, '22023', 'the server refuses the reassignment');
      const ledgerAfterLaterLink = await seedA
        .from('partner_referrals')
        .select('referral_code, status, referred_user_id')
        .eq('referred_user_id', ownerId);
      assert.equal(ledgerAfterLaterLink.data!.length, 1, 'still exactly one ledger row');
      assert.equal(ledgerAfterLaterLink.data![0].referral_code, codeA, 'still the original code');
      t.diagnostic(`6. ?ref=${codeB} after attribution: refused, nothing re-attributed`);

      // === 7. THE RELATIONSHIP AS THE PARTNER SEES IT =======================
      const seedA2 = directClient();
      const seedB2 = directClient();
      assert.equal((await seedA2.auth.signInWithPassword({ email: partnerEmailA, password: 'Phase6Pass!42' })).error, null);
      assert.equal((await seedB2.auth.signInWithPassword({ email: partnerEmailB, password: 'Phase6Pass!42' })).error, null);
      const listA = await seedA2.rpc('get_my_partner_referrals');
      assert.equal(listA.error, null, `partner A referral list: ${JSON.stringify(listA.error)}`);
      assert.equal(listA.data.total, 1, 'partner A really holds one referral');
      assert.equal(listA.data.rows[0].referral_code, codeA);
      // `status` is the onboarding stage ('linked'); `referral_status` is the
      // effective partner-facing lifecycle state, which starts at 'pending'.
      assert.equal(listA.data.rows[0].referral_status, 'pending');
      const listB = await seedB2.rpc('get_my_partner_referrals');
      assert.equal(listB.data.total, 0, 'partner B holds none — their link was only a click');
      t.diagnostic('7. the partner ledger shows the referral on A and nothing on B');

      // === 8. SERVER RESTART + A FRESH BROWSER =============================
      // The strongest form of the question: nothing survives in any process
      // memory and nothing survives in the browser. Only the database row does.
      if (root) await act(async () => root!.unmount());
      root = undefined;
      await browser.auth.stopAutoRefresh();
      await stop();
      dom.window.localStorage.clear();
      dom.window.sessionStorage.clear();
      jar = new CookieJar();
      await boot();
      browser = browserClient();
      navigateTo('/onboarding/login');
      await render(React.createElement(VisitorBrowser, { initialPath: '/onboarding/login' }));
      await signInThroughTheForm(ownerEmail, ownerPassword);
      await wait(() => text().includes(codeA), 'status screen after the server restart');
      const afterServerRestart = await browser.rpc('get_my_onboarding_status');
      assert.equal(afterServerRestart.data.linked, true);
      assert.equal(afterServerRestart.data.growth_partner_id, partnerIdA);
      assert.equal(afterServerRestart.data.referral_code, codeA);
      assert.equal(String(afterServerRestart.data.linked_at), linkedAt, 'the original link instant survived');
      assert.equal(JSON.stringify(afterServerRestart.data), authoritative, 'the database row is the whole truth');

      const seedA3 = directClient();
      assert.equal((await seedA3.auth.signInWithPassword({ email: partnerEmailA, password: 'Phase6Pass!42' })).error, null);
      const persisted = await seedA3.from('partner_referrals').select('referral_code, status, referred_user_id').eq('referred_user_id', ownerId);
      assert.equal(persisted.error, null);
      assert.equal(persisted.data!.length, 1);
      assert.equal(persisted.data![0].referral_code, codeA);
      assert.equal(persisted.data![0].referred_user_id, ownerId);
      t.diagnostic('8. server restart + fresh browser: same row, same partner, same instant');

      await seedA.auth.stopAutoRefresh();
      await seedB.auth.stopAutoRefresh();
      await seedA2.auth.stopAutoRefresh();
      await seedB2.auth.stopAutoRefresh();
      await seedA3.auth.stopAutoRefresh();
    } finally {
      if (root) await act(async () => root!.unmount());
      await browser.auth.stopAutoRefresh();
      host.remove();
      await stop();
      globalThis.fetch = oldFetch;
      window.fetch = oldWindowFetch;
      (globalThis as Record<string, unknown>).sessionStorage = oldSessionStorage;
      dom.window.localStorage.clear();
      dom.window.sessionStorage.clear();
      await rm(dataDir, { recursive: true, force: true });
    }
  }
);
