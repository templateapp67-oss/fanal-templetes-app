import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffPerformanceDashboard } from '../src/components/StaffPerformanceDashboard';
import { StaffPerformanceAlerts } from '../src/components/StaffPerformanceAlerts';
import {
  DEFAULT_STAFF_NOTIFICATION_PREFS,
  STAFF_ALERT_TYPES,
  STAFF_NOTIFICATION_RPCS,
  STAFF_NOTIFICATION_TABLES,
  leaderValueLabel,
  normalizeNotification,
  normalizeNotificationPrefs,
  normalizeWeeklyReport,
  topPerformerName,
  unreadCountFromNotifications,
  weeklyReportHasCustomerPii,
} from '../src/lib/staffNotifications';

test('phase 6 RPCs and tables are the owner-only contract', () => {
  assert.deepEqual([...STAFF_NOTIFICATION_RPCS], [
    'get_owner_staff_notifications',
    'mark_staff_notification_read',
    'mark_all_staff_notifications_read',
    'get_owner_weekly_staff_report',
    'generate_staff_weekly_report',
    'update_staff_notification_preferences',
  ]);
  assert.ok(STAFF_NOTIFICATION_TABLES.includes('staff_performance_notifications'));
  assert.ok(STAFF_NOTIFICATION_TABLES.includes('staff_weekly_reports'));
  assert.ok(STAFF_ALERT_TYPES.includes('pending_payout'));
});

test('notification prefs ignore unknown keys and default to on', () => {
  const prefs = normalizeNotificationPrefs({ low_bookings: false, bogus: true });
  assert.equal(prefs.low_bookings, false);
  assert.equal(prefs.weekly_report, true);
  assert.equal('bogus' in prefs, false);
  assert.equal(DEFAULT_STAFF_NOTIFICATION_PREFS.new_review, true);
});

test('unread count prefers RPC unread_count then falls back to is_read', () => {
  const rows = [
    normalizeNotification({ id: '1', title: 'A', is_read: false, unread_count: 4 }),
    normalizeNotification({ id: '2', title: 'B', is_read: true, unread_count: 4 }),
  ];
  assert.equal(unreadCountFromNotifications(rows), 4);
  assert.equal(
    unreadCountFromNotifications([
      normalizeNotification({ id: '1', is_read: false }),
      normalizeNotification({ id: '2', is_read: true }),
    ]),
    1
  );
  assert.equal(unreadCountFromNotifications([]), 0);
});

test('weekly report parser keeps leaders and rejects customer PII keys', () => {
  const report = normalizeWeeklyReport({
    id: 'r1',
    salon_id: 's1',
    report_period_start: '2026-09-02',
    report_period_end: '2026-09-08',
    generation_status: 'ready',
    attempt_count: 1,
    report_data: {
      period_start: '2026-09-02',
      period_end: '2026-09-08',
      previous_period_start: '2026-08-26',
      previous_period_end: '2026-09-01',
      has_activity: true,
      leaders: {
        overall: { staff_id: 'a', staff_name: 'Ananya', value: 1 },
        booking: { staff_id: 'a', staff_name: 'Ananya', value: 3 },
        payment: { staff_id: 'a', staff_name: 'Ananya', value: 2200 },
      },
      staff: [{ staff_id: 'a', staff_name: 'Ananya', completed_bookings: 3, overall_rank: 1, completed_delta: 2 }],
    },
  });
  assert.equal(topPerformerName(report), 'Ananya');
  assert.equal(weeklyReportHasCustomerPii(report!.report_data), false);
  assert.ok(leaderValueLabel('payment', report!.report_data.leaders.payment).includes('Ananya'));
  assert.equal(
    weeklyReportHasCustomerPii({ customer_name: 'Priya', staff: [] } as unknown as Record<string, unknown>),
    true
  );
});

test('staff alerts mount on the performance dashboard, not the booking bell', () => {
  const ui = readFileSync('src/components/StaffPerformanceDashboard.tsx', 'utf8');
  const bell = readFileSync('src/components/NotificationBell.tsx', 'utf8');
  const api = readFileSync('src/lib/staffNotificationsApi.ts', 'utf8');
  const sql = readFileSync('supabase/migrations/20260910_staff_performance_notifications.sql', 'utf8');
  assert.ok(ui.includes('StaffPerformanceAlerts'));
  assert.ok(ui.includes('onOpenCommission'));
  assert.equal(bell.includes('get_owner_staff_notifications'), false);
  assert.equal(bell.includes('staff_performance_notifications'), false);
  for (const rpc of STAFF_NOTIFICATION_RPCS) {
    assert.ok(api.includes(rpc), `API missing ${rpc}`);
    assert.ok(sql.includes(rpc), `SQL missing ${rpc}`);
  }
  assert.equal(/console\.(log|debug|info)\(/.test(api), false);
  assert.ok(sql.includes('staff_dashboard_assert_owner'));
  assert.ok(sql.includes('uq_staff_weekly_reports_period'));
});

test('signed-out visitors still cannot see staff alerts', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffPerformanceDashboard, { user: null, onRequireAuth: () => {} })
  );
  assert.ok(html.includes('Access denied'));
  assert.equal(html.includes('staff-weekly-report-card'), false);
  assert.equal(html.includes('staff-alert-unread'), false);
});

test('owner shell includes the alerts surface once a salon id is known', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffPerformanceAlerts, { salonId: 'owner-1', currencySymbol: '₹' })
  );
  assert.ok(html.includes('Staff alerts'));
  assert.ok(html.includes('Weekly staff report'));
  assert.ok(html.includes('Alert preferences'));
  assert.ok(html.includes('staff-performance-alerts-bell'));
});
