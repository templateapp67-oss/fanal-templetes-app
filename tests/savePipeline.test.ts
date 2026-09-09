import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Cover the refactored auto-save & database synchronization flow:
 *   • autoSave: SUCCESS (Local Draft) status, nexora_draft_salon_data cache,
 *     POST /api/website/save fallback, runSalonSavePipeline (client sync →
 *     API → local draft), and duplicate-popup suppression semantics.
 *   • server/websiteSave: the shared POST /api/website/save handler
 *     (validation, mock mode, service-role upserts, error contract).
 *
 * Environment note: the live-mode assertions below need a "real" Supabase
 * configuration. Env vars are set BEFORE the dynamic imports so
 * supabaseClient initializes in live mode for THIS test file only (each test
 * file runs in its own process). The admin client's network calls are stubbed
 * through globalThis.fetch — no real requests ever leave the sandbox.
 */
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test-key';

const {
  DRAFT_STORAGE_KEY,
  LOCAL_DRAFT_STATUS_LABEL,
  getSaveUiState,
  isDataShapeFailure,
  saveViaWebsiteApi,
  runSalonSavePipeline,
  writeLocalDraft,
  clearLocalDraft,
  hasLocalDraft,
  loadLocalDraft,
} = await import('../src/lib/autoSave');
const { syncSalonToSupabase } = await import('../src/lib/salonSync');
const { handleWebsiteSave } = await import('../server/websiteSave');
const { isMockSupabase, getSupabaseAdmin } = await import('../src/lib/supabaseClient');

// ---------------------------------------------------------------------------
// Stubbing helpers
// ---------------------------------------------------------------------------
class MemoryStorage {
  private store = new Map<string, string>();
  quotaLimit = Infinity;
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quotaLimit) {
      throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
    }
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

function useMemoryStorage() {
  const storage = new MemoryStorage();
  (globalThis as any).localStorage = storage;
  return storage;
}

const OWNER_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const PAYLOAD = {
  ownerId: OWNER_ID,
  profile: {
    businessType: 'hair_salon',
    businessName: 'Arts By Uma',
    ownerName: 'Uma',
    phone: '+91 98450 77654',
    email: 'hello@artsbyuma.com',
    subdomain: 'arts-by-uma',
    themePreset: 'slate_silver',
    currency: '₹',
    city: 'Bengaluru',
  },
  services: [
    { id: 'hs-1', name: 'Precision Cut', category: 'Hair', durationMinutes: 45, price: 750, description: 'Cut.', icon: 'scissors', popular: true },
  ],
  stylists: [
    { id: 'hs-st-uma', name: 'Uma', role: 'Founder', avatarUrl: '', specialties: ['Cuts'], rating: 4.9, commissionRate: 35, status: 'Available' },
  ],
  loyaltyConfig: {
    programEnabled: true,
    pointsPerVisit: 10,
    pointsPerHundredSpent: 10,
    tierThresholds: { bronze: 0, silver: 500, gold: 1000, platinum: 2000 },
    tierMultipliers: { bronze: 1, silver: 1.15, gold: 1.3, platinum: 1.5 },
    rewards: [],
  },
};

const okSync = () => Promise.resolve({ ok: true as const, errors: [], blockedByAuth: false });

// Live-mode auth: the handler verifies the caller's Supabase access token
// against /auth/v1/user (service-role apikey) and requires token.user.id to
// equal owner_id. Stubs below answer the auth endpoint with OWNER_ID.
const OWNER_TEST_TOKEN = 'owner-access-token-for-tests';
const OTHER_OWNER_ID = '123e4567-e89b-12d3-a456-426614174000';
const OWNER_AUTH_HEADERS = { authorization: `Bearer ${OWNER_TEST_TOKEN}` };

// ---------------------------------------------------------------------------
// Save status vocabulary — SUCCESS (Local Draft)
// ---------------------------------------------------------------------------
test('the status pill marks a local-draft save as SUCCESS (Local Draft), not an error', () => {
  assert.equal(LOCAL_DRAFT_STATUS_LABEL, 'SUCCESS (Local Draft)');
  assert.deepEqual(getSaveUiState('saved_local'), {
    busy: false,
    failed: false,
    label: 'SUCCESS (Local Draft)',
    savedAtLabel: null,
  });
  // busy override still wins; the pill never reports a failure for drafts.
  assert.equal(getSaveUiState('saved_local', { busyOverride: true }).label, 'Saving…');
  assert.equal(getSaveUiState('saved_local', { busyOverride: true }).failed, false);
  // existing statuses keep their contract.
  assert.equal(getSaveUiState('error').label, 'Save failed');
  assert.equal(getSaveUiState('saved').label, 'All changes saved');
});

// ---------------------------------------------------------------------------
// Local draft cache (nexora_draft_salon_data)
// ---------------------------------------------------------------------------
test('writeLocalDraft caches the envelope under nexora_draft_salon_data', () => {
  const storage = useMemoryStorage();
  const result = writeLocalDraft({ ownerId: OWNER_ID, profile: PAYLOAD.profile, services: PAYLOAD.services, stylists: PAYLOAD.stylists, loyaltyConfig: PAYLOAD.loyaltyConfig });
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(DRAFT_STORAGE_KEY) !== null, true);
  const envelope = loadLocalDraft();
  assert.equal(envelope?.ownerId, OWNER_ID);
  assert.equal(typeof envelope?.savedAt, 'number');
  assert.equal(hasLocalDraft(), true);
  clearLocalDraft();
  assert.equal(hasLocalDraft(), false);
  assert.equal(DRAFT_STORAGE_KEY, 'nexora_draft_salon_data');
});

// ---------------------------------------------------------------------------
// isDataShapeFailure classification
// ---------------------------------------------------------------------------
test('deterministic data errors skip the API fallback; auth/RLS/network do not', () => {
  assert.ok(isDataShapeFailure('invalid input syntax for type uuid: "hs-1"'));
  assert.ok(isDataShapeFailure('duplicate key value violates unique constraint "profiles_subdomain_key"'));
  assert.ok(!isDataShapeFailure('permission denied for table profiles | code: 42501'));
  assert.ok(!isDataShapeFailure('new row violates row-level security policy'));
  assert.ok(!isDataShapeFailure('TypeError: fetch failed'));
  assert.ok(!isDataShapeFailure('JWT expired'));
});

// ---------------------------------------------------------------------------
// saveViaWebsiteApi — POST /api/website/save with exact HTTP diagnostics
// ---------------------------------------------------------------------------
test('saveViaWebsiteApi posts the salonData envelope and reports success', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, timestamp: 123456 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  const result = await saveViaWebsiteApi(PAYLOAD as any, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.timestamp, 123456);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/website/save');
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.salonData.profile.subdomain, 'arts-by-uma');
  assert.equal(body.salonData.ownerId, OWNER_ID);
});

test('saveViaWebsiteApi reports the exact HTTP status on a 500 response', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: 'Failed to persist site state' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })) as any;

  const result = await saveViaWebsiteApi(PAYLOAD as any, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error!, /Failed to persist site state/);
});

test('saveViaWebsiteApi reports network failures without throwing', async () => {
  const fetchImpl = (async () => {
    throw new TypeError('fetch failed');
  }) as any;

  const result = await saveViaWebsiteApi(PAYLOAD as any, { fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error!, /fetch failed/);
});

// ---------------------------------------------------------------------------
// runSalonSavePipeline — the full fallback chain
// ---------------------------------------------------------------------------
test('unauthenticated owners get a clean local draft (SUCCESS (Local Draft)), no cloud calls', async () => {
  const storage = useMemoryStorage();
  let syncCalls = 0;
  let apiCalls = 0;
  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: async () => {
      syncCalls++;
      return { ok: false, errors: ['should never run'] };
    },
    saveViaApi: async () => {
      apiCalls++;
      return { ok: true };
    },
    isMockMode: false,
    authenticated: false,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.target, 'local_draft');
  assert.equal(outcome.draftWritten, true);
  assert.equal(syncCalls, 0, 'no cloud session → no direct sync attempts');
  assert.equal(apiCalls, 0, 'no cloud session → no API fallback attempts');
  assert.ok(storage.getItem(DRAFT_STORAGE_KEY), 'draft must be cached for recovery');
});

test('mock (local/free-tier) sessions fall back to the local draft even when "authenticated"', async () => {
  const storage = useMemoryStorage();
  let syncCalls = 0;
  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: async () => {
      syncCalls++;
      return { ok: false, errors: ['should never run'] };
    },
    isMockMode: true,
    authenticated: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.target, 'local_draft');
  assert.equal(syncCalls, 0);
  assert.ok(storage.getItem(DRAFT_STORAGE_KEY));
});

test('direct client sync success clears any stale draft and reports cloud', async () => {
  const storage = useMemoryStorage();
  writeLocalDraft({ ownerId: OWNER_ID, profile: {}, services: [], stylists: [], loyaltyConfig: {} });
  assert.equal(hasLocalDraft(), true);

  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: okSync,
    isMockMode: false,
    authenticated: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.target, 'cloud');
  assert.equal(outcome.errors.length, 0);
  assert.equal(hasLocalDraft(), false, 'a cloud success must clear the stale draft');
});

test('auth/RLS sync failure automatically falls back to POST /api/website/save', async () => {
  const storage = useMemoryStorage();
  const rlsError = 'new row violates row-level security policy on "stylists" | code: 42501';
  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: async () => ({ ok: false, errors: [`save stylists: ${rlsError}`], blockedByAuth: true }),
    saveViaApi: async () => ({ ok: true, status: 200, timestamp: 1 }),
    isMockMode: false,
    authenticated: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.target, 'api');
  assert.match(outcome.errors.join(' · '), /row-level security/);
});

test('network sync failure + API 500 → changes are cached locally (progress never lost)', async () => {
  const storage = useMemoryStorage();
  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: async () => ({ ok: false, errors: ['save services: TypeError: fetch failed'], blockedByAuth: false }),
    saveViaApi: async () => ({ ok: false, status: 500, error: 'Failed to persist site state' }),
    isMockMode: false,
    authenticated: true,
  });
  assert.equal(outcome.ok, true, 'the owner progress is safe → ok, not a hard failure');
  assert.equal(outcome.target, 'local_draft');
  assert.equal(outcome.draftWritten, true);
  assert.match(outcome.errors.join(' · '), /fetch failed/);
  assert.ok(storage.getItem(DRAFT_STORAGE_KEY));
});

test('deterministic data errors skip the API and go straight to the local draft', async () => {
  const storage = useMemoryStorage();
  let apiCalls = 0;
  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: async () => ({
      ok: false,
      errors: ['save salon profile: invalid input syntax for type uuid: "hs-1" | code: 22P02'],
      blockedByAuth: false,
    }),
    saveViaApi: async () => {
      apiCalls++;
      return { ok: true };
    },
    isMockMode: false,
    authenticated: true,
  });
  assert.equal(apiCalls, 0, 'a uuid/data-shape rejection would fail identically server-side');
  assert.equal(outcome.target, 'local_draft');
  assert.equal(outcome.draftWritten, true);
});

test('the real syncSalonToSupabase result flows through the pipeline (integration)', async () => {
  // A client whose every upsert is blocked by RLS must degrade to the API
  // fallback (stubbed here) instead of throwing or failing silently.
  const rlsBlock = { message: 'permission denied for table profiles', status: 401, code: '42501' };
  const db: any = {
    from() {
      return {
        upsert() {
          return {
            then(_resolve: any, reject: any) {
              reject(Object.assign(new Error(rlsBlock.message), rlsBlock));
              return Promise.resolve();
            },
            catch() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  const outcome = await runSalonSavePipeline({
    payload: PAYLOAD as any,
    sync: (p, o) => syncSalonToSupabase(db, p, o),
    saveViaApi: async () => ({ ok: true, status: 200, timestamp: 1 }),
    isMockMode: false,
    authenticated: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.target, 'api', 'RLS-blocked client sync must retry via the service-role API');
  assert.ok(outcome.errors.length > 0, 'the exact RLS error is preserved for the console');
});

// ---------------------------------------------------------------------------
// POST /api/website/save — shared handler (server/websiteSave.ts)
// ---------------------------------------------------------------------------
class FakeRes {
  statusCode = 200;
  body: any = null;
  headersSent = false;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(payload: any) {
    this.body = payload;
    this.headersSent = true;
    return this;
  }
}

function fakeRes() {
  return new FakeRes() as any;
}

test('/api/website/save rejects missing essential fields (subdomain, owner_id) with a JSON 400', async () => {
  const mockSalons: Record<string, any> = {};
  const handler = handleWebsiteSave({ mockSalons });

  const missingSub = fakeRes();
  await handler({ body: { salonData: { ownerId: OWNER_ID, profile: { businessName: 'X' } } } }, missingSub);
  assert.equal(missingSub.statusCode, 400);
  assert.match(missingSub.body.error, /subdomain/);

  const missingOwner = fakeRes();
  await handler({ body: { salonData: { profile: { subdomain: 'my-salon' } } } }, missingOwner);
  assert.equal(missingOwner.statusCode, 400);
  assert.match(missingOwner.body.error, /owner_id/);

  const badUuid = fakeRes();
  await handler(
    { body: { salonData: { ownerId: 'not-a-uuid', profile: { subdomain: 'my-salon' } } } },
    badUuid
  );
  assert.equal(badUuid.statusCode, 400, 'live mode must reject non-uuid owner ids');
  assert.match(badUuid.body.error, /uuid/);
});

test('live mode: /api/website/save uses one caller-authorized workspace transaction', async () => {
  assert.equal(isMockSupabase, false, 'this test file must run in live mode');
  const admin = getSupabaseAdmin();
  assert.ok(admin, 'the admin (service role) client must exist');

  const fetchCalls: { url: string; init: any }[] = [];
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = (async (url: string, init: any) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).includes('/auth/v1/user')) {
      // Supabase Auth confirms the token belongs to the owner.
      return new Response(JSON.stringify({ id: OWNER_ID, aud: 'authenticated' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;

  try {
    const mockSalons: Record<string, any> = {};
    const handler = handleWebsiteSave({ mockSalons });
    const res = fakeRes();
    await handler({ body: { salonData: PAYLOAD }, headers: OWNER_AUTH_HEADERS }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.timestamp, 'number');

    const writes = fetchCalls.filter(c => c.init?.method === 'POST' && c.url.includes('/rest/v1/'));
    assert.equal(writes.length, 1);
    assert.ok(writes[0].url.endsWith('/rpc/save_owner_editor_state'));
    const headers = new Headers(writes[0].init.headers);
    assert.equal(headers.get('authorization'), `Bearer ${OWNER_TEST_TOKEN}`);
    assert.equal(headers.get('apikey'), 'anon-test-key');
    const payload = JSON.parse(writes[0].init.body);
    assert.deepEqual(payload.p_state.profile, PAYLOAD.profile);
    assert.deepEqual(payload.p_state.services, PAYLOAD.services);
    assert.deepEqual(payload.p_state.stylists, PAYLOAD.stylists);

    // The token verification hit /auth/v1/user with the SERVICE-ROLE apikey
    // (never the anon key), using the caller's own access token.
    const authCalls = fetchCalls.filter((c) => String(c.url).includes('/auth/v1/user'));
    assert.equal(authCalls.length, 1, 'the caller token must be verified exactly once');
    {
      const headers = authCalls[0].init?.headers as any;
      const getHeader = (name: string): string => {
        if (!headers) return '';
        if (typeof headers.get === 'function') return String(headers.get(name) ?? '');
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? String(headers[key]) : '';
      };
      assert.equal(getHeader('apikey'), 'service-role-test-key');
      assert.equal(getHeader('authorization'), `Bearer ${OWNER_TEST_TOKEN}`);
    }

    // Mock registry must NOT be touched in live mode.
    assert.deepEqual(mockSalons, {});
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('live mode: a failed workspace transaction returns retryable failure without success', async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = (async (url: string) => {
    if (String(url).includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: OWNER_ID, aud: 'authenticated' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message: 'permission denied for table profiles', code: '42501' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  try {
    const handler = handleWebsiteSave({ mockSalons: {} });
    const res = fakeRes();
    await handler({ body: { salonData: PAYLOAD }, headers: OWNER_AUTH_HEADERS }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'workspace_save_failed');
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('a bare payload (no salonData wrapper) is accepted', async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = (async (url: string) => {
    if (String(url).includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: OWNER_ID, aud: 'authenticated' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    const handler = handleWebsiteSave({ mockSalons: {} });
    const res = fakeRes();
    await handler({ body: PAYLOAD, headers: OWNER_AUTH_HEADERS }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Live-mode identity binding: the endpoint is the auth boundary (the service
// role bypasses RLS), so the caller must prove they ARE owner_id.
// ---------------------------------------------------------------------------
test('live mode: no access token → 401 Unauthorized, no PostgREST writes', async () => {
  const fetchUrls: string[] = [];
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = (async (url: string) => {
    fetchUrls.push(String(url));
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    const handler = handleWebsiteSave({ mockSalons: {} });
    const res = fakeRes();
    // No Authorization header at all.
    await handler({ body: { salonData: PAYLOAD } }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { success: false, error: 'Unauthorized' });
    assert.ok(!fetchUrls.some((u) => u.includes('/rest/v1/')), 'no write may reach PostgREST');
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('live mode: a DIFFERENT user valid token → 401 (owner_id must match token identity)', async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = (async (url: string) => {
    if (String(url).includes('/auth/v1/user')) {
      // Attacker holds a perfectly valid session — but of ANOTHER owner.
      return new Response(JSON.stringify({ id: OTHER_OWNER_ID, aud: 'authenticated' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    const handler = handleWebsiteSave({ mockSalons: {} });
    const res = fakeRes();
    await handler(
      { body: { salonData: PAYLOAD }, headers: { authorization: 'Bearer someone-elses-valid-token' } },
      res
    );
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { success: false, error: 'Unauthorized' });
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('saveViaWebsiteApi forwards accessToken as Authorization: Bearer <token>', async () => {
  let capturedInit: any = null;
  const fetchImpl = (async (_url: string, init: any) => {
    capturedInit = init;
    return new Response(JSON.stringify({ success: true, timestamp: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;
  await saveViaWebsiteApi(PAYLOAD as any, { fetchImpl, accessToken: 'tok-abc' });
  assert.equal(capturedInit?.headers?.Authorization, 'Bearer tok-abc');
});

test('saveViaWebsiteApi without accessToken sends no Authorization header', async () => {
  let capturedInit: any = null;
  const fetchImpl = (async (_url: string, init: any) => {
    capturedInit = init;
    return new Response(JSON.stringify({ success: true, timestamp: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;
  await saveViaWebsiteApi(PAYLOAD as any, { fetchImpl });
  assert.equal(capturedInit?.headers?.Authorization, undefined);
});

test('the pipeline forwards the owner token to the default API fallback', async () => {
  useMemoryStorage();
  const captured: Array<{ url: string; headers: any }> = [];
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = (async (url: string, init: any) => {
    captured.push({ url: String(url), headers: init?.headers });
    return new Response(JSON.stringify({ success: true, timestamp: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;
  try {
    const outcome = await runSalonSavePipeline({
      payload: PAYLOAD as any,
      // Direct sync blocked by RLS → the pipeline must use the default
      // saveViaWebsiteApi (global fetch) with the owner's token attached.
      sync: async () => ({
        ok: false,
        errors: ['permission denied for table profiles (42501)'],
        blockedByAuth: true,
      }),
      isMockMode: false,
      authenticated: true,
      accessToken: 'pipeline-owner-token',
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.target, 'api');
    const saveCall = captured.find((c) => c.url.includes('/api/website/save'));
    assert.ok(saveCall, 'the fallback must hit POST /api/website/save');
    assert.equal(saveCall.headers?.Authorization, 'Bearer pipeline-owner-token');
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});
