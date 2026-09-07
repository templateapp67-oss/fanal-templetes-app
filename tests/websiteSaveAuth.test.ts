import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { test, before, after } from 'node:test';

/**
 * Live-mode auth tests for POST /api/website/save (server/websiteSave.ts).
 *
 * The service-role key BYPASSES RLS, so the endpoint itself is the
 * authorization boundary: in live mode it must (a) require the caller's
 * Supabase access token, (b) verify it against the Supabase Auth server
 * (GET /auth/v1/user, service-role apikey), and (c) enforce
 * token.user.id === owner_id. Without (c), any visitor could pass any
 * owner_id and upsert that owner's rows — the repo is public OSS, so this
 * is a real attack surface.
 *
 * This file boots the REAL app (api/index.ts default export) with a FAKE
 * Supabase (one local HTTP server answering /auth/v1/user + /rest/v1/*).
 * Env must be set before the dynamic import — supabaseClient.ts reads it at
 * module-evaluation time. Each node:test file runs in its own process, so
 * this never leaks into the mock-mode suite.
 */
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const SERVICE_KEY = 'fake-service-role-key-for-tests';
const ANON_KEY = 'fake-anon-key-for-tests';

// ---- fake Supabase: GoTrue user endpoint + PostgREST upsert sink ----------
let fakeSupabase: Server;
let fakeSupabaseUrl: string;
const restCalls: Array<{ path: string; apikey: string | null; prefer: string | null }> = [];
const authCalls: Array<{ authorization: string | null; apikey: string | null }> = [];

function startFakeSupabase(): Promise<string> {
  return new Promise((resolve) => {
    fakeSupabase = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://fake');

      if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
        authCalls.push({
          authorization: req.headers.authorization ?? null,
          apikey: (req.headers.apikey as string) ?? null,
        });
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
        if (token === 'owner-a-token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: OWNER_A, aud: 'authenticated', email: 'a@example.com' }));
          return;
        }
        if (token === 'owner-b-token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: OWNER_B, aud: 'authenticated', email: 'b@example.com' }));
          return;
        }
        // anything else (garbage / expired) → Supabase Auth rejects it
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Token expired or invalid' }));
        return;
      }

      if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/')) {
        restCalls.push({
          path: url.pathname,
          apikey: (req.headers.apikey as string) ?? null,
          prefer: (req.headers.prefer as string) ?? null,
        });
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
    });
    fakeSupabase.listen(0, '127.0.0.1', () => {
      const address = fakeSupabase.address();
      const port: number = typeof address === 'object' && address ? address.port : Number(address);
      fakeSupabaseUrl = `http://127.0.0.1:${port}`;
      resolve(fakeSupabaseUrl);
    });
  });
}

// ---- the real app, in "live" mode ------------------------------------------
let appServer: Server;
let baseUrl: string;

before(async () => {
  await startFakeSupabase();
  // Env BEFORE the app import (supabaseClient.ts reads it at module eval).
  process.env.SUPABASE_URL = fakeSupabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  const app = (await import('../api/index')).default;
  await new Promise<void>((resolve) => {
    appServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = appServer.address();
  const port: number = typeof address === 'object' && address ? address.port : Number(address);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => appServer?.close(() => resolve()));
  await new Promise<void>((resolve) => fakeSupabase?.close(() => resolve()));
});

function savePayload(ownerId: string) {
  return {
    salonData: {
      ownerId,
      profile: { subdomain: 'auth-test-salon', name: 'Auth Test Salon' },
      services: [{ id: 'svc-1', name: 'Haircut', price: 500, duration: 30 }],
      stylists: [],
      loyaltyConfig: null,
    },
  };
}

async function postSave(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/website/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('live mode + NO Authorization header → 401 Unauthorized, nothing written', async () => {
  restCalls.length = 0;
  const res = await postSave(savePayload(OWNER_A));
  assert.equal(res.status, 401);
  const body: any = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error, 'Unauthorized');
  assert.equal(restCalls.length, 0, 'no PostgREST write may happen without a token');
});

test('live mode + garbage/expired token (Auth server 401) → 401, nothing written', async () => {
  restCalls.length = 0;
  const res = await postSave(savePayload(OWNER_A), { Authorization: 'Bearer expired-or-forged-token' });
  assert.equal(res.status, 401);
  const body: any = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error, 'Unauthorized');
  assert.equal(restCalls.length, 0);
});

test('live mode + token of a DIFFERENT owner → 401 (owner_id must match token)', async () => {
  restCalls.length = 0;
  // Attacker scenario: valid session of owner B, but claiming owner A's salon.
  const res = await postSave(savePayload(OWNER_A), { Authorization: `Bearer owner-b-token` });
  assert.equal(res.status, 401);
  const body: any = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error, 'Unauthorized');
  assert.equal(restCalls.length, 0, 'owner A rows must never be upserted by owner B');
});

test('live mode + caller is really owner_id → 200, service-role upsert performed', async () => {
  restCalls.length = 0;
  authCalls.length = 0;
  const res = await postSave(savePayload(OWNER_A), { Authorization: `Bearer owner-a-token` });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.success, true);
  assert.ok(typeof body.timestamp === 'number');

  // Verification used the SERVICE-ROLE apikey (not anon, not the user token).
  assert.equal(authCalls.length, 1);
  assert.equal(authCalls[0].apikey, SERVICE_KEY);
  assert.equal(authCalls[0].authorization, `Bearer owner-a-token`);

  // And the write went through PostgREST with the service-role apikey.
  assert.ok(restCalls.length >= 1, 'profile upsert must reach PostgREST');
  assert.ok(restCalls.some((c) => c.path.startsWith('/rest/v1/profiles')));
  for (const c of restCalls) {
    assert.equal(c.apikey, SERVICE_KEY, 'every write must use the service-role key');
  }
});

test('live mode keeps 400 validation for a malformed owner_id (before auth)', async () => {
  const res = await postSave(savePayload('not-a-uuid'), { Authorization: `Bearer owner-a-token` });
  assert.equal(res.status, 400);
  const body: any = await res.json();
  assert.equal(body.success, false);
});
