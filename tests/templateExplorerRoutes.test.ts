import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATE_REGISTRY, getTemplateConfig } from '../src/data/templates';
import { mergeTemplatePreservingUserData } from '../src/lib/salonStore';
import { INITIAL_SALON_PROFILE } from '../src/mockData';
import {
  TEMPLATES_PATH,
  isTemplatesPath,
  matchTemplateExplorerRoute,
  templateExplorerPath,
  buildEditorUrl,
  editorTemplateId,
  isOnboardingWebsitePath,
} from '../src/lib/router';

test('template explorer keeps category and search in a shareable URL', () => {
  const href = templateExplorerPath({ category: 'barber', query: 'royal' });
  assert.equal(href, '/templates?category=barber&q=royal');
  assert.deepEqual(matchTemplateExplorerRoute('/templates', '?category=barber&q=royal'), {
    templateId: null, preview: false, category: 'barber', query: 'royal',
  });
});

test('preview is a distinct route and returns to the same explorer filters', () => {
  const href = templateExplorerPath({ category: 'beauty', query: 'bridal', templateId: 'bridal_lounge', preview: true });
  assert.equal(href, '/templates/bridal_lounge/preview?category=beauty&q=bridal');
  assert.deepEqual(matchTemplateExplorerRoute('/templates/bridal_lounge/preview', '?category=beauty&q=bridal'), {
    templateId: 'bridal_lounge', preview: true, category: 'beauty', query: 'bridal',
  });
});

test('only the templates namespace is recognised as the explorer', () => {
  assert.equal(TEMPLATES_PATH, '/templates');
  assert.equal(isTemplatesPath('/templates'), true);
  assert.equal(isTemplatesPath('/templates/barber/preview'), true);
  assert.equal(isTemplatesPath('/editor'), false);
});

test('template selection enters the existing editor without an onboarding detour', () => {
  assert.equal(buildEditorUrl(null, 'barber'), '/editor?templateId=barber');
  assert.equal(editorTemplateId('?template=barber'), 'barber');
  assert.equal(editorTemplateId('?templateId=barber'), 'barber');
  assert.equal(isOnboardingWebsitePath('/setup'), true);
});


test('all 28 template preview/editor URLs retain identity and owner content when selected', () => {
  assert.equal(TEMPLATE_REGISTRY.length, 28);
  for (const template of TEMPLATE_REGISTRY) {
    const url = templateExplorerPath({ templateId: template.id, preview: true });
    assert.equal(matchTemplateExplorerRoute(url, '')?.templateId, template.id);
    const editor = buildEditorUrl(null, template.id);
    assert.equal(editorTemplateId(editor.slice(editor.indexOf('?'))), template.id);
    const owner = { ...INITIAL_SALON_PROFILE, businessName: 'Owner Custom Studio', ownerName: 'Vijay Kumar', phone: '9876543210', address: '42 Owner Street', coverImageUrl: '/owner-photo.jpg' };
    const selected = mergeTemplatePreservingUserData(owner, template.id, 'hair_salon');
    assert.equal(selected.businessType, template.id);
    const defaultCover = getTemplateConfig('hair_salon').coverImageUrl;
    const switchedDefault = mergeTemplatePreservingUserData({ ...owner, coverImageUrl: defaultCover }, template.id, 'hair_salon');
    assert.equal(switchedDefault.coverImageUrl, getTemplateConfig(template.id).coverImageUrl);
    for (const key of ['businessName', 'ownerName', 'phone', 'address', 'coverImageUrl'] as const) assert.equal(selected[key], owner[key], `${template.id}: ${key} survives selection`);
  }
});
