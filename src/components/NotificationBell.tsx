import { supabase } from '../lib/supabaseClient';
import { authenticatedBookingRead } from '../lib/authenticatedBookingRead';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Owner notification bell.
 *
 * Previously every failure was invisible: a failed fetch left the panel empty
 * ("No notifications yet"), and marking as read cleared the badge locally even
 * when the server rejected the update — so the badge silently reappeared on the
 * next poll. Polling also ran every 3 s forever against a failing endpoint.
 */
export const NotificationBell = ({ userEmail }: { userEmail: string }) => {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string>('');
  const mountedRef = useRef(true);
  const failureCountRef = useRef(0);
  const generationRef = useRef(0);

  const fetchNotifications = useCallback(async () => {
    if (!userEmail) return;
    const generation = generationRef.current;
    try {
      const res = await authenticatedBookingRead(supabase.auth, '/api/notifications');
      const json = await res.json().catch(() => null);
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (!res.ok || !json || json.success === false) {
        failureCountRef.current += 1;
        if (mountedRef.current) {
          setError(json?.error || `Notifications unavailable (HTTP ${res.status}).`);
        }
        return;
      }
      failureCountRef.current = 0;
      if (!mountedRef.current) return;
      const rows = Array.isArray(json.data) ? json.data : [];
      setError('');
      setNotifications(rows);
      setUnreadCount(rows.filter((n: any) => !n.is_read).length);
    } catch (e: any) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      failureCountRef.current += 1;
      if (mountedRef.current) setError(e?.message ? `Notifications unavailable (${e.message}).` : 'Notifications unavailable.');
    }
  }, [userEmail]);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    failureCountRef.current = 0;
    setNotifications([]);
    setUnreadCount(0);
    setError('');
    setIsOpen(false);
    if (!userEmail) return () => { mountedRef.current = false; generationRef.current++; };

    // 3s while healthy, exponential backoff (max 60s) while failing.
    let timer: any;
    const schedule = () => {
      const delay = failureCountRef.current > 0
        ? Math.min(3000 * Math.pow(2, Math.min(failureCountRef.current, 5)), 60000)
        : 3000;
      timer = setTimeout(async () => {
        await fetchNotifications();
        if (mountedRef.current && generation === generationRef.current) schedule();
      }, delay);
    };
    void fetchNotifications().then(() => {
      if (mountedRef.current && generation === generationRef.current) schedule();
    });

    return () => {
      mountedRef.current = false;
      generationRef.current++;
      clearTimeout(timer);
    };
  }, [fetchNotifications]);

  const markAsRead = async () => {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening && unreadCount > 0) {
      // Optimistically clear, but roll back (and say why) if the server refused.
      const generation = generationRef.current;
      const previous = notifications;
      const previousUnread = unreadCount;
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sign in to update your notifications.');
        const res = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ email: userEmail })
        });
        const json = await res.json().catch(() => null);
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (!res.ok || !json || json.success === false) {
          setNotifications(previous);
          setUnreadCount(previousUnread);
          setError(json?.error || `Could not mark notifications as read (HTTP ${res.status}).`);
        }
      } catch (e: any) {
        if (!mountedRef.current || generation !== generationRef.current) return;
        setNotifications(previous);
        setUnreadCount(previousUnread);
        setError(e?.message ? `Could not mark notifications as read (${e.message}).` : 'Could not mark notifications as read.');
      }
    }
  };

  return (
    <div className="relative">
      <button onClick={markAsRead} className="relative p-2 rounded-full hover:bg-slate-100 transition-colors">
        <Bell className="w-5 h-5 text-slate-700" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white"></span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-2"
          >
            <div className="font-bold text-sm text-slate-800 p-2 border-b border-slate-100 mb-2">Notifications</div>
            {error && (
              <div className="mx-2 mb-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                {error}
              </div>
            )}
            {notifications.length === 0 ? (
              <div className="text-xs text-slate-500 p-4 text-center">
                {error ? 'Notifications could not be loaded.' : 'No notifications yet.'}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {notifications.map((n) => (
                  <div key={n.id} className={`p-3 rounded-xl text-xs flex flex-col gap-1 ${n.is_read ? 'bg-white' : 'bg-blue-50/50 font-medium'}`}>
                    <div className="font-bold text-slate-900">{n.title}</div>
                    <div className="text-slate-600">{n.message}</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
