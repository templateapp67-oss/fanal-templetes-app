import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarX, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import type { CustomerBooking } from '../lib/customer/types';
import { cancelMyBooking, getMyBooking, normalizeCustomerErrorMessage } from '../lib/customer/api';
import { canCancelBooking } from '../lib/bookingTabs';
import {
  CANCELLATION_CUTOFF_HOURS,
  REFUND_PERCENT_AFTER_CUTOFF,
  REFUND_PERCENT_BEFORE_CUTOFF,
  computeCancellationRefund,
  formatCountdown,
} from '../lib/cancellationPolicy';
import { clockLabel, dayLabel, money } from '../customer/ui';

export interface CancellationPolicyModalProps {
  open: boolean;
  bookingId: string;
  onClose: () => void;
  onKeepBooking?: () => void;
  onCancelled?: (booking: CustomerBooking | null, notice: string) => void;
  accentHex?: string;
  /** Data-layer override for tests and stories. */
  api?: CancellationPolicyApi;
}

export interface CancellationPolicyApi {
  getBooking: typeof getMyBooking;
  cancelBooking: typeof cancelMyBooking;
}

const LIVE_API: CancellationPolicyApi = { getBooking: getMyBooking, cancelBooking: cancelMyBooking };
const TICK_MS = 30_000;
const formatCutoff = (ms: number) => new Date(ms).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

export const CancellationPolicyModal: React.FC<CancellationPolicyModalProps> = ({
  open, bookingId, onClose, onKeepBooking, onCancelled, accentHex = '#C20E5A', api = LIVE_API,
}) => {
  const { getBooking, cancelBooking } = api;
  const [booking, setBooking] = useState<CustomerBooking | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open || !bookingId) return;
    let ignore = false;
    setLoading(true); setLoadError(''); setSubmitError(''); setBooking(null); setReason('');
    void (async () => {
      try {
        const result = await getBooking(bookingId);
        if (ignore) return;
        setLoading(false);
        if (!result.ok) { setLoadError(normalizeCustomerErrorMessage(result)); return; }
        if (!result.data) { setLoadError('We could not find that booking on your account.'); return; }
        setBooking(result.data);
        setNowMs(Date.now());
      } catch (error) {
        if (!ignore) {
          setLoading(false);
          setLoadError(error instanceof Error ? error.message : 'That booking could not be loaded. Please try again.');
        }
      }
    })();
    return () => { ignore = true; };
  }, [open, bookingId, reloadKey, getBooking]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  const dismiss = useCallback(() => { if (!busyRef.current) onClose(); }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    keepRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); dismiss(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])');
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open, dismiss]);

  if (!open) return null;
  const currency = booking?.currency || '₹';
  const decision = booking
    ? canCancelBooking({ status: booking.status, date: booking.date, time: booking.time, nowMs })
    : { allowed: false, reason: '' };
  const refund = booking ? computeCancellationRefund({
    date: booking.date, time: booking.time, paidAmount: booking.advancePaid, nowMs,
  }) : null;

  async function handleCancel() {
    if (!booking || !refund || busy || !decision.allowed) return;
    setBusy(true); setSubmitError('');
    try {
      const result = await cancelBooking(booking.id, reason.trim() || undefined);
      if (!result.ok) { setSubmitError(normalizeCustomerErrorMessage(result)); return; }
      const notice = refund.refundAmount > 0
        ? `Your booking was cancelled. You are eligible for a refund of ${money(refund.refundAmount, currency)} (${refund.percent}% of ${money(refund.paidAmount, currency)} paid). The salon/payment provider must process the refund separately.`
        : 'Your booking was cancelled and the slot is free again. No refund applies to this cancellation.';
      onCancelled?.(result.data || null, notice);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Your booking could not be cancelled. Please try again.');
    } finally { setBusy(false); }
  }

  const earlyActive = refund?.tier === 'early';
  const lateActive = refund?.tier === 'late';
  const ruleClass = (active: boolean) => `flex items-start gap-3 rounded-2xl border p-3 ${active ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-slate-200 bg-white opacity-80'}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cancellation-policy-title" className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 id="cancellation-policy-title" className="text-lg font-bold text-slate-900">Cancel this booking?</h2>
            <p className="text-sm text-slate-600 mt-0.5">Review your refund eligibility before confirming.</p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Close" className="min-h-[44px] min-w-[44px] -mt-2 -mr-2 inline-flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          {loading && <div className="flex items-center gap-2 py-8 justify-center text-sm text-slate-600" role="status"><Loader2 className="w-4 h-4 animate-spin" /> Loading your booking…</div>}
          {loadError && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 space-y-2" role="alert"><p className="text-sm font-semibold text-rose-700">{loadError}</p><button type="button" onClick={() => setReloadKey(key => key + 1)} className="min-h-[44px] px-3 rounded-xl text-sm font-bold text-rose-700 border border-rose-200 bg-white">Try again</button></div>}
          {booking && refund && <>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-sm font-bold text-slate-900">{booking.serviceName || 'Appointment'}</p>
              <p className="text-xs text-slate-600 mt-0.5">{booking.salonName} · {dayLabel(booking.date)} at {clockLabel(booking.time)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Refund rules</p>
              <div className={ruleClass(earlyActive)} data-rule="early" data-active={earlyActive}>
                <CheckCircle2 className="w-5 h-5 mt-0.5 text-emerald-600 shrink-0" /><div className="flex-1"><p className="text-sm font-bold text-slate-900">{REFUND_PERCENT_BEFORE_CUTOFF}% refund eligibility</p><p className="text-xs text-slate-600">Cancel {CANCELLATION_CUTOFF_HOURS} hours or more before the appointment.</p></div>{earlyActive && <span className="text-[11px] font-bold text-slate-900">Applies now</span>}
              </div>
              <div className={ruleClass(lateActive)} data-rule="late" data-active={lateActive}>
                <AlertTriangle className="w-5 h-5 mt-0.5 text-rose-600 shrink-0" /><div className="flex-1"><p className="text-sm font-bold text-slate-900">{REFUND_PERCENT_AFTER_CUTOFF}% refund eligibility</p><p className="text-xs text-slate-600">Cancel within {CANCELLATION_CUTOFF_HOURS} hours of the appointment.</p></div>{lateActive && <span className="text-[11px] font-bold text-slate-900">Applies now</span>}
              </div>
            </div>
            {refund.tier === 'early' && refund.cutoffMs !== null && refund.msUntilCutoff !== null && <p className="flex items-center gap-1.5 text-xs text-slate-600"><Clock className="w-3.5 h-3.5" />The 80% window closes {formatCutoff(refund.cutoffMs)} (in {formatCountdown(refund.msUntilCutoff)}).</p>}
            {refund.tier === 'unknown' && <p className="text-xs text-amber-700">We could not read this appointment&apos;s time, so the salon will confirm any refund.</p>}
            <dl className="rounded-2xl border border-slate-200 divide-y divide-slate-100 text-sm">
              <div className="flex justify-between p-3"><dt className="text-slate-600">Amount paid</dt><dd className="font-semibold text-slate-900">{money(refund.paidAmount, currency)}</dd></div>
              <div className="flex justify-between p-3"><dt className="text-slate-600">Estimated refund eligibility ({refund.percent}%)</dt><dd className="font-bold text-emerald-700" data-testid="refund-amount">{money(refund.refundAmount, currency)}</dd></div>
              <div className="flex justify-between p-3"><dt className="text-slate-600">Amount not eligible for refund</dt><dd className="font-semibold text-slate-900">{money(refund.retainedAmount, currency)}</dd></div>
            </dl>
            {refund.paidAmount === 0 && <p className="text-xs text-slate-600">No advance has been paid on this booking, so there is nothing to refund.</p>}
            {refund.refundAmount > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">This cancellation records the booking cancellation only. Refunds are not issued automatically here; the salon/payment provider must process any eligible refund.</p>}
            {decision.allowed ? <label className="block"><span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Reason (optional)</span><textarea value={reason} onChange={event => setReason(event.target.value.slice(0, 300))} rows={2} maxLength={300} disabled={busy} placeholder="Change of plans, timing, budget…" className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" /></label> : <p className="text-sm font-semibold text-rose-700" role="alert">{decision.reason || 'This booking can no longer be cancelled here.'}</p>}
          </>}
          {submitError && <p className="text-xs font-semibold text-rose-600" role="alert">{submitError}</p>}
          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <button ref={keepRef} type="button" disabled={busy} onClick={() => { onKeepBooking?.(); onClose(); }} style={{ backgroundColor: accentHex }} className="flex-1 inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50">Keep Booking</button>
            <button type="button" onClick={() => void handleCancel()} disabled={!booking || !decision.allowed || busy} className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarX className="w-4 h-4" />}{busy ? 'Cancelling…' : 'Cancel & Refund'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancellationPolicyModal;
