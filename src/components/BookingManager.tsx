import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, Calendar as CalendarIcon, Clock, Edit2, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import { CustomerBookingPortal } from './CustomerBookingPortal';

interface BookingManagerProps {
  primaryAccentColor: string;
  /** Owner (auth user) id — the live booking list is scoped to this salon. */
  ownerId?: string | null;
  /** Fallback scope when the owner id isn't known yet. */
  subdomain?: string | null;
}

/**
 * Live booking requests.
 *
 * Previously this component ignored `res.ok` and `json.success === false`
 * entirely: a database outage, an RLS rejection or an HTML error page all
 * rendered as a cheerful "No bookings found in Supabase." while the salon
 * silently missed real customers. It also polled every 3 s forever, hammering
 * a failing endpoint. Now failures are shown, polling backs off while the API
 * is unhealthy, and status updates report whether they actually persisted.
 */
export const BookingManager = ({ primaryAccentColor, ownerId, subdomain }: BookingManagerProps) => {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [demoCustomerId, setDemoCustomerId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const mountedRef = useRef(true);
  const failureCountRef = useRef(0);

  const scopeQuery = ownerId
    ? `?owner_id=${encodeURIComponent(ownerId)}`
    : subdomain
      ? `?subdomain=${encodeURIComponent(subdomain)}`
      : '';

  const fetchBookings = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings${scopeQuery}`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json || json.success === false) {
        const detail =
          json?.error ||
          (text ? `HTTP ${res.status} — ${text.slice(0, 120)}` : `HTTP ${res.status} ${res.statusText}`);
        failureCountRef.current += 1;
        if (mountedRef.current) setLoadError(detail);
        return;
      }

      failureCountRef.current = 0;
      if (!mountedRef.current) return;
      setLoadError('');
      setBookings(Array.isArray(json.data) ? json.data : []);
      setLastSyncedAt(Date.now());
    } catch (e: any) {
      failureCountRef.current += 1;
      if (mountedRef.current) {
        setLoadError(e?.message ? `Could not reach the booking service (${e.message}).` : 'Could not reach the booking service.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [scopeQuery]);

  useEffect(() => {
    mountedRef.current = true;
    fetchBookings();

    // Poll every 3s while healthy; back off (up to 60s) while the API is
    // failing so a broken endpoint isn't hammered 20x a minute.
    let timer: any;
    const schedule = () => {
      const backoff = Math.min(3000 * Math.pow(2, Math.min(failureCountRef.current, 5)), 60000);
      timer = setTimeout(async () => {
        await fetchBookings();
        if (mountedRef.current) schedule();
      }, failureCountRef.current > 0 ? backoff : 3000);
    };
    schedule();

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, [fetchBookings]);

  const handleUpdateStatus = async (id: string, status: string, proposedDate?: string, proposedTime?: string) => {
    setActionError('');
    setUpdatingId(id);
    try {
      const res = await fetch('/api/bookings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, proposed_date: proposedDate, proposed_time_slot: proposedTime })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        // The old code assumed success and refreshed, so a rejected update just
        // looked like "nothing happened".
        setActionError(
          json?.error || `The booking could not be updated (HTTP ${res.status}). Please try again.`
        );
        return;
      }
      setSelectedBooking(null);
      await fetchBookings();
    } catch (e: any) {
      setActionError(e?.message ? `Update failed: ${e.message}` : 'Update failed — the booking service is unreachable.');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) return <div className="p-4">Loading bookings...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-display font-bold text-lg">Live Booking Requests (Supabase)</h2>
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            {lastSyncedAt && !loadError && <span>Synced {new Date(lastSyncedAt).toLocaleTimeString()}</span>}
            <button
              type="button"
              onClick={() => { failureCountRef.current = 0; fetchBookings(); }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold"
              title="Refresh now"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Live bookings could not be loaded.</strong> {loadError}
              {' '}The list below may be out of date — it is not proof that no one booked.
            </span>
          </div>
        )}

        {actionError && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-mono-caps">
                <th className="py-3 px-2">Customer</th>
                <th className="py-3 px-2">Service</th>
                <th className="py-3 px-2">Status</th>
                <th className="py-3 px-2">Date & Time</th>
                <th className="py-3 px-2">Payment</th>
                <th className="py-3 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    {loadError ? 'Bookings are unavailable right now — see the error above.' : 'No bookings found in Supabase.'}
                  </td>
                </tr>
              )}
              {bookings.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-2">
                    <div className="font-bold">{b.customer_name}</div>
                    <div className="text-[10px] text-slate-500">{b.customer_phone}</div>
                  </td>
                  <td className="py-3 px-2">{b.service_name} (₹{b.total_amount})</td>
                  <td className="py-3 px-2">
                    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase
                      ${b.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                        b.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        b.status === 'reschedule_proposed' ? 'bg-blue-100 text-blue-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="py-3 px-2 font-mono">
                    {b.booking_date} at {b.time_slot}
                    {b.status === 'reschedule_proposed' && (
                      <div className="text-[10px] text-blue-600 font-bold mt-1">
                        Proposed: {b.proposed_date} @ {b.proposed_time_slot}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-2 font-mono text-[10px]">
                    {b.payment_status}
                    {b.advance_paid_amount > 0 && <div className="text-emerald-600">Paid: ₹{b.advance_paid_amount}</div>}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {b.status === 'pending' && (
                      <div className="flex items-center justify-end gap-2">
                        <button disabled={updatingId === b.id} onClick={() => handleUpdateStatus(b.id, 'confirmed')} className="p-1.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 disabled:opacity-40" title="Confirm">
                          <Check className="w-4 h-4" />
                        </button>
                        <button disabled={updatingId === b.id} onClick={() => handleUpdateStatus(b.id, 'cancelled')} className="p-1.5 bg-rose-100 text-rose-700 rounded hover:bg-rose-200 disabled:opacity-40" title="Reject">
                          <X className="w-4 h-4" />
                        </button>
                        <button onClick={() => setSelectedBooking(b)} className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200" title="Suggest New Time">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {b.status === 'reschedule_proposed' && (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] text-slate-500">Waiting for customer...</span>
                        <button onClick={() => setDemoCustomerId(b.id)} className="text-[10px] flex items-center gap-1 text-blue-600 underline">
                          <ExternalLink className="w-3 h-3" /> Test Customer View
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-bold text-lg mb-2">Suggest New Time</h3>
            <p className="text-xs text-slate-500 mb-4">Propose an alternative slot for {selectedBooking.customer_name}.</p>
            
            <div className="flex flex-col gap-3 mb-4">
              <div>
                <label className="text-xs font-bold block mb-1">New Date</label>
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">New Time</label>
                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setSelectedBooking(null)} className="flex-1 py-2 border rounded-xl text-xs font-bold">Cancel</button>
              <button
                disabled={!newDate || !newTime || updatingId === selectedBooking.id}
                onClick={() => handleUpdateStatus(selectedBooking.id, 'reschedule_proposed', newDate, newTime)}
                className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold disabled:opacity-40"
              >
                {updatingId === selectedBooking.id ? 'Sending…' : 'Send Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {demoCustomerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
            <button onClick={() => setDemoCustomerId(null)} className="absolute top-4 right-4 p-1 rounded bg-slate-100 hover:bg-slate-200">
              <X className="w-4 h-4 text-slate-500" />
            </button>
            <CustomerBookingPortal bookingId={demoCustomerId} />
          </div>
        </div>
      )}
    </div>
  );
};
