// =============================================================================
// Owner-only Staff Commission Settings + Payouts — contract + pure helpers.
// Numbers on cards/tables come from Phase 5 RPCs. This module formats,
// validates, and builds CSV from those already-authoritative rows.
// =============================================================================

import {
  asFiniteNumber,
  csvCell,
  formatInr,
  type StaffCommissionType,
  type StaffPerformanceError,
  type StaffPerformanceErrorCode,
} from './staffPerformance';

export const STAFF_COMMISSION_PATH = '/owner/dashboard/staff-performance/commission';

export const STAFF_COMMISSION_RPCS = [
  'get_staff_commission_settings',
  'upsert_staff_commission_setting',
  'get_staff_payout_summary',
  'approve_staff_payout',
  'mark_staff_payout_paid',
  'cancel_staff_payout',
  'get_staff_payout_history',
] as const;

export type StaffPayoutStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

export type StaffCommissionTab = 'settings' | 'pending' | 'paid';

export interface StaffCommissionSettingRow {
  id: string;
  staff_id: string;
  staff_name: string;
  commission_type: StaffCommissionType;
  commission_rate: number;
  fixed_amount: number;
  is_enabled: boolean;
  effective_from: string;
  effective_to: string | null;
  notes: string;
  is_current: boolean;
  created_at: string;
}

export interface StaffPayoutSummaryRow {
  staff_id: string;
  staff_name: string;
  completed_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  commission_amount: number;
  already_paid_commission: number;
  pending_commission: number;
  payout_status: StaffPayoutStatus;
  last_payout_date: string | null;
  open_payout_id: string | null;
}

export interface StaffPayoutHistoryRow {
  payout_id: string;
  staff_id: string;
  staff_name: string;
  commission_amount: number;
  period_from: string;
  period_to: string;
  status: StaffPayoutStatus;
  approved_by: string | null;
  paid_at: string | null;
  reference_number: string;
  notes: string;
  created_at: string;
  completed_bookings: number;
  gross_amount: number;
  net_amount: number;
}

export interface StaffCommissionSettingInput {
  staff_id: string;
  commission_type: StaffCommissionType;
  commission_rate: number;
  fixed_amount: number;
  is_enabled: boolean;
  effective_from: string;
  notes: string;
}

export const STAFF_COMMISSION_ERROR_COPY: Record<StaffPerformanceErrorCode, string> = {
  session_expired: 'Your session expired. Sign in again to manage commissions.',
  owner_access_denied: 'Commission settings are owner-only. Customers and staff cannot view this page.',
  salon_not_found: 'We could not find a salon for this owner account.',
  rpc_unavailable: 'Commission RPCs are unavailable. Apply the Phase 5 SQL migration, then retry.',
  database_error: 'The database rejected this request (RLS or query error).',
  no_staff: 'No staff found for this salon yet.',
  no_bookings: 'No completed bookings in the selected date range.',
  no_payment_data: 'No commission is pending for this period.',
  no_review_data: 'No payout history yet.',
  export_failed: 'CSV export failed. Try again.',
  unknown: 'Something went wrong.',
};

export const PAYOUT_CSV_HEADERS = [
  'Staff name',
  'Completed bookings',
  'Gross amount',
  'Discount amount',
  'Net amount',
  'Commission amount',
  'Already paid',
  'Pending commission',
  'Status',
  'Last payout date',
] as const;

export const PAYOUT_HISTORY_CSV_HEADERS = [
  'Staff name',
  'Period from',
  'Period to',
  'Commission amount',
  'Status',
  'Paid at',
  'Reference',
  'Notes',
] as const;

const TYPES: StaffCommissionType[] = ['percentage', 'fixed', 'none'];
const STATUSES: StaffPayoutStatus[] = ['pending', 'approved', 'paid', 'cancelled'];

export function asCommissionType(value: unknown): StaffCommissionType {
  const raw = String(value || '').toLowerCase();
  return (TYPES as string[]).includes(raw) ? (raw as StaffCommissionType) : 'none';
}

export function asPayoutStatus(value: unknown): StaffPayoutStatus {
  const raw = String(value || '').toLowerCase();
  return (STATUSES as string[]).includes(raw) ? (raw as StaffPayoutStatus) : 'pending';
}

export function isoDateOnly(value: unknown): string {
  return String(value || '').slice(0, 10);
}

export function normalizeSettingRow(row: Record<string, unknown> | StaffCommissionSettingRow): StaffCommissionSettingRow {
  return {
    id: String(row.id || ''),
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    commission_type: asCommissionType(row.commission_type),
    commission_rate: asFiniteNumber(row.commission_rate),
    fixed_amount: asFiniteNumber(row.fixed_amount),
    is_enabled: Boolean(row.is_enabled),
    effective_from: isoDateOnly(row.effective_from),
    effective_to: row.effective_to ? isoDateOnly(row.effective_to) : null,
    notes: String(row.notes || ''),
    is_current: Boolean(row.is_current),
    created_at: String(row.created_at || ''),
  };
}

export function normalizePayoutSummaryRow(row: Record<string, unknown> | StaffPayoutSummaryRow): StaffPayoutSummaryRow {
  return {
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    gross_amount: asFiniteNumber(row.gross_amount),
    discount_amount: asFiniteNumber(row.discount_amount),
    net_amount: asFiniteNumber(row.net_amount),
    commission_amount: asFiniteNumber(row.commission_amount),
    already_paid_commission: asFiniteNumber(row.already_paid_commission),
    pending_commission: asFiniteNumber(row.pending_commission),
    payout_status: asPayoutStatus(row.payout_status),
    last_payout_date: row.last_payout_date ? isoDateOnly(row.last_payout_date) : null,
    open_payout_id: row.open_payout_id ? String(row.open_payout_id) : null,
  };
}

export function normalizePayoutHistoryRow(row: Record<string, unknown> | StaffPayoutHistoryRow): StaffPayoutHistoryRow {
  return {
    payout_id: String(row.payout_id || ''),
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || 'Staff'),
    commission_amount: asFiniteNumber(row.commission_amount),
    period_from: isoDateOnly(row.period_from),
    period_to: isoDateOnly(row.period_to),
    status: asPayoutStatus(row.status),
    approved_by: row.approved_by ? String(row.approved_by) : null,
    paid_at: row.paid_at ? String(row.paid_at) : null,
    reference_number: String(row.reference_number || ''),
    notes: String(row.notes || ''),
    created_at: String(row.created_at || ''),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    gross_amount: asFiniteNumber(row.gross_amount),
    net_amount: asFiniteNumber(row.net_amount),
  };
}

export function currentSettingsOnly(rows: StaffCommissionSettingRow[]): StaffCommissionSettingRow[] {
  return rows.filter((row) => row.is_current);
}

export function validateCommissionSettingInput(
  input: StaffCommissionSettingInput,
  today: string
): { ok: true } | { ok: false; message: string } {
  if (!input.staff_id) return { ok: false, message: 'Select a staff member.' };
  if (!TYPES.includes(input.commission_type)) {
    return { ok: false, message: 'Commission type must be percentage, fixed, or none.' };
  }
  if (!Number.isFinite(input.commission_rate) || input.commission_rate < 0 || input.commission_rate > 100) {
    return { ok: false, message: 'Commission rate must be between 0 and 100.' };
  }
  if (!Number.isFinite(input.fixed_amount) || input.fixed_amount < 0) {
    return { ok: false, message: 'Fixed amount must not be negative.' };
  }
  if (!input.effective_from) return { ok: false, message: 'Effective date is required.' };
  if (input.effective_from < today) return { ok: false, message: 'Effective date cannot be in the past.' };
  return { ok: true };
}

export function settingLabel(row: StaffCommissionSettingRow, currencySymbol = '₹'): string {
  if (!row.is_enabled || row.commission_type === 'none') return 'Disabled';
  if (row.commission_type === 'percentage') return `${row.commission_rate}% of net`;
  return `${formatInr(row.fixed_amount, currencySymbol)} fixed`;
}

export function payoutStatusLabel(status: StaffPayoutStatus): string {
  if (status === 'pending') return 'Pending';
  if (status === 'approved') return 'Approved';
  if (status === 'paid') return 'Paid';
  return 'Cancelled';
}

export function aggregatePayoutTotals(rows: StaffPayoutSummaryRow[]): {
  completed_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  commission_amount: number;
  already_paid_commission: number;
  pending_commission: number;
} {
  return rows.reduce(
    (acc, row) => ({
      completed_bookings: acc.completed_bookings + row.completed_bookings,
      gross_amount: acc.gross_amount + row.gross_amount,
      discount_amount: acc.discount_amount + row.discount_amount,
      net_amount: acc.net_amount + row.net_amount,
      commission_amount: acc.commission_amount + row.commission_amount,
      already_paid_commission: acc.already_paid_commission + row.already_paid_commission,
      pending_commission: acc.pending_commission + row.pending_commission,
    }),
    {
      completed_bookings: 0,
      gross_amount: 0,
      discount_amount: 0,
      net_amount: 0,
      commission_amount: 0,
      already_paid_commission: 0,
      pending_commission: 0,
    }
  );
}

export function csvFromPayoutSummary(rows: StaffPayoutSummaryRow[]): string {
  const lines = [PAYOUT_CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.staff_name),
        csvCell(row.completed_bookings),
        csvCell(row.gross_amount),
        csvCell(row.discount_amount),
        csvCell(row.net_amount),
        csvCell(row.commission_amount),
        csvCell(row.already_paid_commission),
        csvCell(row.pending_commission),
        csvCell(row.payout_status),
        csvCell(row.last_payout_date || ''),
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export function csvFromPayoutHistory(rows: StaffPayoutHistoryRow[]): string {
  const lines = [PAYOUT_HISTORY_CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.staff_name),
        csvCell(row.period_from),
        csvCell(row.period_to),
        csvCell(row.commission_amount),
        csvCell(row.status),
        csvCell(row.paid_at || ''),
        csvCell(row.reference_number),
        csvCell(row.notes),
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export function commissionErrorMessage(error: StaffPerformanceError): string {
  return error.message || STAFF_COMMISSION_ERROR_COPY[error.code] || STAFF_COMMISSION_ERROR_COPY.unknown;
}
