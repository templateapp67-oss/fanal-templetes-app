// ============================================================================
// Regression tests for the two production faults that produced the opaque
// checkout error "We couldn't save your booking (Server error (HTTP 500))".
//
//   1. `src/lib/supabaseClient.ts` threw `supabaseKey is required.` at IMPORT
//      time when SUPABASE_URL was set without an anon key. Both Express
//      entrypoints import it at module scope, so the whole (serverless)
//      function died before any handler ran and every /api/* call answered with
//      the platform's own HTML 500 page — no JSON, no `error` field, nothing
//      catchable.
//   2. Database calls had no timeout, so a database that never answers kept the
//      request open until the platform killed it — same opaque 500/504.
//
// These tests run the import in a child process (module state is cached per
// process, so env permutations need real isolation).
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Import supabaseClient in a clean child process with a specific environment. */
function importWithEnv(env: Record<string, string>): { ok: boolean; output: string } {
  const script = `
    import(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'src/lib/supabaseClient.ts')).href)})
      .then((m) => {
        console.log(JSON.stringify({
          imported: true,
          mode: m.supabaseConfig.mode,
          isMock: m.isMockSupabase,
          hasAdmin: !!m.getSupabaseAdmin(),
          clientError: m.supabaseConfig.clientError,
          issues: m.supabaseConfig.issues,
        }));
      })
      .catch((err) => {
        console.log(JSON.stringify({ imported: false, error: err.message }));
      });
  `;
  try {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', script],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          // This IS a test run: keep the child's environment notice out of the
          // suite output. The assertions below read the child's JSON on stdout,
          // so suppressing the console notice cannot change any result.
          NEXORA_TEST_RUN: '1',
          // Neutralize the committed dev env file so each case is deterministic.
          DOTENV_CONFIG_QUIET: 'true',
          ...env,
        },
      }
    );
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: `${err?.stdout || ''}${err?.stderr || ''}` };
  }
}

function parseResult(output: string): any {
  const line = output
    .split('\n')
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  assert.ok(line, `no JSON result in child output:\n${output}`);
  return JSON.parse(line as string);
}

test('importing the Supabase client never throws when the anon key is missing', () => {
  const { ok, output } = importWithEnv({
    SUPABASE_URL: 'https://example-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    SUPABASE_ANON_KEY: '',
    VITE_SUPABASE_ANON_KEY: '',
  });
  assert.ok(ok, `child process crashed:\n${output}`);
  const result = parseResult(output);
  assert.equal(result.imported, true);
  assert.equal(result.clientError, null);
  // The server can still talk to the database with the service-role key.
  assert.equal(result.mode, 'live');
  assert.equal(result.hasAdmin, true);
  assert.ok(
    result.issues.some((i: string) => i.includes('SUPABASE_ANON_KEY')),
    'the missing anon key must be reported as a configuration issue'
  );
});

test('a URL with no keys at all degrades to mock mode instead of crashing', () => {
  const { ok, output } = importWithEnv({
    SUPABASE_URL: 'https://example-project.supabase.co',
    SUPABASE_ANON_KEY: '',
    VITE_SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.ok(ok, `child process crashed:\n${output}`);
  const result = parseResult(output);
  assert.equal(result.imported, true);
  assert.equal(result.isMock, true);
  assert.equal(result.clientError, null);
});

test('placeholder values from .env.example are treated as "not configured"', () => {
  const { ok, output } = importWithEnv({
    SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
    SUPABASE_SERVICE_ROLE_KEY: 'YOUR_SUPABASE_SERVICE_ROLE_KEY',
  });
  assert.ok(ok, `child process crashed:\n${output}`);
  const result = parseResult(output);
  assert.equal(result.isMock, true);
  assert.equal(result.hasAdmin, false);
});

test('a fully configured environment reports live mode with no issues', () => {
  const { ok, output } = importWithEnv({
    SUPABASE_URL: 'https://example-project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  });
  assert.ok(ok, `child process crashed:\n${output}`);
  const result = parseResult(output);
  assert.equal(result.mode, 'live');
  assert.equal(result.hasAdmin, true);
  assert.deepEqual(result.issues, []);
});

test('quoted env values (copied from a dashboard) are cleaned, not treated as keys', () => {
  const { ok, output } = importWithEnv({
    SUPABASE_URL: '"https://example-project.supabase.co"',
    SUPABASE_ANON_KEY: '"anon-test-key"',
    SUPABASE_SERVICE_ROLE_KEY: '"service-role-test-key"',
  });
  assert.ok(ok, `child process crashed:\n${output}`);
  const result = parseResult(output);
  assert.equal(result.mode, 'live');
  assert.equal(result.hasAdmin, true);
});
