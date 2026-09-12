// ============================================================================
// Growth Partner — DOM-level click verification.
//
// A real Chromium cannot be installed in this sandbox (the browser CDNs and apt
// mirrors are unreachable), so this file mounts the REAL components with
// react-dom/client into jsdom and dispatches REAL click/input events. It proves
// the wiring a browser depends on:
//
//   • the header's Growth Partner link works from the desktop row AND from the
//     mobile menu (open the menu, then click) — the entry that was previously
//     unreachable below the `lg` breakpoint;
//   • the login form's button submits what was typed, and the page's handler
//     calls Supabase Auth with exactly those credentials;
//   • the sign-up switch opens the application form and its button submits;
//   • the "Application under review" card's buttons re-check / go back / switch
//     account;
//   • the admin review queue's Approve and Reject buttons decide the right row;
//   • an active partner is forwarded to the partner area.
//
// What this is NOT: a rendering/pixel check. Layout, CSS breakpoints and visual
// state need a real browser (the live preview).
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Header } from '../../src/components/Header';
import {
  GrowthPartnerAdminReviewPanel,
  GrowthPartnerLogin,
  GrowthPartnerLoginForm,
  GrowthPartnerLoginPendingReview,
  GrowthPartnerLoginUnauthorized,
} from '../../src/components/GrowthPartnerLogin';
import { GROWTH_PARTNER_PATH } from '../../src/lib/router';
import type { GrowthPartnerAuthClient } from '../../src/lib/growthPartnerLogin';

// Close the jsdom window once the file is done. No process.exit(): it truncates
// the TAP stream and silently drops the last test's result.
after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

const PARTNER_ID = 'a0000000-0000-4000-8000-000000000001';
const ACTIVE_ROW = {
  user_id: PARTNER_ID,
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-12T00:00:00Z',
  updated_at: '2026-09-12T00:00:00Z',
};

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(() => root.render(element));
  return {
    container,
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

async function click(el: Element | null, what = 'element') {
  assert.ok(el, `expected to find ${what} in the DOM`);
  await act(() => {
    (el as HTMLElement).click();
  });
}

/** Type into a controlled input the way a browser does (native setter + input event). */
async function type(input: Element | null, value: string, what = 'input') {
  assert.ok(input, `expected to find ${what} in the DOM`);
  const setter = Object.getOwnPropertyDescriptor(
    (globalThis as any).HTMLInputElement.prototype,
    'value'
  )!.set!;
  await act(() => {
    setter.call(input, value);
    input!.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  });
}

const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((el) => (el.textContent || '').trim().includes(text));

/**
 * Press a submit button. jsdom does not implement implicit submission on click,
 * so this asserts the button really is an in-form `type="submit"` control (that
 * is what makes a browser click submit) and then invokes the form's own submit
 * path — requestSubmit(), falling back to a bubbling submit event.
 */
async function pressSubmit(button: Element | null, what: string) {
  assert.ok(button, `expected to find ${what}`);
  assert.equal(button.getAttribute('type'), 'submit', `${what} must be a submit button`);
  const form = button.closest('form');
  assert.ok(form, `${what} must live inside its form`);
  await act(() => {
    if (typeof (form as any).requestSubmit === 'function') (form as any).requestSubmit();
    else form!.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------
// Header navigation — desktop row and mobile menu
// ---------------------------------------------------------------------------

function headerProps(patch: Record<string, unknown> = {}) {
  return {
    currentView: 'landing' as any,
    setCurrentView: () => {},
    salonName: 'Nexora Salon',
    // Signed-out visitor on purpose: the entries must exist for everyone, and a
    // signed-in user would start NotificationBell's 3s poll, which opens a real
    // socket to the placeholder host and keeps the test process alive.
    user: null,
    setUser: () => {},
    profile: {} as any,
    onProfileSaved: () => {},
    openAuth: () => {},
    ...patch,
  } as any;
}

test('clicking the Growth Partner link in the desktop nav opens the partner area', async () => {
  const seen: string[] = [];
  const view = await mount(
    React.createElement(Header, headerProps({ setCurrentView: (v: string) => seen.push(v) }))
  );
  try {
    const desktopEntries = [...view.container.querySelectorAll('button')].filter(
      (el) => !el.closest('#global-nav-mobile') && (el.textContent || '').includes('Growth Partner')
    );
    assert.equal(desktopEntries.length, 1, 'exactly one desktop Growth Partner entry');
    await click(desktopEntries[0], 'the desktop Growth Partner link');
    assert.deepEqual(seen, ['growthPartner'], 'the click must route to the Growth Partner view');
  } finally {
    await view.unmount();
  }
});

test('the mobile menu opens and its Growth Partner link routes too (below lg)', async () => {
  const seen: string[] = [];
  const view = await mount(
    React.createElement(Header, headerProps({ setCurrentView: (v: string) => seen.push(v) }))
  );
  try {
    const panel = view.container.querySelector('#global-nav-mobile');
    assert.ok(panel, 'the mobile nav panel must be mounted at every width');
    // Token check, not substring: the panel also carries `lg:hidden`, which is
    // the responsive class and must not be confused with the closed state.
    assert.ok(
      panel!.classList.contains('hidden'),
      'the mobile panel starts closed (hidden), not absent'
    );

    const toggle = view.container.querySelector('button[aria-controls="global-nav-mobile"]');
    assert.ok(toggle, 'the mobile menu toggle must exist');
    assert.equal(toggle!.getAttribute('aria-expanded'), 'false');
    await click(toggle, 'the mobile menu toggle');

    assert.equal(
      toggle!.getAttribute('aria-expanded'),
      'true',
      'the toggle must report the opened state to assistive tech'
    );
    assert.ok(
      !view.container.querySelector('#global-nav-mobile')!.classList.contains('hidden'),
      'opening the menu must remove the hidden class'
    );

    const mobileEntry = byText(view.container.querySelector('#global-nav-mobile')!, 'button', 'Growth Partner');
    await click(mobileEntry ?? null, 'the mobile Growth Partner link');
    assert.deepEqual(seen, ['growthPartner'], 'the mobile entry must route to the partner view');
  } finally {
    await view.unmount();
  }
});

// ---------------------------------------------------------------------------
// Login form + the real login page handler
// ---------------------------------------------------------------------------

/**
 * The form is controlled, so the harness must own the state exactly like the
 * login page does — with no-op change handlers React re-renders the inputs
 * back to empty and the typed text would vanish before submit.
 */
const LoginFormHarness: React.FC<{ onSubmit: (values: { email: string; password: string }) => void }> = ({
  onSubmit,
}) => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  return React.createElement(GrowthPartnerLoginForm, {
    email,
    password,
    fieldErrors: {},
    formError: '',
    busy: false,
    onEmailChange: setEmail,
    onPasswordChange: setPassword,
    onSubmit: (event: React.FormEvent) => {
      event.preventDefault();
      onSubmit({ email, password });
    },
    onSwitchToSignup: () => {},
  });
};

test('the login button submits the typed credentials (form level)', async () => {
  const submitted: Array<{ email: string; password: string }> = [];
  const view = await mount(React.createElement(LoginFormHarness, { onSubmit: (v: any) => submitted.push(v) }));
  try {
    await type(document.getElementById('growth-partner-login-email'), 'asha@example.com', 'email field');
    await type(document.getElementById('growth-partner-login-password'), 'Str0ngPass!1', 'password field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Sign in') ?? null, 'the Sign in button');
    assert.deepEqual(submitted, [{ email: 'asha@example.com', password: 'Str0ngPass!1' }]);
  } finally {
    await view.unmount();
  }
});

function clientWith(overrides: Partial<GrowthPartnerAuthClient['auth']> & { rpc?: any } = {}): GrowthPartnerAuthClient {
  return {
    auth: {
      signUp: overrides.signUp,
      signInWithPassword:
        overrides.signInWithPassword ?? (async () => ({ data: {}, error: null })),
      signOut: overrides.signOut ?? (async () => ({ error: null })),
      getSession: overrides.getSession ?? (async () => ({ data: { session: null }, error: null })),
    },
    rpc: overrides.rpc,
  };
}

test('the login page sends the typed credentials to Supabase Auth when the button is clicked', async () => {
  const calls: Array<{ email: string; password: string }> = [];
  const client = clientWith({
    signInWithPassword: async (args: any) => {
      calls.push({ email: args.email, password: args.password });
      return {
        data: { session: { user: { id: PARTNER_ID, email: args.email }, access_token: 'jwt' } },
        error: null,
      };
    },
  });

  const view = await mount(
    React.createElement(GrowthPartnerLogin, {
      user: null,
      client,
      navigate: () => {},
      onBack: () => {},
    })
  );
  try {
    await type(document.getElementById('growth-partner-login-email'), 'asha@example.com', 'email field');
    await type(document.getElementById('growth-partner-login-password'), 'Str0ngPass!1', 'password field');
    await pressSubmit(byText(document, 'button[type="submit"]', 'Sign in') ?? null, 'the Sign in button');

    assert.deepEqual(calls, [{ email: 'asha@example.com', password: 'Str0ngPass!1' }],
      'the button must call signInWithPassword with exactly what was typed');
  } finally {
    await view.unmount();
  }
});

test('the sign-up switch opens the application form and its button submits the application', async () => {
  const signedUp: any[] = [];
  const applicationCalls: any[] = [];
  const client = clientWith({
    signUp: async (args: any) => {
      signedUp.push(args);
      return {
        data: { user: { id: PARTNER_ID }, session: { user: { id: PARTNER_ID }, access_token: 'jwt' } },
        error: null,
      };
    },
    rpc: async (name: string, args: any) => {
      applicationCalls.push({ name, args });
      return { data: { id: 'app-1', status: 'pending' }, error: null };
    },
  });

  const view = await mount(
    React.createElement(GrowthPartnerLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    const switchLink = byText(document, 'button', 'Apply as a Growth Partner');
    await click(switchLink ?? null, 'the "Apply as a Growth Partner" switch');

    await type(document.getElementById('growth-partner-signup-name'), 'Asha Sharma', 'name field');
    await type(document.getElementById('growth-partner-signup-email'), 'asha@example.com', 'signup email');
    await type(document.getElementById('growth-partner-signup-password'), 'Str0ngPass!1', 'signup password');

    const docType = document.getElementById('growth-partner-kyc-type') as HTMLSelectElement | null;
    assert.ok(docType, 'the KYC document type select must exist');
    const selectSetter = Object.getOwnPropertyDescriptor(
      (globalThis as any).HTMLSelectElement.prototype,
      'value'
    )!.set!;
    await act(() => {
      selectSetter.call(docType, 'pan');
      docType.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
    });
    await type(
      document.getElementById('growth-partner-kyc-reference'),
      'ABCDE1234F',
      'KYC reference'
    );

    await pressSubmit(
      byText(document, 'button[type="submit"]', 'Submit application') ?? null,
      'the submit application button'
    );

    assert.equal(signedUp.length, 1, 'sign-up must be called once');
    assert.equal(signedUp[0].email, 'asha@example.com');
    assert.deepEqual(
      applicationCalls.map((c) => c.name),
      ['submit_growth_partner_application'],
      'the application RPC must be submitted through the same client'
    );
    assert.equal(applicationCalls[0].args.p_full_name, 'Asha Sharma');
    assert.equal(applicationCalls[0].args.p_kyc_document_reference, 'ABCDE1234F');
    assert.ok(
      !('user_id' in applicationCalls[0].args),
      'the application payload must not carry an identity'
    );
  } finally {
    await view.unmount();
  }
});

// ---------------------------------------------------------------------------
// Signed-in states: pending review, admin queue, partner area
// ---------------------------------------------------------------------------

test('the "Application under review" card buttons re-check, go back and switch account', async () => {
  const actions: string[] = [];
  const view = await mount(
    React.createElement(GrowthPartnerLoginPendingReview, {
      submittedAt: '2026-09-12T04:29:32.256Z',
      onBack: () => actions.push('back'),
      onCheckAgain: () => actions.push('check-again'),
      onSwitchAccount: () => actions.push('switch'),
    })
  );
  try {
    await click(byText(document, 'button', 'Check again') ?? null, 'the Check again button');
    await click(byText(document, 'button', 'Back to app') ?? null, 'the Back to app button');
    await click(
      byText(document, 'button', 'Sign in with a different account') ?? null,
      'the switch account button'
    );
    assert.deepEqual(actions, ['check-again', 'back', 'switch']);
  } finally {
    await view.unmount();
  }
});

const QUEUE_ROW = {
  id: 'c0000000-0000-4000-8000-000000000001',
  user_id: 'b0000000-0000-4000-8000-000000000001',
  applicant_name: 'Asha Sharma',
  applicant_email: 'asha@example.com',
  applicant_phone: '9876543210',
  status: 'pending' as const,
  kyc_status: 'submitted',
  kyc_document_type: 'pan',
  kyc_document_reference: 'ABCDE1234F',
  review_note: null,
  created_at: '2026-09-12T04:29:32.256Z',
  reviewed_at: null,
};

test('the admin queue Approve and Reject buttons decide the row they belong to', async () => {
  const decisions: Array<{ id: string; approve: boolean }> = [];
  let refreshed = 0;
  const view = await mount(
    React.createElement(GrowthPartnerAdminReviewPanel, {
      rows: [QUEUE_ROW, { ...QUEUE_ROW, id: 'c0000000-0000-4000-8000-000000000002', applicant_name: 'Ravi Kumar' }],
      busyId: null,
      error: '',
      onRefresh: () => {
        refreshed += 1;
      },
      onDecide: (row: any, approve: boolean) => decisions.push({ id: row.id, approve }),
    })
  );
  try {
    const items = [...view.container.querySelectorAll('li')];
    assert.equal(items.length, 2, 'both waiting applications must be listed');

    await click(byText(items[0], 'button', 'Approve') ?? null, 'Approve on the first row');
    await click(byText(items[1], 'button', 'Reject') ?? null, 'Reject on the second row');
    await click(view.container.querySelector('button[aria-label="Refresh application queue"]'), 'the refresh button');

    assert.deepEqual(decisions, [
      { id: 'c0000000-0000-4000-8000-000000000001', approve: true },
      { id: 'c0000000-0000-4000-8000-000000000002', approve: false },
    ]);
    assert.equal(refreshed, 1);
  } finally {
    await view.unmount();
  }
});

test('the unauthorized card buttons go back and switch account', async () => {
  const actions: string[] = [];
  const view = await mount(
    React.createElement(GrowthPartnerLoginUnauthorized, {
      onBack: () => actions.push('back'),
      onSwitchAccount: () => actions.push('switch'),
    })
  );
  try {
    await click(byText(document, 'button', 'Back to app') ?? null, 'the Back to app button');
    await click(
      byText(document, 'button', 'Sign in with a different account') ?? null,
      'the switch account button'
    );
    assert.deepEqual(actions, ['back', 'switch']);
  } finally {
    await view.unmount();
  }
});

test('a pending application renders the review screen, and "Check again" re-reads the backend', async () => {
  let applicationReads = 0;
  const client: GrowthPartnerAuthClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({
        data: { session: { user: { id: PARTNER_ID, email: 'asha@example.com' }, access_token: 'jwt' } },
        error: null,
      }),
    },
    // Signed in, but no partner row yet and an application waiting on review.
    fetchPartnerRow: async () => null,
    fetchApplicationRow: async () => {
      applicationReads += 1;
      return { status: 'pending', id: 'app-1', kyc_status: 'submitted', created_at: '2026-09-12T04:29:32.256Z' };
    },
  };

  const view = await mount(
    React.createElement(GrowthPartnerLogin, { user: null, client, navigate: () => {}, onBack: () => {} })
  );
  try {
    assert.match(document.body.textContent || '', /Application under review/,
      'a pending applicant must see the review screen, not "Growth Partners only"');
    assert.doesNotMatch(document.body.textContent || '', /Growth Partners only/);
    assert.equal(applicationReads, 1, 'the application must be read once on load');

    await click(byText(document, 'button', 'Check again') ?? null, 'the Check again button');
    assert.equal(applicationReads, 2, 'Check again must re-read the backend');
  } finally {
    await view.unmount();
  }
});

test('an active partner who signs in is forwarded to the partner area', async () => {
  const navigated: string[] = [];
  const client: GrowthPartnerAuthClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({
        data: { session: { user: { id: PARTNER_ID, email: 'asha@example.com' }, access_token: 'jwt' } },
        error: null,
      }),
    },
    fetchPartnerRow: async () => ACTIVE_ROW,
  };

  const view = await mount(
    React.createElement(GrowthPartnerLogin, {
      user: null,
      client,
      navigate: (path: string) => navigated.push(path),
      onBack: () => {},
    })
  );
  try {
    assert.deepEqual(navigated, [GROWTH_PARTNER_PATH],
      'a verified active partner must be sent to the partner area, not shown the form again');
  } finally {
    await view.unmount();
  }
});
