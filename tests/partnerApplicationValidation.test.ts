// ============================================================================
// Growth Partner application — validation + sanitization (pure unit tests).
//
// These are the rules the reported bug depended on: before this module existed
// the form sent whatever the user typed, so an 11-digit "Aadhaar" number and a
// 5-digit phone number were both stored, and the only feedback was the generic
// "Application failed. Please try again.".
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidIndianMobile,
  KYC_DOCUMENT_TYPES,
  kycDocumentSpec,
  normalizeKycDocumentType,
  normalizeKycReference,
  normalizePhone,
  PARTNER_APPLICATION_MESSAGES,
  sanitizePersonName,
  validatePartnerApplication,
} from '../src/lib/partnerApplicationValidation';

const VALID = {
  fullName: 'Asha Sharma',
  phone: '9876543210',
  kycDocumentType: 'aadhaar',
  kycDocumentReference: '123456789012',
};

// ---------------------------------------------------------------------------
// Phone normalization (the "+91 / 0091 / 0 / spaces" forms all mean one number)
// ---------------------------------------------------------------------------

test('phone: every common Indian spelling collapses to the 10 national digits', () => {
  assert.equal(normalizePhone('9876543210'), '9876543210');
  assert.equal(normalizePhone('+91 98765 43210'), '9876543210');
  assert.equal(normalizePhone('+919876543210'), '9876543210');
  assert.equal(normalizePhone('0091-98765-43210'), '9876543210');
  assert.equal(normalizePhone('09876543210'), '9876543210');
  assert.equal(normalizePhone('  98765 43210  '), '9876543210');
});

test('phone: blank input stays blank (the field is optional)', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.equal(normalizePhone(blank), '');
    assert.equal(isValidIndianMobile(blank), false);
  }
});

test('phone: only 10 digits starting 6-9 are valid', () => {
  for (const good of ['9876543210', '6'.padEnd(10, '1'), '7123456789']) {
    assert.equal(isValidIndianMobile(good), true, `expected ${good} to be valid`);
  }
  for (const bad of ['91234', '0123456789', '5876543210', '98765432100', 'abcdefghij']) {
    assert.equal(isValidIndianMobile(bad), false, `expected ${bad} to be invalid`);
  }
});

// ---------------------------------------------------------------------------
// KYC reference normalization + per-document formats
// ---------------------------------------------------------------------------

test('kyc: separators and case are normalized away', () => {
  assert.equal(normalizeKycReference('aadhaar', '1234-5678-9012'), '123456789012');
  assert.equal(normalizeKycReference('aadhaar', '1234 5678 9012'), '123456789012');
  assert.equal(normalizeKycReference('pan', ' abcde1234f '), 'ABCDE1234F');
  assert.equal(normalizeKycReference('passport', 'a-1234-567'), 'A1234567');
  assert.equal(normalizeKycDocumentType(' PAN '), 'pan');
});

test('kyc: every documented type has a spec, and unknown types are rejected', () => {
  assert.equal(KYC_DOCUMENT_TYPES.length, 5);
  for (const spec of KYC_DOCUMENT_TYPES) {
    assert.equal(kycDocumentSpec(spec.value)?.value, spec.value);
    // The documented example must satisfy the documented format.
    assert.ok(spec.pattern.test(spec.normalize(spec.placeholder)), `${spec.value} placeholder must match its own pattern`);
  }
  assert.equal(kycDocumentSpec('selfie'), null);
  assert.equal(kycDocumentSpec(''), null);
  assert.equal(kycDocumentSpec(undefined), null);
});

test('aadhaar: exactly 12 digits — 11 and 13 digits are refused by name', () => {
  const eleven = validatePartnerApplication({ ...VALID, kycDocumentReference: '12345678901' });
  assert.equal(eleven.ok, false);
  assert.equal(eleven.errors.kycDocumentReference, 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.');

  const thirteen = validatePartnerApplication({ ...VALID, kycDocumentReference: '1234567890123' });
  assert.equal(thirteen.errors.kycDocumentReference, 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.');

  // Dashes and spaces are formatting, not data.
  const formatted = validatePartnerApplication({ ...VALID, kycDocumentReference: '1234 5678 9012' });
  assert.equal(formatted.ok, true);
  assert.equal(formatted.values?.kycDocumentReference, '123456789012');
});

test('pan: the 5-4-1 format is enforced with specific copy', () => {
  const bad = validatePartnerApplication({
    ...VALID,
    kycDocumentType: 'pan',
    kycDocumentReference: 'PAN123456',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.kycDocumentReference, 'Invalid PAN. Enter it as ABCDE1234F.');

  const good = validatePartnerApplication({
    ...VALID,
    kycDocumentType: 'pan',
    kycDocumentReference: 'abcde1234f',
  });
  assert.equal(good.ok, true);
  assert.equal(good.values?.kycDocumentReference, 'ABCDE1234F');
});

// ---------------------------------------------------------------------------
// Full name sanitization
// ---------------------------------------------------------------------------

test('name: control characters and whitespace runs are collapsed, length is capped', () => {
  assert.equal(sanitizePersonName('  Asha   Sharma  '), 'Asha Sharma');
  assert.equal(sanitizePersonName('Asha\u0000Sharma'), 'Asha Sharma');
  assert.equal(sanitizePersonName('   '), '');
  assert.equal(sanitizePersonName('x'.repeat(500)).length, 120);
  // Unicode names survive intact.
  assert.equal(sanitizePersonName('आशा शर्मा'), 'आशा शर्मा');
});

// ---------------------------------------------------------------------------
// Whole-form validation
// ---------------------------------------------------------------------------

test('a valid application passes and returns sanitized values only', () => {
  const result = validatePartnerApplication({
    fullName: '  Asha   Sharma ',
    phone: '+91 98765 43210',
    kycDocumentType: ' AADHAAR ',
    kycDocumentReference: '1234-5678-9012',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.values, {
    fullName: 'Asha Sharma',
    phone: '9876543210',
    kycDocumentType: 'aadhaar',
    kycDocumentReference: '123456789012',
  });
  assert.equal(result.message, '');
});

test('an empty form reports every missing field at once, in field order', () => {
  const result = validatePartnerApplication({});
  assert.equal(result.ok, false);
  assert.equal(result.values, null, 'unvalidated input can never be sent');
  assert.equal(result.errors.fullName, PARTNER_APPLICATION_MESSAGES.nameRequired);
  assert.equal(result.errors.kycDocumentType, PARTNER_APPLICATION_MESSAGES.kycTypeRequired);
  assert.equal(result.errors.kycDocumentReference, PARTNER_APPLICATION_MESSAGES.kycReferenceRequired);
  assert.equal(result.errors.phone, undefined, 'the phone is optional');
  assert.equal(result.message, PARTNER_APPLICATION_MESSAGES.nameRequired);
});

test('phone is optional but must be a real number when supplied', () => {
  assert.equal(validatePartnerApplication({ ...VALID, phone: '' }).ok, true);
  assert.equal(validatePartnerApplication({ ...VALID, phone: '   ' }).ok, true);
  assert.equal(validatePartnerApplication({ ...VALID, phone: null }).ok, true);

  const bad = validatePartnerApplication({ ...VALID, phone: '91234' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.phone, PARTNER_APPLICATION_MESSAGES.phoneInvalid);
});

test('a one-character name is refused with the "as it appears on your KYC document" copy', () => {
  const result = validatePartnerApplication({ ...VALID, fullName: 'A' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.fullName, PARTNER_APPLICATION_MESSAGES.nameTooShort);
});

test('an unknown document type never produces a reference value to send', () => {
  const result = validatePartnerApplication({ ...VALID, kycDocumentType: 'selfie' });
  assert.equal(result.ok, false);
  assert.equal(result.values, null);
  assert.equal(result.errors.kycDocumentType, PARTNER_APPLICATION_MESSAGES.kycTypeRequired);
});

test('oversized input is refused or capped — it is never sent past a column limit', () => {
  // A 400-character "reference" is not a reference: refuse it with the
  // document's own copy instead of truncating it into something that passes.
  const tooLong = validatePartnerApplication({
    ...VALID,
    kycDocumentType: 'passport',
    kycDocumentReference: 'A1234567'.padEnd(400, '9'),
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.errors.kycDocumentReference, 'Invalid passport number. Use 6-20 letters or digits.');

  // Names have no format to break, so a long one is capped at the column width.
  const longName = validatePartnerApplication({ ...VALID, fullName: `A ${'x'.repeat(400)}` });
  assert.equal(longName.ok, true);
  assert.equal(longName.values?.fullName.length, 120);
});
