import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { YouTubeVideoEditor } from '../../src/components/YouTubeVideoEditor';
import { WebsiteVideoShowcase } from '../../src/components/WebsiteVideoShowcase';
import { WebsiteContentEditor } from '../../src/components/WebsiteContentEditor';
import { getDefaultVideosForTemplate } from '../../src/templateSocialVideos';
import type { SalonProfile, SalonService } from '../../src/types';

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
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => button(container, 'Add missing starter content').click());
    assert.equal(services.length, 5);
    assert.ok(services.every(s => s.imageUrl && s.description));
    assert.equal(profile.ownerName, 'Me');
    assert.deepEqual(profile.socialVideos, []); assert.deepEqual(profile.gallery, []);
    const first = services;
    await act(async () => button(container, 'Add missing starter content').click());
    assert.equal(services, first);
  } finally { await act(async () => root.unmount()); }
});
