import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('quick launch redirects template browsing to the existing catalogue', async () => {
  const source = await readFile(new URL('../src/components/QuickWebsiteLaunch.tsx', import.meta.url), 'utf8');
  assert.match(source, /Set up your profile, then choose your website/);
  assert.match(source, /About 30 minutes/);
  assert.match(source, /Explore Custom Templates/);
  assert.match(source, /Explore existing templates/);
});

test('successful owner authentication opens quick website launch', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /navigate\(ONBOARDING_WEBSITE_PATH\)/);
  assert.match(source, /Complete your quick website setup to go live/);
  assert.match(source, /onExploreTemplates/);
});
