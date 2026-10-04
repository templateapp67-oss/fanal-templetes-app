import React from 'react';
import { computeAdvanceDeposit, REQUIRED_ADVANCE_PERCENT } from '../lib/advanceDeposit';

/** Presentation only: never adjusts the server-authoritative checkout total. */
export function BookingPriceBreakdown({ total }: { total: number }) {
  const advance = computeAdvanceDeposit(total).rupees;
  const money = (value: number) => `₹${value.toLocaleString('en-IN')}`;
  return <div className="text-xs space-y-2" aria-label="Booking price breakdown">
    <dl className="space-y-1.5">
      {[
        ['Subtotal', money(total)],
        ['Discount', money(0)],
        ['Platform fee', 'No separate charge'],
        ['Tax', 'No separate charge in this checkout'],
        ['Total', money(total)],
        [`Advance (${REQUIRED_ADVANCE_PERCENT}%)`, money(advance)],
        ['Remaining at salon', money(Math.max(0, total - advance))],
      ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-semibold text-right">{value}</dd></div>)}
    </dl>
    <label className="block">Coupon<input disabled aria-label="Coupon" placeholder="Coupons are not enabled in this checkout" className="block w-full min-h-11 border border-slate-200 rounded-xl px-3 mt-1 disabled:opacity-70" /></label>
    <p className="text-slate-500">Cancellation does not automatically issue a refund. Contact the salon to confirm its cancellation policy and refund eligibility before paying.</p>
  </div>;
}
