import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveOnboardingRoute } from '../src/onboarding/lib/flow';

test('a linked owner reaches the status-to-handoff gateway, not the shop wizard', () => {
  for (const phase of ['referral_added', 'template_started'] as const) {
    assert.equal(
      resolveOnboardingRoute({ hasSession: true, phase, requested: 'referral' }),
      'status'
    );
  }
});

test('the referral journey neither imports the shop wizard nor sends owners to Customer App', () => {
  const onboardingApp = readFileSync(new URL('../src/onboarding/OnboardingApp.tsx', import.meta.url), 'utf8');
  const shopWizard = readFileSync(new URL('../src/onboarding/ShopOwnerOnboardingWizard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(onboardingApp, /ShopOwnerOnboardingWizard/);
  assert.doesNotMatch(shopWizard, /location\.assign\('\/app'\)/);
  assert.match(shopWizard, /location\.assign\('\/'\)/);
});
