import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEMPLATE_REGISTRY } from '../src/data/templates';
import { addMissingStarterServices, serviceImageFallback } from '../src/data/categoryStarterServices';
import { globalSiteConfig, importRichService, applyGlobalSiteConfig } from '../src/lib/globalSiteConfig';
import { INITIAL_SALON_PROFILE } from '../src/mockData';
import { websiteContentError } from '../src/lib/websiteValidation';
import { websiteDatabase, actor, other, salon } from './helpers/websiteDatabase';
import { mergeServicePresentation } from '../server/websiteContent';
import { mapServiceRow } from '../server/siteLookup';
import { injectSocialMetadata } from '../src/lib/socialMetadata';

const rich = { id: 'sale-service', name: 'Scalp Spa', category: 'Hair', description: 'A relaxing treatment.', price: 1200, sale_price: 800, duration: '60 mins', image_url: '' };

test('all 27 templates seed exactly five rich services without replacing or sharing owner data', () => {
  for (const template of TEMPLATE_REGISTRY) {
    const services = addMissingStarterServices(undefined, template.id);
    assert.equal(services.length, 5, template.id);
    assert.equal(new Set(services.map(s => s.id)).size, 5);
    for (const service of services) {
      assert.ok(service.name && service.category);
      assert.ok(service.description.length >= 100 && service.description.length <= 150, `${template.id}: ${service.description.length}`);
      assert.ok(service.durationMinutes > 0 && service.price >= 0 && service.showDuration);
      assert.ok(service.imageUrl?.startsWith('https://images.unsplash.com/'));
      assert.ok(Number(new URL(service.imageUrl!).searchParams.get('w')) >= 1200);
    }
    services[0].name = 'Owner custom edit';
    assert.strictEqual(addMissingStarterServices(services, template.id), services);
    assert.notEqual(addMissingStarterServices([], template.id)[0].name, 'Owner custom edit');
    assert.ok(serviceImageFallback(template.id));
  }
  assert.deepEqual(addMissingStarterServices([], 'hair_salon').map(s => s.name), ['Precision Cut & Blowdry', 'Balayage Color', 'Keratin Treatment', 'Scalp Detox Spa', 'Beard Sculpting']);
  assert.deepEqual(addMissingStarterServices([], 'massage_wellness').map(s => s.name), ['Deep Tissue Massage', 'Aromatherapy', 'Swedish Therapy', 'Herbal Scrub', 'Hot Stone Therapy']);
  assert.deepEqual(addMissingStarterServices([], 'beauty_parlour').map(s => s.name), ['HydraFacial', 'Bridal Makeover', 'Threading & Waxing', 'Nail Extensions', 'Pedicure Deluxe']);
});

test('nested contract round-trips, clears aliases and keeps actual booking amount in canonical price', () => {
  const input = { seo: { title: 'Studio SEO', description: 'Custom description', keywords: ['hair', 'salon', 'HAIR'] }, social_links: { instagram: '@studio', facebook: '@studio', tiktok: '@studio' }, services: [rich] };
  const state = applyGlobalSiteConfig(INITIAL_SALON_PROFILE, [], input);
  assert.equal(state.services[0].price, 800); assert.equal(state.services[0].originalPrice, 1200);
  assert.equal(state.services[0].durationMinutes, 60);
  assert.deepEqual(globalSiteConfig(state.profile, state.services), { ...input, seo: { ...input.seo, keywords: ['hair', 'salon'] } });
  assert.equal(websiteContentError(state), null);
  const cleared = applyGlobalSiteConfig(state.profile, state.services, { social_links: { instagram: '', facebook: '', tiktok: '' }, services: [] });
  assert.equal(cleared.profile.tiktokProfile, ''); assert.equal(cleared.profile.tiktokUrl, ''); assert.deepEqual(cleared.services, []);
  assert.strictEqual(applyGlobalSiteConfig(state.profile, state.services, {}).services, state.services);
  for (const patch of [{ sale_price: -1 }, { sale_price: 1201 }, { price: NaN }, { duration: '0 mins' }, { image_url: 'javascript:alert(1)' }]) assert.throws(() => importRichService({ ...rich, ...patch }));
  assert.equal(importRichService({ ...rich, sale_price: 0 }).price, 0);
  assert.equal(importRichService({ ...rich, sale_price: null }).price, 1200);
  assert.ok(websiteContentError({ profile: {}, services: [{ ...state.services[0], originalPrice: 500 }] }));
});

test('sale/regular prices survive the deployed atomic SQL contract, public projection, updates and discount removal', async () => {
  const db = await websiteDatabase();
  try {
    await db.exec(`create table auth.users(id uuid primary key); insert into auth.users values('${actor}'),('${other}'); grant usage on schema auth to authenticated; grant select on profiles to authenticated;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261028000000_complete_website_editor_persistence.sql', import.meta.url), 'utf8'));
    for (const sale_price of [800, 750, 0, null]) {
      const service = importRichService({ ...rich, sale_price });
      await db.query('select save_owner_editor_state($1::jsonb)', [JSON.stringify({ profile: { ownerId: actor, businessName: 'My Studio', businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Studio Road', city: 'Jaipur' }, services: [service] })]);
      const saved = (await db.query<any>('select get_owner_editor_state() as state')).rows[0].state;
      assert.deepEqual(saved.services, [service]);
      const row = (await db.query<any>('select * from services where salon_id=$1 and is_active', [salon])).rows[0];
      assert.equal(Number(row.price_paise), (sale_price ?? 1200) * 100, 'authoritative booking/payment amount');
      const data = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data;
      const published = mergeServicePresentation([mapServiceRow(row)], data.editor_services, salon)[0];
      assert.equal(published.price, sale_price ?? 1200);
      assert.equal(published.originalPrice, sale_price == null ? undefined : 1200);
      const forged = mergeServicePresentation([mapServiceRow(row)], [{ ...service, price: 1 }], salon)[0];
      assert.equal(forged.price, sale_price ?? 1200, 'JSON presentation cannot override normalized charge');
    }
    await db.query('select save_owner_editor_state($1::jsonb)', [JSON.stringify({ profile: { ownerId: actor, businessName: 'My Studio', businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Studio Road', city: 'Jaipur' }, services: [] })]);
    assert.equal((await db.query<any>('select * from services where salon_id=$1 and is_active', [salon])).rows.length, 0, 'deleting the menu does not re-seed it');
  } finally { await db.close(); }
});

test('initial crawler metadata is category independent on every nexora subdomain', () => {
  for (const template of TEMPLATE_REGISTRY) {
    const html = injectSocialMetadata('<html><head><title>Old</title></head><body></body></html>', { ...INITIAL_SALON_PROFILE, businessType: template.id, subdomain: 'my-studio', seoTitle: 'Owner title', seoDescription: 'Owner description', seoKeywords: 'one, two, ONE' }, 'https://my-studio.nexora.in/');
    assert.match(html, /<title>Owner title<\/title>/); assert.match(html, /name="description" content="Owner description"/);
    assert.match(html, /name="keywords" content="one, two"/);
  }
});
