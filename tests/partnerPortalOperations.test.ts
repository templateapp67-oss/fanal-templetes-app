// ============================================================================
// Partner portal OPERATIONS data layer (src/lib/partnerPortalOperations.ts).
//
// The promoted sidebar sections all read through this module, so its contract is
// tested here rather than page by page:
//
//   • TRANSPORT PRIORITY — `/api/partner/*` is tried first; when the deploy has
//     no proxy route (404/405/501/502/503, a non-JSON body, a dead socket) the
//     call falls back to the PostgREST RPC. A JSON error body is NEVER retried:
//     a refusal from the database must reach the partner, not be hidden behind a
//     second attempt.
//   • BOUNDING — limits/offsets are clamped to what the SQL functions accept.
//   • NORMALIZATION — a partial or oddly-typed jsonb payload becomes zeros and
//     empty lists, never NaN/undefined/throw. The pages render straight from
//     these shapes.
//   • ERROR TRANSLATION — the codes the portal can actually do something about
//     (schema not applied → name the migrations; not a partner → say so; a
//     constraint refusal → keep the SQL function's own user-facing sentence).
//
// No Supabase project and no Express server are needed: supabase-js and the
// proxy both speak `fetch`, and the fake below answers both surfaces.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  PARTNER_MINIMUM_PAYOUT_PAISE,
  PARTNER_SCHEMA_HINT,
  cancelPartnerPayoutRequest,
  getPartnerAssetDownloadUrl,
  getPartnerEarnings,
  getPartnerLeaderboard,
  getPartnerLevels,
  getPartnerMarketingAssetCategories,
  getPartnerMarketingAssets,
  getPartnerNotificationPreferences,
  getPartnerNotifications,
  getPartnerPayoutRequests,
  getPartnerSupportTickets,
  markPartnerNotificationsRead,
  normalizeEarnings,
  normalizeLeaderboard,
  normalizeLevels,
  normalizeNotificationPreferences,
  normalizeNotifications,
  normalizePayoutRequests,
  normalizeSupportTickets,
  partnerOperationError,
  requestPartnerPayout,
  submitPartnerSupportTicket,
  updatePartnerNotificationPreferences,
} from '../src/lib/partnerPortalOperations';

interface RecordedCall {
  url: string;
  method: string;
  body: any;
  authorization: string;
}

/**
 * Install a fake network. `routes` maps a matcher to a reply; anything the test
 * did not describe is a hard failure (400 + recorded), so an unexpected second
 * call can never hide inside a passing assertion.
 */
function withFetch(
  routes: Array<{ matches: (url: string) => boolean; status?: number; json?: any; raw?: string; throwNetwork?: boolean }>,
  run: (calls: RecordedCall[]) => Promise<void>
): Promise<void> {
  const calls: RecordedCall[] = [];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    const authorization = String(init?.headers?.authorization || init?.headers?.Authorization || '');
    calls.push({ url, method, body, authorization });
    const route = routes.find((entry) => entry.matches(url));
    if (!route) {
      return new Response(JSON.stringify({ message: `unexpected request: ${method} ${url}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (route.throwNetwork) throw new TypeError('fetch failed');
    if (route.raw !== undefined) {
      return new Response(route.raw, { status: route.status ?? 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response(JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return run(calls).finally(() => {
    (globalThis as any).fetch = realFetch;
  });
}

/** A PostgREST reply for one RPC (the fallback transport). */
const rpc = (name: string, json: any, status = 200) => ({
  matches: (url: string) => url.includes(`/rest/v1/rpc/${name}`),
  status,
  json,
});
/** A reply from this app's own API (the preferred transport). */
const api = (path: string, json: any, status = 200) => ({
  matches: (url: string) => url.includes(path),
  status,
  json,
});
const proxyAbsent = { matches: (url: string) => url.includes('/api/partner/'), status: 404, json: { error: { code: 'no_route' } } };

const EARNINGS_JSON = {
  currency: 'INR',
  totals: { lifetime_paise: 200000, pending_paise: 75000, available_paise: 125000 },
  transactions: [
    {
      id: 'e1',
      earning_type: 'recurring_subscription_commission',
      status: 'available_for_withdrawal',
      amount_paise: 125000,
      commission_bps: 1500,
      earned_at: '2026-09-01T10:00:00Z',
      available_at: '2026-09-08T10:00:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. Transport: API first, RPC as the standing fallback
// ---------------------------------------------------------------------------

test('a section read prefers this app’s API and does not double-call the RPC', () =>
  withFetch([api('/api/partner/earnings', { data: EARNINGS_JSON })], async (calls) => {
    const data = await getPartnerEarnings({ limit: 10, offset: 0 });
    assert.equal(data.totals.available_paise, 125000);
    assert.equal(data.transactions[0].commission_bps, 1500);
    assert.equal(calls.length, 1, 'exactly one request went out');
    assert.match(calls[0].url, /\/api\/partner\/earnings\?limit=10&offset=0$/);
    assert.equal(calls[0].method, 'GET');
  }));

test('a deploy without the proxy route falls back to the PostgREST RPC', () =>
  withFetch([proxyAbsent, rpc('get_my_partner_earnings', EARNINGS_JSON)], async (calls) => {
    const data = await getPartnerEarnings({ limit: 25, offset: 10 });
    assert.equal(data.currency, 'INR');
    assert.equal(data.transactions.length, 1);
    assert.match(calls[0].url, /\/api\/partner\/earnings/);
    const fallback = calls[1];
    assert.match(fallback.url, /\/rest\/v1\/rpc\/get_my_partner_earnings/);
    assert.deepEqual(fallback.body, { p_limit: 25, p_offset: 10 }, 'the RPC receives the named args');
  }));

test('a dead socket, an HTML body and a 503 all fall back; a JSON error never does', async () => {
  // Network error → fallback.
  await withFetch([{ matches: (u) => u.includes('/api/partner/'), throwNetwork: true }, rpc('get_my_partner_levels', { active_referrals: 3, levels: [] })], async (calls) => {
    const levels = await getPartnerLevels();
    assert.equal(levels.active_referrals, 3);
    assert.equal(calls.length, 2);
  });
  // Vite/HTML dev fallback (not JSON) → fallback.
  await withFetch([{ matches: (u) => u.includes('/api/partner/'), raw: '<!doctype html>' }, rpc('get_partner_leaderboard', { items: [], my_rank: null })], async () => {
    const board = await getPartnerLeaderboard();
    assert.deepEqual(board.items, []);
  });
  // No live Supabase project → 503 → fallback.
  await withFetch([{ matches: (u) => u.includes('/api/partner/'), status: 503, json: { error: { code: 'backend_unavailable', message: 'no project' } } }, rpc('get_partner_marketing_asset_categories', [])], async () => {
    assert.deepEqual(await getPartnerMarketingAssetCategories(), []);
  });
  // A real refusal (JSON body) is surfaced, not retried against the other transport.
  await withFetch(
    [{ matches: (u) => u.includes('/api/partner/'), status: 400, json: { error: { code: 'invalid_request', message: 'Minimum withdrawal is ₹500' } } }, rpc('request_my_partner_payout', {}) ],
    async (calls) => {
      await assert.rejects(
        () => requestPartnerPayout(100, 'upi', 'partner@okbank'),
        (error: any) => error.code === 'validation' && /₹500/.test(error.message)
      );
      assert.equal(calls.length, 1, 'the refusal is not replayed against the RPC');
    }
  );
});

test('the caller’s session token rides along on the proxy request', () =>
  withFetch([api('/api/partner/levels', { data: { active_referrals: 0, levels: [] } })], async (calls) => {
    await getPartnerLevels();
    // No signed-in session in tests → no Authorization header is invented.
    assert.equal(calls[0].authorization, '', 'an anonymous caller sends no fake bearer');
  }));

// ---------------------------------------------------------------------------
// 2. Input bounding + call shapes for every promoted operation
// ---------------------------------------------------------------------------

test('limits and offsets are clamped to the ranges the SQL functions accept', () =>
  withFetch(
    [
      proxyAbsent,
      rpc('get_my_partner_earnings', EARNINGS_JSON),
      rpc('get_partner_leaderboard', { items: [], my_rank: null }),
      rpc('get_my_partner_notifications', { unread_count: 0, items: [] }),
      rpc('get_my_partner_payout_requests', { total: 0, open_amount_paise: 0, items: [] }),
    ],
    async (calls) => {
      await getPartnerEarnings({ limit: 5000, offset: -20 });
      await getPartnerLeaderboard({ limit: 0 });
      await getPartnerNotifications('all');
      await getPartnerPayoutRequests({ limit: 9999 });
      const sent = calls.filter((call) => call.url.includes('/rest/v1/rpc/')).map((call) => call.body);
      assert.equal(sent.length, 4, 'every operation tried the proxy first, then answered once');
      assert.deepEqual(sent[0], { p_limit: 200, p_offset: 0 }, 'earnings cap at 200 rows, never a negative offset');
      assert.deepEqual(sent[1], { p_limit: 25 }, 'a zero limit falls back to the default window');
      assert.deepEqual(sent[2], { p_type: null, p_limit: 50 }, '“all” is no filter, not the string all');
      assert.deepEqual(sent[3], { p_limit: 100, p_offset: 0 }, 'payout requests cap at 100');
    }
  ));

test('writes carry the exact named args the RPCs declare', () =>
  withFetch(
    [
      proxyAbsent,
      rpc('request_my_partner_payout', { id: 'p1', status: 'pending', amount_paise: 60000 }),
      rpc('cancel_my_partner_payout_request', { id: 'p1', status: 'cancelled' }),
      rpc('mark_my_partner_notifications_read', 2),
      rpc('update_my_partner_notification_preferences', { email_enabled: false, in_app_enabled: true, updated_at: '2026-09-11T10:00:00Z' }),
      rpc('submit_my_partner_support_ticket', { id: 't1', ticket_number: 41, status: 'open', created_at: '2026-09-11T10:00:00Z' }),
    ],
    async (calls) => {
      const created = await requestPartnerPayout(60000, 'upi', 'partner@okbank');
      assert.equal(created.status, 'pending');
      assert.equal(created.amount_paise, 60000);
      await cancelPartnerPayoutRequest('9f1a9d7a-1111-4bq0-9d3f-000000000001');
      const marked = await markPartnerNotificationsRead();
      assert.equal(marked, 2, 'the row count the function returns is what the page needs');
      await markPartnerNotificationsRead(['id-1', '  ', 'id-2']);
      const savedPrefs = await updatePartnerNotificationPreferences({ email_enabled: false, in_app_enabled: true });
      assert.equal(savedPrefs.email_enabled, false);
      const receipt = await submitPartnerSupportTicket('Payout refused', 'My request was refused although the balance is available.', 'high');
      assert.equal(receipt.ticket_number, 41);

      const sent = calls.filter((call) => call.url.includes('/rest/v1/rpc/')).map((call) => call.body);
      assert.deepEqual(sent[0], { p_amount_paise: 60000, p_method: 'upi', p_destination_label: 'partner@okbank' });
      assert.deepEqual(sent[1], { p_request_id: '9f1a9d7a-1111-4bq0-9d3f-000000000001' });
      assert.deepEqual(sent[2], { p_ids: null }, 'no ids means “all of them”');
      assert.deepEqual(sent[3], { p_ids: ['id-1', 'id-2'] }, 'blank ids are dropped');
      assert.deepEqual(sent[4], { p_email_enabled: false, p_in_app_enabled: true });
      assert.deepEqual(sent[5], { p_subject: 'Payout refused', p_message: 'My request was refused although the balance is available.', p_priority: 'high' });
    }
  ));

test('the payout floor the form validates against is the constraint the SQL enforces', () => {
  assert.equal(PARTNER_MINIMUM_PAYOUT_PAISE, 50000);
  const migration = readFileSync('supabase/migrations/20260918035349_partner_portal_operations.sql', 'utf8');
  assert.match(migration, /amount_paise bigint not null check \(amount_paise >= 50000\)/);
  assert.match(migration, /p_amount_paise < 50000 then raise exception 'Minimum withdrawal is ₹500'/);
});

test('marketing asset downloads go through the signing route, not the RPC fallback', () =>
  withFetch([api('/api/partner/marketing-assets/asset-1/download', { data: { signed_url: 'https://storage/signed?token=xyz', expires_in_seconds: 60 } })], async (calls) => {
    const url = await getPartnerAssetDownloadUrl('asset-1');
    assert.equal(url, 'https://storage/signed?token=xyz');
    assert.match(calls[0].url, /\/api\/partner\/marketing-assets\/asset-1\/download$/);
  }));

test('a storage-less deploy says so plainly instead of falling back to a broken link', () =>
  withFetch(
    [{ matches: (u) => u.includes('/api/partner/marketing-assets'), status: 503, json: { error: { code: 'storage_unavailable', message: 'Asset downloads need a storage-enabled Supabase connection.' } } }],
    async () => {
      await assert.rejects(
        () => getPartnerAssetDownloadUrl('a18d0df6-58b5-4bdc-a518-3a597d5b7195'),
        (error: any) => error.code === 'unavailable' && /storage-enabled/.test(error.message)
      );
    }
  ));

// ---------------------------------------------------------------------------
// 3. Normalization — a jsonb payload is untrusted input
// ---------------------------------------------------------------------------

test('partial or malformed payloads never produce NaN, undefined or a throw', () => {
  assert.deepEqual(normalizeEarnings(null), {
    currency: 'INR',
    totals: { lifetime_paise: 0, pending_paise: 0, cleared_paise: 0, available_paise: 0 },
    transactions: [],
  });
  // A project one migration behind answers three keys, not four: the gross
  // cleared figure falls back to the net one instead of printing ₹0, and a
  // negative available (an adjustment larger than the wallet) clamps to zero.
  const older = normalizeEarnings({ totals: { lifetime_paise: 10, pending_paise: 0, available_paise: 125000 } });
  assert.equal(older.totals.cleared_paise, 125000);
  assert.equal(normalizeEarnings({ totals: { available_paise: -500 } }).totals.available_paise, 0);
  const earnings = normalizeEarnings({
    totals: { lifetime_paise: '75000', available_paise: null },
    transactions: { not: 'an array' },
  });
  assert.equal(earnings.totals.lifetime_paise, 75000, 'numeric strings are accepted');
  assert.equal(earnings.totals.available_paise, 0);
  assert.deepEqual(earnings.transactions, [], 'a non-array never becomes a length property');

  const row = normalizeEarnings({ transactions: [{ id: 'x' }] }).transactions[0];
  assert.equal(row.status, 'pending', 'a row without a status is still renderable');
  assert.equal(row.amount_paise, 0);
  assert.equal(row.available_at, null);

  assert.deepEqual(normalizePayoutRequests({ items: [{}] }).items[0].status, 'pending');
  assert.deepEqual(normalizeLevels({ levels: [null] }).levels[0].perks, []);
  assert.equal(normalizeLeaderboard({ items: [], my_rank: undefined }).my_rank, null);
  assert.equal(normalizeLeaderboard({ items: [], my_rank: '7' }).my_rank, 7);
  assert.equal(normalizeNotifications({ items: [{}] }).items[0].notification_type, 'system');
  assert.deepEqual(normalizeSupportTickets({}), []);
  // Missing preference row → the table's own defaults, not "off".
  assert.deepEqual(normalizeNotificationPreferences(null), { email_enabled: true, in_app_enabled: true, updated_at: null });
  assert.equal(normalizeNotificationPreferences({ email_enabled: 'false', in_app_enabled: true }).email_enabled, false);
});

// ---------------------------------------------------------------------------
// 4. Error translation
// ---------------------------------------------------------------------------

test('a missing function names the two migrations that fix it', () => {
  const error = partnerOperationError('get_my_partner_earnings', { code: 'PGRST202', message: 'Could not find the function' });
  assert.equal(error.code, 'schema_not_applied');
  assert.equal(error.retryable, false);
  assert.equal(error.message, PARTNER_SCHEMA_HINT);
  assert.match(PARTNER_SCHEMA_HINT, /20260918035349_partner_portal_operations\.sql/);
  assert.match(PARTNER_SCHEMA_HINT, /20260919120000_partner_portal_section_reads\.sql/);
});

test('the codes the portal can act on are told apart from a generic failure', () => {
  assert.equal(partnerOperationError('x', { code: '42501', message: 'Active Growth Partner required' }).code, 'partner_only');
  assert.equal(partnerOperationError('x', { message: 'JWT expired' }).code, 'unauthorized');
  assert.equal(partnerOperationError('x', { code: '22023', message: 'Withdrawal exceeds available balance' }).code, 'validation');
  assert.equal(partnerOperationError('x', { status: 504, message: 'gateway timeout' }).code, 'unavailable');
  // The one-open-request rule comes from a UNIQUE index, so it arrives as raw
  // Postgres text — the partner has to be told what to do, not shown a name.
  const already = partnerOperationError('request_my_partner_payout', {
    code: '23505',
    message: 'duplicate key value violates unique constraint "partner_payout_requests_one_open_per_partner"',
  });
  assert.equal(already.code, 'validation');
  assert.doesNotMatch(already.message, /partner_payout_requests_one_open/, 'the constraint name never reaches the screen');
  assert.match(already.message, /already have a payout request open/i);
  const unknown = partnerOperationError('get_my_partner_levels', { message: 'something odd' });
  assert.equal(unknown.code, 'unknown');
  assert.match(unknown.message, /something odd/);
});

test('no portal operation can name another partner: no id parameter exists anywhere', () => {
  for (const file of ['src/lib/partnerPortalOperations.ts', 'server/partnerPortalRoutes.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /p_partner_id|partner_id:\s*p|p_user_id/, `${file} must not accept a partner/user id`);
  }
});
