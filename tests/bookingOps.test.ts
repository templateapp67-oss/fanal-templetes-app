import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isUuidLike,
  sanitizeBookingRow,
  applyBookingUpdate,
  buildStatusNotifications,
} from '../server/bookingOps';

const UUID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

// ============================================================================
// sanitizeBookingRow — guest bookings must never send non-UUID preview ids to
// uuid FK columns, and unknown payload keys must not crash the insert.
// ============================================================================

test('sanitizeBookingRow drops non-UUID service/owner ids but keeps service_name', () => {
  const row = sanitizeBookingRow({
    owner_id: 'owner@salon.com',          // legacy/demo non-uuid owner reference
    customer_name: 'Riya Sharma',
    service_id: 'hs-1',                   // local editor template id
    service_name: 'Hair Spa',
    booking_date: '2026-09-20',
    time_slot: '11:30',
    unknown_column_from_newer_build: 'x',
  });
  assert.equal(row.owner_id, null);
  assert.equal(row.service_id, null);
  assert.equal(row.service_name, 'Hair Spa');
  assert.equal(row.booking_date, '2026-09-20');
  assert.ok(!('unknown_column_from_newer_build' in row));
});

test('sanitizeBookingRow keeps valid uuid foreign keys untouched', () => {
  const row = sanitizeBookingRow({ service_id: UUID, owner_id: UUID, service_name: 'Cut' });
  assert.equal(row.service_id, UUID);
  assert.equal(row.owner_id, UUID);
});

test('sanitizeBookingRow tolerates null/undefined/garbage input', () => {
  assert.deepEqual(sanitizeBookingRow(null), {});
  assert.deepEqual(sanitizeBookingRow(undefined), {});
  assert.deepEqual(sanitizeBookingRow('nope'), {});
});

test('isUuidLike only accepts uuid-shaped strings', () => {
  assert.ok(isUuidLike(UUID));
  assert.ok(!isUuidLike('hs-1'));
  assert.ok(!isUuidLike('apt-1693999000777'));
  assert.ok(!isUuidLike(null));
  assert.ok(!isUuidLike(42));
});

// ============================================================================
// applyBookingUpdate — the reschedule-accept bug: confirming a booking with a
// proposed slot must MOVE the booking to the proposal and clear it, not just
// flip the status.
// ============================================================================

test('confirming a booking with a proposed slot promotes the proposal and clears it', () => {
  const existing = {
    booking_date: '2026-09-10',
    time_slot: '10:00',
    status: 'reschedule_proposed',
    proposed_date: '2026-09-12',
    proposed_time_slot: '16:00',
  };
  const changes = applyBookingUpdate(existing, { status: 'confirmed' });
  assert.equal(changes.booking_date, '2026-09-12');
  assert.equal(changes.time_slot, '16:00');
  assert.equal(changes.proposed_date, null);
  assert.equal(changes.proposed_time_slot, null);
  assert.equal(changes.status, 'confirmed');
});

test('confirming a booking without a proposal keeps the original slot', () => {
  const changes = applyBookingUpdate(
    { booking_date: '2026-09-10', time_slot: '10:00' },
    { status: 'confirmed' }
  );
  assert.equal(changes.status, 'confirmed');
  assert.ok(!('booking_date' in changes));
  assert.ok(!('proposed_date' in changes));
});

test('proposing a reschedule stores the proposal without touching the booked slot', () => {
  const changes = applyBookingUpdate(
    { booking_date: '2026-09-10', time_slot: '10:00' },
    { status: 'reschedule_proposed', proposed_date: '2026-09-13', proposed_time_slot: '19:00' }
  );
  assert.equal(changes.status, 'reschedule_proposed');
  assert.equal(changes.proposed_date, '2026-09-13');
  assert.equal(changes.proposed_time_slot, '19:00');
  assert.ok(!('booking_date' in changes));
});

test('cancelling only flips the status', () => {
  const changes = applyBookingUpdate(
    { booking_date: '2026-09-10', time_slot: '10:00', proposed_date: '2026-09-12' },
    { status: 'cancelled' }
  );
  assert.equal(changes.status, 'cancelled');
  assert.ok(!('booking_date' in changes));
  assert.ok(!('proposed_date' in changes));
});

// ============================================================================
// buildStatusNotifications — the owner must be notified at the salon's real
// email (resolved from profiles), never a hardcoded demo address, and the
// customer notification uses the booking's own email.
// ============================================================================

test('buildStatusNotifications addresses the real owner email and the customer', () => {
  const notifs = buildStatusNotifications(
    { customer_name: 'Riya Sharma', customer_email: 'riya@example.com', booking_date: '2026-09-20', time_slot: '11:30' },
    'confirmed',
    null,
    null,
    'uma@blushsalon.com'
  );
  assert.ok(notifs);
  assert.equal(notifs!.owner.user_email, 'uma@blushsalon.com');
  assert.equal(notifs!.customer!.user_email, 'riya@example.com');
  assert.match(notifs!.customer!.message, /2026-09-20/);
});

test('buildStatusNotifications falls back to the demo owner address when no email is known', () => {
  const notifs = buildStatusNotifications(
    { customer_name: 'Riya', customer_email: 'riya@example.com', booking_date: '2026-09-20', time_slot: '11:30' },
    'confirmed'
  );
  assert.equal(notifs!.owner.user_email, 'owner@salon.com');
});

test('buildStatusNotifications skips the customer row when the booking has no email', () => {
  const notifs = buildStatusNotifications(
    { customer_name: 'Walk-in', booking_date: '2026-09-20', time_slot: '11:30' },
    'confirmed'
  );
  assert.equal(notifs!.owner.user_email, 'owner@salon.com');
  assert.ok(!('customer' in notifs!));
});

test('buildStatusNotifications returns null for statuses with no notification', () => {
  assert.equal(buildStatusNotifications({}, 'pending'), null);
  assert.equal(buildStatusNotifications(null, 'confirmed'), null);
});
