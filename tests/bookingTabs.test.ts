// ============================================================================
// "My Bookings" logic (src/lib/bookingTabs.ts).
//
// These are the decisions a customer acts on: which tab a booking sits in,
// whether the Cancel button should be there, and whether a review may be
// submitted. The API enforces the same functions, so a wrong rule here is a
// button the server will reject.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOOKING_TABS,
  DEFAULT_TAB,
  MAX_REVIEW_LENGTH,
  canCancelBooking,
  canReview,
  groupBookingsByTab,
  isBookingTabId,
  isSlotPast,
  sortCustomerBookings,
  tabForStatus,
  toCustomerBookingCard,
  validateReview,
  type CustomerBookingCard,
} from '../src/lib/bookingTabs';

// 2026-09-20 11:30 IST == 2026-09-20T06:00:00Z
const SLOT_UTC = Date.UTC(2026, 8, 20, 6, 0, 0);
const BEFORE_SLOT = Date.UTC(2026, 8, 19, 12, 0, 0);
const AFTER_SLOT = Date.UTC(2026, 8, 21, 12, 0, 0);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

test('there are exactly the three required tabs, in order', () => {
  assert.deepEqual(
    BOOKING_TABS.map((tab) => tab.id),
    ['upcoming', 'completed', 'cancelled']
  );
  assert.deepEqual(
    BOOKING_TABS.map((tab) => tab.label),
    ['Upcoming', 'Completed', 'Cancelled']
  );
  assert.equal(DEFAULT_TAB, 'upcoming');
});

test('every tab has its own empty-state copy', () => {
  for (const tab of BOOKING_TABS) {
    assert.ok(tab.emptyTitle.length > 0, `${tab.id} needs an empty title`);
    assert.ok(tab.emptyBody.length > 0, `${tab.id} needs empty-state body copy`);
  }
});

test('statuses are bucketed into the right tab', () => {
  assert.equal(tabForStatus('pending'), 'upcoming');
  assert.equal(tabForStatus('confirmed'), 'upcoming');
  assert.equal(tabForStatus('reschedule_proposed'), 'upcoming');
  assert.equal(tabForStatus('completed'), 'completed');
  assert.equal(tabForStatus('cancelled'), 'cancelled');
});

test('a no-show is filed with cancelled but is not called cancelled', () => {
  assert.equal(tabForStatus('no_show'), 'cancelled');
  // The badge still says No-show, so the customer can tell it apart from a
  // cancellation they made themselves (different refund outcome).
  const card = toCustomerBookingCard({ id: 'b1', status: 'no_show' }, BEFORE_SLOT);
  assert.equal(card.status, 'no_show');
});

test('an unrecognised status stays visible in Upcoming rather than vanishing', () => {
  assert.equal(tabForStatus('teleported'), 'upcoming');
  assert.equal(tabForStatus(null), 'upcoming');
});

test('isBookingTabId rejects anything that is not a tab', () => {
  assert.equal(isBookingTabId('upcoming'), true);
  assert.equal(isBookingTabId('all'), false);
  assert.equal(isBookingTabId(null), false);
});

// ---------------------------------------------------------------------------
// Cancellation policy
// ---------------------------------------------------------------------------

test('an upcoming confirmed booking can be cancelled', () => {
  const decision = canCancelBooking({
    status: 'confirmed',
    date: '2026-09-20',
    time: '11:30',
    nowMs: BEFORE_SLOT,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, '');
});

test('a pending booking can also be cancelled', () => {
  assert.equal(
    canCancelBooking({ status: 'pending', date: '2026-09-20', time: '11:30', nowMs: BEFORE_SLOT }).allowed,
    true
  );
});

test('a booking whose slot has passed cannot be cancelled', () => {
  const decision = canCancelBooking({
    status: 'confirmed',
    date: '2026-09-20',
    time: '11:30',
    nowMs: AFTER_SLOT,
  });
  assert.equal(decision.allowed, false);
  assert.ok(decision.reason.length > 0, 'the customer must be told why');
});

test('terminal bookings cannot be cancelled, each with its own reason', () => {
  const completed = canCancelBooking({ status: 'completed', date: '2026-09-20', time: '11:30', nowMs: BEFORE_SLOT });
  const cancelled = canCancelBooking({ status: 'cancelled', date: '2026-09-20', time: '11:30', nowMs: BEFORE_SLOT });
  const noShow = canCancelBooking({ status: 'no_show', date: '2026-09-20', time: '11:30', nowMs: BEFORE_SLOT });
  for (const decision of [completed, cancelled, noShow]) {
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason.length > 0);
  }
  assert.notEqual(completed.reason, cancelled.reason);
  assert.notEqual(cancelled.reason, noShow.reason);
});

test('a salon lead-time closes the window early and says so in hours', () => {
  const twoHoursBefore = SLOT_UTC - 90 * 60_000; // 90 minutes before the slot
  const decision = canCancelBooking({
    status: 'confirmed',
    date: '2026-09-20',
    time: '11:30',
    nowMs: twoHoursBefore,
    leadMinutes: 120,
  });
  assert.equal(decision.allowed, false);
  assert.ok(decision.reason.includes('2 hours'), decision.reason);
});

test('within the lead time but still allowed when no lead time is set', () => {
  const twoHoursBefore = SLOT_UTC - 90 * 60_000;
  assert.equal(
    canCancelBooking({ status: 'confirmed', date: '2026-09-20', time: '11:30', nowMs: twoHoursBefore }).allowed,
    true
  );
});

test('a booking with no parseable slot is left cancellable for the salon to decide', () => {
  // Refusing here would strand a booking the customer can see but never clear.
  assert.equal(canCancelBooking({ status: 'confirmed', date: '', time: '', nowMs: AFTER_SLOT }).allowed, true);
  assert.equal(canCancelBooking({ status: 'confirmed', nowMs: AFTER_SLOT }).allowed, true);
});

test('isSlotPast treats an unparseable slot as not past', () => {
  assert.equal(isSlotPast('2026-09-20', '11:30', AFTER_SLOT), true);
  assert.equal(isSlotPast('2026-09-20', '11:30', BEFORE_SLOT), false);
  assert.equal(isSlotPast('', '', AFTER_SLOT), false);
});

// ---------------------------------------------------------------------------
// Review policy
// ---------------------------------------------------------------------------

test('a completed booking may be reviewed', () => {
  const result = validateReview({ status: 'completed', rating: 5, text: 'Lovely visit' });
  assert.equal(result.ok, true);
  assert.equal(result.rating, 5);
  assert.equal(result.text, 'Lovely visit');
  assert.equal(result.error, '');
});

test('only completed bookings may be reviewed', () => {
  for (const status of ['pending', 'confirmed', 'cancelled', 'no_show']) {
    const result = validateReview({ status, rating: 5 });
    assert.equal(result.ok, false, `${status} must not be reviewable`);
    assert.ok(result.error.includes('completed'));
  }
});

test('the rating must be a whole number of stars from 1 to 5', () => {
  for (const rating of [0, 6, -1, 3.5, NaN, 'abc', null, undefined]) {
    assert.equal(validateReview({ status: 'completed', rating }).ok, false, `rating ${String(rating)}`);
  }
  for (const rating of [1, 2, 3, 4, 5, '4']) {
    assert.equal(validateReview({ status: 'completed', rating }).ok, true, `rating ${String(rating)}`);
  }
});

test('the review text is optional but length-capped', () => {
  assert.equal(validateReview({ status: 'completed', rating: 4, text: '' }).ok, true);
  assert.equal(validateReview({ status: 'completed', rating: 4, text: 'x'.repeat(MAX_REVIEW_LENGTH) }).ok, true);
  const tooLong = validateReview({ status: 'completed', rating: 4, text: 'x'.repeat(MAX_REVIEW_LENGTH + 1) });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.error.includes(String(MAX_REVIEW_LENGTH)));
});

test('canReview is false once a review exists', () => {
  assert.equal(canReview({ status: 'completed', reviewRating: null }), true);
  assert.equal(canReview({ status: 'completed', reviewRating: 4 }), false);
  assert.equal(canReview({ status: 'pending', reviewRating: null }), false);
});

// ---------------------------------------------------------------------------
// Card mapping
// ---------------------------------------------------------------------------

test('a booking row maps onto every field the card renders', () => {
  const card = toCustomerBookingCard(
    {
      id: 'b-1',
      service_name: 'Hair Spa',
      booking_date: '2026-09-20',
      time_slot: '11:30',
      status: 'confirmed',
      total_amount: '2400.00',
      advance_paid_amount: '600.00',
      payment_id: 'NX-BLR-12345',
      booking_type: 'salon',
      metadata: { stylist_name: 'Ananya' },
      salon: { name: 'Luxe Salon', imageUrl: 'https://img/logo.png', city: 'Mumbai', currency: '₹' },
    },
    BEFORE_SLOT
  );
  assert.equal(card.id, 'b-1');
  assert.equal(card.salonName, 'Luxe Salon');
  assert.equal(card.salonImageUrl, 'https://img/logo.png');
  assert.equal(card.salonCity, 'Mumbai');
  assert.equal(card.serviceName, 'Hair Spa');
  assert.equal(card.staffName, 'Ananya');
  assert.equal(card.date, '2026-09-20');
  assert.equal(card.time, '11:30');
  assert.equal(card.status, 'confirmed');
  assert.equal(card.totalAmount, 2400);
  assert.equal(card.advancePaid, 600);
  assert.equal(card.reference, 'NX-BLR-12345');
  assert.equal(card.isPast, false);
  assert.equal(card.reviewRating, null);
});

test('money arrives as a numeric string from Postgres and is parsed, not concatenated', () => {
  const card = toCustomerBookingCard({ total_amount: '2400.50', advance_paid_amount: '0' }, BEFORE_SLOT);
  assert.equal(card.totalAmount, 2400.5);
  assert.equal(card.advancePaid, 0);
});

test('missing salon and staff details fall back instead of rendering blank', () => {
  const card = toCustomerBookingCard({ id: 'b-2', status: 'pending' }, BEFORE_SLOT);
  assert.equal(card.salonName, 'Salon');
  assert.equal(card.salonImageUrl, '');
  assert.equal(card.staffName, 'Assigned by the salon');
  assert.equal(card.serviceName, 'Appointment');
  assert.equal(card.currency, '₹');
});

test('salon details fall back to the booking metadata when no profile row resolves', () => {
  const card = toCustomerBookingCard(
    { status: 'pending', metadata: { salon_name: 'Blush Studio', stylist_name: 'Rhea' } },
    BEFORE_SLOT
  );
  assert.equal(card.salonName, 'Blush Studio');
  assert.equal(card.staffName, 'Rhea');
});

test('a stored review surfaces on the card', () => {
  const card = toCustomerBookingCard(
    { status: 'completed', metadata: { review_rating: 4 } },
    AFTER_SLOT
  );
  assert.equal(card.reviewRating, 4);
  assert.equal(canReview(card), false);
});

test('an out-of-range stored rating is ignored rather than shown', () => {
  assert.equal(toCustomerBookingCard({ status: 'completed', metadata: { review_rating: 99 } }, AFTER_SLOT).reviewRating, null);
  assert.equal(toCustomerBookingCard({ status: 'completed', metadata: { review_rating: 0 } }, AFTER_SLOT).reviewRating, null);
});

test('a home-service booking is flagged as such', () => {
  assert.equal(toCustomerBookingCard({ booking_type: 'home', status: 'pending' }, BEFORE_SLOT).serviceAt, 'home');
  assert.equal(toCustomerBookingCard({ booking_type: 'salon', status: 'pending' }, BEFORE_SLOT).serviceAt, 'salon');
  assert.equal(toCustomerBookingCard({ status: 'pending' }, BEFORE_SLOT).serviceAt, 'salon');
});

test('garbage input produces a usable card rather than throwing', () => {
  for (const input of [null, undefined, 'nope', 42]) {
    const card = toCustomerBookingCard(input, BEFORE_SLOT);
    assert.equal(typeof card.salonName, 'string');
    assert.equal(card.salonName, 'Salon');
  }
});

// ---------------------------------------------------------------------------
// Ordering + grouping
// ---------------------------------------------------------------------------

/** Build a card from a raw `bookings` row (snake_case, as the API returns). */
function card(row: Record<string, any>): CustomerBookingCard {
  return toCustomerBookingCard(
    {
      id: 'x',
      status: 'pending',
      booking_date: '2026-09-20',
      time_slot: '11:30',
      service_name: 'Cut',
      ...row,
    },
    BEFORE_SLOT
  );
}

test('upcoming sorts soonest first', () => {
  const sorted = sortCustomerBookings(
    [
      card({ id: 'c', booking_date: '2026-10-05', time_slot: '10:00' }),
      card({ id: 'a', booking_date: '2026-09-21', time_slot: '09:00' }),
      card({ id: 'b', booking_date: '2026-09-20', time_slot: '11:30' }),
    ],
    'upcoming'
  );
  assert.deepEqual(sorted.map((c) => c.id), ['b', 'a', 'c']);
});

test('a stale past-due booking sinks below a future one', () => {
  const sorted = sortCustomerBookings(
    [
      card({ id: 'stale', booking_date: '2026-09-01', time_slot: '10:00' }),
      card({ id: 'soon', booking_date: '2026-09-21', time_slot: '09:00' }),
    ],
    'upcoming'
  );
  // `isPast` is computed against BEFORE_SLOT (2026-09-19T12:00Z), so the
  // September 1st slot counts as passed and must not outrank a future one.
  assert.deepEqual(sorted.map((c) => c.id), ['soon', 'stale']);
  assert.equal(sorted[0].isPast, false);
  assert.equal(sorted[1].isPast, true);
});

test('history tabs sort most recent first', () => {
  const sorted = sortCustomerBookings(
    [
      card({ id: 'old', booking_date: '2026-01-05', time_slot: '10:00' }),
      card({ id: 'new', booking_date: '2026-08-05', time_slot: '10:00' }),
    ],
    'completed'
  );
  assert.deepEqual(sorted.map((c) => c.id), ['new', 'old']);
});

test('bookings with no parseable slot sort last instead of first', () => {
  const sorted = sortCustomerBookings(
    [card({ id: 'nodate', booking_date: '', time_slot: '' }), card({ id: 'dated', booking_date: '2026-09-21', time_slot: '09:00' })],
    'upcoming'
  );
  assert.deepEqual(sorted.map((c) => c.id), ['dated', 'nodate']);
});

test('grouping buckets every card exactly once', () => {
  const grouped = groupBookingsByTab([
    card({ id: 'u1', status: 'pending' }),
    card({ id: 'u2', status: 'confirmed' }),
    card({ id: 'c1', status: 'completed', booking_date: '2026-08-01', time_slot: '10:00' }),
    card({ id: 'x1', status: 'cancelled', booking_date: '2026-07-01', time_slot: '10:00' }),
    card({ id: 'x2', status: 'no_show', booking_date: '2026-06-01', time_slot: '10:00' }),
  ]);
  assert.deepEqual(grouped.upcoming.map((c) => c.id).sort(), ['u1', 'u2']);
  assert.deepEqual(grouped.completed.map((c) => c.id), ['c1']);
  assert.deepEqual(grouped.cancelled.map((c) => c.id), ['x1', 'x2']);
  const total = grouped.upcoming.length + grouped.completed.length + grouped.cancelled.length;
  assert.equal(total, 5, 'every card must land in exactly one tab');
});

test('grouping an empty list yields three empty tabs, not undefined', () => {
  const grouped = groupBookingsByTab([]);
  assert.deepEqual(grouped.upcoming, []);
  assert.deepEqual(grouped.completed, []);
  assert.deepEqual(grouped.cancelled, []);
});
