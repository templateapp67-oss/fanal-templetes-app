import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffPerformanceDashboard } from '../src/components/StaffPerformanceDashboard';
import { parseStaffDetail } from '../src/lib/staffPerformanceApi';
import {
  STAFF_FILTER_DEBOUNCE_MS,
  STAFF_PERFORMANCE_PATH as CONTRACT_PATH,
  STAFF_PERFORMANCE_RPCS,
  STAFF_RPC_TIMEOUT_MS,
  aggregateSalonTotals,
  bookingGrowthPercent,
  chartStaffBars,
  classifyStaffPerformanceError,
  csvFromExportRows,
  dailySeries,
  filterStaffRows,
  formatInr,
  leaderBadgesFor,
  mostImprovedStaffId,
  paginateRows,
  percentChange,
  previousPeriod,
  publicCustomerLabel,
  resolveDateRange,
  sortStaffRows,
  type StaffLast7DaysRow,
  type StaffPerformanceSummaryRow,
} from '../src/lib/staffPerformance';
import {
  STAFF_PERFORMANCE_PATH,
  isCustomerAppPath,
  isStaffPerformancePath,
  normalizePath,
} from '../src/lib/router';

function row(partial: Partial<StaffPerformanceSummaryRow> & { staff_id: string; staff_name: string }): StaffPerformanceSummaryRow {
  return {
    staff_photo: null,
    staff_role: 'Stylist',
    total_bookings: 0,
    pending_bookings: 0,
    confirmed_bookings: 0,
    completed_bookings: 0,
    cancelled_bookings: 0,
    gross_amount: 0,
    discount_amount: 0,
    net_amount: 0,
    paid_amount: 0,
    commission_rate: 0,
    commission_amount: 0,
    salon_amount: 0,
    review_count: 0,
    average_rating: 0,
    five_star_reviews: 0,
    four_star_reviews: 0,
    three_star_reviews: 0,
    two_star_reviews: 0,
    one_star_reviews: 0,
    ...partial,
  };
}

test('staff performance lives at /owner/dashboard/staff-performance', () => {
  assert.equal(STAFF_PERFORMANCE_PATH, '/owner/dashboard/staff-performance');
  assert.equal(CONTRACT_PATH, STAFF_PERFORMANCE_PATH);
  assert.equal(isStaffPerformancePath('/owner/dashboard/staff-performance'), true);
  assert.equal(isStaffPerformancePath('/owner/dashboard/staff-performance/'), true);
  assert.equal(isStaffPerformancePath('/OWNER/DASHBOARD/STAFF-PERFORMANCE'), true);
  assert.equal(isStaffPerformancePath('/dashboard'), false);
  assert.equal(isStaffPerformancePath('/app'), false);
  assert.equal(isStaffPerformancePath('/customer/bookings'), false);
  assert.equal(isCustomerAppPath(STAFF_PERFORMANCE_PATH), false, 'customer app must not swallow the owner route');
  assert.equal(normalizePath('/owner/dashboard/staff-performance/'), STAFF_PERFORMANCE_PATH);
});

test('the page URL never carries a salon_id the client could spoof', () => {
  assert.equal(STAFF_PERFORMANCE_PATH.includes(':salon'), false);
  assert.equal(/salon_id/.test(STAFF_PERFORMANCE_PATH), false);
});

test('date presets and previous-period windows', () => {
  const today = '2026-09-08';
  assert.deepEqual(resolveDateRange('today', { today }), { preset: 'today', from: '2026-09-08', to: '2026-09-08' });
  assert.deepEqual(resolveDateRange('last_7', { today }), { preset: 'last_7', from: '2026-09-02', to: '2026-09-08' });
  assert.deepEqual(resolveDateRange('last_30', { today }), { preset: 'last_30', from: '2026-08-10', to: '2026-09-08' });
  assert.deepEqual(resolveDateRange('this_month', { today }), { preset: 'this_month', from: '2026-09-01', to: '2026-09-08' });
  assert.deepEqual(resolveDateRange('custom', { today, customFrom: '2026-09-10', customTo: '2026-09-01' }), {
    preset: 'custom',
    from: '2026-09-01',
    to: '2026-09-10',
  });
  assert.deepEqual(previousPeriod('2026-09-02', '2026-09-08'), { from: '2026-08-26', to: '2026-09-01' });
});

test('salon totals sum RPC rows and never invent cancelled revenue', () => {
  const totals = aggregateSalonTotals([
    row({
      staff_id: 'a',
      staff_name: 'Ananya',
      total_bookings: 4,
      completed_bookings: 3,
      cancelled_bookings: 1,
      gross_amount: 2300,
      discount_amount: 100,
      net_amount: 2300,
      paid_amount: 2200,
      commission_amount: 690,
      review_count: 2,
      average_rating: 5,
    }),
    row({
      staff_id: 'r',
      staff_name: 'Rohan',
      total_bookings: 1,
      completed_bookings: 1,
      net_amount: 700,
      paid_amount: 150,
      commission_amount: 200,
      review_count: 0,
      average_rating: 0,
    }),
  ]);
  assert.equal(totals.total_bookings, 5);
  assert.equal(totals.completed_bookings, 4);
  assert.equal(totals.paid_amount, 2350);
  assert.equal(totals.net_amount, 3000);
  assert.equal(totals.commission_amount, 890);
  assert.equal(totals.salon_amount, 0);
  assert.equal(totals.review_count, 2);
  assert.equal(totals.average_rating, 5);
});

test('search, staff filter, numeric sort and pagination', () => {
  const rows = [
    row({ staff_id: 'a', staff_name: 'Ananya', completed_bookings: 3, paid_amount: 2200 }),
    row({ staff_id: 'r', staff_name: 'Rohan', completed_bookings: 1, paid_amount: 150 }),
    row({ staff_id: 'k', staff_name: 'Kavita', completed_bookings: 0, paid_amount: 0 }),
  ];
  assert.equal(filterStaffRows(rows, { query: 'ro' })[0].staff_name, 'Rohan');
  assert.equal(filterStaffRows(rows, { staffId: 'k' }).length, 1);
  assert.equal(sortStaffRows(rows, 'completed_bookings', 'desc')[0].staff_name, 'Ananya');
  assert.equal(sortStaffRows(rows, 'paid_amount', 'asc')[0].staff_name, 'Kavita');
  const page = paginateRows(rows, 2, 2);
  assert.equal(page.pages, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].staff_name, 'Kavita');
});

test('leaderboard badges and most-improved from RPC ranks', () => {
  const ananya: StaffLast7DaysRow = {
    staff_id: 'a',
    staff_name: 'Ananya',
    staff_photo: null,
    booking_count_7d: 3,
    completed_booking_count_7d: 3,
    gross_amount_7d: 2400,
    discount_amount_7d: 100,
    net_amount_7d: 2300,
    paid_amount_7d: 2200,
    commission_amount_7d: 690,
    salon_amount_7d: 1610,
    review_count_7d: 2,
    average_rating_7d: 5,
    booking_rank: 1,
    payment_rank: 1,
    review_rank: 1,
    overall_rank: 1,
  };
  const rohan: StaffLast7DaysRow = {
    ...ananya,
    staff_id: 'r',
    staff_name: 'Rohan',
    completed_booking_count_7d: 4,
    booking_rank: 2,
    payment_rank: 2,
    review_rank: 2,
    overall_rank: 2,
  };
  const improved = mostImprovedStaffId([ananya, rohan], {
    a: { completed_bookings: 3 },
    r: { completed_bookings: 1 },
  });
  assert.equal(improved, 'r');
  const badges = leaderBadgesFor(ananya, { mostImprovedStaffId: improved });
  assert.ok(badges.includes('Best Overall'));
  assert.ok(badges.includes('Booking Leader'));
  assert.ok(badges.includes('Revenue Leader'));
  assert.ok(badges.includes('Review Leader'));
  assert.equal(badges.includes('Most Improved'), false);
  assert.ok(leaderBadgesFor(rohan, { mostImprovedStaffId: improved }).includes('Most Improved'));
  assert.equal(bookingGrowthPercent(4, 1), 300);
});

test('CSV export uses the Phase 2 field list and escapes commas', () => {
  const csv = csvFromExportRows([
    {
      staff_name: 'Ananya, Senior',
      staff_role: 'Stylist',
      total_bookings: 3,
      completed_bookings: 3,
      cancelled_bookings: 0,
      gross_amount: 2400,
      discount_amount: 100,
      net_amount: 2300,
      paid_amount: 2200,
      commission_rate: 30,
      commission_amount: 690,
      salon_amount: 1610,
      review_count: 2,
      average_rating: 5,
    },
  ]);
  assert.ok(csv.startsWith('Staff name,Role,Total bookings,Completed bookings,Cancelled bookings,Gross amount,Discount amount,Net revenue,Paid amount,Commission rate,Commission amount,Salon share,Review count,Average rating'));
  assert.ok(csv.includes('"Ananya, Senior"'));
  assert.ok(csv.includes(',690,'));
});

test('error classifier maps owner-only and missing RPC failures', () => {
  assert.equal(classifyStaffPerformanceError({ code: '42501', message: 'Staff performance dashboard is owner-only' }).code, 'owner_access_denied');
  assert.equal(classifyStaffPerformanceError({ message: 'JWT expired' }).code, 'session_expired');
  assert.equal(classifyStaffPerformanceError({ code: 'PGRST202', message: 'function get_owner_staff_performance does not exist' }).code, 'rpc_unavailable');
  assert.equal(classifyStaffPerformanceError({ message: 'row-level security' }).code, 'database_error');
  assert.equal(classifyStaffPerformanceError({ code: '57014', message: 'Staff performance query timed out' }).code, 'database_error');
  assert.equal(classifyStaffPerformanceError({ code: '42501', message: 'permission denied for staff' }).retryable, false);
});

test('currency formatting and customer privacy label', () => {
  assert.equal(formatInr(2200), '₹2,200.00');
  assert.equal(formatInr(690.5), '₹690.50');
  assert.equal(publicCustomerLabel('Priya Sharma'), 'Priya');
  assert.equal(publicCustomerLabel(''), 'Client');
  assert.equal(percentChange(10, 5), 100);
  assert.equal(percentChange(0, 0), 0);
});

test('daily series fills missing days with zero instead of undefined', () => {
  const series = dailySeries(
    [
      {
        performance_date: '2026-09-08',
        staff_id: 'a',
        staff_name: 'Ananya',
        bookings: 2,
        completed_bookings: 2,
        gross_amount: 0,
        discount_amount: 0,
        net_amount: 0,
        paid_amount: 500,
        commission_amount: 0,
        salon_amount: 0,
        reviews: 0,
        average_rating: 0,
      },
    ],
    '2026-09-07',
    '2026-09-08',
    'bookings'
  );
  assert.deepEqual(series, [
    { date: '2026-09-07', value: 0 },
    { date: '2026-09-08', value: 2 },
  ]);
  const bars = chartStaffBars([row({ staff_id: 'a', staff_name: 'Ananya', net_amount: 2300 })], 'net_amount');
  assert.equal(bars[0].value, 2300);
});

test('detail parser keeps RPC numbers and does not require phone/email', () => {
  const detail = parseStaffDetail({
    staff_profile: { staff_id: 'a', staff_name: 'Ananya', staff_photo: null, staff_role: 'Stylist' },
    booking_status_summary: { total_bookings: 3, pending_bookings: 0, confirmed_bookings: 0, completed_bookings: 3, cancelled_bookings: 0 },
    payment_summary: { gross_amount: 2400, paid_amount: 2200, outstanding_amount: 100 },
    discount_summary: { discount_amount: 100, net_amount: 2300 },
    commission_calculation: { commission_rate: 30, commission_amount: 690 },
    salon_share: { salon_amount: 1610 },
    review_summary: { review_count: 2, average_rating: 5 },
    rating_distribution: { five_star_reviews: 2, four_star_reviews: 0, three_star_reviews: 0, two_star_reviews: 0, one_star_reviews: 0 },
    top_services: [{ service_name: 'Cut', completed_bookings: 2, gross_amount: 1500 }],
    recent_appointments: [{ booking_id: 'b1', performance_date: '2026-09-08', customer_name: 'Priya Sharma', status: 'completed', payment_status: 'paid_full', service_name: 'Cut', gross_amount: 800, paid_amount: 800 }],
    last_7_days: { overall_rank: 1, completed_booking_count_7d: 3 },
  });
  assert.equal(detail.commission_calculation.commission_amount, 690);
  assert.equal(detail.recent_appointments[0].customer_name, 'Priya Sharma');
  assert.equal('phone' in detail.recent_appointments[0], false);
});

test('a signed-out visitor sees access denied, not dashboard numbers', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffPerformanceDashboard, { user: null, onRequireAuth: () => {} })
  );
  assert.ok(html.includes('Access denied'));
  assert.ok(html.includes('session expired') || html.includes('Sign in'));
  assert.equal(html.includes('data-kpi='), false, 'must not render KPI values while signed out');
  assert.equal(html.includes('Ananya'), false);
});

test('a signed-in owner sees the Staff Performance shell before RPCs return', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffPerformanceDashboard, {
      user: { id: 'owner-1' },
      salonName: 'Luxe Salon',
    })
  );
  assert.ok(html.includes('Staff Performance'));
  assert.ok(html.includes('Last 7 Days'));
  assert.ok(html.includes('CSV Export'));
  assert.ok(html.includes('Refresh'));
  assert.ok(html.includes('Today'));
  assert.ok(html.includes('Last 30 Days'));
  assert.ok(html.includes('This Month'));
  assert.ok(html.includes('All Staff'));
  assert.ok(html.includes('kpi-skeleton') || html.includes('Total Bookings'));
});

test('the dashboard talks to Phase 2 RPCs and never logs row payloads', () => {
  const api = readFileSync('src/lib/staffPerformanceApi.ts', 'utf8');
  const ui = readFileSync('src/components/StaffPerformanceDashboard.tsx', 'utf8');
  for (const rpc of STAFF_PERFORMANCE_RPCS.filter((name) => name.startsWith('get_owner') || name === 'refresh_staff_performance_daily' || name === 'is_staff_dashboard_owner')) {
    assert.ok(api.includes(rpc), `API client missing ${rpc}`);
  }
  assert.ok(api.includes('auth.getSession'));
  assert.ok(api.includes("from('profiles')"));
  assert.equal(/console\.(log|debug|info)\(.*rows/.test(api), false);
  assert.equal(/console\.(log|debug|info)\(.*paid_amount/.test(ui), false);
  assert.ok(ui.includes('publicCustomerLabel'));
  assert.ok(ui.includes('get_owner_staff_export') === false, 'export goes through the API module');
  assert.ok(api.includes('get_owner_staff_export'));
  assert.equal(api.includes("rpc('calculate_staff_commission'"), false);
  assert.ok(api.includes('STAFF_RPC_TIMEOUT_MS'));
  assert.ok(ui.includes('STAFF_FILTER_DEBOUNCE_MS'));
  assert.ok(ui.includes('previousPeriod'));
  assert.ok(ui.includes('Escape'));
  assert.equal(STAFF_FILTER_DEBOUNCE_MS >= 250 && STAFF_FILTER_DEBOUNCE_MS <= 500, true);
  assert.equal(STAFF_RPC_TIMEOUT_MS >= 8000, true);
});

test('App.tsx mounts the page on the owner route', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.ok(app.includes('StaffPerformanceDashboard'));
  assert.ok(app.includes('isStaffPerformancePath'));
  assert.ok(app.includes('STAFF_PERFORMANCE_PATH'));
  assert.ok(app.includes('staffPerformance'));
});
