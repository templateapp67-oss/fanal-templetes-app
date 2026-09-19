import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

// ============================================================================
// Partner TOAST CENTER — success / error / loading notifications for the
// partner forms (profile save, payout save, email change, 2FA, sessions,
// deactivation).
//
// Dependency-free by the same rule the rest of the portal follows (no router,
// no toast library): a module-level event bus + one mounted container. The API
// is deliberately toast-library-shaped so callers read the same either way:
//
//   showPartnerToast.success('Profile saved.');
//   showPartnerToast.error('Could not save your profile.');
//   const id = showPartnerToast.loading('Saving…'); … showPartnerToast.dismiss(id);
//   await showPartnerToast.promise(save(), { loading: 'Saving…', success: 'Saved.', error: 'Failed.' });
// ============================================================================

export type PartnerToastKind = 'success' | 'error' | 'loading';

export interface PartnerToastItem {
  id: number;
  kind: PartnerToastKind;
  message: string;
  /** Loading toasts persist until dismissed/replaced; the rest auto-hide. */
  sticky: boolean;
}

type Listener = (toasts: PartnerToastItem[]) => void;

let toasts: PartnerToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const timers = new Map<number, number>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function push(kind: PartnerToastKind, message: string): number {
  const id = nextId++;
  const sticky = kind === 'loading';
  toasts = [...toasts.filter((entry) => entry.id !== id), { id, kind, message, sticky }];
  if (!sticky) {
    const duration = kind === 'error' ? 8000 : 5000;
    timers.set(
      id,
      window.setTimeout(() => dismissPartnerToast(id), duration)
    );
  }
  emit();
  return id;
}

export function dismissPartnerToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  const before = toasts.length;
  toasts = toasts.filter((entry) => entry.id !== id);
  if (toasts.length !== before) emit();
}

/** Replace a loading toast's message/kind in place (keeps its position). */
function update(id: number, kind: PartnerToastKind, message: string): void {
  const timer = timers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.map((entry) => (entry.id === id ? { ...entry, kind, message, sticky: kind === 'loading' } : entry));
  if (kind !== 'loading') {
    const duration = kind === 'error' ? 8000 : 5000;
    timers.set(
      id,
      window.setTimeout(() => dismissPartnerToast(id), duration)
    );
  }
  emit();
}

export const showPartnerToast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  loading: (message: string) => push('loading', message),
  dismiss: dismissPartnerToast,
  /** Loading → success/error around a promise; the toast id is stable. */
  promise: async <T,>(
    work: Promise<T>,
    messages: { loading: string; success: string | ((value: T) => string); error: string | ((cause: unknown) => string) }
  ): Promise<T> => {
    const id = push('loading', messages.loading);
    try {
      const value = await work;
      update(id, 'success', typeof messages.success === 'function' ? messages.success(value) : messages.success);
      return value;
    } catch (cause) {
      const message = typeof messages.error === 'function' ? messages.error(cause) : messages.error;
      update(id, 'error', cause instanceof Error && cause.message ? cause.message : message);
      throw cause;
    }
  },
};

const KIND_STYLES: Record<PartnerToastKind, { icon: React.ReactNode; border: string; accent: string }> = {
  success: {
    icon: <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-600" />,
    border: 'border-emerald-200',
    accent: 'text-slate-800',
  },
  error: {
    icon: <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-rose-600" />,
    border: 'border-rose-200',
    accent: 'text-slate-800',
  },
  loading: {
    icon: <Loader2 aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-slate-500 motion-reduce:animate-none" />,
    border: 'border-slate-200',
    accent: 'text-slate-800',
  },
};

/** Mount ONCE per partner surface (the portal page); renders the stack. */
export function PartnerToastCenter(): React.JSX.Element {
  const [items, setItems] = useState<PartnerToastItem[]>(toasts);
  useEffect(() => {
    const listener: Listener = (next) => setItems([...next]);
    listeners.add(listener);
    setItems([...toasts]);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  // Newest at the bottom keeps reading order stable; the stack never exceeds
  // four visible entries so a burst of saves cannot flood the screen.
  const visible = useMemo(() => items.slice(-4), [items]);
  return (
    <div
      data-partner-toast-center
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-auto max-w-[calc(100vw-2rem)] flex-col gap-2 sm:max-w-sm"
    >
      {visible.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          data-partner-toast={toast.kind}
          className={`pointer-events-auto flex max-w-full items-start gap-3 rounded-2xl border bg-white p-4 text-sm shadow-lg ${KIND_STYLES[toast.kind].border} ${KIND_STYLES[toast.kind].accent}`}
        >
          {KIND_STYLES[toast.kind].icon}
          <p className="min-w-0 break-words">{toast.message}</p>
          {toast.kind !== 'loading' ? (
            <button
              type="button"
              aria-label="Dismiss notification"
              data-partner-toast-dismiss={toast.id}
              onClick={() => dismissPartnerToast(toast.id)}
              className="-m-2 ml-0 min-h-11 min-w-11 rounded-xl p-3 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
