import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the actual launcher in an isolated checkout. The npm stub records
// only non-secret test values instead of starting a long-lived test server.
function launch(envFile?: string, processFlag?: string) {
  const root = mkdtempSync(join(tmpdir(), 'nexora-preview-env-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    copyFileSync(resolve('scripts/dev-preview.mjs'), join(root, 'scripts/dev-preview.mjs'));
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    if (envFile !== undefined) writeFileSync(join(root, '.env'), envFile);
    const capture = join(root, 'captured.json');
    writeFileSync(join(root, 'bin/npm'), `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.NEXORA_PREVIEW_TEST_CAPTURE, JSON.stringify({
  args: process.argv.slice(2),
  local: process.env.VITE_LOCAL_SUPABASE,
  key: process.env.VITE_SUPABASE_ANON_KEY,
  url: process.env.VITE_SUPABASE_URL
}));
`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, NEXORA_PREVIEW_TEST_CAPTURE: capture };
    delete env.VITE_LOCAL_SUPABASE;
    delete env.VITE_SUPABASE_ANON_KEY;
    delete env.VITE_SUPABASE_URL;
    if (processFlag !== undefined) env.VITE_LOCAL_SUPABASE = processFlag;
    execFileSync(process.execPath, [join(root, 'scripts/dev-preview.mjs')], { env, timeout: 15000 });
    return { child: JSON.parse(readFileSync(capture, 'utf8')), contents: readFileSync(join(root, '.env'), 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('fresh preview passes local gateway configuration to the full server before imports', () => {
  const { child } = launch();
  assert.deepEqual(child, { args: ['run', 'dev'], local: 'true', key: 'local-dev-anon-key' });
});

test('preview preserves existing project configuration and explicit process overrides', () => {
  const envFile = 'VITE_LOCAL_SUPABASE=true\nVITE_SUPABASE_URL=https://example-project.supabase.co\nVITE_SUPABASE_ANON_KEY=unit-test-public-key\n';
  const { child, contents } = launch(envFile, 'false');
  assert.equal(contents, envFile, 'Never rewrite an existing .env');
  assert.deepEqual(child, {
    args: ['run', 'dev'], local: 'false',
    key: 'unit-test-public-key', url: 'https://example-project.supabase.co',
  });
});
