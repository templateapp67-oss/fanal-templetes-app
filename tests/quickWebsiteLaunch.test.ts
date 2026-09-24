import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('quick launch keeps the owner journey focused and searchable', async () => {
  const source = await readFile(new URL('../src/components/QuickWebsiteLaunch.tsx', import.meta.url), 'utf8');
  assert.match(source, /Launch your website in four simple steps/);
  assert.match(source, /About 30 minutes/);
  assert.match(source, /Search: hair, barber, spa, nail, beauty/);
  assert.match(source, /Publish my website/);
});

test('successful owner authentication opens quick website launch', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /navigate\(ONBOARDING_WEBSITE_PATH\)/);
  assert.match(source, /Complete your quick website setup to go live/);
  assert.match(source, /QuickWebsiteLaunch/);
});
