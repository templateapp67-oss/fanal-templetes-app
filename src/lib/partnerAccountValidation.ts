import { z } from 'zod';

// ============================================================================
// Partner account settings VALIDATION (Zod).
//
// One source of truth for every rule the account/profile forms enforce, shared
// by the Contact, Payout, Notifications, Change Email and Password sections.
// The database re-validates the same shapes in SQL
// (20260919130000_partner_account_security_settings.sql) — these schemas are
// the fast, friendly first gate; SQL remains the actual gate.
// ============================================================================

/** Trim + treat whitespace-only as empty (optional string → `''`). */
const optionalText = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length <= 500, 'Too long');

const phoneText = z
  .string()
  .transform((value) => value.replace(/[\s().-]/g, ''))
  .refine((value) => value === '' || /^\+?[0-9]{7,15}$/.test(value), 'Enter a phone number with 7–15 digits.');

/** A bare http(s) URL — social/network fields auto-prepend https:// if protocol is omitted. */
const httpUrl = z
  .string()
  .transform((value) => {
    let clean = value.trim();
    if (!clean) return '';
    if (clean.startsWith('@')) clean = clean.slice(1);
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
    }
    return clean;
  })
  .refine(
    (value) => value === '' || (/^https?:\/\/[^\s]+$/i.test(value) && value.length <= 300),
    'Enter a valid website or social profile URL (e.g. https://instagram.com/yourhandle).'
  );

// ---------------------------------------------------------------------------
// Tab 1 — Contact & personal info
// ---------------------------------------------------------------------------

export const socialLinksSchema = z.object({
  instagram: httpUrl.default(''),
  linkedin: httpUrl.default(''),
  facebook: httpUrl.default(''),
  twitter: httpUrl.default(''),
});
export type SocialLinks = z.infer<typeof socialLinksSchema>;

export const contactProfileSchema = z.object({
  fullName: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1 && value.length <= 120, 'Enter a full name of 1–120 characters.')
    .refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'The name contains invalid characters.'),
  phone: phoneText,
  agencyName: z.string().transform((v) => v.trim()).refine((v) => v.length <= 120, 'Keep the brand name under 120 characters.'),
  whatsappPhone: phoneText,
  city: z.string().transform((v) => v.trim()).refine((v) => v.length <= 80, 'Keep the city under 80 characters.'),
  state: z.string().transform((v) => v.trim()).refine((v) => v.length <= 80, 'Keep the state under 80 characters.'),
  fullAddress: z.string().transform((v) => v.trim()).refine((v) => v.length <= 240, 'Keep the address under 240 characters.'),
  alternatePhone: phoneText,
  websiteUrl: httpUrl.refine((v) => v.length <= 200, 'Keep the website link under 200 characters.'),
  publicBio: z.string().transform((v) => v.trim()).refine((v) => v.length <= 500, 'Keep the bio under 500 characters.'),
  socialLinks: socialLinksSchema,
});

// ---------------------------------------------------------------------------
// Tab 2 — Payout & bank accounts
// ---------------------------------------------------------------------------

/** RBI IFSC: 4-letter bank code, a zero, then 6 alphanumeric characters. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** SWIFT/BIC: 8 or 11 characters. */
export const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
/** UPI VPA: name@bank. */
export const UPI_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

export const payoutSchema = z
  .object({
    payoutMethod: z.enum(['', 'upi', 'bank_transfer', 'paypal']),
    accountName: z.string().transform((v) => v.trim()).refine((v) => v.length <= 120, 'Keep the account holder name under 120 characters.'),
    bankName: z.string().transform((v) => v.trim()).refine((v) => v.length <= 120, 'Keep the bank name under 120 characters.'),
    bankBranch: z.string().transform((v) => v.trim()).refine((v) => v.length <= 120, 'Keep the branch under 120 characters.'),
    accountNumber: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .refine((v) => v === '' || /^[0-9]{6,24}$/.test(v), 'Account number must be 6–24 digits.'),
    confirmAccountNumber: z.string().transform((v) => v.replace(/\s/g, '')),
    ifsc: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => v === '' || IFSC_RE.test(v), 'Enter a valid IFSC code (e.g. HDFC0001234).'),
    swift: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => v === '' || SWIFT_RE.test(v), 'Enter a valid SWIFT/BIC code (8 or 11 characters).'),
    upiId: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v === '' || UPI_RE.test(v), 'Enter a valid UPI ID (e.g. name@bank).'),
    panNumber: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => v === '' || PAN_RE.test(v), 'Enter a valid PAN (e.g. ABCDE1234F).'),
  })
  .superRefine((data, ctx) => {
    if (data.accountNumber && data.confirmAccountNumber !== data.accountNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmAccountNumber'], message: 'Account numbers do not match.' });
    }
    if (data.payoutMethod === 'bank_transfer') {
      if (!data.accountName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accountName'], message: 'Account holder name is required for bank transfers.' });
      if (!data.accountNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accountNumber'], message: 'Account number is required for bank transfers.' });
      if (!data.ifsc) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ifsc'], message: 'IFSC code is required for bank transfers.' });
    }
    if (data.payoutMethod === 'upi' && !data.upiId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['upiId'], message: 'UPI ID is required for UPI payouts.' });
    }
  });

// ---------------------------------------------------------------------------
// Tab 3 — Notification & preferences
// ---------------------------------------------------------------------------

export const notificationPreferencesSchema = z.object({
  notifyEmail: z.boolean(),
  notifyWhatsapp: z.boolean(),
  notifySms: z.boolean(),
});

// ---------------------------------------------------------------------------
// Account Settings — change email / password / TOTP
// ---------------------------------------------------------------------------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const changeEmailSchema = z
  .object({
    currentEmail: z.string().transform(normalizeEmail).refine((v) => EMAIL_RE.test(v), 'Enter your current email address.'),
    newEmail: z.string().transform(normalizeEmail).refine((v) => EMAIL_RE.test(v) && v.length <= 254, 'Enter a valid new email address.'),
    confirmEmail: z.string().transform(normalizeEmail),
  })
  .superRefine((data, ctx) => {
    if (data.newEmail && data.newEmail === data.currentEmail) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newEmail'], message: 'The new email is the same as your current email.' });
    }
    if (data.confirmEmail && data.confirmEmail !== data.newEmail) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmEmail'], message: 'The email addresses do not match.' });
    }
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters.')
      .max(72, 'New password must be at most 72 characters.')
      .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Use at least one letter and one number.'),
    confirmPassword: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.confirmPassword && data.confirmPassword !== data.newPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match.' });
    }
    if (data.currentPassword && data.newPassword && data.currentPassword === data.newPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newPassword'], message: 'The new password must be different from the current one.' });
    }
  });

/** The 6-digit TOTP code an authenticator app shows. */
export const totpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .refine((v) => /^[0-9]{6}$/.test(v), 'Enter the 6-digit code from your authenticator app.');

// ---------------------------------------------------------------------------
// Photo upload (before compression)
// ---------------------------------------------------------------------------

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validatePhotoFile(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Choose a JPG, PNG or WebP image.';
  if (file.size > PHOTO_MAX_BYTES) return 'Image must be 5 MB or smaller.';
  return null;
}

// ---------------------------------------------------------------------------
// Error shaping — zod issues → the first human message per field, so the UI
// can render one error under an input and a summary at the form level.
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Thrown by parseFields when a schema refuses its input. Carries the per-field
 * messages so forms can highlight inputs, and its own message doubles as the
 * first error for banners/toasts. (A returned `{ ok, errors }` union would not
 * discriminate under this project's non-strict tsconfig, which widens the
 * boolean literals — a typed throw keeps call sites narrow and simple.)
 */
export class PartnerValidationError extends Error {
  readonly fieldErrors: FieldErrors;
  constructor(fieldErrors: FieldErrors) {
    super(fieldErrors._ || Object.values(fieldErrors)[0] || 'Check the highlighted fields.');
    this.name = 'PartnerValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** Run a schema or throw PartnerValidationError with per-field messages. */
export function parseFields<Schema extends z.ZodTypeAny>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw new PartnerValidationError(zodFieldErrors(result.error));
  return result.data;
}
