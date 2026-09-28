import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { websiteDraftKey, websiteSnapshot, writeWebsiteDraft, recoverWebsiteDraft, acknowledgeWebsiteDraft } from '../src/lib/websiteDraft';

const make = () => ({ profile: { ownerId: 'owner-a', ownerName: 'Real Name', subdomain: 'studio', tagline: 'Cloud tagline', city: 'Jaipur', sectionVisibility: { hero: true } }, services: [], stylists: [], loyaltyConfig: {}, selectedTemplateId: 'hair_salon' });

test('draft journal survives refresh-before-debounce, merges local edits only, and isolates tenants/sites', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    const base = make();
    const draft = websiteSnapshot(base);
    draft.profile.tagline = ''; // intentional deletion must survive
    draft.profile.sectionVisibility.hero = false;
    assert.equal(writeWebsiteDraft('owner-a', 'site-a', base, draft), true);
    assert.ok(values.has(websiteDraftKey('owner-a', 'site-a')), 'local write does not wait for a debounce/network');
    const cloud = websiteSnapshot(base);
    cloud.profile.city = 'Delhi'; // changed elsewhere, not a local edit
    cloud.profile.ownerName = 'Updated Account Name';
    const restored = recoverWebsiteDraft('owner-a', 'site-a', cloud);
    assert.equal(restored.profile.tagline, '');
    assert.equal(restored.profile.sectionVisibility.hero, false);
    assert.equal(restored.profile.city, 'Delhi');
    assert.equal(restored.profile.ownerName, 'Updated Account Name');
    assert.deepEqual(recoverWebsiteDraft('owner-b', 'site-a', cloud), cloud);
    assert.deepEqual(recoverWebsiteDraft('owner-a', 'site-b', cloud), cloud);
    // Acknowledging the older snapshot must not discard a keystroke made later.
    const later = websiteSnapshot(draft); later.profile.tagline = 'Newest typing';
    writeWebsiteDraft('owner-a', 'site-a', base, later);
    acknowledgeWebsiteDraft('owner-a', 'site-a', draft);
    assert.equal(recoverWebsiteDraft('owner-a', 'site-a', draft).profile.tagline, 'Newest typing');
    acknowledgeWebsiteDraft('owner-a', 'site-a', later);
    assert.equal(values.has(websiteDraftKey('owner-a', 'site-a')), false);
    // Corrupt cache must never prevent cloud hydration.
    values.set(websiteDraftKey('owner-a', 'site-a'), '{broken');
    assert.deepEqual(recoverWebsiteDraft('owner-a', 'site-a', cloud), cloud);
    assert.equal(writeWebsiteDraft('owner-b', 'site-a', base, later), false);
    // First save resolves a salon ID; a pending newer edit still follows it.
    writeWebsiteDraft('owner-a', 'workspace', base, later);
    assert.equal(recoverWebsiteDraft('owner-a', 'resolved-site', base).profile.tagline, 'Newest typing');
    assert.equal(values.has(websiteDraftKey('owner-a', 'workspace')), false);
    // Quota failure retains the prior cache instead of throwing or stripping assets.
    (globalThis.localStorage as any).setItem = () => { throw new Error('Quota'); };
    assert.equal(writeWebsiteDraft('owner-a', 'site-a', base, later), false);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete (globalThis as any).localStorage;
  }
});

test('App wires draft recovery, synchronous pre-debounce cache and explicit-save acknowledgement', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /recoverWebsiteDraft\(userId, siteId, cloudState\)/);
  assert.match(source, /saved: recovered/);
  assert.match(source, /cacheWebsiteDraft\(\); \/\/ Synchronous local safety net BEFORE the network debounce/);
  assert.match(source, /acknowledgeWebsiteDraft\(draftScope.ownerId, draftScope.siteId, state\)/);
  assert.match(source, /const flushPendingSave = useCallback\(\(\) => \{\s*cacheWebsiteDraft\(\);/);
  assert.match(source, /Cloud saves are paused until it is ready/);
});
