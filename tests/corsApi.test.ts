import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

/**
 * CORS + save-API integration tests.
 *
 * Boots the REAL serverless app (api/index.ts default export) on an ephemeral
 * port. No Supabase env is set, so the app runs in mock mode (in-memory
 * registry) — exactly the local/free-tier setup the auto-save pipeline must
 * survive.
 *
 * Covers the three common error classes:
 *   • 401/403 RLS  — covered by tests/savePipeline.test.ts (service-role
 *     fallback path); here we verify the host itself never blocks the save.
 *   • 404 /api/website/save — route exists; unknown /api routes still get a
 *     JSON 404 (never an HTML page that would break res.json() callers).
 *   • CORS / "Failed to fetch" — preflight 204 + origin echo for
 *     cross-origin callers; same-origin traffic stays header-free.
 */
// Keep this mock HTTP suite isolated from a developer's local .env file.
for (const key of ['SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY']) process.env[key] = key.endsWith('URL') ? 'https://placeholder-project.supabase.co' : 'placeholder';
const { nexoraCors } = await import('../server/cors');
const { summarizeSaveError } = await import('../src/lib/autoSave');
const app = (await import('../api/index')).default;

let server: any;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port: number = typeof address === 'object' && address ? address.port : Number(address);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('nexoraCors is the shared middleware both entrypoints mount', () => {
  assert.equal(typeof nexoraCors, 'function');
});

test('OPTIONS preflight for /api/* answers 204 with the CORS allow headers', async () => {
  const res = await fetch(`${baseUrl}/api/website/save`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://editor.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(res.status, 204, 'preflight must be answered, not 404');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://editor.example.com');
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /content-type/i);
  assert.ok(res.headers.get('access-control-max-age'), 'preflight should be cacheable');
});

test('same-origin /api responses carry NO CORS headers (normal flow untouched)', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('vary'), null);
});

test('cross-origin /api responses echo the origin with Vary: Origin', async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://preview.nexora.in' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://preview.nexora.in');
  assert.match(res.headers.get('vary') ?? '', /Origin/i);
});

test('cross-origin POST /api/website/save succeeds end-to-end (preflight + real call)', async () => {
  const res = await fetch(`${baseUrl}/api/website/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://editor.example.com' },
    body: JSON.stringify({
      salonData: {
        ownerId: 'cors-owner-1',
        profile: { businessName: 'Cors Studio', subdomain: 'cors-studio' },
        services: [],
        stylists: [],
      },
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.timestamp, 'number');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://editor.example.com');

  // The saved salon round-trips through the public-site lookup.
  const site = await fetch(`${baseUrl}/api/site/cors-studio`).then((r) => r.json());
  assert.equal(site.found, true);
  assert.equal(site.salon.profile.businessName, 'Cors Studio');
});

test('unknown /api routes still answer JSON 404 (never an HTML error page)', async () => {
  const res = await fetch(`${baseUrl}/api/definitely-not-a-route`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.error, /API route not found/);
});

test('a valid save and its 400 validation still behave after the CORS mount', async () => {
  const valid = await fetch(`${baseUrl}/api/website/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonData: {
        ownerId: 'cors-owner-2',
        profile: { businessName: 'Cors Studio Two', subdomain: 'cors-studio-2' },
      },
    }),
  });
  assert.equal(valid.status, 200);

  const missing = await fetch(`${baseUrl}/api/website/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonData: { ownerId: 'x', profile: {} } }),
  });
  assert.equal(missing.status, 400);
  const missingBody = await missing.json();
  assert.match(missingBody.error, /subdomain/);
});

test('summarizeSaveError gives actionable text for a missing save API (404) and CORS aborts', () => {
  // The exact log line saveViaWebsiteApi produces when the route is absent.
  assert.match(
    summarizeSaveError('POST /api/website/save failed → HTTP 404 Not Found | API route not found'),
    /save API is not deployed/i
  );
  // Browser CORS abort of a cross-origin save call.
  assert.match(
    summarizeSaveError(
      'Access to fetch at https://api.nexora.in/api/website/save from origin https://editor.nexora.in has been blocked by CORS policy: No Access-Control-Allow-Origin header'
    ),
    /Network error/i
  );
  // Existing contract unchanged.
  assert.match(summarizeSaveError('save profile: TypeError: fetch failed'), /Network error/);
  assert.match(
    summarizeSaveError('save salon profile: fetch failed | code: 502'),
    /retrying automatically/i
  );
});
