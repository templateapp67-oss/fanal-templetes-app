import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalonWebsitePreview } from '../../src/components/SalonWebsitePreview';
import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { WebsiteContentEditor } from '../../src/components/WebsiteContentEditor';
import { INITIAL_SALON_PROFILE } from '../../src/mockData';
import { TEMPLATE_REGISTRY } from '../../src/data/templates';
import { importRichService } from '../../src/lib/globalSiteConfig';
import type { SalonService } from '../../src/types';

Object.defineProperty(globalThis, 'Image', { value: window.Image, configurable: true });
Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });

const service = importRichService({ id: 'discount', name: 'Owner Signature Care', category: 'Signature', description: 'Thoughtful personal care in a welcoming setting, with a detailed consultation and practical guidance for your next visit.', price: 1200, sale_price: 800, duration: '60 mins' });
const profile = { ...INITIAL_SALON_PROFILE, instagramHandle: '@studio', facebookPage: '@studio', tiktokHandle: '@studio', sectionVisibility: { ...INITIAL_SALON_PROFILE.sectionVisibility, services: true } };

test('all templates render shared rich cards, category image fallback, social icons and a payable-price booking CTA', () => {
  for (const template of TEMPLATE_REGISTRY) {
    const markup = renderToStaticMarkup(React.createElement(SalonWebsitePreview, { profile, services: [service], stylists: [], selectedTemplateId: template.id, onAddAppointment: () => {}, publicView: true, previewMode: true } as any));
    assert.match(markup, /Owner Signature Care/, template.id);
    assert.match(markup, /<del[^>]*>₹1,200<\/del>/, template.id);
    assert.match(markup, /Book \(₹800\)/, template.id);
    assert.match(markup, /alt="Owner Signature Care"[^>]*loading="lazy"/);
    assert.match(markup, /aria-label="TikTok Profile"/); assert.match(markup, /aria-label="Instagram Profile"/); assert.match(markup, /aria-label="Facebook Page"/);
  }
});

test('starter button supports missing state, preserves existing services and never seeds just by mounting', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let latest: SalonService[] | undefined;
  function Harness() {
    const [services, setServices] = useState<SalonService[]>(undefined as any); latest = services;
    return React.createElement(WebsiteContentEditor, { profile, setProfile: () => {}, services, setServices, templateId: 'beauty_parlour' });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(latest, undefined);
    const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Add missing starter'))!;
    assert.ok(button.textContent?.includes('5 template services'));
    await act(async () => button.click());
    assert.equal(latest?.length, 5); assert.equal(latest?.[0].name, 'HydraFacial');
    const first = latest;
    await act(async () => button.click()); assert.strictEqual(latest, first);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('actual service controls update live preview and explicit save; sale price clears and invalid discount never saves', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let latest = [service], saved: SalonService[] = [];
  function Harness() {
    const [services, setServices] = useState(latest); latest = services;
    return React.createElement(React.Fragment, null,
      React.createElement('div', { id: 'editor' }, React.createElement(WebsiteEditor, { profile, setProfile: () => {}, services, setServices, isAuthenticated: true, onComplete: () => {}, onBackToDashboard: () => {}, onSave: async () => { saved = JSON.parse(JSON.stringify(services)); return true; } })),
      React.createElement('div', { id: 'live' }, React.createElement(SalonWebsitePreview, { profile, services, stylists: [], selectedTemplateId: 'massage_wellness', onAddAppointment: () => {}, previewMode: true } as any)));
  }
  const input = async (label: string, value: string) => {
    const lab = [...host.querySelectorAll('#editor label')].find(n => n.textContent === label) as HTMLLabelElement;
    assert.ok(lab, label);
    const node = document.getElementById(lab.htmlFor) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await input('Sale price (₹, optional)', '650');
    assert.equal(latest[0].price, 650); assert.equal(latest[0].originalPrice, 1200);
    assert.ok(host.querySelector('#live')?.textContent?.includes('Book (₹650)'));
    await input('Sale price (₹, optional)', '2000');
    assert.equal(latest[0].price, 650); assert.ok(host.querySelector('[role="alert"]')?.textContent?.includes('Not saved'));
    await input('Sale price (₹, optional)', '600');
    const save = [...host.querySelectorAll<HTMLButtonElement>('#editor button')].find(b => b.textContent?.includes('Save & Update Website'))!;
    await act(async () => save.click()); assert.equal(saved[0].price, 600); assert.equal(saved[0].originalPrice, 1200);
    await input('Sale price (₹, optional)', '');
    assert.equal(latest[0].price, 1200); assert.equal(latest[0].originalPrice, undefined);
    assert.equal(host.querySelector('#live del'), null);
    await act(async () => save.click()); assert.equal(saved[0].originalPrice, undefined);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('offline-booking sites offer a WhatsApp enquiry containing the actual sale amount', () => {
  const markup = renderToStaticMarkup(React.createElement(SalonWebsitePreview, { profile: { ...profile, acceptsOnlineBookings: false, whatsapp: '9876543210' }, services: [service], stylists: [], selectedTemplateId: 'barber', onAddAppointment: () => {}, publicView: true, previewMode: true } as any));
  assert.match(markup, /Book on WhatsApp/);
  assert.ok(markup.includes(`https://wa.me/919876543210?text=${encodeURIComponent(`Hello ${profile.businessName}, I would like to book ${service.name} (60 mins) for ₹800.`)}`));
  assert.doesNotMatch(markup, /Book \(₹800\)/);
});
