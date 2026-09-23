// ============================================================================
// Growth Partner service facade — the contract.
//
// Three promises the whole portal now depends on, pinned one at a time:
//
//   1. IDENTITY COMES FROM THE SESSION. No function takes a partner/user id,
//      the compiled module mentions none, and no request body carries one.
//   2. MONEY IS PAISE. Whole integers, `₹1 = 100`, formatted only for display.
//   3. NEVER A FAKE ZERO. `{ ok: false }` means the value is UNKNOWN. A missing
//      or malformed money/count field is an error — never ₹0.00, never "0
//      referrals" — while a genuinely empty answer stays `{ ok: true }`.
//
// The 4th: every failure is classified by the same classifier the screens use,
// so an `ok: false` from here can be handed straight to the failure panel.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GrowthPartnerServiceError,
  PAISE_PER_RUPEE,
  growthPartnerService,
  isServiceFailure,
  isServiceSuccess,
  isWholePaise,
  paiseToRupees,
  rupeesToPaise,
  unwrapPartnerResult,
} from '../src/services/growthPartner';

// ---------------------------------------------------------------------------
// Fixtures: the exact shapes the audited RPCs answer with.
// ---------------------------------------------------------------------------

const EARNINGS = {
  currency: 'INR',
  totals: { lifetime_paise: 200_000, pending_paise: 75_000, cleared_paise: 125_000, available_paise: 125_000 },
  transactions: [
    {
      id: 'e1',
      earning_type: 'recurring_subscription_commission',
      status: 'available_for_withdrawal',
      amount_paise: 125_000,
      commission_bps: 1500,
      earned_at: '2026-09-01T10:00:00Z',
      payment_cleared_at: '2026-09-01T10:00:00Z',
      available_at: '2026-09-08T10:00:00Z',
      paid_at: null,
    },
  ],
};

const PAYOUTS = {
  total: 1,
  open_amount_paise: 60_000,
  items: [
    {
      id: 'p1',
      amount_paise: 60_000,
      payout_method: 'upi',
      destination_label: 'partner@okbank',
      status: 'pending',
      requested_at: '2026-09-11T09:00:00Z',
      reviewed_at: null,
      paid_at: null,
      rejection_reason: null,
      provider_reference: null,
    },
  ],
};

/** Answer every PostgREST call with one RPC's payload (the API proxy 404s). */
function stubRpc(replies: Record<string, unknown>, options: { rpcStatus?: number; rpcError?: unknown } = {}) {
  const original = (globalThis as any).fetch;
  const calls: Array<{ url: string; body: any }> = [];
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes('/api/partner/')) {
      return new Response(JSON.stringify({ error: { code: 'no_route', message: 'no proxy here' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const fn = url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/)?.[1] ?? '';
    if (options.rpcError && fn in replies) {
      return new Response(JSON.stringify(options.rpcError), {
        status: options.rpcStatus ?? 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (!(fn in replies)) {
      return new Response(JSON.stringify({ message: `unstubbed rpc: ${fn}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(replies[fn]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => ((globalThis as any).fetch = original) };
}

// ---------------------------------------------------------------------------
// 1. Identity comes from the session
// ---------------------------------------------------------------------------

test('no function takes a partner id, and no request body can carry one', async () => {
  // a. Arity: every exported service function takes at most ONE argument — an
  //    options object or a value about the caller's OWN record. There is no
  //    second parameter anywhere for a partner/user id to live in.
  const serviceFunctions = Object.entries(growthPartnerService).filter(([, value]) => typeof value === 'function');
  assert.ok(serviceFunctions.length >= 20, 'the facade exposes the whole portal surface');
  // Content parameters are fine (a support ticket has a subject, a message and a
  // priority). An IDENTITY parameter is not: the only way a function may take
  // more than the caller's own single input is by taking content to publish.
  const CONTENT_PARAMS: Record<string, number> = { submitSupportTicket: 3 };
  for (const [name, fn] of serviceFunctions) {
    const allowed = CONTENT_PARAMS[name] ?? 1;
    assert.ok((fn as Function).length <= allowed, `${name}() must not accept an id/identity argument`);
  }

  // b. No parameter is named after a partner/user identity, anywhere.
  const source = readFileSync(new URL('../src/services/growthPartner.ts', import.meta.url), 'utf8');
  for (const forbidden of ['(partnerId', '(userId', ', partnerId', ', userId', 'p_partner_id', 'p_user_id']) {
    assert.ok(!source.includes(forbidden), `no function may take an identity input: ${forbidden}`);
  }
  // `referralId`/`assetId`/`requestId` ARE legitimate: they name a record the
  // caller already owns, and the backend re-checks ownership from the JWT.

  // c. Behaviour: the arguments actually sent to the backend are the caller's
  //    own page window — nothing that names an account.
  const network = stubRpc({ get_my_partner_earnings: EARNINGS, get_my_partner_payout_requests: PAYOUTS });
  try {
    await growthPartnerService.getEarnings({ limit: 10, offset: 20 });
    await growthPartnerService.getPayoutRequests({ limit: 5, offset: 0 });
    const rpcCalls = network.calls.filter((call) => call.url.includes('/rest/v1/rpc/'));
    assert.ok(rpcCalls.length >= 2, 'both reads reached the RPC layer');
    for (const call of rpcCalls) {
      assert.deepEqual(Object.keys(call.body).sort(), ['p_limit', 'p_offset'], 'only the page window is sent');
    }
  } finally {
    network.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. Money is paise
// ---------------------------------------------------------------------------

test('earnings arrive as whole paise and are never re-derived', async () => {
  const network = stubRpc({ get_my_partner_earnings: EARNINGS });
  try {
    const result = await growthPartnerService.getEarnings({ limit: 10, offset: 0 });
    assert.equal(isServiceSuccess(result), true);
    if (isServiceFailure(result)) return;
    assert.deepEqual(result.data.totals, {
      lifetime_paise: 200_000,
      pending_paise: 75_000,
      cleared_paise: 125_000,
      available_paise: 125_000,
    });
    assert.equal(result.data.currency, 'INR');
    assert.equal(result.data.transactions[0].amount_paise, 125_000);
    assert.equal(result.data.transactions[0].commission_bps, 1500);
    for (const value of Object.values(result.data.totals)) {
      assert.ok(Number.isInteger(value), 'every total is an integer number of paise');
    }
  } finally {
    network.restore();
  }
});

test('the rupee/paise boundary is explicit and exact', () => {
  assert.equal(PAISE_PER_RUPEE, 100);
  assert.equal(rupeesToPaise(1250), 125_000);
  assert.equal(rupeesToPaise(499.99), 49_999);
  assert.equal(paiseToRupees(125_000), 1250);
  assert.equal(paiseToRupees(49_999), 499.99);
  assert.equal(isWholePaise(50_000), true);
  assert.equal(isWholePaise(50_000.5), false, 'half a paise is not money this app can move');
  assert.equal(isWholePaise(-1), false);
  assert.equal(isWholePaise(Number.NaN), false);
  assert.equal(isWholePaise('50000'), false, 'a string is not a paise amount');
});

// ---------------------------------------------------------------------------
// 3. Never a fake zero
// ---------------------------------------------------------------------------

test('a missing money total is an error, never ₹0', async () => {
  const network = stubRpc({
    get_my_partner_earnings: { currency: 'INR', totals: { lifetime_paise: 200_000, pending_paise: 75_000 }, transactions: [] },
  });
  try {
    const result = await growthPartnerService.getEarnings();
    assert.equal(isServiceFailure(result), true, 'the absent available_paise must not become 0');
    if (isServiceSuccess(result)) return;
    assert.equal(result.error.kind, 'contract-mismatch');
    assert.equal(result.error.owner, 'administrator');
    assert.equal(result.error.retryable, false);
    assert.match(result.error.message, /unexpected shape/i);
    assert.match(result.error.message, /Nothing was guessed or defaulted/i);
  } finally {
    network.restore();
  }
});

test('a fractional or negative paise value is refused instead of rounded into a figure', async () => {
  const broken: Array<{ field: string; totals: Record<string, unknown> }> = [
    { field: 'totals.available_paise', totals: { lifetime_paise: 200_000, pending_paise: 75_000, cleared_paise: 125_000, available_paise: 125_000.5 } },
    { field: 'totals.available_paise', totals: { lifetime_paise: 200_000, pending_paise: 75_000, cleared_paise: 125_000, available_paise: -100 } },
    { field: 'totals.lifetime_paise', totals: { lifetime_paise: '200000', pending_paise: 75_000, cleared_paise: 125_000, available_paise: 125_000 } },
    { field: 'totals.pending_paise', totals: { lifetime_paise: 200_000, pending_paise: null, cleared_paise: 125_000, available_paise: 125_000 } },
  ];
  for (const { field, totals } of broken) {
    const network = stubRpc({ get_my_partner_earnings: { currency: 'INR', totals, transactions: [] } });
    try {
      const result = await growthPartnerService.getEarnings();
      assert.equal(isServiceFailure(result), true, `refused: ${JSON.stringify(totals)}`);
      if (isServiceSuccess(result)) continue;
      assert.equal(result.error.kind, 'contract-mismatch');
      // The report names OUR contract field — the one a fixer must look at.
      assert.equal(result.error.safeDetail, `unexpected shape (field "${field}")`);
      assert.match(result.error.message, /answered in an unexpected shape/);
      // The next step lives on the classified failure (what the panel renders).
      assert.match(result.error.failure.nextStep, /administrator/i);
      assert.match(result.error.failure.label, /Unexpected response shape/);
    } finally {
      network.restore();
    }
  }
});

test('a count that is not a number can never print as "0 referrals"', async () => {
  const network = stubRpc({
    get_my_partner_payout_requests: { total: 'one', open_amount_paise: 60_000, items: [] },
  });
  try {
    const result = await growthPartnerService.getPayoutRequests();
    assert.equal(isServiceFailure(result), true);
    if (isServiceSuccess(result)) return;
    assert.match(result.error.safeDetail ?? '', /field "total"/);
  } finally {
    network.restore();
  }
});

test('an empty page is a success with real zeros — a different answer from a failure', async () => {
  const network = stubRpc({
    get_my_partner_earnings: {
      currency: 'INR',
      totals: { lifetime_paise: 0, pending_paise: 0, cleared_paise: 0, available_paise: 0 },
      transactions: [],
    },
  });
  try {
    const result = await growthPartnerService.getEarnings();
    assert.equal(isServiceSuccess(result), true, 'nothing earned yet is a valid answer, not an error');
    if (isServiceFailure(result)) return;
    assert.equal(result.data.totals.lifetime_paise, 0);
    assert.deepEqual(result.data.transactions, []);
  } finally {
    network.restore();
  }
});

test('the one documented fallback is derived from a validated field, never from zero', async () => {
  // A project one migration behind answers the older three keys: `cleared_paise`
  // is absent while `available_paise` is a real figure. Mirroring it is correct;
  // inventing 0 next to a wallet of ₹1,250 would not be.
  const network = stubRpc({
    get_my_partner_earnings: {
      currency: 'INR',
      totals: { lifetime_paise: 200_000, pending_paise: 75_000, available_paise: 125_000 },
      transactions: [],
    },
  });
  try {
    const result = await growthPartnerService.getEarnings();
    assert.equal(isServiceSuccess(result), true);
    if (isServiceFailure(result)) return;
    assert.equal(result.data.totals.cleared_paise, 125_000, 'the cleared line is not a fake ₹0');
  } finally {
    network.restore();
  }
});

test('with the real endpoint gone the failure is a result, not a rejected promise', async () => {
  // `/api/partner/*` 404s in this stub and every RPC is unstubbed → the service
  // must still resolve with `{ ok: false }` rather than throwing at the caller.
  const network = stubRpc({});
  try {
    const result = await growthPartnerService.getLevels();
    assert.equal(isServiceFailure(result), true);
    if (isServiceSuccess(result)) return;
    assert.equal(result.error.name, 'GrowthPartnerServiceError');
    assert.ok(result.error.failure.kind, 'the cause is classified');
  } finally {
    network.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Classification + zero-value safety for the mutations
// ---------------------------------------------------------------------------

test('a missing migration is classified as a setup problem, not a retry', async () => {
  const network = stubRpc(
    { get_my_partner_earnings: EARNINGS },
    {
      rpcError: {
        code: 'PGRST202',
        message: 'Could not find the function public.get_my_partner_earnings(p_limit, p_offset) in the schema cache',
      },
      rpcStatus: 404,
    }
  );
  try {
    const result = await growthPartnerService.getEarnings();
    assert.equal(isServiceFailure(result), true);
    if (isServiceSuccess(result)) return;
    assert.equal(result.error.kind, 'schema-missing');
    assert.equal(result.error.owner, 'administrator');
    assert.equal(result.error.retryable, false);
    assert.match(result.error.message, /migrations/i);
    assert.doesNotMatch(result.error.message, /try again/i);
  } finally {
    network.restore();
  }
});

test('the ledger\'s own refusal reaches the partner verbatim and stays retryable=false', async () => {
  const network = stubRpc(
    { request_my_partner_payout: {} },
    { rpcError: { code: '22023', message: 'Minimum withdrawal is ₹500' }, rpcStatus: 400 }
  );
  try {
    const result = await growthPartnerService.requestPayout({
      amountPaise: 50_000,
      payoutMethod: 'upi',
      destinationLabel: 'partner@okbank',
    });
    assert.equal(isServiceFailure(result), true);
    if (isServiceSuccess(result)) return;
    assert.equal(result.error.kind, 'input-invalid');
    assert.equal(result.error.message, 'Minimum withdrawal is ₹500');
  } finally {
    network.restore();
  }
});

test('a bad amount is refused locally as paise — before any request is sent', async () => {
  const network = stubRpc({});
  try {
    for (const amountPaise of [0, -500, 1250.5, Number.NaN]) {
      const result = await growthPartnerService.requestPayout({
        amountPaise,
        payoutMethod: 'upi',
        destinationLabel: 'partner@okbank',
      });
      assert.equal(isServiceFailure(result), true, `${amountPaise} must be refused`);
      if (isServiceSuccess(result)) continue;
      assert.equal(result.error.kind, 'input-invalid');
      assert.equal(result.error.scope, 'unclear');
      assert.match(result.error.message, /paise/i);
    }
    assert.equal(network.calls.length, 0, 'nothing was sent to the backend');
  } finally {
    network.restore();
  }
});

test('a payout receipt must carry the paise the ledger recorded', async () => {
  const network = stubRpc({ request_my_partner_payout: { id: 'p9', status: 'pending' } });
  try {
    const result = await growthPartnerService.requestPayout({
      amountPaise: 100_000,
      payoutMethod: 'upi',
      destinationLabel: 'partner@okbank',
    });
    assert.equal(isServiceFailure(result), true, 'a receipt without amount_paise is not a silent 0');
    if (isServiceSuccess(result)) return;
    assert.match(result.error.safeDetail ?? '', /field "amount_paise"/);
  } finally {
    network.restore();
  }
});

test('a support ticket without a ticket number is an error, not ticket #0', async () => {
  const network = stubRpc({ submit_my_partner_support_ticket: { id: 't2', status: 'open', created_at: '2026-09-12T11:00:00Z' } });
  try {
    const result = await growthPartnerService.submitSupportTicket('Payout refused', 'My ₹1,200 request was refused on 12 September.', 'high');
    assert.equal(isServiceFailure(result), true);
    if (isServiceSuccess(result)) return;
    assert.match(result.error.safeDetail ?? '', /field "ticket_number"/);
  } finally {
    network.restore();
  }
});

test('form validation is the citizen’s own problem, and says so without a request', async () => {
  const network = stubRpc({});
  try {
    const shortSubject = await growthPartnerService.submitSupportTicket('no', 'A perfectly fine description of the issue.', 'normal');
    const shortMessage = await growthPartnerService.submitSupportTicket('Payout refused', 'too short', 'normal');
    const badLabel = await growthPartnerService.requestPayout({ amountPaise: 100_000, payoutMethod: 'upi', destinationLabel: 'x' });
    const badPrefs = await growthPartnerService.updateNotificationPreferences({ email_enabled: 'yes' } as any);
    // Mixed result types on purpose: only the failure shape matters here, so each
    // is checked as an `unknown`-typed value rather than narrowed to one payload.
    for (const result of [shortSubject, shortMessage, badLabel, badPrefs] as Array<{ ok: boolean; error?: GrowthPartnerServiceError }>) {
      assert.equal(result.ok, false);
      assert.equal(result.error?.kind, 'input-invalid');
      assert.equal(result.error?.owner, 'you');
    }
    assert.equal(network.calls.length, 0);
  } finally {
    network.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. Result plumbing
// ---------------------------------------------------------------------------

test('unwrapPartnerResult rethrows the classified error for throw-based flows', async () => {
  const network = stubRpc({ get_my_partner_levels: { active_referrals: 7, levels: [] } });
  try {
    const ok = await growthPartnerService.getLevels();
    assert.equal(unwrapPartnerResult(ok).active_referrals, 7);
  } finally {
    network.restore();
  }

  const failing = stubRpc(
    { get_my_partner_levels: { active_referrals: 0, levels: [] } },
    { rpcError: { code: '42501', message: 'permission denied for function get_my_partner_levels' }, rpcStatus: 400 }
  );
  try {
    const result = await growthPartnerService.getLevels();
    assert.equal(isServiceFailure(result), true);
    assert.throws(
      () => unwrapPartnerResult(result),
      (error: unknown) => {
        assert.ok(error instanceof GrowthPartnerServiceError);
        // 42501 from these RPCs means "no active partner record for this caller",
        // which the operations layer classifies as partner_only.
        assert.equal((error as GrowthPartnerServiceError).kind, 'not-a-partner');
        assert.equal((error as GrowthPartnerServiceError).owner, 'support');
        return true;
      }
    );
  } finally {
    failing.restore();
  }
});

test('a schema failure survives sanitising: the SQLSTATE is enough to name it', () => {
  // The gate renders the service's wrapper, whose message is safe copy — the
  // driver text is gone by then. Classification must therefore keep working
  // from the code alone, or a missing migration would read as "cause unknown".
  const raw = Object.assign(new Error('relation SECRET_TABLE does not exist, SQL password=SECRET'), { code: '42P01' });
  const serviceError = GrowthPartnerServiceError.from(raw);
  assert.equal(serviceError.kind, 'schema-missing');
  assert.equal(serviceError.owner, 'administrator');
  assert.equal(serviceError.code, '42P01', 'the SQLSTATE travels with the wrapper');
  assert.doesNotMatch(serviceError.message, /SECRET|SQL|relation/, 'and the driver text does not');
  assert.equal(
    serviceError.failure.kind,
    'schema-missing',
    'the classification travels too, so a screen never has to re-derive it'
  );
});

test('the guards narrow for callers, since this tsconfig does not do it for them', () => {
  const success = { ok: true as const, data: 42 };
  const failure = { ok: false as const, error: GrowthPartnerServiceError.from(new Error('boom')) };
  assert.equal(isServiceSuccess(success), true);
  assert.equal(isServiceFailure(success), false);
  assert.equal(isServiceFailure(failure), true);
  assert.equal(isServiceSuccess(failure), false);
});

test('the service namespace exposes every dashboard section plus the value helpers', () => {
  for (const name of [
    'getMyPartner',
    'ensureMyPartner',
    'getMyApplication',
    'getDashboard',
    'getReferrals',
    'getCustomers',
    'getPerformance',
    'getReferralDetail',
    'getEarnings',
    'getPayoutRequests',
    'requestPayout',
    'cancelPayoutRequest',
    'getLevels',
    'getLeaderboard',
    'getNotifications',
    'markNotificationsRead',
    'getNotificationPreferences',
    'updateNotificationPreferences',
    'getMarketingAssets',
    'getMarketingCategories',
    'getAssetDownloadUrl',
    'getSupportTickets',
    'submitSupportTicket',
  ] as const) {
    assert.equal(typeof (growthPartnerService as any)[name], 'function', `${name} is missing`);
  }
});
