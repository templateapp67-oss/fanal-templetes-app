import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requiresOwnerEditorSetup,
  shouldRedirectEditorToWebsiteOnboarding,
} from '../src/lib/ownerRouteGuard';

test('Home and SaaS Dashboard never redirect to Explore Templates without a salon', () => {
  for (const path of ['/', '/dashboard']) {
    assert.equal(requiresOwnerEditorSetup(path), false);
    assert.equal(shouldRedirectEditorToWebsiteOnboarding(path, 0), false);
  }
});

test('onboarding remains an explicit destination and does not redirect itself', () => {
  assert.equal(requiresOwnerEditorSetup('/onboarding/website'), false);
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/onboarding/website', 0), false);
});

test('only a direct editor request without an owned salon enters website onboarding', () => {
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/editor', 0), true);
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/editor?site=site-1', 0), true);
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/editor?site=site-1', 1), false);
});
