import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withReferralQuery } from '../src/lib/referralQuery';
import { isGrowthReferralCodeFormat } from '../src/lib/growthPartner';
import { SignupScreen } from '../src/onboarding/screens/SignupScreen';
import { LoginScreen } from '../src/onboarding/screens/LoginScreen';

const LIVE_CODE = 'REF-5A45019655';

test('approved REF link code is accepted and preserved on canonical onboarding routes', () => {
  assert.equal(isGrowthReferralCodeFormat(LIVE_CODE), true);
  assert.equal(withReferralQuery('/onboarding/signup', LIVE_CODE), '/onboarding/signup?ref=REF-5A45019655');
  assert.equal(withReferralQuery('/onboarding/login', LIVE_CODE), '/onboarding/login?ref=REF-5A45019655');
  assert.equal(withReferralQuery('/onboarding/signup?old=1', LIVE_CODE), '/onboarding/signup?ref=REF-5A45019655');
  assert.equal(withReferralQuery('/onboarding/signup', ''), '/onboarding/signup');
});

test('signup visibly confirms which Growth Partner referral will be applied', () => {
  const html = renderToStaticMarkup(React.createElement(SignupScreen, { referralCode: LIVE_CODE }));
  assert.match(html, /data-onboarding-referral-applied/);
  assert.match(html, /Growth Partner referral applied/);
  assert.match(html, /REF-5A45019655/);
  assert.match(html, /securely link/);
  assert.match(html, /overwrite नहीं कर सकता/);
});

test('login keeps referral context but promises no existing-account reassignment', () => {
  const html = renderToStaticMarkup(React.createElement(LoginScreen, { referralCode: LIVE_CODE }));
  assert.match(html, /Growth Partner referral applied/);
  assert.match(html, /REF-5A45019655/);
  assert.match(html, /Existing account/);
  assert.match(html, /बदला नहीं जाएगा/);
});
