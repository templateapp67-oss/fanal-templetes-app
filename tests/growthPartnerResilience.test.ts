// ============================================================================
// Growth Partner resilience — malformed/empty backend payloads never throw.
//
// `growthPartner.ts` is the single place the partner RPC payloads cross into
// the UI. Those payloads travel a network and a schema that can be one
// migration behind, so every read normalizes what it receives. These tests pin
// the guarantees the screens rely on:
//
//   • a `null`, `{}` or malformed payload NEVER throws and NEVER becomes
//     `undefined` — arrays are arrays, objects are objects;
//   • a value the backend did not send renders as '—' / "not available",
//     never as an invented 0, a fake code or the text "undefined";
//   • a transport failure is still ONE classified error (safe copy), so a
//     section shows its own retry state instead of unmounting the page into
//     the root ErrorBoundary ("Something went wrong");
//   • the sections survive a mangled prop without a render throw.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PARTNER_REFERRAL_PAGE_SIZE,
  fetchMyGrowthPartnerApplication,
  fetchMyGrowthPartnerRow,
  fetchMyPartnerDashboard,
  fetchMyPartnerPerformance,
  fetchMyPartnerReferrals,
  getMyOnboardingStatus,
  normalizePartnerDashboardData,
  normalizePartnerPerformanceData,
  normalizePartnerReferralActivity,
  normalizePartnerReferralList,
} from '../src/lib/growthPartner';
import { normalizeEarnings } from '../src/lib/partnerPortalOperations';
import { GrowthPartnerDashboard, GrowthPartnerCustomers, GrowthPartnerPerformance, GrowthPartnerReferrals } from '../src/components/GrowthPartnerSections';
import { ReferralTable } from '../src/components/ReferralTable';
import { PartnerReferralActivity } from '../src/components/PartnerReferralActivity';

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

// ---------------------------------------------------------------------------
// Normalizers — the pure layer
// ---------------------------------------------------------------------------

test('a missing dashboard payload becomes an honest empty object, never undefined', () => {
  const empty = normalizePartnerDashboardData(null);
  assert.deepEqual(empty.partner, { referral_code: '', is_active: null, partner_since: null });
  assert.deepEqual(empty.kpis, { total_referrals: null, active_onboarding: null, completed: null });
  assert.deepEqual(empty.recent_activity, []);
  assert.equal(empty.referralActivity, undefined);

  // `{}` (an RPC that answered with an empty object) and a JSON scalar are the
  // same story — a complete, safe value.
  assert.deepEqual(normalizePartnerDashboardData({}), empty);
  assert.deepEqual(normalizePartnerDashboardData('nonsense'), empty);

  // A partial payload keeps what the backend sent and leaves the rest unknown.
  const partial = normalizePartnerDashboardData({ partner: { referral_code: 'NEXORA-AB12' }, kpis: { completed: 4 } });
  assert.equal(partial.partner.referral_code, 'NEXORA-AB12');
  assert.equal(partial.partner.is_active, null);
  assert.equal(partial.partner.partner_since, null);
  assert.equal(partial.kpis.total_referrals, null);
  assert.equal(partial.kpis.completed, 4);
});

test('a dashboard whose values throw while being read still returns the safe shape', () => {
  const hostile: Record<string, unknown> = {};
  for (const key of ['partner', 'kpis', 'recent_activity']) {
    Object.defineProperty(hostile, key, {
      enumerable: true,
      get() {
        throw new Error(`hostile ${key}`);
      },
    });
  }
  const warn = console.warn;
  console.warn = () => {};
  try {
    const safe = normalizePartnerDashboardData(hostile);
    assert.deepEqual(safe.partner, { referral_code: '', is_active: null, partner_since: null });
    assert.deepEqual(safe.kpis, { total_referrals: null, active_onboarding: null, completed: null });
    assert.deepEqual(safe.recent_activity, []);
  } finally {
    console.warn = warn;
  }
});

test('a malformed referral page keeps every row separate and the pager usable', () => {
  const empty = normalizePartnerReferralList(null);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.limit, PARTNER_REFERRAL_PAGE_SIZE);
  assert.equal(empty.offset, 0);

  // Junk entries are dropped (not rendered as "undefined"), real rows survive.
  const list = normalizePartnerReferralList({
    total: 'not-a-number',
    limit: 0,
    offset: -5,
    status_counts: { all: 42, active: 2, made_up_status: 9, pending: 'oops' },
    rows: [null, 'junk', { ref: '…abc12345', display_name: null, status: 'linked', conversion_status: null }],
  });
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].ref, '…abc12345');
  assert.equal(list.rows[0].display_name, null);
  // Unknown statuses and non-numeric counters never reach the tabs; the
  // `all` tab total is not a ReferralStatus and must still survive.
  assert.deepEqual(list.status_counts, { all: 42, active: 2 });
  // A zero/absent page size can never make the page-offset math divide by zero.
  assert.ok(list.limit >= 1, 'page size stays usable');
  assert.equal(normalizePartnerReferralList({}).limit, PARTNER_REFERRAL_PAGE_SIZE);
  assert.equal(list.offset, 0);
  assert.deepEqual(list.rows[0].template_started_at, null);
});

test('performance and activity payloads are always iterable', () => {
  const empty = normalizePartnerPerformanceData(null);
  assert.deepEqual(empty.monthly, []);
  assert.equal(empty.total_referrals, null);
  assert.equal(empty.completion_rate_pct, null);

  const mangled = normalizePartnerPerformanceData({
    monthly: [{ month: '2026-08', referred: 2, completed: 'x' }, null, []],
    websites_started: 3,
  });
  assert.equal(mangled.monthly.length, 1);
  assert.deepEqual(mangled.monthly[0], { month: '2026-08', referred: 2, completed: 0 });
  assert.equal(mangled.websites_started, 3);

  assert.equal(normalizePartnerReferralActivity(null), undefined);
  assert.equal(normalizePartnerReferralActivity('junk'), undefined);
  const activity = normalizePartnerReferralActivity({ recentReferrals: undefined });
  assert.deepEqual(activity?.recentReferrals, []);
  assert.equal(activity?.last7DaysReferrals, null);
});

test('the earnings ledger normalizes a missing payload into empty arrays', () => {
  // Earnings travel the partner-operations layer; it must hand the page the
  // same guarantee (an empty ledger, never an undefined `.map`).
  const empty = normalizeEarnings(null);
  assert.equal(empty.currency, 'INR');
  assert.deepEqual(empty.transactions, []);
  assert.deepEqual(empty.totals, { lifetime_paise: 0, pending_paise: 0, cleared_paise: 0, available_paise: 0 });
  assert.deepEqual(normalizeEarnings({ transactions: undefined }).transactions, []);
});

// ---------------------------------------------------------------------------
// Reads — the transport layer is stubbed, the real wrappers run
// ---------------------------------------------------------------------------

/** Answer the page's RPCs by name; anything else answers an empty object. */
function stubTransport(payloadFor: (rpc: string) => { body?: unknown; status?: number }) {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? '');
    const rpc = url.split('/').at(-1)?.split('?')[0] ?? '';
    const { body = {}, status = 200 } = payloadFor(rpc) ?? {};
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return () => {
    (globalThis as any).fetch = original;
  };
}

test('the dashboard read survives every empty payload shape', async () => {
  for (const body of [null, {}, { partner: null, kpis: null, recent_activity: null }]) {
    const restore = stubTransport(() => ({ body }));
    try {
      const dashboard = await fetchMyPartnerDashboard();
      assert.deepEqual(dashboard.partner, { referral_code: '', is_active: null, partner_since: null });
      assert.deepEqual(dashboard.kpis, { total_referrals: null, active_onboarding: null, completed: null });
      assert.deepEqual(dashboard.recent_activity, []);
    } finally {
      restore();
    }
  }
});

test('the referral, performance, application and partner reads survive empty payloads', async () => {
  const restore = stubTransport(() => ({ body: {} }));
  try {
    const list = await fetchMyPartnerReferrals({});
    assert.deepEqual(list, { status_counts: undefined, total: 0, limit: PARTNER_REFERRAL_PAGE_SIZE, offset: 0, rows: [] });

    const performance = await fetchMyPartnerPerformance();
    assert.deepEqual(performance.monthly, []);
    assert.equal(performance.total_referrals, null);

    // No application row → "you never applied", exactly as the RLS read does.
    assert.equal(await fetchMyGrowthPartnerApplication(), null);

    // A partner row that lost its flag is NOT treated as paused: only an
    // explicit `false` may cut a partner's own access.
    const row = await fetchMyGrowthPartnerRow();
    assert.equal(row?.is_active, true);

    const onboarding = await getMyOnboardingStatus();
    assert.equal(onboarding.status, 'not_started');
    assert.equal(onboarding.linked, false);
  } finally {
    restore();
  }
});

test('a rejected RPC surfaces one classified error with the context, never a crash', async () => {
  const restore = stubTransport(() => ({ body: { message: 'permission denied for function get_my_partner_dashboard' }, status: 403 }));
  try {
    await assert.rejects(fetchMyPartnerDashboard(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match((error as Error).message, /Partner dashboard lookup failed/);
      return true;
    });
  } finally {
    restore();
  }

  // A thrown non-Error (a rejected promise without a body) is converted too.
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => {
    throw 'offline';
  };
  try {
    await assert.rejects(fetchMyPartnerPerformance(), (error: unknown) => {
      assert.ok(error instanceof Error, 'a string rejection still becomes an Error');
      return true;
    });
  } finally {
    (globalThis as any).fetch = original;
  }
});

// ---------------------------------------------------------------------------
// Sections — the components render a mangled payload without throwing
// ---------------------------------------------------------------------------

test('the dashboard renders a mangled payload as unknown values, not a crash', () => {
  const html = render(
    React.createElement(GrowthPartnerDashboard, {
      dashboard: {} as any,
      displayName: 'Partner Anita',
      email: 'anita@example.com',
    })
  );
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.match(html, /Total Referrals/);
  assert.match(html, /—/);
  // No code was supplied, so the card says so instead of inventing one.
  assert.match(html, /Referral code not available\./);
  // Recent activity with no rows falls back to the empty state.
  assert.match(html, /No referrals yet\./);
  // The unknown status is stated as unknown — not as a false "Paused" alarm.
  assert.match(html, /Status unavailable/);
  assert.doesNotMatch(html, /currently paused/);
});

test('the referral, performance and activity sections ignore missing arrays', () => {
  const referrals = render(
    React.createElement(GrowthPartnerReferrals, {
      list: { rows: undefined, total: undefined, limit: undefined, offset: undefined } as any,
      loading: false,
      error: null,
      onPage: () => {},
      onRetry: () => {},
    })
  );
  assert.match(referrals, /No referrals yet\./);

  const customers = render(
    React.createElement(GrowthPartnerCustomers, {
      list: { rows: undefined, total: undefined } as any,
      loading: false,
      error: null,
      filter: 'all' as any,
      onFilterChange: () => {},
      onPage: () => {},
      onRetry: () => {},
      search: '',
      onSearchChange: () => {},
      onSearchSubmit: () => {},
    })
  );
  assert.doesNotMatch(customers, /undefined/);

  const performance = render(
    React.createElement(GrowthPartnerPerformance, {
      performance: { monthly: undefined, total_referrals: undefined, completion_rate_pct: undefined } as any,
      loading: false,
      error: null,
      onRetry: () => {},
    })
  );
  assert.doesNotMatch(performance, /undefined|NaN%/);
  assert.match(performance, /Completion Rate/);
  assert.match(performance, /Monthly history is not available yet\./);

  const table = render(React.createElement(ReferralTable, { rows: undefined as any }));
  assert.match(table, /Referred users table/);

  const activity = render(
    React.createElement(PartnerReferralActivity, { activity: { recentReferrals: undefined, last7DaysReferrals: undefined } as any })
  );
  assert.match(activity, /No referrals yet\./);
  // The headline count is stated as unknown instead of "undefined".
  assert.match(activity, /Last 7 Days Referrals<\/h2><p[^>]*>—<\/p>/);
});
