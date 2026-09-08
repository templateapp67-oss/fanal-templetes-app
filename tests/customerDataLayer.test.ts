// ============================================================================
// The Customer App's data layer: mapping, mappers, slot arithmetic, device
// buckets, realtime signals, and the rule that screens may not fabricate.
//
// These tests are the contract the "map onto the existing schema, add no tables"
// decision rests on. If one of them starts failing, the mapping has drifted from
// what the database actually holds — which is precisely the failure mode where
// the UI looks fine and the data is wrong.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_SERVICE_MINUTES,
  CUSTOMER_SCHEMA_GAPS,
  CUSTOMER_SCHEMA_MAP,
  CUSTOMER_FLOW_ORDER,
  PHYSICAL_TABLES,
  RLS_REALITY,
  SALON_DISCOVERY_FILTERS,
  buildSlotGrid,
  dayWindowFor,
  distanceKm,
  isReferralCode,
  normalizeReferralCode,
  referralCodeFor,
  salonWindowFromHours,
  slotStatusBlocks,
  toIsoDate,
  todayIsoDate,
  entityMap,
  physicalTable,
  requiredPhysicalTables,
} from '../src/lib/customer/schema';
import {
  depositDueFor,
  depositPolicyPercent,
  deriveFavourites,
  isSalonProfile,
  jsonValue,
  openNowFrom,
  toBookingServiceLines,
  toCustomerBooking,
  toCustomerSalon,
  toCustomerService,
  toCustomerStaff,
  toMembership,
  toQrPayment,
  toRewardTransaction,
  toRewardWallet,
  toSlotWindow,
  QR_PAYMENT_TYPE,
  REWARD_TYPE_PREFIX,
} from '../src/lib/customer/mappers';
import { mergeFavourites, isPinned } from '../src/lib/customer/deviceStore';
import { notificationTouches, slotsSignature } from '../src/lib/customer/realtime';
import { normalizeCustomerErrorMessage } from '../src/lib/customer/api';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const uid = (digits: number) => `${String(digits).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaaaaaa`;

// ---------------------------------------------------------------------------
// The mapping itself
// ---------------------------------------------------------------------------

test('all 18 customer entities are mapped, and every flow step has one', () => {
  assert.equal(CUSTOMER_SCHEMA_MAP.length, 18);
  assert.equal(new Set(CUSTOMER_SCHEMA_MAP.map((entry) => entry.logical)).size, 18, 'entity names must be unique');
  assert.deepEqual([...CUSTOMER_FLOW_ORDER].sort(), CUSTOMER_SCHEMA_MAP.map((entry) => entry.logical).sort());
  for (const entry of CUSTOMER_SCHEMA_MAP) {
    assert.ok(entry.endpoint.startsWith('/api/customer'), `${entry.logical} must be served by the customer API`);
    assert.ok(entry.note.length > 30, `${entry.logical} needs an explanation of the translation`);
    assert.equal(entry, entityMap(entry.logical));
  }
});

test('no entity reaches outside the tables that exist', () => {
  for (const entry of CUSTOMER_SCHEMA_MAP) {
    for (const table of entry.tables) {
      assert.ok((PHYSICAL_TABLES as readonly string[]).includes(table), `${entry.logical} reads ${table}, which is not an allowed table`);
    }
    if (entry.kind === 'device') {
      assert.equal(entry.table, null, `${entry.logical} is device-stored and must not claim a host table`);
    }
    if (entry.kind !== 'device') {
      assert.ok(entry.tables.length, `${entry.logical} must name where its data comes from`);
    }
    assert.ok(
      ['public-active', 'self'].includes(entry.readScope),
      `${entry.logical} must declare who may read it`
    );
    assert.ok(['none', 'owner-only', 'self'].includes(entry.writeScope), `${entry.logical} has an unknown write scope`);
  }
  // The catalogue is read-only for customers: a customer app that could edit a
  // salon's prices would be a data-integrity incident, not a feature.
  for (const logical of ['salons', 'salon_services', 'salon_staff', 'offers', 'staff_slots']) {
    const entry = entityMap(logical);
    assert.ok(entry, `${logical} must be in the map`);
    assert.notEqual(entry!.writeScope, 'self', `${logical} is the salon's data; customers must not write it`);
  }
});

test('discovery only ever lists published salons, and private data by token id', () => {
  assert.deepEqual(SALON_DISCOVERY_FILTERS.filter((filter) => filter.includes('salon_name')).length, 1);
  const profile = entityMap('profiles');
  assert.ok(profile!.filters.some((filter) => filter.includes('customerId') || filter.includes('user_id')));
  assert.ok(physicalTable('bookings') === 'bookings');
  assert.ok(requiredPhysicalTables().includes('clients'));
});

test('the gaps list admits what the schema cannot store, for every non-table entity', () => {
  const gapNames = CUSTOMER_SCHEMA_GAPS.map((gap) => gap.logical);
  for (const entry of CUSTOMER_SCHEMA_MAP) {
    if (entry.kind === 'device' || entry.kind === 'derived') {
      assert.ok(gapNames.includes(entry.logical), `${entry.logical} is not stored; the gap list must say so`);
    }
  }
  for (const gap of CUSTOMER_SCHEMA_GAPS) {
    assert.ok(gap.why && gap.needs, `${gap.logical} must explain both the limitation and the fix`);
  }
  // RLS truth: the app must not pretend a customer can read anything directly.
  assert.deepEqual(RLS_REALITY.customerScoped, []);
  assert.ok(RLS_REALITY.realtimeSafeWithoutChanges.includes('in_app_notifications'));
  assert.ok(!RLS_REALITY.realtimeSafeWithoutChanges.includes('bookings'));
});

// ---------------------------------------------------------------------------
// Referral codes
// ---------------------------------------------------------------------------

test('referral codes are derived from the account id, never typed free-hand', () => {
  const code = referralCodeFor(OWNER);
  assert.match(code, /^NX-[A-Z0-9]{8}$/);
  assert.equal(code, referralCodeFor(OWNER), 'the same id must always yield the same code');
  assert.notEqual(code, referralCodeFor(uid(2)), 'different customers, different codes');
  assert.equal(referralCodeFor(''), '');
  assert.equal(referralCodeFor(null), '');
  assert.equal(isReferralCode('NX-9b1deb4d'), true);
  assert.equal(isReferralCode('buy-now'), false);
  assert.equal(normalizeReferralCode('  nx-9b1deb4d '), 'NX-9B1DEB4D', 'case and separator are tolerated, then normalised');
  assert.equal(normalizeReferralCode('anything else'), '');
});

// ---------------------------------------------------------------------------
// Slot arithmetic — availability that has no table of its own
// ---------------------------------------------------------------------------

test('a slot grid respects duration, held times and the clock', () => {
  const now = new Date('2026-09-08T09:00:00');
  const slots = buildSlotGrid({
    date: '2026-09-30',
    fromTime: '10:00',
    toTime: '12:00',
    stepMinutes: 30,
    durationMinutes: 60,
    takenTimes: ['10:30'],
    now,
  });
  // 10:00 and 10:30 start a 60-minute service inside a 12:00 close; 11:00 does;
  // 11:30 would end at 12:30, so it is not offered at all.
  assert.deepEqual(slots.map((slot) => slot.time), ['10:00', '10:30', '11:00']);
  assert.equal(slots.find((slot) => slot.time === '10:30')!.available, false, 'a held time is not free');
  assert.equal(slots.find((slot) => slot.time === '11:00')!.available, true);

  const today = buildSlotGrid({ date: toIsoDate(now), fromTime: '08:00', toTime: '12:00', takenTimes: [], now });
  assert.equal(today.find((slot) => slot.time === '08:00')!.available, false, 'a time that has already gone by is not bookable');
  assert.equal(today.find((slot) => slot.time === '09:00')!.available, false, 'now itself is past: the stylist is meant to be cutting hair');
  assert.equal(today.find((slot) => slot.time === '10:00')!.available, true, 'later today is still open');
  // A `time`-typed read (`11:00:00`) must not be mistaken for a free slot.
  const oddSpelling = buildSlotGrid({ date: '2026-09-30', fromTime: '10:00', toTime: '12:00', durationMinutes: 30, takenTimes: ['10:00:00', '10:30 AM'], now });
  assert.equal(oddSpelling.find((slot) => slot.time === '10:00')!.available, false, 'HH:MM:SS holds the slot');
  assert.equal(oddSpelling.find((slot) => slot.time === '10:30')!.available, false, 'a meridiem spelling holds it too');

  assert.deepEqual(buildSlotGrid({ date: '2026-09-30', fromTime: '12:00', toTime: '10:00', takenTimes: [], now }), [], 'a reversed window offers nothing');
});

test('a stylist’s own schedule wins, then the salon’s published hours', () => {
  const personal = [{ day: 'Wednesday', enabled: true, fromTime: '11:00', toTime: '14:00' }];
  assert.deepEqual(dayWindowFor(personal, '2026-09-30'), { fromTime: '11:00', toTime: '14:00' });
  assert.equal(dayWindowFor(personal, '2026-10-01'), null, 'Thursday is not scheduled');
  assert.equal(dayWindowFor([{ day: 'Wednesday', enabled: false, fromTime: '11:00', toTime: '14:00' }], '2026-09-30'), null, 'a disabled day is closed');
  assert.equal(dayWindowFor('nonsense', '2026-09-30'), null, 'a malformed jsonb value yields no window, not a crash');

  const hours = { monFri: '10:00 - 19:00', saturday: '10:00-17:00', sunday: 'closed' };
  assert.deepEqual(salonWindowFromHours(hours, '2026-09-30'), { fromTime: '10:00', toTime: '19:00' });
  assert.deepEqual(salonWindowFromHours(hours, '2026-10-03'), { fromTime: '10:00', toTime: '17:00' });
  assert.equal(salonWindowFromHours(hours, '2026-10-04'), null, 'a closed Sunday is closed');
  assert.equal(salonWindowFromHours(null, '2026-09-30'), null);
});

test('only statuses that actually hold a slot block it', () => {
  for (const status of ['pending', 'confirmed', 'in_progress', 'reschedule_requested', 'reschedule_proposed']) {
    assert.equal(slotStatusBlocks(status), true, `${status} must hold the slot`);
  }
  for (const status of ['cancelled', 'completed', 'no_show', 'unknown']) {
    assert.equal(slotStatusBlocks(status), false, `${status} must not hold a slot`);
  }
});

test('a slot window says where it came from and why it is empty', () => {
  const window = toSlotWindow({ salonId: OWNER, date: '2026-09-30', serviceIds: ['s1'], durationMinutes: 60, slots: [], anyStaffScheduled: false, anyAvailable: false });
  assert.equal(window.closedReason, 'no-schedule');
  assert.equal(window.source, 'derived');
  const full = toSlotWindow({
    salonId: OWNER,
    date: '2026-09-30',
    serviceIds: [],
    durationMinutes: 30,
    slots: [{ date: '2026-09-30', time: '10:00', staffId: 'a', staffName: 'Neha', available: true, reason: '' }],
    anyStaffScheduled: true,
    anyAvailable: true,
  });
  assert.equal(full.closedReason, '');
  assert.equal(full.slots.length, 1);
});

test('distance is only reported when both places have coordinates', () => {
  assert.equal(distanceKm({ latitude: 12.97, longitude: 77.59 }, { latitude: 12.93, longitude: 77.62 }), 5.5);
  assert.equal(distanceKm({ latitude: null, longitude: null }, { latitude: 12.93, longitude: 77.62 }), null);
  assert.equal(distanceKm(null, null), null);
  assert.equal(todayIsoDate(new Date(2026, 0, 5)), '2026-01-05');
});

// ---------------------------------------------------------------------------
// Mappers: a missing column is empty, never invented
// ---------------------------------------------------------------------------

test('an empty profiles row does not become a salon', () => {
  assert.equal(isSalonProfile({ id: OWNER, salon_name: 'Glow', subdomain: 'glow', business_type: 'unisex_salons' }), true);
  assert.equal(isSalonProfile({ id: OWNER, full_name: 'Ananya', email: 'a@b.c' }), false);
  assert.equal(isSalonProfile({ id: OWNER, salon_name: 'Glow', subdomain: null, business_type: 'unisex_salons' }), false);
  assert.equal(isSalonProfile(null), false);
});

test('a salon maps its own columns and leaves the rest blank', () => {
  const salon = toCustomerSalon({
    id: OWNER,
    salon_name: 'Glow Studio',
    subdomain: 'GLOW',
    city: 'Bengaluru',
    theme_accent_key: 'rose',
    working_hours: { monFri: '10:00 - 19:00' },
    require_deposit: true,
    deposit_percentage: 30,
    home_service: { enabled: true },
  });
  assert.equal(salon.name, 'Glow Studio');
  assert.equal(salon.subdomain, 'glow');
  assert.equal(salon.themeAccentKey, 'rose');
  assert.equal(salon.requireDeposit, true);
  assert.equal(salon.depositPercentage, 30);
  assert.equal(salon.homeServiceEnabled, true);
  assert.equal(salon.phone, '', 'a column that is absent stays empty rather than gaining a phone number');
  assert.equal(salon.rating.count, 0, 'no reviews yet is not a five-star salon');
  assert.equal(salon.distanceKm, null);
  assert.equal(salon.source, 'supabase');

  const sparse = toCustomerSalon({ id: OWNER, salon_name: 'X', subdomain: 'x' });
  assert.equal(sparse.currency, '₹');
  assert.equal(sparse.openNow, null, 'without working hours the app cannot claim it is open');
});

test('open-now is computed from the published hours and the wall clock', () => {
  const hours = { monFri: '10:00 - 19:00', saturday: '10:00 - 17:00', sunday: 'closed' };
  assert.equal(openNowFrom(hours, new Date('2026-09-30T11:00:00')), true); // Wed 11:00
  assert.equal(openNowFrom(hours, new Date('2026-09-30T21:00:00')), false);
  assert.equal(openNowFrom(null, new Date('2026-09-30T11:00:00')), null);
});

test('services and staff never grow fields the owner did not set', () => {
  const service = toCustomerService({ id: 's1', owner_id: OWNER, name: 'Hair Spa' });
  assert.equal(service.price, 0);
  assert.equal(service.durationMinutes, DEFAULT_SERVICE_MINUTES, 'the display default must be the number the slot grid uses');
  assert.equal(service.category, 'General', 'an uncategorised service groups under the label the owner app uses');
  const staff = toCustomerStaff({ id: 'st1', owner_id: OWNER, name: 'Neha', hide_phone: true, phone: '+91 99999 00000' });
  assert.equal(staff.phone, '', 'hide_phone is honoured by the mapper, not by the screen');
  assert.equal(staff.scheduleConfigured, false);
  assert.deepEqual(staff.assignedServiceIds, []);
});

test('service lines come from the booking, with no invented items', () => {
  const stored = toBookingServiceLines({
    id: 'b1',
    metadata: {
      services: [
        { id: `${OWNER}-0`, service_id: 's1', name: 'Hair Spa', price: 1200, duration_minutes: 60, staff_id: 'st1', staff_name: 'Neha' },
        { id: `${OWNER}-1`, service_id: 's2', name: 'Beard Trim', price: 400, duration_minutes: 20, staff_id: 'st1', staff_name: 'Neha' },
      ],
    },
  });
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map((line) => line.name), ['Hair Spa', 'Beard Trim']);

  const legacy = toBookingServiceLines({ id: 'b2', service_id: 's1', service_name: 'Hair Spa', metadata: null });
  assert.equal(legacy.length, 1, 'a booking without lines is one service, not zero');
  assert.equal(legacy[0].price, 0, 'the old row never stored a line price, so none is invented');

  const empty = toBookingServiceLines({ id: 'b3' });
  assert.deepEqual(empty, []);
});

test('a booking maps amounts, status and its review; balance never goes negative', () => {
  const booking = toCustomerBooking({
    id: 'b1',
    owner_id: OWNER,
    user_id: uid(1),
    customer_name: 'Ananya',
    service_name: 'Hair Spa',
    booking_date: '2026-09-30T00:00:00.000Z',
    time_slot: '11:00:00',
    total_amount: 1600,
    advance_paid_amount: 2000,
    status: 'reschedule_proposed',
    payment_status: 'paid_deposit',
    proposed_date: '2026-10-02',
    proposed_time_slot: '12:30',
    metadata: { review_rating: 5, review_text: 'Loved it', staff_id: 'st1', referral_code: 'NX-9b1deb4d' },
  });
  assert.equal(booking.date, '2026-09-30');
  assert.equal(booking.time, '11:00', 'HH:MM:SS is reduced to HH:MM for the UI');
  assert.equal(booking.balanceDue, 0, 'an over-paid booking is owed nothing, not -400');
  assert.equal(booking.status, 'reschedule_proposed');
  assert.equal(booking.proposedDate, '2026-10-02');
  assert.equal(booking.review?.rating, 5);
  assert.equal(booking.review?.text, 'Loved it');
  assert.equal(booking.referralCode, 'NX-9B1DEB4D');
  assert.deepEqual(booking.staffNames, []);
});

test('deposit amounts only exist when the customer app stored a policy', () => {
  const withPolicy = { total_amount: 1600, advance_paid_amount: 0, payment_status: 'pending', metadata: { deposit_policy: { percentage: 20 } } };
  assert.equal(depositPolicyPercent(withPolicy), 20);
  assert.equal(depositDueFor(withPolicy), 320);
  assert.equal(depositDueFor({ ...withPolicy, payment_status: 'paid_deposit' }), 0, 'paid is not due');
  assert.equal(depositDueFor({ ...withPolicy, advance_paid_amount: 320 }), 0);
  assert.equal(depositPolicyPercent({ total_amount: 1600, metadata: null }), 0);
  assert.equal(depositDueFor({ total_amount: 1600, metadata: { deposit_policy: { percentage: 140 } } }), 0, 'a nonsense percentage is refused');
  assert.equal(jsonValue({ metadata: '{"review_rating":4}' }, 'review_rating'), 4, 'a jsonb column stored as text still reads');
});

test('rewards and QR payments name the rows they came from', () => {
  const wallet = toRewardWallet(
    { id: 'c1', owner_id: OWNER, name: 'Ananya', points: 240, lifetime_points: 500, total_visits: 4, loyalty_tier: 'gold' },
    { salonName: 'Glow Studio', config: { tier_thresholds: { gold: 200, platinum: 600 } } }
  );
  assert.equal(wallet.points, 240);
  assert.equal(wallet.salonName, 'Glow Studio');
  // `pointsNeeded` is what is still TO GO, not the absolute threshold — the tier
  // is earned on lifetime points, so 600 - 500. `progress` is the fraction of the
  // way from the tier floor (gold 200) to that threshold: (500-200)/(600-200).
  // The view multiplies by 100 once; a screen that subtracted `points` from
  // `pointsNeeded` again would print 100-240 = 0 forever.
  assert.deepEqual(wallet.nextTier, { tier: 'platinum', pointsNeeded: 100, progress: 0.75 });

  const topWallet = toRewardWallet(
    { id: 'c1', owner_id: OWNER, points: 900, lifetime_points: 900, loyalty_tier: 'platinum' },
    { salonName: 'Glow Studio', config: { tier_thresholds: { gold: 200, platinum: 600 } } }
  );
  assert.equal(topWallet.nextTier, null, 'nothing is above the top configured tier');

  const membership = toMembership(
    { id: 'c1', owner_id: OWNER, points: 240, lifetime_points: 500, loyalty_tier: 'gold', created_at: '2026-01-01T00:00:00Z' },
    { salonName: 'Glow Studio', config: { tier_thresholds: { gold: 200, platinum: 600 }, tier_multipliers: { gold: 1.5 }, points_per_visit: 10, points_per_hundred_spent: 1 } }
  );
  // Same units as the wallet, so both bars are drawn with one formula.
  assert.equal(membership.nextTier!.pointsNeeded, 100);
  assert.ok(membership.nextTier!.progress > 0 && membership.nextTier!.progress <= 1, `membership progress must be a 0..1 fraction, got ${membership.nextTier!.progress}`);
  assert.equal(membership.benefits.length, 3, 'benefits are the configured multiplier and earning rules, not invented copy');

  const transaction = toRewardTransaction({ id: 't1', created_at: '2026-09-01T10:00:00Z', points_change: -100, description: 'Redeemed free mask', type: 'redeem' });
  assert.equal(transaction.pointsChange, -100);
  assert.equal(transaction.type, 'redeem');

  // `loyalty_point_transactions` has no amount or reference column, and adding
  // one is out of bounds, so the ledger's `description` is the record. The writer
  // in server/customerRoutes.ts and this parser are the two ends of that
  // agreement — this test is what keeps them from drifting apart.
  const description = `QR payment ₹${(750).toFixed(2)} ref:UPI-123`;
  const qr = toQrPayment({ id: 'q1', date: '2026-09-01', points_change: 75, description, type: QR_PAYMENT_TYPE });
  assert.equal(qr.amount, 750);
  assert.equal(qr.reference, 'UPI-123');
  assert.equal(qr.pointsCredited, 75);
  assert.equal(qr.date, '2026-09-01');
  assert.equal(qr.status, 'credited');
  assert.equal(QR_PAYMENT_TYPE, 'qr_payment');
  const unreadable = toQrPayment({ id: 'q2', description: 'Owner added points by hand', type: 'manual' });
  assert.equal(unreadable.amount, 0, 'a row that never carried an amount does not gain one');
  assert.ok(REWARD_TYPE_PREFIX === 'Referral', 'referral ledger rows are matched by this prefix');
});

test('favourites are counted from real bookings, newest first', () => {
  const bookings = [
    { salonId: OWNER, salonName: 'Glow Studio', date: '2026-08-01', staffNames: ['Neha'] },
    { salonId: OWNER, salonName: 'Glow Studio', date: '2026-09-02', staffNames: ['Neha', 'Aarav'] },
    { salonId: uid(7), salonName: 'Other Salon', date: '2026-01-05', staffNames: [] },
  ] as any[];
  const favourites = deriveFavourites(bookings, new Map());
  const glow = favourites.find((item) => item.kind === 'salon' && item.salonId === OWNER)!;
  assert.equal(glow.visits, 2);
  assert.equal(glow.lastVisit, '2026-09-02');
  assert.equal(glow.source, 'derived');
  assert.equal(favourites.filter((item) => item.kind === 'staff').length, 2);
  assert.equal(favourites[0].lastVisit, '2026-09-02', 'the most recent visit leads the list');

  const merged = mergeFavourites(favourites, [{ salonId: uid(9), staffId: '', kind: 'salon', salonName: 'New Place', staffName: '', pinnedAt: '2026-09-05T10:00:00Z' }]);
  assert.equal(merged.some((item) => item.origin === 'pinned' && item.salonName === 'New Place'), true);
  assert.equal(isPinned([{ salonId: uid(9), staffId: '', kind: 'salon', salonName: '', staffName: '', pinnedAt: '' }] as any, { salonId: uid(9), kind: 'salon' }), true);
  assert.equal(isPinned([{ salonId: uid(9), staffId: 'st1', kind: 'staff', salonName: '', staffName: '', pinnedAt: '' }] as any, { salonId: uid(9), kind: 'salon' }), false, 'a staff pin is not a salon pin');
});

// ---------------------------------------------------------------------------
// Realtime signals and error copy
// ---------------------------------------------------------------------------

test('a notification wakes only the channels it actually touches', () => {
  assert.equal(notificationTouches({ title: 'Booking confirmed', message: 'Your Hair Spa booking' }, ['bookings']), true);
  assert.equal(notificationTouches({ title: 'New booking', message: 'Riya booked' }, ['notifications']), true);
  assert.equal(notificationTouches({ title: 'Weekly video', message: 'new reel' }, ['rewards']), false);
  assert.equal(notificationTouches(null, ['bookings']), false);
});

test('the slot poll only re-renders when availability moved', () => {
  const slots = [
    { time: '10:00', staffId: 'a', available: true },
    { time: '10:30', staffId: 'a', available: false },
  ];
  const shape = (items: any[]) => ({ salonId: OWNER, date: '2026-09-30', slots: items });
  assert.equal(slotsSignature(shape(slots)), slotsSignature(shape([...slots.map((slot) => ({ ...slot }))])));
  assert.notEqual(slotsSignature(shape(slots)), slotsSignature(shape([{ ...slots[0], available: false }, slots[1]])), 'a slot that just got taken must change the signature');
  assert.notEqual(slotsSignature(shape(slots)), slotsSignature(shape([slots[0]])), 'a missing slot must change it too');
});

test('every failure code a screen can hit has customer-readable text', () => {
  const codes = ['auth_required', 'supabase_not_configured', 'slot_taken', 'not_cancellable', 'not_found', 'rate_limited', 'network_error', 'timeout', 'invalid_request'];
  for (const code of codes) {
    const text = normalizeCustomerErrorMessage({ code });
    assert.ok(text.length > 15, `${code} must explain itself`);
    assert.equal(/^[a-z_]+$/.test(text), false, `${code} must not surface its raw code`);
  }
  assert.equal(normalizeCustomerErrorMessage({ code: 'mystery', error: 'Salon is closed today.' }), 'Salon is closed today.', 'an unknown code keeps the server’s sentence');
  const nothing = normalizeCustomerErrorMessage({});
  assert.ok(nothing.length > 0);
  assert.match(nothing, /not/i);
});

// ---------------------------------------------------------------------------
// The rules that keep this out of becoming a demo again
// ---------------------------------------------------------------------------

function customerSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) customerSourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test('no customer file imports mock data or queries Supabase directly', () => {
  const files = [...customerSourceFiles(join(process.cwd(), 'src/customer')), ...customerSourceFiles(join(process.cwd(), 'src/lib/customer'))];
  assert.ok(files.length >= 10, 'the customer app should have a real file set');
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/from '\.\.\/mockData'|from '\.\/mockData'|INITIAL_(SALON|SERVICES|STYLISTS|APPOINTMENTS|CLIENTS)/.test(source), false, `${file} still uses mock data`);
    // Screens must go through src/lib/customer/api.ts; only that file (and the
    // auth screen, which needs the session) may touch the client.
    if (!file.includes('/lib/customer/') && !file.endsWith('Auth.tsx')) {
      assert.equal(/from '\.\.\/\.\.\/lib\/supabaseClient'|supabase\.from\(/.test(source), false, `${file} reads Supabase directly, skipping the API’s scoping`);
      assert.equal(/\bfetch\(\s*['"`]\/api\//.test(source), false, `${file} calls fetch instead of the customer API wrapper`);
    }
  }
});

test('the customer app is mounted without disturbing the owner screens', () => {
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(app, /isCustomerAppPath\(path\)/);
  assert.match(app, /<CustomerApp/);
  // The customer surface must silence the owner’s auto-save engine: a signed-out
  // visitor must never write the default profile over a real salon's row.
  assert.match(app, /if \(isCustomerApp\) return;/);
  assert.match(app, /isMockSupabase \|\| isPublicSite \|\| isCustomerApp/);
  const ownerModal = readFileSync(join(process.cwd(), 'src/components/BookingModal.tsx'), 'utf8');
  assert.equal(ownerModal.includes("from '../mockData'"), false, 'the booking widget must not fall back to a fictional salon');
});
