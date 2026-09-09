import { authenticatedBookingRead, BookingSessionError } from '../lib/authenticatedBookingRead';
import { supabase } from '../lib/supabaseClient';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Check,
  X,
  Calendar as CalendarIcon,
  Clock,
  Edit2,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  CircleCheckBig,
  UserX,
  UserCheck,
  ScanLine,
} from 'lucide-react';
import { CustomerBookingPortal } from './CustomerBookingPortal';
import { BookingStatusBadge } from './BookingStatusBadge';

interface BookingManagerProps {
  primaryAccentColor: string;
  /** Owner (auth user) id — the live booking list is scoped to this salon. */
  ownerId?: string | null;
  /** Fallback scope when the owner id isn't known yet. */
  subdomain?: string | null;
  isAuthenticated?: boolean;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
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
export const BookingManager = ({
  primaryAccentColor,
  ownerId,
  subdomain,
  isAuthenticated = true,
  onRequireAuth,
}: BookingManagerProps) => {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [demoCustomerId, setDemoCustomerId] = useState<string | null>(null);
  const [passInput, setPassInput] = useState('');
  const [checkinBusy, setCheckinBusy] = useState<string | null>(null);
  const [checkinFeedback, setCheckinFeedback] = useState<{ tone: 'ok' | 'warn'; lines: string[] } | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const mountedRef = useRef(true);
  const failureCountRef = useRef(0);
  const readControllerRef = useRef<AbortController | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const sessionBlockedRef = useRef(false);

  const scopeQuery = ownerId
    ? `?owner_id=${encodeURIComponent(ownerId)}`
    : subdomain
      ? `?subdomain=${encodeURIComponent(subdomain)}`
      : '';

  const fetchBookings = useCallback(async () => {
    if (!isAuthenticated) return;
    readControllerRef.current?.abort();
    const controller = new AbortController();
    readControllerRef.current = controller;
    try {
      const res = await authenticatedBookingRead(supabase.auth, `/api/bookings${scopeQuery}`, ownerId, fetch, controller.signal);
      const text = await res.text();
      if (!mountedRef.current || controller.signal.aborted) return;
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* Report invalid responses below. */ }
      if (!res.ok || !json || json.success === false) {
        failureCountRef.current += 1;
        setLoadError(json?.error || `The booking service returned HTTP ${res.status}.`);
        return;
      }
      failureCountRef.current = 0;
      sessionBlockedRef.current = false;
      setNeedsLogin(false);
      setLoadError('');
      setBookings(Array.isArray(json.data) ? json.data : []);
      setLastSyncedAt(Date.now());
    } catch (error: any) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (error instanceof BookingSessionError) {
        sessionBlockedRef.current = true;
        setNeedsLogin(true);
        setBookings([]);
        setLastSyncedAt(null);
      }
      failureCountRef.current += 1;
      setLoadError(error?.message || 'Could not reach the booking service.');
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, [scopeQuery, ownerId, isAuthenticated]);

  useEffect(() => {
    mountedRef.current = true;
    setBookings([]);
    setLastSyncedAt(null);
    setNeedsLogin(false);
    setLoadError('');
    sessionBlockedRef.current = false;
    failureCountRef.current = 0;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    if (isAuthenticated) {
      setLoading(true);
      const poll = async () => {
        if (!sessionBlockedRef.current) await fetchBookings();
        if (disposed) return;
        const delay = Math.min(3000 * Math.pow(2, Math.min(failureCountRef.current, 5)), 60000);
        timer = setTimeout(poll, delay);
      };
      void poll();
    } else {
      setLoading(false);
    }
    return () => {
      disposed = true;
      mountedRef.current = false;
      clearTimeout(timer);
      readControllerRef.current?.abort();
    };
  }, [fetchBookings, isAuthenticated]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && sessionBlockedRef.current) {
        sessionBlockedRef.current = false;
        // Auth callbacks must not await another auth call while the SDK lock is held.
        setTimeout(() => { if (mountedRef.current) void fetchBookings(); }, 0);
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchBookings]);

  /** Salon check-in — by pass code or by booking row (see server/bookingCheckin.ts). */
  const handleCheckIn = async (target: { code?: string; bookingId?: string }) => {
    const busyKey = target.bookingId || 'code';
    setCheckinBusy(busyKey);
    setCheckinFeedback(null);
    setActionError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in to check in this booking.');
      const res = await fetch(`/api/bookings/check-in${scopeQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(target.code ? { code: target.code } : { booking_id: target.bookingId }),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok || !json?.success) {
        const message = json?.error || (text ? `HTTP ${res.status} — ${text.slice(0, 160)}` : `HTTP ${res.status}`);
        setCheckinFeedback({ tone: 'warn', lines: [message] });
        return;
      }
      const data = json.data || {};
      const credits: any[] = data.credits || [];
      const lines: string[] = [];
      if (json.duplicate) {
        lines.push('Already checked in today — nothing was changed.');
      } else {
        const who = data.booking?.customer_name ? ` for ${data.booking.customer_name}` : '';
        lines.push(`Checked in${who} — ${data.booking?.service_name || 'appointment'} at ${data.booking?.time_slot || ''}.`);
      }
      for (const credit of credits) {
        if (credit.status === 'credited') lines.push(`+${credit.points} points — ${credit.label}.`);
        else if (credit.status === 'planned') lines.push(`${credit.label} would earn ${credit.points} points (no ledger in demo mode).`);
        else if (credit.reason) lines.push(`${credit.label} skipped — ${credit.reason}`);
      }
      if (json.notice && !lines.some((line) => line === json.notice)) lines.push(json.notice);
      setCheckinFeedback({ tone: json.duplicate ? 'warn' : 'ok', lines: lines.length ? lines : ['Checked in.'] });
      setPassInput('');
      void fetchBookings();
    } catch (err: any) {
      setCheckinFeedback({ tone: 'warn', lines: [err?.message || 'Check-in failed. Please try again.'] });
    } finally {
      setCheckinBusy(null);
    }
  };

  /** Only today's open rows can be checked in (the API enforces this too). */
  const isCheckinableRow = (b: any) =>
    ['pending', 'confirmed', 'reschedule_proposed', 'reschedule_requested'].includes(String(b?.status)) &&
    String(b?.booking_date) === new Date().toLocaleDateString('en-CA');

  /** Whether the code the receptionist pasted is non-empty and plausible. */
  const hasPassInput = /^fanal[-\s]?[A-Za-z0-9_-]+$/i.test(String(passInput).trim().replace(/\s+/g, ''));

  const handleUpdateStatus = async (id: string, status: string, proposedDate?: string, proposedTime?: string) => {
    if (!isAuthenticated) {
      onRequireAuth?.('login');
      return;
    }
    setActionError('');
    setUpdatingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in to update this booking.');
      const res = await fetch('/api/bookings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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

  if (!isAuthenticated || needsLogin) return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-bold">Sign in to view your bookings</h2>
      <p className="my-3 text-sm">{needsLogin ? loadError : 'Your saved bookings are available after signing in.'}</p>
      <button type="button" onClick={() => onRequireAuth?.('login')} className="rounded-lg bg-pink-700 px-4 py-2 text-white">Sign in</button>
    </div>
  );

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

        {checkinFeedback && (
          <div
            className={`mb-4 flex items-start gap-2 p-3 rounded-xl border text-xs ${
              checkinFeedback.tone === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {checkinFeedback.lines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 p-4 rounded-2xl border border-slate-200 bg-slate-50/60">
          <div className="flex items-center gap-2 mb-2">
            <ScanLine className="w-4 h-4 text-slate-500" />
            <h3 className="text-xs font-mono-caps font-bold text-slate-700 uppercase tracking-wider">Salon check-in</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            The customer shows their Salon pass (QR or code) on the customer app. Paste or type the{' '}
            <span className="font-mono font-bold">FANAL-…</span> code here — the pass resolves to their account, so today's
            open booking is checked in and the configured visit bonuses (birthday / referral) are credited.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={passInput}
              onChange={(event) => setPassInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && hasPassInput && checkinBusy !== 'code') handleCheckIn({ code: passInput });
              }}
              placeholder="FANAL-…"
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="button"
              disabled={!hasPassInput || checkinBusy !== null}
              onClick={() => handleCheckIn({ code: passInput })}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              <UserCheck className="w-4 h-4" />
              {checkinBusy === 'code' ? 'Checking in…' : 'Check in'}
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
                    {/* Shared badge. The inline ternary this replaced had a
                        catch-all `else` that painted BOTH `completed` and
                        `cancelled` red, so a finished job looked identical to
                        a cancellation, and `no_show` had no branch at all. */}
                    <BookingStatusBadge status={b.status} compact />
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
                        <button
                          onClick={() => {
                            if (!isAuthenticated) {
                              onRequireAuth?.('login');
                              return;
                            }
                            setSelectedBooking(b);
                          }}
                          className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          title={!isAuthenticated ? 'Log in to suggest new time' : 'Suggest New Time'}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {isCheckinableRow(b) && (
                          <button
                            disabled={checkinBusy !== null || updatingId === b.id}
                            onClick={() => handleCheckIn({ bookingId: b.id })}
                            className="p-1.5 bg-violet-100 text-violet-700 rounded hover:bg-violet-200 disabled:opacity-40"
                            title="Check in — customer arrived today"
                          >
                            {checkinBusy === b.id ? <span className="block w-4 h-4 animate-pulse rounded-full bg-violet-300" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    )}
                    {b.status === 'confirmed' && (
                      <div className="flex items-center justify-end gap-2">
                        {isCheckinableRow(b) && (
                          <button
                            disabled={checkinBusy !== null || updatingId === b.id}
                            onClick={() => handleCheckIn({ bookingId: b.id })}
                            className="p-1.5 bg-violet-100 text-violet-700 rounded hover:bg-violet-200 disabled:opacity-40"
                            title="Check in — customer arrived today (credits visit bonuses)"
                          >
                            {checkinBusy === b.id ? <span className="block w-4 h-4 animate-pulse rounded-full bg-violet-300" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                        )}
                        <button disabled={updatingId === b.id} onClick={() => handleUpdateStatus(b.id, 'completed')} className="p-1.5 bg-sky-100 text-sky-700 rounded hover:bg-sky-200 disabled:opacity-40" title="Mark Completed">
                          <CircleCheckBig className="w-4 h-4" />
                        </button>
                        {/* No-show is NOT a cancellation: the customer never
                            arrived, so the advance is forfeited rather than
                            refunded. It needs its own action. */}
                        <button disabled={updatingId === b.id} onClick={() => handleUpdateStatus(b.id, 'no_show')} className="p-1.5 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 disabled:opacity-40" title="Mark No-show">
                          <UserX className="w-4 h-4" />
                        </button>
                        <button disabled={updatingId === b.id} onClick={() => handleUpdateStatus(b.id, 'cancelled')} className="p-1.5 bg-rose-100 text-rose-700 rounded hover:bg-rose-200 disabled:opacity-40" title="Cancel">
                          <X className="w-4 h-4" />
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
