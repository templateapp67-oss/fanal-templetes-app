// Owner-only staff performance alerts + weekly reports (Phase 6).
// Separate from Header NotificationBell / in_app_notifications.

import { asFiniteNumber, formatInr, formatRating } from './staffPerformance';

export const STAFF_NOTIFICATION_RPCS = [
  'get_owner_staff_notifications',
  'mark_staff_notification_read',
  'mark_all_staff_notifications_read',
  'get_owner_weekly_staff_report',
  'generate_staff_weekly_report',
  'update_staff_notification_preferences',
] as const;

export const STAFF_NOTIFICATION_TABLES = [
  'staff_performance_notifications',
  'staff_weekly_reports',
  'notification_preferences',
] as const;

export const STAFF_ALERT_TYPES = [
  'low_bookings',
  'high_cancellation',
  'new_review',
  'rating_drop',
  'commission_increase',
  'top_payment',
  'pending_payout',
  'refund_affects_commission',
  'weekly_report',
] as const;

export type StaffAlertType = (typeof STAFF_ALERT_TYPES)[number];

export type StaffNotificationPrefs = Record<StaffAlertType, boolean>;

export const DEFAULT_STAFF_NOTIFICATION_PREFS: StaffNotificationPrefs = {
  low_bookings: true,
  high_cancellation: true,
  new_review: true,
  rating_drop: true,
  commission_increase: true,
  top_payment: true,
  pending_payout: true,
  refund_affects_commission: true,
  weekly_report: true,
};

export const STAFF_ALERT_LABELS: Record<StaffAlertType, string> = {
  low_bookings: 'Low bookings',
  high_cancellation: 'High cancellations',
  new_review: 'New reviews',
  rating_drop: 'Rating drops',
  commission_increase: 'Commission increases',
  top_payment: 'Top payments',
  pending_payout: 'Pending payouts',
  refund_affects_commission: 'Refunds affecting commission',
  weekly_report: 'Weekly report ready',
};

export interface StaffPerformanceNotification {
  id: string;
  staff_id: string | null;
  staff_name: string;
  notification_type: StaffAlertType | string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  unread_count: number;
}

export interface WeeklyLeader {
  staff_id: string;
  staff_name: string;
  value: number;
}

export interface WeeklyStaffRow {
  staff_id: string;
  staff_name: string;
  total_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
  paid_amount: number;
  discount_amount: number;
  commission_amount: number;
  review_count: number;
  average_rating: number;
  booking_rank: number;
  payment_rank: number;
  review_rank: number;
  overall_rank: number;
  completed_delta: number;
}

export interface WeeklyReportData {
  period_start: string;
  period_end: string;
  previous_period_start: string;
  previous_period_end: string;
  timezone: string;
  staff_count: number;
  has_activity: boolean;
  leaders: {
    booking: WeeklyLeader | null;
    payment: WeeklyLeader | null;
    review: WeeklyLeader | null;
    highest_rated: WeeklyLeader | null;
    most_improved: WeeklyLeader | null;
    commission: WeeklyLeader | null;
    discount: WeeklyLeader | null;
    overall: WeeklyLeader | null;
  };
  staff: WeeklyStaffRow[];
}

export interface WeeklyStaffReport {
  id: string;
  salon_id: string;
  report_period_start: string;
  report_period_end: string;
  generation_status: 'ready' | 'failed' | 'pending' | string;
  attempt_count: number;
  report_data: WeeklyReportData;
}

const CUSTOMER_PII_KEYS = ['customer_name', 'customer_phone', 'phone', 'email', 'user_id'];

export function isStaffAlertType(value: string): value is StaffAlertType {
  return (STAFF_ALERT_TYPES as readonly string[]).includes(value);
}

export function normalizeNotificationPrefs(raw: unknown): StaffNotificationPrefs {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_STAFF_NOTIFICATION_PREFS };
  for (const key of STAFF_ALERT_TYPES) {
    if (key in src) out[key] = src[key] !== false;
  }
  return out;
}

export function normalizeNotification(row: Record<string, unknown>): StaffPerformanceNotification {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: String(row.id || ''),
    staff_id: row.staff_id ? String(row.staff_id) : null,
    staff_name: String(row.staff_name || 'Staff'),
    notification_type: String(row.notification_type || ''),
    title: String(row.title || 'Alert'),
    message: String(row.message || ''),
    metadata,
    is_read: row.is_read === true,
    created_at: String(row.created_at || ''),
    unread_count: asFiniteNumber(row.unread_count),
  };
}

function asLeader(value: unknown): WeeklyLeader | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const staff_id = String(row.staff_id || '');
  const staff_name = String(row.staff_name || '');
  if (!staff_id && !staff_name) return null;
  return { staff_id, staff_name: staff_name || 'Staff', value: asFiniteNumber(row.value) };
}

function asWeeklyStaff(row: Record<string, unknown>): WeeklyStaffRow {
  return {
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    total_bookings: asFiniteNumber(row.total_bookings),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    cancelled_bookings: asFiniteNumber(row.cancelled_bookings),
    paid_amount: asFiniteNumber(row.paid_amount),
    discount_amount: asFiniteNumber(row.discount_amount),
    commission_amount: asFiniteNumber(row.commission_amount),
    review_count: asFiniteNumber(row.review_count),
    average_rating: asFiniteNumber(row.average_rating),
    booking_rank: asFiniteNumber(row.booking_rank),
    payment_rank: asFiniteNumber(row.payment_rank),
    review_rank: asFiniteNumber(row.review_rank),
    overall_rank: asFiniteNumber(row.overall_rank),
    completed_delta: asFiniteNumber(row.completed_delta),
  };
}

export function normalizeWeeklyReport(payload: unknown): WeeklyStaffReport | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const dataRaw =
    raw.report_data && typeof raw.report_data === 'object' ? (raw.report_data as Record<string, unknown>) : {};
  const leadersRaw =
    dataRaw.leaders && typeof dataRaw.leaders === 'object' ? (dataRaw.leaders as Record<string, unknown>) : {};
  const staff = Array.isArray(dataRaw.staff)
    ? dataRaw.staff.map((row) => asWeeklyStaff((row || {}) as Record<string, unknown>))
    : [];
  return {
    id: String(raw.id || ''),
    salon_id: String(raw.salon_id || ''),
    report_period_start: String(raw.report_period_start || dataRaw.period_start || '').slice(0, 10),
    report_period_end: String(raw.report_period_end || dataRaw.period_end || '').slice(0, 10),
    generation_status: String(raw.generation_status || 'ready'),
    attempt_count: asFiniteNumber(raw.attempt_count, 1),
    report_data: {
      period_start: String(dataRaw.period_start || '').slice(0, 10),
      period_end: String(dataRaw.period_end || '').slice(0, 10),
      previous_period_start: String(dataRaw.previous_period_start || '').slice(0, 10),
      previous_period_end: String(dataRaw.previous_period_end || '').slice(0, 10),
      timezone: String(dataRaw.timezone || 'UTC'),
      staff_count: asFiniteNumber(dataRaw.staff_count, staff.length),
      has_activity: dataRaw.has_activity === true,
      leaders: {
        booking: asLeader(leadersRaw.booking),
        payment: asLeader(leadersRaw.payment),
        review: asLeader(leadersRaw.review),
        highest_rated: asLeader(leadersRaw.highest_rated),
        most_improved: asLeader(leadersRaw.most_improved),
        commission: asLeader(leadersRaw.commission),
        discount: asLeader(leadersRaw.discount),
        overall: asLeader(leadersRaw.overall),
      },
      staff,
    },
  };
}

export function unreadCountFromNotifications(rows: StaffPerformanceNotification[]): number {
  if (rows.length === 0) return 0;
  const advertised = asFiniteNumber(rows[0].unread_count);
  if (advertised > 0) return advertised;
  return rows.filter((row) => !row.is_read).length;
}

export function weeklyReportHasCustomerPii(data: WeeklyReportData | Record<string, unknown>): boolean {
  const blob = JSON.stringify(data).toLowerCase();
  return CUSTOMER_PII_KEYS.some((key) => blob.includes(`"${key}"`));
}

export function topPerformerName(report: WeeklyStaffReport | null): string | null {
  const overall = report?.report_data.leaders.overall;
  if (!overall?.staff_name) return null;
  return overall.staff_name;
}

export function leaderValueLabel(
  key: keyof WeeklyReportData['leaders'],
  leader: WeeklyLeader | null,
  currencySymbol = '₹'
): string {
  if (!leader) return '—';
  if (key === 'payment' || key === 'commission' || key === 'discount') {
    return `${leader.staff_name} · ${formatInr(leader.value, currencySymbol)}`;
  }
  if (key === 'highest_rated') {
    return `${leader.staff_name} · ${formatRating(leader.value)}`;
  }
  if (key === 'overall') return leader.staff_name;
  return `${leader.staff_name} · ${leader.value}`;
}

export function formatNotificationTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
