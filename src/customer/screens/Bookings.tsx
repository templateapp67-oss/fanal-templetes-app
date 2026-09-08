// ============================================================================
// Booking history: the customer's own `bookings` rows, bucketed into the same
// three tabs the salon-side app uses (src/lib/bookingTabs.ts), plus the four
// actions a customer is allowed to take on their own row: cancel, propose a
// new time, leave a review, and pay the deposit.
//
// Every card also shows the service lines stored on the booking
// (`metadata.services` → the logical `booking_services` entity) and the stored
// id, so a customer can compare what the screen says with what the database
// kept. There is no "pending confirmation" text here that the row does not
// actually carry.
// ============================================================================

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Clock,
  IndianRupee,
  RefreshCw,
  Star,
  Ticket,
  X,
} from 'lucide-react';
import type { CustomerBooking } from '../../lib/customer/types';
import {
  cancelMyBooking,
  fetchSlotWindow,
  listMyBookings,
  normalizeCustomerErrorMessage,
  payBookingAdvance,
  proposeMyBookingReschedule,
  reviewMyBooking,
} from '../../lib/customer/api';
import {
  BOOKING_TABS,
  MAX_REVIEW_LENGTH,
  type BookingTabId,
  canCancelBooking,
  canReview,
  tabForStatus,
  validateReview,
} from '../../lib/bookingTabs';
import { payAdvanceWithRazorpay } from '../../lib/razorpayCheckout';
import {
  Button,
  CARD_CLASS,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  MUTED_CLASS,
  SectionTitle,
  SourceChip,
  LoadingRows,
  clockLabel,
  dayLabel,
  money,
  useCustomerQuery,
  useCustomerRealtime,
} from '../ui';
import { DatePicker } from './Book';

export interface BookingsProps {
  userId?: string | null;
  email?: string | null;
  accentHex?: string;
  refreshToken?: number;
  /** `?open=<id>` from a notification — that card starts expanded. */
  openBookingId?: string;
  onOpenSalon?: (salonId: string) => void;
  onRequireAuth?: () => void;
}

export const BookingsScreen: React.FC<BookingsProps> = ({
  userId,
  email,
  accentHex = '#C20E5A',
  refreshToken = 0,
  openBookingId = '',
  onOpenSalon,
  onRequireAuth,
}) => {
  const [tab, setTab] = useState<BookingTabId>('upcoming');
  const [openId, setOpenId] = useState(openBookingId);
  const [flash, setFlash] = useState('');
  const state = useCustomerQuery(() => listMyBookings({}), [userId, refreshToken]);
  const realtime = useCustomerRealtime(['bookings', 'notifications'], email, () => state.reload());

  const bookings = state.data || [];
  const buckets = useMemo(() => {
    const counts: Record<string, number> = { upcoming: 0, completed: 0, cancelled: 0 };
    for (const booking of bookings) {
      const id = tabForStatus(booking.status);
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [bookings]);

  const visible = useMemo(
    () => bookings.filter((booking) => tabForStatus(booking.status) === tab),
    [bookings, tab]
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title="My bookings"
        subtitle="Read from your own rows in the `bookings` table through the app API — the salon's dashboard is looking at the same rows."
        action={
          <Chip
            tone="neutral"
            title={
              realtime.transport === 'supabase-realtime'
                ? 'Status changes arrive over Supabase Realtime'
                : 'Status changes arrive by adaptive polling (Realtime is not available for private rows)'
            }
          >
            <RefreshCw className="w-3 h-3" />
            {realtime.transport === 'supabase-realtime' ? 'live updates' : 'polling'}
          </Chip>
        }
      />

      {!state.loading && !state.failed && !bookings.length ? (
        <EmptyState
          icon={<CalendarDays className="w-6 h-6 text-slate-400" />}
          title="You have no bookings yet"
          body="This is not a loading problem: the API returned zero rows for your account. Book an appointment and it appears here immediately."
        />
      ) : (
        <>
          <div className="flex gap-2" role="tablist">
            {BOOKING_TABS.map((descriptor) => {
              const active = descriptor.id === tab;
              return (
                <button
                  key={descriptor.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(descriptor.id)}
                  className={`flex-1 rounded-2xl border px-3 py-2 text-left transition ${
                    active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                  style={active ? { backgroundColor: accentHex } : undefined}
                >
                  <span className="block text-xs font-bold uppercase tracking-wide opacity-80">{descriptor.label}</span>
                  <span className="block text-lg font-extrabold">{buckets[descriptor.id] || 0}</span>
                </button>
              );
            })}
          </div>

          {flash ? (
            <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start justify-between gap-2">
              <span>{flash}</span>
              <button type="button" onClick={() => setFlash('')} aria-label="Dismiss" className="shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs ${MUTED_CLASS}`}>
              {state.loading ? 'Loading your bookings…' : `${visible.length} in this tab · ${bookings.length} total on your account`}
            </p>
            <button type="button" onClick={state.reload} className="text-xs font-bold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {state.loading ? <LoadingRows rows={3} label="Loading your bookings from Supabase…" /> : null}
          {state.failed ? <ErrorState message={state.error} onRetry={state.reload} hint="Nothing was changed — this is a read failure." /> : null}
          {!state.loading && !state.failed && !visible.length && bookings.length ? (
            <EmptyState
              icon={<CalendarClock className="w-6 h-6 text-slate-400" />}
              title={BOOKING_TABS.find((descriptor) => descriptor.id === tab)?.emptyTitle || 'Nothing here'}
              body={BOOKING_TABS.find((descriptor) => descriptor.id === tab)?.emptyBody || ''}
            />
          ) : null}

          <div className="space-y-3">
            {visible.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                accentHex={accentHex}
                open={openId === booking.id}
                onToggle={() => setOpenId((prev) => (prev === booking.id ? '' : booking.id))}
                onOpenSalon={onOpenSalon}
                onChanged={(next, notice) => {
                  if (next) state.setData(bookings.map((item) => (item.id === next.id ? next : item)));
                  if (notice) setFlash(notice);
                  // Then re-read: the card must end up showing the stored row,
                  // not the optimistic one the screen built itself.
                  state.reload();
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'warn' | 'danger'> = {
  pending: 'warn',
  confirmed: 'success',
  in_progress: 'accent',
  completed: 'success',
  cancelled: 'danger',
  no_show: 'danger',
  reschedule_proposed: 'warn',
};

const BookingCard: React.FC<{
  booking: CustomerBooking;
  accentHex: string;
  open: boolean;
  onToggle: () => void;
  onChanged: (booking: CustomerBooking | null, notice: string) => void;
  onOpenSalon?: (salonId: string) => void;
}> = ({ booking, accentHex, open, onToggle, onChanged, onOpenSalon, onRequireAuth }) => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'none' | 'cancel' | 'reschedule' | 'review'>('none');
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(booking.review?.rating || 0);
  const [text, setText] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [proposedTime, setProposedTime] = useState('');

  const currency = booking.currency || '₹';
  const cancelDecision = canCancelBooking({
    status: booking.status,
    date: booking.date,
    time: booking.time,
    nowMs: Date.now(),
    // The salon's own lead time is what the API enforces; the card only needs
    // to avoid offering an action the server will refuse, so it uses the
    // default and lets the server's answer be final.
  });
  const reviewable = canReview({ status: booking.status, reviewRating: booking.review?.rating ?? null });
  // Amount and percentage come from the booking row itself (the policy the app
  // stored at booking time), so this button can never offer a figure the
  // server's recomputation will refuse.
  const depositPercent = booking.depositPercent || 0;
  const depositDue = depositPercent > 0 ? booking.depositDue : 0;

  async function run(action: 'cancel' | 'reschedule' | 'review' | 'deposit') {
    setBusy(action);
    setError('');
    setNotice('');
    if (action === 'cancel') {
      const result = await cancelMyBooking(booking.id, reason);
      setBusy('');
      if (!result.ok) return void setError(normalizeCustomerErrorMessage(result));
      setMode('none');
      onChanged(result.data || null, 'Your booking was cancelled and the slot is free again.');
      return;
    }
    if (action === 'reschedule') {
      const result = await proposeMyBookingReschedule(booking.id, proposedDate, proposedTime);
      setBusy('');
      if (!result.ok) return void setError(normalizeCustomerErrorMessage(result));
      setMode('none');
      onChanged(result.data || null, 'Your proposed time was sent to the salon for approval.');
      return;
    }
    if (action === 'review') {
      const validation = validateReview({ status: booking.status, rating, text });
      if (!validation.ok) {
        setBusy('');
        return void setError(validation.error || 'That review could not be validated.');
      }
      const result = await reviewMyBooking(booking.id, validation.rating, validation.text);
      setBusy('');
      if (!result.ok) return void setError(normalizeCustomerErrorMessage(result));
      setMode('none');
      onChanged(
        { ...booking, review: result.data || { ...(booking.review as any), rating, text: validation.text } },
        'Thanks — your review is stored on the booking.'
      );
      return;
    }
    if (action === 'deposit') {
      const outcome = await payAdvanceWithRazorpay({
        totalAmount: booking.totalAmount,
        depositPercent,
        amount: depositDue,
        receipt: booking.id,
        description: `${booking.salonName || 'Salon'} — deposit for ${booking.serviceName}`,
        customer: { name: booking.customerName, email: booking.customerEmail || undefined, contact: booking.customerPhone },
        salonName: booking.salonName || 'Nexora salon',
        themeColor: accentHex,
      });
      if (outcome.status !== 'paid') {
        setBusy('');
        setNotice(
          outcome.status === 'dismissed'
            ? 'You closed the payment window — the booking is untouched.'
            : outcome.reason || 'Online payment is not available. Pay at the salon instead.'
        );
        if (outcome.status === 'failed') setError(outcome.reason);
        return;
      }
      const recorded = await payBookingAdvance(booking.id, {
        razorpay_order_id: outcome.orderId || '',
        razorpay_payment_id: outcome.paymentId || '',
        razorpay_signature: outcome.signature || '',
        amount: outcome.amount,
        depositPercent,
      });
      setBusy('');
      if (!recorded.ok) {
        setError(normalizeCustomerErrorMessage(recorded));
        return;
      }
      onChanged(
        recorded.data?.booking || booking,
        recorded.notice ||
          (outcome.mode === 'mock'
            ? 'Deposit simulated by the sandbox gateway — no money moved.'
            : `Deposit of ${money(outcome.amount, currency)} recorded and the booking is confirmed.`)
      );
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`${CARD_CLASS} overflow-hidden`}>
      <button type="button" onClick={onToggle} className="w-full text-left p-4">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 shrink-0 rounded-2xl bg-slate-100 grid place-items-center">
            <Ticket className="w-5 h-5 text-slate-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone={STATUS_TONE[booking.status] || 'neutral'}>{booking.status.replace(/_/g, ' ')}</Chip>
              <Chip tone={booking.paymentStatus === 'pending' ? 'warn' : 'neutral'} title="payment_status on the booking row">
                {booking.paymentStatus.replace(/_/g, ' ')}
              </Chip>
              <SourceChip source={booking.source} />
            </div>
            <p className="mt-1.5 text-sm font-extrabold text-slate-900 truncate">{booking.serviceName || 'Appointment'}</p>
            <p className={`text-xs ${MUTED_CLASS}`}>
              {booking.salonName || 'Salon'} · {dayLabel(booking.date)} · {clockLabel(booking.time)}
              {booking.staffNames.length ? ` · ${booking.staffNames.join(', ')}` : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-extrabold text-slate-900">{money(booking.totalAmount, currency)}</p>
            {booking.advancePaid > 0 ? <p className="text-[11px] text-emerald-700 font-bold">{money(booking.advancePaid, currency)} paid</p> : null}
            {booking.balanceDue > 0 && booking.status !== 'cancelled' ? <p className="text-[11px] text-slate-500">{money(booking.balanceDue, currency)} due</p> : null}
            <ChevronDown className={`w-4 h-4 ml-auto mt-1 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
              {booking.proposedDate ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  You proposed {dayLabel(booking.proposedDate)} at {clockLabel(booking.proposedTime)} — waiting for the salon to accept.
                </p>
              ) : null}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Services on this booking</p>
                {booking.serviceLines.length ? (
                  <ul className="space-y-1">
                    {booking.serviceLines.map((line) => (
                      <li key={line.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-slate-800">
                          {line.name}
                          {line.staffName ? <span className={`text-xs ${MUTED_CLASS}`}> · {line.staffName}</span> : null}
                        </span>
                        <span className="text-slate-600 shrink-0">
                          {money(line.price, currency)} · {line.durationMinutes}m
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`text-xs ${MUTED_CLASS}`}>
                    This booking predates the service-line format, so it stores one service in `service_name` and has no itemised lines. Nothing is invented for it.
                  </p>
                )}
              </div>

              {booking.bookingType === 'home' ? (
                <p className="text-xs text-slate-600">
                  Home visit · {booking.homeAddress || 'address not recorded'}
                </p>
              ) : null}
              {booking.notes ? <p className="text-xs text-slate-600">Notes: {booking.notes}</p> : null}
              {booking.review ? (
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-xs font-bold text-slate-900 flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className={`w-3.5 h-3.5 ${index < booking.review!.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                    ))}
                    <span className="ml-1">Your review</span>
                  </p>
                  {booking.review.text ? <p className="text-xs text-slate-600 mt-1.5">{booking.review.text}</p> : null}
                  {booking.review.visitedOn ? <p className="text-[11px] text-slate-400 mt-1">Visited {dayLabel(booking.review.visitedOn)}</p> : null}
                </div>
              ) : null}
              <p className="text-[11px] text-slate-400 font-mono break-all">id {booking.id}</p>

              {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}
              {notice ? <p className="text-xs text-emerald-700">{notice}</p> : null}

              {mode === 'cancel' ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3 space-y-2">
                  <p className="text-xs font-bold text-rose-900">Why are you cancelling? (optional)</p>
                  <Field label="Reason" value={reason} onChange={setReason} placeholder="Change of plans, timing, budget…" />
                  <div className="flex gap-2">
                    <Button variant="danger" busy={busy === 'cancel'} onClick={() => run('cancel')}>
                      Cancel booking
                    </Button>
                    <Button variant="ghost" onClick={() => setMode('none')}>
                      Keep it
                    </Button>
                  </div>
                </div>
              ) : null}

              {mode === 'reschedule' ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 space-y-3">
                  <p className="text-xs font-bold text-amber-900">
                    Propose a new time. The salon approves it — nothing changes on the booking until they do.
                  </p>
                  <DatePicker value={proposedDate || booking.date} accentHex={accentHex} onChange={(value) => { setProposedDate(value); setProposedTime(''); }} />
                  <RescheduleSlots
                    salonId={booking.salonId}
                    date={proposedDate || booking.date}
                    serviceIds={booking.serviceLines.map((line) => line.serviceId).filter(Boolean)}
                    selected={proposedTime}
                    onSelect={setProposedTime}
                  />
                  <div className="flex gap-2">
                    <Button busy={busy === 'reschedule'} disabled={!proposedTime} onClick={() => run('reschedule')} accentHex={accentHex}>
                      Send proposal
                    </Button>
                    <Button variant="ghost" onClick={() => setMode('none')}>
                      Never mind
                    </Button>
                  </div>
                </div>
              ) : null}

              {mode === 'review' ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-xs font-bold text-slate-900">Rate your visit</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} star${value > 1 ? 's' : ''}`} className="p-1">
                        <Star className={`w-6 h-6 ${value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, MAX_REVIEW_LENGTH))}
                    placeholder="What went well? (optional)"
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900"
                  />
                  <p className="text-[11px] text-slate-500">{text.length}/{MAX_REVIEW_LENGTH} characters · stored on the booking row</p>
                  <div className="flex gap-2">
                    <Button busy={busy === 'review'} disabled={!rating} onClick={() => run('review')} accentHex={accentHex}>
                      Publish review
                    </Button>
                    <Button variant="ghost" onClick={() => setMode('none')}>
                      Not now
                    </Button>
                  </div>
                </div>
              ) : null}

              {mode === 'none' ? (
                <div className="flex flex-wrap gap-2">
                  {depositDue > 0 ? (
                    <Button busy={busy === 'deposit'} onClick={() => run('deposit')} accentHex={accentHex}>
                      <IndianRupee className="w-4 h-4" /> Pay deposit {money(depositDue, currency)}
                    </Button>
                  ) : null}
                  {reviewable ? (
                    <Button variant="secondary" onClick={() => setMode('review')} accentHex={accentHex}>
                      <Star className="w-4 h-4" /> {booking.review ? 'Update review' : 'Leave a review'}
                    </Button>
                  ) : null}
                  {booking.status !== 'cancelled' && booking.status !== 'completed' ? (
                    <Button variant="secondary" onClick={() => setMode('reschedule')} accentHex={accentHex}>
                      <Clock className="w-4 h-4" /> Propose new time
                    </Button>
                  ) : null}
                  <Button variant={cancelDecision.allowed ? 'danger' : 'ghost'} disabled={!cancelDecision.allowed} title={cancelDecision.allowed ? '' : cancelDecision.reason} onClick={() => setMode('cancel')} busy={busy === 'cancel'}>
                    <X className="w-4 h-4" /> Cancel
                  </Button>
                  {onOpenSalon && booking.salonId ? (
                    <Button variant="ghost" onClick={() => onOpenSalon(booking.salonId)}>
                      Open salon page
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
};

const RescheduleSlots: React.FC<{
  salonId: string;
  date: string;
  serviceIds: string[];
  selected: string;
  onSelect: (time: string) => void;
}> = ({ salonId, date, serviceIds, selected, onSelect }) => {
  const state = useCustomerQuery(
    () => (salonId && date && serviceIds.length ? fetchSlotWindow(salonId, { date, serviceIds }) : Promise.resolve({ ok: true as const, data: null })),
    [salonId, date, serviceIds.join(',')]
  );
  if (state.loading) return <LoadingRows rows={2} label="Checking that day…" />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  const slots = state.data?.slots || [];
  if (!slots.length) {
    return <p className="text-xs text-slate-500">No slots returned for that day, so the salon cannot offer one. Try another date or cancel and rebook.</p>;
  }
  const times = [...new Map(slots.filter((slot: any) => slot.available).map((slot: any) => [slot.time, slot])).keys()];
  if (!times.length) return <p className="text-xs text-slate-500">That day is fully booked for these services.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {times.map((time: string) => (
        <button
          key={time}
          type="button"
          onClick={() => onSelect(time)}
          className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${
            selected === time ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-700'
          }`}
          style={selected === time ? { backgroundColor: '#0f172a' } : undefined}
        >
          {clockLabel(time)}
        </button>
      ))}
    </div>
  );
};
