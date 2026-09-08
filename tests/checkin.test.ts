import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePassCode,
  passCodeFor,
  passCodeUserId,
  isCheckinOpenStatus,
  checkinEligibility,
  isBirthdayVisit,
  bonusPointsFrom,
  planCheckInCredits,
  DEFAULT_BIRTHDAY_BONUS_POINTS,
  DEFAULT_REFERRAL_BONUS_POINTS,
} from '../src/lib/customer/checkin';

// ============================================================================
// Pass codes — deterministic, reversible, no table behind them
// ============================================================================

const UUID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

test('pass codes round-trip for uuid and mock-style customer ids', () => {
  for (const id of [UUID, 'mock-customer-1', 'demo-customer', 'cust_42-abc']) {
    const code = passCodeFor(id);
    assert.ok(code.startsWith('FANAL-'), code);
    assert.equal(passCodeUserId(code), id);
  }
});

test('pass codes are stable for the same id', () => {
  assert.equal(passCodeFor(UUID), passCodeFor(UUID));
});

test('an empty id produces no code, and garbage never decodes to a user', () => {
  assert.equal(passCodeFor(''), '');
  assert.equal(passCodeFor(null), '');
  assert.equal(passCodeFor(undefined), '');
  assert.equal(passCodeUserId('FANAL-!!not-base64'), null);
  assert.equal(passCodeUserId('FANAL-'), null);
  assert.equal(passCodeUserId('NX-SOMETHING'), null);
  assert.equal(passCodeUserId(''), null);
});

test('typed codes tolerate a lowercase prefix, spaces and a missing dash', () => {
  const code = passCodeFor('mock-customer-1');
  // The body is case-sensitive base64url (it holds a uuid), so only the prefix
  // may be typed loosely — the payload must arrive verbatim.
  assert.equal(passCodeUserId(`fanal-${code.slice(6)}`), 'mock-customer-1');
  assert.equal(passCodeUserId(`  ${code.slice(0, 6)} ${code.slice(6)} `), 'mock-customer-1');
  // `fanal` without the dash is accepted; the payload itself is untouched.
  assert.equal(passCodeUserId(`fanal${code.slice(6)}`), 'mock-customer-1');
});

test('normalizePassCode canonicalises the prefix and rejects foreign codes', () => {
  assert.equal(normalizePassCode('FANAL-abc'), 'FANAL-abc');
  assert.equal(normalizePassCode('fan al-abc'), 'FANAL-abc');
  assert.equal(normalizePassCode('NX-ABC'), '');
  assert.equal(normalizePassCode('FANAL-abc!'), '');
});

// ============================================================================
// Check-in eligibility — only today, only an open booking
// ============================================================================

test('only open-status bookings on their own day can be checked in', () => {
  const open = { status: 'pending', booking_date: '2026-09-08' };
  assert.equal(checkinEligibility(open, '2026-09-08').ok, true);
  assert.equal(checkinEligibility({ ...open, status: 'confirmed' }, '2026-09-08').ok, true);
  assert.equal(checkinEligibility({ ...open, status: 'cancelled' }, '2026-09-08').ok, false);
  assert.equal(checkinEligibility({ ...open, status: 'completed' }, '2026-09-08').ok, false);
  assert.equal(checkinEligibility({ ...open, status: 'no_show' }, '2026-09-08').ok, false);
});

test('a booking is refused before its day, after it, and without a row', () => {
  const open = { status: 'pending', booking_date: '2026-09-10' };
  assert.equal(checkinEligibility(open, '2026-09-08').ok, false);
  assert.equal(checkinEligibility({ ...open, booking_date: '2026-09-07' }, '2026-09-08').ok, false);
  assert.equal(checkinEligibility(null, '2026-09-08').ok, false);
  assert.equal(isCheckinOpenStatus('pending'), true);
  assert.equal(isCheckinOpenStatus('cancelled'), false);
});

// ============================================================================
// Birthday rule — month/day equality, year ignored
// ============================================================================

test('a visit on the customer birthday earns the bonus; other dates do not', () => {
  assert.equal(isBirthdayVisit('2026-09-08', '1994-09-08'), true);
  assert.equal(isBirthdayVisit('2027-09-08', '1994-09-08'), true); // year differs — still the birthday
  assert.equal(isBirthdayVisit('2026-09-09', '1994-09-08'), false);
  assert.equal(isBirthdayVisit(null, '1994-09-08'), false);
  assert.equal(isBirthdayVisit('2026-09-08', null), false);
  assert.equal(isBirthdayVisit('2026-9-8', '1994-09-08'), false); // unnormalised date
});

// ============================================================================
// Credit planning — pure combination of resolved facts
// ============================================================================

test('config amounts are honoured, and defaults apply when unset', () => {
  assert.deepEqual(bonusPointsFrom({}), {
    birthdayBonusPoints: DEFAULT_BIRTHDAY_BONUS_POINTS,
    referralBonusPoints: DEFAULT_REFERRAL_BONUS_POINTS,
  });
  assert.deepEqual(bonusPointsFrom({ birthday_bonus_points: 500, referral_bonus_points: 0 }), {
    birthdayBonusPoints: 500,
    referralBonusPoints: 0,
  });
  assert.deepEqual(bonusPointsFrom({ birthday_bonus_points: 'x', referral_bonus_points: -3 }), {
    birthdayBonusPoints: DEFAULT_BIRTHDAY_BONUS_POINTS,
    referralBonusPoints: DEFAULT_REFERRAL_BONUS_POINTS,
  });
});

test('a birthday credit needs the day, an uncredited booking and a positive amount', () => {
  const base = {
    config: { birthday_bonus_points: 250 },
    isBirthdayVisit: true,
    birthdayNotYetCredited: true,
    hasReferralCode: false,
    referrerWalletResolved: false,
    referralNotYetCredited: true,
  };
  assert.deepEqual(planCheckInCredits(base), [{ kind: 'birthday', points: 250, label: 'Birthday bonus' }]);
  assert.deepEqual(planCheckInCredits({ ...base, isBirthdayVisit: false }), []);
  assert.deepEqual(planCheckInCredits({ ...base, birthdayNotYetCredited: false }), []);
  assert.deepEqual(planCheckInCredits({ ...base, config: { birthday_bonus_points: 0 } }), []);
});

test('a referral credit needs a code, a resolved referrer wallet and a fresh booking', () => {
  const base = {
    config: { referral_bonus_points: 100 },
    isBirthdayVisit: false,
    birthdayNotYetCredited: true,
    hasReferralCode: true,
    referrerWalletResolved: true,
    referralNotYetCredited: true,
  };
  assert.deepEqual(planCheckInCredits(base), [{ kind: 'referral', points: 100, label: 'Referral bonus' }]);
  assert.deepEqual(planCheckInCredits({ ...base, referrerWalletResolved: false }), []);
  assert.deepEqual(planCheckInCredits({ ...base, referralNotYetCredited: false }), []);
  assert.deepEqual(planCheckInCredits({ ...base, hasReferralCode: false }), []);
});

test('a birthday + referral check-in plans both credits in order', () => {
  const credits = planCheckInCredits({
    config: {},
    isBirthdayVisit: true,
    birthdayNotYetCredited: true,
    hasReferralCode: true,
    referrerWalletResolved: true,
    referralNotYetCredited: true,
  });
  assert.deepEqual(credits, [
    { kind: 'birthday', points: DEFAULT_BIRTHDAY_BONUS_POINTS, label: 'Birthday bonus' },
    { kind: 'referral', points: DEFAULT_REFERRAL_BONUS_POINTS, label: 'Referral bonus' },
  ]);
});
