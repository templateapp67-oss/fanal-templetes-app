import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteContentError, hasRequiredWebsiteProfile, isSafeImageUrl, isValidContactPhone } from '../src/lib/websiteValidation';
import { scopedWebsiteSnapshot, applyPublicWebsiteContent } from '../server/websiteContent';
import { TEMPLATE_REGISTRY } from '../src/data/templates';

test('every template starter kit satisfies the same validation used by both save paths', () => {
  for (const t of TEMPLATE_REGISTRY) {
    // Node's asset loader returns file: URLs; Vite emits same-origin /assets paths.
    const browserData = JSON.parse(JSON.stringify(t.defaultData, (_, value) => typeof value === 'string' && value.startsWith('file:') ? '/assets/' + value.split('/').pop() : value));
    assert.equal(websiteContentError({ services: browserData.services, profile: { socialVideos: browserData.videos, gallery: browserData.gallery, testimonials: browserData.testimonials } }), null, t.id);
  }
});
test('content validation rejects invalid prices, durations, duplicate IDs, unsafe images and non-YouTube videos', () => {
  const t = TEMPLATE_REGISTRY[0];
  const state = { profile: { socialVideos: t.defaultData.videos }, services: t.defaultData.services };
  for (const price of [-1, NaN, Infinity, '10', null]) assert.ok(websiteContentError({ ...state, services: [{ ...state.services[0], price }] }));
  for (const durationMinutes of [0, -1, 1.5, null, '30']) assert.ok(websiteContentError({ ...state, services: [{ ...state.services[0], durationMinutes }] }));
  assert.equal(websiteContentError({ ...state, services: [{ ...state.services[0], price: 0, imageUrl: '' }] }), null);
  assert.ok(websiteContentError({ ...state, services: [state.services[0], state.services[0]] }));
  for (const youtubeUrl of ['https://example.com/file.mp4', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'javascript:alert(1)']) assert.ok(websiteContentError({ ...state, profile: { socialVideos: [{ ...t.defaultData.videos[0], youtubeUrl }] } }));
  assert.ok(websiteContentError({ ...state, profile: { gallery: null } }));
  assert.ok(websiteContentError({ ...state, profile: { testimonials: [{ id: 'r1', name: 'Guest', comment: 'Great', rating: 2.5 }] } }));
});
test('phone and image validation does not confuse placeholder strings with valid content', () => {
  for (const phone of ['phone-number', '12345', '1234567890123456']) assert.equal(isValidContactPhone(phone), false);
  assert.equal(isValidContactPhone('+91 (98765) 43210'), true);
  const p: any = { businessName: 'Studio', businessType: 'hair_salon', address: 'Studio Road', city: 'Jaipur', phone: '9876543210' };
  assert.equal(hasRequiredWebsiteProfile(p), true);
  assert.equal(hasRequiredWebsiteProfile({ ...p, address: '' }), false);
  for (const url of ['javascript:alert(1)', 'data:text/html,a', 'data:image/svg+xml,a', '//evil.test/image', '/\\evil.test/image', 'https://user:pass@example.com/i.jpg']) assert.equal(isSafeImageUrl(url), false, url);
  for (const url of ['', '/image.png', 'https://example.com/image.jpg', 'data:image/jpeg;base64,YQ==']) assert.equal(isSafeImageUrl(url), true, url);
});
test('legacy metadata needs a matching salon identity and never overrides operational booking values', () => {
  const s = { profile: { subdomain: 'mine', ownerBio: 'Founder' } };
  assert.equal(scopedWebsiteSnapshot(s, 'id', 'mine'), s);
  assert.equal(scopedWebsiteSnapshot(s, 'id', 'other'), null);
  assert.equal(scopedWebsiteSnapshot({ ...s, salonId: 'other-id' }, 'id', 'mine'), null);
  assert.equal(scopedWebsiteSnapshot({ profile: {} }, 'id', 'mine'), null);
  const profile: any = { phone: '9876543210', acceptsOnlineBookings: false, requireDeposit: true };
  const publicContent = applyPublicWebsiteContent(profile, { phone: 'wrong', acceptsOnlineBookings: true, requireDeposit: false, ownerId: 'private', dob: 'private', coverImageUrl: 'javascript:alert(1)', themeAccentKey: 'rose', shopFlatNo: '42' });
  assert.equal(publicContent.phone, profile.phone); assert.equal(publicContent.acceptsOnlineBookings, false); assert.equal(publicContent.requireDeposit, true);
  assert.equal(publicContent.themeAccentKey, 'rose'); assert.equal(publicContent.shopFlatNo, '42');
  assert.equal(publicContent.coverImageUrl, undefined); assert.equal(publicContent.ownerId, undefined); assert.equal(publicContent.dob, undefined);
});
