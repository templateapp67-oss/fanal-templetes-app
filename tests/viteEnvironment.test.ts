import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';

test('production config loads dotenv aliases, mode overrides and shell overrides without exposing server secrets', async () => {
  const configPath = path.resolve('vite.config.ts');
  const originalCwd = process.cwd();
  const directory = mkdtempSync(path.join(tmpdir(), 'nexora-vite-env-'));
  const names = Object.keys(process.env).filter(key => /SUPABASE/.test(key));
  const originalEnv = Object.fromEntries(names.map(key => [key, process.env[key]]));
  try {
    for (const key of names) delete process.env[key];
    process.chdir(directory);
    writeFileSync(path.join(directory, '.env'), 'SUPABASE_URL=https://dotenv.supabase.co\nSUPABASE_ANON_KEY=public-dotenv-key\nSUPABASE_SERVICE_ROLE_KEY=private-server-only\n');
    const readConfig = async () => {
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configPath);
      assert.ok(loaded);
      return loaded.config.define!;
    };
    let defines = await readConfig();
    assert.equal(defines['import.meta.env.VITE_SUPABASE_URL'], JSON.stringify('https://dotenv.supabase.co'));
    assert.equal(defines['import.meta.env.VITE_SUPABASE_ANON_KEY'], JSON.stringify('public-dotenv-key'));
    assert.ok(!JSON.stringify(defines).includes('private-server-only'));
    writeFileSync(path.join(directory, '.env.production'), 'SUPABASE_ANON_KEY=public-production-key\n');
    defines = await readConfig();
    assert.equal(defines['import.meta.env.VITE_SUPABASE_ANON_KEY'], JSON.stringify('public-production-key'));
    process.env.SUPABASE_ANON_KEY = 'public-shell-key';
    defines = await readConfig();
    assert.equal(defines['import.meta.env.VITE_SUPABASE_ANON_KEY'], JSON.stringify('public-shell-key'));
    for (const secret of ['sb_secret_not-for-browsers', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`]) {
      process.env.SUPABASE_ANON_KEY = secret;
      await assert.rejects(readConfig(), /server-only Supabase key/);
    }
  } finally {
    process.chdir(originalCwd);
    delete process.env.SUPABASE_ANON_KEY;
    Object.assign(process.env, originalEnv);
    rmSync(directory, { recursive: true, force: true });
  }
});
