// ============================================================================
// The advance-payment contract in the APPLICATION.
//
// `salon_booking_settings_deposit_25_check` requires exactly 25%. The database
// side is covered by tests/salonBookingSettingsAdvance25.test.ts; this file
// covers every payload the app can produce, because the 23514 that took signup,
// profile setup, template selection and the services save down was a VALUE the
// app sent, not a schema problem.
// ============================================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADVANCE_PERCENT_COLUMNS,
  DEFAULT_DEPOSIT_PERCENT,
  REQUIRED_ADVANCE_PERCENT,
  buildBookingSettingsPayload,
  computeAdvanceDeposit,
  normalizeDepositPercentage,
  readAdvancePercent,
} from '../src/lib/advanceDeposit';
import {
  BOOKING_SETTINGS_REJECTION_MESSAGE,
  describeProfileSaveFailure,
  isBookingSettingsRejection,
} from '../src/lib/bookingSettingsErrors';
import { toProfileRow } from '../src/lib/salonSync';
import { prepareWebsiteStateForSave } from '../src/lib/websiteContentNormalize';
import { classifyWebsiteSaveError } from '../src/lib/websiteSaveErrors';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const RAW_23514 =
  'new row for relation "public.salon_booking_settings" violates check constraint ' +
  '"salon_booking_settings_deposit_25_check"';

test('the advance contract is one number, and the two exported names agree', () => {
  assert.equal(REQUIRED_ADVANCE_PERCENT, 25);
  assert.equal(DEFAULT_DEPOSIT_PERCENT, REQUIRED_ADVANCE_PERCENT);
  assert.deepEqual([...ADVANCE_PERCENT_COLUMNS], ['deposit_percent', 'deposit_percentage', 'deposit_25']);
});

test('0, null, undefined, "" and every wrong percentage normalize to 25', () => {
  for (const value of [undefined, null, '', '   ', Number.NaN, 0, -1, 20, 30, 999, '0', '20', '25%', 25.4, 1e6]) {
    assert.equal(normalizeDepositPercentage(value), 25, `normalizeDepositPercentage(${JSON.stringify(value)})`);
  }
  assert.equal(normalizeDepositPercentage(25), 25);
  // The read side is equally strict: a legacy row never reaches the customer.
  assert.equal(readAdvancePercent({ deposit_percentage: 20 }), 25);
  assert.equal(readAdvancePercent({ deposit_percentage: null }), 25);
  assert.equal(readAdvancePercent(null), 25);
});

test('the booking-settings payload is always 25% and carries the two owner switches', () => {
  const blank = buildBookingSettingsPayload(null);
  assert.deepEqual(blank, {
    require_deposit: true,
    deposit_percent: 25,
    deposit_percentage: 25,
    deposit_25: 25,
    accept_online_bookings: true,
  });

  // A profile hydrated from a pre-fix row cannot drag the percentage down.
  const stale = buildBookingSettingsPayload({ requireDeposit: false, depositPercentage: 20 } as any);
  assert.equal(stale.deposit_percent, 25);
  assert.equal(stale.deposit_percentage, 25);
  assert.equal(stale.deposit_25, 25);
  assert.equal(stale.require_deposit, false, 'the require switch is the owner’s, not the contract’s');

  // accept_online_bookings: unspecified → true, explicit false → preserved.
  assert.equal(buildBookingSettingsPayload({}).accept_online_bookings, true);
  assert.equal(buildBookingSettingsPayload({ acceptsOnlineBookings: false }).accept_online_bookings, false);
  assert.equal(buildBookingSettingsPayload({ accept_online_bookings: false }).accept_online_bookings, false);
  assert.equal(buildBookingSettingsPayload({ acceptsOnlineBookings: 'false' }).accept_online_bookings, false);

  // An explicit settings object wins for the switches, never for the percent.
  const merged = buildBookingSettingsPayload(
    { acceptsOnlineBookings: true } as any,
    { accept_online_bookings: false, deposit_percent: 20 } as any
  );
  assert.equal(merged.accept_online_bookings, false);
  assert.equal(merged.deposit_percent, 25);
});

test('the profiles row written by the editor save carries 25, whatever the state held', () => {
  const row = toProfileRow(
    { businessName: 'Studio', requireDeposit: true, depositPercentage: Number.NaN } as any,
    OWNER
  );
  assert.equal(row.deposit_percentage, 25);
  assert.equal(row.require_deposit, true);

  const legacy = toProfileRow({ businessName: 'Studio', depositPercentage: 20 } as any, OWNER);
  assert.equal(legacy.deposit_percentage, 25, 'a 20 in editor state must not reach profiles');
});

test('the save-time repair rewrites 0 / null / 20 in the prepared payload to 25', () => {
  const prepared = prepareWebsiteStateForSave({
    profile: { businessName: 'Studio', depositPercentage: 999, deposit_percentage: 0, deposit_25: 20 },
    services: [],
    stylists: [],
  });
  assert.equal((prepared.payload as any).profile.depositPercentage, 25);
  assert.equal((prepared.payload as any).profile.deposit_percentage, 25);
  assert.equal((prepared.payload as any).profile.deposit_25, 25);
  assert.deepEqual(prepared.errors, []);
});

test('the checkout arithmetic still quotes 25% of the total', () => {
  assert.deepEqual(computeAdvanceDeposit(348), { rupees: 87, paise: 8700, percent: 25 });
  assert.deepEqual(computeAdvanceDeposit(1187.5), { rupees: 297, paise: 29700, percent: 25 });
  assert.deepEqual(computeAdvanceDeposit(0), { rupees: 0, paise: 0, percent: 25 });
});

test('a 23514 on salon_booking_settings becomes an instruction, not a constraint name', () => {
  assert.equal(isBookingSettingsRejection(`23514 ${RAW_23514}`), true);
  assert.equal(isBookingSettingsRejection(RAW_23514), true);
  // An unrelated check violation is NOT mislabelled as an advance problem.
  assert.equal(
    isBookingSettingsRejection(
      'new row for relation "growth_partners" violates check constraint "growth_partners_kyc_status_check"'
    ),
    false
  );
  assert.equal(isBookingSettingsRejection('permission denied for table salon_booking_settings'), false);

  assert.match(BOOKING_SETTINGS_REJECTION_MESSAGE, /25%/);
  assert.equal(describeProfileSaveFailure(new Error(`Profile save failed (23514): ${RAW_23514}`)), BOOKING_SETTINGS_REJECTION_MESSAGE);
  assert.equal(
    describeProfileSaveFailure(new Error('Profile save failed (42501): new row violates row-level security policy')),
    'Your session no longer has permission to save. Sign out and sign in again, then save your details once more.'
  );

  // The website editor classifies it as a named field, so the toast and the
  // pinned issue say the same thing.
  const issue = classifyWebsiteSaveError(RAW_23514);
  assert.ok(issue, 'the save pipeline must recognise the booking-settings rejection');
  assert.equal(issue!.label, 'Booking settings › Advance payment');
  assert.equal(issue!.message, BOOKING_SETTINGS_REJECTION_MESSAGE);
});
