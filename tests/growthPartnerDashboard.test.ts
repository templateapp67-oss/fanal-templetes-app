// ============================================================================
// Phase 6 — Growth Partner operational dashboard.
//
// Backend (PGlite, growth stack + 20260915 dashboard reads):
//   • dashboard / referrals / performance RPCs derive the partner from
//     auth.uid(), scope every query to the caller's own referrals, and take
//     NO partner/user id parameters (nothing to manipulate in a URL)
//   • non-partners fail closed with a safe message; anon is denied
//   • server-side status filter, name search (LIKE-escaped), pagination with
//     clamped bounds; server-side KPI counts, completion rate, monthly history
//   • minimal disclosure: display names only — no emails, phones, business
//     data or full user UUIDs (masked refs instead)
// Frontend (SSR + static): all six sections render loading / error / empty /
// success states with real backend shapes; statuses flow through the single
// shared label mapping; copy copies only the code; no financial math in React.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import {
  PARTNER_ACTIVITY_LABELS,
  PARTNER_REFERRAL_FILTER_LABELS,
  PARTNER_SECTION_ERROR_MESSAGE,
  toSafePartnerSectionError,
  type PartnerDashboardData,
  type PartnerPerformanceData,
  type PartnerReferralList,
} from '../src/lib/growthPartner';
import {
  GROWTH_PARTNER_NO_COMMISSION_BODY,
  GROWTH_PARTNER_NO_COMMISSION_TITLE,
  GROWTH_PARTNER_NO_PERFORMANCE_BODY,
  GROWTH_PARTNER_NO_REFERRALS_BODY,
  GrowthPartnerCommission,
  GrowthPartnerCustomers,
  GrowthPartnerPerformance,
  GrowthPartnerReferrals,
  Pager,
  ReferralStatusPill,
} from '../src/components/GrowthPartnerSections';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const USER_2 = 'b0000000-0000-4000-8000-000000000002';
const USER_3 = 'b0000000-0000-4000-8000-000000000003';
const USER_4 = 'b0000000-0000-4000-8000-000000000004';
const USER_5 = 'b0000000-0000-4000-8000-000000000005';
const USER_6 = 'b0000000-0000-4000-8000-000000000006';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const GROWTH_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);
const DASHBOARD_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260915_growth_partner_dashboard.sql', import.meta.url),
  'utf8'
);
const INACTIVE_GUARD_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260918_partner_dashboard_inactive_guard.sql', import.meta.url),
  'utf8'
);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text, email text, phone text);
    insert into auth.users(id) values
      ('${PARTNER_A}'), ('${PARTNER_B}'),
      ('${USER_1}'), ('${USER_2}'), ('${USER_3}'),
      ('${USER_4}'), ('${USER_5}'), ('${USER_6}');
  `);
  await db.exec(GROWTH_MIGRATION);
  await db.exec(DASHBOARD_MIGRATION);
  await db.exec(INACTIVE_GUARD_MIGRATION);
  return db;
}

/** Call an RPC as an authenticated user; returns the parsed jsonb result. */
async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}

/**
 * Partner A: 5 referrals (2 completed, 1 started, 2 pending).
 * Partner B: 1 referral (started). Profiles carry email/phone to prove the
 * dashboard RPCs disclose display names ONLY; USER_4 has no profiles row.
 */
async function setupPopulatedDb(): Promise<any> {
  const db = await setup();
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
  await db.query('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
  const link = (u: string, c: string) => asUser(db, u, 'select public.link_my_growth_referral($1)', [c]);
  const step = (u: string, a: string) => asUser(db, u, 'select public.update_my_onboarding_progress($1)', [a]);
  await link(USER_1, CODE_A);
  await step(USER_1, 'start_template');
  await step(USER_1, 'complete_template');
  await link(USER_2, CODE_A);
  await step(USER_2, 'start_template');
  await link(USER_3, CODE_A);
  await link(USER_4, CODE_A);
  await step(USER_4, 'start_template');
  await step(USER_4, 'complete_template');
  await link(USER_5, CODE_A);
  await link(USER_6, CODE_B);
  await step(USER_6, 'start_template');
  await db.query(
    `insert into public.profiles(id, full_name, email, phone) values
     ($1::uuid, 'Asha Sharma', 'asha@example.com', '+91 90000 00001'),
     ($2::uuid, 'Rohan Verma', 'rohan@example.com', '+91 90000 00002'),
     ($3::uuid, 'Meera Iyer', 'meera@example.com', '+91 90000 00003'),
     ($4::uuid, 'Asha Kapoor', 'asha.k@example.com', '+91 90000 00005'),
     ($5::uuid, 'Bala Krishnan', 'bala@example.com', '+91 90000 00006')`,
    [USER_1, USER_2, USER_3, USER_5, USER_6]
  );
  return db;
}

/** Mid-month ISO instant N months ago (timezone-boundary safe). */
function midMonthIso(monthsAgo: number): string {
  const d = new Date();
  d.setDate(15);
  d.setHours(12, 0, 0, 0);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString();
}

function monthLabel(monthsAgo: number): string {
  return midMonthIso(monthsAgo).slice(0, 7);
}

/** Shape one referral's funnel instants (admin write, for deterministic tests). */
async function shapeTimestamps(
  db: any,
  userId: string,
  instants: { linked?: string | null; started?: string | null; completed?: string | null }
) {
  await db.query(
    `update public.growth_onboarding
     set linked_at = $2::timestamptz,
         template_started_at = $3::timestamptz,
         template_completed_at = $4::timestamptz
     where user_id = $1::uuid`,
    [userId, instants.linked ?? null, instants.started ?? null, instants.completed ?? null]
  );
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Strip SQL `--` comments (migration shape assertions inspect code only). */
function stripSqlComments(source: string): string {
  return source.replace(/--[^\n]*\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Dashboard RPC
// ---------------------------------------------------------------------------

test('the dashboard RPC returns the partner card, server KPIs and newest-first activity', async () => {
  const db = await setupPopulatedDb();
  try {
    // Distinct instants so activity ordering is deterministic.
    await shapeTimestamps(db, USER_1, {
      linked: '2026-01-01T10:00:00Z',
      started: '2026-01-02T10:00:00Z',
      completed: '2026-01-03T10:00:00Z',
    });
    await shapeTimestamps(db, USER_2, { linked: '2026-02-01T10:00:00Z', started: '2026-02-02T10:00:00Z' });
    await shapeTimestamps(db, USER_3, { linked: '2026-03-01T10:00:00Z' });
    await shapeTimestamps(db, USER_4, {
      linked: '2026-04-01T10:00:00Z',
      started: '2026-04-02T10:00:00Z',
      completed: '2026-04-03T10:00:00Z',
    });
    await shapeTimestamps(db, USER_5, { linked: '2026-05-01T10:00:00Z' });

    const dashboard = (await rpc(db, PARTNER_A, 'get_my_partner_dashboard')) as PartnerDashboardData;
    assert.equal(dashboard.partner.referral_code, CODE_A);
    assert.equal(dashboard.partner.is_active, true);
    assert.ok(dashboard.partner.partner_since);
    assert.deepEqual(dashboard.kpis, { total_referrals: 5, active_onboarding: 3, completed: 2 });

    // 10 events exist; the newest 8 come back, newest first.
    assert.equal(dashboard.recent_activity.length, 8);
    assert.deepEqual(
      dashboard.recent_activity.map((entry) => entry.type),
      [
        'referral_added',
        'website_completed',
        'website_started',
        'referral_added',
        'referral_added',
        'website_started',
        'referral_added',
        'website_completed',
      ]
    );
    const first = dashboard.recent_activity[0];
    assert.equal(first.display_name, 'Asha Kapoor');
    assert.match(first.ref, /^…[0-9a-f]{8}$/);
    // Partner B's user never appears in Partner A's activity.
    assert.ok(dashboard.recent_activity.every((entry) => entry.display_name !== 'Bala Krishnan'));
  } finally {
    await db.close();
  }
});

test('non-partners fail closed with a safe message; anonymous callers are denied', async () => {
  const db = await setupPopulatedDb();
  try {
    await assert.rejects(rpc(db, USER_1, 'get_my_partner_dashboard'), /Growth Partner access required/);
    await assert.rejects(
      rpc(db, USER_1, 'get_my_partner_referrals', ['all', null, 20, 0]),
      /Growth Partner access required/
    );
    await assert.rejects(rpc(db, USER_1, 'get_my_partner_performance'), /Growth Partner access required/);
    await assert.rejects(asUser(db, '', 'select public.get_my_partner_dashboard()'), /permission denied/);
    await assert.rejects(
      asUser(db, '', 'select public.get_my_partner_referrals()'),
      /permission denied/
    );
    await assert.rejects(asUser(db, '', 'select public.get_my_partner_performance()'), /permission denied/);
    // No session at all (owner role, no JWT claim) → sign-in message, safe.
    await assert.rejects(db.query('select public.get_my_partner_dashboard()'), /Sign in required/);
  } finally {
    await db.close();
  }
});

test('an inactive partner is denied the dashboard reads (fail closed, matching the gate)', async () => {
  const db = await setupPopulatedDb();
  try {
    await db.query('update public.growth_partners set is_active = false where user_id = $1::uuid', [PARTNER_A]);

    // The gate row read still succeeds (the UI gate needs to learn is_active),
    // but every dashboard/referrals/performance read is denied.
    const row = (
      await asUser(db, PARTNER_A, 'select user_id, is_active from public.growth_partners')
    ).rows[0];
    assert.equal(row.is_active, false);

    await assert.rejects(rpc(db, PARTNER_A, 'get_my_partner_dashboard'), /Growth Partner access is paused/);
    await assert.rejects(
      rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0]),
      /Growth Partner access is paused/
    );
    await assert.rejects(rpc(db, PARTNER_A, 'get_my_partner_performance'), /Growth Partner access is paused/);
  } finally {
    await db.close();
  }
});

test('a partner with no referrals gets zeros and empty activity (never nulls)', async () => {
  const db = await setup();
  try {
    await db.query(`insert into auth.users(id) values ('c0000000-0000-4000-8000-000000000001')`);
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [
      'c0000000-0000-4000-8000-000000000001',
      'EMPTY01',
    ]);
    const dashboard = (await rpc(db, 'c0000000-0000-4000-8000-000000000001', 'get_my_partner_dashboard')) as PartnerDashboardData;
    assert.deepEqual(dashboard.kpis, { total_referrals: 0, active_onboarding: 0, completed: 0 });
    assert.deepEqual(dashboard.recent_activity, []);
    const list = (await rpc(db, 'c0000000-0000-4000-8000-000000000001', 'get_my_partner_referrals')) as PartnerReferralList;
    assert.deepEqual(list, { total: 0, limit: 20, offset: 0, rows: [] });
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Referrals RPC: filter, search, pagination, disclosure
// ---------------------------------------------------------------------------

test('referral rows and totals belong only to the calling partner', async () => {
  const db = await setupPopulatedDb();
  try {
    const a = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    assert.equal(a.total, 5);
    assert.equal(a.rows.length, 5);
    assert.ok(a.rows.every((row) => row.display_name !== 'Bala Krishnan'));

    const b = (await rpc(db, PARTNER_B, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    assert.equal(b.total, 1);
    assert.equal(b.rows[0].display_name, 'Bala Krishnan');
    assert.equal(b.rows[0].status, 'template_started');
  } finally {
    await db.close();
  }
});

test('status filters map to the backend funnel states; unknown filters are rejected', async () => {
  const db = await setupPopulatedDb();
  try {
    const pending = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['pending', null, 20, 0])) as PartnerReferralList;
    assert.equal(pending.total, 2);
    assert.ok(pending.rows.every((row) => row.status === 'linked'));

    const progress = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['in_progress', null, 20, 0])) as PartnerReferralList;
    assert.equal(progress.total, 1);
    assert.equal(progress.rows[0].status, 'template_started');

    const done = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['completed', null, 20, 0])) as PartnerReferralList;
    assert.equal(done.total, 2);
    assert.ok(done.rows.every((row) => row.status === 'template_completed'));

    await assert.rejects(
      rpc(db, PARTNER_A, 'get_my_partner_referrals', ['everyone', null, 20, 0]),
      /Unknown referral filter/
    );
  } finally {
    await db.close();
  }
});

test('name search runs server-side, is case-insensitive, escapes wildcards and never leaks', async () => {
  const db = await setupPopulatedDb();
  try {
    const asha = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', 'asha', 20, 0])) as PartnerReferralList;
    assert.equal(asha.total, 2);
    assert.deepEqual(
      asha.rows.map((row) => row.display_name).sort(),
      ['Asha Kapoor', 'Asha Sharma']
    );
    const meera = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', 'MEERA', 20, 0])) as PartnerReferralList;
    assert.equal(meera.total, 1);

    // A literal '%' must not become a wildcard probe (no names contain one).
    const wildcard = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', '%', 20, 0])) as PartnerReferralList;
    assert.equal(wildcard.total, 0);
    const underscore = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', '_', 20, 0])) as PartnerReferralList;
    assert.equal(underscore.total, 0);

    // Partner A searching Partner B's user finds nothing (scoped before search).
    const leaked = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', 'bala', 20, 0])) as PartnerReferralList;
    assert.equal(leaked.total, 0);
  } finally {
    await db.close();
  }
});

test('pagination slices server-side with deterministic order and clamped bounds', async () => {
  const db = await setupPopulatedDb();
  try {
    const page1 = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 2, 0])) as PartnerReferralList;
    const page2 = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 2, 2])) as PartnerReferralList;
    const page3 = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 2, 4])) as PartnerReferralList;
    assert.equal(page1.total, 5);
    assert.equal(page1.rows.length, 2);
    assert.equal(page2.rows.length, 2);
    assert.equal(page3.rows.length, 1);
    // Newest-linked first, and pages never overlap.
    const refs = [...page1.rows, ...page2.rows, ...page3.rows].map((row) => row.ref);
    assert.equal(new Set(refs).size, 5);
    const linked = [...page1.rows, ...page2.rows, ...page3.rows].map((row) => Date.parse(row.linked_at as string));
    assert.deepEqual([...linked].sort((x, y) => y - x), linked);

    // Bounds are clamped, never trusted.
    const huge = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 1000, 0])) as PartnerReferralList;
    assert.equal(huge.limit, 100);
    const tiny = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 0, -5])) as PartnerReferralList;
    assert.equal(tiny.limit, 1);
    assert.equal(tiny.offset, 0);
  } finally {
    await db.close();
  }
});

test('referral output discloses display names only — masked refs, no ids or contact data', async () => {
  const db = await setupPopulatedDb();
  try {
    const list = (await rpc(db, PARTNER_A, 'get_my_partner_referrals', ['all', null, 20, 0])) as PartnerReferralList;
    for (const row of list.rows) {
      assert.deepEqual(Object.keys(row).sort(), [
        'display_name',
        'linked_at',
        'ref',
        'status',
        'template_completed_at',
        'template_started_at',
      ]);
      assert.match(row.ref, /^…[0-9a-f]{8}$/);
    }
    const serialized = JSON.stringify(list);
    assert.doesNotMatch(serialized, /asha@example\.com|rohan@example\.com|\+91 90000/);
    assert.doesNotMatch(serialized, /b0000000-0000-4000-8000-00000000000/);
    assert.doesNotMatch(serialized, /user_id|growth_partner_id/);
    // USER_4 has no profiles row → null name, masked ref still shown.
    const unnamed = list.rows.find((row) => row.ref === '…00000004');
    assert.ok(unnamed);
    assert.equal(unnamed.display_name, null);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Performance RPC
// ---------------------------------------------------------------------------

test('performance aggregates are computed server-side and scoped to the caller', async () => {
  const db = await setupPopulatedDb();
  try {
    const a = (await rpc(db, PARTNER_A, 'get_my_partner_performance')) as PartnerPerformanceData;
    assert.equal(a.total_referrals, 5);
    assert.equal(a.completed, 2);
    assert.equal(a.active_onboarding, 3);
    assert.equal(a.websites_started, 3);
    assert.equal(a.completion_rate_pct, 40);

    const b = (await rpc(db, PARTNER_B, 'get_my_partner_performance')) as PartnerPerformanceData;
    assert.equal(b.total_referrals, 1);
    assert.equal(b.completed, 0);
    assert.equal(b.completion_rate_pct, 0);
  } finally {
    await db.close();
  }
});

test('completion rate rounds to one decimal and is zero without referrals', async () => {
  const db = await setup();
  try {
    await db.query(`insert into auth.users(id) values
      ('c0000000-0000-4000-8000-000000000001'),
      ('d0000000-0000-4000-8000-000000000001'),
      ('d0000000-0000-4000-8000-000000000002'),
      ('d0000000-0000-4000-8000-000000000003')`);
    await db.query('select public.provision_growth_partner($1::uuid, $2)', [
      'c0000000-0000-4000-8000-000000000001',
      'RATE01',
    ]);
    for (const u of [
      'd0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000002',
      'd0000000-0000-4000-8000-000000000003',
    ]) {
      await asUser(db, u, 'select public.link_my_growth_referral($1)', ['RATE01']);
    }
    await asUser(db, 'd0000000-0000-4000-8000-000000000001', "select public.update_my_onboarding_progress('start_template')");
    await asUser(db, 'd0000000-0000-4000-8000-000000000001', "select public.update_my_onboarding_progress('complete_template')");
    const one = (await rpc(db, 'c0000000-0000-4000-8000-000000000001', 'get_my_partner_performance')) as PartnerPerformanceData;
    assert.equal(one.completion_rate_pct, 33.3);

    await asUser(db, 'd0000000-0000-4000-8000-000000000002', "select public.update_my_onboarding_progress('start_template')");
    await asUser(db, 'd0000000-0000-4000-8000-000000000002', "select public.update_my_onboarding_progress('complete_template')");
    const two = (await rpc(db, 'c0000000-0000-4000-8000-000000000001', 'get_my_partner_performance')) as PartnerPerformanceData;
    assert.equal(two.completion_rate_pct, 66.7);
  } finally {
    await db.close();
  }
});

test('monthly history carries real per-month counts over the trailing six months', async () => {
  const db = await setupPopulatedDb();
  try {
    await shapeTimestamps(db, USER_1, { linked: midMonthIso(2), started: midMonthIso(2), completed: midMonthIso(1) });
    await shapeTimestamps(db, USER_4, { linked: midMonthIso(1), started: midMonthIso(1), completed: midMonthIso(0) });
    const perf = (await rpc(db, PARTNER_A, 'get_my_partner_performance')) as PartnerPerformanceData;
    assert.equal(perf.monthly.length, 6);
    const byMonth = new Map(perf.monthly.map((point) => [point.month, point]));
    // USER_2/3/5 linked "now" (current month); USER_1 two months ago; USER_4 last month.
    assert.deepEqual(byMonth.get(monthLabel(0)), { month: monthLabel(0), referred: 3, completed: 1 });
    assert.deepEqual(byMonth.get(monthLabel(1)), { month: monthLabel(1), referred: 1, completed: 1 });
    assert.deepEqual(byMonth.get(monthLabel(2)), { month: monthLabel(2), referred: 1, completed: 0 });
    assert.deepEqual(byMonth.get(monthLabel(3)), { month: monthLabel(3), referred: 0, completed: 0 });
    // Ascending month order for the chart/table.
    assert.deepEqual(
      perf.monthly.map((point) => point.month),
      [5, 4, 3, 2, 1, 0].map((k) => monthLabel(k))
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Migration shape: additive reads only, least privilege, no id parameters
// ---------------------------------------------------------------------------

test('the dashboard migration adds read-only RPCs — no tables, writes, commission math or secrets', () => {
  const code = stripSqlComments(DASHBOARD_MIGRATION);
  assert.doesNotMatch(code, /create table/i);
  assert.doesNotMatch(code, /\b(insert|update|delete)\b/i);
  // No partner commission engine is invented here (staff payouts stay untouched).
  assert.doesNotMatch(code, /commission/i);
  assert.doesNotMatch(code, /staff_/i);
  assert.doesNotMatch(code, /payout|percentage|fixed_amount/i);
  assert.doesNotMatch(code, /service_role|service-role|secret|password|jwt|apikey|api_key/i);
  // Least-privilege grants: RPCs to authenticated only, helper to nobody.
  for (const fn of ['get_my_partner_dashboard()', 'get_my_partner_performance()']) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, (c) => `\\${c}`)} from public, anon;`));
    assert.match(code, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, (c) => `\\${c}`)} to authenticated;`));
  }
  assert.match(code, /revoke all on function public\.get_my_partner_referrals\(text, text, int, int\) from public, anon;/);
  assert.match(code, /grant execute on function public\.get_my_partner_referrals\(text, text, int, int\) to authenticated;/);
  assert.match(code, /revoke all on function public\.partner_dashboard_caller\(\) from public, anon, authenticated;/);
});

test('dashboard RPCs take no partner/user id parameters — identity comes from the session', () => {
  const code = stripSqlComments(DASHBOARD_MIGRATION);
  assert.match(code, /create or replace function public\.get_my_partner_dashboard\(\)/);
  assert.match(code, /create or replace function public\.get_my_partner_performance\(\)/);
  assert.match(
    code,
    /create or replace function public\.get_my_partner_referrals\(\s*p_status_filter text[^)]*p_search text[^)]*p_limit int[^)]*p_offset int[^)]*\)/
  );
  assert.doesNotMatch(code, /p_partner|p_user_id|p_actor|p_email/);
  assert.match(code, /actor uuid := auth\.uid\(\)/);
  assert.match(code, /growth_partner_id = v_partner\.user_id/);
});

// ---------------------------------------------------------------------------
// Client contracts: labels, safe errors, wrapper shapes
// ---------------------------------------------------------------------------

test('filter and activity labels are single reusable mappings with exact copy', () => {
  assert.deepEqual(PARTNER_REFERRAL_FILTER_LABELS, {
    all: 'All',
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
  });
  assert.deepEqual(PARTNER_ACTIVITY_LABELS, {
    referral_added: 'New referral added',
    website_started: 'User started website',
    website_completed: 'Website completed',
  });
});

test('section errors surface safe copy only — raw database errors become generic', () => {
  assert.equal(PARTNER_SECTION_ERROR_MESSAGE, 'Could not load this section. Please try again.');
  assert.equal(
    toSafePartnerSectionError(new Error('Partner dashboard lookup failed: Growth Partner access required')).message,
    'Growth Partner access required'
  );
  assert.equal(toSafePartnerSectionError(new Error('Sign in required')).message, 'Sign in required');
  assert.equal(toSafePartnerSectionError(new Error('Unknown referral filter')).message, 'Unknown referral filter');
  assert.equal(
    toSafePartnerSectionError(new Error('relation "growth_onboarding" does not exist')).message,
    PARTNER_SECTION_ERROR_MESSAGE
  );
  assert.equal(
    toSafePartnerSectionError(new Error('duplicate key value violates unique constraint "x"')).message,
    PARTNER_SECTION_ERROR_MESSAGE
  );
  assert.equal(toSafePartnerSectionError(null).message, PARTNER_SECTION_ERROR_MESSAGE);
});

test('dashboard wrappers call the session-scoped RPCs without any partner id argument', () => {
  const source = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  assert.match(source, /supabase\.rpc\('get_my_partner_dashboard'\)/);
  assert.match(source, /supabase\.rpc\('get_my_partner_performance'\)/);
  const listCall = source.match(/supabase\.rpc\('get_my_partner_referrals', \{[\s\S]*?\}\);/);
  assert.ok(listCall, 'referrals RPC call found');
  assert.match(listCall[0], /p_status_filter/);
  assert.match(listCall[0], /p_search/);
  assert.match(listCall[0], /p_limit/);
  assert.match(listCall[0], /p_offset/);
  assert.doesNotMatch(listCall[0], /partner_id|partnerId|user_id|userId/);
});

// ---------------------------------------------------------------------------
// Rendered sections
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

const SAMPLE_LIST: PartnerReferralList = {
  total: 2,
  limit: 20,
  offset: 0,
  rows: [
    {
      ref: '…00000001',
      display_name: 'Asha Sharma',
      status: 'template_completed',
      linked_at: '2026-09-02T10:00:00.000Z',
      template_started_at: '2026-09-03T10:00:00.000Z',
      template_completed_at: '2026-09-04T10:00:00.000Z',
    },
    {
      ref: '…00000003',
      display_name: null,
      status: 'linked',
      linked_at: '2026-09-07T10:00:00.000Z',
      template_started_at: null,
      template_completed_at: null,
    },
  ],
};

const SAMPLE_PERFORMANCE: PartnerPerformanceData = {
  total_referrals: 5,
  completed: 2,
  active_onboarding: 3,
  websites_started: 3,
  completion_rate_pct: 40,
  monthly: [
    { month: '2026-04', referred: 0, completed: 0 },
    { month: '2026-05', referred: 0, completed: 0 },
    { month: '2026-06', referred: 0, completed: 0 },
    { month: '2026-07', referred: 1, completed: 0 },
    { month: '2026-08', referred: 1, completed: 1 },
    { month: '2026-09', referred: 3, completed: 1 },
  ],
};

const noop = () => {};

test('status pills render every funnel label through the shared mapping', () => {
  assert.match(render(React.createElement(ReferralStatusPill, { status: 'linked' })), /Referral Added/);
  assert.match(
    render(React.createElement(ReferralStatusPill, { status: 'template_started' })),
    /Website Started/
  );
  assert.match(
    render(React.createElement(ReferralStatusPill, { status: 'template_completed' })),
    /Completed/
  );
  assert.match(render(React.createElement(ReferralStatusPill, { status: 'not_started' })), /Pending/);
});

test('the referrals section renders filters, rows, dates and the pager', () => {
  const html = render(
    React.createElement(GrowthPartnerReferrals, {
      list: SAMPLE_LIST,
      loading: false,
      error: null,
      filter: 'all',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
    })
  );
  for (const label of ['All', 'Pending', 'In Progress', 'Completed']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Asha Sharma/);
  assert.match(html, /Referred user …00000003/);
  assert.match(html, /Completed/);
  assert.match(html, /Referral Added/);
  assert.match(html, /Showing 1–2 of 2/);

  const loading = render(
    React.createElement(GrowthPartnerReferrals, {
      list: null,
      loading: true,
      error: null,
      filter: 'all',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
    })
  );
  assert.match(loading, /Loading your referrals/);

  const failed = render(
    React.createElement(GrowthPartnerReferrals, {
      list: null,
      loading: false,
      error: 'Could not load this section. Please try again.',
      filter: 'all',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
    })
  );
  assert.match(failed, /Could not load this section/);
  assert.match(failed, /Retry/);

  const empty = render(
    React.createElement(GrowthPartnerReferrals, {
      list: { total: 0, limit: 20, offset: 0, rows: [] },
      loading: false,
      error: null,
      filter: 'all',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
    })
  );
  assert.match(empty, new RegExp(GROWTH_PARTNER_NO_REFERRALS_BODY));

  const filteredEmpty = render(
    React.createElement(GrowthPartnerReferrals, {
      list: { total: 0, limit: 20, offset: 0, rows: [] },
      loading: false,
      error: null,
      filter: 'completed',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
    })
  );
  assert.match(filteredEmpty, /No referrals match this filter/);
});

test('the customers section adds server-side search to the shared referral rows', () => {
  const html = render(
    React.createElement(GrowthPartnerCustomers, {
      list: SAMPLE_LIST,
      loading: false,
      error: null,
      filter: 'all',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
      search: '',
      onSearchChange: noop,
      onSearchSubmit: noop,
    })
  );
  assert.match(html, /Search by customer name/);
  assert.match(html, /<form/);
  assert.match(html, /Asha Sharma/);
  assert.match(html, /Joined/);

  const searched = render(
    React.createElement(GrowthPartnerCustomers, {
      list: { total: 0, limit: 20, offset: 0, rows: [] },
      loading: false,
      error: null,
      filter: 'all',
      onFilterChange: noop,
      onPage: noop,
      onRetry: noop,
      search: 'zareen',
      onSearchChange: noop,
      onSearchSubmit: noop,
    })
  );
  assert.match(searched, /No customers match your search/);
});

test('the performance section renders backend aggregates and real monthly history', () => {
  const html = render(
    React.createElement(GrowthPartnerPerformance, {
      performance: SAMPLE_PERFORMANCE,
      loading: false,
      error: null,
      onRetry: noop,
    })
  );
  assert.match(html, /Completion Rate/);
  assert.match(html, /40%/);
  assert.match(html, /Websites Started/);
  assert.match(html, />3</);
  assert.match(html, /Last 6 months/);
  assert.match(html, /3 referred · 1 completed/);

  const empty = render(
    React.createElement(GrowthPartnerPerformance, {
      performance: {
        total_referrals: 0,
        completed: 0,
        active_onboarding: 0,
        websites_started: 0,
        completion_rate_pct: 0,
        monthly: [],
      },
      loading: false,
      error: null,
      onRetry: noop,
    })
  );
  assert.match(empty, new RegExp(GROWTH_PARTNER_NO_PERFORMANCE_BODY));
});

test('the commission section honestly reports that no commission exists yet', () => {
  const html = render(React.createElement(GrowthPartnerCommission, {}));
  assert.match(html, new RegExp(GROWTH_PARTNER_NO_COMMISSION_TITLE));
  assert.match(html, new RegExp(GROWTH_PARTNER_NO_COMMISSION_BODY));
  // No invented amounts, history tables or payout forms.
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /₹|\$|%/);
});

test('the pager turns server pages and disables correctly at the bounds', () => {
  const middle = render(React.createElement(Pager, { total: 45, limit: 20, offset: 20, onPage: noop }));
  assert.match(middle, /Showing 21–40 of 45/);
  assert.doesNotMatch(middle, /disabled=""/);

  const first = render(React.createElement(Pager, { total: 45, limit: 20, offset: 0, onPage: noop }));
  assert.match(first, /Showing 1–20 of 45/);
  assert.match(first, /disabled=""/);

  const single = render(React.createElement(Pager, { total: 5, limit: 20, offset: 0, onPage: noop }));
  assert.match(single, /Showing 1–5 of 5/);
});

test('section code copies only the referral code and keeps no browser-side state', () => {
  const source = readFileSync(new URL('../src/components/GrowthPartnerSections.tsx', import.meta.url), 'utf8');
  // The card delegates to the single shared clipboard helper (Part 2.3).
  assert.match(source, /copyReferralCodeToClipboard/);
  assert.doesNotMatch(stripComments(source), /localStorage|sessionStorage/);
  // No client-side business math: rates, totals and payouts never computed here.
  assert.doesNotMatch(stripComments(source), /completion_rate_pct\s*=[^=]/);
  assert.doesNotMatch(stripComments(source), /commission_amount|payout_amount|total_earned/);

  // The helper itself copies ONLY the code via the browser clipboard API.
  const lib = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  assert.match(lib, /\.clipboard\?\.writeText/);
  assert.doesNotMatch(stripComments(lib), /localStorage|sessionStorage/);
});
