import React from 'react';
import { motion } from 'motion/react';

// ============================================================================
// Onboarding App — shared gateway shell.
//
// Minimal auth-gateway look: one centered card on a quiet background. No
// dashboard chrome, no heavy animation. Screens compose this with their form.
// ============================================================================

export const ONBOARDING_ACCENT = '#C20E5A';

export const GatewayShell: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, children, footer }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Onboarding</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
    </motion.div>
  </main>
);

export const Field: React.FC<{
  id: string;
  label: string;
  type?: string;
  value: string;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  onChange: (value: string) => void;
}> = ({ id, label, type = 'text', value, autoComplete, placeholder, disabled, error, onChange }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-bold text-slate-800">
      {label}
    </label>
    <input
      id={id}
      name={id}
      type={type}
      value={value}
      autoComplete={autoComplete}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`mt-1.5 w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-500 disabled:opacity-60 ${
        error ? 'border-rose-400' : 'border-slate-200'
      }`}
    />
    {error && (
      <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
        {error}
      </p>
    )}
  </div>
);

export const FormAlert: React.FC<{ tone: 'error' | 'success'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
      tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
    }`}
  >
    {children}
  </div>
);

export const SubmitButton: React.FC<{
  busy: boolean;
  busyLabel: string;
  accentHex?: string;
  children: React.ReactNode;
}> = ({ busy, busyLabel, accentHex = ONBOARDING_ACCENT, children }) => (
  <button
    type="submit"
    disabled={busy}
    className="w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
    style={{ backgroundColor: accentHex }}
  >
    {busy ? busyLabel : children}
  </button>
);

export const TextLinkButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="font-bold text-slate-900 underline underline-offset-2 cursor-pointer hover:opacity-80"
  >
    {children}
  </button>
);
