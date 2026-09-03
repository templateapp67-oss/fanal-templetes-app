import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Check, X } from 'lucide-react';

export const CustomerBookingPortal = ({ bookingId }: { bookingId: string }) => {
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBooking = async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}`);
        const json = await res.json();
        if (json.success) {
          setBooking(json.data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    if (bookingId) fetchBooking();
  }, [bookingId]);

  const handleAction = async (status: string) => {
    try {
      await fetch('/api/bookings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookingId, status })
      });
      setBooking((prev: any) => ({ ...prev, status }));
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return <div>Loading...</div>;
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
          <div className="font-medium text-slate-700">
            Status: <span className="uppercase font-bold">{booking.status}</span>
          </div>
        )}
      </div>

      {booking.status === 'reschedule_proposed' && (
        <div className="flex gap-2">
          <button onClick={() => handleAction('cancelled')} className="flex-1 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-1 hover:bg-slate-50">
            <X className="w-4 h-4" /> Reject
          </button>
          <button onClick={() => handleAction('confirmed')} className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1 hover:bg-emerald-700">
            <Check className="w-4 h-4" /> Accept New Time
          </button>
        </div>
      )}
    </div>
  );
};
