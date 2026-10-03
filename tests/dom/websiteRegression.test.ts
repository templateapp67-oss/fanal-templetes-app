import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InteractiveMapSetup } from '../../src/components/InteractiveMapSetup';
import { ContentImageField } from '../../src/components/ContentImageField';
import { WebsiteContentEditor } from '../../src/components/WebsiteContentEditor';
import { SalonWebsitePreview } from '../../src/components/SalonWebsitePreview';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES } from '../../src/mockData';
import type { SalonProfile } from '../../src/types';

function mount() { const container = document.createElement('div'); document.body.appendChild(container); return { container, root: createRoot(container) }; }
function input(el: HTMLInputElement | HTMLTextAreaElement, value: string) { const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }

test('map mount never invents contact/location data and accepts newer saved profile values', async () => {
  const { container, root } = mount(); let changes = 0;
  let saved = { ...INITIAL_SALON_PROFILE, address: '', city: '', phone: '', areaLocality: '', postalCode: '', state: '', shopFlatNo: '', latitude: undefined, longitude: undefined };
  let set: React.Dispatch<React.SetStateAction<SalonProfile>>;
  function Harness() { const [p, sp] = useState(saved); saved = p as typeof saved; set = sp; return React.createElement(InteractiveMapSetup, { profile: p, setProfile: next => { changes++; sp(next); } }); }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(changes, 0); assert.equal(Boolean(container.querySelector('iframe')), false); assert.equal(saved.phone, '');
    await act(async () => set(p => ({ ...p, address: 'New Studio Road', city: 'Jaipur', phone: '9876543210' })));
    assert.equal((container.querySelector('[aria-label="Studio street address"]') as HTMLTextAreaElement).value, 'New Studio Road');
    await act(async () => input(container.querySelector('[aria-label="Studio street address"]')!, 'Changed Studio Road'));
    assert.equal(changes, 1); assert.equal(saved.city, 'Jaipur'); assert.equal(saved.phone, '9876543210');
    assert.match(container.querySelector<HTMLAnchorElement>('a[href*="openstreetmap.org/search"]')?.href || '', /Changed%20Studio%20Road/);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test('unsafe image input does not replace saved content and a removal survives a late upload', async () => {
  const { container, root } = mount(); let value = 'https://example.com/original.jpg';
  let reader: any;
  const originalReader = globalThis.FileReader;
  const originalImage = globalThis.Image;
  const canvas = window.HTMLCanvasElement.prototype;
  const originalContext = canvas.getContext, originalDataUrl = canvas.toDataURL;
  (globalThis as any).FileReader = class { onload: any; onerror: any; readAsDataURL() { reader = this; } };
  (globalThis as any).Image = class { width = 20; height = 20; onload: any; set src(_: string) { this.onload(); } };
  canvas.getContext = (() => ({ drawImage() {} })) as any;
  canvas.toDataURL = () => 'data:image/jpeg;base64,YQ==';
  function Harness() { const [v, sv] = useState(value); value = v; return React.createElement(ContentImageField, { label: 'Portrait', value: v, onChange: sv }); }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => input(container.querySelector('input[type="url"]')!, 'javascript:alert(1)'));
    assert.equal(value, 'https://example.com/original.jpg'); assert.ok(container.querySelector('[role="alert"]'));
    const upload = container.querySelector('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { value: [new window.File(['photo'], 'portrait.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    assert.ok(reader, 'compression started but is still in flight');
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Remove image')!.click());
    assert.equal(value, '');
    await act(async () => reader.onload({ target: { result: 'data:image/jpeg;base64,YQ==' } }));
    assert.equal(value, '', 'the old upload must not restore an image the owner removed');
  } finally {
    (globalThis as any).FileReader = originalReader; (globalThis as any).Image = originalImage;
    canvas.getContext = originalContext; canvas.toDataURL = originalDataUrl;
    await act(async () => root.unmount()); container.remove();
  }
});

test('empty published menus never authenticate or book a template fallback service', async () => {
  const { container, root } = mount(); let authRequests = 0;
  const props = { profile: { ...INITIAL_SALON_PROFILE, coverImageUrl: '', gallery: [], socialVideos: [], offers: [], testimonials: [] }, services: [], stylists: [], publicView: true, onAddAppointment: () => {}, onRequireAuth: () => { authRequests++; } };
  try {
    await act(async () => root.render(React.createElement(SalonWebsitePreview, props)));
    assert.equal(Boolean(container.querySelector('img[alt*="hero"]')), false);
    const book = [...container.querySelectorAll('button')].find(b => /Book.*(Appointment|Now)|Reserve/i.test(b.textContent || ''));
    assert.ok(book, 'booking CTA exists');
    await act(async () => book.click());
    assert.equal(authRequests, 0); assert.match(container.textContent || '', /Online booking is currently unavailable/);
    assert.doesNotMatch(container.textContent || '', /Signature Haircut|Select a Date/);
    await act(async () => root.render(React.createElement(SalonWebsitePreview, { ...props, services: INITIAL_SERVICES, profile: { ...props.profile, acceptsOnlineBookings: false } })));
    await act(async () => [...container.querySelectorAll('button')].find(b => /Book.*(Appointment|Now)|Reserve/i.test(b.textContent || ''))!.click());
    assert.equal(authRequests, 0);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test('testimonial deletion is profile-backed, survives remount, and never restores template reviews', async () => {
  const { container, root } = mount();
  let saved: SalonProfile = { ...INITIAL_SALON_PROFILE, gallery: [], socialVideos: [], testimonials: [{ id: 'r1', name: 'Real Guest', comment: 'A truly lovely visit', rating: 5, date: '', serviceName: 'Cut', location: 'Jaipur', avatarUrl: '' }] };
  function Harness() { const [p, sp] = useState(saved); saved = p; return React.createElement(WebsiteContentEditor, { profile: p, setProfile: sp, services: [] }); }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => (container.querySelector('[aria-label="Delete testimonial by Real Guest"]') as HTMLButtonElement).click());
    assert.deepEqual(saved.testimonials, []);
    await act(async () => root.render(React.createElement(Harness, { key: 'remount' })));
    assert.equal(Boolean(container.querySelector('[aria-label^="Delete testimonial"]')), false);
    assert.deepEqual(saved.testimonials, []);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test('published data is scoped to the current site while the next request is pending or fails', async () => {
  const { useSalonData } = await import('../../src/lib/useSalonData');
  const { container, root } = mount();
  const originalFetch = globalThis.fetch;
  const requests: Array<(response: any) => void> = [];
  globalThis.fetch = (() => new Promise(resolve => requests.push(resolve))) as typeof fetch;
  function Harness({ site }: { site: string | null }) {
    const { data } = useSalonData(site, { profile: { ...INITIAL_SALON_PROFILE, businessName: `Fallback ${site}` }, services: [], stylists: [] });
    return React.createElement('p', null, data.profile.businessName);
  }
  try {
    await act(async () => root.render(React.createElement(Harness, { site: 'studio-a' })));
    await act(async () => requests[0]({ ok: true, json: async () => ({ found: true, salon: { profile: { ...INITIAL_SALON_PROFILE, businessName: 'Published A' }, services: [], stylists: [] } }) }));
    assert.equal(container.textContent, 'Published A');
    await act(async () => root.render(React.createElement(Harness, { site: 'studio-b' })));
    assert.equal(container.textContent, 'Fallback studio-b', 'no previous salon content while loading');
    await act(async () => requests[1]({ ok: false }));
    assert.equal(container.textContent, 'Fallback studio-b', 'a failed fetch must not revive another salon');
    await act(async () => root.render(React.createElement(Harness, { site: null })));
    assert.equal(container.textContent, 'Fallback null');
    assert.equal(requests.length, 2, 'template demos with no site do not fetch a public tenant');
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => root.unmount()); container.remove();
  }
});
