// ============================================================================
// Customer App UI primitives.
//
// Deliberately built from the tokens and utilities the app already uses
// (`bg-surface`, `text-on-surface`, the accent hex the salon configured,
// `motion/react`, `lucide-react`) rather than a new design system: the brief
// said not to change the current theme, so this reuses it. Nothing here sets a
// colour that is not either a neutral from the existing palette or the salon's
// own `accentHex`.
//
// The three states every screen must handle are first-class components:
// `LoadingRows` (never a fake row while waiting), `ErrorState` (a failed read
// is shown as a failure with a retry, never as an empty list) and `EmptyState`
// (a genuine zero from the database).
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { onCustomerDataInvalidate } from '../lib/customer/api';
import { subscribeToCustomerUpdates, createCoalescedRefresh, type RealtimeChannel } from '../lib/customer/realtime';

export const CARD_CLASS = 'bg-white rounded-3xl border border-slate-200 shadow-sm';
export const MUTED_CLASS = 'text-slate-600';

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`${CARD_CLASS} ${className}`}>{children}</div>
);

export const SectionTitle: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, action }) => (
  <div className="flex items-end justify-between gap-4 mb-4">
    <div>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {subtitle ? <p className={`text-sm mt-0.5 ${MUTED_CLASS}`}>{subtitle}</p> : null}
    </div>
    {action}
  </div>
);

export const Chip: React.FC<{
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
  title?: string;
  onClick?: () => void;
}> = ({ children, tone = 'neutral', title, onClick }) => {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    accent: 'bg-[#fff1f5] text-[#90003b] border-[#ffd9de]',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold tracking-wide ${tones[tone]} ${
        onClick ? 'cursor-pointer hover:opacity-90' : ''
      }`}
    >
      {children}
    </Tag>
  );
};

export const Button: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  accentHex?: string;
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}> = ({ children, onClick, variant = 'primary', accentHex = '#C20E5A', disabled, busy, type = 'button', className = '', title }) => {
  const base = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';
  const variants: Record<string, string> = {
    primary: 'text-white shadow-sm hover:opacity-90',
    secondary: 'bg-white text-slate-800 border border-slate-200 hover:border-slate-300',
    ghost: 'text-slate-700 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  const style = variant === 'primary' ? { backgroundColor: accentHex } : undefined;
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy} style={style} className={`${base} ${variants[variant]} ${className}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {children}
    </button>
  );
};

export const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
}> = ({ label, value, onChange, placeholder, type = 'text', hint, disabled, required }) => (
  <label className="block">
    <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
      {label}
      {required ? <span className="text-rose-600 ml-0.5">*</span> : null}
    </span>
    <input
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:bg-slate-50"
    />
    {hint ? <span className={`block text-xs mt-1.5 ${MUTED_CLASS}`}>{hint}</span> : null}
  </label>
);

export const Avatar: React.FC<{ src?: string; name: string; size?: number }> = ({ src, name, size = 40 }) => {
  const initials = String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
  if (src) {
    return <img src={src} alt={name} className="rounded-2xl object-cover bg-slate-100" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="rounded-2xl bg-slate-100 text-slate-500 font-bold inline-flex items-center justify-center"
      style={{ width: size, height: size, fontSize: Math.max(11, size / 3) }}
      aria-hidden
    >
      {initials}
    </span>
  );
};

export const StatTile: React.FC<{ label: string; value: string; hint?: string; accentHex?: string }> = ({ label, value, hint, accentHex }) => (
  <div className={`${CARD_CLASS} px-4 py-3.5`}>
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-xl font-extrabold mt-1" style={{ color: accentHex }}>
      {value}
    </p>
    {hint ? <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>{hint}</p> : null}
  </div>
);

export const LoadingRows: React.FC<{ rows?: number; label?: string }> = ({ rows = 3, label = 'Loading from Supabase…' }) => (
  <div className={`${CARD_CLASS} p-5 flex items-center gap-3`}>
    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
    <div className="flex-1 space-y-2">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-3 rounded-full bg-slate-100 animate-pulse" style={{ width: `${90 - index * 12}%` }} />
      ))}
    </div>
  </div>
);

export const ErrorState: React.FC<{
  title?: string;
  message: string;
  onRetry?: () => void;
  hint?: string;
}> = ({ title = 'This could not be loaded', message, onRetry, hint }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`${CARD_CLASS} p-5 border-rose-200 bg-rose-50/40`}>
    <div className="flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-rose-900">{title}</p>
        <p className="text-sm text-rose-800/80 mt-1 break-words">{message}</p>
        {hint ? <p className="text-xs text-rose-700/70 mt-1.5">{hint}</p> : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
        ) : null}
      </div>
    </div>
  </motion.div>
);

export const EmptyState: React.FC<{
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, body, action, icon }) => (
  <div className={`${CARD_CLASS} text-center px-6 py-12`}>
    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3.5">{icon}</div>
    <h3 className="text-base font-bold text-slate-900">{title}</h3>
    <p className={`text-sm mt-1.5 max-w-md mx-auto ${MUTED_CLASS}`}>{body}</p>
    {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
  </div>
);

/**
 * Where a value came from, shown on the screen.
 *
 * `supabase` = a row in the connected database. `derived` = computed from real
 * rows (a rating averaged over stored reviews, a slot grid from schedules minus
 * bookings). `device` = the customer's own bucket on this device, because the
 * schema has no table for it. Labelling them is the difference between an app
 * that reads like a database client and one that reads like a mockup.
 */
export const SourceChip: React.FC<{
  source?: 'supabase' | 'derived' | 'device';
  /** The mode the API answered with; `mock` means no database was read. */
  mode?: 'live' | 'mock';
  /** While the request is in flight the source is unknown, so it is not claimed. */
  loading?: boolean;
  title?: string;
}> = ({ source = 'supabase', mode, loading, title }) => {
  const tones = {
    supabase: { tone: 'success' as const, text: 'supabase' },
    derived: { tone: 'neutral' as const, text: 'derived' },
    device: { tone: 'warn' as const, text: 'this device' },
  };
  if (loading) {
    return <Chip tone="neutral" title="This value has not come back from the API yet">reading…</Chip>;
  }
  if (mode === 'mock') {
    return (
      <Chip tone="warn" title="This deployment has no Supabase credentials, so nothing here came from a database">
        not connected
      </Chip>
    );
  }
  const config = tones[source];
  return (
    <Chip tone={config.tone} title={title || `${config.text} — ${source === 'device' ? 'no table exists for this in the current schema' : source === 'derived' ? 'computed from real rows, not stored separately' : 'read from the connected database'}`}>
      {config.text}
    </Chip>
  );
};

export const money = (value: number, currency = '₹'): string => {
  const amount = Number(value || 0);
  const formatted = amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${currency}${formatted}`;
};

export const clockLabel = (time: string): string => {
  const [hoursRaw, minutes] = String(time || '').split(':');
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours)) return time || '--:--';
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes || '00'} ${suffix}`;
};

export const dayLabel = (date: string): string => {
  if (!date) return 'Date not set';
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string;
  failed: boolean;
  notice: string;
  mode: 'live' | 'mock';
  reload: () => void;
  /** Replace the payload after a local write, without another round-trip. */
  setData: (next: T) => void;
}

/**
 * Run a `CustomerResult`-returning loader.
 *
 * `failed` is kept separate from an empty `data`: "we could not read your
 * bookings" and "you have no bookings" are different truths and must not render
 * the same way. `reloadKey` also re-runs on any customer-data invalidation, so
 * a booking created in another tab of the app refreshes this list.
 */
export function useCustomerQuery<T>(
  loader: () => Promise<{ ok: boolean; data?: T; error?: string; notice?: string; mode?: 'live' | 'mock' }>,
  deps: React.DependencyList,
  options: { liveRefresh?: boolean } = {}
): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string; failed: boolean; notice: string; mode: 'live' | 'mock' }>({
    data: null,
    loading: true,
    error: '',
    failed: false,
    notice: '',
    mode: 'live',
  });
  const [reloadKey, setReloadKey] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: '', failed: false }));
    void (async () => {
      const result = await loaderRef.current();
      if (cancelled) return;
      if (result.ok) {
        setState({ data: (result.data ?? null) as T | null, loading: false, error: '', failed: false, notice: result.notice || '', mode: result.mode || 'live' });
      } else {
        // Keep the previous payload out of the failure branch on purpose: an
        // out-of-date list shown under a silent error is worse than no list.
        setState({ data: null, loading: false, error: result.error || 'The request failed.', failed: true, notice: result.notice || '', mode: result.mode || 'live' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  useEffect(() => {
    if (options.liveRefresh === false) return;
    return onCustomerDataInvalidate(() => setReloadKey((key) => key + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.liveRefresh]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const setData = useCallback((next: T) => setState((prev) => ({ ...prev, data: next, failed: false, error: '' })), []);
  return { ...state, reload, setData };
}

/**
 * Subscribe to live changes for the given channels while a screen is mounted.
 *
 * `onTrigger` re-runs the screen's own query; the subscription itself only says
 * "something changed" (see src/lib/customer/realtime.ts for why the signal comes
 * from notifications and not from the private tables).
 */
export function useCustomerRealtime(
  channels: RealtimeChannel[],
  email: string | null | undefined,
  onTrigger: (reason: string) => void,
  options: { salonId?: string; pollMs?: number } = {}
): { transport: 'supabase-realtime' | 'poll' } {
  const refresh = useCallback(createCoalescedRefresh((reason) => onTrigger(reason)), [onTrigger]);
  const [transport, setTransport] = useState<'supabase-realtime' | 'poll'>('poll');

  useEffect(() => {
    let active = true;
    const handle = subscribeToCustomerUpdates(channels, email, {
      pollMs: options.pollMs,
      salonId: options.salonId,
      onChange: (reason) => refresh(reason),
    });
    // The transport is only known after `subscribe()` resolves, and it can
    // still upgrade from polling to Realtime later, so it is re-read on a slow
    // timer instead of being trusted once at mount. Reading state (rather than
    // a ref) is what makes the chip in the header flip when it changes.
    const read = () => {
      if (active) setTransport(handle.transport());
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      handle.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.join('|'), email, options.salonId, options.pollMs]);

  return { transport };
}

/** The "not connected to Supabase" banner every screen can show. */
export const ConnectionNotice: React.FC<{ mode?: 'live' | 'mock'; notice?: string; onRetry?: () => void }> = ({ mode, notice, onRetry }) => {
  if (mode !== 'mock' && !notice) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900">
      <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-bold">
          {mode === 'mock' ? 'Not connected to Supabase' : 'Heads up'}
        </p>
        <p className="text-amber-800/90 mt-0.5">
          {notice ||
            'This deployment has no Supabase credentials, so there is no live data to show and nothing was saved. Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to connect the Customer App.'}
        </p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-2 text-xs font-bold underline cursor-pointer">
            Retry now
          </button>
        ) : null}
      </div>
    </div>
  );
};
