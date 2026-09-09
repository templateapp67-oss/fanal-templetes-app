import { supabase } from '../lib/supabaseClient';
import { authenticatedBookingRead } from '../lib/authenticatedBookingRead';
import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Check, X, AlertCircle } from 'lucide-react';
import { BookingStatusBadge } from './BookingStatusBadge';

/**
 * Customer-facing view of a single booking (the "manage my booking" link).
 *
 * Every failure used to be swallowed: a missing/failed fetch rendered *nothing*
 * (`return null`), and accepting a proposed time optimistically flipped the
 * local state even when the API rejected the change — so the customer believed
 * a slot was confirmed that the salon never saw.
 */
export const CustomerBookingPortal = ({ bookingId }: { bookingId: string }) => {
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [pendingAction, setPendingAction] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const fetchBooking = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const res = await authenticatedBookingRead(supabase.auth, `/api/bookings/${encodeURIComponent(bookingId)}`);
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json || json.success === false) {
          setLoadError(
            json?.error ||
              (res.status === 404
                ? 'We could not find this booking. Please check the link from your confirmation message.'
                : `This booking could not be loaded (HTTP ${res.status}).`)
          );
          return;
        }
        setBooking(json.data);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ? `Network error: ${e.message}` : 'Network error while loading your booking.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (bookingId) {
      fetchBooking();
    } else {
      setLoading(false);
      setLoadError('No booking reference was provided.');
    }
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const handleAction = async (status: string) => {
    setActionError('');
    setPendingAction(status);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in to update your booking.');
      const res = await fetch('/api/bookings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: bookingId, status })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        setActionError(
          json?.error || `We couldn't update your booking (HTTP ${res.status}). Please contact the salon directly.`
        );
        return;
      }
      // Use the row the server actually stored (it also promotes a proposed
      // slot into booking_date/time_slot when the customer accepts).
      setBooking(json.data || ((prev: any) => ({ ...prev, status })));
    } catch (e: any) {
      setActionError(e?.message ? `Network error: ${e.message}` : 'Network error — please contact the salon directly.');
    } finally {
      setPendingAction('');
    }
  };

  if (loading) return <div className="p-4 text-xs text-slate-500">Loading your booking…</div>;
  if (loadError) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl max-w-md mx-auto mt-4 text-xs text-rose-800 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{loadError}</span>
      </div>
    );
  }
  if (!booking) return null;

  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl max-w-md mx-auto mt-4 shadow-sm">
      <h3 className="font-bold text-blue-900 mb-2">Customer View (Demo)</h3>
      <p className="text-xs text-blue-800 mb-4">Hello {booking.customer_name}, here is your booking update.</p>
      
      <div className="bg-white p-3 rounded-lg border border-blue-100 mb-4 text-xs">
        <div className="font-bold mb-1">{booking.service_name}</div>
        
        {booking.status === 'reschedule_proposed' ? (
          <>
            <p className="text-rose-600 font-bold mb-2">The salon proposed a new time for your booking.</p>
            <div className="flex gap-4">
              <div className="line-through text-slate-400">
                <div>Old Date: {booking.booking_date}</div>
                <div>Old Time: {booking.time_slot}</div>
              </div>
              <div className="font-bold text-emerald-700">
                <div>New Date: {booking.proposed_date}</div>
                <div>New Time: {booking.proposed_time_slot}</div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-slate-700 pt-1">Status:</span>
            {/* Shared badge: this used to print the raw column value, so a
                no-show or a completed visit showed as "NO_SHOW" / "COMPLETED"
                with no explanation of what the customer should do next. */}
            <BookingStatusBadge status={booking.status} withDescription />
          </div>
        )}
      </div>

      {actionError && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {booking.status === 'reschedule_proposed' && (
        <div className="flex gap-2">
          <button
            disabled={!!pendingAction}
            onClick={() => handleAction('cancelled')}
            className="flex-1 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-1 hover:bg-slate-50 disabled:opacity-40"
          >
            <X className="w-4 h-4" /> {pendingAction === 'cancelled' ? 'Sending…' : 'Reject'}
          </button>
          <button
            disabled={!!pendingAction}
            onClick={() => handleAction('confirmed')}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1 hover:bg-emerald-700 disabled:opacity-40"
          >
            <Check className="w-4 h-4" /> {pendingAction === 'confirmed' ? 'Confirming…' : 'Accept New Time'}
          </button>
        </div>
      )}
    </div>
  );
};
