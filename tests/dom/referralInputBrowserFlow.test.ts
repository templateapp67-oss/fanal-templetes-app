import './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readSharedReferralCode } from '../../src/onboarding/OnboardingApp';
import { ReferralScreen } from '../../src/onboarding/screens/ReferralScreen';

after(() => {
  /* jsdomSetup owns the window lifetime */
});

// ============================================================================
// PHASE 4.1 — REFERRAL INPUT, in a real browser environment.
//
// The onboarding referral screen is the ONE place a code is entered; every
// arrival route lands in it rather than in a second, parallel UI:
//
//   manual input        -> the same #onboarding-referral-code field
//   ?ref=CODE           -> pre-fills that field (what a partner's share link emits)
//   ?referral=CODE      -> pre-fills that field (the spelling people type)
//   a Growth Partner link -> /signup?ref=CODE, i.e. the ?ref= route
//   server-side attribution -> a cookie + token, never a query parameter
//
// The backend re-validates whatever arrives here; these assertions are about
// which arrivals are recognised at all.
// ============================================================================

const CODE = 'NEXORA-ABC123';

async function prefillFor(query: string): Promise<{ read: string; fieldValue: string | null }> {
  const initialUrl = window.location.href;
  window.history.replaceState(null, '', `/onboarding/referral${query}`);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  try {
    const read = readSharedReferralCode();
    await act(async () => {
      root.render(React.createElement(ReferralScreen, { email: 'owner@example.com', initialCode: read }));
    });
    const input = document.getElementById('onboarding-referral-code') as HTMLInputElement | null;
    return { read, fieldValue: input ? input.value : null };
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, '', initialUrl);
  }
}

test('4.1 — every recognised arrival route pre-fills the single referral input', async () => {
  const viaRef = await prefillFor(`?ref=${CODE}`);
  assert.equal(viaRef.read, CODE, '?ref= is captured (what partnerReferralShareLink emits)');
  assert.equal(viaRef.fieldValue, CODE, 'and pre-fills the one referral field');

  const viaReferral = await prefillFor(`?referral=${CODE}`);
  assert.equal(viaReferral.read, CODE, '?referral= is captured as an alias');
  assert.equal(viaReferral.fieldValue, CODE, 'and pre-fills the SAME field — no second UI');

  const typed = await prefillFor('');
  assert.equal(typed.read, '', 'a direct visit carries no code');
  assert.equal(typed.fieldValue, '', 'and the field is empty, ready for manual input');
  assert.ok(document.getElementById('onboarding-referral-code') === null, 'the input is torn down with the screen');
});

test('4.2 — the pre-filled value is the canonical form the database will store', async () => {
  // A partner's link may carry a padded or lowercase code (copy/paste). What the
  // owner sees in the field must equal what link_my_growth_referral will store,
  // not the raw bytes from the URL.
  for (const [query, expected] of [
    [`?ref=${CODE.toLowerCase()}`, CODE],
    [`?ref=%20%20${CODE}%20%20`, CODE],
    [`?referral=${CODE.toLowerCase()}`, CODE],
  ] as [string, string][]) {
    const result = await prefillFor(query);
    assert.equal(result.read, expected, `${query} pre-fills canonically`);
    assert.equal(result.fieldValue, expected);
  }
});

test('4.2 — a code the database cannot link is not pre-filled at all', async () => {
  // Falling back to manual entry beats pre-filling a value that is guaranteed
  // to fail on submit. Each of these fails the database's own format check.
  for (const bad of [
    'ABC', // too short
    'ABCDEFGHIJKLM', // 13 — one over the maximum
    'ALPHA-01', // the legacy form allows no dash
    'ALPHA%2001', // no spaces
    '<script>alert(1)</script>', // markup, not a code
    'A'.repeat(200), // far over the length cap
  ]) {
    const result = await prefillFor(`?ref=${bad}`);
    assert.equal(result.read, '', `${bad} is not pre-filled`);
    assert.equal(result.fieldValue, '', 'and the field is left for manual entry');
  }
});

test('4.1 — the reader is a pure read: repeated calls do not consume the code', async () => {
  const initialUrl = window.location.href;
  window.history.replaceState(null, '', `/onboarding/referral?ref=${CODE}`);
  try {
    assert.equal(readSharedReferralCode(), CODE);
    assert.equal(readSharedReferralCode(), CODE, 'a second read returns the same code');
    assert.equal(readSharedReferralCode(), CODE, 'and a third — the router may re-render');
  } finally {
    window.history.replaceState(null, '', initialUrl);
  }
});

test('4.1 — a code the app does not understand is never substituted for another', async () => {
  const initialUrl = window.location.href;
  window.history.replaceState(null, '', '/onboarding/referral?ref=ABCDEFGHIJKLM&referral=GOOD01');
  try {
    // ?ref= is present but unusable. Falling through to ?referral= would
    // attribute this owner to a DIFFERENT partner than the link they clicked,
    // so the answer is "nothing pre-filled", not "some other code".
    assert.equal(readSharedReferralCode(), '');
  } finally {
    window.history.replaceState(null, '', initialUrl);
  }
});
