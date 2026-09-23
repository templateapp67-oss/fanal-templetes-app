// ============================================================================
// Growth Partner failure screens — the dead end, removed.
//
// The reported bug: `/partner/dashboard` showed
//
//     Could not load the Growth Partner area
//     Could not load this section. Please try again.
//
// for every possible cause. These tests drive the REAL components in jsdom and
// assert what a user now sees for the two causes a retry cannot fix (a missing
// migration, a refused grant), for an expired session, and for the one case
// where "try again" genuinely IS the answer — plus they drive the live
// diagnostic button end to end and check the report it produces.
// ============================================================================

import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GrowthPartnerLoadError } from '../../src/components/PartnerStatusScreen';
import { SectionError } from '../../src/components/GrowthPartnerSections';
import { PARTNER_SECTION_ERROR_MESSAGE } from '../../src/lib/growthPartner';

after(() => dom.window.close());

const settle = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.ok(check(), 'the screen settled');
};

/** Mount a component, hand back the host element and an unmount helper. */
async function mount(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    text: () => host.textContent ?? '',
    button: (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** PostgREST's answer when the migration that creates the gate's RPCs is absent. */
const missingMigration = () =>
  Object.assign(new Error('Could not find the function public.ensure_my_growth_partner() in the schema cache'), {
    code: 'PGRST202',
    status: 404,
  });

test('a missing migration is named on the screen instead of "Please try again"', async () => {
  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      error: missingMigration(),
      route: '/partner/dashboard',
      onAction: () => {},
    })
  );
  try {
    const text = screen.text();
    assert.match(text, /The Growth Partner database setup is missing on this project/);
    assert.match(text, /An administrator has to act/);
    assert.match(text, /20260922091000_direct_growth_partner_dashboard_access\.sql/);
    assert.match(text, /GROWTH_PARTNER_SETUP\.md/);
    assert.match(text, /not a browser, cache or cookie problem|cannot fix it/i);
    assert.ok(screen.button('Run diagnostic'), 'the diagnostic affordance is offered');
    // The exact dead-end sentence from the bug report must be gone.
    assert.doesNotMatch(text, /Could not load this section\. Please try again\./);
  } finally {
    await screen.unmount();
  }
});

test('the real gate path (title + generic body + error) never prints the contradiction', async () => {
  // Exactly what PartnerRouteGuard hands the screen in production: an explicit
  // title/body pair for the states it can describe, plus the raw error.
  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      title: 'Could not load the Growth Partner area',
      body: PARTNER_SECTION_ERROR_MESSAGE,
      actionLabel: 'Retry',
      onAction: () => {},
      error: missingMigration(),
      route: '/partner/dashboard',
    })
  );
  try {
    const text = screen.text();
    assert.match(text, /The Growth Partner database setup is missing on this project/);
    // The classified explanation must replace the generic one, not join it.
    assert.doesNotMatch(text, /Please try again/);
  } finally {
    await screen.unmount();
  }
});

test('a refused grant is reported as an account/permission problem with the report path', async () => {
  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      error: Object.assign(new Error('permission denied for function get_my_growth_partner'), { code: '42501' }),
      onAction: () => {},
    })
  );
  try {
    const text = screen.text();
    assert.match(text, /You are signed in, but the database refused this read/);
    assert.match(text, /account\/permission issue, not a browser, cache or cookie problem/);
    assert.match(text, /An administrator has to act/);
    assert.doesNotMatch(text, /Please try again\./);
  } finally {
    await screen.unmount();
  }
});

test('an expired session offers a sign-in, not a retry loop', async () => {
  let signedIn = 0;
  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      error: { status: 401, message: 'JWT expired' },
      onAction: () => {},
      onSignIn: () => { signedIn += 1; },
    })
  );
  try {
    assert.match(screen.text(), /Your session expired/);
    const signIn = screen.button('Sign in again');
    assert.ok(signIn, 'the sign-in action is offered');
    await act(async () => signIn!.click());
    assert.equal(signedIn, 1);
  } finally {
    await screen.unmount();
  }
});

test('an unnameable failure stays honest and still offers a retry', async () => {
  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      error: new Error('duplicate key value violates unique constraint "growth_partners_referral_code_key"'),
      onAction: () => {},
    })
  );
  try {
    const text = screen.text();
    // The screen no longer invents a cause, and no longer claims a retry is
    // certain to work either — but the button is still there.
    assert.match(text, /Could not load the Growth Partner area/);
    assert.match(text, /Cause not identified/);
    assert.doesNotMatch(text, /growth_partners_referral_code_key/);
    assert.ok(screen.button('Retry'), 'retry is still reachable');
  } finally {
    await screen.unmount();
  }
});

test('a section failure the app cannot name keeps its pinned copy', async () => {
  const screen = await mount(
    React.createElement(SectionError, { message: PARTNER_SECTION_ERROR_MESSAGE, onRetry: () => {} })
  );
  try {
    const text = screen.text();
    assert.match(text, /Something went wrong/);
    assert.match(text, new RegExp(PARTNER_SECTION_ERROR_MESSAGE.replace(/\./g, '\\.')));
    assert.ok(screen.button('Retry'), 'the section retry button survived');
  } finally {
    await screen.unmount();
  }
});

test('a section failure the app CAN name says what it is', async () => {
  const screen = await mount(
    React.createElement(SectionError, {
      message: 'Could not load this section. Please try again.',
      error: missingMigration(),
      route: '/partner/dashboard',
      onRetry: () => {},
    })
  );
  try {
    const text = screen.text();
    assert.match(text, /The Growth Partner database setup is missing on this project/);
    assert.match(text, /An administrator has to act/);
    assert.ok(screen.button('Run diagnostic'), 'sections can be diagnosed too');
  } finally {
    await screen.unmount();
  }
});

test('the diagnostic button probes the live service and prints a copyable report', async () => {
  const originalFetch = globalThis.fetch;
  // The exact shape a project without the dashboard migrations answers with.
  globalThis.fetch = (async () =>
    Response.json(
      {
        code: 'PGRST202',
        message: 'Could not find the function public.get_my_growth_partner() in the schema cache',
        details: null,
        hint: null,
      },
      { status: 404 }
    )) as typeof fetch;

  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      error: missingMigration(),
      route: '/partner/dashboard',
      onAction: () => {},
    })
  );
  try {
    const run = screen.button('Run diagnostic');
    assert.ok(run, 'the diagnostic button is present');
    await act(async () => run!.click());
    await settle(() => screen.text().includes('Live checks'));

    const text = screen.text();
    assert.match(text, /Live checks/);
    assert.match(text, /Browser reports a connection/);
    assert.match(text, /Supabase project configured/);
    assert.match(text, /Gate read \(get_my_growth_partner\)/);
    assert.match(text, /Self-enrollment call \(ensure_my_growth_partner\)/);
    assert.match(text, /not probed — it can create your partner record/);
    assert.match(text, /Would refreshing \/ clearing cache help\?/);
    assert.match(text, /no — a retry, a hard refresh and clearing cache\/cookies cannot change this cause/);

    // The report itself is on screen (selectable) and names the project + cause.
    assert.match(text, /Growth Partner access failure report/);
    assert.match(text, /Database setup missing \(schema-missing · setup\)/);
    assert.match(text, /PGRST202/);
    assert.ok(screen.button('Copy report for support'), 'the copy affordance is present');
  } finally {
    await screen.unmount();
    globalThis.fetch = originalFetch;
  }
});

test('copying the report shares the cause — never a key, token or address', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ code: 'PGRST202', message: 'no function' }, { status: 404 })) as typeof fetch;
  let copied = '';
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async (value: string) => { copied = value; } },
    configurable: true,
  });

  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, {
      error: missingMigration(),
      route: '/partner/dashboard',
      onAction: () => {},
    })
  );
  try {
    await act(async () => screen.button('Run diagnostic')!.click());
    await settle(() => screen.text().includes('Live checks'));
    await act(async () => screen.button('Copy report for support')!.click());
    assert.match(copied, /Growth Partner access failure report/);
    assert.match(copied, /Route: {4}\/partner\/dashboard/);
    assert.match(copied, /no passwords, tokens or API keys/);
    assert.doesNotMatch(copied, /eyJ[A-Za-z0-9_-]{10,}/);
    assert.doesNotMatch(copied, /dom-test-anon-key/);
  } finally {
    await screen.unmount();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true });
  }
});

test('without a clipboard the screen says so instead of pretending the copy worked', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ code: 'PGRST202', message: 'no function' }, { status: 404 })) as typeof fetch;
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true });

  const screen = await mount(
    React.createElement(GrowthPartnerLoadError, { error: missingMigration(), onAction: () => {} })
  );
  try {
    await act(async () => screen.button('Run diagnostic')!.click());
    await settle(() => screen.text().includes('Live checks'));
    await act(async () => screen.button('Copy report for support')!.click());
    await settle(() => screen.text().includes('Copying is blocked'));
    assert.match(screen.text(), /select the report below and copy it manually/);
  } finally {
    await screen.unmount();
    globalThis.fetch = originalFetch;
  }
});
