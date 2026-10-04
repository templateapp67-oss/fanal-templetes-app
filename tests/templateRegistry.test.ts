import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEMPLATE_REGISTRY,
  getTemplateById,
  getTemplateBySlug,
} from '../src/data/templates';

test('central template registry exposes every existing template with stable ids and slugs', () => {
  assert.equal(TEMPLATE_REGISTRY.length, 28);
  assert.equal(new Set(TEMPLATE_REGISTRY.map((template) => template.id)).size, TEMPLATE_REGISTRY.length);
  assert.equal(new Set(TEMPLATE_REGISTRY.map((template) => template.slug)).size, TEMPLATE_REGISTRY.length);
  for (const template of TEMPLATE_REGISTRY) {
    assert.equal(template.slug, template.id, 'existing persisted IDs are the canonical stable slugs');
    assert.ok(template.name && template.description && template.tagline);
    assert.ok(template.defaultData.services.length > 0);
    assert.ok(template.defaultData.staff.length > 0);
    assert.ok(Array.isArray(template.defaultData.gallery));
    assert.ok(Array.isArray(template.defaultData.testimonials));
  }
});

test('registry lookup is by stable id or slug, never display name', () => {
  const barber = getTemplateById('barber');
  assert.ok(barber);
  assert.equal(getTemplateBySlug('barber')?.id, barber.id);
  assert.equal(getTemplateBySlug(barber.name), null);
});

test('registry preserves the complete explorer category mapping', () => {
  const counts = Object.fromEntries(['barber', 'hair', 'beauty', 'nails', 'spa', 'ayurvedic', 'skin', 'tattoo', 'kids'].map((category) => [category, TEMPLATE_REGISTRY.filter((template) => template.category === category).length]));
  assert.deepEqual(counts, { barber: 2, hair: 6, beauty: 4, nails: 4, spa: 4, ayurvedic: 4, skin: 2, tattoo: 1, kids: 1 });
});


test('original 27 designs and separate VIP share one registry without conflating luxury hair', () => {
  const vip = getTemplateById('vip_black_gold')!;
  const luxury = getTemplateById('luxury_hair_salon')!;
  assert.ok(vip.isVip);
  assert.ok(!luxury.isVip);
  assert.equal(TEMPLATE_REGISTRY.filter(template => template.isVip).length, 1);
  assert.notEqual(vip.name, luxury.name);
  assert.notEqual(vip.config.layoutStyle, luxury.config.layoutStyle);
  assert.notEqual(vip.config.services[0].name, luxury.config.services[0].name);
  assert.notEqual(vip.config.services[0].id, luxury.config.services[0].id);
  assert.equal(getTemplateBySlug('vip_black_gold')?.id, vip.id);
});
