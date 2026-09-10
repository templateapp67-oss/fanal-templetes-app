// ============================================================================
// Booking lifecycle statuses (src/lib/bookingStatus.ts) and the API's status
// allow-list.
//
// Two real defects are pinned here:
//   1. `no_show` did not exist anywhere — the API rejected it as an
//      "unsupported booking status", so a salon could not record a customer who
//      never turned up, which is the one outcome where the advance is forfeited
//      rather than refunded.
//   2. BookingManager's inline badge ternary had a catch-all `else`, so
//      `completed` and `cancelled` rendered with identical red styling.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOOKING_STATUS_ORDER,
  BOOKING_STATUSES,
  PERSISTABLE_BOOKING_STATUS_SET,
  describeBookingStatus,
  isPersistableBookingStatus,
  isBookingLifecycleStatus,
  bookingStatusLabel,
  bookingStatusHeadline,
} from '../src/lib/bookingStatus';
import { validateBookingPayload } from '../server/bookingCreate';

// ---------------------------------------------------------------------------
// The five lifecycle states the product requires
// ---------------------------------------------------------------------------

test('all required lifecycle states exist in order', () => {
  assert.deepEqual([...BOOKING_STATUS_ORDER], [
    'payment_pending',
    'pending',
    'confirmed',
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
  ]);
});

test('every lifecycle state has a customer-readable label', () => {
  const labels = BOOKING_STATUS_ORDER.map((id) => BOOKING_STATUSES[id].label);
  assert.deepEqual(labels, [
    'Awaiting Payment',
    'Pending',
    'Confirmed',
    'Checked In',
    'In Progress',
    'Completed',
    'Cancelled',
    'No-show',
  ]);
  for (const id of BOOKING_STATUS_ORDER) {
    assert.ok(BOOKING_STATUSES[id].description.length > 0, `${id} needs a description`);
  }
});

test('no_show is distinct from cancelled in both meaning and styling', () => {
  const noShow = BOOKING_STATUSES.no_show;
  const cancelled = BOOKING_STATUSES.cancelled;
  assert.notEqual(noShow.label, cancelled.label);
  assert.notEqual(noShow.description, cancelled.description);
  assert.notEqual(noShow.tone, cancelled.tone);
  assert.notEqual(noShow.badgeClassName, cancelled.badgeClassName);
});

test('completed and cancelled no longer share a badge style', () => {
  // The regression: BookingManager's catch-all `else` painted both red.
  assert.notEqual(BOOKING_STATUSES.completed.badgeClassName, BOOKING_STATUSES.cancelled.badgeClassName);
  assert.notEqual(BOOKING_STATUSES.completed.tone, BOOKING_STATUSES.cancelled.tone);
});

test('terminal states are marked terminal, in-flight states are not', () => {
  assert.equal(BOOKING_STATUSES.completed.isTerminal, true);
  assert.equal(BOOKING_STATUSES.cancelled.isTerminal, true);
  assert.equal(BOOKING_STATUSES.no_show.isTerminal, true);
  assert.equal(BOOKING_STATUSES.payment_pending.isTerminal, false);
  assert.equal(BOOKING_STATUSES.pending.isTerminal, false);
  assert.equal(BOOKING_STATUSES.confirmed.isTerminal, false);
  assert.equal(BOOKING_STATUSES.checked_in.isTerminal, false);
  assert.equal(BOOKING_STATUSES.in_progress.isTerminal, false);
});

// ---------------------------------------------------------------------------
// What the API may persist
// ---------------------------------------------------------------------------

test('the API allow-list accepts every lifecycle state plus reschedule_proposed', () => {
  for (const status of [...BOOKING_STATUS_ORDER, 'reschedule_requested', 'reschedule_proposed']) {
    assert.ok(PERSISTABLE_BOOKING_STATUS_SET.has(status), `${status} must be persistable`);
    assert.equal(isPersistableBookingStatus(status), true);
  }
});

test('display-only not_submitted can never be written to a booking row', () => {
  assert.equal(PERSISTABLE_BOOKING_STATUS_SET.has('not_submitted'), false);
  assert.equal(isPersistableBookingStatus('not_submitted'), false);
  assert.equal(BOOKING_STATUSES.not_submitted.isPersistable, false);
});

test('a no_show booking passes server-side payload validation', () => {
  const result = validateBookingPayload({
    customer_name: 'Riya Sharma',
    customer_phone: '9876543210',
    service_name: 'Hair Spa',
    booking_date: '2026-09-20',
    time_slot: '11:30',
    total_amount: 1500,
    status: 'no_show',
  });
  assert.equal(result.valid, true, JSON.stringify(result.fieldErrors));
  assert.equal(result.value.status, 'no_show');
});

test('an unrecognised status still falls back to pending instead of failing', () => {
  const result = validateBookingPayload({
    customer_name: 'Riya Sharma',
    customer_phone: '9876543210',
    service_name: 'Hair Spa',
    booking_date: '2026-09-20',
    time_slot: '11:30',
    status: 'teleported',
  });
  assert.equal(result.valid, true);
  assert.equal(result.value.status, 'pending');
});

// ---------------------------------------------------------------------------
// Defensive lookup
// ---------------------------------------------------------------------------

test('describeBookingStatus never throws and never returns undefined', () => {
  for (const input of ['no_show', 'NO_SHOW', '  Confirmed ', 'teleported', '', null, undefined, 42, {}]) {
    const descriptor = describeBookingStatus(input);
    assert.ok(descriptor, `expected a descriptor for ${String(input)}`);
    assert.equal(typeof descriptor.label, 'string');
    assert.equal(typeof descriptor.badgeClassName, 'string');
  }
});

test('describeBookingStatus normalises case and whitespace', () => {
  assert.equal(describeBookingStatus('NO_SHOW').id, 'no_show');
  assert.equal(describeBookingStatus('  confirmed ').id, 'confirmed');
});

test('an unknown status renders as Unknown rather than masquerading as pending', () => {
  assert.equal(describeBookingStatus('teleported').label, 'Unknown');
});

test('isBookingLifecycleStatus excludes the transitional reschedule state', () => {
  assert.equal(isBookingLifecycleStatus('no_show'), true);
  assert.equal(isBookingLifecycleStatus('reschedule_proposed'), false);
});

// ---------------------------------------------------------------------------
// Confirmation headline — the copy the customer actually reads
// ---------------------------------------------------------------------------

test('a confirmed booking says "Your booking is confirmed."', () => {
  assert.equal(bookingStatusHeadline('confirmed'), 'Your booking is confirmed.');
});

test('a pending booking says "submitted", never "confirmed"', () => {
  // The whole point of deriving the headline: the checkout writes `pending`,
  // and the page must not claim the salon accepted it.
  const headline = bookingStatusHeadline('pending');
  assert.equal(headline, 'Your booking is submitted.');
  assert.ok(!headline.toLowerCase().includes('confirmed'));
});

test('every other state has its own headline', () => {
  assert.equal(bookingStatusHeadline('completed'), 'Your appointment is completed.');
  assert.equal(bookingStatusHeadline('cancelled'), 'Your booking was cancelled.');
  assert.equal(bookingStatusHeadline('no_show'), 'This booking was marked as a no-show.');
  assert.equal(bookingStatusHeadline('reschedule_proposed'), 'The salon proposed a new time.');
  assert.equal(bookingStatusHeadline('not_submitted'), 'Your booking is saved on this device.');
});

test('status labels are plain text suitable for SMS and logs', () => {
  assert.equal(bookingStatusLabel('no_show'), 'No-show');
  assert.equal(bookingStatusLabel('reschedule_proposed'), 'Reschedule Proposed');
});
