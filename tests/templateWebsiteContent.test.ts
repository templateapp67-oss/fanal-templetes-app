import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TEMPLATE_REGISTRY } from '../src/data/templates';
import { getDefaultVideosForTemplate } from '../src/templateSocialVideos';
import { WebsiteVideoShowcase } from '../src/components/WebsiteVideoShowcase';
import { WebsiteLocationMap, websiteLocation } from '../src/components/WebsiteLocationMap';
import { applyPublicWebsiteContent, mergeServicePresentation } from '../server/websiteContent';
import { catalogId } from '../server/normalizedBookingCreate';
import type { SalonProfile } from '../src/types';

for (const template of TEMPLATE_REGISTRY) {
  test(`${template.id}: complete five-service catalogue, owner and both video sections`, () => {
    assert.ok(template.defaultData.services.length >= 5);
    for (const service of template.defaultData.services) {
      assert.ok(service.name && service.description && service.imageUrl && service.category);
      assert.ok(service.durationMinutes > 0 && service.price >= 0);
    }
    assert.ok(template.config.ownerName && template.config.ownerPhotoUrl && template.config.ownerRole);
    const videos = getDefaultVideosForTemplate(template.id);
    assert.ok(videos.some(v => v.categoryTag === 'SHORT'));
    assert.ok(videos.some(v => v.categoryTag !== 'SHORT'));
    assert.ok(videos.every(v => v.isDemo && !v.isOwnerVideo));
    const html = renderToStaticMarkup(React.createElement(WebsiteVideoShowcase, { videos }));
    assert.match(html, /Featured Shorts/);
    assert.match(html, /Featured Showcases/);
    assert.match(html, /Sample player/);
    assert.doesNotMatch(html, /<iframe/, 'players load only when clicked, not all at page load');
  });
}

test('map uses saved address without coordinates or a Google API key', () => {
  const profile = { businessName: 'My Studio', address: '100 Feet Road', city: 'Bengaluru', postalCode: '560038' };
  const html = renderToStaticMarkup(React.createElement(WebsiteLocationMap, { profile }));
  assert.match(html, /100%20Feet%20Road%2C%20Bengaluru%2C%20560038/);
  assert.match(html, /output=embed/);
  assert.match(html, /Get Directions/);
  assert.doesNotMatch(html, /Mumbai|key=/);
  assert.equal(websiteLocation({ ...profile, latitude: 999, longitude: 12 }).query, '100 Feet Road, Bengaluru, 560038');
  assert.equal(websiteLocation({ ...profile, latitude: 12.9, longitude: 77.6 }).query, '12.9,77.6');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(WebsiteLocationMap, { profile: {} })), /<iframe/);
});

test('public content restores saved settings, owner details, media and explicit deletions without private account fields', () => {
  const source = {
    ownerBio: 'A personal approach', ownerExperience: '12 years', ownerQualifications: 'Colour specialist',
    socialVideos: getDefaultVideosForTemplate('hair_salon'), gallery: TEMPLATE_REGISTRY[0].defaultData.gallery,
    sectionVisibility: { gallery: false, services: true }, sectionHeadings: { servicesTitle: 'My menu' },
    primaryColor: '#abc123', promotionalBanner: { enabled: true, text: 'Welcome' }, offers: [],
    dob: '1990-01-01', ownerId: 'private-account', email: 'private@example.com', clients: [{ phone: 'secret' }],
  };
  const result = applyPublicWebsiteContent({ businessName: 'Published salon' } as SalonProfile, source);
  assert.equal(result.ownerBio, source.ownerBio);
  assert.equal(result.primaryColor, source.primaryColor);
  assert.equal(result.sectionVisibility?.gallery, false);
  assert.equal(result.sectionHeadings?.servicesTitle, 'My menu');
  assert.equal(result.socialVideos?.length, source.socialVideos.length);
  assert.equal(result.gallery?.length, 6);
  assert.equal(result.dob, undefined);
  assert.equal(result.ownerId, undefined);
  assert.equal(result.email, undefined);
  assert.equal((result as any).clients, undefined);
  const deleted = applyPublicWebsiteContent(result, { socialVideos: [], gallery: [], offers: [] });
  assert.deepEqual(deleted.socialVideos, []);
  assert.deepEqual(deleted.gallery, []);
  assert.deepEqual(deleted.offers, []);
  assert.deepEqual(applyPublicWebsiteContent(result, { socialVideos: [{ youtubeUrl: 'https://evil.example/video' }] }).socialVideos, []);
});

test('published services retain booking IDs/prices but get edited image/category/duration visibility', () => {
  const salon = '00000000-0000-4000-8000-000000000001';
  const saved = { ...TEMPLATE_REGISTRY[0].defaultData.services[0], imageUrl: 'https://example.com/edited.jpg', showDuration: false, price: 999999 };
  const catalog = { ...saved, id: catalogId(salon, 'service', saved.id), imageUrl: undefined, showDuration: true, price: 500 };
  const [actual] = mergeServicePresentation([catalog], [saved], salon);
  assert.equal(actual.id, catalog.id);
  assert.equal(actual.price, 500);
  assert.equal(actual.imageUrl, saved.imageUrl);
  assert.equal(actual.showDuration, false);
  const [otherTenant] = mergeServicePresentation([catalog], [saved], '00000000-0000-4000-8000-000000000002');
  assert.equal(otherTenant.imageUrl, undefined);
});

test('complete read-only preview renders edited details and respects persisted visibility', async () => {
  const { SalonWebsitePreview } = await import('../src/components/SalonWebsitePreview');
  const { createBlankSalonProfile } = await import('../src/lib/ownerSalonResolution');
  const t = TEMPLATE_REGISTRY[0];
  const profile = {
    ...createBlankSalonProfile(), businessName: 'My Studio', ownerName: 'My Owner', ownerRole: 'Founder',
    ownerPhotoUrl: 'https://example.com/owner.jpg', ownerBio: 'My unique professional biography', ownerExperience: '15 years',
    socialVideos: t.defaultData.videos, address: 'My address', city: 'Jaipur',
    sectionHeadings: { servicesTitle: 'My saved service heading' }, workingHoursMonFri: '11:00 AM – 8:00 PM',
  };
  const render = (patch = {}) => renderToStaticMarkup(React.createElement(SalonWebsitePreview, {
    profile: { ...profile, ...patch }, services: t.defaultData.services, stylists: t.defaultData.staff,
    publicView: true, previewMode: true, onAddAppointment: () => {},
  }));
  const html = render();
  assert.match(html, /My saved service heading/);
  assert.match(html, /My unique professional biography/);
  assert.match(html, /https:\/\/example.com\/owner.jpg/);
  assert.match(html, /My%20address%2C%20Jaipur/);
  assert.match(html, /11:00 AM/);
  assert.match(html, /Featured Showcases/);
  assert.doesNotMatch(html, /Add YouTube video|Add Service|Salon Address &amp; Localization Setup/);
  const hidden = render({ sectionVisibility: { services: false, gallery: false, about: false } });
  assert.doesNotMatch(hidden, /My saved service heading|Featured Showcases|My unique professional biography/);
});

test('promotion schedules honor disabled, future and expired dates at render time', async () => {
  const { isWithinPromotionDates } = await import('../src/utils/websitePromotions');
  const today = new Date('2026-09-28T12:00:00');
  assert.equal(isWithinPromotionDates('2026-09-28', '2026-09-28', today), true);
  assert.equal(isWithinPromotionDates('2026-10-01', undefined, today), false);
  assert.equal(isWithinPromotionDates(undefined, '2026-09-27', today), false);
  assert.equal(isWithinPromotionDates(undefined, undefined, today), true);
});
