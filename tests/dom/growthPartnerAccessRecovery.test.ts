// ============================================================================
// Growth Partner access recovery — the REAL login page, in jsdom.
//
// The reported production symptom:
//
//   visiting /partner/dashboard (or logging in) renders
//   "Could not verify your Growth Partner access. Please try again."
//
// That card is the login screen's `error` state and it fired for ANY throw in
// the verification effect — including the automatic self-enrollment step. So an
// account whose enrollment RPC is missing (migration not applied) got a "try
// again" screen that could never succeed, and an account that simply is not a
// partner yet saw the same generic card instead of an honest denial.
//
// These tests mount the real PartnerPortalLogin with an injected client (the
// convention the rest of this suite uses for signed-in scenarios) and assert
// what the visitor actually sees:
//
//   1. the gate read itself is missing (PGRST202) → the setup message naming
//      the migration, and no "Please try again.";
//   2. the gate read succeeds but enrollment is missing → the denial card plus
//      the reason — never the verification-error card;
//   3. enrollment succeeds → the page proceeds (no denial, no error);
//   4. a genuinely broken read still gets the retryable error card.
// ============================================================================

import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PartnerPortalLogin } from '../../src/components/PartnerPortalLogin';
import type { PartnerPortalAuthClient } from '../../src/lib/partnerPortalAuth';
import type { GrowthPartner } from '../../src/lib/growthPartner';

after(() => dom.window.close());

const USER = { id: 'b0000000-0000-4000-8000-0000000000aa', email: 'partner@example.com' };

const PARTNER_ROW: GrowthPartner = {
  user_id: 'a0000000-0000-4000-8000-000000000001',
  referral_code: 'NEXORA-SELF01',
  is_active: true,
  created_at: '2026-09-22T00:00:00Z',
  updated_at: '2026-09-22T00:00:00Z',
};

/** The exact error PostgREST returns for a function that is not in the cache. */
function pgrst202(): Error {
  const error = new Error(
    'Could not find the function public.ensure_my_growth_partner() in the schema cache'
  ) as Error & { code?: string; status?: number };
  error.code = 'PGRST202';
  error.status = 404;
  return error;
}

type Handlers = {
  session?: any;
  getSession?: PartnerPortalAuthClient['auth']['getSession'];
  fetchPartnerRow?: () => Promise<GrowthPartner | null>;
  fetchApplicationRow?: () => Promise<{ status?: string | null } | null>;
  ensurePartnerRow?: () => Promise<unknown>;
};

function portalClient(handlers: Handlers = {}): PartnerPortalAuthClient {
  return {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession:
        handlers.getSession ??
        (async () => ({
          data: {
            session: handlers.session === undefined ? { user: USER } : handlers.session,
          },
          error: null,
        })),
    },
    ...(handlers.fetchPartnerRow ? { fetchPartnerRow: handlers.fetchPartnerRow } : {}),
    ...(handlers.fetchApplicationRow ? { fetchApplicationRow: handlers.fetchApplicationRow } : {}),
    ...(handlers.ensurePartnerRow ? { ensurePartnerRow: handlers.ensurePartnerRow } : {}),
  } as PartnerPortalAuthClient;
}

async function mountLogin(client: PartnerPortalAuthClient) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(PartnerPortalLogin, {
        user: USER,
        client,
        navigate() {},
        onBack() {},
        onLogout() {},
      } as any)
    );
  });
  const wait = async (check: () => boolean) => {
    for (let i = 0; i < 120 && !check(); i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    assert.ok(check(), 'the page settled');
  };
  return {
    host,
    wait,
    text: () => host.textContent || '',
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('a missing gate RPC reports the missing database setup instead of a retryable failure', async () => {
  const page = await mountLogin(
    portalClient({
      fetchPartnerRow: async () => {
        throw pgrst202();
      },
    })
  );
  try {
    await page.wait(() => /database setup is missing/i.test(page.text()));
    const text = page.text();
    assert.doesNotMatch(text, /Something went wrong/, 'never the root error boundary');
    assert.match(text, /Could not verify your Growth Partner access/);
    assert.match(text, /migration/i, 'the operator-facing fix is named');
    // The old dead end is gone: the visitor cannot fix a missing migration by
    // retrying, so the copy must not ask them to.
    assert.doesNotMatch(text, /Please try again\./);
  } finally {
    await page.unmount();
  }
});

test('a missing enrollment step keeps the honest denial and explains itself (the reported bug)', async () => {
  let enrollmentAttempts = 0;
  const page = await mountLogin(
    portalClient({
      // The verification read answers truthfully: this account has no partner row.
      fetchPartnerRow: async () => null,
      fetchApplicationRow: async () => null,
      // ...and the automatic self-enrollment cannot run: the migration is absent.
      ensurePartnerRow: async () => {
        enrollmentAttempts += 1;
        throw pgrst202();
      },
    })
  );
  try {
    await page.wait(() => /Growth Partners only/.test(page.text()));
    const text = page.text();
    assert.doesNotMatch(text, /Something went wrong/);
    // Verification succeeded, so this must NOT be the error card.
    assert.doesNotMatch(text, /Could not verify your Growth Partner access/);
    assert.doesNotMatch(text, /Please try again\./);
    // The visitor sees the denial, the real reason, and the way forward.
    assert.match(text, /You do not have access to the Growth Partner portal\./);
    assert.match(text, /database setup is missing/i);
    assert.match(text, /Become a Growth Partner/, 'self-service signup stays available');
    assert.equal(enrollmentAttempts, 1, 'the enrollment attempt really happened, exactly once');
  } finally {
    await page.unmount();
  }
});

test('a successful enrollment carries the page past the denial', async () => {
  let row: GrowthPartner | null = null;
  const page = await mountLogin(
    portalClient({
      fetchPartnerRow: async () => row,
      fetchApplicationRow: async () => null,
      ensurePartnerRow: async () => {
        row = PARTNER_ROW;
        return PARTNER_ROW;
      },
    })
  );
  try {
    // NB: the label ends in a real ellipsis character (…), not three dots.
    await page.wait(() => /Checking your Growth Partner access/.test(page.text()));
    const text = page.text();
    assert.doesNotMatch(text, /Growth Partners only/);
    assert.doesNotMatch(text, /Could not verify your Growth Partner access/);
    assert.doesNotMatch(text, /Something went wrong/);
    assert.match(text, /Checking your Growth Partner access…/, 'the page is proceeding');
  } finally {
    await page.unmount();
  }
});

test('a broken read still offers the retryable error card', async () => {
  const page = await mountLogin(
    portalClient({
      fetchPartnerRow: async () => {
        throw new Error('Failed to fetch');
      },
    })
  );
  try {
    await page.wait(() => /Could not verify your Growth Partner access/.test(page.text()));
    const text = page.text();
    assert.match(text, /Please try again\./, 'a transient failure stays retryable');
    assert.doesNotMatch(text, /database setup is missing/i);
    assert.doesNotMatch(text, /Something went wrong/);
  } finally {
    await page.unmount();
  }
});
