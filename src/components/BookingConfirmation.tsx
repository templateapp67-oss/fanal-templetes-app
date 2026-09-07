import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CalendarPlus,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  History,
  MapPin,
  MessageSquare,
  Navigation,
  Store,
  User,
  Clock,
  Sparkles,
  AlertCircle,
  IndianRupee,
  CheckCircle2,
} from 'lucide-react';
import {
  buildGoogleCalendarUrl,
  buildIcsFile,
  buildIcsFilename,
  buildDirectionsUrl,
  confirmationHeadline,
  formatBookingDate,
  formatBookingTime,
  formatMoney,
  type BookingConfirmationSummary,
  type WhatsappConfirmationStatus,
} from '../lib/bookingConfirmation';
import { describeBookingStatus, type DisplayBookingStatus } from '../lib/bookingStatus';
import { BookingStatusBadge } from './BookingStatusBadge';

/**
 * Booking confirmation page (step 6 of the booking flow).
 *
 * This screen answers one question the customer needs settled before they close
 * the tab: **did my booking actually go through?** So the layout leads with the
 * status, then proves it with the reference and every detail the salon holds,
 * then offers the three things a customer does next — save it to their
 * calendar, find the salon, and send themselves a copy on WhatsApp.
 *
 * The headline is derived from the booking's real status rather than hardcoded.
 * A booking written as `pending` says "Your booking is submitted."; only one
 * the salon has accepted says "Your booking is confirmed." Claiming
 * confirmation for a pending row is the failure mode this screen exists to
 * prevent.
 */

export interface BookingConfirmationPayment {
  advancePaid: boolean;
  advanceAmount: number;
  balanceAmount: number;
  receiptId?: string;
}

export interface BookingConfirmationProps {
  summary: BookingConfirmationSummary;
  status: DisplayBookingStatus;
  customerName?: string;
  /** Salon's number, quoted in the "not submitted" fallback. */
  salonPhone?: string;
  payment?: BookingConfirmationPayment;
  upgrades?: string[];
  /** "In-Salon" / "Home Service" */
  bookingTypeLabel?: string;
  whatsapp: WhatsappConfirmationStatus;
  onSendWhatsapp: () => void;
  /**
   * True when the customer arrived here from their booking history rather than
   * a fresh checkout — the only case where a "Book it again" CTA makes sense.
   */
  fromHistory?: boolean;
  onRebook?: () => void;
  onBookAnother?: () => void;
  onClose: () => void;
  accentHex?: string;
  /** Reminder offset for the calendar alarm, in minutes. */
  alarmMinutesBefore?: number;
}

const TONE_ART: Record<string, { ring: string; tile: string; Icon: typeof CheckCircle2 }> = {
  emerald: { ring: 'bg-emerald-400', tile: 'bg-emerald-600 shadow-emerald-600/30', Icon: CheckCircle2 },
  amber: { ring: 'bg-amber-400', tile: 'bg-amber-500 shadow-amber-500/30', Icon: Clock },
  sky: { ring: 'bg-sky-400', tile: 'bg-sky-600 shadow-sky-600/30', Icon: CheckCircle2 },
  rose: { ring: 'bg-rose-400', tile: 'bg-rose-600 shadow-rose-600/30', Icon: AlertCircle },
  orange: { ring: 'bg-orange-400', tile: 'bg-orange-500 shadow-orange-500/30', Icon: AlertCircle },
  blue: { ring: 'bg-blue-400', tile: 'bg-blue-600 shadow-blue-600/30', Icon: Clock },
  slate: { ring: 'bg-slate-300', tile: 'bg-slate-600 shadow-slate-600/30', Icon: AlertCircle },
};

const WHATSAPP_TONE: Record<string, string> = {
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  slate: 'text-slate-600',
};

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({
  icon,
  label,
  children,
}) => (
  <div className="flex items-start justify-between gap-3 text-xs">
    <span className="flex items-center gap-1.5 text-slate-500 shrink-0 pt-0.5">
      {icon}
      {label}
    </span>
    <span className="font-semibold text-slate-900 text-right break-words">{children}</span>
  </div>
);

export const BookingConfirmation: React.FC<BookingConfirmationProps> = ({
  summary,
  status,
  customerName = '',
  salonPhone = '',
  payment,
  upgrades = [],
  bookingTypeLabel = 'In-Salon',
  whatsapp,
  onSendWhatsapp,
  fromHistory = false,
  onRebook,
  onBookAnother,
  onClose,
  accentHex = '#0f172a',
  alarmMinutesBefore = 120,
}) => {
  const descriptor = describeBookingStatus(status);
  const art = TONE_ART[descriptor.tone] ?? TONE_ART.slate;
  const isConfirmed = descriptor.id === 'confirmed';
  const isSubmitted = descriptor.id !== 'not_submitted';

  const [copiedId, setCopiedId] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarAdded, setCalendarAdded] = useState(false);

  const calendarTitle = `${summary.serviceName} — ${summary.salonName}`;
  const calendarDescription = useMemo(
    () =>
      [
        `Booking ID: ${summary.bookingId}`,
        `Salon: ${summary.salonName}`,
        `Service: ${summary.serviceName}${upgrades.length ? ` + ${upgrades.join(', ')}` : ''}`,
        `Specialist: ${summary.staffName}`,
        `Total: ${formatMoney(summary.totalAmount, summary.currency)}`,
        customerName ? `Booked by: ${customerName}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    [summary, upgrades, customerName]
  );

  // Derived once per render: a null value means the slot could not be parsed,
  // and the matching button is disabled instead of doing nothing on click.
  const icsFile = useMemo(
    () =>
      buildIcsFile({
        uid: `${summary.bookingId}@fanal.booking`,
        title: calendarTitle,
        description: calendarDescription,
        location: `${summary.salonName}, ${summary.address}`,
        date: summary.date,
        time: summary.time,
        durationMinutes: summary.durationMinutes,
        status: isConfirmed ? 'CONFIRMED' : 'TENTATIVE',
        alarmMinutesBefore,
      }),
    [summary, calendarTitle, calendarDescription, isConfirmed, alarmMinutesBefore]
  );
  const icsFilename = buildIcsFilename(summary.bookingId);
  const googleCalendarUrl = useMemo(
    () =>
      buildGoogleCalendarUrl({
        title: calendarTitle,
        description: calendarDescription,
        location: `${summary.salonName}, ${summary.address}`,
        date: summary.date,
        time: summary.time,
        durationMinutes: summary.durationMinutes,
      }),
    [summary, calendarTitle, calendarDescription]
  );
  const directionsUrl = useMemo(
    () =>
      buildDirectionsUrl({
        latitude: summary.latitude,
        longitude: summary.longitude,
        address: `${summary.salonName}, ${summary.address}`,
      }),
    [summary]
  );

  const handleCopyBookingId = () => {
    try {
      navigator.clipboard?.writeText(summary.bookingId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Clipboard permission denied — the id is on screen and selectable.
    }
  };

  const handleDownloadIcs = () => {
    setCalendarError('');
    if (!icsFile) {
      setCalendarError('This slot could not be turned into a calendar file. Please add it manually.');
      return;
    }
    let objectUrl = '';
    try {
      const blob = new Blob([icsFile], { type: 'text/calendar;charset=utf-8' });
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = icsFilename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setCalendarAdded(true);
    } catch (err: any) {
      setCalendarError(
        `Your browser blocked the calendar download (${err?.message || 'unknown error'}). Use the Google Calendar link instead.`
      );
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center text-center gap-4 py-3"
    >
      {/* ---------------- Status mark ---------------- */}
      <div className="relative flex items-center justify-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0.8 }}
          animate={{ scale: [0.8, 1.35, 1.2], opacity: [0.6, 0.2, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          className={`absolute w-20 h-20 rounded-full -z-10 ${art.ring}`}
        />
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 350, damping: 20 }}
          className={`w-16 h-16 rounded-2xl text-white flex items-center justify-center shadow-lg relative ${art.tile}`}
        >
          <art.Icon className="w-9 h-9" />
          {isConfirmed && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.25, 1] }}
              transition={{ delay: 0.25 }}
              className="absolute -top-1.5 -right-1.5 bg-amber-400 text-slate-950 p-1 rounded-full shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
            </motion.span>
          )}
        </motion.div>
      </div>

      {/* ---------------- Headline: "Your booking is confirmed." ---------------- */}
      <div>
        <h4 className="font-bold text-2xl text-slate-900" data-testid="booking-confirmation-headline">
          {confirmationHeadline(status)}
        </h4>
        <p className="text-xs text-slate-600 max-w-sm mt-1.5">
          {customerName.trim() ? (
            <>
              <strong className="text-slate-900">{customerName.trim()}</strong>, {descriptor.description}
            </>
          ) : (
            descriptor.description
          )}
        </p>
        <div className="mt-2.5 flex justify-center">
          <BookingStatusBadge status={status} />
        </div>
      </div>

      {/* A booking that never reached the salon must not look like one that did. */}
      {!isSubmitted && (
        <div className="w-full flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] text-left">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            We couldn't reach the salon's booking service, so this request is saved on this device only.
            Please send the details on WhatsApp (button below) or call{' '}
            <strong>{salonPhone || 'the salon'}</strong> to confirm your slot.
          </span>
        </div>
      )}

      {/* ---------------- Booking details ---------------- */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl w-full text-left flex flex-col gap-2.5">
        <div className="flex justify-between items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500 shrink-0">
            <span className="font-mono text-[10px] uppercase tracking-wide">Booking ID</span>
          </span>
          <div className="flex items-center gap-1.5 min-w-0">
            <strong className="font-mono text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-300 font-bold text-sm tracking-wider select-all">
              {summary.bookingId}
            </strong>
            <button
              type="button"
              onClick={handleCopyBookingId}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
              title="Copy Booking ID"
              aria-label="Copy Booking ID"
            >
              {copiedId ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-2.5 flex flex-col gap-2.5">
          <Row icon={<Store className="w-3.5 h-3.5" />} label="Salon">
            {summary.salonName}
          </Row>
          <Row icon={<Sparkles className="w-3.5 h-3.5" />} label="Service">
            {summary.serviceName}
            {upgrades.length > 0 && (
              <span className="block text-[11px] font-normal text-slate-500">+ {upgrades.join(', ')}</span>
            )}
          </Row>
          <Row icon={<User className="w-3.5 h-3.5" />} label="Staff">
            {summary.staffName}
          </Row>
          <Row icon={<Calendar className="w-3.5 h-3.5" />} label="Date">
            {formatBookingDate(summary.date)}
          </Row>
          <Row icon={<Clock className="w-3.5 h-3.5" />} label="Time">
            {formatBookingTime(summary.time)} IST
          </Row>
          <Row icon={<MapPin className="w-3.5 h-3.5" />} label={summary.addressLabel}>
            {summary.address}
            <span className="block text-[11px] font-normal text-slate-500">{bookingTypeLabel}</span>
          </Row>
        </div>

        <div className="border-t border-slate-200 pt-2.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-slate-500 text-xs">
            <IndianRupee className="w-3.5 h-3.5" />
            Total Price
          </span>
          <strong className="text-base font-bold text-slate-900">
            {formatMoney(summary.totalAmount, summary.currency)}
          </strong>
        </div>

        {payment && (
          <div className="flex justify-between items-start gap-3 text-xs">
            <span className="text-slate-500">Payment Status</span>
            <strong className={`text-right ${payment.advancePaid ? 'text-emerald-700' : 'text-amber-700'}`}>
              {payment.advancePaid
                ? `Advance paid ${formatMoney(payment.advanceAmount, summary.currency)} · Balance ${formatMoney(
                    payment.balanceAmount,
                    summary.currency
                  )}`
                : `Pay at ${summary.addressKind === 'home' ? 'home' : 'salon'} (${formatMoney(
                    summary.totalAmount,
                    summary.currency
                  )})`}
              {payment.advancePaid && payment.receiptId && (
                <span className="block text-[10px] font-mono font-normal text-slate-500 mt-0.5">
                  Ref: {payment.receiptId}
                </span>
              )}
            </strong>
          </div>
        )}

        {/* ---------------- WhatsApp confirmation status ---------------- */}
        <div
          className="pt-2.5 border-t border-slate-200 flex items-start gap-2 text-left"
          data-testid="whatsapp-confirmation-status"
        >
          <MessageSquare
            className={`w-4 h-4 shrink-0 mt-0.5 ${WHATSAPP_TONE[whatsapp.tone] ?? 'text-slate-500'}`}
          />
          <span className="text-[11px] leading-snug">
            <strong className={`block ${WHATSAPP_TONE[whatsapp.tone] ?? 'text-slate-600'}`}>
              {whatsapp.label}
            </strong>
            <span className="text-slate-600">{whatsapp.detail}</span>
          </span>
        </div>
      </div>

      {/* ---------------- Add to calendar ---------------- */}
      <div className="w-full flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDownloadIcs}
            disabled={!icsFile}
            className="flex-1 py-3 rounded-xl border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={icsFile ? 'Download a calendar file for this appointment' : 'This slot could not be added to a calendar'}
          >
            <CalendarPlus className="w-4 h-4" />
            <span>{calendarAdded ? 'Calendar file downloaded' : 'Add to Calendar'}</span>
          </button>
          <a
            href={googleCalendarUrl ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={!googleCalendarUrl}
            onClick={(event) => {
              if (!googleCalendarUrl) event.preventDefault();
            }}
            className={`py-3 px-4 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
              googleCalendarUrl ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed pointer-events-none'
            }`}
            title="Open this appointment in Google Calendar"
          >
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">Google</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {calendarError && (
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{calendarError}</span>
          </div>
        )}
      </div>

      {/* ---------------- Directions + WhatsApp ---------------- */}
      <div className="flex gap-2 w-full">
        <a
          href={directionsUrl ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
          aria-disabled={!directionsUrl}
          onClick={(event) => {
            if (!directionsUrl) event.preventDefault();
          }}
          className={`flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center justify-center gap-2 transition-opacity hover:opacity-90 ${
            directionsUrl ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed pointer-events-none'
          }`}
          title={directionsUrl ? 'Open directions in Google Maps' : 'No address is set for this salon yet'}
        >
          <Navigation className="w-4 h-4" />
          <span>Get Directions</span>
        </a>
        <button
          type="button"
          onClick={onSendWhatsapp}
          className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>{whatsapp.state === 'sent' ? 'Resend on WhatsApp' : 'Send on WhatsApp'}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ---------------- Rebook (only when the customer came from history) ----
          Replaces the generic "Book Another Service" action rather than sitting
          beside it: from history the customer wants the SAME service again, and
          two near-identical buttons invite the wrong tap. */}
      {fromHistory && onRebook && (
        <button
          type="button"
          onClick={onRebook}
          className="w-full py-3 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-opacity hover:opacity-90"
          style={{ backgroundColor: themeSafe(accentHex) }}
        >
          <History className="w-4 h-4" />
          <span>Book this service again</span>
        </button>
      )}

      {/* ---------------- Bottom actions ---------------- */}
      <div className="flex gap-2 w-full pt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer"
        >
          Done / Close
        </button>
        {/* The Rebook CTA already covers "start another booking" from history. */}
        {!(fromHistory && onRebook) && onBookAnother && (
          <button
            type="button"
            onClick={onBookAnother}
            className="flex-1 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-xs cursor-pointer hover:opacity-90"
            style={{ backgroundColor: themeSafe(accentHex) }}
          >
            Book Another Service
          </button>
        )}
      </div>
    </motion.div>
  );
};

/** `undefined` would silently drop the accent; fall back to the default ink. */
function themeSafe(hex?: string): string {
  return typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim()) ? hex.trim() : '#0f172a';
}
