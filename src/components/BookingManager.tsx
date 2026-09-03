import React, { useState, useEffect } from 'react';
import { Check, X, Calendar as CalendarIcon, Clock, Edit2, ExternalLink } from 'lucide-react';
import { CustomerBookingPortal } from './CustomerBookingPortal';

export const BookingManager = ({ primaryAccentColor }: { primaryAccentColor: string }) => {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [demoCustomerId, setDemoCustomerId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');

  const fetchBookings = async () => {
    try {
      const res = await fetch('/api/bookings');
      const json = await res.json();
      if (json.success) {
        setBookings(json.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
    
    const interval = setInterval(() => {
      fetchBookings();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleUpdateStatus = async (id: string, status: string, proposedDate?: string, proposedTime?: string) => {
    try {
      await fetch('/api/bookings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, proposed_date: proposedDate, proposed_time_slot: proposedTime })
      });
      fetchBookings();
      setSelectedBooking(null);
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return <div className="p-4">Loading bookings...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <h2 className="font-display font-bold text-lg mb-4">Live Booking Requests (Supabase)</h2>
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
                <tr><td colSpan={6} className="py-4 text-center text-slate-500">No bookings found in Supabase.</td></tr>
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
                        <button onClick={() => handleUpdateStatus(b.id, 'confirmed')} className="p-1.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200" title="Confirm">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleUpdateStatus(b.id, 'cancelled')} className="p-1.5 bg-rose-100 text-rose-700 rounded hover:bg-rose-200" title="Reject">
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
              <button onClick={() => handleUpdateStatus(selectedBooking.id, 'reschedule_proposed', newDate, newTime)} className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold">Send Proposal</button>
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
