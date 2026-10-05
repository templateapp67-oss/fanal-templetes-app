import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCancellationRefund,
  formatCountdown,
  REFUND_PERCENT_BEFORE_CUTOFF,
  REFUND_PERCENT_AFTER_CUTOFF,
} from '../src/lib/cancellationPolicy';
import { toUtcTimestamp } from '../src/lib/bookingConfirmation';

const slot = { date: '2026-10-10', time: '15:00' };
const slotMs = toUtcTimestamp(slot.date, slot.time) as number;
const H = 3_600_000;

test('cancellation thresholds are 80% outside 24 hours and 0% inside it', () => {
  assert.equal(REFUND_PERCENT_BEFORE_CUTOFF, 80);
  assert.equal(REFUND_PERCENT_AFTER_CUTOFF, 0);
  const early = computeCancellationRefund({ ...slot, paidAmount: 500, nowMs: slotMs - 48 * H });
  assert.equal(early.tier, 'early');
  assert.equal(early.refundAmount, 400);
  assert.equal(early.retainedAmount, 100);
  assert.equal(early.msUntilCutoff, 24 * H);
  const exactlyAtCutoff = computeCancellationRefund({ ...slot, paidAmount: 100, nowMs: slotMs - 24 * H });
  assert.equal(exactlyAtCutoff.tier, 'early');
  assert.equal(exactlyAtCutoff.refundAmount, 80);
  const late = computeCancellationRefund({ ...slot, paidAmount: 500, nowMs: slotMs - 24 * H + 1 });
  assert.equal(late.tier, 'late');
  assert.equal(late.refundAmount, 0);
  assert.equal(late.retainedAmount, 500);
  assert.equal(late.msUntilCutoff, 0);
});

test('zero paid and unparseable slots make no refund promise', () => {
  const zero = computeCancellationRefund({ ...slot, paidAmount: 0, nowMs: slotMs - 72 * H });
  assert.equal(zero.tier, 'early');
  assert.equal(zero.refundAmount, 0);
  const unknown = computeCancellationRefund({ date: '', time: '', paidAmount: 500, nowMs: Date.now() });
  assert.equal(unknown.tier, 'unknown');
  assert.equal(unknown.refundAmount, 0);
  assert.equal(unknown.cutoffMs, null);
});

test('refund values round to paise and countdown formatting remains readable', () => {
  assert.equal(computeCancellationRefund({ ...slot, paidAmount: 33.33, nowMs: slotMs - 48 * H }).refundAmount, 26.66);
  assert.equal(formatCountdown(42 * 60_000), '42 min');
  assert.equal(formatCountdown(5 * H + 10 * 60_000), '5 h 10 min');
  assert.equal(formatCountdown(51 * H), '2 d 3 h');
});
