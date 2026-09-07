import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarX, RefreshCw, AlertCircle, Loader2, ArrowRight, Inbox } from 'lucide-react';
import { getBookingAccessToken } from '../lib/bookingApi';
import {
  BOOKING_TABS,
  DEFAULT_TAB,
  groupBookingsByTab,
  isBookingTabId,
  toCustomerBookingCard,
  validateReview,
  type BookingTabId,
  type CustomerBookingCard,
} from '../lib/bookingTabs';
import { BookingCard } from './BookingCard';

/**
 * My Bookings — `/customer/bookings`.
 *
 * The list is fetched from `/api/bookings/mine`, which derives the customer from
 * the verified access token. It never accepts a customer id as a parameter: the
 * owner-scoped `/api/bookings` returns every customer of a salon, and widening
 * it would hand any caller anyone's booking history.
 *
 * Failures are shown rather than flattened into an empty list — "No bookings
 * yet" when the request failed would tell a customer with three appointments
 * that they have none.
 */

export interface MyBookingsPageProps {
  user?: { id?: string; email?: string } | null;
  /** Opens the existing login/signup flow. */
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  /** "Explore Salons" — takes the customer back to browsing. */
  onExploreSalons: () => void;
  /** Rebook: reopens the booking flow with this card's salon and service. */
  onRebook: (card: CustomerBookingCard) => void;
  /** Opens `/customer/booking/:bookingId` for this card. */
  onViewDetails?: (card: CustomerBookingCard) => void;
  accentHex?: string;
}

export const MY_BOOKINGS_EMPTY_TITLE = 'No bookings yet.';
export const MY_BOOKINGS_EMPTY_BODY = 'Find your next salon visit.';
export const MY_BOOKINGS_EXPLORE_CTA = 'Explore Salons';

/**
 * The account-level empty state, exported so its exact wording is covered by a
 * test rather than only ever being read by a customer with no bookings.
 */
export const MyBookingsEmptyState: React.FC<{
  onExploreSalons: () => void;
  accentHex?: string;
}> = ({ onExploreSalons, accentHex = '#C20E5A' }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className="text-center bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-14"
  >
    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
      <Inbox className="w-8 h-8 text-slate-400" />
    </div>
    <h2 className="text-lg font-bold text-slate-900">{MY_BOOKINGS_EMPTY_TITLE}</h2>
    <p className="text-sm text-slate-600 mt-1.5">{MY_BOOKINGS_EMPTY_BODY}</p>
    <button
      type="button"
      onClick={onExploreSalons}
      className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90"
      style={{ backgroundColor: accentHex }}
    >
      {MY_BOOKINGS_EXPLORE_CTA}
      <ArrowRight className="w-4 h-4" />
    </button>
  </motion.div>
);

export const MyBookingsPage: React.FC<MyBookingsPageProps> = ({
  user,
  onRequireAuth,
  onExploreSalons,
  onRebook,
  onViewDetails,
  accentHex = '#C20E5A',
}) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Initial tab from `?tab=` so a link can land on a specific list
  // (/customer/bookings?tab=completed). Read once, on mount, and ignored on the
  // server where there is no location to read.
  const [activeTab, setActiveTab] = useState<BookingTabId>(() =>
    typeof window === 'undefined'
      ? DEFAULT_TAB
      : tabFromQueryParam(new URLSearchParams(window.location.search).get('tab'))
  );
  const [busyId, setBusyId] = useState('');
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const signedIn = !!user?.id;

  const fetchBookings = useCallback(async () => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const token = await getBookingAccessToken(user);
      if (!token) {
        setLoadError('Your session has expired. Please sign in again to see your bookings.');
        onRequireAuth?.('login');
        return;
      }
      const res = await fetch('/api/bookings/mine', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setLoadError(json?.error || 'Please sign in to see your bookings.');
        onRequireAuth?.('login');
        return;
      }
      if (!res.ok || !json || json.success === false) {
        setLoadError(
          json?.error || `Your bookings could not be loaded (HTTP ${res.status}). Please try again.`
        );
        return;
      }
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (err: any) {
      setLoadError(err?.message ? `Network error: ${err.message}` : 'Your bookings could not be loaded.');
    } finally {
      setLoading(false);
    }
    // `onRequireAuth` is intentionally not a dependency: it is an inline arrow
    // at the call site, so including it would refetch on every parent render.
  }, [signedIn, user, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  const nowMs = Date.now();
  const cards = useMemo(() => rows.map((row) => toCustomerBookingCard(row, nowMs)), [rows, nowMs]);
  const grouped = useMemo(() => groupBookingsByTab(cards), [cards]);
  const visible = grouped[activeTab];
  const hasAnyBookings = cards.length > 0;

  const runAction = useCallback(
    async (card: CustomerBookingCard, path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusyId(card.id);
      setActionErrors((prev) => ({ ...prev, [card.id]: '' }));
      try {
        const token = await getBookingAccessToken(user);
        if (!token) {
          setActionErrors((prev) => ({ ...prev, [card.id]: 'Please sign in again to do that.' }));
          onRequireAuth?.('login');
          return false;
        }
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: card.id, ...body }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || json.success === false) {
          // The server explains *why* (already cancelled, window closed, not a
          // completed visit). Surfacing its words beats a generic failure.
          setActionErrors((prev) => ({
            ...prev,
            [card.id]: json?.error || `That did not work (HTTP ${res.status}). Please try again.`,
          }));
          return false;
        }
        setRows((prev) => prev.map((row) => (row.id === card.id ? { ...row, ...json.data } : row)));
        return true;
      } catch (err: any) {
        setActionErrors((prev) => ({
          ...prev,
          [card.id]: err?.message ? `Network error: ${err.message}` : 'Network error — please try again.',
        }));
        return false;
      } finally {
        setBusyId('');
      }
    },
    [user, onRequireAuth]
  );

  const handleCancel = useCallback(
    (card: CustomerBookingCard) => runAction(card, '/api/bookings/mine/cancel', {}),
    [runAction]
  );

  const handleSubmitReview = useCallback(
    async (card: CustomerBookingCard, rating: number, text: string) => {
      // Validate client-side too, so an obvious mistake never costs a round trip.
      const validation = validateReview({ status: card.status, rating, text });
      if (!validation.ok) return false;
      return runAction(card, '/api/bookings/mine/review', {
        rating: validation.rating,
        text: validation.text,
      });
    },
    [runAction]
  );

  // -------------------------------------------------------------------------
  // Not signed in
  // -------------------------------------------------------------------------
  if (!signedIn) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <CalendarX className="w-7 h-7 text-slate-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Sign in to see your bookings</h1>
          <p className="text-sm text-slate-600 mt-2">
            Your appointments are tied to your account, so we can only show them once you are signed in.
          </p>
          <button
            type="button"
            onClick={() => onRequireAuth?.('login')}
            className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90"
            style={{ backgroundColor: accentHex }}
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">My Bookings</h1>
        <p className="text-sm text-slate-600 mt-1">Every appointment you have made, in one place.</p>
      </header>

      {/* ---------------- Tabs ---------------- */}
      <div
        className="flex gap-1.5 p-1 bg-slate-100 rounded-2xl mb-6 overflow-x-auto"
        role="tablist"
        aria-label="Booking status"
      >
        {BOOKING_TABS.map((tab) => {
          const count = grouped[tab.id].length;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[7rem] px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                  isActive ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------------- Load failure ---------------- */}
      {loadError && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block mb-0.5">Your bookings could not be loaded.</strong>
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold underline cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your bookings…
        </div>
      )}

      {/* ---------------- Empty states ---------------- */}
      {!loading && !hasAnyBookings && (
        <MyBookingsEmptyState onExploreSalons={onExploreSalons} accentHex={accentHex} />
      )}

      {/* Has bookings, but none in this tab — say so instead of implying the
          account is empty. */}
      {!loading && hasAnyBookings && visible.length === 0 && (
        <div className="text-center bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-12">
          <h2 className="text-base font-bold text-slate-900">
            {BOOKING_TABS.find((tab) => tab.id === activeTab)?.emptyTitle}
          </h2>
          <p className="text-sm text-slate-600 mt-1.5 max-w-sm mx-auto">
            {BOOKING_TABS.find((tab) => tab.id === activeTab)?.emptyBody}
          </p>
          {activeTab !== 'upcoming' && (
            <button
              type="button"
              onClick={onExploreSalons}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer transition-colors"
            >
              {MY_BOOKINGS_EXPLORE_CTA}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ---------------- Cards ---------------- */}
      {!loading && visible.length > 0 && (
        <div className="flex flex-col gap-4">
          {visible.map((card) => (
            <BookingCard
              key={card.id}
              card={card}
              nowMs={nowMs}
              accentHex={accentHex}
              onCancel={handleCancel}
              onRebook={onRebook}
              onViewDetails={onViewDetails}
              onSubmitReview={handleSubmitReview}
              cancelling={busyId === card.id}
              submittingReview={busyId === card.id}
              actionError={actionErrors[card.id] || ''}
            />
          ))}
        </div>
      )}
    </main>
  );
};

/** Guard for reading `?tab=` so an unknown value cannot blank the page. */
export function tabFromQueryParam(value: unknown): BookingTabId {
  return isBookingTabId(value) ? value : DEFAULT_TAB;
}
