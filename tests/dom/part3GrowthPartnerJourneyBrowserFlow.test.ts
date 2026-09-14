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
import {
  registerLocalSupabaseGateway,
  createLocalDatabase,
  LOCAL_DEV_ADMIN_EMAIL,
  LOCAL_DEV_ADMIN_PASSWORD,
} from '../../server/localSupabase';
import { registerReferralAttributionRoutes } from '../../server/referralAttribution';
import { supabase } from '../../src/lib/supabaseClient';
import { GrowthPartnerPage } from '../../src/components/GrowthPartnerPage';
import { OnboardingApp } from '../../src/onboarding/OnboardingApp';
import { TemplateHandoffPage } from '../../src/components/TemplateHandoffPage';
import { HANDOFF_STATE_KEY, TEMPLATE_HANDOFF_ROUTE } from '../../src/onboarding/lib/handoff';

after(() => dom.window.close());

// ============================================================================
// PHASE 7 — PART 3 × GROWTH PARTNER, in a browser.
//
// The database half of this verification is tests/part3GrowthPartnerIntegration.test.ts.
// This is the same journey through the real components: a visitor arrives on a
// partner's share link, signs up, walks the PART 3 funnel (handoff → owner
// workspace), and the partner's own portal shows the referral move
// Pending → Active → Converted.
//
// Real components, real HTTP, real Supabase Auth, real RPC/RLS on disk-backed
// PostgreSQL. The only thing not driven through the UI is the editor's cloud
// save: `complete_template_onboarding()` — the exact RPC WebsiteEditor fires
// after a successful save — is called directly here, with the two rows that
// save writes (a named/slugged profile and one owned service) seeded through
// the database while the gateway is stopped. Everything else, including the
// partner portal's rendering, goes through the real stack.
// ============================================================================

test(
  'PHASE 7: a PART 3 owner journey produces one referral the partner watches go pending -> active -> converted',
  { timeout: 240_000 },
  async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'part3-partner-'));
    const oldFetch = globalThis.fetch;
    const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let origin = '';
    let port = 0;
    let server: Server | undefined;
    let closeDb: (() => Promise<void>) | undefined;
    const jar = new CookieJar();
    let clientIndex = 0;
    const requests: { path: string; method: string; status: number }[] = [];
    const rpcResults: Record<string, any> = {};

    const ownerEmail = 'phase7.owner@example.com';
    const ownerPassword = 'Phase7Owner!42';
    const partnerEmail = 'phase7.partner@example.com';
    const partnerPassword = 'Phase7Partner!42';
    const otherPartnerEmail = 'phase7.other.partner@example.com';

    /** The browser's HTTP: local app APIs only, with the browser's own cookies. */
    const browserFetch = async (input: any, init: any) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, origin);
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
      if (url.pathname.startsWith('/rest/v1/rpc/') && response.ok) {
        // The handoff grant is returned to the caller, so read the response the
        // real client would have consumed.
        rpcResults[url.pathname.split('/').pop()!] = await response.clone().json();
      }
      return response;
    };

    const client = () =>
      createClient(origin, 'local-dev-key', {
        auth: {
          storageKey: `phase7-${clientIndex++}`,
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { fetch: browserFetch as any },
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
      registerReferralAttributionRoutes(app, (fn, args) => client().rpc(fn, args));
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
    const render = async (node: React.ReactNode) => {
      if (root) await act(async () => root!.unmount());
      root = createRoot(host);
      await act(async () => root!.render(node));
    };
    const wait = async (check: () => boolean, what: string) => {
      for (let index = 0; index < 500 && !check(); index++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      assert.ok(check(), `UI never reached: ${what}. Screen: ${host.textContent?.slice(0, 500)}`);
    };
    const text = () => host.textContent || '';
    const button = (label: string) => [...host.querySelectorAll('button')].find((element) => element.textContent?.trim() === label);
    const click = async (element: Element | null | undefined) => {
      assert.ok(element, 'required UI control exists');
      await act(async () => {
        (element as HTMLElement).click();
      });
    };
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
    const captureRequests = () => requests.filter((request) => request.path === '/api/referral-attribution' && request.method === 'POST').length;

    let ownerClient!: ReturnType<typeof client>;
    let visitorPath = '/onboarding/signup';
    function VisitorBrowser() {
      const [path, setPath] = useState(visitorPath);
      return React.createElement(OnboardingApp, {
        path,
        client: ownerClient as any,
        navigate: (next: string) => {
          window.history.replaceState(null, '', next);
          setPath(next);
        },
      });
    }
    function PartnerBrowser({ initialPath }: { initialPath: string }) {
      const [path, setPath] = useState(initialPath);
      const [user, setUser] = useState<any>(null);
      const [restoring, setRestoring] = useState(true);
      useEffect(() => {
        let mounted = true;
        void supabase.auth.getSession().then(({ data }) => {
          if (mounted) {
            setUser(data.session?.user ?? null);
            setRestoring(false);
          }
        });
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (mounted) setUser(session?.user ?? null);
        });
        return () => {
          mounted = false;
          data.subscription.unsubscribe();
        };
      }, []);
      return restoring
        ? React.createElement('p', null, 'Restoring session')
        : React.createElement(GrowthPartnerPage, {
            path,
            user,
            navigate: (next: string) => setPath(next),
            onLogout: () => {
              void supabase.auth.signOut();
            },
          });
    }
    /** The dashboard overview: the section that carries the KPI cards. */
    const showDashboard = async () => {
      await render(React.createElement(PartnerBrowser, { initialPath: '/partner/dashboard' }));
      await wait(() => !!host.querySelector('[aria-label="Referral summary"]'), 'the partner dashboard KPIs');
    };
    /** The referred-users section: the section that carries the referral rows. */
    const showReferredUsers = async () => {
      await showDashboard();
      await click(host.querySelector('[data-partner-nav="referred-users"]'));
      await wait(() => !!host.querySelector('[aria-label="Referred users"]'), 'the referred users section');
      await wait(() => !!host.querySelector('[aria-label="Referred users"] tbody tr'), 'the referral list to load');
    };
    const referralRow = () => {
      const rows = host.querySelectorAll('[aria-label="Referred users"] tbody tr');
      assert.equal(rows.length, 1, 'exactly one referral row');
      return rows[0];
    };
    const summary = () => host.querySelector('[aria-label="Referral summary"]')!.textContent!;

    let codeA = '';
    let codeB = '';
    let ownerId = '';
    let attributionBefore = '';

    try {
      await boot();
      dom.reconfigure({ url: `${origin}${visitorPath}` });
      globalThis.fetch = browserFetch as any;
      window.fetch = browserFetch as any;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
      ownerClient = client();
      await ownerClient.auth.stopAutoRefresh();
      await supabase.auth.stopAutoRefresh();

      // --- seed the two Growth Partners through the admin path --------------
      const admin = client();
      assert.equal((await admin.auth.signInWithPassword({ email: LOCAL_DEV_ADMIN_EMAIL, password: LOCAL_DEV_ADMIN_PASSWORD })).error, null);
      const partnerSeed = client();
      const otherSeed = client();
      const partnerUser = await partnerSeed.auth.signUp({
        email: partnerEmail,
        password: partnerPassword,
        options: { data: { full_name: 'Phase Seven Partner' } },
      });
      const otherUser = await otherSeed.auth.signUp({ email: otherPartnerEmail, password: 'Phase7Other!42' });
      assert.ok(partnerUser.data.user && otherUser.data.user);
      const provisioned = await admin.rpc('provision_growth_partner', { p_user_id: partnerUser.data.user!.id, p_active: true });
      const otherProvisioned = await admin.rpc('provision_growth_partner', { p_user_id: otherUser.data.user!.id, p_active: true });
      assert.equal(provisioned.error, null);
      assert.equal(otherProvisioned.error, null);
      codeA = provisioned.data.referral_code;
      codeB = otherProvisioned.data.referral_code;
      assert.match(codeA, /^NEXORA-[A-Z0-9]{12}$/, 'a generated code');
      assert.notEqual(codeA, codeB);
      t.diagnostic(`partner code: ${codeA}`);

      // --- 1. the share link: validate, capture, sign up --------------------
      // The query lives in the address bar; the router matches the clean path.
      window.history.replaceState(null, '', `${origin}/onboarding/signup?ref=${codeA}`);
      visitorPath = '/onboarding/signup';
      await render(React.createElement(VisitorBrowser));
      await wait(() => !!host.querySelector('#onboarding-signup-full-name'), 'the signup screen for a valid share link');
      assert.equal(captureRequests(), 1, 'the code was validated through the real endpoint');
      assert.ok(jar.getCookiesSync(`${origin}/onboarding/signup`).some((cookie) => cookie.key === 'nexora_referral' && cookie.httpOnly));
      await fill('#onboarding-signup-full-name', 'Phase Seven Owner');
      await fill('#onboarding-signup-email', ownerEmail);
      await fill('#onboarding-signup-phone', '+919845077654');
      await fill('#onboarding-signup-password', ownerPassword);
      await fill('#onboarding-signup-confirm', ownerPassword);
      await submit();
      await wait(() => text().includes('Linked with code'), 'the status screen naming the linked code');
      assert.ok(text().includes(codeA), 'the owner sees the partner code they came in on');

      const signedIn = await ownerClient.auth.getUser();
      ownerId = signedIn.data.user!.id;
      const statusBefore = await ownerClient.rpc('get_my_onboarding_status');
      assert.equal(statusBefore.data.linked, true);
      assert.equal(statusBefore.data.referral_code, codeA);
      attributionBefore = JSON.stringify({
        growth_partner_id: statusBefore.data.growth_partner_id,
        referral_code: statusBefore.data.referral_code,
        linked_at: statusBefore.data.linked_at,
      });
      t.diagnostic('1. signed up through the share link — attribution written server-side');

      // --- 2. the partner sees the referral as Pending ----------------------
      assert.equal((await supabase.auth.signInWithPassword({ email: partnerEmail, password: partnerPassword })).error, null);
      await showDashboard();
      assert.match(summary(), /1Total Referrals/);
      assert.match(summary(), /1Pending Referrals/);
      assert.match(host.querySelector('[aria-label="Recent activity"]')!.textContent!, /Phase Seven Owner/);
      await showReferredUsers();
      assert.match(referralRow().textContent!, /Pending/);
      assert.ok(!text().includes(ownerEmail), "the referred owner's email is never rendered");
      assert.ok(!text().includes(ownerId), "the referred owner's id is never rendered");
      assert.match(host.querySelector('[aria-label="Referred users"]')!.textContent!, /ph\*\*\*@example\.com/);
      t.diagnostic('2. partner dashboard: one referral, pending, contact masked');

      // --- 3. the PART 3 funnel: handoff -> workspace -----------------------
      await render(React.createElement(VisitorBrowser));
      await wait(() => !!button('Continue to Template App'), 'the handoff button');
      await click(button('Continue to Template App'));
      await wait(() => !!rpcResults['create_template_handoff'], 'the handoff grant');
      const token: string = rpcResults['create_template_handoff'].token;
      assert.match(token, /^[a-f0-9]{64}$/);
      const state = dom.window.sessionStorage.getItem(HANDOFF_STATE_KEY);
      const handoffPath = `${TEMPLATE_HANDOFF_ROUTE}?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state!)}`;

      let landed = '';
      dom.reconfigure({ url: `${origin}${handoffPath}` });
      window.history.replaceState(null, '', handoffPath);
      await render(React.createElement(TemplateHandoffPage, { client: ownerClient as any, navigate: (to: string) => { landed = to; } }));
      await wait(() => landed !== '', 'entry into the Template App');
      assert.equal(landed, '/');

      const workspace = await ownerClient.rpc('get_my_owner_workspace');
      assert.equal(workspace.error, null);
      assert.equal(workspace.data.resolved, true, 'PART 3 provisioned a workspace at the handoff boundary');
      assert.ok(workspace.data.organization_id && workspace.data.salon_id && workspace.data.slug);
      const statusAfter = await ownerClient.rpc('get_my_onboarding_status');
      assert.equal(statusAfter.data.status, 'template_started');
      assert.equal(
        JSON.stringify({
          growth_partner_id: statusAfter.data.growth_partner_id,
          referral_code: statusAfter.data.referral_code,
          linked_at: statusAfter.data.linked_at,
        }),
        attributionBefore,
        'the PART 3 workspace step left the referral attribution untouched'
      );
      t.diagnostic('3. handoff + workspace: active funnel, same attribution');

      // --- 4. the partner sees it move to Active ----------------------------
      await showDashboard();
      assert.match(summary(), /1Total Referrals/);
      assert.match(summary(), /1Active Referrals/);
      await showReferredUsers();
      assert.match(referralRow().textContent!, /Active/);
      const ledgersAfterEntry = await partnerSeed.from('partner_referrals').select('referral_code, status, conversion_status').eq('referred_user_id', ownerId);
      assert.equal(ledgersAfterEntry.data!.length, 1);
      assert.deepEqual(
        { referral_code: ledgersAfterEntry.data![0].referral_code, status: ledgersAfterEntry.data![0].status, conversion: ledgersAfterEntry.data![0].conversion_status },
        { referral_code: codeA, status: 'active', conversion: 'not_converted' }
      );
      t.diagnostic('4. partner dashboard: the referral is active, one ledger row');

      // --- 5. the editor's save completes the website, and the referral with it
      // The gateway has no REST route for `services`/`profiles`, so the rows the
      // editor's legacy save writes are seeded directly while it is stopped.
      await supabase.auth.signOut();
      await ownerClient.auth.stopAutoRefresh();
      await stop();
      const seedDb = await createLocalDatabase(dataDir);
      try {
        await seedDb.db.query("update public.profiles set subdomain = 'phase7-owner', salon_name = 'Phase Seven Salon' where id = $1", [ownerId]);
        await seedDb.db.query('insert into public.services(id, owner_id) values (gen_random_uuid(), $1)', [ownerId]);
      } finally {
        await seedDb.close();
      }
      await boot();
      ownerClient = client();
      assert.equal((await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })).error, null);
      // Sessions are deliberately process-local in the local gateway, so the
      // partner's service-side client signs in again after the restart too.
      assert.equal((await partnerSeed.auth.signInWithPassword({ email: partnerEmail, password: partnerPassword })).error, null);
      const completed = await ownerClient.rpc('complete_template_onboarding');
      assert.equal(completed.error, null, `completion: ${JSON.stringify(completed.error)}`);
      assert.equal(completed.data.completed, true);
      assert.equal(completed.data.referral_code, codeA, 'completion never moves the referral');

      // --- 6. the partner sees Converted ------------------------------------
      assert.equal((await supabase.auth.signInWithPassword({ email: partnerEmail, password: partnerPassword })).error, null);
      await showDashboard();
      assert.match(summary(), /1Converted Referrals/);
      assert.match(summary(), /0Pending Referrals/);
      await showReferredUsers();
      assert.match(referralRow().textContent!, /Converted/);
      assert.ok(!text().includes(ownerEmail));
      const ledgersAfterCompletion = await partnerSeed.from('partner_referrals').select('status, conversion_status, converted_at').eq('referred_user_id', ownerId);
      assert.equal(ledgersAfterCompletion.data!.length, 1, 'still exactly one referral record');
      assert.equal(ledgersAfterCompletion.data![0].status, 'converted');
      assert.equal(ledgersAfterCompletion.data![0].conversion_status, 'converted');
      assert.ok(ledgersAfterCompletion.data![0].converted_at);
      t.diagnostic('6. partner dashboard: the same referral is converted');

      // --- 7. and the attribution is still the original one -----------------
      const relink = await ownerClient.rpc('link_my_growth_referral', { p_code: codeB });
      assert.equal(relink.error?.code, '22023', 'a second partner cannot claim the account');
      const finalStatus = await ownerClient.rpc('get_my_onboarding_status');
      assert.equal(finalStatus.data.growth_partner_id, statusBefore.data.growth_partner_id);
      assert.equal(finalStatus.data.referral_code, codeA);
      assert.equal(String(finalStatus.data.linked_at), String(statusBefore.data.linked_at));
      t.diagnostic('7. attribution unchanged end to end');

      await partnerSeed.auth.stopAutoRefresh();
      await otherSeed.auth.stopAutoRefresh();
      await admin.auth.stopAutoRefresh();
    } finally {
      if (root) await act(async () => root!.unmount());
      await ownerClient?.auth.stopAutoRefresh();
      await supabase.auth.stopAutoRefresh();
      host.remove();
      await stop();
      globalThis.fetch = oldFetch;
      window.fetch = oldFetch as any;
      if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
      else delete (navigator as any).clipboard;
      await rm(dataDir, { recursive: true, force: true });
    }
  }
);
