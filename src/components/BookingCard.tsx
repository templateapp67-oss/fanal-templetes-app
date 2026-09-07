import React, { useState } from 'react';
import {
  CalendarDays,
  Clock,
  MapPin,
  User,
  Star,
  RotateCcw,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  XCircle,
  AlertCircle,
  Check,
  Sparkles,
  Store,
  Loader2,
} from 'lucide-react';
import { BookingStatusBadge } from './BookingStatusBadge';
import { formatBookingDate, formatBookingTime, formatMoney } from '../lib/bookingConfirmation';
import { describeBookingStatus } from '../lib/bookingStatus';
import {
  canCancelBooking,
  canReview,
  MAX_REVIEW_LENGTH,
  type CustomerBookingCard,
} from '../lib/bookingTabs';

/**
 * One booking on the "My Bookings" page.
 *
 * Every action is gated by the booking's real state: a completed visit cannot be
 * cancelled, a past slot cannot be cancelled, and only a completed visit can be
 * reviewed. The gates come from `src/lib/bookingTabs.ts` — the same module the
 * API enforces — so the button can never offer something the server rejects.
 */

export interface BookingCardProps {
  card: CustomerBookingCard;
  nowMs: number;
  accentHex?: string;
  /** Resolves true when the cancellation persisted. */
  onCancel: (card: CustomerBookingCard) => Promise<boolean>;
  onRebook: (card: CustomerBookingCard) => void;
  /**
   * Opens `/customer/booking/:id`. When supplied, "View details" navigates to
   * the full detail page instead of expanding the inline panel — the page is a
   * superset of the panel, so offering both would be two ways to the same
   * place. Without it the card still works standalone and expands inline.
   */
  onViewDetails?: (card: CustomerBookingCard) => void;
  /** Resolves true when the review was saved. */
  onSubmitReview: (card: CustomerBookingCard, rating: number, text: string) => Promise<boolean>;
  cancelling?: boolean;
  submittingReview?: boolean;
  /** Per-card error from the last action, if any. */
  actionError?: string;
}

/** Initials for the salon tile when there is no image. */
function salonInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || 'S';
}

const DetailRow: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({
  icon,
  label,
  value,
}) => (
  <div className="flex items-start justify-between gap-3 text-xs">
    <span className="flex items-center gap-1.5 text-slate-500 shrink-0">{icon}{label}</span>
    <span className="font-semibold text-slate-800 text-right break-words">{value}</span>
  </div>
);

/**
 * The expandable "View details" panel, exported so its contents are covered by
 * a test — inside the card it only renders once expanded, so a server render
 * alone would never exercise it.
 */
export const BookingDetailsPanel: React.FC<{ card: CustomerBookingCard }> = ({ card }) => {
  const isHomeService = card.serviceAt === 'home';
  const cancelDecision = canCancelBooking({
    status: card.status,
    date: card.date,
    time: card.time,
    nowMs: Date.now(),
  });

  return (
    <div className="px-4 py-3.5 border-t border-slate-100 flex flex-col gap-2.5">
      {card.reference && (
        <DetailRow icon={<Sparkles className="w-3.5 h-3.5" />} label="Booking ID" value={card.reference} />
      )}
      <DetailRow
        icon={<MapPin className="w-3.5 h-3.5" />}
        label={isHomeService ? 'Service at' : 'Salon'}
        value={
          <>
            {isHomeService ? 'Home service' : card.salonName}
            {card.salonCity && (
              <span className="block text-[10px] font-normal text-slate-500">{card.salonCity}</span>
            )}
          </>
        }
      />
      <DetailRow
        icon={<Store className="w-3.5 h-3.5" />}
        label="Payment"
        value={
          card.advancePaid > 0
            ? `Advance ${formatMoney(card.advancePaid, card.currency)} paid · Balance ${formatMoney(
                card.totalAmount - card.advancePaid,
                card.currency
              )}`
            : `Pay at ${isHomeService ? 'home' : 'salon'}`
        }
      />
      {!cancelDecision.allowed && (
        <DetailRow
          icon={<AlertCircle className="w-3.5 h-3.5" />}
          label="Cancelling"
          value={<span className="font-normal">{cancelDecision.reason}</span>}
        />
      )}
      {card.reviewRating !== null && (
        <DetailRow icon={<Star className="w-3.5 h-3.5" />} label="Your review" value={`${card.reviewRating}/5 stars`} />
      )}
    </div>
  );
};

export const BookingCard: React.FC<BookingCardProps> = ({
  card,
  nowMs,
  accentHex = '#C20E5A',
  onCancel,
  onRebook,
  onViewDetails,
  onSubmitReview,
  cancelling = false,
  submittingReview = false,
  actionError = '',
}) => {
  const [expanded, setExpanded] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewError, setReviewError] = useState('');

  const statusDescriptor = describeBookingStatus(card.status);
  const cancelDecision = canCancelBooking({
    status: card.status,
    date: card.date,
    time: card.time,
    nowMs,
  });
  const reviewable = canReview(card);
  const reviewed = card.reviewRating !== null;
  const isHomeService = card.serviceAt === 'home';

  const handleReviewSubmit = async () => {
    setReviewError('');
    const saved = await onSubmitReview(card, rating, reviewText);
    if (!saved) {
      setReviewError('Your review could not be saved. Please try again.');
      return;
    }
    setReviewOpen(false);
    setReviewText('');
  };

  return (
    <article className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 flex gap-3.5">
        {/* Salon image (or initials when the salon has not uploaded one) */}
        <div className="shrink-0">
          {card.salonImageUrl ? (
            <img
              src={card.salonImageUrl}
              alt=""
              className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-slate-100"
              onError={(event) => {
                // A dead image URL must not leave a broken-icon square.
                (event.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-lg border border-slate-200"
              style={{ backgroundColor: accentHex }}
              aria-hidden="true"
            >
              {salonInitials(card.salonName)}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-sm text-slate-900 truncate">{card.salonName}</h3>
            <BookingStatusBadge status={card.status} compact />
          </div>

          <p className="text-xs text-slate-700 mt-1 font-medium truncate">{card.serviceName}</p>

          <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5 truncate">
              <User className="w-3 h-3 shrink-0" />
              {card.staffName}
            </span>
            <span className="flex items-center gap-1.5 truncate">
              <CalendarDays className="w-3 h-3 shrink-0" />
              {formatBookingDate(card.date) || 'Date to be confirmed'}
              <Clock className="w-3 h-3 shrink-0 ml-1" />
              {formatBookingTime(card.time) || '—'}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-900">
              {formatMoney(card.totalAmount, card.currency)}
            </span>
            {reviewed && (
              <span className="flex items-center gap-0.5 text-[11px] font-semibold text-amber-600">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                {card.reviewRating}/5 reviewed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* A stale booking the salon never closed should not look scheduled. */}
      {card.isPast && !statusDescriptor.isTerminal && (
        <div className="px-4 pb-2 -mt-1 flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            This slot has passed but the salon has not updated it yet. Contact them to confirm what happened.
          </span>
        </div>
      )}

      {actionError && (
        <div className="mx-4 mb-3 flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* ---------------- Actions ---------------- */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (onViewDetails ? onViewDetails(card) : setExpanded((prev) => !prev))}
          className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-[11px] font-bold flex items-center gap-1.5 hover:bg-slate-100 cursor-pointer transition-colors"
          aria-expanded={onViewDetails ? undefined : expanded}
        >
          {onViewDetails ? (
            <ArrowRight className="w-3.5 h-3.5" />
          ) : expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          View details
        </button>

        {cancelDecision.allowed && (
          <button
            type="button"
            onClick={() => void onCancel(card)}
            disabled={cancelling}
            className="px-3 py-2 rounded-xl border border-rose-300 bg-white text-rose-700 text-[11px] font-bold flex items-center gap-1.5 hover:bg-rose-50 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
            {cancelling ? 'Cancelling…' : 'Cancel booking'}
          </button>
        )}

        <button
          type="button"
          onClick={() => onRebook(card)}
          className="px-3 py-2 rounded-xl text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-90"
          style={{ backgroundColor: accentHex }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Rebook
        </button>

        {reviewable && (
          <button
            type="button"
            onClick={() => setReviewOpen((prev) => !prev)}
            className="px-3 py-2 rounded-xl border border-amber-300 bg-white text-amber-700 text-[11px] font-bold flex items-center gap-1.5 hover:bg-amber-50 cursor-pointer transition-colors"
            aria-expanded={reviewOpen}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {reviewOpen ? 'Close review' : 'Write a review'}
          </button>
        )}
      </div>

      {/* ---------------- Expanded details ---------------- */}
      {expanded && <BookingDetailsPanel card={card} />}

      {/* ---------------- Review form ---------------- */}
      {reviewOpen && (
        <div className="px-4 py-4 border-t border-slate-100 bg-amber-50/40">
          <p className="text-xs font-bold text-slate-800 mb-2">How was your visit?</p>

          <div className="flex items-center gap-1 mb-3" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} star${star > 1 ? 's' : ''}`}
                onClick={() => setRating(star)}
                className="p-1 cursor-pointer transition-transform hover:scale-110"
              >
                <Star
                  className={`w-6 h-6 ${
                    star <= rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                  }`}
                />
              </button>
            ))}
          </div>

          <textarea
            value={reviewText}
            onChange={(event) => setReviewText(event.target.value.slice(0, MAX_REVIEW_LENGTH))}
            rows={3}
            placeholder="Tell the salon what you liked (optional)"
            className="w-full p-2.5 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
          <div className="flex items-center justify-between mt-1 mb-3">
            <span className="text-[10px] text-slate-500">{reviewText.length}/{MAX_REVIEW_LENGTH}</span>
          </div>

          {reviewError && (
            <div className="mb-3 flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{reviewError}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer transition-colors"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => void handleReviewSubmit()}
              disabled={submittingReview}
              className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-amber-600 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submittingReview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {submittingReview ? 'Sending…' : 'Submit review'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
