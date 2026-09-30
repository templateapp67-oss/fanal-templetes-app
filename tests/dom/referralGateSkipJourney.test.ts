import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OnboardingApp, REFERRAL_GATE_DISMISSED_KEY } from '../../src/onboarding/OnboardingApp';
import type { OnboardingSupabaseClient } from '../../src/onboarding/lib/auth';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

// ============================================================================
// The OnboardingApp-level skip journey, against a stubbed Supabase client.
//
//   signed in, no linked referral  → the referral gate (with an exit)
//   click "Continue without a referral" → the STATUS screen, URL /onboarding/status
//   fresh mount (a refresh / new visit)  → still the status screen, not the gate
//   click "Link a referral code"        → back to the gate, flag cleared
//
// The referral gate must never strand an account that has no code to enter —
// that trap is exactly the bug this file pins shut.
// ============================================================================

/** Signed-in viewer whose backend onboarding row is unlinked (phase: pending). */
function stubbedPendingClient(): OnboardingSupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'owner-1', email: 'owner@example.com' } } },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name: string) => {
      if (name === 'get_my_onboarding_status') {
        return { data: { linked: false, status: 'started', referral_code: null, growth_partner_id: null }, error: null };
      }
      if (name === 'get_my_growth_referral') {
        return { data: null, error: null };
      }
      if (name === 'get_my_owner_workspace') {
        return { data: { resolved: false }, error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as OnboardingSupabaseClient;
}

function Browser({ client, initialPath }: { client: OnboardingSupabaseClient; initialPath: string }) {
  const [path, setPath] = useState(initialPath);
  return React.createElement(OnboardingApp, {
    path,
    client,
    navigate: (next: string) => {
      dom.window.history.replaceState(null, '', next);
      setPath(next);
    },
  });
}

async function mountAt(client: OnboardingSupabaseClient, path: string): Promise<{
  host: HTMLElement;
  unmount: () => Promise<void>;
}> {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Browser, { client, initialPath: path }));
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

async function wait(check: () => boolean, label: string, host: HTMLElement) {
  for (let i = 0; i < 300 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), `did not reach: ${label}. Screen: ${host.textContent?.slice(0, 600)}`);
}

function skipButton(host: HTMLElement): HTMLButtonElement | undefined {
  return host.querySelector('[data-testid="referral-skip"]') as HTMLButtonElement | undefined;
}
function linkButton(host: HTMLElement): HTMLButtonElement | undefined {
  return host.querySelector('[data-testid="status-link-referral"]') as HTMLButtonElement | undefined;
}

test('skip turns the referral gate into the status screen — immediately, after a refresh, and reversibly', async () => {
  try {
    dom.window.localStorage.removeItem(REFERRAL_GATE_DISMISSED_KEY);
  } catch {}
  const client = stubbedPendingClient();

  // 1. A signed-in, unlinked account opens /onboarding/referral: the gate
  //    renders, now WITH its exit.
  const first = await mountAt(client, '/onboarding/referral');
  try {
    await wait(() => !!(first.host.textContent || '').includes('Enter Referral Code'), 'the referral gate', first.host);
    await wait(() => !!skipButton(first.host), 'the skip affordance', first.host);

    // 2. Click it → the status screen (not a dead end, not an error).
    await act(async () => {
      skipButton(first.host)!.click();
    });
    await wait(
      () => !!(first.host.textContent || '').includes('Your account is ready.'),
      'the pending status screen after skip',
      first.host
    );
    assert.equal(
      dom.window.location.pathname,
      '/onboarding/status',
      'the URL follows onto the status screen'
    );
    assert.equal(
      dom.window.localStorage.getItem(REFERRAL_GATE_DISMISSED_KEY),
      '1',
      'the dismissal is remembered'
    );
  } finally {
    await first.unmount();
  }

  // 3. A fresh mount (what a refresh / a new visit does) must NOT re-trap the
  //    user in the gate: straight to the status screen.
  const second = await mountAt(client, '/onboarding/referral');
  try {
    await wait(
      () => !!(second.host.textContent || '').includes('Your account is ready.'),
      'the status screen directly after re-entry',
      second.host
    );
    assert.ok(
      !(second.host.textContent || '').includes('Enter Referral Code'),
      'the gate stays gone'
    );

    // 4. The way back: "Link a referral code" reopens the form and clears the
    //    flag, so the choice is reversible rather than a one-way door.
    await wait(() => !!linkButton(second.host), 'the link-referral affordance', second.host);
    await act(async () => {
      linkButton(second.host)!.click();
    });
    await wait(
      () => !!(second.host.textContent || '').includes('Enter Referral Code'),
      'the referral form after choosing to link a code',
      second.host
    );
    assert.equal(
      dom.window.localStorage.getItem(REFERRAL_GATE_DISMISSED_KEY),
      null,
      'the dismissal is retired'
    );
  } finally {
    await second.unmount();
    try {
      dom.window.localStorage.removeItem(REFERRAL_GATE_DISMISSED_KEY);
    } catch {}
  }
});

test('without a dismissal the gate still renders first (the referral funnel is unchanged)', async () => {
  try {
    dom.window.localStorage.removeItem(REFERRAL_GATE_DISMISSED_KEY);
  } catch {}
  const client = stubbedPendingClient();
  const mounted = await mountAt(client, '/onboarding/referral');
  try {
    await wait(() => !!(mounted.host.textContent || '').includes('Enter Referral Code'), 'the referral gate', mounted.host);
    assert.equal(dom.window.location.pathname, '/onboarding/referral', 'the URL stays on the gate');
  } finally {
    await mounted.unmount();
    try {
      dom.window.localStorage.removeItem(REFERRAL_GATE_DISMISSED_KEY);
    } catch {}
  }
});
