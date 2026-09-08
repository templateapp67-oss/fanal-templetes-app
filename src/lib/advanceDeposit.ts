// ============================================================================
// Advance-deposit arithmetic shared by the browser (BookingModal) and the
// server (server/razorpay.ts).
//
// The checkout charges a percentage of the service total up front. Both sides
// MUST agree on the rounding, otherwise the amount the customer sees on the
// button differs from the amount Razorpay is asked to charge. Keeping the
// function in one place is what guarantees that.
//
//   computeAdvanceDeposit(348)          → { rupees: 87, paise: 8700, percent: 25 }
//   computeAdvanceDeposit(1187.5, 25)   → { rupees: 297, paise: 29700, percent: 25 }
//
// Razorpay wants integer paise (₹1 = 100 paise); the advance is rounded to a
// whole rupee first so the customer never sees ₹86.75 on a button.
// ============================================================================

export const DEFAULT_DEPOSIT_PERCENT = 25;

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
 */
export function computeAdvanceDeposit(
  totalAmount: number,
  percent: number = DEFAULT_DEPOSIT_PERCENT
): AdvanceDeposit {
  const total = Number(totalAmount);
  const pct = Number(percent);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pct) || pct <= 0) {
    return { rupees: 0, paise: 0, percent: Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_DEPOSIT_PERCENT };
  }
  const rupees = Math.round((total * pct) / 100);
  return { rupees, paise: rupees * 100, percent: pct };
}
