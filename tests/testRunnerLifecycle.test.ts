import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('test prelude cleans up background timers and reports every case without forced exit', () => {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--import', fileURLToPath(new URL('../scripts/testEnv.mjs', import.meta.url)),
    '--test', fileURLToPath(new URL('./helpers/testRunnerTimerFixture.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 10000, env: childEnv });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /# tests 40\b/);
  assert.match(result.stdout, /# pass 40\b/);
  assert.match(result.stdout, /# fail 0\b/);
  assert.equal((result.stdout.match(/^ok \d+ - complete report /gm) || []).length, 40);
});
