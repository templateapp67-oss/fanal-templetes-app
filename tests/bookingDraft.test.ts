// ============================================================================
// Booking draft (src/lib/bookingDraft.ts) — the payload "Retry Payment" and
// "Review Draft" work from. These tests pin down that every parameter the
// customer chose (salon, slot, stylist, services, deposit) survives a failed
// payment unchanged, and that the deposit maths matches the server.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildBookingDraft,
  toAdvancePaymentInput,
  recordPaymentAttempt,
  describeBookingDraft,
  draftHomeAddress,
  draftMatchesSalon,
  saveBookingDraft,
  loadBookingDraft,
  clearBookingDraft,
  isBookingDraft,
  BOOKING_DRAFT_STORAGE_KEY,
  BOOKING_DRAFT_TTL_MS,
} from '../src/lib/bookingDraft';

const NOW = new Date('2026-09-07T10:00:00.000Z');

function sampleDraft(overrides: Partial<Parameters<typeof buildBookingDraft>[0]> = {}) {
  return buildBookingDraft({
    id: 'NX-BLR-12345',
    salon: {
      ownerId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      subdomain: 'arts-by-uma',
      businessName: 'Arts By Uma',
      city: 'Bengaluru',
      email: 'hello@artsbyuma.com',
      currency: '₹',
    },
    service: { id: 'hs-2', name: 'Classic Layered Cut', price: 300, durationMinutes: 35 },
    upgrades: [{ id: 'hs-9', name: 'Head Massage', price: 48, durationMinutes: 15 }],
    stylist: { id: 'st-1', name: 'Uma' },
    date: '2026-10-02',
    time: '11:30',
    bookingType: 'salon',
    customer: { name: '  Riya Sharma ', phone: '9845012345', email: 'riya@example.com', notes: 'Ring the bell' },
    paymentMethod: 'pay_advance_token',
    now: NOW,
    ...overrides,
  });
}

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

test('buildBookingDraft freezes every parameter and computes the 25 % deposit in ₹ and paise', () => {
  const draft = sampleDraft();
  assert.equal(draft.id, 'NX-BLR-12345');
  assert.equal(draft.salon.id, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  assert.equal(draft.salon.ownerId, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  assert.equal(draft.salon.subdomain, 'arts-by-uma');
  assert.equal(draft.service.name, 'Classic Layered Cut');
  assert.deepEqual(draft.upgrades.map((u) => u.name), ['Head Massage']);
  assert.deepEqual(draft.stylist, { id: 'st-1', name: 'Uma' });
  assert.deepEqual(draft.slot, { date: '2026-10-02', time: '11:30' });
  assert.equal(draft.customer.name, 'Riya Sharma', 'whitespace is trimmed');
  assert.equal(draft.customer.notes, 'Ring the bell');
  // 300 + 48 = 348 → 25 % = 87 → 8700 paise
  assert.equal(draft.pricing.total, 348);
  assert.equal(draft.pricing.depositPercent, 25);
  assert.equal(draft.pricing.depositAmount, 87);
  assert.equal(draft.pricing.depositPaise, 8700);
  assert.equal(draft.pricing.balance, 261);
  assert.equal(draft.payment.status, 'unpaid');
  assert.equal(draft.payment.attempts, 0);
});

test('a salon without an owner id still gets a stable salon identifier (the subdomain)', () => {
  const draft = sampleDraft({ salon: { ownerId: null, subdomain: 'glow-studio', businessName: 'Glow Studio' } });
  assert.equal(draft.salon.id, 'glow-studio');
  assert.equal(draft.salon.ownerId, null);
});

test('pay-at-salon drafts carry a zero deposit; home visits add the base charge and keep the address', () => {
  const paySalon = sampleDraft({ paymentMethod: 'pay_at_salon' });
  assert.equal(paySalon.pricing.depositAmount, 0);
  assert.equal(paySalon.pricing.balance, 348);

  const home = sampleDraft({
    bookingType: 'home',
    homeAddress: '12 MG Road',
    homePinCode: '560001',
    homeServiceCharge: 152,
  });
  assert.equal(home.pricing.total, 500);
  assert.equal(home.pricing.depositAmount, 125);
  assert.equal(home.homeAddress, '12 MG Road');
  assert.equal(home.homePinCode, '560001');
  assert.equal(draftHomeAddress(home), '12 MG Road (PIN: 560001)');
  assert.equal(draftHomeAddress(sampleDraft()), undefined);
});

test('toAdvancePaymentInput is deterministic — the same draft yields the same payment payload every time', () => {
  const draft = sampleDraft();
  const a = toAdvancePaymentInput(draft, { themeColor: '#123456' });
  const b = toAdvancePaymentInput(draft, { themeColor: '#123456' });
  assert.deepEqual(a, b);
  assert.equal(a.totalAmount, 348);
  assert.equal(a.depositPercent, 25);
  assert.equal(a.amount, 87);
  assert.equal(a.receipt, 'NX-BLR-12345');
  assert.equal(a.customer.contact, '9845012345');
  assert.equal(a.salonName, 'Arts By Uma');
  assert.match(a.description, /25% advance for Classic Layered Cut on 2026-10-02 at 11:30/);
  // Every draft parameter travels in the order notes for reconciliation.
  assert.equal(a.notes!.booking_ref, 'NX-BLR-12345');
  assert.equal(a.notes!.salon_id, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  assert.equal(a.notes!.stylist, 'Uma');
  assert.equal(a.notes!.slot, '2026-10-02 11:30');
  assert.equal(a.notes!.addons, 'Head Massage');
  assert.equal(a.mockOutcome, undefined);
  assert.equal(toAdvancePaymentInput(draft, { mockOutcome: 'failure' }).mockOutcome, 'failure');
});

test('recordPaymentAttempt keeps the draft intact across failures and only marks paid on a verified triple', () => {
  const draft = sampleDraft();
  const failed = recordPaymentAttempt(draft, { status: 'failed', error: 'Card declined', orderId: 'order_1' }, NOW);
  assert.equal(failed.payment.status, 'failed');
  assert.equal(failed.payment.attempts, 1);
  assert.equal(failed.payment.lastError, 'Card declined');
  assert.equal(failed.payment.lastOrderId, 'order_1');
  assert.equal(failed.payment.paymentId, null);
  // nothing else moved
  assert.deepEqual(failed.slot, draft.slot);
  assert.deepEqual(failed.stylist, draft.stylist);
  assert.deepEqual(failed.pricing, draft.pricing);
  assert.equal(draft.payment.attempts, 0, 'the original is not mutated');

  const dismissed = recordPaymentAttempt(failed, { status: 'dismissed', error: 'Payment window closed' }, NOW);
  assert.equal(dismissed.payment.status, 'dismissed');
  assert.equal(dismissed.payment.attempts, 2);
  assert.equal(dismissed.payment.lastOrderId, 'order_1', 'previous order id is kept when the new attempt had none');

  const paid = recordPaymentAttempt(
    dismissed,
    { status: 'paid', orderId: 'order_2', paymentId: 'pay_2', signature: 'sig', mode: 'test' },
    NOW
  );
  assert.equal(paid.payment.status, 'paid');
  assert.equal(paid.payment.attempts, 3);
  assert.equal(paid.payment.lastError, null);
  assert.equal(paid.payment.orderId, 'order_2');
  assert.equal(paid.payment.paymentId, 'pay_2');
  assert.equal(paid.payment.mode, 'test');
});

test('describeBookingDraft lists salon, services, stylist, slot, visit type, guest and deposit for Review Draft', () => {
  const rows = describeBookingDraft(sampleDraft());
  assert.deepEqual(rows.map((r) => r.key), ['salon', 'service', 'stylist', 'slot', 'type', 'customer', 'deposit']);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.match(byKey.salon.value, /Arts By Uma · arts-by-uma · Bengaluru/);
  assert.match(byKey.service.value, /Classic Layered Cut \(₹300\) \+ Head Massage \(₹48\)/);
  assert.equal(byKey.stylist.value, 'Uma');
  assert.equal(byKey.slot.value, '2026-10-02 at 11:30 IST');
  assert.equal(byKey.slot.editStep, 'datetime');
  assert.equal(byKey.type.value, 'In-salon');
  assert.match(byKey.customer.value, /Riya Sharma · \+91 9845012345 · riya@example.com/);
  assert.equal(byKey.customer.editStep, 'guest');
  assert.equal(byKey.deposit.value, '₹87 now (25% of ₹348) · ₹261 at the salon');
  assert.equal(byKey.deposit.editStep, undefined);

  const home = describeBookingDraft(sampleDraft({ bookingType: 'home', homeAddress: '12 MG Road', homePinCode: '560001', paymentMethod: 'pay_at_salon' }));
  const homeByKey = Object.fromEntries(home.map((r) => [r.key, r]));
  assert.equal(homeByKey.type.value, 'Home service — 12 MG Road (PIN 560001)');
  assert.equal(homeByKey.deposit.value, 'Nothing now · ₹348 at the salon');
});

test('sessionStorage round-trip: an unpaid, recent draft for the same salon is offered back', () => {
  const storage = new MemoryStorage();
  const draft = recordPaymentAttempt(sampleDraft(), { status: 'failed', error: 'Card declined' }, NOW);
  saveBookingDraft(draft, storage);
  assert.ok(storage.getItem(BOOKING_DRAFT_STORAGE_KEY));

  const later = new Date(NOW.getTime() + 5 * 60 * 1000);
  const loaded = loadBookingDraft({ salon: { ownerId: draft.salon.ownerId }, now: later, storage });
  assert.ok(loaded);
  assert.equal(loaded!.id, 'NX-BLR-12345');
  assert.equal(loaded!.payment.attempts, 1);
  assert.deepEqual(loaded!.slot, draft.slot);

  // matching by subdomain / name works when no owner id is available
  assert.ok(loadBookingDraft({ salon: { subdomain: 'arts-by-uma' }, now: later, storage }));
  assert.ok(loadBookingDraft({ salon: { name: 'Arts By Uma' }, now: later, storage }));
});

test('sessionStorage: another salon, a paid draft, or a stale draft is never resumed', () => {
  const storage = new MemoryStorage();
  const draft = recordPaymentAttempt(sampleDraft(), { status: 'dismissed' }, NOW);
  saveBookingDraft(draft, storage);
  const later = new Date(NOW.getTime() + 60 * 1000);

  assert.equal(loadBookingDraft({ salon: { ownerId: '3f0d9a2e-5c4b-4a1d-8b7e-11223344aabb' }, now: later, storage }), null);
  assert.equal(loadBookingDraft({ salon: { subdomain: 'other-salon' }, now: later, storage }), null);
  assert.ok(storage.getItem(BOOKING_DRAFT_STORAGE_KEY), 'a foreign salon\'s draft is left alone, not deleted');

  // stale
  const stale = new Date(NOW.getTime() + BOOKING_DRAFT_TTL_MS + 1000);
  assert.equal(loadBookingDraft({ salon: { ownerId: draft.salon.ownerId }, now: stale, storage }), null);
  assert.equal(storage.getItem(BOOKING_DRAFT_STORAGE_KEY), null, 'stale drafts are cleared');

  // paid
  saveBookingDraft(
    recordPaymentAttempt(draft, { status: 'paid', orderId: 'o', paymentId: 'p', signature: 's', mode: 'mock' }, NOW),
    storage
  );
  assert.equal(loadBookingDraft({ salon: { ownerId: draft.salon.ownerId }, now: later, storage }), null);

  // garbage
  storage.setItem(BOOKING_DRAFT_STORAGE_KEY, '{not json');
  assert.equal(loadBookingDraft({ now: later, storage }), null);
  storage.setItem(BOOKING_DRAFT_STORAGE_KEY, JSON.stringify({ id: 'x' }));
  assert.equal(loadBookingDraft({ now: later, storage }), null);

  clearBookingDraft(storage);
  assert.equal(storage.getItem(BOOKING_DRAFT_STORAGE_KEY), null);
});

test('draftMatchesSalon prefers the owner id, then the subdomain, then the name', () => {
  const draft = sampleDraft();
  assert.ok(draftMatchesSalon(draft, { ownerId: draft.salon.ownerId }));
  assert.ok(!draftMatchesSalon(draft, { ownerId: '3f0d9a2e-5c4b-4a1d-8b7e-11223344aabb', subdomain: 'arts-by-uma' }));
  assert.ok(draftMatchesSalon(draft, { subdomain: 'arts-by-uma' }));
  assert.ok(draftMatchesSalon(draft, { name: 'Arts By Uma' }));
  assert.ok(!draftMatchesSalon(draft, {}));
});

test('isBookingDraft validates the shape before anything is trusted from storage', () => {
  assert.ok(isBookingDraft(sampleDraft()));
  assert.ok(!isBookingDraft(null));
  assert.ok(!isBookingDraft({ id: 'x' }));
  assert.ok(!isBookingDraft({ ...sampleDraft(), pricing: {} }));
});

test('saveBookingDraft / loadBookingDraft are no-ops without storage (SSR / private mode)', () => {
  assert.doesNotThrow(() => saveBookingDraft(sampleDraft(), null));
  assert.equal(loadBookingDraft({ storage: null }), null);
  assert.doesNotThrow(() => clearBookingDraft(null));
});
