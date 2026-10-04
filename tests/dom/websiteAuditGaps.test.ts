import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { INITIAL_SALON_PROFILE } from '../../src/mockData';
import { templateRating, templateRatingLabel } from '../../src/lib/templateRating';
import { BookingPriceBreakdown } from '../../src/components/BookingPriceBreakdown';
import { TemplatePublishingSettings } from '../../src/components/TemplatePublishingSettings';
import { TEMPLATE_LAYOUTS } from '../../src/data/templateLayouts';
import { VipSalonWebsite } from '../../src/vipBlackGoldSource/SalonWebsite';
import { TEMPLATE_REGISTRY } from '../../src/data/templates';

test('all 28 designs have an explicit distinct composition recipe', () => {
  const recipes = TEMPLATE_REGISTRY.map(template => TEMPLATE_LAYOUTS[template.config.layoutStyle]);
  assert.equal(recipes.length, 28);
  assert.ok(recipes.every(Boolean));
  assert.equal(new Set(recipes.map(recipe => JSON.stringify(recipe))).size, 28);
});

test('public aggregates are authoritative; curated testimonials are labelled honestly', () => {
  const testimonial = { id: '1', name: 'Customer', rating: 5, location: '', serviceName: '', comment: '', date: '', avatarUrl: '' };
  const p = { ...INITIAL_SALON_PROFILE, testimonials: [testimonial] };
  assert.match(templateRatingLabel(p), /5.0 \(1 salon testimonials\)/);
  assert.equal(templateRating({ ...p, publicRating: { average: 0, count: 0 } }), null);
  assert.equal(templateRating({ ...p, publicRating: { average: NaN, count: 10 } }), null);
  assert.equal(templateRating({ ...p, publicRating: { average: 6, count: 10 } }), null);
  assert.equal(templateRating({ ...p, publicRating: { average: 4.3, count: 7 } })?.average, 4.3);
  assert.match(templateRatingLabel({ ...p, publicRating: { average: 4.3, count: 7 } }), /7 customer reviews/);
});

test('live price breakdown keeps server total and whole-rupee 25% advance consistent', () => {
  const html = renderToStaticMarkup(React.createElement(BookingPriceBreakdown, { total: 1187.5 }));
  assert.match(html, /Subtotal/); assert.match(html, /Platform fee/); assert.match(html, /Tax/);
  assert.match(html, /₹297/); assert.match(html, /₹890.5/);
  assert.match(html, /refund eligibility/); assert.match(html, /disabled/);
  assert.doesNotMatch(html, /automatically refunded|VIP Priority Slot Hold/);
});

test('publishing controls update the owner profile without altering the fixed advance', async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  let saved = INITIAL_SALON_PROFILE;
  function Editor() { const [profile, setProfile] = useState({ ...INITIAL_SALON_PROFILE, whiteLabelEnabled: false, whatsappNotificationsEnabled: true }); saved = profile; return React.createElement(TemplatePublishingSettings, { profile, onChange: patch => setProfile(prev => ({ ...prev, ...patch })) }); }
  try {
    await act(async () => root.render(React.createElement(Editor)));
    const field = node.querySelector<HTMLInputElement>('[aria-label="Custom domain"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(field, 'studio.example.com'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(saved.customDomain, 'studio.example.com');
    const boxes = node.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    await act(async () => boxes[0].click()); assert.equal(saved.whiteLabelEnabled, true);
    await act(async () => boxes[1].click()); assert.equal(saved.whatsappNotificationsEnabled, false);
    assert.equal(saved.depositPercentage, INITIAL_SALON_PROFILE.depositPercentage);
    assert.match(node.textContent || '', /25%/);
  } finally { await act(async () => root.unmount()); node.remove(); }
});


test('VIP custom light background uses dark readable text without losing owner content', () => {
  const html = renderToStaticMarkup(React.createElement(VipSalonWebsite, { profile: { ...INITIAL_SALON_PROFILE, backgroundColor: '#ffffff', businessName: 'Owner Studio' }, services: [], onBook: () => {}, onViewSalon: () => {} }));
  assert.match(html, /background-color:#ffffff/);
  assert.match(html, /--vip-ink:#16161b/);
  assert.match(html, /--vip-muted:#45454d/);
  assert.match(html, /Owner Studio/);
});
