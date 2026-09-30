// ============================================================================
// The /admin first-Super-Admin claim — DOM-level click verification.
//
// A fresh project has the admin schema but no admin_members row, so every
// account is "not staff" and the panel could never be opened. /admin now
// bootstraps itself: a signed-in non-staff account on a project with NO active
// admin sees "No Super Admin exists on this project yet." and a
// "Claim Super Admin access" button (data-testid="admin-claim-setup").
//
// This file mounts the REAL App at /admin against a stateful stubbed
// PostgREST and proves:
//   • sign in -> claim button -> claim_first_super_admin() -> access is re-read
//     -> the Super Admin shell renders;
//   • a configured project (admin_setup_state.claimable = false) shows the plain
//     staff-only refusal and NO claim button;
//   • a project without the admin schema (PGRST202) shows the SQL Editor
//     guidance and NO claim button;
//   • a refused claim surfaces its message and keeps the panel closed.
// ============================================================================

import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';
import { supabase } from '../../src/lib/supabaseClient';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

// The real App reads sessionStorage during render (referral tracker); jsdom's
// window has it but the Node global is not defined by jsdomSetup. Expose it so
// the app code runs its real branch instead of the storage-failure fallback.
if (typeof (globalThis as { sessionStorage?: unknown }).sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
  });
}

/** GoTrue password-grant response for the stubbed auth endpoint. */
function passwordGrantResponse(email: string): string {
  return JSON.stringify({
    access_token: 'claimer-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_token: 'claimer-refresh-token',
    user: {
      id: 'claimer-user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  });
}

async function mountApp(): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App));
  });
  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function wait(check: () => boolean, label: string) {
  for (let i = 0; i < 300 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), `admin claim flow did not reach: ${label}. Screen: ${document.body.textContent?.slice(0, 800)}`);
}

function button(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  assert.ok(input, selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}


interface ProjectState {
  claimable: boolean;
  /** Overrides: RPC name -> response (status + body). */
  overrides?: Record<string, { status: number; body: unknown }>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Stateful stub of the project: claiming flips get_my_admin_access to Super Admin. */
function installProject(project: ProjectState) {
  const calls: string[] = [];
  let staff = false;
  const stub = (async (input: any) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === '/auth/v1/token') {
      return new Response(passwordGrantResponse('founder@nexora.example'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop() as string;
      calls.push(name);
      const override = project.overrides?.[name];
      if (override) return json(override.status, override.body);
      if (name === 'get_my_admin_access') {
        return json(200, staff
          ? { is_admin: true, role: 'super_admin', work_area: null, can_manage_money: true }
          : { is_admin: false, role: null, work_area: null, can_manage_money: false });
      }
      if (name === 'admin_setup_state') {
        return json(200, { has_admin: !project.claimable, claimable: project.claimable });
      }
      if (name === 'claim_first_super_admin') {
        if (!project.claimable) {
          return json(400, { code: '55006', message: 'A Super Admin already exists on this project. Ask them to share an onboarding link instead.' });
        }
        staff = true;
        project.claimable = false;
        return json(200, { role: 'super_admin', claimed: true });
      }
    }
    const isTableSelect = url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/');
    return json(200, isTableSelect ? [] : {});
  }) as any;
  return { calls, stub };
}

async function withProject<T>(project: ProjectState, run: (ctx: { host: HTMLElement; calls: string[] }) => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const { calls, stub } = installProject(project);
  try {
    globalThis.fetch = stub;
    (dom.window as any).fetch = stub;
    dom.reconfigure({ url: 'http://localhost:3000/admin' });
    const { host, unmount } = await mountApp();
    try {
      return await run({ host, calls });
    } finally {
      await unmount();
      // The Supabase client keeps the session between tests; every test must
      // start signed out so it walks the real sign-in card.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
    (dom.window as any).fetch = originalFetch;
  }
}

async function signInThroughModal(host: HTMLElement) {
  const signIn = button(host, 'Sign in');
  assert.ok(signIn, 'the sign-in card has a Sign in button');
  await act(async () => {
    signIn!.click();
  });
  await wait(() => !!host.querySelector('input[name="auth-email"]'), 'auth form');
  await fill('input[name="auth-email"]', 'founder@nexora.example');
  await fill('input[name="auth-password"]', 'Founder#12345');
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

const claimButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="admin-claim-setup"]');

test('a fresh project: sign in, claim Super Admin access, and the Super Admin shell opens', async () => {
  await withProject({ claimable: true }, async ({ host, calls }) => {
    await signInThroughModal(host);

    await wait(() => !!claimButton(host), 'the Claim Super Admin access button');
    assert.match(host.textContent || '', /No Super Admin exists on this project yet\./);
    assert.equal(claimButton(host)!.textContent?.trim(), 'Claim Super Admin access');
    assert.doesNotMatch(host.textContent || '', /This area is for Nexora staff/);
    assert.equal(calls.includes('claim_first_super_admin'), false, 'nothing is claimed before the click');

    await act(async () => {
      claimButton(host)!.click();
    });

    await wait(() => calls.includes('claim_first_super_admin'), 'claim_first_super_admin called');
    await wait(() => (host.textContent || '').includes('Team & roles'), 'Super Admin shell rendered after the claim');
    assert.match(host.textContent || '', /Super Admin/);
    assert.equal(claimButton(host), null, 'the claim card is gone once the panel opens');
    // Access was re-read from SQL after the claim, not assumed.
    assert.ok(calls.filter((name) => name === 'get_my_admin_access').length >= 2, 'access reloaded after the claim');
  });
});

test('a configured project (claimable: false) shows the staff-only refusal and no claim button', async () => {
  await withProject({ claimable: false }, async ({ host, calls }) => {
    await signInThroughModal(host);

    await wait(() => (host.textContent || '').includes('This area is for Nexora staff'), 'staff-only refusal');
    assert.ok(calls.includes('admin_setup_state'), 'the setup state was consulted');
    assert.equal(claimButton(host), null, 'no claim button on a configured project');
    assert.doesNotMatch(host.textContent || '', /No Super Admin exists/);
    assert.equal(calls.includes('claim_first_super_admin'), false);
  });
});

test('a project without the admin schema shows the SQL Editor guidance and no claim button', async () => {
  const missing = {
    status: 404,
    body: { code: 'PGRST202', message: 'Could not find the function public.get_my_admin_access without parameters in the schema cache' },
  };
  await withProject(
    {
      claimable: true,
      overrides: {
        get_my_admin_access: missing,
        admin_setup_state: { ...missing, body: { ...missing.body, message: 'Could not find the function public.admin_setup_state' } },
      },
    },
    async ({ host }) => {
      await signInThroughModal(host);

      await wait(() => !!host.querySelector('[data-testid="admin-schema-missing"]'), 'schema guidance card');
      assert.match(host.textContent || '', /Supabase Dashboard → SQL Editor/);
      assert.match(host.textContent || '', /supabase\/apply_admin_management\.sql/);
      assert.equal(claimButton(host), null);
    }
  );
});

test('a refused claim shows the reason and keeps the panel closed', async () => {
  await withProject(
    {
      claimable: true,
      overrides: {
        claim_first_super_admin: {
          status: 400,
          body: { code: '55006', message: 'A Super Admin already exists on this project. Ask them to share an onboarding link instead.' },
        },
      },
    },
    async ({ host }) => {
      await signInThroughModal(host);
      await wait(() => !!claimButton(host), 'claim button');
      await act(async () => {
        claimButton(host)!.click();
      });
      await wait(() => !!host.querySelector('[data-testid="admin-claim-error"]'), 'claim refusal message');
      assert.match(host.textContent || '', /A Super Admin already exists on this project/);
      assert.equal((host.textContent || '').includes('Team & roles'), false, 'the panel stays closed');
    }
  );
});
