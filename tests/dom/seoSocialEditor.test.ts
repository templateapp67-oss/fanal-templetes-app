import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { SalonWebsitePreview } from '../../src/components/SalonWebsitePreview';
import type { SalonProfile } from '../../src/types';
import { INITIAL_SALON_PROFILE } from '../../src/mockData';

test('six controlled inputs update the shared save snapshot and restore after remount; legacy TikTok clears', async () => {
  let latest: SalonProfile = { ...INITIAL_SALON_PROFILE, tiktokHandle: undefined, tiktokProfile: '@legacy', tiktokUrl: '@legacy' };
  let saved: any;
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  function Harness() {
    const [profile, setProfile] = useState(latest); latest = profile;
    return React.createElement(WebsiteEditor, { profile, setProfile, services: [], setServices: () => {}, onComplete: () => {}, onBackToDashboard: () => {}, isAuthenticated: true,
      onSave: async () => { saved = JSON.parse(JSON.stringify(profile)); return true; } });
  }
  const input = async (label: string, value: string) => {
    const node = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    assert.ok(node, label);
    await act(async () => {
      const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal((host.querySelector('[aria-label="TikTok"]') as HTMLInputElement).value, '@legacy');
    const fields = [['SEO title', 'Studio SEO'], ['SEO description', 'Studio description'], ['SEO keywords', 'Hair, Salon, hair'], ['Instagram', '@studio'], ['Facebook', 'https://facebook.com/studio'], ['TikTok', '@studio']];
    for (const [label, value] of fields) await input(label, value);
    assert.equal(latest.seoTitle, 'Studio SEO'); assert.equal(latest.instagramHandle, '@studio'); assert.equal(latest.tiktokProfile, '@studio');
    const keywords = host.querySelector('#website-editor-seo-keywords-section')!;
    assert.equal((keywords.textContent!.match(/🏷️/g) || []).length, 2);
    const save = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Save & Update Website'));
    assert.ok(save); await act(async () => save.click());
    assert.equal(saved.seoDescription, 'Studio description'); assert.equal(saved.facebookPage, 'https://facebook.com/studio'); assert.equal(saved.tiktokHandle, '@studio');
    await act(async () => root.unmount()); latest = saved; root = createRoot(host);
    await act(async () => root.render(React.createElement(Harness)));
    for (const [label, value] of fields) assert.equal((host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).value, value);
    await input('TikTok', '');
    assert.equal(latest.tiktokHandle, ''); assert.equal(latest.tiktokProfile, ''); assert.equal(latest.tiktokUrl, '');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('live header includes all three saved social icons and omits cleared TikTok', () => {
  const render = (tiktokHandle?: string) => renderToStaticMarkup(React.createElement(SalonWebsitePreview, {
    profile: { ...INITIAL_SALON_PROFILE, instagramHandle: '@studio', facebookPage: 'https://facebook.com/studio', tiktokProfile: tiktokHandle === '' ? '' : '@old', tiktokHandle },
    services: [], stylists: [], onAddAppointment: () => {},
  } as any));
  const markup = render('@studio');
  const header = markup.slice(markup.indexOf('id="header-social-media-links"'), markup.indexOf('Direct Appointments'));
  assert.match(header, /aria-label="Instagram Profile"/); assert.match(header, /aria-label="Facebook Page"/); assert.match(header, /aria-label="TikTok Profile"/);
  assert.match(header, /https:\/\/www.tiktok.com\/@studio/);
  assert.doesNotMatch(render(''), /aria-label="TikTok Profile"/);
});
