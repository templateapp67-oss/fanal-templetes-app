import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebsiteSavedModal } from '../src/components/WebsiteSavedModal';

const SITE_URL = 'https://fanal-templetes-app.vercel.app/?site=arts-by-uma';

const renderModal = (siteUrl = SITE_URL) => renderToStaticMarkup(
  React.createElement(WebsiteSavedModal, {
    siteUrl,
    onClose: () => {},
    onBackToDashboard: () => {},
  }),
);

test('the save success dialog clearly presents all three next-step actions', () => {
  const html = renderModal();
  assert.match(html, /Website saved successfully!/);
  for (const action of ['Preview Live Website', 'Copy Site Link', 'Back to Dashboard']) {
    assert.equal(html.split(action).length - 1, 1, `${action} must appear exactly once`);
  }
  assert.match(html, /Keep editing/);
  assert.match(html, /aria-label="Close success dialog"/);
});

test('the live preview opens the requested URL safely in a new tab', () => {
  const html = renderModal();
  const preview = html.match(/<a\b[^>]*>/)?.[0];
  assert.ok(preview, 'the preview action must be a real link');
  assert.ok(preview.includes(`href="${SITE_URL}"`));
  assert.match(preview, /target="_blank"/);
  assert.match(preview, /rel="noopener noreferrer"/);
  assert.ok(html.includes(`value="${SITE_URL}"`), 'the displayed, selectable link must match the preview');
});

test('the dialog remains tenant-aware instead of hard-coding Arts By Uma for every owner', () => {
  for (const siteUrl of [
    'https://fanal-templetes-app.vercel.app/?site=another-studio',
    'https://salon.example',
  ]) {
    const html = renderModal(siteUrl);
    assert.ok(html.includes(`href="${siteUrl}"`));
    assert.ok(html.includes(`value="${siteUrl}"`));
    assert.equal(html.includes(SITE_URL), false);
  }
});

test('the native dialog has accessible labels and does not claim a link was copied before the action succeeds', () => {
  const html = renderModal();
  assert.match(html, /<dialog\b/);
  assert.match(html, /aria-labelledby="website-saved-title"/);
  assert.match(html, /id="website-saved-title"/);
  assert.match(html, /aria-describedby="website-saved-description"/);
  assert.match(html, /id="website-saved-description"/);
  assert.match(html, /for="website-saved-link"/);
  assert.match(html, /id="website-saved-link"[^>]*readOnly=""/);
  assert.equal(html.includes('Site link copied to clipboard!'), false);
  assert.equal(html.includes('Copied!'), false);
});
