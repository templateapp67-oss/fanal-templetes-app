import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const NotificationBell = ({ userEmail }: { userEmail: string }) => {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = async () => {
    try {
      const res = await fetch(`/api/notifications?email=${encodeURIComponent(userEmail)}`);
      const json = await res.json();
      if (json.success) {
        setNotifications(json.data);
        setUnreadCount(json.data.filter((n: any) => !n.is_read).length);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchNotifications();

    const interval = setInterval(() => {
      fetchNotifications();
    }, 3000);

    return () => clearInterval(interval);
  }, [userEmail]);

  const markAsRead = async () => {
    setIsOpen(!isOpen);
    if (!isOpen && unreadCount > 0) {
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail })
        });
        setUnreadCount(0);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      } catch (e) {
        console.error(e);
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
            {notifications.length === 0 ? (
              <div className="text-xs text-slate-500 p-4 text-center">No notifications yet.</div>
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
