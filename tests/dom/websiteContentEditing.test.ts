import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { YouTubeVideoEditor } from '../../src/components/YouTubeVideoEditor';
import { WebsiteVideoShowcase } from '../../src/components/WebsiteVideoShowcase';
import { WebsiteContentEditor } from '../../src/components/WebsiteContentEditor';
import { getDefaultVideosForTemplate } from '../../src/templateSocialVideos';
import { addMissingStarterServices } from '../../src/data/categoryStarterServices';
import { TEMPLATE_REGISTRY } from '../../src/data/templates';
import { isSafeImageUrl, websiteContentError } from '../../src/lib/websiteValidation';
import type { BusinessTypeId, SalonProfile, SalonService } from '../../src/types';

function input(container: HTMLElement, label: string, value: string) {
  const element = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement;
  assert.ok(element, label);
  const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function button(container: HTMLElement, text: string) {
  const el = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  assert.ok(el, `button ${text}`); return el;
}

test('YouTube add, edit, placement, playback, invalid URL, delete and remount use the same profile', async () => {
  let saved = { businessType: 'hair_salon', socialVideos: [] } as unknown as SalonProfile;
  function Harness() {
    const [profile, setProfile] = useState(saved); saved = profile;
    return React.createElement(React.Fragment, null,
      React.createElement(YouTubeVideoEditor, { profile, setProfile }),
      React.createElement(WebsiteVideoShowcase, { videos: profile.socialVideos ?? [] }));
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  let root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => button(container, 'Add YouTube video').click());
    await act(async () => { input(container, 'Video title', 'My transformation'); input(container, 'YouTube link', 'https://not-youtube.com/watch?v=abcdefghijk'); });
    await act(async () => button(container, 'Apply video').click());
    assert.match(container.querySelector('[role="alert"]')?.textContent || '', /valid YouTube/);
    assert.equal(saved.socialVideos?.length, 0);
    await act(async () => input(container, 'YouTube link', 'https://youtu.be/aqz-KE-bpKQ?si=tracking'));
    await act(async () => button(container, 'Apply video').click());
    assert.equal(saved.socialVideos?.length, 1);
    assert.equal(saved.socialVideos?.[0].videoId, 'aqz-KE-bpKQ');
    await act(async () => (container.querySelector('[aria-label="Edit My transformation"]') as HTMLButtonElement).click());
    await act(async () => { input(container, 'Video title', 'Our showcase'); input(container, 'Video placement', 'SHOWCASE'); });
    await act(async () => button(container, 'Apply video').click());
    assert.equal(saved.socialVideos?.[0].categoryTag, 'SHOWCASE');
    assert.match(container.textContent || '', /Featured Showcases/);
    await act(async () => (container.querySelector('[aria-label="Play Our showcase"]') as HTMLButtonElement).click());
    assert.match(container.querySelector('iframe')?.src || '', /youtube.com\/embed\/aqz-KE-bpKQ/);
    await act(async () => (container.querySelector('[aria-label="Delete Our showcase"]') as HTMLButtonElement).click());
    assert.deepEqual(saved.socialVideos, []);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(saved.socialVideos, []);
    assert.doesNotMatch(container.textContent || '', /Demo •/);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test('video quick setup adds editable demos without replacing existing videos and exposes the AI prompt', async () => {
  const existing = { id: 'owner-video', videoId: 'aqz-KE-bpKQ', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', title: 'My salon transformation', description: 'Owner footage', categoryTag: 'SHOWCASE', thumbnailUrl: 'https://example.com/video.jpg', isOwnerVideo: true } as const;
  let saved = { businessType: 'hair_salon', socialVideos: [existing] } as unknown as SalonProfile;
  function Harness() {
    const [profile, setProfile] = useState(saved); saved = profile;
    return React.createElement(YouTubeVideoEditor, { profile, setProfile, templateId: 'hair_salon' });
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const prompt = container.querySelector('[aria-label="AI video content prompt"]') as HTMLTextAreaElement;
    assert.match(prompt.value, /Hair Transformations, Balayage Color Process, and Keratin Treatments/);
    assert.match(prompt.value, /Featured Showcases section/);
    await act(async () => button(container, 'Add editable demo videos').click());
    const expectedDemos = getDefaultVideosForTemplate('hair_salon');
    assert.equal(saved.socialVideos?.length, expectedDemos.length + 1);
    assert.equal(saved.socialVideos?.[0].id, 'owner-video', 'owner video remains untouched');
    assert.ok(expectedDemos.every(demo => saved.socialVideos?.some(video => video.id === demo.id && video.isDemo)));
    await act(async () => button(container, 'Add editable demo videos').click());
    assert.equal(saved.socialVideos?.length, expectedDemos.length + 1, 'repeat clicks do not duplicate the demos');
    assert.match(container.querySelector('[role="status"]')?.textContent || '', /already added/);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test('starter kit fills an empty menu but preserves custom services, identity and deleted media', async () => {
  let profile = { businessType: 'tattoo_studio', businessName: 'My real business', ownerName: 'Me', ownerRole: '', socialVideos: [], gallery: [] } as unknown as SalonProfile;
  let services: SalonService[] = [];
  function Harness() {
    const [p, sp] = useState(profile); const [s, ss] = useState(services);
    profile = p; services = s;
    return React.createElement(WebsiteContentEditor, { profile: p, setProfile: sp, services: s, setServices: ss });
  }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    const originalProfile = profile;
    const emptyServices = services;
    await act(async () => root.render(React.createElement(Harness)));
    assert.strictEqual(services, emptyServices, 'mounting never seeds services');
    const starterButton = button(container, 'Add missing starter content');
    assert.equal(starterButton.textContent?.trim(), 'Add missing starter content (5 template services)');
    assert.equal(starterButton.type, 'button');
    await act(async () => { starterButton.click(); starterButton.click(); });
    assert.equal(services.length, 5);
    assert.ok(services.every(s => s.imageUrl && isSafeImageUrl(s.imageUrl) && s.description));
    assert.strictEqual(profile, originalProfile, 'starter content never updates the owner profile');
    assert.equal(profile.ownerName, 'Me');
    assert.deepEqual(profile.socialVideos, []); assert.deepEqual(profile.gallery, []);
    const first = services;
    const firstService = services[0];
    await act(async () => button(container, 'Add missing starter content').click());
    assert.strictEqual(services, first);
    assert.strictEqual(services[0], firstService);
  } finally { await act(async () => root.unmount()); }
});

test('an undefined menu can explicitly seed the selected template instead of the business category', async () => {
  const originalProfile = { businessType: 'hair_salon', ownerName: 'Owner', socialVideos: [], gallery: [] } as unknown as SalonProfile;
  let services: SalonService[] | undefined;
  function Harness() {
    const [profile, setProfile] = useState(originalProfile);
    const [rows, setServices] = useState<SalonService[]>([]);
    services = rows.length ? rows : undefined;
    return React.createElement(WebsiteContentEditor, { profile, setProfile, services, setServices, templateId: 'massage_wellness' });
  }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(services, undefined, 'no defaults are imported on mount');
    await act(async () => button(container, 'Add missing starter content (5 template services)').click());
    assert.deepEqual(services, addMissingStarterServices(undefined, 'massage_wellness'));
    assert.equal(websiteContentError({ profile: originalProfile, services }), null);
  } finally { await act(async () => root.unmount()); }
});

test('custom services retain array and item references across starter clicks and template changes', async () => {
  const originalProfile = { businessType: 'hair_salon', ownerName: 'Owner', socialVideos: [], gallery: [] } as unknown as SalonProfile;
  const customServices: SalonService[] = [{ ...addMissingStarterServices(undefined, 'hair_salon')[0], id: 'owner-service', name: 'My custom service', price: 3456, description: 'My own description', imageUrl: 'https://example.com/custom.jpg' }];
  let services = customServices;
  let profile = originalProfile;
  let templateId: BusinessTypeId = 'hair_salon';
  function Harness() {
    const [p, setProfile] = useState(originalProfile);
    const [rows, setServices] = useState(customServices);
    profile = p; services = rows;
    return React.createElement(WebsiteContentEditor, { profile: p, setProfile, services: rows, setServices, templateId });
  }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => button(container, 'Add missing starter content').click());
    assert.strictEqual(services, customServices);
    assert.strictEqual(services[0], customServices[0]);
    templateId = 'massage_wellness';
    await act(async () => root.render(React.createElement(Harness)));
    assert.strictEqual(services, customServices, 'changing the template never seeds services');
    await act(async () => button(container, 'Add missing starter content').click());
    assert.strictEqual(services, customServices);
    assert.strictEqual(services[0], customServices[0]);
    assert.strictEqual(profile, originalProfile);
    assert.equal(services[0].name, 'My custom service');
    assert.equal(services[0].price, 3456);
    assert.equal(services[0].description, 'My own description');
    assert.equal(services[0].imageUrl, 'https://example.com/custom.jpg');
  } finally { await act(async () => root.unmount()); }
});

test('each template advertises the actual starter count and seeds complete, valid services only on click', async () => {
  const profile = { businessType: 'hair_salon', ownerName: 'Owner', socialVideos: [], gallery: [] } as unknown as SalonProfile;
  let services: SalonService[] = [];
  function Harness({ templateId }: { templateId: BusinessTypeId }) {
    const [rows, setServices] = useState<SalonService[]>([]);
    services = rows;
    return React.createElement(WebsiteContentEditor, { profile, setProfile: () => assert.fail('starter services must not change the profile'), services: rows, setServices, templateId });
  }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    for (const template of TEMPLATE_REGISTRY) {
      await act(async () => root.render(React.createElement(Harness, { key: template.id, templateId: template.id })));
      assert.deepEqual(services, [], `${template.id}: no seeding on mount or template change`);
      const expected = addMissingStarterServices(undefined, template.id);
      const starterButton = button(container, 'Add missing starter content');
      assert.equal(starterButton.textContent?.trim(), `Add missing starter content (${expected.length} template services)`);
      await act(async () => starterButton.click());
      assert.deepEqual(services, expected, template.id);
      assert.ok(services.every(s => s.imageUrl && isSafeImageUrl(s.imageUrl) && s.description.trim()), template.id);
      assert.equal(websiteContentError({ profile, services }), null, template.id);
    }
  } finally { await act(async () => root.unmount()); }
});
