import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('owner dashboard hides the completed booking value KPI and profile banner but retains the setup gate', async () => {
  const source = await readFile(new URL('../src/components/SaaSDashboard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Completed Booking Value/);
  assert.doesNotMatch(source, /ProfileCompletionBanner/);
  assert.match(source, /isSalonProfileComplete\(profile\)/);
  assert.match(source, /<ProfileCompletionModal/);
});
