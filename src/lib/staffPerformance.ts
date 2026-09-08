// ==============================================================================
// Owner-only Staff Performance Dashboard — RPC contract + pure UI helpers.
// Physical mapping (see supabase/migrations/20260908_staff_performance_dashboard_backend.sql):
//   salon_id  → profiles.id (= auth.uid() of the salon owner)
//   staff_id  → stylists.id
//   bookings  → public.bookings (staff in metadata.staff_id / metadata.services[].staff_id)
//   payments  → bookings.payment_status + advance_paid_amount (no payments table)
//   reviews   → bookings.metadata.review_rating
//
// Table / card / chart numbers come from the Phase 2 RPCs. This module only
// formats, filters, sorts, and sums those already-authoritative rows.
// ==============================================================================

export const STAFF_PERFORMANCE_RPCS = [
  'get_owner_staff_performance',
  'get_owner_staff_last_7_days',
  'get_owner_staff_daily_performance',
  'get_owner_staff_detail',
  'get_owner_staff_export',
  'refresh_staff_performance_daily',
  'calculate_staff_commission',
  'is_staff_dashboard_owner',
] as const;

export const STAFF_PERFORMANCE_TABLES = [
  'staff_commission_settings',
  'staff_performance_daily',
  'staff_performance_audit',
] as const;

export const STAFF_PERFORMANCE_PATH = '/owner/dashboard/staff-performance';

/** Date-filter RPC debounce. Search is client-side and does not hit the network. */
export const STAFF_FILTER_DEBOUNCE_MS = 300;

/** Abort a hung PostgREST call so the dashboard can show a retryable error. */
export const STAFF_RPC_TIMEOUT_MS = 15000;

export type StaffCommissionType = 'percentage' | 'fixed' | 'none';

export type StaffDatePreset = 'today' | 'last_7' | 'last_30' | 'this_month' | 'custom';

export type StaffPerformanceErrorCode =
  | 'session_expired'
  | 'owner_access_denied'
  | 'salon_not_found'
  | 'rpc_unavailable'
  | 'database_error'
  | 'no_staff'
  | 'no_bookings'
  | 'no_payment_data'
  | 'no_review_data'
  | 'export_failed'
  | 'unknown';

export interface StaffPerformanceError {
  code: StaffPerformanceErrorCode;
  message: string;
  retryable: boolean;
}

export interface StaffPerformanceSummaryRow {
  staff_id: string;
  staff_name: string;
  staff_photo: string | null;
  staff_role: string;
  total_bookings: number;
  pending_bookings: number;
  confirmed_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  paid_amount: number;
  commission_rate: number;
  commission_amount: number;
  salon_amount: number;
  review_count: number;
  average_rating: number;
  five_star_reviews: number;
  four_star_reviews: number;
  three_star_reviews: number;
  two_star_reviews: number;
  one_star_reviews: number;
}

export interface StaffLast7DaysRow {
  staff_id: string;
  staff_name: string;
  staff_photo: string | null;
  booking_count_7d: number;
  completed_booking_count_7d: number;
  gross_amount_7d: number;
  discount_amount_7d: number;
  net_amount_7d: number;
  paid_amount_7d: number;
  commission_amount_7d: number;
  salon_amount_7d: number;
  review_count_7d: number;
  average_rating_7d: number;
  booking_rank: number;
  payment_rank: number;
  review_rank: number;
  overall_rank: number;
}

export interface StaffDailyPerformanceRow {
  performance_date: string;
  staff_id: string;
  staff_name: string;
  bookings: number;
  completed_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  paid_amount: number;
  commission_amount: number;
  salon_amount: number;
  reviews: number;
  average_rating: number;
}

export interface StaffCommissionResult {
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  commission_type: StaffCommissionType;
  commission_rate: number;
  commission_amount: number;
  salon_amount: number;
}

export interface StaffExportRow {
  staff_name: string;
  staff_role: string;
  total_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  paid_amount: number;
  commission_rate: number;
  commission_amount: number;
  salon_amount: number;
  review_count: number;
  average_rating: number;
}

export interface StaffServiceSummary {
  service_id?: string;
  service_name: string;
  bookings?: number;
  completed_bookings: number;
  gross_amount: number;
}

export interface StaffRecentAppointment {
  booking_id: string;
  performance_date: string;
  time_slot: string | null;
  status: string;
  payment_status: string;
  service_name: string | null;
  customer_name: string | null;
  gross_amount: number;
  paid_amount: number;
}

export interface StaffDetailPayload {
  staff_profile: {
    staff_id: string;
    staff_name: string;
    staff_photo: string | null;
    staff_role: string;
  };
  booking_status_summary: {
    total_bookings: number;
    pending_bookings: number;
    confirmed_bookings: number;
    completed_bookings: number;
    cancelled_bookings: number;
  };
  payment_summary: {
    gross_amount: number;
    paid_amount: number;
    outstanding_amount: number;
  };
  discount_summary: {
    discount_amount: number;
    net_amount: number;
  };
  commission_calculation: {
    commission_rate: number;
    commission_amount: number;
  };
  salon_share: {
    salon_amount: number;
  };
  review_summary: {
    review_count: number;
    average_rating: number;
  };
  rating_distribution: {
    five_star_reviews: number;
    four_star_reviews: number;
    three_star_reviews: number;
    two_star_reviews: number;
    one_star_reviews: number;
  };
  service_wise_booking_summary: StaffServiceSummary[];
  top_services: StaffServiceSummary[];
  recent_appointments: StaffRecentAppointment[];
  last_7_days: Partial<StaffLast7DaysRow> | Record<string, never>;
}

export interface DateRange {
  from: string;
  to: string;
  preset: StaffDatePreset;
}

export interface SalonTotals {
  total_bookings: number;
  completed_bookings: number;
  paid_amount: number;
  discount_amount: number;
  commission_amount: number;
  net_amount: number;
  salon_amount: number;
  review_count: number;
  average_rating: number;
}

export type StaffNumericSortKey =
  | 'total_bookings'
  | 'completed_bookings'
  | 'cancelled_bookings'
  | 'gross_amount'
  | 'discount_amount'
  | 'net_amount'
  | 'paid_amount'
  | 'commission_rate'
  | 'commission_amount'
  | 'salon_amount'
  | 'review_count'
  | 'average_rating'
  | 'seven_day_rank'
  | 'staff_name';

export type StaffLeaderBadge =
  | 'Best Overall'
  | 'Booking Leader'
  | 'Revenue Leader'
  | 'Review Leader'
  | 'Most Improved';

export const STAFF_PERFORMANCE_ERROR_COPY: Record<StaffPerformanceErrorCode, string> = {
  session_expired: 'Your session expired. Sign in again to open Staff Performance.',
  owner_access_denied: 'Staff Performance is owner-only. Customers and staff cannot view this dashboard.',
  salon_not_found: 'We could not find a salon for this owner account.',
  rpc_unavailable: 'Staff Performance RPCs are unavailable. Apply the Phase 2 SQL migration, then retry.',
  database_error: 'The database rejected this request (RLS or query error).',
  no_staff: 'No staff found for this salon yet.',
  no_bookings: 'No bookings in the selected date range.',
  no_payment_data: 'No successful payments in the selected date range.',
  no_review_data: 'No reviews in the selected date range.',
  export_failed: 'CSV export failed. Try again.',
  unknown: 'Something went wrong.',
};

export const CSV_EXPORT_HEADERS = [
  'Staff name',
  'Role',
  'Total bookings',
  'Completed bookings',
  'Cancelled bookings',
  'Gross amount',
  'Discount amount',
  'Net revenue',
  'Paid amount',
  'Commission rate',
  'Commission amount',
  'Salon share',
  'Review count',
  'Average rating',
] as const;

export function asFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = String(iso || '').split('-').map((part) => Number(part));
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function inclusiveDayCount(from: string, to: string): number {
  const a = parseIsoDate(from).getTime();
  const b = parseIsoDate(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = inclusiveDayCount(from, to);
  if (days <= 0) return { from, to };
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

export function lastSevenCivilDays(today = toIsoDate(new Date())): { from: string; to: string } {
  return { from: addDaysIso(today, -6), to: today };
}

export function resolveDateRange(
  preset: StaffDatePreset,
  options?: { today?: string; customFrom?: string; customTo?: string }
): DateRange {
  const today = options?.today || toIsoDate(new Date());
  if (preset === 'today') return { preset, from: today, to: today };
  if (preset === 'last_7') return { preset, from: addDaysIso(today, -6), to: today };
  if (preset === 'last_30') return { preset, from: addDaysIso(today, -29), to: today };
  if (preset === 'this_month') {
    const d = parseIsoDate(today);
    const from = toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
    return { preset, from, to: today };
  }
  const customFrom = options?.customFrom || today;
  const customTo = options?.customTo || today;
  const from = customFrom <= customTo ? customFrom : customTo;
  const to = customFrom <= customTo ? customTo : customFrom;
  return { preset: 'custom', from, to };
}

export function formatInr(amount: unknown, currencySymbol = '₹'): string {
  const n = asFiniteNumber(amount, 0);
  return `${currencySymbol}${n.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function formatRating(value: unknown): string {
  const n = asFiniteNumber(value, 0);
  if (n <= 0) return '—';
  return n.toFixed(2);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

export function percentChange(current: number, previous: number): number | null {
  const cur = asFiniteNumber(current, 0);
  const prev = asFiniteNumber(previous, 0);
  if (prev === 0 && cur === 0) return 0;
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export function staffInitials(name: string | null | undefined): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** First name only — never phone, email, or a full customer record. */
export function publicCustomerLabel(name: string | null | undefined): string {
  const first = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  return first || 'Client';
}

export function classifyStaffPerformanceError(err: unknown): StaffPerformanceError {
  const raw = err as { code?: string; message?: string; details?: string; hint?: string; status?: number } | null;
  const blob = `${raw?.code || ''} ${raw?.message || ''} ${raw?.details || ''} ${raw?.hint || ''}`.toLowerCase();
  if (!raw) {
    return { code: 'unknown', message: STAFF_PERFORMANCE_ERROR_COPY.unknown, retryable: true };
  }
  if (
    blob.includes('jwt') ||
    blob.includes('session') ||
    blob.includes('not authenticated') ||
    blob.includes('invalid claim') ||
    raw.status === 401
  ) {
    return { code: 'session_expired', message: STAFF_PERFORMANCE_ERROR_COPY.session_expired, retryable: false };
  }
  if (
    raw.code === '42501' ||
    blob.includes('owner-only') ||
    blob.includes('permission denied') ||
    blob.includes('not authorized') ||
    raw.status === 403
  ) {
    return { code: 'owner_access_denied', message: STAFF_PERFORMANCE_ERROR_COPY.owner_access_denied, retryable: false };
  }
  if (blob.includes('timed out') || blob.includes('timeout') || raw.code === '57014') {
    return { code: 'database_error', message: STAFF_PERFORMANCE_ERROR_COPY.database_error, retryable: true };
  }
  if (
    blob.includes('function') && (blob.includes('does not exist') || blob.includes('not found') || blob.includes('pgrst202'))
  ) {
    return { code: 'rpc_unavailable', message: STAFF_PERFORMANCE_ERROR_COPY.rpc_unavailable, retryable: true };
  }
  if (blob.includes('pgrst') || blob.includes('rls') || blob.includes('row-level') || blob.includes('42p01')) {
    return { code: 'database_error', message: STAFF_PERFORMANCE_ERROR_COPY.database_error, retryable: true };
  }
  if (blob.includes('salon not found') || blob.includes('no profile')) {
    return { code: 'salon_not_found', message: STAFF_PERFORMANCE_ERROR_COPY.salon_not_found, retryable: false };
  }
  return { code: 'unknown', message: STAFF_PERFORMANCE_ERROR_COPY.unknown, retryable: true };
}

export function normalizeSummaryRow(row: Record<string, unknown> | StaffPerformanceSummaryRow): StaffPerformanceSummaryRow {
  return {
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    staff_photo: (row.staff_photo as string | null) ?? null,
    staff_role: String(row.staff_role || ''),
    total_bookings: asFiniteNumber(row.total_bookings),
    pending_bookings: asFiniteNumber(row.pending_bookings),
    confirmed_bookings: asFiniteNumber(row.confirmed_bookings),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    cancelled_bookings: asFiniteNumber(row.cancelled_bookings),
    gross_amount: asFiniteNumber(row.gross_amount),
    discount_amount: asFiniteNumber(row.discount_amount),
    net_amount: asFiniteNumber(row.net_amount),
    paid_amount: asFiniteNumber(row.paid_amount),
    commission_rate: asFiniteNumber(row.commission_rate),
    commission_amount: asFiniteNumber(row.commission_amount),
    salon_amount: asFiniteNumber(row.salon_amount),
    review_count: asFiniteNumber(row.review_count),
    average_rating: asFiniteNumber(row.average_rating),
    five_star_reviews: asFiniteNumber(row.five_star_reviews),
    four_star_reviews: asFiniteNumber(row.four_star_reviews),
    three_star_reviews: asFiniteNumber(row.three_star_reviews),
    two_star_reviews: asFiniteNumber(row.two_star_reviews),
    one_star_reviews: asFiniteNumber(row.one_star_reviews),
  };
}

export function normalizeLast7Row(row: Record<string, unknown> | StaffLast7DaysRow): StaffLast7DaysRow {
  return {
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    staff_photo: (row.staff_photo as string | null) ?? null,
    booking_count_7d: asFiniteNumber(row.booking_count_7d),
    completed_booking_count_7d: asFiniteNumber(row.completed_booking_count_7d),
    gross_amount_7d: asFiniteNumber(row.gross_amount_7d),
    discount_amount_7d: asFiniteNumber(row.discount_amount_7d),
    net_amount_7d: asFiniteNumber(row.net_amount_7d),
    paid_amount_7d: asFiniteNumber(row.paid_amount_7d),
    commission_amount_7d: asFiniteNumber(row.commission_amount_7d),
    salon_amount_7d: asFiniteNumber(row.salon_amount_7d),
    review_count_7d: asFiniteNumber(row.review_count_7d),
    average_rating_7d: asFiniteNumber(row.average_rating_7d),
    booking_rank: asFiniteNumber(row.booking_rank),
    payment_rank: asFiniteNumber(row.payment_rank),
    review_rank: asFiniteNumber(row.review_rank),
    overall_rank: asFiniteNumber(row.overall_rank),
  };
}

export function normalizeDailyRow(row: Record<string, unknown> | StaffDailyPerformanceRow): StaffDailyPerformanceRow {
  return {
    performance_date: String(row.performance_date || '').slice(0, 10),
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    bookings: asFiniteNumber(row.bookings),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    gross_amount: asFiniteNumber(row.gross_amount),
    discount_amount: asFiniteNumber(row.discount_amount),
    net_amount: asFiniteNumber(row.net_amount),
    paid_amount: asFiniteNumber(row.paid_amount),
    commission_amount: asFiniteNumber(row.commission_amount),
    salon_amount: asFiniteNumber(row.salon_amount),
    reviews: asFiniteNumber(row.reviews),
    average_rating: asFiniteNumber(row.average_rating),
  };
}

export function normalizeExportRow(row: Record<string, unknown> | StaffExportRow): StaffExportRow {
  return {
    staff_name: String(row.staff_name || 'Staff'),
    staff_role: String(row.staff_role || ''),
    total_bookings: asFiniteNumber(row.total_bookings),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    cancelled_bookings: asFiniteNumber(row.cancelled_bookings),
    gross_amount: asFiniteNumber(row.gross_amount),
    discount_amount: asFiniteNumber(row.discount_amount),
    net_amount: asFiniteNumber(row.net_amount),
    paid_amount: asFiniteNumber(row.paid_amount),
    commission_rate: asFiniteNumber(row.commission_rate),
    commission_amount: asFiniteNumber(row.commission_amount),
    salon_amount: asFiniteNumber(row.salon_amount),
    review_count: asFiniteNumber(row.review_count),
    average_rating: asFiniteNumber(row.average_rating),
  };
}

export function aggregateSalonTotals(rows: StaffPerformanceSummaryRow[]): SalonTotals {
  const total_bookings = rows.reduce((s, r) => s + r.total_bookings, 0);
  const completed_bookings = rows.reduce((s, r) => s + r.completed_bookings, 0);
  const paid_amount = rows.reduce((s, r) => s + r.paid_amount, 0);
  const discount_amount = rows.reduce((s, r) => s + r.discount_amount, 0);
  const commission_amount = rows.reduce((s, r) => s + r.commission_amount, 0);
  const net_amount = rows.reduce((s, r) => s + r.net_amount, 0);
  const salon_amount = rows.reduce((s, r) => s + r.salon_amount, 0);
  const review_count = rows.reduce((s, r) => s + r.review_count, 0);
  const ratingWeight = rows.reduce((s, r) => s + r.average_rating * r.review_count, 0);
  return {
    total_bookings,
    completed_bookings,
    paid_amount,
    discount_amount,
    commission_amount,
    net_amount,
    salon_amount,
    review_count,
    average_rating: review_count > 0 ? Math.round((ratingWeight / review_count) * 100) / 100 : 0,
  };
}

export function filterStaffRows(
  rows: StaffPerformanceSummaryRow[],
  options: { query?: string; staffId?: string | null }
): StaffPerformanceSummaryRow[] {
  const query = String(options.query || '')
    .trim()
    .toLowerCase();
  const staffId = options.staffId || null;
  return rows.filter((row) => {
    if (staffId && row.staff_id !== staffId) return false;
    if (!query) return true;
    return (
      row.staff_name.toLowerCase().includes(query) ||
      row.staff_role.toLowerCase().includes(query)
    );
  });
}

export function sortStaffRows(
  rows: StaffPerformanceSummaryRow[],
  key: StaffNumericSortKey,
  direction: 'asc' | 'desc',
  ranks?: Record<string, number>
): StaffPerformanceSummaryRow[] {
  const copy = [...rows];
  const dir = direction === 'asc' ? 1 : -1;
  copy.sort((a, b) => {
    if (key === 'staff_name') {
      return a.staff_name.localeCompare(b.staff_name) * dir;
    }
    if (key === 'seven_day_rank') {
      const ra = ranks?.[a.staff_id] ?? Number.POSITIVE_INFINITY;
      const rb = ranks?.[b.staff_id] ?? Number.POSITIVE_INFINITY;
      if (ra === rb) return a.staff_name.localeCompare(b.staff_name);
      return (ra - rb) * dir;
    }
    const va = asFiniteNumber((a as unknown as Record<string, unknown>)[key]);
    const vb = asFiniteNumber((b as unknown as Record<string, unknown>)[key]);
    if (va === vb) return a.staff_name.localeCompare(b.staff_name);
    return (va - vb) * dir;
  });
  return copy;
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): { items: T[]; page: number; pages: number } {
  const size = Math.max(1, pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * size;
  return { items: rows.slice(start, start + size), page: safePage, pages };
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvFromExportRows(rows: StaffExportRow[]): string {
  const lines = [CSV_EXPORT_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.staff_name),
        csvCell(row.staff_role),
        csvCell(row.total_bookings),
        csvCell(row.completed_bookings),
        csvCell(row.cancelled_bookings),
        csvCell(row.gross_amount),
        csvCell(row.discount_amount),
        csvCell(row.net_amount),
        csvCell(row.paid_amount),
        csvCell(row.commission_rate),
        csvCell(row.commission_amount),
        csvCell(row.salon_amount),
        csvCell(row.review_count),
        csvCell(row.average_rating),
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export function bookingGrowthPercent(currentCompleted: number, previousCompleted: number): number | null {
  return percentChange(currentCompleted, previousCompleted);
}

export function ratingTrend(current: number, previous: number): number {
  return asFiniteNumber(current) - asFiniteNumber(previous);
}

export function leaderBadgesFor(
  row: StaffLast7DaysRow,
  options: { mostImprovedStaffId?: string | null }
): StaffLeaderBadge[] {
  const badges: StaffLeaderBadge[] = [];
  if (row.overall_rank === 1) badges.push('Best Overall');
  if (row.booking_rank === 1) badges.push('Booking Leader');
  if (row.payment_rank === 1) badges.push('Revenue Leader');
  if (row.review_rank === 1) badges.push('Review Leader');
  if (options.mostImprovedStaffId && row.staff_id === options.mostImprovedStaffId) {
    badges.push('Most Improved');
  }
  return badges;
}

export function mostImprovedStaffId(
  current: StaffLast7DaysRow[],
  previousByStaff: Record<string, { completed_bookings: number }>
): string | null {
  let bestId: string | null = null;
  let bestDelta = Number.NEGATIVE_INFINITY;
  for (const row of current) {
    const prev = previousByStaff[row.staff_id]?.completed_bookings ?? 0;
    const delta = row.completed_booking_count_7d - prev;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestId = row.staff_id;
    }
  }
  if (bestDelta <= 0) return null;
  return bestId;
}

export function dailySeries(
  rows: StaffDailyPerformanceRow[],
  from: string,
  to: string,
  metric: 'bookings' | 'paid_amount'
): Array<{ date: string; value: number }> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const key = row.performance_date;
    if (!key) continue;
    const add = metric === 'bookings' ? row.bookings : row.paid_amount;
    byDate.set(key, (byDate.get(key) || 0) + asFiniteNumber(add));
  }
  const out: Array<{ date: string; value: number }> = [];
  if (!from || !to || to < from) return out;
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    out.push({ date: cursor, value: byDate.get(cursor) || 0 });
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }
  return out;
}

export function chartStaffBars(
  rows: StaffPerformanceSummaryRow[],
  metric:
    | 'total_bookings'
    | 'net_amount'
    | 'commission_amount'
    | 'discount_amount'
    | 'review_count'
    | 'average_rating'
): Array<{ name: string; value: number; staff_id: string }> {
  return rows
    .map((row) => ({
      name: row.staff_name || 'Staff',
      value: asFiniteNumber((row as unknown as Record<string, unknown>)[metric]),
      staff_id: row.staff_id,
    }))
    .filter((row) => Number.isFinite(row.value));
}

export function emptyTotals(): SalonTotals {
  return {
    total_bookings: 0,
    completed_bookings: 0,
    paid_amount: 0,
    discount_amount: 0,
    commission_amount: 0,
    net_amount: 0,
    salon_amount: 0,
    review_count: 0,
    average_rating: 0,
  };
}
