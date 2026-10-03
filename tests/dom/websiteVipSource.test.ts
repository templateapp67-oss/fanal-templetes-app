import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { DynamicTemplateRenderer } from '../../src/components/DynamicTemplateRenderer';
import { VipBlackGoldFullExperience } from '../../src/components/VipBlackGoldFullExperience';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES } from '../../src/mockData';

const profile = { ...INITIAL_SALON_PROFILE, businessType: 'luxury_hair_salon' as const, businessName: 'Vijay Signature Studio', tagline: 'Your own salon tagline', city: 'Jaipur', coverImageUrl: '/owner-cover.jpg' };
if (!(globalThis as any).Image) (globalThis as any).Image = window.Image;

test('VIP source uses owner content and local source image fallback, with no admin/showcase controls', () => {
  const html = renderToStaticMarkup(React.createElement(VipBlackGoldFullExperience, { profile, services: INITIAL_SERVICES, onBook: () => {}, onViewSalon: () => {} }));
  assert.match(html, /Vijay Signature Studio/);
  assert.match(html, /Your own salon tagline/);
  assert.match(html, /owner-cover.jpg/);
  for (const text of ['Admin #22', 'Escrow Pipeline', 'Request Access', "L&#x27;Étoile", 'Live Studio Demo']) assert.ok(!html.includes(text));
  const empty = renderToStaticMarkup(React.createElement(VipBlackGoldFullExperience, { profile: { ...profile, coverImageUrl: '' }, services: [], onBook: () => {}, onViewSalon: () => {} }));
  assert.match(empty, /luxury_spa_service/);
  assert.match(empty, /Services coming soon/);
  assert.ok(!empty.includes('Infinity'));
});

test('VIP source booking/profile actions delegate to the existing customer flow', async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  let booked = 0, viewed = 0;
  await act(async () => root.render(React.createElement(VipBlackGoldFullExperience, { profile, services: [], onBook: () => { booked++; }, onViewSalon: () => { viewed++; } })));
  await act(async () => { node.querySelector<HTMLButtonElement>('.vip-source-primary')!.click(); node.querySelector<HTMLButtonElement>('.vip-source-secondary')!.click(); });
  assert.equal(booked, 1); assert.equal(viewed, 1);
  await act(async () => root.unmount()); node.remove();
});

test('real editor renderer selects VIP source and immediately updates profile and service totals', async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const config = { templateId: 'luxury_hair_salon' as const, profile, services: [{ ...INITIAL_SERVICES[0], price: 987, durationMinutes: 45 }], siteUrl: '/?site=vijay-studio' };
  const render = async (next: typeof config) => act(async () => root.render(React.createElement(DynamicTemplateRenderer, { config: next, activeSection: 'hero', deviceMode: 'mobile' })));
  await render(config);
  const hero = node.querySelector('[data-vip-source-website]'); assert.ok(hero);
  assert.match(hero.textContent || '', /Vijay Signature Studio/); assert.match(hero.textContent || '', /₹987/);
  assert.ok(node.querySelector('[data-template-customer-home]'));
  await render({ ...config, profile: { ...profile, businessName: 'Updated Owner Studio', coverImageUrl: '/new-cover.jpg' }, services: [{ ...config.services[0], price: 1234 }] });
  assert.match(node.querySelector('[data-vip-source-website]')!.textContent || '', /Updated Owner Studio/);
  assert.match(node.querySelector('[data-vip-source-website]')!.textContent || '', /₹1,234/);
  assert.equal(node.querySelector('[data-vip-source-website] img')?.getAttribute('src'), '/new-cover.jpg');
  await act(async () => root.unmount()); node.remove();
});

test('other template renderers keep their existing hero rather than the VIP source', async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  await act(async () => root.render(React.createElement(DynamicTemplateRenderer, { config: { templateId: 'barber', profile: { ...profile, businessType: 'barber' }, services: [], siteUrl: '' }, activeSection: 'hero' })));
  assert.equal(node.querySelector('[data-vip-source-website]'), null);
  assert.ok(node.querySelector('#home-section'));
  await act(async () => root.unmount()); node.remove();
});
