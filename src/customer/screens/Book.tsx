// ============================================================================
// Booking flow — Services → Staff → Date & Slot → Confirm → Done.
//
// Every value on this screen is a live query: the menu from `services`, the
// team from `stylists`, availability derived from `stylists.schedule` minus
// `bookings`, and the customer's own details from `profiles`. Nothing here
// falls back to `src/mockData.ts`; if a query fails the step shows an error
// with a retry, because a booking made on invented data is worse than no
// booking.
//
// The write is a single call to `POST /api/customer/bookings/create`, which
// inserts the booking, writes its service lines, re-reads the stored row and
// returns a fresh availability grid. Payment is a separate, later step (see
// `payAdvanceWithRazorpay`) so a slow gateway can never leave a half-written
// booking.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  IndianRupee,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import type { CustomerBooking, CustomerProfile, CustomerSlot } from '../../lib/customer/types';
import {
  createBooking,
  fetchSlotWindow,
  getMyProfile,
  getSalon,
  listSalonServices,
  listSalonStaff,
  normalizeCustomerErrorMessage,
  payBookingAdvance,
} from '../../lib/customer/api';
import { computeAdvanceDeposit } from '../../lib/advanceDeposit';
import { payAdvanceWithRazorpay } from '../../lib/razorpayCheckout';
import type { RazorpayOutcome } from '../../lib/razorpayCheckout';
import { toIsoDate, todayIsoDate } from '../../lib/customer/schema';
import {
  Button,
  CARD_CLASS,
  Card,
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
import { ServiceList, StaffList } from './Discover';

export interface BookingFlowProps {
  salonId: string;
  userId?: string | null;
  email?: string | null;
  accentHex?: string;
  /** From a shared link (`/app/book/:salon?ref=NX-…`). Never invented. */
  referralCodeFromLink?: string;
  onRequireAuth: () => void;
  onOpenBooking: (bookingId: string) => void;
  onExit: () => void;
}

type Step = 'services' | 'staff' | 'slots' | 'confirm' | 'done';

const STEP_ORDER: Step[] = ['services', 'staff', 'slots', 'confirm'];

const STEP_LABEL: Record<Step, string> = {
  services: 'Services',
  staff: 'Stylist',
  slots: 'Time',
  confirm: 'Confirm',
  done: 'Booked',
};

export const BookingFlow: React.FC<BookingFlowProps> = ({
  salonId,
  userId,
  email,
  accentHex = '#C20E5A',
  referralCodeFromLink = '',
  onRequireAuth,
  onOpenBooking,
  onExit,
}) => {
  const [step, setStep] = useState<Step>('services');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(todayIsoDate());
  const [time, setTime] = useState('');
  const [bookingType, setBookingType] = useState<'salon' | 'home'>('salon');
  const [form, setForm] = useState({ customerName: '', customerPhone: '', homeAddress: '', notes: '', referralCode: referralCodeFromLink });
  const [created, setCreated] = useState<{ booking: CustomerBooking; written: { bookings: number; serviceLines: number; notifications: number }; serviceLinesCount: number; depositDue: number; depositPercent: number } | null>(null);
  const [payState, setPayState] = useState<{ busy: boolean; error: string; notice: string; outcome: RazorpayOutcome | null }>({ busy: false, error: '', notice: '', outcome: null });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const salonState = useCustomerQuery(() => getSalon(salonId), [salonId]);
  const servicesState = useCustomerQuery(() => listSalonServices(salonId), [salonId]);
  const staffState = useCustomerQuery(() => listSalonStaff(salonId), [salonId]);
  const profileState = useCustomerQuery(() => getMyProfile(), [userId]);
  const slotsState = useCustomerQuery(
    () => (serviceIds.length ? fetchSlotWindow(salonId, { date, serviceIds, staffId }) : Promise.resolve({ ok: true, data: null, mode: 'live' as const })),
    [salonId, date, serviceIds.join(','), staffId]
  );
  const realtime = useCustomerRealtime(['slots', 'bookings'], email, () => slotsState.reload(), { salonId });

  const salon = salonState.data;
  const services = servicesState.data || [];
  const staff = staffState.data || [];
  const slots = slotsState.data?.slots || [];

  // Prefill from the customer's own profile row — the API returns only their
  // columns, so there is nothing else to leak into the form.
  useEffect(() => {
    const profile = profileState.data;
    if (!profile) return;
    setForm((prev) => ({
      ...prev,
      customerName: prev.customerName || profile.fullName || '',
      customerPhone: prev.customerPhone || profile.phone || '',
      homeAddress: prev.homeAddress || profile.address || '',
    }));
  }, [profileState.data]);

  useEffect(() => {
    if (!salon) return;
    setBookingType(salon.homeServiceEnabled ? bookingType : 'salon');
  }, [salon]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo(() => services.filter((service) => serviceIds.includes(service.id)), [services, serviceIds]);
  const durationMinutes = chosen.reduce((total, service) => total + Number(service.durationMinutes || 0), 0);
  const subtotal = chosen.reduce((total, service) => total + Number(service.price || 0), 0);
  const depositPercent = salon?.requireDeposit ? Math.min(100, Math.max(0, Number(salon?.depositPercentage ?? 20))) : 0;
  const deposit = useMemo(
    () => (depositPercent > 0 ? computeAdvanceDeposit(subtotal, depositPercent) : { rupees: 0, paise: 0, percent: 0 }),
    [subtotal, depositPercent]
  );
  const currency = salon?.currency || '₹';

  // A stylist can only be booked for what they are assigned to. When the owner
  // has assigned nothing, everybody is treated as able to do everything —
  // that is what the salon's own booking widget does.
  const eligibleStaff = useMemo(() => {
    if (!serviceIds.length) return staff;
    const assigned = staff.filter((member) => !member.assignedServiceIds.length || member.assignedServiceIds.some((id) => serviceIds.includes(id)));
    return assigned;
  }, [staff, serviceIds]);

  // Slots arrive per stylist. Group them by time so "anyone available" can show
  // a single tappable row that says how many people are free.
  const timeRows = useMemo(() => {
    const map = new Map<string, CustomerSlot[]>();
    for (const slot of slots) {
      const list = map.get(slot.time) || [];
      list.push(slot);
      map.set(slot.time, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, options]) => ({
        time: value,
        available: options.some((option) => option.available),
        freeStaff: options.filter((option) => option.available),
        reason: options.every((option) => option.available) ? '' : (options[0]?.reason || 'booked'),
      }));
  }, [slots]);

  const selectedStaffName = staffId ? eligibleStaff.find((member) => member.id === staffId)?.name || '' : '';
  const selectedSlotStaff = time ? timeRows.find((row) => row.time === time)?.freeStaff || [] : [];

  const toggleService = useCallback((id: string) => {
    setSubmitError('');
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    // Service list is part of the slot query, so a change invalidates a pick.
    setTime('');
  }, []);

  function canContinue(): { ok: boolean; why: string } {
    if (step === 'services') return serviceIds.length ? { ok: true, why: '' } : { ok: false, why: 'Pick at least one service to continue.' };
    if (step === 'slots') return time ? { ok: true, why: '' } : { ok: false, why: 'Choose an available time.' };
    return { ok: true, why: '' };
  }

  const gate = canContinue();

  async function next() {
    if (!gate.ok) {
      setSubmitError(gate.why);
      return;
    }
    setSubmitError('');
    if (step === 'slots' && !userId) {
      onRequireAuth();
      return;
    }
    const index = STEP_ORDER.indexOf(step);
    if (step === 'services' && !eligibleStaff.length && staff.length === 0) {
      // No team at all: the salon assigns somebody, so skip the pick rather
      // than stranding the customer on an empty step.
      setStep('slots');
      return;
    }
    setStep(STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)]);
  }

  function back() {
    const index = STEP_ORDER.indexOf(step);
    if (index <= 0) {
      onExit();
      return;
    }
    setSubmitError('');
    setStep(STEP_ORDER[index - 1]);
  }

  async function submit() {
    if (!userId) {
      onRequireAuth();
      return;
    }
    if (!serviceIds.length || !date || !time) {
      setSubmitError('Something in your selection is missing — go back a step and check.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    const result = await createBooking({
      salonId,
      date,
      time,
      serviceIds,
      staffId: staffId || (selectedSlotStaff[0]?.staffId ?? ''),
      bookingType,
      homeAddress: bookingType === 'home' ? form.homeAddress : '',
      notes: form.notes,
      referralCode: form.referralCode,
    });
    setSubmitting(false);
    if (!result.ok) {
      const message = normalizeCustomerErrorMessage(result);
      setSubmitError(message);
      // A taken slot must disappear from the grid immediately, not stay green.
      slotsState.reload();
      return;
    }
    const payload = result.data;
    if (!payload?.booking?.id) {
      setSubmitError('The booking was accepted but no record came back. Check your bookings list before trying again.');
      return;
    }
    setCreated({
      booking: payload.booking,
      written: payload.written,
      serviceLinesCount: payload.serviceLines?.length ?? 0,
      depositDue: payload.depositDue ?? deposit.rupees,
      depositPercent: payload.depositPercent ?? depositPercent,
    });
    setStep('done');
    slotsState.reload();
  }

  /**
   * The deposit is paid *after* the booking exists, through the same Razorpay
   * helper the salon's own widget uses, and only the server's verification of
   * the gateway signature marks the row paid.
   */
  async function payDepositNow() {
    if (!created?.booking) return;
    setPayState({ busy: true, error: '', notice: '', outcome: null });
    const outcome = await payAdvanceWithRazorpay({
      totalAmount: created.booking.totalAmount || subtotal,
      depositPercent: created.depositPercent || depositPercent,
      amount: created.depositDue,
      receipt: created.booking.id,
      description: `${salon?.name || 'Salon'} — deposit for ${created.booking.serviceName}`,
      customer: {
        name: created.booking.customerName || form.customerName || 'Customer',
        email: created.booking.customerEmail || email || undefined,
        contact: created.booking.customerPhone || form.customerPhone || '',
      },
      salonName: salon?.name || 'Nexora salon',
      themeColor: accentHex,
    });
    if (outcome.status !== 'paid') {
      setPayState({
        busy: false,
        error: outcome.status === 'failed' ? outcome.reason : '',
        notice:
          outcome.status === 'dismissed'
            ? 'You closed the payment window. The booking is saved and pending — pay at the salon, or try again.'
            : outcome.reason || 'Online payment is not available right now. Pay at the salon instead.',
        outcome,
      });
      return;
    }
    const recorded = await payBookingAdvance(created.booking.id, {
      razorpay_order_id: outcome.orderId || '',
      razorpay_payment_id: outcome.paymentId || '',
      razorpay_signature: outcome.signature || '',
      amount: outcome.amount,
      depositPercent: created.depositPercent || depositPercent,
    });
    if (!recorded.ok) {
      setPayState({
        busy: false,
        error: recorded.error || 'The payment went through but the booking could not be updated. Show this to the salon.',
        notice: '',
        outcome,
      });
      return;
    }
    const stored = recorded.data?.booking;
    setCreated((prev) => (prev ? { ...prev, booking: stored || prev.booking } : prev));
    setPayState({
      busy: false,
      error: '',
      notice:
        recorded.notice ||
        (recorded.data?.needsSalonAttention
          ? 'Payment succeeded but the booking could not be updated — the salon has your reference.'
          : outcome.mode === 'mock'
            ? 'Deposit simulated by the sandbox gateway. No money moved.'
            : `Deposit of ${money(outcome.amount, currency)} recorded. Status is now confirmed.`),
      outcome,
    });
  }

  if (salonState.loading) {
    return <LoadingRows rows={4} label="Loading the salon from Supabase…" />;
  }
  if (salonState.failed || !salon) {
    return (
      <ErrorState
        message={salonState.error || 'This salon could not be loaded, so booking is not possible right now.'}
        onRetry={salonState.reload}
      />
    );
  }

  const railIndex = step === 'done' ? STEP_ORDER.length : STEP_ORDER.indexOf(step);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={back} className="w-9 h-9 rounded-full border border-slate-200 bg-white grid place-items-center text-slate-600 hover:bg-slate-50" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {step === 'done' ? 'Booked' : `Step ${railIndex + 1} of ${STEP_ORDER.length} · ${STEP_LABEL[step]}`}
          </p>
          <p className="text-sm font-extrabold text-slate-900 truncate">{salon.name}</p>
        </div>
        <Chip tone="neutral" title={realtime.transport === 'supabase-realtime' ? 'Availability is refreshed by Supabase Realtime' : 'Availability is refreshed by adaptive polling (Realtime unavailable)'}>
          <span className={`w-1.5 h-1.5 rounded-full ${realtime.transport === 'supabase-realtime' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {realtime.transport === 'supabase-realtime' ? 'live' : 'polling'}
        </Chip>
      </div>

      <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_ORDER.length} aria-valuenow={Math.min(railIndex + 1, STEP_ORDER.length)}>
        {STEP_ORDER.map((item, index) => (
          <span key={item} className="h-1 flex-1 rounded-full" style={{ backgroundColor: index <= railIndex ? accentHex : '#e2e8f0' }} />
        ))}
      </div>

      {step === 'services' ? (
        <div className="space-y-3">
          <SectionTitle
            title="What are you booking?"
            subtitle="Straight from this salon's live `services` rows. Pick more than one and the total, duration and deposit are recalculated from the same numbers the API will store."
          />
          <ServiceList
            services={services}
            state={servicesState}
            accentHex={accentHex}
            salonName={salon.name}
            currency={currency}
            selected={serviceIds}
            onToggle={toggleService}
            onBook={(ids) => {
              setServiceIds(ids);
              setStep('staff');
            }}
          />
        </div>
      ) : null}

      {step === 'staff' ? (
        <div className="space-y-3">
          <SectionTitle title="Who should do it?" subtitle="Only stylists assigned to the services you picked are selectable. 'Anyone available' leaves the assignment to the salon." />
          <div className={`${CARD_CLASS} p-3 flex items-center justify-between gap-3`}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-slate-100 grid place-items-center">
                <Sparkles className="w-5 h-5 text-slate-500" />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Anyone available</p>
                <p className={`text-xs ${MUTED_CLASS}`}>Availability is checked across the whole team.</p>
              </div>
            </div>
            <Button variant={staffId === '' ? 'primary' : 'secondary'} onClick={() => setStaffId('')} accentHex={accentHex}>
              {staffId === '' ? 'Selected' : 'Use this'}
            </Button>
          </div>
          <StaffList
            staff={eligibleStaff}
            state={staffState}
            salonName={salon.name}
            accentHex={accentHex}
            selectedId={staffId}
            onSelect={(id) => {
              setStaffId(id);
              setTime('');
            }}
          />
          {staff.length > 0 && eligibleStaff.length === 0 ? (
            <p className={`text-xs ${MUTED_CLASS}`}>
              No stylist on this team is assigned to the services you picked, so the salon will assign one. Slots below are the salon-wide view.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'slots' ? (
        <div className="space-y-3">
          <SectionTitle
            title="Pick a day and time"
            subtitle="Availability is computed live: each stylist's `schedule` window minus rows already in `bookings`. No slot list is stored, so it can never be stale."
          />
          <DatePicker value={date} accentHex={accentHex} onChange={(next) => { setDate(next); setTime(''); }} />
          <div className={`${CARD_CLASS} p-4`}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-bold text-slate-900">{dayLabel(date)}</p>
              <div className="flex items-center gap-2">
                <SourceChip source={slotsState.data?.source} title={`Fetched ${slotsState.data?.fetchedAt ? new Date(slotsState.data.fetchedAt).toLocaleTimeString() : 'just now'}`} />
                <button type="button" onClick={slotsState.reload} className="text-xs font-bold text-slate-500 hover:text-slate-900">
                  Refresh
                </button>
              </div>
            </div>
            {slotsState.loading ? <LoadingRows rows={3} label="Checking the diary…" /> : null}
            {slotsState.failed ? <ErrorState message={slotsState.error} onRetry={slotsState.reload} /> : null}
            {!slotsState.loading && !slotsState.failed && !serviceIds.length ? (
              <EmptyState icon={<Sparkles className="w-6 h-6 text-slate-400" />} title="Pick a service first" body="Duration decides which slots fit, so availability needs at least one service." />
            ) : null}
            {!slotsState.loading && !slotsState.failed && serviceIds.length && !timeRows.length ? (
              <EmptyState
                icon={<Clock className="w-6 h-6 text-slate-400" />}
                title={slotsState.data?.closedReason === 'no-schedule' ? 'This salon has no opening hours set' : slotsState.data?.closedReason === 'no-staff' ? 'No stylist is available on this day' : 'No free slots on this day'}
                body={
                  slotsState.data?.closedReason === 'no-schedule'
                    ? 'The owner has not configured `working_hours`, so nothing can be offered. Try another day or another salon — this is not a loading problem.'
                    : slotsState.data?.closedReason === 'no-staff'
                      ? 'Every stylist is inactive or off on this date. Pick another day.'
                      : 'The whole day is taken or outside the opening window. Try another date.'
                }
              />
            ) : null}
            {timeRows.length ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {timeRows.map((row) => {
                  const isSelected = time === row.time;
                  return (
                    <button
                      key={row.time}
                      type="button"
                      disabled={!row.available}
                      onClick={() => setTime(row.time)}
                      title={row.available ? row.freeStaff.map((slot) => slot.staffName).join(', ') : `Unavailable (${row.reason})`}
                      className={`rounded-2xl border px-2 py-2.5 text-center transition ${
                        isSelected ? 'border-transparent text-white' : row.available ? 'border-slate-200 hover:border-slate-300' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                      }`}
                      style={isSelected ? { backgroundColor: accentHex } : undefined}
                    >
                      <span className="block text-sm font-bold">{clockLabel(row.time)}</span>
                      <span className={`block text-[10px] ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                        {row.available ? (staffId ? 'free' : `${row.freeStaff.length} free`) : row.reason === 'past' ? 'past' : row.reason === 'off-shift' ? 'off' : 'booked'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {time ? (
            <p className={`text-xs ${MUTED_CLASS}`}>
              {staffId
                ? `With ${selectedStaffName} at ${clockLabel(time)}.`
                : `${selectedSlotStaff.length} stylist${selectedSlotStaff.length === 1 ? '' : 's'} free at ${clockLabel(time)}: ${selectedSlotStaff.map((slot) => slot.staffName).join(', ')}.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'confirm' ? (
        <div className="space-y-3">
          <SectionTitle title="Check the details" subtitle="These go into the booking row exactly as the API stores them. The summary above is recomputed here, not carried over." />
          <Card className="p-4">
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Salon" value={salon.name} />
              <SummaryRow label="Services" value={chosen.map((service) => `${service.name} ${money(service.price, currency)}`).join(' + ')} />
              <SummaryRow label="When" value={`${dayLabel(date)} · ${clockLabel(time)}`} />
              <SummaryRow label="Stylist" value={staffId ? selectedStaffName : `Anyone (${selectedSlotStaff.map((slot) => slot.staffName).join(', ') || 'salon assigns'})`} />
              <SummaryRow label="Duration" value={`${durationMinutes} min`} />
              <SummaryRow label="Total" value={money(subtotal, currency)} strong />
              {salon.requireDeposit ? <SummaryRow label={`Deposit now (${depositPercent}%)`} value={money(deposit.rupees, currency)} strong /> : <SummaryRow label="Payment" value="Pay at the salon" />}
            </dl>
          </Card>

          {salon.homeServiceEnabled ? (
            <div className="flex gap-2">
              <Chip tone={bookingType === 'salon' ? 'accent' : 'neutral'} onClick={() => setBookingType('salon')} title="Attend the salon address">
                <MapPin className="w-3 h-3" /> At the salon
              </Chip>
              <Chip tone={bookingType === 'home' ? 'accent' : 'neutral'} onClick={() => setBookingType('home')} title="This salon offers home visits">
                <Users className="w-3 h-3" /> At my home
              </Chip>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your name" value={form.customerName} onChange={(customerName) => setForm({ ...form, customerName })} placeholder="As the salon should greet you" />
            <Field label="Phone" value={form.customerPhone} onChange={(customerPhone) => setForm({ ...form, customerPhone })} placeholder="+91 98765 43210" />
            {bookingType === 'home' ? (
              <div className="sm:col-span-2">
                <Field label="Address for the visit" value={form.homeAddress} onChange={(homeAddress) => setForm({ ...form, homeAddress })} placeholder="Flat, street, landmark" />
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Field label="Notes for the stylist (optional)" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} placeholder="Preferred length, allergies, inspiration" />
            </div>
            <div className="sm:col-span-2">
              <Field label="Referral code (optional)" value={form.referralCode} onChange={(referralCode) => setForm({ ...form, referralCode })} placeholder="NX-XXXXXXXX" hint="Saved on the booking; the salon credits the reward when the visit is completed." />
            </div>
          </div>

          {!userId ? (
            <div className={`${CARD_CLASS} p-4 flex items-center gap-3`}>
              <Lock className="w-5 h-5 text-slate-400" />
              <p className={`text-sm flex-1 ${MUTED_CLASS}`}>Sign in so this booking is saved to your account.</p>
              <Button onClick={onRequireAuth} accentHex={accentHex}>
                Sign in
              </Button>
            </div>
          ) : null}

        </div>
      ) : null}

      {step === 'done' && created ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-2xl grid place-items-center text-white" style={{ backgroundColor: accentHex }}>
                <Check className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-extrabold text-slate-900">Booked at {created.booking.salonName || salon.name}</p>
                <p className={`text-sm ${MUTED_CLASS}`}>
                  {dayLabel(created.booking.date)} · {clockLabel(created.booking.time)} · {created.booking.serviceName}
                </p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <SummaryRow label="Status" value={created.booking.status.replace(/_/g, ' ')} />
              <SummaryRow label="Payment" value={created.booking.paymentStatus.replace(/_/g, ' ')} />
              <SummaryRow label="Total" value={money(created.booking.totalAmount, currency)} strong />
              <SummaryRow
                label="Saved in Supabase"
                value={`${created.written.bookings} booking row · ${created.serviceLinesCount} service line${created.serviceLinesCount === 1 ? '' : 's'} · ${created.written.notifications} notification${created.written.notifications === 1 ? '' : 's'}`}
              />
              <SummaryRow label="Booking id" value={created.booking.id} mono />
            </dl>
            {created.depositDue > 0 && created.booking.paymentStatus === 'pending' ? (
              <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                <p className="text-sm font-bold text-slate-900">
                  Deposit of {money(created.depositDue, currency)} is due to confirm this slot.
                </p>
                <p className={`text-xs mt-1 ${MUTED_CLASS}`}>
                  Until it is paid the slot is held as pending; the salon can release it.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button onClick={payDepositNow} busy={payState.busy} accentHex={accentHex}>
                    {payState.busy ? 'Opening payment…' : `Pay ${money(created.depositDue, currency)} now`}
                  </Button>
                  <Button variant="ghost" onClick={onExit} disabled={payState.busy}>
                    Pay at the salon
                  </Button>
                </div>
                {payState.error ? <p className="text-xs font-semibold text-rose-600 mt-2">{payState.error}</p> : null}
                {payState.notice ? <p className="text-xs text-slate-600 mt-2">{payState.notice}</p> : null}
              </div>
            ) : null}
            {created.booking.paymentStatus !== 'pending' ? (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
                <ShieldCheck className="w-3.5 h-3.5" />
                {created.booking.paymentStatus === 'paid_deposit' ? 'Deposit recorded on the booking.' : 'Nothing to pay now — settle at the salon.'}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="secondary" onClick={() => onOpenBooking(created.booking.id)} accentHex={accentHex}>
                Open my booking <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreated(null);
                  setServiceIds([]);
                  setTime('');
                  setStaffId('');
                  setPayState({ busy: false, error: '', notice: '', outcome: null });
                  setStep('services');
                }}
              >
                Book something else
              </Button>
            </div>
          </Card>
        </motion.div>
      ) : null}

      {step !== 'done' ? (
        <div className="flex items-center justify-between gap-3">
          <p className={`text-xs ${submitError ? 'font-semibold text-rose-600' : MUTED_CLASS}`}>{submitError || (step === 'confirm' && !userId ? 'Sign in to finish booking.' : '')}</p>
          {step === 'confirm' ? (
            <Button onClick={submit} busy={submitting} disabled={!userId} accentHex={accentHex}>
              {submitting ? 'Saving…' : userId ? 'Confirm booking' : 'Sign in to confirm'}
              {submitting ? null : <ArrowRight className="w-4 h-4" />}
            </Button>
          ) : (
            <Button onClick={next} disabled={!gate.ok} accentHex={accentHex}>
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      ) : null}

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5 pb-2">
        <Ticket className="w-3.5 h-3.5" />
        Bookings are written to your own Supabase row through the app API; the salon sees it in their dashboard the moment it lands.
        {deposit.rupees > 0 && step !== 'done' ? (
          <span className="inline-flex items-center gap-1 ml-1 font-semibold text-slate-700">
            <IndianRupee className="w-3.5 h-3.5" /> {money(deposit.rupees, currency)} deposit
          </span>
        ) : null}
      </p>
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; value: string; strong?: boolean; mono?: boolean }> = ({ label, value, strong, mono }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className={`text-xs uppercase tracking-wide ${MUTED_CLASS}`}>{label}</dt>
    <dd className={`${strong ? 'text-sm font-extrabold text-slate-900' : 'text-sm text-slate-700'} ${mono ? 'font-mono text-[11px] break-all' : ''} text-right`}>{value}</dd>
  </div>
);

/**
 * Fourteen days from today, rendered as chips. Past dates are never offered —
 * the API rejects them too, and a customer should find out here rather than on
 * submit. Also used by the reschedule sheet on the bookings screen, so the two
 * can never disagree about which dates are bookable.
 */
export const DatePicker: React.FC<{ value: string; onChange: (date: string) => void; accentHex: string }> = ({ value, onChange, accentHex }) => {
  const days = useMemo(() => {
    const out: string[] = [];
    const start = new Date(`${todayIsoDate()}T00:00:00`);
    for (let index = 0; index < 14; index += 1) {
      const day = new Date(start.getTime());
      day.setDate(start.getDate() + index);
      out.push(toIsoDate(day));
    }
    return out;
  }, []);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={`${CARD_CLASS} p-3`}>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {days.map((day) => {
          const active = day === value;
          const parts = new Date(`${day}T00:00:00`);
          return (
            <button
              key={day}
              type="button"
              onClick={() => onChange(day)}
              className={`shrink-0 rounded-2xl border px-3 py-2 text-center ${active ? 'border-transparent text-white' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
              style={active ? { backgroundColor: accentHex } : undefined}
            >
              <span className="block text-[10px] font-bold uppercase tracking-wide opacity-80">
                {parts.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="block text-sm font-extrabold">{parts.getDate()}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => inputRef.current?.showPicker?.()}
          className="shrink-0 rounded-2xl border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          <CalendarDays className="w-4 h-4 inline mr-1" />
          Other
        </button>
        <input
          ref={inputRef}
          type="date"
          value={value}
          min={todayIsoDate()}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          className="sr-only"
          aria-label="Choose another date"
        />
      </div>
    </div>
  );
};
