// ============================================================================
// Deployment entrypoint contract.
//
// A crash loop reported from the host looked like this:
//
//   Error: Cannot find module '/home/runner/workspace/.output/server/index.mjs'
//   command finished with error [node .output/server/index.mjs]: exit status 1
//   healthcheck failed error=healthcheck / returned status 500
//   crash loop detected
//
// Nothing was wrong with the app: `.output/server/index.mjs` is a Nuxt/Nitro
// artifact this project never produces. The host was starting the wrong
// entrypoint, so the process exited immediately and every `/` probe answered
// 500. The port line in the same log (`127.0.0.1:1104: connection refused`) was
// the second half of the story: the listener hard-coded 3000 and ignored the
// port the platform had assigned.
//
// Both halves are pinned here, because both are invisible until a deploy fails.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. One entrypoint, and it is the one the build produces
// ---------------------------------------------------------------------------

test('package.json starts the file the build writes — not a foreign server artifact', () => {
  const pkg = JSON.parse(SOURCE('package.json')) as { scripts: Record<string, string> };
  const build = pkg.scripts.build;
  const start = pkg.scripts.start;

  // The build emits exactly this file…
  assert.match(build, /--outfile=dist\/server\.cjs/, `build must emit dist/server.cjs (got: ${build})`);
  // …and start runs exactly that file.
  assert.equal(start, 'node dist/server.cjs', 'the start script is the deployment entrypoint');
  // Both halves agree, so a host running `npm start` cannot miss.
  const emitted = build.match(/--outfile=(\S+)/)![1];
  assert.equal(start, `node ${emitted}`, 'build output and start script must name the same file');
});

test('the Nuxt/Nitro entrypoint that caused the crash loop is not referenced anywhere', () => {
  const files = [
    'package.json',
    'vercel.json',
    'server.ts',
    'server.ts'.replace('server.ts', 'server/health.ts'),
  ];
  for (const file of files) {
    const code = SOURCE(file);
    assert.doesNotMatch(
      code,
      /\.output\/server|\.output\\server|nitro|nuxt/i,
      `${file} must not reference a foreign server artifact (.output/server/index.mjs is Nuxt/Nitro)`
    );
  }
  // `package.json` may not carry a `main` that points outside what we build.
  const pkg = JSON.parse(SOURCE('package.json')) as { main?: string };
  if (pkg.main) {
    assert.match(pkg.main, /^dist\//, `main must point into dist/, not ${pkg.main}`);
  }
});

// ---------------------------------------------------------------------------
// 2. The listener takes the port the platform gives it
// ---------------------------------------------------------------------------

test('the server listens on $PORT and binds 0.0.0.0', () => {
  const server = SOURCE('server.ts');

  // The platform assigns the port; a hard-coded 3000 with no env read means the
  // healthcheck probes a port where nothing is listening.
  assert.match(server, /process\.env\.PORT/, 'the listener must read $PORT');
  assert.match(
    server,
    /const PORT = [^;]*3000[^;]*;/,
    'the resolved port still needs a local-development default'
  );
  // 127.0.0.1 is unreachable from a platform proxy, however healthy the process.
  assert.match(server, /app\.listen\(PORT, "0\.0\.0\.0"/, 'bind all interfaces, not loopback');
  assert.doesNotMatch(server, /app\.listen\(\s*PORT\s*,\s*["']127\.0\.0\.1["']/, 'never loopback-only');
});

test('a nonsense $PORT falls back to the default instead of crashing the boot', () => {
  const server = SOURCE('server.ts');
  // The guard rejects NaN, zero, negatives and out-of-range values before the
  // port reaches `app.listen` (which would throw and look like a crash).
  assert.match(server, /Number\.parseInt\(String\(process\.env\.PORT/, 'parse the env value');
  assert.match(server, /parsedPort > 0 && parsedPort <= 65535/, 'validate the range');
});

// ---------------------------------------------------------------------------
// 3. The healthcheck the platform uses answers 200
// ---------------------------------------------------------------------------

test('there is a purpose-built health endpoint for the platform to probe', () => {
  const server = SOURCE('server.ts');
  assert.match(server, /"\/api\/health"/, 'the platform can probe a real readiness answer');
  const health = SOURCE('server/health.ts');
  // `status` is 'ok' when nothing is wrong ('degraded' otherwise) — verified
  // live: `curl /api/health` answered {"status":"ok", …} with HTTP 200.
  assert.match(health, /status:\s*problems\.length === 0 \? 'ok'/, 'and it reports a machine-readable status');
  // In production the SPA is served from dist with an index.html fallback, so
  // GET / answers 200 once the process is up. `npm start` + `$PORT` is what
  // makes that true — pinned above.
  assert.match(server, /express\.static\(distPath\)/, 'static SPA assets are served in production');
  assert.match(server, /sendFile\(path\.join\(distPath, "index\.html"\)\)/, 'and / falls back to the SPA');
});
