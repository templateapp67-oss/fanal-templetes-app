import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('the Growth Partner shell exposes Home navigation in shared chrome', async () => {
  const source = await readFile(new URL('../src/components/PartnerPortalShell.tsx', import.meta.url), 'utf8');
  assert.match(source, /Back to Nexora Home/);
  assert.match(source, /data-partner-home/);
  assert.match(source, /const returnHome/);
});

test('the portal receives app navigation through GrowthPartnerPage onBack', async () => {
  const source = await readFile(new URL('../src/components/GrowthPartnerPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /<PartnerPortalShell/);
  assert.match(source, /onBack=\{onBack\}/);
});
