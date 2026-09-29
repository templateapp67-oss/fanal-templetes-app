// ============================================================================
// Growth Partner application — client-side validation + sanitization.
//
// WHY THIS FILE EXISTS (the reported "Application failed. Please try again.")
// ---------------------------------------------------------------------------
// The application form used to send whatever the user typed straight to
// `submit_growth_partner_application` and then discarded the backend's answer:
// every failure — an invalid Aadhaar number, a duplicate application, an
// expired session, a missing migration, a dropped connection — came back as the
// same generic sentence. Nothing told the user what to fix, and malformed KYC
// data was stored happily because neither side checked the format.
//
// This module is the single source of truth for the FIELD rules. It is:
//   • pure (no imports, no network, no React) so it is unit-testable and can be
//     reused by the sign-up form and the signed-in "Become a Growth Partner"
//     form without either of them drifting,
//   • mirrored by the database (`normalize_partner_phone` /
//     `normalize_partner_kyc_reference` + the CHECKs in
//     20261030000000_partner_applications_hardening.sql), because client-side
//     validation is a UX affordance, never a security control — the server
//     re-validates every value.
//
// Sanitization rules (applied before validation, and before the RPC call):
//   • control characters are stripped, runs of whitespace are collapsed,
//   • values are trimmed and length-capped (120 / 30 / 160 characters),
//   • phone numbers are reduced to the 10 national digits (+91, 0091, 0 and
//     separators are all accepted and removed),
//   • KYC references are uppercased with separators removed, so
//     "1234-5678-9012" and "1234 5678 9012" are the same Aadhaar number.
// ============================================================================

/** The KYC document types the backend accepts (mirrors the DB CHECK). */
export type KycDocumentType =
  | 'pan'
  | 'aadhaar'
  | 'passport'
  | 'driving_license'
  | 'business_registration';

/** Maximum lengths enforced by the database columns. */
export const PARTNER_APPLICATION_NAME_MAX = 120;
export const PARTNER_APPLICATION_PHONE_MAX = 30;
export const PARTNER_APPLICATION_KYC_MAX = 160;

/** Indian mobile numbers are exactly 10 digits and start 6–9. */
export const PARTNER_PHONE_DIGITS = 10;

export interface KycDocumentSpec {
  value: KycDocumentType;
  label: string;
  /** Placeholder shown in the reference field. */
  placeholder: string;
  /** Help copy rendered with the field. */
  hint: string;
  /** Format the reference must match AFTER normalization. */
  pattern: RegExp;
  /** Exact error copy shown when the pattern does not match. */
  invalidMessage: string;
  /** How raw input is normalized before the pattern is applied. */
  normalize: (value: string) => string;
}

/** Spaces, dashes, dots, slashes and underscores are all separators, never data. */
const stripSeparators = (value: string): string => value.replace(/[\s\-_/.]/g, '');

const upperSeparators = (value: string): string => stripSeparators(value).toUpperCase();

export const KYC_DOCUMENT_TYPES: readonly KycDocumentSpec[] = [
  {
    value: 'pan',
    label: 'PAN',
    placeholder: 'ABCDE1234F',
    hint: '10 characters — 5 letters, 4 digits, 1 letter.',
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    invalidMessage: 'Invalid PAN. Enter it as ABCDE1234F.',
    normalize: upperSeparators,
  },
  {
    value: 'aadhaar',
    label: 'Aadhaar',
    placeholder: '1234 5678 9012',
    hint: 'Exactly 12 digits. Spaces and dashes are ignored.',
    pattern: /^[0-9]{12}$/,
    invalidMessage: 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.',
    normalize: stripSeparators,
  },
  {
    value: 'passport',
    label: 'Passport',
    placeholder: 'A1234567',
    hint: '6–20 letters or digits.',
    pattern: /^[A-Z0-9]{6,20}$/,
    invalidMessage: 'Invalid passport number. Use 6-20 letters or digits.',
    normalize: upperSeparators,
  },
  {
    value: 'driving_license',
    label: 'Driving licence',
    placeholder: 'RJ0520210001234',
    hint: '6–20 letters or digits.',
    pattern: /^[A-Z0-9]{6,20}$/,
    invalidMessage: 'Invalid driving licence number. Use 6-20 letters or digits.',
    normalize: upperSeparators,
  },
  {
    value: 'business_registration',
    label: 'Business registration',
    placeholder: 'UDYAMRJ0000000',
    hint: '6–20 letters or digits.',
    pattern: /^[A-Z0-9]{6,20}$/,
    invalidMessage: 'Invalid business registration number. Use 6-20 letters or digits.',
    normalize: upperSeparators,
  },
];

/**
 * The spec for a document type, or null when the value is not one the backend
 * accepts. Unknown values are never coerced into a default: the user is asked
 * to pick one instead.
 */
export function kycDocumentSpec(value: unknown): KycDocumentSpec | null {
  const wanted = String(value ?? '').trim().toLowerCase();
  return KYC_DOCUMENT_TYPES.find((spec) => spec.value === wanted) ?? null;
}

/** Type guard for the five accepted document types. */
export function isKycDocumentType(value: unknown): value is KycDocumentType {
  return kycDocumentSpec(value) !== null;
}

/** Trim + lowercase, so ' PAN ' and 'pan' are the same selection. */
export function normalizeKycDocumentType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Normalize a KYC reference for the selected document type: separators and
 * surrounding whitespace removed, letters uppercased. Unknown document types
 * are trimmed only — there is no format to apply yet.
 *
 * The value is NOT truncated here: an over-long reference is not a valid
 * reference, so it is reported (see `validatePartnerApplication`) instead of
 * being silently cut down to something that might pass the format check.
 */
export function normalizeKycReference(documentType: unknown, value: unknown): string {
  const raw = String(value ?? '');
  const spec = kycDocumentSpec(documentType);
  return spec ? spec.normalize(raw) : raw.trim();
}

/**
 * Collapse any Indian phone spelling to its 10 national digits.
 *
 *   '+91 98765 43210' → '9876543210'
 *   '0091-98765-43210' → '9876543210'
 *   '09876543210'      → '9876543210'
 *   '98765 43210'      → '9876543210'
 *
 * An empty/blank input stays empty (the phone field is optional). A value that
 * is not 10 digits after this is returned untouched so the caller can report
 * the exact problem instead of silently storing a truncated number.
 */
export function normalizePhone(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length > PARTNER_PHONE_DIGITS) {
    if (/^0091\d{10}$/.test(digits)) return digits.slice(4);
    if (/^91\d{10}$/.test(digits)) return digits.slice(2);
    if (/^0\d{10}$/.test(digits)) return digits.slice(1);
  }
  return digits.slice(0, PARTNER_APPLICATION_PHONE_MAX);
}

/** True for a 10-digit Indian mobile number (starts 6, 7, 8 or 9). */
export function isValidIndianMobile(value: unknown): boolean {
  return /^[6-9][0-9]{9}$/.test(normalizePhone(value));
}

/**
 * Strip control characters, collapse whitespace and cap the length. Names keep
 * their unicode letters — accents, Devanagari, etc. are valid — but a value
 * that is only invisible characters becomes empty.
 */
export function sanitizePersonName(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PARTNER_APPLICATION_NAME_MAX);
}

/** The application fields, in the order the form renders them. */
export const PARTNER_APPLICATION_FIELD_ORDER = [
  'fullName',
  'phone',
  'kycDocumentType',
  'kycDocumentReference',
] as const;

export type PartnerApplicationField = (typeof PARTNER_APPLICATION_FIELD_ORDER)[number];

export interface PartnerApplicationInput {
  fullName?: string | null;
  phone?: string | null;
  kycDocumentType?: string | null;
  kycDocumentReference?: string | null;
}

export interface PartnerApplicationFieldErrors {
  fullName?: string;
  phone?: string;
  kycDocumentType?: string;
  kycDocumentReference?: string;
}

/** Sanitized + validated values, ready to send to the RPC. */
export interface PartnerApplicationValues {
  fullName: string;
  /** 10 national digits, or null when the user left the field blank. */
  phone: string | null;
  kycDocumentType: KycDocumentType;
  kycDocumentReference: string;
}

export interface PartnerApplicationValidationResult {
  ok: boolean;
  errors: PartnerApplicationFieldErrors;
  /** Non-null only when `ok` is true — callers cannot send unvalidated input. */
  values: PartnerApplicationValues | null;
  /** The first error message, for the form-level alert. */
  message: string;
}

/** Exact, reviewed copy — the form-level alert echoes the field-level message. */
export const PARTNER_APPLICATION_MESSAGES = {
  nameRequired: 'Enter your full name.',
  nameTooShort: 'Enter your full name as it appears on your KYC document.',
  phoneInvalid: 'Enter a valid 10-digit mobile number.',
  kycTypeRequired: 'Select a KYC document type.',
  kycReferenceRequired: 'Enter your KYC reference number.',
} as const;

/**
 * Validate + sanitize one application submission.
 *
 * Every field is checked, so the user sees ALL the problems at once instead of
 * fixing them one submit at a time. `values` is null unless every field passed,
 * which makes it impossible to accidentally send unvalidated input.
 */
export function validatePartnerApplication(
  input: PartnerApplicationInput
): PartnerApplicationValidationResult {
  const errors: PartnerApplicationFieldErrors = {};

  // --- Full name -----------------------------------------------------------
  const fullName = sanitizePersonName(input.fullName);
  if (!fullName) {
    errors.fullName = PARTNER_APPLICATION_MESSAGES.nameRequired;
  } else if (fullName.length < 2) {
    errors.fullName = PARTNER_APPLICATION_MESSAGES.nameTooShort;
  }

  // --- Phone (optional, but must be a real number when supplied) ------------
  const rawPhone = String(input.phone ?? '').trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : '';
  if (rawPhone && !isValidIndianMobile(phone)) {
    errors.phone = PARTNER_APPLICATION_MESSAGES.phoneInvalid;
  }

  // --- KYC document type ---------------------------------------------------
  const spec = kycDocumentSpec(input.kycDocumentType);
  if (!spec) {
    errors.kycDocumentType = PARTNER_APPLICATION_MESSAGES.kycTypeRequired;
  }

  // --- KYC reference number ------------------------------------------------
  const kycDocumentReference = spec ? normalizeKycReference(spec.value, input.kycDocumentReference) : '';
  if (spec) {
    if (!kycDocumentReference) {
      errors.kycDocumentReference = PARTNER_APPLICATION_MESSAGES.kycReferenceRequired;
    } else if (
      kycDocumentReference.length > PARTNER_APPLICATION_KYC_MAX ||
      !spec.pattern.test(kycDocumentReference)
    ) {
      errors.kycDocumentReference = spec.invalidMessage;
    }
  } else if (!String(input.kycDocumentReference ?? '').trim()) {
    // No document type selected yet: still say the reference is missing when it
    // is, so the user is not told twice about the same empty form.
    errors.kycDocumentReference = PARTNER_APPLICATION_MESSAGES.kycReferenceRequired;
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    values: ok && spec
      ? {
          fullName,
          phone: phone || null,
          kycDocumentType: spec.value,
          kycDocumentReference,
        }
      : null,
    message: firstMessage(errors),
  };
}

/** The first error message, in the order the form renders the fields. */
export function firstMessage(errors: PartnerApplicationFieldErrors): string {
  for (const field of PARTNER_APPLICATION_FIELD_ORDER) {
    const message = errors[field];
    if (message) return message;
  }
  return '';
}
