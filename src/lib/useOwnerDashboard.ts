import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { authenticatedBookingRead } from './authenticatedBookingRead';
import type { Appointment, ClientRecord, SalonService, Stylist } from '../types';

export function useOwnerDashboard(ownerId?: string, subdomain?: string) {
  const [data, setData] = useState<{ appointments: Appointment[]; clients: ClientRecord[]; hours?: any[]; services?: SalonService[]; stylists?: Stylist[]; loadedAt?: string }>({ appointments: [], clients: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const readVersion = useRef(0);
  const refresh = useCallback(async () => {
    if (!ownerId) return;
    const identity = generation.current, version = ++readVersion.current;
    try {
      const response = await authenticatedBookingRead(supabase.auth, `/api/owner/dashboard?subdomain=${encodeURIComponent(subdomain || '')}`, ownerId);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Bookings could not be loaded.');
      if (identity !== generation.current || version !== readVersion.current) return;
      setData(result); setError('');
    } catch (e: any) { if (identity === generation.current && version === readVersion.current) setError(e.message || 'Bookings could not be loaded.'); }
    finally { if (identity === generation.current && version === readVersion.current) setLoading(false); }
  }, [ownerId, subdomain]);
  useEffect(() => {
    generation.current++; setData({ appointments: [], clients: [] }); setLoading(!!ownerId); setError(ownerId ? '' : 'Sign in to load your dashboard.');
    void refresh();
    const timer = setInterval(refresh, 30000);
    const update = () => { void refresh(); };
    window.addEventListener('owner-bookings-changed', update);
    window.addEventListener('focus', update);
    return () => { generation.current++; clearInterval(timer); window.removeEventListener('owner-bookings-changed', update); window.removeEventListener('focus', update); };
  }, [refresh, ownerId]);
  const mutate = async (url: string, body: any) => {
    if (busy.current) throw new Error('An appointment is already being saved.');
    busy.current = true; setSaving(true);
    const identity = generation.current;
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (sessionError || !session || session.user.id !== ownerId) throw new Error('Sign in to save this appointment.');
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'The appointment could not be saved.');
      if (identity === generation.current) await refresh();
      window.dispatchEvent(new Event('owner-bookings-changed'));
    } finally { busy.current = false; setSaving(false); }
  };
  return { ...data, error, loading, saving, refresh,
    saveHours: (hours: any[]) => mutate('/api/owner/hours', { subdomain, hours }),
    create: (appointment: Appointment) => mutate('/api/owner/appointments', { ...appointment, subdomain, reference: appointment.id }),
    update: (id: string, status: string, date?: string, time?: string) => mutate('/api/bookings/update', { id, status, proposed_date: date, proposed_time_slot: time }),
  };
}

export function dashboardTotals(appointments: Appointment[], clients: ClientRecord[]) {
  const completed = appointments.filter(a => a.status === 'completed');
  const visitors = clients.filter(c => c.totalVisits > 0);
  return { revenue: completed.reduce((sum,a) => sum + a.servicePrice,0), bookings: appointments.length,
    repeatRate: visitors.length ? Math.round(100 * visitors.filter(c => c.totalVisits > 1).length / visitors.length) : null };
}
