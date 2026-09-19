import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toDataURL } from 'qrcode';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  X,
} from 'lucide-react';
import {
  changeEmailSchema,
  changePasswordSchema,
  parseFields,
  PartnerValidationError,
  totpCodeSchema,
  type FieldErrors,
} from '../lib/partnerAccountValidation';
import {
  PARTNER_SECURITY_EVENT_LABELS,
  beginPartnerTwoFactorEnrollment,
  cancelPartnerAccountDeactivation,
  changePartnerPassword,
  confirmPartnerTwoFactor,
  describeSession,
  disablePartnerTwoFactor,
  listPartnerTwoFactorFactors,
  requestPartnerAccountDeactivation,
  requestPartnerEmailChange,
  revokeOtherPartnerSessions,
  type PartnerSecurityEvent,
  type PartnerSecurityOverview,
  type PartnerSecurityOverviewError,
  type PartnerSecuritySession,
  type SecurityOverviewClient,
  type TotpEnrollment,
} from '../lib/partnerAccountSecurity';
import { usePartnerSecurityOverview } from '../lib/usePartnerSecurityOverview';
import { supabase } from '../lib/supabaseClient';
import { PartnerToastCenter, showPartnerToast } from './PartnerToastCenter';
import { PartnerLoading } from './PartnerLoading';
import { PartnerSectionErrorBoundary } from './PartnerSectionErrorBoundary';

// ============================================================================
// ACCOUNT SETTINGS (/partner/account-settings).
//
// The page the profile dropdown's "Account Settings" entry opens (and the
// sidebar's Account group links to):
//
//   1. Change Email — current / new / confirm; the change goes through
//      Supabase Auth (verification link), never a profile-table write.
//   2. Password & Security — password rotation verified against the CURRENT
//      password, plus TOTP two-factor with a QR enrollment modal.
//   3. Active Sessions & Security Log — the real auth sessions with device,
//      IP and a current-session badge, "log out of all other sessions", and
//      the security event log.
//   4. Danger Zone — a collapsible section whose deactivation action files a
//      request for platform review; nothing is deleted from a browser.
//
// Every action validates with the shared Zod schemas first, surfaces its
// outcome through the toast center (loading → success/error), and refreshes
// the security overview from the backend so the page never shows invented
// state.
// ============================================================================

const inputClass =
  'mt-1 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-2 focus:outline-slate-900 disabled:bg-slate-50 disabled:text-slate-500';
const errorInputClass = 'border-rose-300 focus:outline-rose-500';
const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const sectionIconClass = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700';

/** Minimal accessible modal: backdrop click + Escape close, focus is trapped loosely by the dialog role. */
const AccountModal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ title, onClose, children, wide }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" data-account-modal>
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative max-h-[92vh] w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'} overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-black text-slate-900">{title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? (
    <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">
      {message}
    </p>
  ) : null;

// ---------------------------------------------------------------------------
// 1. Change email
// ---------------------------------------------------------------------------

const ChangeEmailSection: React.FC<{
  client: SecurityOverviewClient;
  currentEmail: string;
  expectedUserId: string;
}> = ({ client, currentEmail, expectedUserId }) => {
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [requestedFor, setRequestedFor] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const duplicate = newEmail.trim().toLowerCase() === currentEmail.toLowerCase() && newEmail.trim() !== '';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    let parsed: ReturnType<typeof changeEmailSchema.parse>;
    try {
      parsed = parseFields(changeEmailSchema, { currentEmail, newEmail, confirmEmail });
    } catch (cause) {
      setErrors(cause instanceof PartnerValidationError ? cause.fieldErrors : { _: cause instanceof Error ? cause.message : 'Check the email fields.' });
      return;
    }
    setErrors({});
    // Duplicate-submission guard: the exact same request while one is in
    // flight (double click, re-render) is dropped, not re-sent.
    if (inFlight.current === parsed.newEmail) return;
    inFlight.current = parsed.newEmail;
    setBusy(true);
    try {
      await requestPartnerEmailChange(
        { email: parsed.newEmail, expectedUserId, currentEmail, logEvent: true },
        client
      );
      setRequestedFor(parsed.newEmail);
      setNewEmail('');
      setConfirmEmail('');
      showPartnerToast.success(
        'Email change requested. Check your current and new inboxes for the verification links.'
      );
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not request an email change. Please retry.');
    } finally {
      inFlight.current = null;
      setBusy(false);
    }
  };

  return (
    <section aria-label="Change email" className={cardClass} data-account-section="change-email">
      <div className="flex items-center gap-3">
        <span className={sectionIconClass}>
          <Mail className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-black text-slate-900">Change Email</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            A verification link is sent through the auth provider. The address updates only after you confirm it.
          </p>
        </div>
      </div>
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <label className="block text-sm font-bold text-slate-600">
          Current Email
          <input type="email" readOnly value={currentEmail} aria-readonly="true" data-account-field="current-email" className={`${inputClass} bg-slate-50 text-slate-500`} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-bold text-slate-600">
            New Email
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value);
                setRequestedFor(null);
                setErrors((prev) => ({ ...prev, newEmail: '' }));
              }}
              aria-invalid={errors.newEmail ? true : undefined}
              data-account-field="new-email"
              className={`${inputClass} ${errors.newEmail ? errorInputClass : ''}`}
            />
            {duplicate ? (
              <FieldError message="The new email is the same as your current email." />
            ) : (
              <FieldError message={errors.newEmail} />
            )}
          </label>
          <label className="block text-sm font-bold text-slate-600">
            Confirm New Email
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="Repeat the new email"
              value={confirmEmail}
              onChange={(event) => {
                setConfirmEmail(event.target.value);
                setErrors((prev) => ({ ...prev, confirmEmail: '' }));
              }}
              aria-invalid={errors.confirmEmail ? true : undefined}
              data-account-field="confirm-email"
              className={`${inputClass} ${errors.confirmEmail ? errorInputClass : ''}`}
            />
            <FieldError message={errors.confirmEmail} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || duplicate || !newEmail.trim() || !confirmEmail.trim()}
            data-account-action="request-email-change"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {busy ? 'Requesting…' : 'Request Email Update'}
          </button>
          {requestedFor ? (
            <p role="status" className="text-sm font-semibold text-emerald-700">
              Verification link requested for {requestedFor}.
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------
// 2a. Change password
// ---------------------------------------------------------------------------

const ChangePasswordSection: React.FC<{
  client: SecurityOverviewClient;
  email: string;
  onChanged: () => void;
}> = ({ client, email, onChanged }) => {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    let parsed: ReturnType<typeof changePasswordSchema.parse>;
    try {
      parsed = parseFields(changePasswordSchema, form);
    } catch (cause) {
      setErrors(cause instanceof PartnerValidationError ? cause.fieldErrors : { _: cause instanceof Error ? cause.message : 'Check the password fields.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await changePartnerPassword(
        { currentPassword: parsed.currentPassword, newPassword: parsed.newPassword, email },
        client
      );
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showPartnerToast.success('Password updated. Other sessions stay signed in — revoke them below if you prefer.');
      onChanged();
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not update your password. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-5 space-y-4" onSubmit={submit} noValidate aria-label="Change password" data-account-section="change-password">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-bold text-slate-600">
          Current Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(event) => {
              setForm({ ...form, currentPassword: event.target.value });
              setErrors((prev) => ({ ...prev, currentPassword: '' }));
            }}
            aria-invalid={errors.currentPassword ? true : undefined}
            data-account-field="current-password"
            className={`${inputClass} ${errors.currentPassword ? errorInputClass : ''}`}
          />
          <FieldError message={errors.currentPassword} />
        </label>
        <label className="block text-sm font-bold text-slate-600">
          New Password
          <input
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(event) => {
              setForm({ ...form, newPassword: event.target.value });
              setErrors((prev) => ({ ...prev, newPassword: '' }));
            }}
            aria-invalid={errors.newPassword ? true : undefined}
            data-account-field="new-password"
            className={`${inputClass} ${errors.newPassword ? errorInputClass : ''}`}
          />
          <FieldError message={errors.newPassword} />
        </label>
        <label className="block text-sm font-bold text-slate-600">
          Confirm Password
          <input
            type="password"
            required
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(event) => {
              setForm({ ...form, confirmPassword: event.target.value });
              setErrors((prev) => ({ ...prev, confirmPassword: '' }));
            }}
            aria-invalid={errors.confirmPassword ? true : undefined}
            data-account-field="confirm-password"
            className={`${inputClass} ${errors.confirmPassword ? errorInputClass : ''}`}
          />
          <FieldError message={errors.confirmPassword} />
        </label>
      </div>
      <p className="text-xs text-slate-500">At least 8 characters with one letter and one number. Changing your password signs the current device in with the new one.</p>
      <button
        type="submit"
        disabled={busy}
        data-account-action="change-password"
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
        {busy ? 'Updating…' : 'Update Password'}
      </button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// 2b. Two-factor authentication (TOTP + QR enrollment modal)
// ---------------------------------------------------------------------------

/**
 * The saved 2FA state as the page knows it.
 *
 * `unknown` is NOT "off": when the security overview cannot be read the page
 * must not claim an account is unprotected — it says the status could not be
 * loaded and still lets the partner start a setup (enrollment asks the auth
 * backend, which answers honestly if an authenticator already exists).
 */
export type TwoFactorState = 'on' | 'off' | 'unknown';

const TwoFactorSection: React.FC<{
  client: SecurityOverviewClient;
  state: TwoFactorState;
  onChanged: () => void;
  onRetry?: () => void;
  refreshing?: boolean;
}> = ({ client, state, onChanged, onRetry, refreshing }) => {
  const [setup, setSetup] = useState<TotpEnrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [mounted, setMounted] = useState(true);
  useEffect(() => () => setMounted(false), []);

  const openSetup = async () => {
    setBusy(true);
    try {
      const enrollment = await beginPartnerTwoFactorEnrollment(client);
      if (!mounted) return;
      setSetup(enrollment);
      setCode('');
      setCodeError('');
      setBusy(false);
      // The QR canvas render never blocks the confirm form: it streams in
      // whenever it is ready (and degrades to the manual key on failure).
      try {
        const dataUrl = await toDataURL(enrollment.uri);
        if (mounted) setQrDataUrl(dataUrl);
      } catch {
        if (mounted) setQrDataUrl('');
      }
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not start two-factor setup.');
      if (mounted) setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setup || busy) return;
    let parsed: string;
    try {
      parsed = parseFields(totpCodeSchema, code);
    } catch (cause) {
      setCodeError(cause instanceof Error ? cause.message : 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      await confirmPartnerTwoFactor(client, setup.factorId, parsed);
      if (!mounted) return;
      setSetup(null);
      setConfirmOff(false);
      showPartnerToast.success('Two-factor authentication is on. Keep your authenticator app — you will need it at sign-in.');
      onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not verify the code.';
      setCodeError(message);
      showPartnerToast.error(message);
    } finally {
      if (mounted) setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const factors = await listPartnerTwoFactorFactors(client);
      const verified = factors.find((factor) => factor.status === 'verified' && factor.factor_type === 'totp') || factors[0];
      if (!verified?.id) throw new Error('No authenticator is enrolled on this account.');
      await disablePartnerTwoFactor(client, String(verified.id));
      if (!mounted) return;
      setConfirmOff(false);
      showPartnerToast.success('Two-factor authentication is off.');
      onChanged();
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not disable two-factor authentication.');
    } finally {
      if (mounted) setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard?.writeText(setup.secret);
      showPartnerToast.success('Setup key copied.');
    } catch {
      showPartnerToast.error('Copy failed — select the key and copy it manually.');
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-4" data-account-section="two-factor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${state === 'on' ? 'bg-emerald-100 text-emerald-700' : state === 'unknown' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
            {state === 'on' ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <ShieldOff className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900">Two-Factor Authentication (2FA)</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {state === 'on'
                ? 'On — an authenticator app must confirm your sign-in codes.'
                : state === 'unknown'
                  ? 'Your saved 2FA status could not be loaded. You can still start a setup — the authenticator itself is checked with the sign-in provider.'
                  : 'Add an authenticator app (Google Authenticator, Authy, 1Password…) as a second sign-in factor.'}
            </p>
          </div>
        </div>
        {state === 'unknown' && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={refreshing}
            data-account-action="retry-security-overview-2fa"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            {refreshing ? 'Checking…' : 'Check status'}
          </button>
        ) : null}
        {state === 'on' ? (
          <button
            type="button"
            onClick={() => setConfirmOff(true)}
            disabled={busy}
            data-account-action="disable-2fa"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            Disable 2FA
          </button>
        ) : (
          <button
            type="button"
            onClick={openSetup}
            disabled={busy}
            data-account-action="enable-2fa"
            className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-2 text-xs font-bold text-white hover:bg-pink-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {busy ? 'Preparing…' : state === 'unknown' ? 'Set up 2FA' : 'Enable 2FA'}
          </button>
        )}
      </div>

      {setup ? (
        <AccountModal title="Set up your authenticator" onClose={() => (busy ? null : setSetup(null))} wide>
          <ol className="space-y-1 text-sm text-slate-600">
            <li>1. Open your authenticator app.</li>
            <li>2. Scan the QR code — or enter the key manually.</li>
            <li>3. Confirm with the 6-digit code it shows.</li>
          </ol>
          <div className="mt-4 flex flex-col items-center gap-3">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Two-factor QR code" data-account-qr className="h-44 w-44 rounded-xl border border-slate-200 bg-white p-2" />
            ) : (
              <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
                QR unavailable — use the key below
              </div>
            )}
            <div className="w-full rounded-xl bg-slate-100 p-3 text-center">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Setup key (manual entry)</p>
              <p className="mt-1 break-all font-mono text-sm font-bold text-slate-800" data-account-totp-secret>{setup.secret}</p>
            </div>
            <button type="button" onClick={copySecret} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 underline">
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy key
            </button>
          </div>
          <form className="mt-4 space-y-2" onSubmit={verify} noValidate>
            <label className="block text-sm font-bold text-slate-600">
              Authenticator code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/[^0-9]/g, ''));
                  setCodeError('');
                }}
                aria-invalid={codeError ? true : undefined}
                data-account-field="totp-code"
                className={`${inputClass} text-center text-lg tracking-[0.4em] ${codeError ? errorInputClass : ''}`}
              />
            </label>
            <FieldError message={codeError} />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              data-account-action="verify-2fa"
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-pink-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {busy ? 'Verifying…' : 'Verify & Turn On'}
            </button>
          </form>
        </AccountModal>
      ) : null}

      {confirmOff ? (
        <AccountModal title="Disable two-factor authentication?" onClose={() => setConfirmOff(false)}>
          <p className="text-sm text-slate-600">
            Your account will again be protected by password only. You can re-enable 2FA at any time.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setConfirmOff(false)} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200">
              Keep it on
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              data-account-action="confirm-disable-2fa"
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </div>
        </AccountModal>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. Active sessions + security log
// ---------------------------------------------------------------------------

const SessionRow: React.FC<{ session: PartnerSecuritySession }> = ({ session }) => (
  <li className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-3.5" data-account-session={session.is_current ? 'current' : 'other'}>
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
        {session.is_current ? <MonitorSmartphone className="h-5 w-5" aria-hidden="true" /> : <Laptop className="h-5 w-5" aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900">
          {describeSession(session.user_agent)}
          {session.is_current ? (
            <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">This device</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {session.ip ? <>IP {session.ip} · </> : null}
          {session.created_at ? `Started ${new Date(session.created_at).toLocaleString()}` : 'Start time unavailable'}
        </p>
      </div>
    </div>
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${session.is_current ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
      {session.is_current ? 'Active now' : 'Active'}
    </span>
  </li>
);

const SessionsSection: React.FC<{
  client: SecurityOverviewClient;
  sessions: PartnerSecuritySession[];
  sessionsAvailable: boolean;
  onChanged: () => void;
  /** True when the overview read failed, so "no sessions" would be a lie. */
  unavailable?: boolean;
  onRetry?: () => void;
  refreshing?: boolean;
}> = ({ client, sessions, sessionsAvailable, onChanged, unavailable, onRetry, refreshing }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const count = await revokeOtherPartnerSessions(client);
      setConfirming(false);
      showPartnerToast.success(count === 1 ? '1 other session signed out.' : `${count} other sessions signed out.`);
      onChanged();
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not sign out the other sessions.');
    } finally {
      setBusy(false);
    }
  };

  const others = sessions.filter((session) => !session.is_current);

  return (
    <div className="mt-6" data-account-section="sessions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Active Sessions</h3>
          <p className="mt-0.5 text-xs text-slate-500">Devices and browsers currently signed in to your partner account.</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!sessionsAvailable || others.length === 0}
          title={!sessionsAvailable ? 'Session management is not available on this deployment' : undefined}
          data-account-action="revoke-sessions"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out of all other sessions{others.length ? ` (${others.length})` : ''}
        </button>
      </div>
      {unavailable ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3" data-account-sessions-unavailable>
          <p className="text-xs text-slate-500">
            Sessions could not be loaded, so this list is empty rather than wrong. Your sign-in sessions are unaffected.
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={refreshing}
              data-account-action="retry-security-overview-sessions"
              className="mt-2.5 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {refreshing ? 'Retrying…' : 'Retry'}
            </button>
          ) : null}
        </div>
      ) : !sessionsAvailable ? (
        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          The session list is not available on this deployment. Sign-in sessions still work — this page just cannot enumerate them here.
        </p>
      ) : sessions.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          No active sessions reported yet. Sign in again if this looks wrong.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}

      {confirming ? (
        <AccountModal title="Log out of all other sessions?" onClose={() => setConfirming(false)}>
          <p className="text-sm text-slate-600">
            {others.length === 1
              ? '1 other device or browser will be signed out of your partner account. This device stays signed in.'
              : `${others.length} other devices and browsers will be signed out of your partner account. This device stays signed in.`}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200">
              Cancel
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              data-account-action="confirm-revoke-sessions"
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? 'Signing out…' : 'Log out other sessions'}
            </button>
          </div>
        </AccountModal>
      ) : null}
    </div>
  );
};

const SecurityLogSection: React.FC<{ events: PartnerSecurityEvent[]; unavailable?: boolean }> = ({ events, unavailable }) => (
  <div className="mt-6 border-t border-slate-100 pt-5" data-account-section="security-log">
    <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Security Log</h3>
    <p className="mt-0.5 text-xs text-slate-500">The latest security-related events on your account.</p>
    {unavailable ? (
      <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500" data-account-security-log-unavailable>
        The security log could not be loaded. Events are still recorded — they will appear here once the overview loads.
      </p>
    ) : events.length === 0 ? (
      <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        Nothing logged yet. Password changes, 2FA changes and session revocations will appear here.
      </p>
    ) : (
      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-800">
              {PARTNER_SECURITY_EVENT_LABELS[event.event_type] || 'Security event'}
              {event.detail ? <span className="ml-1.5 font-normal text-slate-500">— {event.detail}</span> : null}
            </span>
            <span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// 4. Danger zone — request deactivation (a review request, never a delete)
// ---------------------------------------------------------------------------

const DangerZoneSection: React.FC<{
  client: SecurityOverviewClient;
  deactivation: PartnerSecurityOverview['deactivation'];
  onChanged: () => void;
  /** True when the overview read failed: pending-request state is unknown. */
  unavailable?: boolean;
}> = ({ client, deactivation, onChanged, unavailable }) => {
  const [open, setOpen] = useState(Boolean(deactivation));
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await requestPartnerAccountDeactivation(reason, client);
      setConfirming(false);
      setReason('');
      showPartnerToast.success('Deactivation request filed. The platform team will review it and contact you.');
      onChanged();
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not request deactivation.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelPartnerAccountDeactivation(client);
      showPartnerToast.success('Deactivation request cancelled.');
      onChanged();
    } catch (cause) {
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Could not cancel the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Danger zone" className="rounded-3xl border border-rose-200 bg-white p-5 shadow-sm sm:p-7" data-account-section="danger-zone">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="partner-danger-zone-body"
        data-account-action="toggle-danger-zone"
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-lg font-black text-rose-700">Danger Zone</span>
            <span className="mt-0.5 block text-sm text-slate-500">Deactivation and account-level requests.</span>
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div id="partner-danger-zone-body" className="mt-5 rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
          {unavailable ? (
            <p className="mb-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
              Your pending-request status could not be loaded. Filing a request still works — the backend refuses a second open request and tells you if one exists.
            </p>
          ) : null}
          {deactivation?.status === 'pending' ? (
            <div className="flex flex-wrap items-start justify-between gap-3" data-account-deactivation="pending">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">Deactivation request pending review</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Filed {deactivation.requested_at ? new Date(deactivation.requested_at).toLocaleString() : ''}. The platform team will contact you before anything changes.
                </p>
              </div>
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                data-account-action="cancel-deactivation"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {busy ? 'Cancelling…' : 'Cancel request'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">Request account deactivation</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Pauses your partner account after a platform review. Payouts and referral history are preserved — this files a request, it deletes nothing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                data-account-action="request-deactivation"
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
              >
                Request Account Deactivation
              </button>
            </div>
          )}
        </div>
      ) : null}

      {confirming ? (
        <AccountModal title="Request account deactivation?" onClose={() => (busy ? null : setConfirming(false))}>
          <div className="flex gap-2.5 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p>Your profile and referral links stop being shown while the account is deactivated. Your data and earnings history are kept for the review.</p>
          </div>
          <label className="mt-4 block text-sm font-bold text-slate-600">
            Reason (optional, helps the review)
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Tell us why you're leaving — optional"
              data-account-field="deactivation-reason"
              className={inputClass}
            />
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
              Keep my account
            </button>
            <button
              type="button"
              onClick={request}
              disabled={busy}
              data-account-action="confirm-deactivation"
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? 'Filing request…' : 'File deactivation request'}
            </button>
          </div>
        </AccountModal>
      ) : null}
    </section>
  );
};

// ---------------------------------------------------------------------------
// The security overview's OWN failure surface — one card, not the route
// ---------------------------------------------------------------------------

const SecurityOverviewNotice: React.FC<{
  error: PartnerSecurityOverviewError;
  refreshing: boolean;
  onRetry: () => void;
}> = ({ error, refreshing, onRetry }) => {
  // What the partner can DO about it — a dead-end message is not error handling.
  const hint =
    error.kind === 'session'
      ? 'Sign in again to see your sessions, 2FA status and security log.'
      : error.kind === 'forbidden'
        ? 'Everything else on this page still works. Contact support if your application was approved.'
        : error.kind === 'unavailable'
          ? 'Everything else on this page still works. This is a project setup problem (the account security functions are not installed), not something you can fix here.'
          : 'Everything else on this page still works, and retrying usually fixes this.';

  const tone =
    error.kind === 'session' || error.kind === 'forbidden'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-rose-200 bg-rose-50 text-rose-900';

  return (
    <section
      role="alert"
      data-account-overview-error
      data-account-overview-error-kind={error.kind}
      className={`rounded-3xl border p-5 shadow-sm sm:p-6 ${tone}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-wide">Security overview unavailable</h2>
          <p className="mt-1 text-sm font-semibold">{error.message}</p>
          <p className="mt-1 text-xs opacity-90">{hint}</p>
          {error.kind === 'session' ? null : (
            <button
              type="button"
              onClick={onRetry}
              disabled={refreshing}
              data-account-action="retry-security-overview"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {refreshing ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function PartnerAccountSettingsPage({
  client,
  email,
  expectedUserId,
  displayName,
  navigate,
  onProfileChange,
}: {
  client?: SecurityOverviewClient;
  /** The signed-in partner's auth email (display + password verification). */
  email: string;
  /** The signed-in user id from the session (the backend re-checks it anyway). */
  expectedUserId: string;
  displayName?: string;
  navigate?: (to: string) => void;
  onProfileChange?: () => void;
}) {
  // The portal mounts this page without an injected client; fall back to the
  // shared Supabase client so the live route never renders a dead overview.
  const resolvedClient: SecurityOverviewClient = client ?? (supabase as SecurityOverviewClient);
  // One read, typed failures, automatic retry for transport blips, and a
  // manual `retry()` that starts a fresh attempt (see usePartnerSecurityOverview).
  const { overview, error, loading, refreshing, retry } = usePartnerSecurityOverview(resolvedClient);

  // ONLY the first load may own the whole route. From then on a failed refresh
  // degrades the security sections and leaves email, password, 2FA and the
  // danger zone on screen — the bug was the opposite: one dead RPC replaced
  // the entire page with an error card.
  if (loading && !overview) return <PartnerLoading label="Loading your account settings…" kind="profile" />;

  const overviewUnavailable = !overview;
  const twoFactorState: TwoFactorState = overview ? (overview.two_factor_enabled ? 'on' : 'off') : 'unknown';
  const pendingDeactivation = overview?.deactivation?.status === 'pending' ? overview.deactivation : null;
  const sessionCount = overview?.sessions.length ?? 0;

  return (
    <div className="min-w-0 space-y-5" data-partner-account-settings>
      <PartnerToastCenter />

      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-900">Account Settings</h1>
            <p className="mt-1 text-sm text-slate-500">
              Sign-in email, password, two-factor authentication, sessions and account-level requests.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {twoFactorState === 'on' ? (
              <span data-account-2fa-state="on" className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 font-bold text-emerald-700">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> 2FA on
              </span>
            ) : twoFactorState === 'off' ? (
              <span data-account-2fa-state="off" className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 font-bold text-amber-700">
                <ShieldOff className="h-4 w-4" aria-hidden="true" /> 2FA off
              </span>
            ) : (
              // Unknown is never rendered as "off" — that would claim the
              // account is unprotected when we simply could not look.
              <span data-account-2fa-state="unknown" className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 font-bold text-slate-600">
                <ShieldOff className="h-4 w-4" aria-hidden="true" /> 2FA status unavailable
              </span>
            )}
            {overview ? (
              <span data-account-session-count={sessionCount} className="rounded-xl bg-slate-100 px-3 py-2 font-bold text-slate-700">
                {sessionCount} active session{sessionCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {displayName ? <span className="rounded-xl bg-pink-50 px-3 py-2 font-bold text-pink-700">{displayName}</span> : null}
          </div>
        </div>
        {pendingDeactivation ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800" data-account-deactivation-banner>
            A deactivation request is pending review — see the Danger Zone below.
          </p>
        ) : null}
      </section>

      {error ? <SecurityOverviewNotice error={error} refreshing={refreshing} onRetry={retry} /> : null}

      <section className={cardClass} aria-label="Email and password">
        <PartnerSectionErrorBoundary label="Change email">
          <ChangeEmailSection client={resolvedClient} currentEmail={email} expectedUserId={expectedUserId} />
        </PartnerSectionErrorBoundary>
        <div className="mt-7 border-t border-slate-100 pt-6">
          <div className="flex items-center gap-3">
            <span className={sectionIconClass}>
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">Password &amp; Security</h2>
              <p className="mt-0.5 text-sm text-slate-500">Rotate your password and manage the second sign-in factor.</p>
            </div>
          </div>
          <PartnerSectionErrorBoundary label="Change password">
            <ChangePasswordSection client={resolvedClient} email={email} onChanged={retry} />
          </PartnerSectionErrorBoundary>
          <PartnerSectionErrorBoundary label="Two-factor authentication" resetKey={twoFactorState}>
            <TwoFactorSection
              client={resolvedClient}
              state={twoFactorState}
              onChanged={retry}
              onRetry={retry}
              refreshing={refreshing}
            />
          </PartnerSectionErrorBoundary>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <PartnerSectionErrorBoundary label="Sessions and security log" resetKey={overview ? 'loaded' : 'unavailable'}>
              <SessionsSection
                client={resolvedClient}
                sessions={overview?.sessions ?? []}
                sessionsAvailable={overview?.sessions_available !== false}
                onChanged={retry}
                unavailable={overviewUnavailable}
                onRetry={retry}
                refreshing={refreshing}
              />
              <SecurityLogSection events={overview?.events ?? []} unavailable={overviewUnavailable} />
            </PartnerSectionErrorBoundary>
          </div>
        </div>
      </section>

      <PartnerSectionErrorBoundary label="Danger zone" resetKey={pendingDeactivation?.id ?? 'none'}>
        <DangerZoneSection
          client={resolvedClient}
          deactivation={pendingDeactivation}
          unavailable={overviewUnavailable}
          onChanged={retry}
        />
      </PartnerSectionErrorBoundary>

      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Looking for profile details?</h2>
            <p className="mt-1 text-sm text-slate-500">Contact info, payout accounts and notification preferences live on the Profile page.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate?.('/partner/profile')}
            data-account-action="open-profile"
            className="rounded-xl bg-pink-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-pink-700"
          >
            Open Profile &amp; Preferences
          </button>
        </div>
      </section>
      {onProfileChange ? null : null}
    </div>
  );
}
