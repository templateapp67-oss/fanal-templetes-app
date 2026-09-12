import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Hourglass,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import {
  fetchMyGrowthPartnerApplication,
  fetchMyGrowthPartnerRow,
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  type GrowthPartner,
  type GrowthPartnerApplicationRow,
} from '../lib/growthPartner';
import {
  decideGrowthPartnerApplication,
  listGrowthPartnerApplications,
  type GrowthPartnerApplicationQueueRow,
} from '../lib/growthPartnerAdmin';
import {
  loadGrowthPartnerSession,
  signInGrowthPartner,
  signUpGrowthPartner,
  signOutGrowthPartner,
  type GrowthPartnerViewer,
} from '../lib/growthPartnerLogin';
import {
  beginPartnerSessionLifetime,
  completePartnerPasswordReset,
  finishPartnerSessionLifetime,
  PARTNER_PASSWORD_MISMATCH_MESSAGE,
  PARTNER_PASSWORD_UPDATED_MESSAGE,
  PARTNER_PORTAL_ERROR_BODY,
  PARTNER_PORTAL_ERROR_TITLE,
  PARTNER_PORTAL_LOGIN_MOCK_BODY,
  PARTNER_PORTAL_LOGIN_MOCK_TITLE,
  PARTNER_PORTAL_LOGIN_SUBTITLE,
  PARTNER_PORTAL_LOGIN_TITLE,
  PARTNER_PORTAL_LOGIN_VERIFYING_LABEL,
  PARTNER_PORTAL_PENDING_BODY,
  PARTNER_PORTAL_PENDING_TITLE,
  PARTNER_PORTAL_REJECTED_BODY,
  PARTNER_PORTAL_REJECTED_TITLE,
  PARTNER_PORTAL_SESSION_BODY,
  PARTNER_PORTAL_SESSION_TITLE,
  PARTNER_PORTAL_UNAUTHORIZED_BODY,
  PARTNER_PORTAL_UNAUTHORIZED_HINT,
  PARTNER_PORTAL_UNAUTHORIZED_TITLE,
  PARTNER_RESET_REQUESTED_MESSAGE,
  readRememberedPartnerEmail,
  resolvePartnerPortalLogin,
  sendPartnerPasswordReset,
  validatePartnerNewPassword,
  writeRememberedPartnerEmail,
  type PartnerPortalAuthClient,
  type PartnerPortalLoginState,
} from '../lib/partnerPortalAuth';
import { clearAuthSessionLifetime } from '../lib/authRememberStorage';
import { PARTNER_DASHBOARD_PATH } from '../lib/router';
import { Field, FormAlert, SubmitButton } from '../onboarding/screens/Shell';
import {
  GrowthPartnerAdminReviewPanel,
  GrowthPartnerSignupForm,
} from './GrowthPartnerLogin';

// ============================================================================
// Growth Partner PORTAL LOGIN — `/partner/login` (PART 2, SECTION 1).
//
// The dedicated login page for the Growth Partner module. Everything on it is
// real and backed by the platform's existing auth + database:
//
//   • Platform logo, heading "Growth Partner Login", email + password fields,
//     show/hide password, "Remember me", "Forgot Password", a login button
//     with loading + error states, and a success redirect to
//     `/partner/dashboard`.
//   • Authentication is Supabase Auth (signInWithPassword). Authorization is
//     verified from the backend after EVERY sign-in and session restore by
//     reading the caller's OWN growth_partners row (RLS): an ACTIVE partner is
//     forwarded to the dashboard; a pending application, a rejected
//     application, an inactive/suspended partner, or a normal
//     customer/owner/admin account is kept out.
//   • Access is never taken from browser storage, the URL, a client-side
//     claim, or a manually supplied partner id — the only inputs are the
//     authenticated session and the backend rows for that session's user.
// ============================================================================

/** The platform logo used by the app header (same asset, so the brand matches). */
export const PLATFORM_LOGO_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDJYocRxmo4vpJ1_AiSXtAMUVqSgd5cKajB-4RUxdyE8aRIhXYKc6rpkP2QfQk08sdDXrCP9Xpc0FsS9TCBIXdCIvQsKMtaXaNapgbxpoP6ZtqwDgiKttI_L1wi-DCFFUdw5zFns1eezsmbwoXe7dlwdAN6mudQV7w2QZhWcRTvgOfjdEndslxxaWrRhgFdVl0nFcwkXUBL3dISegAZ9Wpv-_iyNsyPYyyAeFelbPvSjMco5lgCDLptw6yYIDX8QK0hSWM';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StateCard({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 mt-2">{body}</p>
      {children}
    </motion.div>
  );
}

/** The platform brand mark: logo image + wordmark, centered. */
export const PartnerBrandMark: React.FC<{ logoSrc?: string }> = ({ logoSrc = PLATFORM_LOGO_URL }) => (
  <div className="flex items-center justify-center gap-2" aria-label="Nexora">
    <img src={logoSrc} alt="Nexora Logo" className="w-9 h-9 object-contain" />
    <span
      className="material-symbols-outlined text-[#C20E5A]"
      style={{ fontVariationSettings: "'FILL' 1" }}
      aria-hidden="true"
    >
      spa
    </span>
    <span className="text-2xl font-black tracking-tighter text-[#C20E5A]">Nexora</span>
  </div>
);

/**
 * The password field with its Show/Hide toggle. `type` flips between
 * `password` and `text`; the button's label and aria state follow it.
 */
export const PartnerPasswordField: React.FC<{
  id: string;
  label: string;
  value: string;
  showPassword: boolean;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onToggleShowPassword: () => void;
}> = ({ id, label, value, showPassword, autoComplete, placeholder, disabled, error, onChange, onToggleShowPassword }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-bold text-slate-800">
      {label}
    </label>
    <div className="relative mt-1.5">
      <input
        id={id}
        name={id}
        type={showPassword ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-xl border bg-white px-4 py-3 pr-12 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-500 disabled:opacity-60 ${
          error ? 'border-rose-400' : 'border-slate-200'
        }`}
      />
      <button
        type="button"
        id={`${id}-toggle`}
        onClick={onToggleShowPassword}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        aria-pressed={showPassword}
        title={showPassword ? 'Hide password' : 'Show password'}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex items-center justify-center w-11 rounded-r-xl text-slate-500 hover:text-slate-900 cursor-pointer disabled:opacity-60"
      >
        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
    {error && (
      <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
        {error}
      </p>
    )}
  </div>
);

/**
 * The PART 2 login form: logo, "Growth Partner Login" heading, email,
 * password (+ show/hide), Remember me, Forgot Password, submit with loading
 * and error states. Purely presentational — the container below owns state.
 */
export const PartnerPortalLoginForm: React.FC<{
  email: string;
  password: string;
  showPassword: boolean;
  rememberMe: boolean;
  fieldErrors: { email?: string; password?: string };
  formError: string;
  busy: boolean;
  accentHex?: string;
  logoSrc?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onToggleShowPassword: () => void;
  onToggleRememberMe: (checked: boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
  onForgotPassword: () => void;
  onSwitchToSignup: () => void;
}> = ({
  email,
  password,
  showPassword,
  rememberMe,
  fieldErrors,
  formError,
  busy,
  accentHex = '#C20E5A',
  logoSrc,
  onEmailChange,
  onPasswordChange,
  onToggleShowPassword,
  onToggleRememberMe,
  onSubmit,
  onForgotPassword,
  onSwitchToSignup,
}) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <PartnerBrandMark logoSrc={logoSrc} />
      <div className="mt-5 text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner Portal</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{PARTNER_PORTAL_LOGIN_TITLE}</h1>
        <p className="mt-1 text-sm text-slate-600">{PARTNER_PORTAL_LOGIN_SUBTITLE}</p>
      </div>
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(event);
        }}
      >
        <Field
          id="partner-login-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={busy}
          error={fieldErrors.email}
          onChange={onEmailChange}
        />
        <PartnerPasswordField
          id="partner-login-password"
          label="Password"
          value={password}
          showPassword={showPassword}
          autoComplete="current-password"
          placeholder="Your password"
          disabled={busy}
          error={fieldErrors.password}
          onChange={onPasswordChange}
          onToggleShowPassword={onToggleShowPassword}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label
            htmlFor="partner-login-remember"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer select-none"
          >
            <input
              id="partner-login-remember"
              name="partner-login-remember"
              type="checkbox"
              checked={rememberMe}
              disabled={busy}
              onChange={(event) => onToggleRememberMe(event.target.checked)}
              className="w-4 h-4 cursor-pointer"
              style={{ accentColor: accentHex }}
            />
            Remember me
          </label>
          <button
            type="button"
            id="partner-login-forgot"
            onClick={onForgotPassword}
            disabled={busy}
            className="text-sm font-bold text-slate-900 underline underline-offset-2 hover:opacity-80 cursor-pointer disabled:opacity-60"
          >
            Forgot Password?
          </button>
        </div>
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Signing in…" accentHex={accentHex}>
          Log in
        </SubmitButton>
        <button
          type="button"
          onClick={onSwitchToSignup}
          disabled={busy}
          className="w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-60"
        >
          Apply as a Growth Partner
        </button>
      </form>
    </motion.div>
  </main>
);

/** Forgot-password request form (real Supabase reset email, safe copy). */
export const PartnerForgotPasswordForm: React.FC<{
  email: string;
  busy: boolean;
  error: string;
  success: string;
  accentHex?: string;
  logoSrc?: string;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onBack: () => void;
}> = ({ email, busy, error, success, accentHex = '#C20E5A', logoSrc, onEmailChange, onSubmit, onBack }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <PartnerBrandMark logoSrc={logoSrc} />
      <div className="mt-5 text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner Portal</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Reset your password</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter your Growth Partner email and we will send a password reset link.
        </p>
      </div>
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(event);
        }}
      >
        <Field
          id="partner-forgot-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={busy}
          onChange={onEmailChange}
        />
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {success && <FormAlert tone="success">{success}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Sending…" accentHex={accentHex}>
          Send reset link
        </SubmitButton>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-60"
        >
          Back to login
        </button>
      </form>
    </motion.div>
  </main>
);

/**
 * Set-a-new-password form, shown while a PASSWORD_RECOVERY session is live
 * (the reset link signed the partner in). Submitting calls Supabase
 * updateUser; afterwards the normal role verification decides where to go.
 */
export const PartnerSetPasswordForm: React.FC<{
  email: string;
  password: string;
  confirm: string;
  showPassword: boolean;
  busy: boolean;
  error: string;
  success: string;
  accentHex?: string;
  logoSrc?: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onToggleShowPassword: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onSkip: () => void;
}> = ({
  email,
  password,
  confirm,
  showPassword,
  busy,
  error,
  success,
  accentHex = '#C20E5A',
  logoSrc,
  onPasswordChange,
  onConfirmChange,
  onToggleShowPassword,
  onSubmit,
  onSkip,
}) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <PartnerBrandMark logoSrc={logoSrc} />
      <div className="mt-5 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
          <KeyRound className="w-6 h-6 text-slate-500" />
        </div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner Portal</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Choose a new password</h1>
        <p className="mt-1 text-sm text-slate-600">
          {email ? (
            <>
              Setting a new password for <span className="font-semibold text-slate-900">{email}</span>.
            </>
          ) : (
            'Set a new password for your Growth Partner account.'
          )}
        </p>
      </div>
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(event);
        }}
      >
        <PartnerPasswordField
          id="partner-new-password"
          label="New password"
          value={password}
          showPassword={showPassword}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          disabled={busy}
          onChange={onPasswordChange}
          onToggleShowPassword={onToggleShowPassword}
        />
        <PartnerPasswordField
          id="partner-confirm-password"
          label="Confirm new password"
          value={confirm}
          showPassword={showPassword}
          autoComplete="new-password"
          placeholder="Repeat the new password"
          disabled={busy}
          onChange={onConfirmChange}
          onToggleShowPassword={onToggleShowPassword}
        />
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {success && <FormAlert tone="success">{success}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Updating…" accentHex={accentHex}>
          Update password
        </SubmitButton>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-60"
        >
          Skip for now
        </button>
      </form>
    </motion.div>
  </main>
);

export const PartnerPortalVerifying: React.FC<{ logoSrc?: string }> = ({ logoSrc }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <div
      role="status"
      aria-label={PARTNER_PORTAL_LOGIN_VERIFYING_LABEL}
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <PartnerBrandMark logoSrc={logoSrc} />
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mt-6 mb-4" />
      <p className="text-sm font-bold text-slate-700">{PARTNER_PORTAL_LOGIN_VERIFYING_LABEL}</p>
    </div>
  </main>
);

export const PartnerPortalMockNotice: React.FC<{ onBack?: () => void; logoSrc?: string }> = ({ onBack, logoSrc }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <StateCard
      icon={<AlertCircle className="w-7 h-7 text-slate-400" />}
      title={PARTNER_PORTAL_LOGIN_MOCK_TITLE}
      body={PARTNER_PORTAL_LOGIN_MOCK_BODY}
    >
      <p className="mt-4 text-xs text-slate-500">
        Fill in the Supabase variables from <code className="font-mono">.env.example</code> (or set{' '}
        <code className="font-mono">LOCAL_SUPABASE=true</code> for the local gateway), restart the app, and this page
        becomes a real sign-in.
      </p>
      <PartnerBrandMark logoSrc={logoSrc} />
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
    </StateCard>
  </main>
);

/** The exact denial the spec requires for non-partners on `/partner/*`. */
export const PartnerPortalUnauthorized: React.FC<{
  onBack?: () => void;
  onSwitchAccount?: () => void;
}> = ({ onBack, onSwitchAccount }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={PARTNER_PORTAL_UNAUTHORIZED_TITLE}
      body={PARTNER_PORTAL_UNAUTHORIZED_BODY}
    >
      <p className="mt-2 text-xs text-slate-500">{PARTNER_PORTAL_UNAUTHORIZED_HINT}</p>
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
      <button
        type="button"
        onClick={() => onSwitchAccount?.()}
        className="mt-3 w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
      >
        Sign in with a different account
      </button>
    </StateCard>
  </main>
);

export const PartnerPortalPendingReview: React.FC<{
  submittedAt?: string | null;
  onBack?: () => void;
  onCheckAgain?: () => void;
  onSwitchAccount?: () => void;
}> = ({ submittedAt, onBack, onCheckAgain, onSwitchAccount }) => {
  const submittedLabel = (() => {
    if (!submittedAt) return '';
    const parsed = new Date(submittedAt);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
  })();
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
      <StateCard
        icon={<Hourglass className="w-7 h-7 text-slate-400" />}
        title={PARTNER_PORTAL_PENDING_TITLE}
        body={PARTNER_PORTAL_PENDING_BODY}
      >
        {submittedLabel ? (
          <p className="mt-3 text-xs text-slate-500" data-testid="partner-pending-submitted">
            Submitted {submittedLabel}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => onCheckAgain?.()}
          className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-900 text-white transition-opacity hover:opacity-90"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Check again
          </span>
        </button>
        <button
          type="button"
          onClick={() => onBack?.()}
          className="mt-3 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
        >
          Back to app
        </button>
        <button
          type="button"
          onClick={() => onSwitchAccount?.()}
          className="mt-3 w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
        >
          Sign in with a different account
        </button>
      </StateCard>
    </main>
  );
};

export const PartnerPortalRejected: React.FC<{
  onBack?: () => void;
  onSwitchAccount?: () => void;
}> = ({ onBack, onSwitchAccount }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={PARTNER_PORTAL_REJECTED_TITLE}
      body={PARTNER_PORTAL_REJECTED_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
      <button
        type="button"
        onClick={() => onSwitchAccount?.()}
        className="mt-3 w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
      >
        Sign in with a different account
      </button>
    </StateCard>
  </main>
);

export const PartnerPortalInactive: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_INACTIVE_TITLE}
      body={GROWTH_PARTNER_INACTIVE_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
    </StateCard>
  </main>
);

export const PartnerPortalFailure: React.FC<{
  title: string;
  body: string;
  actionLabel: string;
  onAction?: () => void;
}> = ({ title, body, actionLabel, onAction }) => (
  <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
    <StateCard icon={<AlertCircle className="w-7 h-7 text-rose-500" />} title={title} body={body}>
      <button
        type="button"
        onClick={() => onAction?.()}
        className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 bg-slate-900"
      >
        {actionLabel}
      </button>
    </StateCard>
  </main>
);

type PartnerPortalMode = 'login' | 'signup' | 'forgot' | 'set-password';

function viewerFromSessionUser(user: { id?: unknown; email?: unknown; app_metadata?: unknown } | null | undefined): GrowthPartnerViewer | null {
  if (!user?.id) return null;
  return {
    id: String(user.id),
    email: typeof user.email === 'string' ? user.email : '',
    isAdmin: (user.app_metadata as { is_admin?: unknown } | undefined)?.is_admin === true,
  };
}

export const PartnerPortalLogin: React.FC<{
  /** The app's restored session user (null = signed out). Verified again below. */
  user?: { id?: string; email?: string } | null;
  navigate?: (to: string) => void;
  onBack?: () => void;
  accentHex?: string;
  /** Injectable in tests; defaults to the shared anon-key client. */
  client?: PartnerPortalAuthClient;
  /** Injectable logo (defaults to the platform logo). */
  logoSrc?: string;
}> = ({ user, navigate, onBack, accentHex = '#C20E5A', client, logoSrc }) => {
  const sb = useMemo(
    () => client ?? (supabase as unknown as PartnerPortalAuthClient),
    [client]
  );
  // Authorization read through the SAME source as the auth actions: an
  // injected client supplies its own role read; otherwise the default
  // RLS SELECT-own-row query is used (they are the same client in production).
  const readPartnerRow = client?.fetchPartnerRow ?? fetchMyGrowthPartnerRow;
  const readApplicationRow = client?.fetchApplicationRow ?? fetchMyGrowthPartnerApplication;

  // Session source of truth for this route: seed from the app's restored user
  // for first paint, then re-verify against the live Supabase session so a
  // revoked/expired session can never carry a partner in.
  const [sessionUser, setSessionUser] = useState<GrowthPartnerViewer | null>(() =>
    user?.id ? { id: String(user.id), email: typeof user.email === 'string' ? user.email : '' } : null
  );
  const [partnerRow, setPartnerRow] = useState<GrowthPartner | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // The caller's own application, so "under review" and "not approved" are
  // distinct screens from "you never applied". Admin review queue follows.
  const [application, setApplication] = useState<GrowthPartnerApplicationRow | null>(null);
  const [queue, setQueue] = useState<GrowthPartnerApplicationQueueRow[]>([]);
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState('');
  // If a session user is already seeded (deep link / already-signed-in), the
  // role check is about to run — start "verifying" so the first paint never
  // flashes a denial card for a valid partner.
  const [verifying, setVerifying] = useState<boolean>(() => !!user?.id);
  const [attempt, setAttempt] = useState(0);

  // Form state.
  const [mode, setMode] = useState<PartnerPortalMode>('login');
  const [email, setEmail] = useState<string>(() => readRememberedPartnerEmail());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState('');

  // Forgot-password state.
  const [forgotEmail, setForgotEmail] = useState<string>(() => readRememberedPartnerEmail());
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  // Password-recovery (set-a-new-password) state.
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  // 1) Verify the live session (page refresh / already-signed-in path).
  useEffect(() => {
    if (isMockSupabase && !client) return;
    let cancelled = false;
    (async () => {
      try {
        const viewer = await loadGrowthPartnerSession(sb);
        if (!cancelled) setSessionUser(viewer);
      } catch {
        // A failed session read is not an access grant: leave the seeded state
        // and let the role fetch below surface any auth error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, client]);

  // 1b) Listen for the auth events this page must react to. PASSWORD_RECOVERY
  //     is what the reset link produces (detectSessionInUrl signs the recovery
  //     session in); it switches the page to the set-a-new-password form.
  useEffect(() => {
    const subscribe = sb.auth.onAuthStateChange;
    if (!subscribe) return;
    const { data } = subscribe((event: string, session: any) => {
      if (event === 'PASSWORD_RECOVERY') {
        const viewer = viewerFromSessionUser(session?.user);
        if (viewer) {
          setSessionUser(viewer);
          setMode('set-password');
          setNewPassword('');
          setNewPasswordConfirm('');
          setResetError('');
          setResetSuccess('');
        }
        return;
      }
      if (event === 'SIGNED_OUT') {
        setSessionUser(null);
        setPartnerRow(null);
        setApplication(null);
        setMode((current) => (current === 'set-password' ? 'login' : current));
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        const viewer = viewerFromSessionUser(session?.user);
        if (viewer) setSessionUser(viewer);
      }
    });
    return () => {
      data?.subscription?.unsubscribe?.();
    };
  }, [sb]);

  // 2) Verify the backend role whenever a session user exists.
  useEffect(() => {
    const userId = sessionUser?.id ?? null;
    if (!userId || (isMockSupabase && !client)) {
      // No session, or a live Supabase connection is unavailable and no test
      // client was injected: nothing to verify (and no placeholder-host call).
      setVerifying(false);
      setPartnerRow(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setVerifying(true);
    setLoadError(null);
    (async () => {
      try {
        const row = await readPartnerRow();
        if (cancelled) return;
        setPartnerRow(row);
        setLoadError(null);
        if (row) {
          if (!cancelled) setApplication(null);
        } else {
          // No partner row yet: separate "applied, under review" and "not
          // approved" from "never applied". A failed lookup is never an
          // access grant, so it falls back to the unauthorized card.
          const own = (await readApplicationRow().catch(() => null)) as GrowthPartnerApplicationRow | null;
          if (!cancelled) setApplication(own);
        }
      } catch (error) {
        if (cancelled) return;
        setPartnerRow(null);
        setLoadError(error);
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUser?.id, attempt, readPartnerRow, readApplicationRow, client]);

  const state: PartnerPortalLoginState = resolvePartnerPortalLogin({
    loading: verifying,
    isMockMode: isMockSupabase && !client,
    userId: sessionUser?.id ?? null,
    partnerRow,
    loadError,
    applicationStatus: application?.status ?? null,
  });

  // 2b) Load the admin review queue for an admin account. The backend refuses
  //     non-admins, so this is only ever data an admin is allowed to see.
  useEffect(() => {
    if (!sessionUser?.isAdmin) {
      setQueue([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listGrowthPartnerApplications('pending');
        if (!cancelled) {
          setQueue(rows);
          setQueueError('');
        }
      } catch (error) {
        if (!cancelled) {
          setQueue([]);
          setQueueError(error instanceof Error ? error.message : 'Could not load the application queue');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUser?.isAdmin, attempt]);

  const handleDecide = (row: GrowthPartnerApplicationQueueRow, approve: boolean) => {
    setQueueBusyId(row.id);
    setQueueError('');
    void decideGrowthPartnerApplication({
      applicationId: row.id,
      approve,
      note: approve ? 'Approved' : 'Rejected',
    })
      .then(() => {
        setQueue((current) => current.filter((item) => item.id !== row.id));
        // If the applicant is signed in on this device, re-check their access.
        setAttempt((value) => value + 1);
      })
      .catch((error: unknown) => {
        setQueueError(error instanceof Error ? error.message : 'Could not update that application');
      })
      .finally(() => setQueueBusyId(null));
  };

  // 3) A verified ACTIVE partner never sees the login form twice: forward to
  //    the dashboard (which re-verifies). The set-password step holds the
  //    forward until the new password is set (or skipped) so a reset link
  //    never dumps the partner straight into the dashboard. Loop-free: the
  //    dashboard is a different path.
  useEffect(() => {
    if (state === 'granted' && mode !== 'set-password') navigate?.(PARTNER_DASHBOARD_PATH);
  }, [state, mode, navigate]);

  const clearSession = async () => {
    await signOutGrowthPartner(sb);
    clearAuthSessionLifetime();
    setSessionUser(null);
    setPartnerRow(null);
    setApplication(null);
    setLoadError(null);
    setFormError('');
    setFieldErrors({});
    setMode('login');
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const errors: { email?: string; password?: string } = {};
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    setBusy(true);
    setFormError('');
    // "Remember me" decides which browser store holds the session BEFORE the
    // credentials are submitted; a failed attempt reverts the choice so an
    // existing remembered session is never destroyed.
    const revertLifetime = beginPartnerSessionLifetime(rememberMe);
    void signInGrowthPartner(sb, { email, password }).then(
      (viewer) => {
        writeRememberedPartnerEmail(email.trim(), rememberMe);
        finishPartnerSessionLifetime(rememberMe);
        setSessionUser(viewer);
      },
      (error: Error) => {
        revertLifetime();
        setFormError(error?.message || 'Login failed. Please try again.');
      }
    ).finally(() => setBusy(false));
  };

  const handleForgotSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (forgotBusy) return;
    setForgotError('');
    setForgotSuccess('');
    if (!EMAIL_RE.test(forgotEmail.trim())) {
      setForgotError('Enter a valid email address.');
      return;
    }
    setForgotBusy(true);
    void sendPartnerPasswordReset(sb, forgotEmail.trim()).then(
      () => setForgotSuccess(PARTNER_RESET_REQUESTED_MESSAGE),
      (error: Error) => setForgotError(error?.message || 'Password reset failed. Please try again.')
    ).finally(() => setForgotBusy(false));
  };

  const handleSetPasswordSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (resetBusy) return;
    setResetError('');
    setResetSuccess('');
    const check = validatePartnerNewPassword(newPassword, newPasswordConfirm);
    if (check.ok === false) {
      setResetError(check.message);
      return;
    }
    setResetBusy(true);
    void completePartnerPasswordReset(sb, newPassword).then(
      () => {
        setResetSuccess(PARTNER_PASSWORD_UPDATED_MESSAGE);
        // The recovery session is already live; let the role verification (or
        // the forward effect) take over once the mode clears.
        setMode('login');
        setNewPassword('');
        setNewPasswordConfirm('');
      },
      (error: Error) => setResetError(error?.message || 'Could not update the password. Please try again.')
    ).finally(() => setResetBusy(false));
  };

  const handleSignup = (input: {
    fullName: string;
    phone: string;
    email: string;
    password: string;
    kycDocumentType: string;
    kycDocumentReference: string;
  }) => {
    if (
      !input.fullName.trim() ||
      !EMAIL_RE.test(input.email.trim()) ||
      input.password.length < 8 ||
      !input.kycDocumentType ||
      !input.kycDocumentReference.trim()
    ) {
      setFormError('Enter your name, valid email, 8+ character password, and KYC details.');
      return;
    }
    setBusy(true);
    setFormError('');
    setSignupSuccess('');
    void signUpGrowthPartner(sb, input).then(
      (result) => {
        setSignupSuccess(
          result.confirmed
            ? 'Application submitted. We will review it and email you after approval.'
            : 'Account created. Verify your email, then return here to sign in and submit your application.'
        );
      },
      (error: Error) => setFormError(error.message || 'Signup failed. Please try again.')
    ).finally(() => setBusy(false));
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (state === 'mock-mode') return <PartnerPortalMockNotice onBack={onBack} logoSrc={logoSrc} />;

  // The reset link signed the partner in: show the new-password form until it
  // is set (or skipped), whatever the role check concluded meanwhile.
  if (mode === 'set-password' && sessionUser) {
    return (
      <PartnerSetPasswordForm
        email={sessionUser.email}
        password={newPassword}
        confirm={newPasswordConfirm}
        showPassword={showPassword}
        busy={resetBusy}
        error={resetError}
        success={resetSuccess}
        accentHex={accentHex}
        logoSrc={logoSrc}
        onPasswordChange={setNewPassword}
        onConfirmChange={setNewPasswordConfirm}
        onToggleShowPassword={() => setShowPassword((value) => !value)}
        onSubmit={handleSetPasswordSubmit}
        onSkip={() => setMode('login')}
      />
    );
  }

  if (state === 'loading' || state === 'granted') return <PartnerPortalVerifying logoSrc={logoSrc} />;

  if (state === 'signed-out' && mode === 'signup') {
    return (
      <GrowthPartnerSignupForm
        busy={busy}
        formError={formError}
        success={signupSuccess}
        accentHex={accentHex}
        onSubmit={handleSignup}
        onBack={() => {
          setMode('login');
          setFormError('');
        }}
      />
    );
  }

  if (state === 'signed-out' && mode === 'forgot') {
    return (
      <PartnerForgotPasswordForm
        email={forgotEmail}
        busy={forgotBusy}
        error={forgotError}
        success={forgotSuccess}
        accentHex={accentHex}
        logoSrc={logoSrc}
        onEmailChange={(value) => {
          setForgotEmail(value);
          setForgotError('');
          setForgotSuccess('');
        }}
        onSubmit={handleForgotSubmit}
        onBack={() => {
          setMode('login');
          setForgotError('');
          setForgotSuccess('');
        }}
      />
    );
  }

  if (state === 'signed-out') {
    return (
      <PartnerPortalLoginForm
        email={email}
        password={password}
        showPassword={showPassword}
        rememberMe={rememberMe}
        fieldErrors={fieldErrors}
        formError={formError}
        busy={busy}
        accentHex={accentHex}
        logoSrc={logoSrc}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onToggleShowPassword={() => setShowPassword((value) => !value)}
        onToggleRememberMe={setRememberMe}
        onSubmit={handleSubmit}
        onForgotPassword={() => {
          setMode('forgot');
          setFormError('');
          setFieldErrors({});
          if (!forgotEmail.trim() && EMAIL_RE.test(email.trim())) setForgotEmail(email.trim());
        }}
        onSwitchToSignup={() => {
          setMode('signup');
          setFormError('');
        }}
      />
    );
  }

  if (state === 'pending-review') {
    return (
      <PartnerPortalPendingReview
        submittedAt={application?.created_at ?? null}
        onBack={onBack}
        onCheckAgain={() => setAttempt((value) => value + 1)}
        onSwitchAccount={() => void clearSession()}
      />
    );
  }

  if (state === 'rejected') {
    return <PartnerPortalRejected onBack={onBack} onSwitchAccount={() => void clearSession()} />;
  }

  if (state === 'unauthorized') {
    return (
      <>
        {sessionUser?.isAdmin ? (
          <div className="pt-16 px-4">
            <GrowthPartnerAdminReviewPanel
              rows={queue}
              busyId={queueBusyId}
              error={queueError}
              onRefresh={() => setAttempt((value) => value + 1)}
              onDecide={handleDecide}
            />
          </div>
        ) : null}
        <PartnerPortalUnauthorized onBack={onBack} onSwitchAccount={() => void clearSession()} />
      </>
    );
  }

  if (state === 'inactive') return <PartnerPortalInactive onBack={onBack} />;

  if (state === 'session-expired') {
    return (
      <PartnerPortalFailure
        title={PARTNER_PORTAL_SESSION_TITLE}
        body={PARTNER_PORTAL_SESSION_BODY}
        actionLabel="Sign in again"
        onAction={() => void clearSession()}
      />
    );
  }

  return (
    <PartnerPortalFailure
      title={PARTNER_PORTAL_ERROR_TITLE}
      body={PARTNER_PORTAL_ERROR_BODY}
      actionLabel="Retry"
      onAction={() => setAttempt((value) => value + 1)}
    />
  );
};
