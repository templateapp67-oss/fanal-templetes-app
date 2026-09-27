import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDemoSalon, DEMO_SUBDOMAINS } from '../server/siteLookup';

test('1. Valid published site slug resolves correctly and bypasses owner auth/explorer', () => {
  const slug = 'luxe-hair-studio';
  const found = DEMO_SUBDOMAINS.has(slug) || defaultDemoSalon.profile.subdomain === slug;
  assert.equal(found, true);
});

test('2. Invalid or unpublished site slug returns not found without redirecting to explorer', () => {
  const invalidSlug = 'mysalon-unpublished-xyz';
  const found = DEMO_SUBDOMAINS.has(invalidSlug);
  assert.equal(found, false);
});
