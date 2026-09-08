// ============================================================================
// Booking detail page — pure logic (src/lib/bookingDetail.ts).
//
// The property that matters most: the reward points shown here must equal what
// the salon's dashboard actually awards, or the page promises a number the
// customer never receives. `calculateLoyaltyPoints` mirrors
// SaaSDashboard.updateAppointmentStatus, and the expected values below are
// worked out by hand rather than by calling the function again.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRewardStatus,
  calculateLoyaltyPoints,
  outstandingBalance,
  paymentStatusLabel,
  readServiceAddOns,
  resolveBookingDetailActions,
  toBookingDetailView,
} from '../src/lib/bookingDetail';

// 2026-09-20 11:30 IST, and instants either side of it.
const SLOT_UTC = Date.UTC(2026, 8, 20, 6, 0, 0);
const BEFORE_SLOT = Date.UTC(2026, 8, 19, 12, 0, 0);
const AFTER_SLOT = Date.UTC(2026, 8, 21, 12, 0, 0);

// ---------------------------------------------------------------------------
// Loyalty points
// ---------------------------------------------------------------------------

test('points are visit points plus spend points', () => {
  // spend = round((2400 / 100) * 10) = 240; total = 50 + 240
  assert.equal(
    calculateLoyaltyPoints({ totalAmount: 2400, pointsPerVisit: 50, pointsPerHundredSpent: 10 }),
    290
  );
});

test('a free visit still earns the per-visit points', () => {
  assert.equal(
    calculateLoyaltyPoints({ totalAmount: 0, pointsPerVisit: 50, pointsPerHundredSpent: 10 }),
    50
  );
});

test('the tier multiplier is applied to the whole award, and rounds half up', () => {
  // (50 + 240) * 1.5 = 435
  assert.equal(
    calculateLoyaltyPoints({
      totalAmount: 2400,
      pointsPerVisit: 50,
      pointsPerHundredSpent: 10,
      tierMultiplier: 1.5,
    }),
    435
  );
  // (50 + 240) * 1.25 = 362.5 -> 363
  assert.equal(
    calculateLoyaltyPoints({
      totalAmount: 2400,
      pointsPerVisit: 50,
      pointsPerHundredSpent: 10,
      tierMultiplier: 1.25,
    }),
    363
  );
});

test('a zero or unusable multiplier falls back to 1 rather than zeroing the award', () => {
  const base = { totalAmount: 2400, pointsPerVisit: 50, pointsPerHundredSpent: 10 };
  assert.equal(calculateLoyaltyPoints({ ...base, tierMultiplier: 0 }), 290);
  assert.equal(calculateLoyaltyPoints({ ...base, tierMultiplier: -2 }), 290);
  assert.equal(calculateLoyaltyPoints({ ...base, tierMultiplier: NaN }), 290);
});

test('unparseable amounts are treated as zero, never as NaN', () => {
  const earned = calculateLoyaltyPoints({
    totalAmount: NaN,
    pointsPerVisit: NaN,
    pointsPerHundredSpent: NaN,
  });
  assert.equal(earned, 0);
  assert.ok(Number.isFinite(earned));
});

test('the database column defaults give 10 visit points plus 10 per hundred', () => {
  // loyalty_config defaults: points_per_visit 10, points_per_hundred_spent 10.
  // A ₹1500 visit: spend = round(15 * 10) = 150; total = 10 + 150 = 160.
  assert.equal(
    calculateLoyaltyPoints({ totalAmount: 1500, pointsPerVisit: 10, pointsPerHundredSpent: 10 }),
    160
  );
});

// ---------------------------------------------------------------------------
// Reward status wording
// ---------------------------------------------------------------------------

const TERMS = { programEnabled: true, pointsPerVisit: 50, pointsPerHundredSpent: 10, tier: 'bronze' };

test('a completed visit reports points already earned', () => {
  const reward = buildRewardStatus({ status: 'completed', totalAmount: 2400, loyalty: TERMS });
  assert.equal(reward.state, 'earned');
  assert.equal(reward.points, 290);
  assert.equal(reward.label, '290 points earned');
});

test('a visit that has not happened yet promises points without claiming them', () => {
  for (const status of ['pending', 'confirmed']) {
    const reward = buildRewardStatus({ status, totalAmount: 2400, loyalty: TERMS });
    assert.equal(reward.state, 'pending', status);
    assert.equal(reward.points, 290, status);
    assert.equal(reward.label, '290 points on completion', status);
    assert.ok(reward.detail.includes('once the salon marks your visit complete'), status);
    assert.ok(!reward.detail.includes('Added to your balance'), `${status}: not yet added`);
  }
});

test('a cancelled booking earns nothing', () => {
  const reward = buildRewardStatus({ status: 'cancelled', totalAmount: 2400, loyalty: TERMS });
  assert.equal(reward.state, 'not_earned');
  assert.equal(reward.points, 0);
  assert.equal(reward.label, 'No points earned');
});

test('a no-show earns nothing and says why', () => {
  const reward = buildRewardStatus({ status: 'no_show', totalAmount: 2400, loyalty: TERMS });
  assert.equal(reward.state, 'not_earned');
  assert.equal(reward.points, 0);
  assert.ok(reward.detail.includes('missed appointment'));
});

test('a salon with no loyalty programme is not shown a points balance', () => {
  const reward = buildRewardStatus({
    status: 'completed',
    totalAmount: 2400,
    loyalty: { ...TERMS, programEnabled: false },
  });
  assert.equal(reward.state, 'disabled');
  assert.equal(reward.points, 0);
  assert.equal(reward.label, 'No rewards at this salon');
});

test('the tier multiplier changes the promised number', () => {
  const gold = buildRewardStatus({
    status: 'completed',
    totalAmount: 2400,
    loyalty: { ...TERMS, tier: 'gold', tierMultiplier: 1.5 },
  });
  assert.equal(gold.points, 435);
  assert.ok(gold.detail.includes('gold'));
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test('payment status has customer-facing wording', () => {
  assert.equal(paymentStatusLabel('pending'), 'Not paid yet');
  assert.equal(paymentStatusLabel('paid_deposit'), 'Advance paid');
  assert.equal(paymentStatusLabel('paid_full'), 'Paid in full');
  assert.equal(paymentStatusLabel('pay_at_salon'), 'Pay at the salon');
  assert.equal(paymentStatusLabel('refunded'), 'Refunded');
  assert.equal(paymentStatusLabel('failed'), 'Payment failed');
});

test('an unknown payment status is readable rather than dropped', () => {
  assert.equal(paymentStatusLabel('part_refunded'), 'part refunded');
  assert.equal(paymentStatusLabel(''), 'Not paid yet');
  assert.equal(paymentStatusLabel(null), 'Not paid yet');
  assert.equal(paymentStatusLabel(undefined), 'Not paid yet');
});

test('the balance due never goes negative', () => {
  assert.equal(outstandingBalance(2400, 600), 1800);
  assert.equal(outstandingBalance(2400, 0), 2400);
  assert.equal(outstandingBalance(2400, 2400), 0);
  assert.equal(outstandingBalance(600, 2400), 0);
  assert.equal(outstandingBalance(NaN, NaN), 0);
});

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------

test('add-ons stored as objects are read by name', () => {
  assert.deepEqual(
    readServiceAddOns([
      { name: 'Head Massage', price: 300, duration: 15 },
      { name: 'Deep Conditioning', price: 500 },
    ]),
    ['Head Massage', 'Deep Conditioning']
  );
});

test('add-ons stored as plain strings are still read', () => {
  assert.deepEqual(readServiceAddOns(['Head Massage', 'Deep Conditioning']), [
    'Head Massage',
    'Deep Conditioning',
  ]);
});

test('a comma-separated legacy value is split', () => {
  assert.deepEqual(readServiceAddOns('Head Massage, Deep Conditioning'), [
    'Head Massage',
    'Deep Conditioning',
  ]);
});

test('add-ons that are not usable are dropped, not rendered as "[object Object]"', () => {
  assert.deepEqual(readServiceAddOns([{ price: 300 }, { name: '' }, { name: '   ' }]), []);
  assert.deepEqual(readServiceAddOns(undefined), []);
  assert.deepEqual(readServiceAddOns(null), []);
  assert.deepEqual(readServiceAddOns(''), []);
  assert.deepEqual(readServiceAddOns(42), []);
  assert.deepEqual(readServiceAddOns({ name: 'not a list' }), []);
});

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

function row(overrides: Record<string, any> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'confirmed',
    service_name: 'Hair Spa',
    booking_date: '2026-09-20',
    time_slot: '11:30',
    total_amount: 2400,
    advance_paid_amount: 600,
    payment_status: 'paid_deposit',
    payment_id: 'NX-BLR-12345',
    notes: 'Sensitive scalp, please use the mild shampoo',
    created_at: '2026-09-01T10:00:00Z',
    metadata: { stylist_name: 'Ananya', salon_name: 'Luxe Salon' },
    ...overrides,
  };
}

test('every field the detail page shows is mapped', () => {
  const view = toBookingDetailView({ row: row(), loyalty: TERMS });
  assert.equal(view.bookingId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(view.reference, 'NX-BLR-12345');
  assert.equal(view.status, 'confirmed');
  assert.deepEqual(view.services, ['Hair Spa']);
  assert.equal(view.staffName, 'Ananya');
  assert.equal(view.date, '2026-09-20');
  assert.equal(view.time, '11:30');
  assert.equal(view.totalAmount, 2400);
  assert.equal(view.advancePaid, 600);
  assert.equal(view.balanceDue, 1800);
  assert.equal(view.paymentStatus, 'Advance paid');
  assert.equal(view.customerNote, 'Sensitive scalp, please use the mild shampoo');
  assert.equal(view.serviceAt, 'salon');
});

test('the salon name and staff name come from metadata when no profile is attached', () => {
  const view = toBookingDetailView({ row: row() });
  assert.equal(view.salonName, 'Luxe Salon');
  assert.equal(view.staffName, 'Ananya');
});

test('the salon profile wins over the metadata snapshot', () => {
  const view = toBookingDetailView({
    row: row(),
    salon: { name: 'Luxe Salon Andheri', currency: '₹' },
  });
  assert.equal(view.salonName, 'Luxe Salon Andheri');
});

test('add-ons are listed under the primary service', () => {
  const view = toBookingDetailView({
    row: row({
      metadata: {
        stylist_name: 'Ananya',
        service_addons: [
          { name: 'Head Massage', price: 300 },
          { name: 'Deep Conditioning', price: 500 },
        ],
      },
    }),
  });
  assert.deepEqual(view.services, ['Hair Spa', 'Head Massage', 'Deep Conditioning']);
});

test('structured metadata.services lines are listed as the services, not the joined scalar', () => {
  const view = toBookingDetailView({
    row: row({
      service_name: 'Master Stylist Precision Cut + Signature Caramel Balayage',
      metadata: {
        stylist_name: 'Ananya',
        services: [
          { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
          { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
        ],
      },
    }),
  });
  assert.deepEqual(view.services, ['Master Stylist Precision Cut', 'Signature Caramel Balayage']);
});

test('structured lines win even when legacy add-ons exist on the same row', () => {
  // Newer builds write both (lines + the legacy scalar snapshot); the lines are
  // the source of truth, so the same treatment must not appear twice.
  const view = toBookingDetailView({
    row: row({
      metadata: {
        services: [
          { service_id: 'hs-1', name: 'Master Stylist Precision Cut', price: 750, duration_minutes: 45 },
          { service_id: 'hs-3', name: 'Signature Caramel Balayage', price: 5200, duration_minutes: 150 },
        ],
        service_addons: [
          { name: 'Signature Caramel Balayage', price: 5200 },
          { name: 'Head Massage', price: 300 },
        ],
      },
    }),
  });
  assert.deepEqual(view.services, ['Master Stylist Precision Cut', 'Signature Caramel Balayage']);
});

test('structured lines with unusable entries fall back to the legacy read', () => {
  const view = toBookingDetailView({
    row: row({
      metadata: {
        services: [{ name: '  ' }, null, { service_id: 'hs-1' }],
        service_addons: 'Head Massage',
      },
    }),
  });
  assert.deepEqual(view.services, ['Hair Spa', 'Head Massage']);
});

test('a booking with no service name still reads as something', () => {
  const view = toBookingDetailView({ row: row({ service_name: '' }) });
  assert.deepEqual(view.services, ['Appointment']);
});

test('an unassigned staff member is not rendered as a blank row', () => {
  const view = toBookingDetailView({ row: row({ metadata: {} }) });
  assert.equal(view.staffName, 'Assigned by the salon');
});

test('a home-service booking is marked as such', () => {
  const view = toBookingDetailView({ row: row({ booking_type: 'home' }) });
  assert.equal(view.serviceAt, 'home');
});

test('an existing review rating is surfaced, and nothing else is', () => {
  const reviewed = toBookingDetailView({
    row: row({ metadata: { review_rating: 5 } }),
  });
  assert.equal(reviewed.reviewRating, 5);

  assert.equal(toBookingDetailView({ row: row() }).reviewRating, null);
  assert.equal(
    toBookingDetailView({ row: row({ metadata: { review_rating: 0 } }) }).reviewRating,
    null
  );
  assert.equal(
    toBookingDetailView({ row: row({ metadata: { review_rating: 9 } }) }).reviewRating,
    null
  );
  assert.equal(
    toBookingDetailView({ row: row({ metadata: { review_rating: 'great' } }) }).reviewRating,
    null
  );
});

test('unset coordinates stay unset instead of becoming 0,0', () => {
  assert.equal(toBookingDetailView({ row: row(), salon: {} }).latitude, null);
  assert.equal(
    toBookingDetailView({ row: row(), salon: { latitude: null, longitude: null } }).latitude,
    null
  );
  assert.equal(
    toBookingDetailView({ row: row(), salon: { latitude: '', longitude: '' } }).longitude,
    null
  );

  const pinned = toBookingDetailView({
    row: row(),
    salon: { latitude: 19.1197, longitude: 72.8464 },
  });
  assert.equal(pinned.latitude, 19.1197);
  assert.equal(pinned.longitude, 72.8464);
});

test('a reward status is attached to the view', () => {
  assert.equal(
    toBookingDetailView({ row: row({ status: 'completed' }), loyalty: TERMS }).reward.label,
    '290 points earned'
  );
});

test('a row that is not an object still yields a usable view', () => {
  const view = toBookingDetailView({ row: null });
  assert.equal(view.salonName, 'Salon');
  assert.equal(view.totalAmount, 0);
  assert.equal(view.reward.state, 'pending');
});

// ---------------------------------------------------------------------------
// Actions: the two conditional buttons in the spec
// ---------------------------------------------------------------------------

const SALON = {
  name: 'Luxe Salon',
  address: 'Linking Road, Bandra West, Mumbai',
  phone: '+91 98765 43210',
  whatsapp: '+91 98765 43210',
  latitude: 19.1197,
  longitude: 72.8464,
};

test('an upcoming booking offers cancel and not review', () => {
  const view = toBookingDetailView({ row: row(), salon: SALON, loyalty: TERMS });
  const actions = resolveBookingDetailActions(view, BEFORE_SLOT);
  assert.equal(actions.cancel.allowed, true);
  assert.equal(actions.reviewable, false);
  assert.equal(actions.reviewed, false);
});

test('a completed booking offers review and not cancel', () => {
  const view = toBookingDetailView({
    row: row({ status: 'completed' }),
    salon: SALON,
    loyalty: TERMS,
  });
  const actions = resolveBookingDetailActions(view, AFTER_SLOT);
  assert.equal(actions.cancel.allowed, false);
  assert.equal(actions.reviewable, true);
});

test('a booking that has already been reviewed is not asked again', () => {
  const view = toBookingDetailView({
    row: row({ status: 'completed', metadata: { review_rating: 4 } }),
    salon: SALON,
  });
  const actions = resolveBookingDetailActions(view, AFTER_SLOT);
  assert.equal(actions.reviewable, false);
  assert.equal(actions.reviewed, true);
});

test('a cancelled booking offers neither cancel nor review', () => {
  const view = toBookingDetailView({ row: row({ status: 'cancelled' }), salon: SALON });
  const actions = resolveBookingDetailActions(view, BEFORE_SLOT);
  assert.equal(actions.cancel.allowed, false);
  assert.equal(actions.reviewable, false);
});

test('an upcoming booking whose slot has passed can no longer be cancelled', () => {
  const view = toBookingDetailView({ row: row(), salon: SALON });
  const actions = resolveBookingDetailActions(view, AFTER_SLOT);
  assert.equal(actions.cancel.allowed, false);
  assert.ok(actions.cancel.reason.length > 0);
});

test('a salon notice period is respected', () => {
  const view = toBookingDetailView({ row: row(), salon: SALON });
  // 10:00 the same day, 90 minutes before an 11:30 slot.
  const ninetyMinutesBefore = SLOT_UTC - 90 * 60 * 1000;
  assert.equal(resolveBookingDetailActions(view, ninetyMinutesBefore).cancel.allowed, true);
  assert.equal(resolveBookingDetailActions(view, ninetyMinutesBefore, 120).cancel.allowed, false);
});

test('directions use the pin when the salon has one', () => {
  const view = toBookingDetailView({ row: row(), salon: SALON });
  assert.equal(
    resolveBookingDetailActions(view, BEFORE_SLOT).directionsUrl,
    'https://www.google.com/maps/dir/?api=1&destination=19.1197%2C72.8464'
  );
});

test('directions fall back to the address when there is no pin', () => {
  const view = toBookingDetailView({ row: row(), salon: { ...SALON, latitude: null, longitude: null } });
  const url = resolveBookingDetailActions(view, BEFORE_SLOT).directionsUrl;
  assert.ok(url?.startsWith('https://www.google.com/maps/dir/?api=1&destination='));
  assert.ok(url?.includes(encodeURIComponent('Linking Road, Bandra West, Mumbai')));
});

test('a salon with neither pin nor address has no directions link', () => {
  const view = toBookingDetailView({ row: row(), salon: { name: 'Luxe Salon' } });
  assert.equal(resolveBookingDetailActions(view, BEFORE_SLOT).directionsUrl, null);
});

test('contacting the salon opens WhatsApp with the booking reference', () => {
  const view = toBookingDetailView({ row: row(), salon: SALON });
  const { whatsappHref, callHref } = resolveBookingDetailActions(view, BEFORE_SLOT);
  assert.ok(whatsappHref?.startsWith('https://wa.me/919876543210'));
  assert.ok(whatsappHref?.includes(encodeURIComponent('NX-BLR-12345')));
  assert.equal(callHref, 'tel:+919876543210');
});

test('a salon with no contact details has no contact links', () => {
  const view = toBookingDetailView({ row: row(), salon: { name: 'Luxe Salon' } });
  const actions = resolveBookingDetailActions(view, BEFORE_SLOT);
  assert.equal(actions.whatsappHref, null);
  assert.equal(actions.callHref, null);
});
