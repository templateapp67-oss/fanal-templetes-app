import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

/** Non-blocking confirmation, with persistent inline feedback at the action. */
export function PartnerToast({ message, noticeId = 0 }: { message: string; noticeId?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(Boolean(message));
    if (!message) return;
    const timer = window.setTimeout(() => setVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [message, noticeId]);
  if (!message || !visible) return null;
  return <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-slate-800 shadow-lg sm:max-w-sm">
    <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-600" />
    <p className="min-w-0 break-words">{message}</p>
    <button type="button" aria-label="Dismiss notification" onClick={() => setVisible(false)} className="-m-2 ml-0 min-h-11 min-w-11 rounded-xl p-3 hover:bg-slate-100"><X className="h-4 w-4" /></button>
  </div>;
}
