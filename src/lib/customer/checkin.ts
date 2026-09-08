// ============================================================================
// Check-in pass codes + visit-bonus rules (pure, no I/O)
// ----------------------------------------------------------------------------
// The customer's "salon pass" is a deterministic code derived from their auth
// id — no `user_qr_codes` table (the repo's architecture stores structured
// facts on existing rows; a derived code needs no row at all). The QR image a
// customer shows at reception simply encodes this code, and the salon types or
// pastes it into the dashboard to find that customer's visit.
//
// Codes are reversible on purpose: `passCodeFor(userId)` and
// `passCodeUserId(code)` are the only two functions needed, so no lookup
// index, no table scan and no enumeration are required to resolve a code the
// customer shows at the counter.
//
// The birthday rule is deliberately pure: a bonus is due when the month/day of
// the visit date equals the month/day of the customer's date_of_birth. Year is
// ignored, so a booking made for the customer's birthday in any year matches.
// ============================================================================

export const PASS_CODE_PREFIX = 'FANAL';
/** Round-trip marker inside the encoded payload (guards against junk input). */
const PASS_CODE_MARKER = 'uid:';

function encodeB64Url(utf8: string): string {
  const bytes = new TextEncoder().encode(utf8);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeB64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const b64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Strip formatting noise (spaces, a stray `FANAL`-prefix spelling) from a
 * user-typed code and return the canonical `FANAL-<…>` form. The payload is
 * case-sensitive base64url (uuids are lowercase hex), so only the prefix is
 * case-insensitively normalised — the body is preserved verbatim. Empty when
 * the value is not one of our codes at all.
 */
export function normalizePassCode(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\s+/g, '');
  if (!raw) return '';
  const prefix = /^fanal-?/i.exec(raw);
  if (!prefix) return '';
  const body = raw.slice(prefix[0].length);
  if (!body || !/^[A-Za-z0-9_-]+$/.test(body)) return '';
  return `${PASS_CODE_PREFIX}-${body}`;
}

/** Deterministic salon-pass code for a customer auth id, e.g. `FANAL-<…>`. */
export function passCodeFor(userId: string | null | undefined): string {
  const clean = String(userId ?? '').trim();
  if (!clean) return '';
  return `${PASS_CODE_PREFIX}-${encodeB64Url(`${PASS_CODE_MARKER}${clean}`)}`;
}

/** The auth id a pass code encodes, or null when the code is not one of ours. */
export function passCodeUserId(value: unknown): string | null {
  const code = normalizePassCode(value);
  if (!code) return null;
  const encoded = code.slice(PASS_CODE_PREFIX.length + 1);
  if (!encoded) return null;
  try {
    const decoded = decodeB64Url(encoded);
    return decoded.startsWith(PASS_CODE_MARKER) ? decoded.slice(PASS_CODE_MARKER.length) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Visit check-in rules
// ---------------------------------------------------------------------------

/** A booking the salon may check in: it is open and its slot is today. */
export const CHECKIN_OPEN_STATUSES = [
  'pending',
  'confirmed',
  'reschedule_proposed',
  'reschedule_requested',
] as const;

export function isCheckinOpenStatus(status: unknown): boolean {
  return (CHECKIN_OPEN_STATUSES as readonly string[]).includes(String(status ?? '').toLowerCase());
}

/**
 * Whether the booking is check-in eligible today. A booking is eligible only
 * on the day of its own slot — arriving a day early or checking in a stale
 * booking are both refused before any reward logic runs.
 */
export function checkinEligibility(
  booking: { status?: unknown; booking_date?: unknown } | null | undefined,
  todayIso: string
): { ok: boolean; reason?: string } {
  if (!booking || typeof booking !== 'object') return { ok: false, reason: 'booking_missing' };
  const status = String(booking.status ?? '').toLowerCase();
  if (!isCheckinOpenStatus(status)) {
    return {
      ok: false,
      reason: 'Booking is not open for check-in (status: ' + String(booking.status ?? 'unknown') + ').',
    };
  }
  if (String(booking.booking_date ?? '') !== todayIso) {
    return {
      ok: false,
      reason: 'This booking is not for today, so it cannot be checked in yet.',
    };
  }
  return { ok: true };
}

/** True when the booking is on the customer's birthday (month/day match). */
export function isBirthdayVisit(
  bookingDateIso: string | null | undefined,
  dateOfBirthIso: string | null | undefined
): boolean {
  const booking = String(bookingDateIso ?? '').trim();
  const dob = String(dateOfBirthIso ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking) || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  return booking.slice(5) === dob.slice(5);
}

export const DEFAULT_BIRTHDAY_BONUS_POINTS = 250;
export const DEFAULT_REFERRAL_BONUS_POINTS = 100;

/** Bonus amounts as configured by the salon, falling back to the defaults. */
export function bonusPointsFrom(config: {
  birthday_bonus_points?: unknown;
  referral_bonus_points?: unknown;
}): { birthdayBonusPoints: number; referralBonusPoints: number } {
  const birthday = Number(config?.birthday_bonus_points);
  const referral = Number(config?.referral_bonus_points);
  return {
    birthdayBonusPoints:
      Number.isFinite(birthday) && birthday >= 0 ? Math.round(birthday) : DEFAULT_BIRTHDAY_BONUS_POINTS,
    referralBonusPoints:
      Number.isFinite(referral) && referral >= 0 ? Math.round(referral) : DEFAULT_REFERRAL_BONUS_POINTS,
  };
}

export interface CheckInCredit {
  kind: 'birthday' | 'referral';
  points: number;
  /** Short human label for the success panel and the notification. */
  label: string;
}

/**
 * Decide which bonus credits a check-in earns. Pure on purpose: every input is
 * a fact the caller has already resolved (wallet exists, referrer known, this
 * booking not credited yet), so the rule can never disagree with its tests.
 */
export function planCheckInCredits(input: {
  config: { birthday_bonus_points?: unknown; referral_bonus_points?: unknown };
  isBirthdayVisit: boolean;
  birthdayNotYetCredited: boolean;
  hasReferralCode: boolean;
  referrerWalletResolved: boolean;
  referralNotYetCredited: boolean;
}): CheckInCredit[] {
  const { birthdayBonusPoints, referralBonusPoints } = bonusPointsFrom(input.config);
  const credits: CheckInCredit[] = [];
  if (input.isBirthdayVisit && input.birthdayNotYetCredited && birthdayBonusPoints > 0) {
    credits.push({ kind: 'birthday', points: birthdayBonusPoints, label: 'Birthday bonus' });
  }
  if (input.hasReferralCode && input.referrerWalletResolved && input.referralNotYetCredited && referralBonusPoints > 0) {
    credits.push({ kind: 'referral', points: referralBonusPoints, label: 'Referral bonus' });
  }
  return credits;
}
