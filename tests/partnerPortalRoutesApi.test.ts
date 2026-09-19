// ============================================================================
// Growth Partner portal OPERATIONS API — /api/partner/* (server/partnerPortalRoutes.ts).
//
// The routes are a thin, safe proxy over the session-scoped RPCs, and "thin" is
// the whole claim under test:
//
//   • every route verifies the bearer token before it reads or writes anything
//     (a blanket sweep over the registered table, so a route cannot be added
//     later without tripping this);
//   • the CALLER's token is what reaches PostgREST — never the service key — so
//     RLS and the functions' own `my_active_partner_id()` guard stay in force;
//   • inputs are bound (limits clamped to what the SQL accepts, enums matched,
//     uuids validated) and refusals are answered with the right status;
//   • raw database text never reaches the browser, except the constraint
//     messages these functions deliberately write for the partner;
//   • a deploy with no Supabase connection answers 503 instead of inventing
//     an empty wallet (which the client then answers by using the RPC path).
//
// No Express, no socket, no database: the registered handlers are invoked with
// a fake req/res and an injected `callRpc`, so the assertions are about this
// file's own behaviour and nothing else.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PARTNER_PORTAL_ROUTES,
  registerPartnerPortalRoutes,
  type PartnerPortalRouteDeps,
} from '../server/partnerPortalRoutes';

interface RpcCall {
  token: string;
  fn: string;
  args: Record<string, unknown>;
}

interface FakeResponse {
  statusCode: number;
  body: any;
  headersSent: boolean;
  locals: Record<string, unknown>;
  status(code: number): FakeResponse;
  json(payload: any): FakeResponse;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    body: null,
    headersSent: false,
    locals: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      res.headersSent = true;
      return res;
    },
  };
  return res;
}

interface Harness {
  routes: Map<string, (req: any, res: any) => Promise<void> | void>;
  rpcCalls: RpcCall[];
  call: (method: 'GET' | 'POST', path: string, options?: { query?: any; body?: any; token?: string | null; params?: any }) => Promise<FakeResponse>;
}

/**
 * Mount the routes on a fake Express app.
 *
 * `token: 'good'` is the only token the fake auth layer accepts; anything else
 * (or no Authorization header) is rejected exactly the way
 * `verifyBackendUser` would reject it, because that is the function being used.
 */
function mount(
  overrides: {
    rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data?: any; error?: any }>;
    signAssetUrl?: (bucket: string, path: string) => Promise<string | null>;
    isMock?: boolean;
  } = {}
): Harness {
  const rpcCalls: RpcCall[] = [];
  const routes = new Map<string, any>();
  const record = (method: 'get' | 'post') => (path: string, handler: any) => {
    routes.set(`${method.toUpperCase()} ${path}`, handler);
  };
  const app: any = { get: record('get'), post: record('post') };

  // The shape supabase-js answers with — readDatabase unwraps `.data`, and
  // verifyBackendUser then requires data.user.id.
  const db = {
    auth: {
      getUser: async (token: string) =>
        token === 'good'
          ? { data: { user: { id: 'partner-user-1' } }, error: null }
          : { data: { user: null }, error: null },
    },
  };

  const deps: PartnerPortalRouteDeps = {
    db,
    isMock: overrides.isMock ?? false,
    callRpc: async (token: string, fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ token, fn, args });
      if (overrides.rpc) return overrides.rpc(fn, args);
      if (fn === 'get_partner_marketing_assets') {
        return { data: [{ id: 'a18d0df6-58b5-4bdc-a518-3a597d5b7195', storage_bucket: 'partner-marketing-assets', storage_path: 'social/reel-1.mp4', title: 'Launch reel' }] };
      }
      if (fn === 'mark_my_partner_notifications_read') return { data: 3 };
      return { data: { ok: true, fn } };
    },
    ...(overrides.signAssetUrl ? { signAssetUrl: overrides.signAssetUrl } : {}),
  };

  registerPartnerPortalRoutes(app, deps);

  return {
    routes,
    rpcCalls,
    call: async (method, path, options = {}) => {
      const handler = routes.get(`${method} ${path}`);
      assert.ok(handler, `${method} ${path} is registered`);
      const req: any = {
        query: options.query ?? {},
        body: options.body ?? {},
        params: options.params ?? {},
        headers: options.token === null ? {} : { authorization: `Bearer ${options.token ?? 'good'}` },
      };
      const res = fakeResponse();
      req.res = res;
      await handler(req, res, (error: any) => {
        throw error;
      });
      return res;
    },
  };
};

const DOWNLOAD = '/api/partner/marketing-assets/:id/download';

const uuid = (tail: string) => `a18d0df6-58b5-4bdc-a518-3a597d5b7${tail}`;

// ---------------------------------------------------------------------------
// 1. The route table is complete and every entry is authenticated
// ---------------------------------------------------------------------------

test('every section of the promoted portal has a route, and each one is documented', () => {
  const paths = PARTNER_PORTAL_ROUTES.map((route) => `${route.method.toUpperCase()} ${route.path}`);
  for (const expected of [
    'GET /api/partner/earnings',
    'POST /api/partner/payout-requests',
    'GET /api/partner/payout-requests',
    'POST /api/partner/payout-requests/cancel',
    'GET /api/partner/levels',
    'GET /api/partner/leaderboard',
    'GET /api/partner/notifications',
    'POST /api/partner/notifications/read',
    'GET /api/partner/notification-preferences',
    'POST /api/partner/notification-preferences',
    'GET /api/partner/marketing-assets',
    'GET /api/partner/marketing-assets/categories',
    'POST /api/partner/support-tickets',
    'GET /api/partner/support-tickets',
  ]) {
    assert.ok(paths.includes(expected), `${expected} exists`);
  }
  assert.equal(new Set(paths).size, paths.length, 'no duplicate route is registered');
  for (const route of PARTNER_PORTAL_ROUTES) {
    assert.ok(route.description.length > 20, `${route.path} says what it does`);
  }
});

test('no route is reachable without a verified session — and none takes a partner id', async () => {
  const harness = mount();
  // The signed URL route is part of the surface too.
  const allPaths = [...harness.routes.keys()];
  assert.ok(allPaths.includes('GET /api/partner/marketing-assets/:id/download'));
  for (const key of allPaths) {
    const [method, path] = key.split(' ');
    const res = await harness.call(method as 'GET' | 'POST', path, { token: null, params: { id: uuid('195') } });
    assert.equal(res.statusCode, 401, `${key} must answer 401 for an anonymous caller`);
    assert.equal(res.body?.error?.code, 'auth_required', `${key} uses the shared auth code`);
  }
  assert.equal(harness.rpcCalls.length, 0, 'nothing was read before the caller was verified');
  // No path or handler can smuggle a partner id — the SQL derives it from the
  // session, which is the property this whole surface rests on.
  for (const route of allPaths) {
    assert.doesNotMatch(route, /:partnerId|:userId/, 'identity is never a path parameter');
  }
  for (const call of harness.rpcCalls) assert.doesNotMatch(JSON.stringify(call.args), /p_partner_id|p_user_id/);
});

test('a deploy with no Supabase project answers 503 and calls nothing', async () => {
  const harness = mount({ isMock: true });
  const res = await harness.call('GET', '/api/partner/earnings');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'backend_unavailable');
  assert.match(res.body.error.message, /No Supabase project is connected/);
  assert.equal(harness.rpcCalls.length, 0);
});

test('an unverifiable token is refused with the shared auth copy', async () => {
  const harness = mount();
  const res = await harness.call('GET', '/api/partner/earnings', { token: 'expired' });
  assert.equal(res.statusCode, 401);
  assert.equal(harness.rpcCalls.length, 0, 'the RPC is never reached with a bad token');
});

// ---------------------------------------------------------------------------
// 2. Reads forward the CALLER's token and bound limits
// ---------------------------------------------------------------------------

test('the ledger read runs as the caller with a clamped window', async () => {
  const harness = mount({ rpc: async () => ({ data: { currency: 'INR', totals: {}, transactions: [] } }) });
  const res = await harness.call('GET', '/api/partner/earnings', { query: { limit: '5000', offset: '20' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { data: { currency: 'INR', totals: {}, transactions: [] } });
  assert.deepEqual(harness.rpcCalls, [
    { token: 'good', fn: 'get_my_partner_earnings', args: { p_limit: 200, p_offset: 20 } },
  ], 'the caller token, the SQL cap, and nothing else');
});

test('query params are bound, not forwarded raw', async () => {
  const harness = mount();
  const badLimit = await harness.call('GET', '/api/partner/earnings', { query: { limit: 'abc' } });
  assert.equal(badLimit.statusCode, 400);
  assert.match(badLimit.body.error.message, /limit must be a positive number/);
  const badOffset = await harness.call('GET', '/api/partner/earnings', { query: { offset: '-1' } });
  assert.equal(badOffset.statusCode, 400);
  const badType = await harness.call('GET', '/api/partner/notifications', { query: { type: 'everything' } });
  assert.equal(badType.statusCode, 400);
  assert.match(badType.body.error.message, /Unknown notification type/);
  const goodType = await harness.call('GET', '/api/partner/notifications', { query: { type: 'payout', limit: '7' } });
  assert.equal(goodType.statusCode, 200);
  assert.deepEqual(harness.rpcCalls.at(-1)?.args, { p_type: 'payout', p_limit: 7 });
  const allType = await harness.call('GET', '/api/partner/notifications', { query: { type: 'all' } });
  assert.equal(allType.statusCode, 200);
  assert.deepEqual(harness.rpcCalls.at(-1)?.args, { p_type: null, p_limit: 50 }, '“all” is no filter');
});

test('the standings and preference reads answer their own shapes', async () => {
  const harness = mount();
  await harness.call('GET', '/api/partner/leaderboard', { query: { limit: '10' } });
  await harness.call('GET', '/api/partner/levels');
  await harness.call('GET', '/api/partner/notification-preferences');
  await harness.call('GET', '/api/partner/payout-requests', { query: { limit: '5', offset: '5' } });
  await harness.call('GET', '/api/partner/support-tickets', { query: { status: 'resolved' } });
  await harness.call('GET', '/api/partner/marketing-assets/categories');
  assert.deepEqual(
    harness.rpcCalls.map((call) => [call.fn, call.args]),
    [
      ['get_partner_leaderboard', { p_limit: 10 }],
      ['get_my_partner_levels', {}],
      ['get_my_partner_notification_preferences', {}],
      ['get_my_partner_payout_requests', { p_limit: 5, p_offset: 5 }],
      ['get_my_partner_support_tickets', { p_limit: 25, p_status: 'resolved' }],
      ['get_partner_marketing_asset_categories', {}],
    ]
  );
});

// ---------------------------------------------------------------------------
// 3. Writes: validated, then answered with the receipt
// ---------------------------------------------------------------------------

test('a payout request is validated here and refused there — with the SQL copy preserved', async () => {
  const harness = mount({
    rpc: async () => ({ error: { code: '22023', message: 'Minimum withdrawal is ₹500' } }),
  });
  const created = await harness.call('POST', '/api/partner/payout-requests', {
    body: { amount_paise: 60000, method: 'upi', destination_label: 'partner@okbank' },
  });
  assert.equal(created.statusCode, 400, 'the backend refusal decides');
  assert.equal(created.body.error.message, 'Minimum withdrawal is ₹500', 'partner-facing copy is forwarded verbatim');
  assert.deepEqual(harness.rpcCalls[0], {
    token: 'good',
    fn: 'request_my_partner_payout',
    args: { p_amount_paise: 60000, p_method: 'upi', p_destination_label: 'partner@okbank' },
  });
});

test('a payout request with an unusable body never reaches the database', async () => {
  for (const body of [
    { amount_paise: 0, method: 'upi', destination_label: 'partner@okbank' },
    { amount_paise: 1.5, method: 'upi', destination_label: 'partner@okbank' },
    { amount_paise: 'many', method: 'upi', destination_label: 'partner@okbank' },
    { amount_paise: 60000, method: 'crypto', destination_label: 'wallet' },
    { amount_paise: 60000, method: 'upi', destination_label: 'x' },
    { amount_paise: 60000, method: 'upi' },
  ]) {
    const harness = mount();
    const res = await harness.call('POST', '/api/partner/payout-requests', { body });
    assert.equal(res.statusCode, 400, `${JSON.stringify(body)} is refused`);
    assert.equal(harness.rpcCalls.length, 0, 'a refused body never becomes an RPC');
  }
});

test('a successful payout request answers 201 with the row the ledger created', async () => {
  const harness = mount({
    rpc: async () => ({ data: { id: uuid('195'), status: 'pending', amount_paise: 60000 } }),
  });
  const res = await harness.call('POST', '/api/partner/payout-requests', {
    body: { amount_paise: 60000, method: 'bank_transfer', destination_label: 'HDFC •••• 4417' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.status, 'pending');
});

test('cancelling needs a real id, and only the caller’s own open request can be cancelled', async () => {
  const badId = mount();
  const refused = await badId.call('POST', '/api/partner/payout-requests/cancel', { body: { request_id: '1' } });
  assert.equal(refused.statusCode, 400);
  assert.equal(badId.rpcCalls.length, 0, 'a non-uuid id is not even looked up');

  const gone = mount({ rpc: async () => ({ error: { code: 'P0002', message: 'Open payout request not found' } }) });
  const missed = await gone.call('POST', '/api/partner/payout-requests/cancel', { body: { request_id: uuid('195') } });
  assert.equal(missed.statusCode, 400);
  assert.equal(missed.body.error.message, 'Open payout request not found');
});

test('marking notifications read returns the row count and accepts the all-case', async () => {
  const harness = mount();
  const all = await harness.call('POST', '/api/partner/notifications/read', { body: {} });
  assert.equal(all.statusCode, 200);
  assert.deepEqual(all.body, { data: { count: 3 } });
  assert.deepEqual(harness.rpcCalls.at(-1)?.args, { p_ids: null });

  await harness.call('POST', '/api/partner/notifications/read', { body: { ids: [uuid('195'), '  ', uuid('196')] } });
  assert.deepEqual(harness.rpcCalls.at(-1)?.args, { p_ids: [uuid('195'), uuid('196')] }, 'blank ids are dropped');

  const junk = await harness.call('POST', '/api/partner/notifications/read', { body: { ids: ['please-read-everything'] } });
  assert.equal(junk.statusCode, 400);
  assert.match(junk.body.error.message, /must be UUIDs/);

  const tooMany = await harness.call('POST', '/api/partner/notifications/read', { body: { ids: Array.from({ length: 101 }, (_, i) => uuid(String(i).padStart(3, '0').slice(-3))) } });
  assert.equal(tooMany.statusCode, 400);
});

test('notification preferences are booleans in, the stored row back out', async () => {
  const harness = mount({ rpc: async () => ({ data: { email_enabled: false, in_app_enabled: true, updated_at: null } }) });
  const res = await harness.call('POST', '/api/partner/notification-preferences', { body: { email_enabled: false } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(harness.rpcCalls[0].args, { p_email_enabled: false, p_in_app_enabled: true }, 'an omitted toggle keeps the table default');
  assert.deepEqual(res.body.data, { email_enabled: false, in_app_enabled: true, updated_at: null });
});

test('a support ticket is bounded the way the table checks it', async () => {
  const harness = mount({ rpc: async () => ({ data: { id: uuid('195'), ticket_number: 41, status: 'open' } }) });
  const short = await harness.call('POST', '/api/partner/support-tickets', {
    body: { subject: 'Hi', message: 'x'.repeat(20), priority: 'normal' },
  });
  assert.equal(short.statusCode, 400);
  assert.match(short.body.error.message, /at least 3 characters/);
  const longMessage = await harness.call('POST', '/api/partner/support-tickets', {
    body: { subject: 'Payout refused', message: 'x'.repeat(5001), priority: 'normal' },
  });
  assert.equal(longMessage.statusCode, 400);
  const badPriority = await harness.call('POST', '/api/partner/support-tickets', {
    body: { subject: 'Payout refused', message: 'x'.repeat(20), priority: 'urgent' },
  });
  assert.equal(badPriority.statusCode, 400);
  assert.equal(harness.rpcCalls.length, 0, 'none of the three reached the database');

  const ok = await harness.call('POST', '/api/partner/support-tickets', {
    body: { subject: '  Payout refused  ', message: 'x'.repeat(20), priority: 'high' },
  });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.body.data.ticket_number, 41);
  assert.deepEqual(harness.rpcCalls[0].args, {
    p_subject: 'Payout refused',
    p_message: 'x'.repeat(20),
    p_priority: 'high',
  }, 'the subject is trimmed before it is stored');
});

// ---------------------------------------------------------------------------
// 4. Failure mapping + the private bucket
// ---------------------------------------------------------------------------

test('database failures are translated, and raw text never leaks', async () => {
  const cases: Array<[any, number, string]> = [
    [{ code: 'PGRST202', message: 'Could not find the function public.get_my_partner_earnings' }, 501, 'schema_not_applied'],
    [{ code: '42501', message: 'Active Growth Partner required' }, 403, 'partner_only'],
    [{ code: 'XX001', message: 'permission denied for table partner_earnings\n  at line 4 of execute_query' }, 502, 'backend_unavailable'],
  ];
  for (const [error, status, code] of cases) {
    const harness = mount({ rpc: async () => ({ error }) });
    const res = await harness.call('GET', '/api/partner/earnings');
    assert.equal(res.statusCode, status, `${code} → ${status}`);
    assert.equal(res.body.error.code, code);
    assert.doesNotMatch(JSON.stringify(res.body), /permission denied|execute_query|partner_earnings/, 'internal detail stays on the server');
  }

  // A second open payout request is refused by a partial UNIQUE index, whose
  // text names the index. The route answers with the fix instead.
  const duplicate = mount({
    rpc: async () => ({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "partner_payout_requests_one_open_per_partner"' },
    }),
  });
  const dup = await duplicate.call('POST', '/api/partner/payout-requests', {
    body: { amount_paise: 60000, method: 'upi', destination_label: 'me@okbank' },
  });
  assert.equal(dup.statusCode, 400, 'a refused duplicate is the partner\'s to fix, not a 502');
  assert.match(dup.body.error.message, /already have a payout request open/i);
  assert.doesNotMatch(JSON.stringify(dup.body), /one_open_per_partner/, 'the index name stays on the server');
});

test('a private asset is signed only after it proved itself published for this caller', async () => {
  const signed: Array<[string, string]> = [];
  const harness = mount({
    signAssetUrl: async (bucket, path) => {
      signed.push([bucket, path]);
      return `https://storage.example/signed?${path}`;
    },
  });
  const ok = await harness.call('GET', DOWNLOAD, {
    params: { id: 'a18d0df6-58b5-4bdc-a518-3a597d5b7195' },
  });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body.data.signed_url, /^https:\/\/storage\.example\/signed\?social\/reel-1\.mp4$/);
  assert.equal(ok.body.data.expires_in_seconds, 60);
  assert.deepEqual(signed, [['partner-marketing-assets', 'social/reel-1.mp4']]);
  // The list lookup that authorized the pair is the caller-scoped RPC.
  assert.deepEqual(harness.rpcCalls.map((call) => call.fn), ['get_partner_marketing_assets']);
  assert.equal(harness.rpcCalls[0].token, 'good', 'signed via the caller’s published list, not a service-role scan');

  const unknown = await harness.call('GET', DOWNLOAD, {
    params: { id: 'a18d0df6-58b5-4bdc-a518-3a597d5b0000' },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.body.error.code, 'asset_not_found');

  const noSigner = mount();
  const disabled = await noSigner.call('GET', DOWNLOAD, { params: { id: 'a18d0df6-58b5-4bdc-a518-3a597d5b7195' } });
  assert.equal(disabled.statusCode, 503);
  assert.equal(disabled.body.error.code, 'storage_unavailable');
  assert.ok(disabled.body.error.message.includes('storage-enabled'), 'the page can tell the partner what is missing');

  const badId = await noSigner.call('GET', DOWNLOAD, { params: { id: 'not-an-uuid' } });
  assert.equal(badId.statusCode, 400);
});
