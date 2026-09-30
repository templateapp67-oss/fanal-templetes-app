import './jsdomSetup';
import { dom } from './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  REFERRAL_SKIP_LABEL,
  ReferralScreen,
} from '../../src/onboarding/screens/ReferralScreen';
import {
  STATUS_LINK_REFERRAL_LABEL,
  STATUS_PENDING_BODY,
  STATUS_PENDING_NO_CODE,
  STATUS_PENDING_TITLE,
  STATUS_VERIFIED_BODY,
  STATUS_VERIFIED_TITLE,
  StatusScreen,
} from '../../src/onboarding/screens/StatusScreen';
import type { OnboardingSupabaseClient } from '../../src/onboarding/lib/auth';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

// ============================================================================
// The referral gate is a funnel step, not a trap.
//
// An account created organically (no Growth Partner code), a returning owner
// or a staff account has NO code to enter. Before this file existed the
// referral screen offered exactly two exits — link a code or sign out — so
// any of those accounts was stranded on "Enter Referral Code" forever. These
// tests pin the escape hatch and its reversible half:
//
//   • the referral screen renders "Continue without a referral" and the
//     click reaches the host (OnboardingApp) via onSkip;
//   • without an onSkip handler nothing changes for existing callers;
//   • the status screen's pending state reads as a normal state (no
//     "verified" copy for an unlinked account) and offers "Link a referral
//     code" back into the funnel;
//   • verified/completed status screens never show the pending affordances.
// ============================================================================

async function mount(element: React.ReactElement): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(element);
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

function button(host: HTMLElement, testId: string): HTMLButtonElement | undefined {
  return host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | undefined;
}

test('the referral screen offers "Continue without a referral" and the click reaches the host', async () => {
  let skipped = 0;
  const client = { auth: {}, rpc: async () => ({ data: null, error: null }) } as unknown as OnboardingSupabaseClient;
  const { host, unmount } = await mount(
    React.createElement(ReferralScreen, {
      client,
      email: 'owner@example.com',
      onSkip: () => {
        skipped += 1;
      },
    })
  );
  try {
    assert.match(host.textContent || '', /Enter Referral Code/);
    const skip = button(host, 'referral-skip');
    assert.ok(skip, 'the escape hatch button renders');
    assert.equal(skip!.textContent?.trim(), REFERRAL_SKIP_LABEL);
    await act(async () => {
      skip!.click();
    });
    assert.equal(skipped, 1, 'onSkip fired exactly once');
  } finally {
    await unmount();
  }
});

test('the referral screen renders no escape hatch when the host provides none (backwards compatible)', async () => {
  const client = { auth: {}, rpc: async () => ({ data: null, error: null }) } as unknown as OnboardingSupabaseClient;
  const { host, unmount } = await mount(
    React.createElement(ReferralScreen, { client, email: 'owner@example.com' })
  );
  try {
    assert.ok(!button(host, 'referral-skip'), 'no skip button without an onSkip handler');
    assert.ok((host.textContent || '').includes('Continue'), 'the primary action is untouched');
  } finally {
    await unmount();
  }
});

test('a pending status screen reads as a normal state and can reopen the referral form', async () => {
  let linkRequested = 0;
  const { host, unmount } = await mount(
    React.createElement(StatusScreen, {
      phase: 'pending',
      referralCode: null,
      partnerName: null,
      email: 'owner@example.com',
      onLinkReferral: () => {
        linkRequested += 1;
      },
    })
  );
  try {
    const text = host.textContent || '';
    assert.match(text, new RegExp(STATUS_PENDING_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, new RegExp(STATUS_PENDING_BODY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(text.includes(STATUS_PENDING_NO_CODE), 'honest pending state, not a fake "linked" claim');
    assert.ok(!text.includes(STATUS_VERIFIED_TITLE), 'pending never shows the verified copy');
    assert.ok(text.includes('Pending'), 'the activation badge says Pending');
    const link = button(host, 'status-link-referral');
    assert.ok(link, 'the "Link a referral code" way back renders');
    assert.equal(link!.textContent?.trim(), STATUS_LINK_REFERRAL_LABEL);
    await act(async () => {
      link!.click();
    });
    assert.equal(linkRequested, 1, 'onLinkReferral fired exactly once');
  } finally {
    await unmount();
  }
});

test('verified and completed status screens keep their copy and never show pending affordances', async () => {
  const verified = await mount(
    React.createElement(StatusScreen, {
      phase: 'referral_added',
      referralCode: 'ALPHA01',
      partnerName: 'Partner Anita',
      email: 'owner@example.com',
      onLinkReferral: () => {},
    })
  );
  try {
    const text = verified.host.textContent || '';
    assert.match(text, new RegExp(STATUS_VERIFIED_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(text.includes('ALPHA01'));
    assert.ok(!text.includes(STATUS_PENDING_NO_CODE), 'no pending copy on a verified screen');
    assert.ok(!button(verified.host, 'status-link-referral'), 'no link-referral button once linked');
  } finally {
    await verified.unmount();
  }

  const completed = await mount(
    React.createElement(StatusScreen, {
      phase: 'completed',
      completed: true,
      referralCode: 'ALPHA01',
      onLinkReferral: () => {},
    })
  );
  try {
    const text = completed.host.textContent || '';
    assert.ok(text.includes('complete'), 'the completed title renders');
    assert.ok(!text.includes(STATUS_PENDING_NO_CODE), 'no pending copy on a completed screen');
    assert.ok(!button(completed.host, 'status-link-referral'), 'no link-referral button when completed');
  } finally {
    await completed.unmount();
  }
});
