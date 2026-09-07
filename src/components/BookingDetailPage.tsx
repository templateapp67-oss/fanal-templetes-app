import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarX,
  Clock,
  Gift,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  RefreshCw,
  Scissors,
  Star,
  User,
  Wallet,
} from 'lucide-react';
import { getBookingAccessToken } from '../lib/bookingApi';
import {
  resolveBookingDetailActions,
  toBookingDetailView,
  type BookingDetailActions,
  type BookingDetailView,
} from '../lib/bookingDetail';
import { formatBookingDate, formatBookingTime, formatMoney } from '../lib/bookingConfirmation';
import { MAX_REVIEW_LENGTH, validateReview } from '../lib/bookingTabs';
import { BookingStatusBadge } from './BookingStatusBadge';

/**
 * Booking detail page — `/customer/booking/:bookingId`.
 *
 * Reads `/api/bookings/mine/:id`, which authenticates the caller and checks the
 * booking belongs to them before returning it. The unauthenticated
 * `GET /api/bookings/:id` ("the uuid is the secret") is deliberately not used
 * here: it returns the raw row, so it would hand the phone number, email and
 * payment reference to anyone holding an id.
 */

export const BOOKING_DETAIL_LOAD_FAILED = 'This booking could not be loaded.';
export const BOOKING_DETAIL_NOT_FOUND =
  'We could not find that booking. It may belong to a different account.';

export interface BookingDetailPageProps {
  bookingId: string;
  user?: { id?: string; email?: string } | null;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  /** Back to the bookings list. */
  onBack: () => void;
  /** "Book again" — reopens the booking flow for this salon and service. */
  onRebook?: (view: BookingDetailView) => void;
  accentHex?: string;
}

// ---------------------------------------------------------------------------
// Presentational pieces (exported so SSR tests can reach them)
// ---------------------------------------------------------------------------

const DetailRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}> = ({ icon, label, children }) => (
  <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
    <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-bold font-mono-caps tracking-wider text-slate-400 mb-0.5">
        {label}
      </div>
      <div className="text-sm text-slate-800 break-words">{children}</div>
    </div>
  </div>
);

/**
 * The full details grid, rendered from the view model alone.
 *
 * Kept separate from the fetching shell so its contents — services, staff,
 * price, note, payment and reward wording — can be asserted server-side, where
 * no fetch has run.
 */
export const BookingDetailSummary: React.FC<{ view: BookingDetailView }> = ({ view }) => {
  const rewardTone =
    view.reward.state === 'earned'
      ? 'text-emerald-700'
      : view.reward.state === 'pending'
        ? 'text-amber-700'
        : 'text-slate-500';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-5 py-1">
      <DetailRow icon={<Scissors className="w-4 h-4" />} label="Services">
        <ul className="space-y-1">
          {view.services.map((service, index) => (
            <li key={`${service}-${index}`} className="font-medium text-slate-900">
              {service}
            </li>
          ))}
        </ul>
      </DetailRow>

      <DetailRow icon={<User className="w-4 h-4" />} label="Staff">
        {view.staffName}
      </DetailRow>

      <DetailRow icon={<Clock className="w-4 h-4" />} label="Date and time">
        {view.date ? formatBookingDate(view.date) : 'Date to be confirmed'}
        {view.time ? ` · ${formatBookingTime(view.time)}` : ''}
      </DetailRow>

      <DetailRow icon={<Wallet className="w-4 h-4" />} label="Price">
        <span className="font-bold text-slate-900">
          {formatMoney(view.totalAmount, view.currency)}
        </span>
        <span className="block text-xs text-slate-500 mt-0.5">
          {view.advancePaid > 0
            ? `Advance ${formatMoney(view.advancePaid, view.currency)} paid · Balance ${formatMoney(
                view.balanceDue,
                view.currency
              )}`
            : `No advance paid · ${formatMoney(view.balanceDue, view.currency)} due at the salon`}
        </span>
      </DetailRow>

      <DetailRow icon={<Wallet className="w-4 h-4" />} label="Payment status">
        {view.paymentStatus}
      </DetailRow>

      <DetailRow icon={<Gift className="w-4 h-4" />} label="Reward">
        <span className={`font-bold ${rewardTone}`}>{view.reward.label}</span>
        <span className="block text-xs text-slate-500 mt-0.5">{view.reward.detail}</span>
      </DetailRow>

      <DetailRow icon={<AlertCircle className="w-4 h-4" />} label="Your note to the salon">
        {view.customerNote ? (
          view.customerNote
        ) : (
          <span className="text-slate-400">No note was left.</span>
        )}
      </DetailRow>
    </div>
  );
};

/**
 * Direction · Contact salon · Cancel · Review.
 *
 * Cancel and Review are mutually exclusive by construction: `resolveBookingDetailActions`
 * only allows a cancel on a non-terminal, not-yet-started booking, and only
 * allows a review on a completed one.
 */
export const BookingDetailActionBar: React.FC<{
  view: BookingDetailView;
  actions: BookingDetailActions;
  accentHex?: string;
  cancelling?: boolean;
  reviewing?: boolean;
  actionError?: string;
  onCancel?: () => void;
  onStartReview?: () => void;
}> = ({
  view,
  actions,
  accentHex = '#C20E5A',
  cancelling = false,
  reviewing = false,
  actionError = '',
  onCancel,
  onStartReview,
}) => {
  // A reason is only worth showing when the booking is still live but its slot
  // has passed (or the salon requires notice). For a cancelled or completed
  // booking the status badge already says it.
  const isTerminal =
    view.status === 'cancelled' || view.status === 'completed' || view.status === 'no_show';
  const cancelReason = !actions.cancel.allowed && !isTerminal ? actions.cancel.reason : '';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-5 py-4">
      {actionError && (
        <div className="flex items-start gap-2 mb-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {actions.directionsUrl ? (
          <a
            href={actions.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50"
          >
            <Navigation className="w-4 h-4" />
            <span>Direction</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="This salon has not published a location yet"
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-slate-200 text-slate-300 text-xs font-bold cursor-not-allowed"
          >
            <Navigation className="w-4 h-4" />
            <span>Direction</span>
          </button>
        )}

        {actions.whatsappHref ? (
          <a
            href={actions.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Contact salon</span>
          </a>
        ) : actions.callHref ? (
          <a
            href={actions.callHref}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
          >
            <Phone className="w-4 h-4" />
            <span>Contact salon</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="This salon has not published a contact number"
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-slate-100 text-slate-300 text-xs font-bold cursor-not-allowed"
          >
            <Phone className="w-4 h-4" />
            <span>Contact salon</span>
          </button>
        )}
      </div>

      {actions.cancel.allowed && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50 disabled:opacity-60 cursor-pointer"
        >
          {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarX className="w-4 h-4" />}
          <span>{cancelling ? 'Cancelling…' : 'Cancel booking'}</span>
        </button>
      )}

      {cancelReason && (
        <p className="mt-2 text-[11px] text-slate-500 text-center">{cancelReason}</p>
      )}

      {actions.reviewable && (
        <button
          type="button"
          onClick={onStartReview}
          disabled={reviewing}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-white text-xs font-bold cursor-pointer transition-opacity hover:opacity-90"
          style={{ backgroundColor: accentHex }}
        >
          <Star className="w-4 h-4" />
          <span>Write a review</span>
        </button>
      )}

      {actions.reviewed && (
        <p className="mt-2 text-[11px] text-slate-500 text-center">
          You rated this visit {view.reviewRating} out of 5. Thank you.
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Review dialog
// ---------------------------------------------------------------------------

const ReviewDialog: React.FC<{
  view: BookingDetailView;
  accentHex: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (rating: number, text: string) => void;
}> = ({ view, accentHex, submitting, onClose, onSubmit }) => {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const validation = validateReview({ status: view.status, rating, text });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError('');
    onSubmit(validation.rating, validation.text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-5"
      >
        <h3 className="text-base font-bold text-slate-900">How was your visit?</h3>
        <p className="text-xs text-slate-500 mt-1">
          {view.services[0]} at {view.salonName}
        </p>

        <div className="flex items-center justify-center gap-2 py-5" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} star${star === 1 ? '' : 's'}`}
              onClick={() => {
                setRating(star);
                setError('');
              }}
              className="cursor-pointer p-1"
            >
              <Star
                className={`w-8 h-8 transition-colors ${
                  star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-300'
                }`}
              />
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_REVIEW_LENGTH))}
          rows={3}
          maxLength={MAX_REVIEW_LENGTH}
          placeholder="Tell the salon what stood out (optional)"
          className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-slate-900 outline-none resize-none"
        />

        {error && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl text-white text-xs font-bold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: accentHex }}
          >
            {submitting ? 'Saving…' : 'Submit review'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const BookingDetailPage: React.FC<BookingDetailPageProps> = ({
  bookingId,
  user,
  onRequireAuth,
  onBack,
  onRebook,
  accentHex = '#C20E5A',
}) => {
  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const signedIn = !!user?.id;

  const load = useCallback(async () => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const token = await getBookingAccessToken(user);
      if (!token) {
        setLoadError('Your session has expired. Please sign in again to see this booking.');
        onRequireAuth?.('login');
        return;
      }
      const res = await fetch(`/api/bookings/mine/${encodeURIComponent(bookingId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setLoadError(json?.error || 'Please sign in to see this booking.');
        onRequireAuth?.('login');
        return;
      }
      if (res.status === 404) {
        setLoadError(json?.error || BOOKING_DETAIL_NOT_FOUND);
        return;
      }
      if (!res.ok || !json || json.success === false) {
        setLoadError(json?.error || `${BOOKING_DETAIL_LOAD_FAILED} Please try again.`);
        return;
      }
      setPayload(json.data ?? null);
    } catch (err: any) {
      setLoadError(err?.message ? `Network error: ${err.message}` : BOOKING_DETAIL_LOAD_FAILED);
    } finally {
      setLoading(false);
    }
    // `onRequireAuth` is an inline arrow at the call site; depending on it
    // would refetch on every parent render.
  }, [signedIn, user, bookingId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo<BookingDetailView | null>(
    () =>
      payload?.booking
        ? toBookingDetailView({
            row: payload.booking,
            salon: payload.salon,
            loyalty: payload.loyalty,
          })
        : null,
    [payload]
  );

  const nowMs = Date.now();
  const actions = useMemo<BookingDetailActions | null>(
    () => (view ? resolveBookingDetailActions(view, nowMs) : null),
    [view, nowMs]
  );

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<any | null> => {
      setActionError('');
      const token = await getBookingAccessToken(user);
      if (!token) {
        setActionError('Your session has expired. Please sign in again.');
        onRequireAuth?.('login');
        return null;
      }
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        setActionError(json?.error || `Something went wrong (HTTP ${res.status}). Please try again.`);
        return null;
      }
      return json;
    },
    [user] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleCancel = useCallback(async () => {
    if (!view) return;
    setCancelling(true);
    try {
      const result = await post('/api/bookings/mine/cancel', { id: view.bookingId });
      if (result) setReloadKey((key) => key + 1);
    } catch (err: any) {
      setActionError(err?.message ? `Network error: ${err.message}` : 'This booking could not be cancelled.');
    } finally {
      setCancelling(false);
    }
  }, [view, post]);

  const handleSubmitReview = useCallback(
    async (rating: number, text: string) => {
      if (!view) return;
      setReviewing(true);
      try {
        const result = await post('/api/bookings/mine/review', { id: view.bookingId, rating, text });
        if (result) {
          setReviewOpen(false);
          setReloadKey((key) => key + 1);
        }
      } catch (err: any) {
        setActionError(err?.message ? `Network error: ${err.message}` : 'Your review could not be saved.');
      } finally {
        setReviewing(false);
      }
    },
    [view, post]
  );

  // ---- Shell: signed out / loading / failed --------------------------------

  if (!signedIn) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 mb-4 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to My Bookings</span>
        </button>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-12 text-center">
          <h2 className="text-lg font-bold text-slate-900">Sign in to view this booking</h2>
          <p className="text-sm text-slate-600 mt-1.5">
            Bookings are private to the account that made them.
          </p>
          <button
            type="button"
            onClick={() => onRequireAuth?.('login')}
            className="mt-5 px-6 py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90"
            style={{ backgroundColor: accentHex }}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading your booking</span>
        </div>
      </div>
    );
  }

  if (loadError || !view || !actions) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 mb-4 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to My Bookings</span>
        </button>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-slate-400" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            {loadError || BOOKING_DETAIL_LOAD_FAILED}
          </h2>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try again</span>
          </button>
        </div>
      </div>
    );
  }

  // ---- Loaded --------------------------------------------------------------

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to My Bookings</span>
      </button>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        {/* Salon header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="relative h-28 bg-slate-100">
            {view.salonImageUrl ? (
              <img
                src={view.salonImageUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <MapPin className="w-8 h-8 text-slate-300" />
              </div>
            )}
          </div>
          <div className="px-4 sm:px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-900 truncate">{view.salonName}</h1>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono">
                    Booking {view.reference || view.bookingId.slice(0, 8)}
                  </span>
                  {view.serviceAt === 'home' && (
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold">
                      At home
                    </span>
                  )}
                </p>
              </div>
              <BookingStatusBadge status={view.status} compact />
            </div>
            {view.address && (
              <p className="text-xs text-slate-500 mt-2 flex items-start gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{view.address}</span>
              </p>
            )}
          </div>
        </div>

        <BookingDetailSummary view={view} />

        <BookingDetailActionBar
          view={view}
          actions={actions}
          accentHex={accentHex}
          cancelling={cancelling}
          reviewing={reviewing}
          actionError={actionError}
          onCancel={() => void handleCancel()}
          onStartReview={() => setReviewOpen(true)}
        />

        {onRebook && (
          <button
            type="button"
            onClick={() => onRebook(view)}
            className="w-full py-3 rounded-2xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
          >
            Book this salon again
          </button>
        )}
      </motion.div>

      {reviewOpen && (
        <ReviewDialog
          view={view}
          accentHex={accentHex}
          submitting={reviewing}
          onClose={() => setReviewOpen(false)}
          onSubmit={(rating, text) => void handleSubmitReview(rating, text)}
        />
      )}
    </div>
  );
};
