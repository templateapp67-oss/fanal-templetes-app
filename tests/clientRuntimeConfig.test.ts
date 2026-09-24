// ============================================================================
// Runtime client configuration (/env.js).
//
// The failure this pins: a Vite bundle only carries the VITE_* values that
// existed at BUILD time. A deployment that set the SERVER-side names instead —
// SUPABASE_URL / SUPABASE_ANON_KEY, the names hosts and the Vercel dashboard
// use — shipped a browser with no Supabase at all, so every sign-in screen
// answered
//     "Accounts are not connected to a database in this deployment.
//      Set the Supabase environment variables to enable sign up and sign in."
// on a deployment whose /api/health reported a live connection.
//
// The fix hands the same PUBLIC pair to the browser at runtime. These tests pin
// the three things that make it safe:
//
//   1. the endpoint exists, is never cached, and its payload is built from the
//      public names only — the service-role key can never ride along;
//   2. index.html loads it BEFORE the app bundle (so no script order can race);
//   3. the client actually picks it up, still refuses placeholders, and is
//      otherwise unchanged when nothing is injected.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

/** Source with comments removed — what the compiler actually sees. */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

type ClientConfig = { mode: string; urlHost: string | null; hasAnonKey: boolean; hasServiceKey: boolean };

/**
 * Import the real client module in a fresh process, optionally with the runtime
 * payload the server would inject, and report what it resolved.
 */
const clientWith = (injected: Record<string, string> | null): ClientConfig => {
  const code = `
    ${injected ? `globalThis.__NEXORA_ENV__ = ${JSON.stringify(injected)};` : ''}
    const m = await import('./src/lib/supabaseClient.ts');
    console.log('__CFG__' + JSON.stringify({
      mode: m.supabaseConfig.mode,
      urlHost: m.supabaseConfig.urlHost,
      hasAnonKey: m.supabaseConfig.hasAnonKey,
      hasServiceKey: m.supabaseConfig.hasServiceKey,
    }));
  `;
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NEXORA_TEST_RUN: '1' },
  });
  const line = out.split('\n').find((entry) => entry.startsWith('__CFG__'));
  assert.ok(line, `the client module printed no config line:\n${out}`);
  return JSON.parse(line.slice('__CFG__'.length)) as ClientConfig;
};

// ---------------------------------------------------------------------------
// 1. The endpoint
// ---------------------------------------------------------------------------

test('/env.js exists, is never cached, and carries only the public pair', () => {
  const server = code('server.ts');
  const handlerStart = server.indexOf('app.get("/env.js"');
  assert.ok(handlerStart > -1, 'server.ts must serve /env.js');

  const handler = server.slice(handlerStart, handlerStart + 300);
  assert.ok(handler.includes('JSON.stringify(runtimeClientConfig)'), 'the payload must be the runtime config object');
  assert.ok(handler.includes('no-store'), 'the payload must never be cached — a rotated key would go stale');

  // The payload is assembled from the public names only.
  const buildStart = server.indexOf('const runtimeClientConfig');
  assert.ok(buildStart > -1 && buildStart < handlerStart);
  const build = server.slice(buildStart, handlerStart);
  assert.ok(build.includes('SUPABASE_URL'), 'the project URL is the public half of the pair');
  assert.ok(build.includes('SUPABASE_ANON_KEY'), 'the anon key is the public half of the pair');
  assert.doesNotMatch(build, /SERVICE_ROLE/, 'the service-role key must never reach a browser payload');
  assert.doesNotMatch(handler, /SERVICE_ROLE/);

  // The local gateway resolves its own browser config; the runtime payload must
  // not fight it (it would hand the browser the server's loopback origin).
  assert.ok(build.includes('!localSupabaseEnabled'), 'the gateway case must be excluded');
});

test('index.html loads /env.js before the app bundle', () => {
  const html = read('index.html');
  const runtimeScript = html.indexOf('<script src="/env.js"></script>');
  const appScript = html.indexOf('<script type="module"');
  assert.ok(runtimeScript > -1, 'index.html must load /env.js');
  assert.ok(appScript > -1, 'index.html must still load the app bundle');
  assert.ok(runtimeScript < appScript, 'the runtime payload must be defined before the app module runs');
});

// ---------------------------------------------------------------------------
// 2. The client
// ---------------------------------------------------------------------------

test('the injected pair turns a build with no VITE_* values into a live client', () => {
  const injected = clientWith({
    SUPABASE_URL: 'https://runtime-project.supabase.co',
    SUPABASE_ANON_KEY: 'runtime-anon-key',
  });
  assert.equal(injected.mode, 'live', 'a deployment connected server-side must not report itself as mock');
  assert.equal(injected.urlHost, 'runtime-project.supabase.co');
  assert.equal(injected.hasAnonKey, true);
  assert.equal(injected.hasServiceKey, false);

  // The runtime payload never implies the local gateway: the URL stays the
  // project the server named, not the page's own origin.
  assert.notEqual(injected.urlHost, '127.0.0.1:3000');
});

test('nothing is injected → the client behaves exactly as before', () => {
  const bare = clientWith(null);
  assert.equal(bare.mode, 'mock');
  assert.equal(bare.urlHost, null);
  assert.equal(bare.hasAnonKey, false);
});

test('placeholders are still refused, wherever they come from', () => {
  const placeholderKey = clientWith({
    SUPABASE_URL: 'https://runtime-project.supabase.co',
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  });
  assert.equal(placeholderKey.mode, 'mock', 'a placeholder anon key must never count as a connection');
  assert.equal(placeholderKey.hasAnonKey, false);

  const placeholderUrl = clientWith({
    SUPABASE_URL: 'https://placeholder-project.supabase.co',
    SUPABASE_ANON_KEY: 'runtime-anon-key',
  });
  assert.equal(placeholderUrl.mode, 'mock', 'a placeholder URL must never count as a connection');
});
