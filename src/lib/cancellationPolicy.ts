// Cancellation refund policy — shared by the customer-facing modal and its tests.
// Refund percentages apply to money actually paid, not the booking total.
import { toUtcTimestamp } from './bookingConfirmation.js';

export const CANCELLATION_CUTOFF_HOURS = 24;
export const REFUND_PERCENT_BEFORE_CUTOFF = 80;
export const REFUND_PERCENT_AFTER_CUTOFF = 0;

export type CancellationTier = 'early' | 'late' | 'unknown';
export interface CancellationRefund {
  tier: CancellationTier;
  percent: number;
  paidAmount: number;
  refundAmount: number;
  retainedAmount: number;
  cutoffMs: number | null;
  msUntilCutoff: number | null;
}

const toMoney = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export function computeCancellationRefund(input: {
  date?: string | null;
  time?: string | null;
  paidAmount: number;
  nowMs: number;
  cutoffHours?: number;
}): CancellationRefund {
  const paidAmount = Math.max(0, toMoney(Number(input.paidAmount)));
  const cutoffHours = Number.isFinite(Number(input.cutoffHours)) && Number(input.cutoffHours) > 0
    ? Number(input.cutoffHours)
    : CANCELLATION_CUTOFF_HOURS;
  const slotMs = toUtcTimestamp(String(input.date ?? ''), String(input.time ?? ''));
  if (slotMs === null) return {
    tier: 'unknown', percent: 0, paidAmount, refundAmount: 0, retainedAmount: paidAmount,
    cutoffMs: null, msUntilCutoff: null,
  };
  const cutoffMs = slotMs - cutoffHours * 3_600_000;
  const early = input.nowMs <= cutoffMs;
  const percent = early ? REFUND_PERCENT_BEFORE_CUTOFF : REFUND_PERCENT_AFTER_CUTOFF;
  const refundAmount = toMoney(paidAmount * percent / 100);
  return {
    tier: early ? 'early' : 'late', percent, paidAmount, refundAmount,
    retainedAmount: toMoney(paidAmount - refundAmount), cutoffMs,
    msUntilCutoff: early ? cutoffMs - input.nowMs : 0,
  };
}

export function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
