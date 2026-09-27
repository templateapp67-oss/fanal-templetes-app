import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEMPLATES_PATH,
  isTemplatesPath,
  matchTemplateExplorerRoute,
  templateExplorerPath,
  buildEditorUrl,
  editorTemplateId,
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
  assert.equal(buildEditorUrl(null, 'barber'), '/editor?template=barber');
  assert.equal(editorTemplateId('?template=barber'), 'barber');
});
