// ============================================================================
// Advance-deposit contract shared by the browser (BookingModal, the editor's
// save payloads) and the server (server/razorpay.ts, server/websiteSave.ts,
// server/customerRoutes.ts).
//
// THE PRODUCT RULE
//   Nexora SalonOS charges a FIXED 25% advance on every online booking. It is
//   not an owner-tunable percentage. The database says so too:
//   `public.salon_booking_settings` carries the check constraint
//   `salon_booking_settings_deposit_25_check`, and the normalizer installed by
//   supabase/migrations/20261103000000_salon_booking_settings_advance_25.sql
//   (`public.nexora_normalize_booking_settings()`) rewrites any other value to
//   25 before the row is written.
//
// THE BUG THIS MODULE EXISTS TO PREVENT
//   Every writer used to pick its own default — 20 in the demo fixtures and in
//   five read-side mappers, `Number(undefined)` (NaN) in the API fallback, 0 or
//   null when a field was simply absent. Those values round-tripped: a read
//   default of 20 landed in editor state, the next save wrote 20 back, and
//   Postgres answered
//
//       23514  new row for relation "salon_booking_settings" violates check
//              constraint "salon_booking_settings_deposit_25_check"
//
//   Because the save is one transaction, that single rejection took signup,
//   profile setup, template selection AND the services save down with it.
//   There is therefore exactly ONE number in this file, and every producer and
//   consumer of an advance percentage goes through these helpers.
//
// The checkout arithmetic is here for the same reason: both sides MUST agree on
// the rounding, otherwise the amount the customer sees on the button differs
// from the amount Razorpay is asked to charge.
//
//   computeAdvanceDeposit(348)          → { rupees: 87,  paise: 8700,  percent: 25 }
//   computeAdvanceDeposit(1187.5)       → { rupees: 297, paise: 29700, percent: 25 }
//
// Razorpay wants integer paise (₹1 = 100 paise); the advance is rounded to a
// whole rupee first so the customer never sees ₹86.75 on a button.
// ============================================================================

/**
 * The one advance percentage the product (and the database) allows.
 *
 * Kept under two names on purpose: `REQUIRED_ADVANCE_PERCENT` is the contract,
 * `DEFAULT_DEPOSIT_PERCENT` is the older name still used by the checkout code
 * and by migrations' documentation. They are the same number and must stay
 * that way — a second, different default is exactly what caused 23514.
 */
export const REQUIRED_ADVANCE_PERCENT = 25;

/** @deprecated alias of {@link REQUIRED_ADVANCE_PERCENT}; the advance is fixed, not defaulted. */
export const DEFAULT_DEPOSIT_PERCENT = REQUIRED_ADVANCE_PERCENT;

/**
 * Every column name any version of `public.salon_booking_settings` has used for
 * the advance percentage. Writers emit all of them so the row satisfies
 * whichever subset the live project actually has — but always with the same
 * value, 25.
 */
export const ADVANCE_PERCENT_COLUMNS = [
  'deposit_percent',
  'deposit_percentage',
  'deposit_25',
] as const;

/**
 * Coerce anything an app state, a cached draft or a legacy row holds into the
 * one advance percentage the database accepts.
 *
 * This is deliberately NOT "clamp to 0–100": the check constraint pins the
 * value to exactly 25, so a clamped 20 is still a rejected row. 0, null,
 * undefined, '', NaN, '25%', 20 and 999 all come back as 25.
 */
export function normalizeDepositPercentage(value: unknown): number {
  const parsed = parseAdvancePercent(value);
  if (parsed !== null && parsed !== REQUIRED_ADVANCE_PERCENT) {
    // Safe diagnostic: the value only, never the row, never a token.
    console.info(
      `[advanceDeposit] Advance payment is fixed at ${REQUIRED_ADVANCE_PERCENT}% — ` +
        `coerced ${JSON.stringify(parsed)} to ${REQUIRED_ADVANCE_PERCENT} before saving.`
    );
  }
  return REQUIRED_ADVANCE_PERCENT;
}

/** The numeric value a caller meant, or null when nothing usable was supplied. */
export function parseAdvancePercent(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return null;
  const n = typeof raw === 'string' && raw.endsWith('%')
    ? Number(raw.slice(0, -1))
    : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * True when the supplied value already IS the required advance — used by tests
 * and by the save diagnostics to report "nothing had to be coerced".
 */
export function isRequiredAdvancePercent(value: unknown): boolean {
  return parseAdvancePercent(value) === REQUIRED_ADVANCE_PERCENT;
}

/** The shape every `salon_booking_settings` writer sends. */
export interface BookingSettingsPayload {
  require_deposit: boolean;
  deposit_percent: number;
  deposit_percentage: number;
  deposit_25: number;
  /**
   * Unspecified means "accept online bookings" (the product default, and the
   * `salons.accepts_online_bookings` column default). An owner who explicitly
   * switched bookings off keeps `false` — this never upgrades it.
   */
  accept_online_bookings: boolean;
}

/** Something that may carry the two owner-facing booking switches. */
export interface BookingSettingsSource {
  requireDeposit?: unknown;
  require_deposit?: unknown;
  depositPercentage?: unknown;
  deposit_percentage?: unknown;
  deposit_percent?: unknown;
  deposit_25?: unknown;
  acceptsOnlineBookings?: unknown;
  accept_online_bookings?: unknown;
  accepts_online_bookings?: unknown;
}

function readFlag(
  source: BookingSettingsSource | null | undefined,
  keys: readonly (keyof BookingSettingsSource)[],
  fallback: boolean
): boolean {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      if (text === 'true') return true;
      if (text === 'false') return false;
    }
  }
  return fallback;
}

/**
 * THE ONLY place a `salon_booking_settings` payload is built.
 *
 * Signup, profile setup, template selection, the services save and the website
 * editor all funnel through the two writers below, and both call this — so a
 * future change to the advance contract is one edit, not five.
 *
 * `require_deposit` is the owner's switch (a salon may still take payment at
 * the counter); the PERCENTAGE is not theirs to change.
 */
export function buildBookingSettingsPayload(
  profile?: BookingSettingsSource | null,
  explicit?: BookingSettingsSource | null
): BookingSettingsPayload {
  // An explicit settings object wins for the require/accept switches, but the
  // percentage is never taken from a caller: it is always the required 25.
  const requireDeposit = readFlag(explicit ?? profile, ['require_deposit', 'requireDeposit'], true);
  const acceptsOnline = readFlag(
    explicit ?? profile,
    ['accept_online_bookings', 'accepts_online_bookings', 'acceptsOnlineBookings'],
    true
  );
  return {
    require_deposit: requireDeposit,
    deposit_percent: REQUIRED_ADVANCE_PERCENT,
    deposit_percentage: REQUIRED_ADVANCE_PERCENT,
    deposit_25: REQUIRED_ADVANCE_PERCENT,
    accept_online_bookings: acceptsOnline,
  };
}

/**
 * Read side: map a stored/legacy percentage onto the contract. A row written
 * before the fix can hold 20 or null; the customer must be quoted the same 25%
 * the database now enforces, never a stale number.
 */
export function readAdvancePercent(row: { deposit_percentage?: unknown; deposit_percent?: unknown; deposit_25?: unknown } | null | undefined): number {
  void row;
  return REQUIRED_ADVANCE_PERCENT;
}

export interface AdvanceDeposit {
  /** Whole rupees the customer pays now. */
  rupees: number;
  /** The same amount in integer paise — the unit Razorpay's orders API expects. */
  paise: number;
  /** Percentage of the total that was applied. */
  percent: number;
}

/** ₹ (possibly fractional) → integer paise. */
export function rupeesToPaise(amountInRupees: number): number {
  return Math.round(Number(amountInRupees) * 100);
}

/**
 * Work out the advance for a service total. Non-finite / negative totals yield
 * a zero deposit rather than NaN so a broken price never produces a broken
 * order request.
 *
 * Deliberately PURE ARITHMETIC: it does not normalise `percent`. The 25%
 * contract is enforced at the boundaries — the payload builders and the row
 * readers above — so every Nexora booking flow reaches this function already
 * carrying 25, while the arithmetic itself stays unit-testable for any
 * percentage (the checkout endpoint still validates an explicitly supplied
 * 1–100 for its legacy contract).
 */
export function computeAdvanceDeposit(
  totalAmount: number,
  percent: number = REQUIRED_ADVANCE_PERCENT
): AdvanceDeposit {
  const total = Number(totalAmount);
  const pct = Number(percent);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pct) || pct <= 0) {
    return { rupees: 0, paise: 0, percent: Number.isFinite(pct) && pct > 0 ? pct : REQUIRED_ADVANCE_PERCENT };
  }
  const rupees = Math.round((total * pct) / 100);
  return { rupees, paise: rupees * 100, percent: pct };
}
