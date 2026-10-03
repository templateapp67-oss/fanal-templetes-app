import { safePartnerErrorMessage } from '../lib/partnerUiErrors';
import { logPasswordLengths } from '../lib/authPasswordDiagnostics';
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
  LogIn,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import {
  fetchMyGrowthPartnerApplication,
  ensureMyGrowthPartner,
  fetchMyGrowthPartnerRow,
  isMissingPartnerSchemaError,
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
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
  submitGrowthPartnerApplication,
  signOutGrowthPartner,
  type GrowthPartnerViewer,
} from '../lib/growthPartnerLogin';
import { clearAllLocalUserState } from '../lib/salonStore';
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
import { toPartnerApplicationError } from '../lib/partnerApplicationErrors';
import {
  KYC_DOCUMENT_TYPES,
  kycDocumentSpec,
  normalizeKycReference,
  restrictKycReferenceInput,
  validatePartnerApplication,
  type PartnerApplicationFieldErrors,
} from '../lib/partnerApplicationValidation';
import {
  PARTNER_DASHBOARD_PATH,
  PARTNER_LOGIN_PATH,
  isGrowthPartnerLoginPath,
  isPartnerLoginPath,
} from '../lib/router';
import brandedLogo from '../assets/nexora-salonos-logo.png';
import partnerHero from '../assets/nexora-partner-hero.jpg';
import { Field, FormAlert, SubmitButton } from '../onboarding/screens/Shell';
import {
  GrowthPartnerAdminReviewPanel,
  GrowthPartnerSignupForm,
  validateGrowthPartnerSignupInput,
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
export const PartnerBrandMark: React.FC<{ logoSrc?: string }> = ({ logoSrc = brandedLogo }) => (
  <div className="flex items-center justify-center gap-2 transition-transform duration-300 hover:scale-105" aria-label="Nexora SalonOS">
    <img src={logoSrc} alt="Nexora SalonOS" className="h-12 w-12 rounded-xl object-contain shadow-sm" />
    <div className="text-left leading-none">
      <span className="block text-2xl font-black tracking-tight text-[#111827]">NEXORA</span>
      <span className="block text-[0.65rem] font-black tracking-[0.35em] text-[#C20E5A]">SALONOS</span>
    </div>
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
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <PartnerBrandMark logoSrc={logoSrc} />
      <img
        src={partnerHero}
        alt="Nexora partner growth showcase"
        className="mt-5 h-32 w-full rounded-2xl object-cover object-center shadow-inner"
      />
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
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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

/**
 * The exact denial the spec requires for non-partners on `/partner/*`.
 *
 * This is the default access-error card for a signed-in account that does not
 * have the Growth Partner role. It always offers BOTH ways forward, clearly:
 *
 *   • "Become a Growth Partner" (Sign Up) — start a new partner application
 *     with the current account;
 *   • "Sign In" (Login) — the DIRECT sign-in flow for visitors who already
 *     have a Growth Partner account: the current (non-partner) session is
 *     signed out and the partner login form opens immediately.
 *
 * The old "Sign in with a different account" wording is gone on purpose: it
 * read like an account-switcher instead of the login door it actually was.
 */
export const PartnerPortalUnauthorized: React.FC<{
  onBack?: () => void;
  /** Direct Login / Sign In flow for an existing Growth Partner account. */
  onSignIn?: () => void;
  /**
   * Legacy alias for `onSignIn` kept so older call sites keep working:
   * signing "out of this account and into another one" IS the direct
   * sign-in flow (it lands on the partner login form).
   */
  onSwitchAccount?: () => void;
  onApply?: () => void;
  /**
   * Why self-enrollment could not run (missing migration, a refusal, a network
   * failure). Shown as its own line so the visitor is not told to "try again"
   * for a problem an operator has to fix.
   */
  notice?: string | null;
}> = ({ onBack, onSignIn, onSwitchAccount, onApply, notice }) => {
  const handleSignIn = onSignIn ?? onSwitchAccount;
  return (
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={PARTNER_PORTAL_UNAUTHORIZED_TITLE}
      body={PARTNER_PORTAL_UNAUTHORIZED_BODY}
    >
      <p className="mt-2 text-xs text-slate-500">{PARTNER_PORTAL_UNAUTHORIZED_HINT}</p>
      {notice ? <p role="status" className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900">{notice}</p> : null}
      {/* Sign Up: apply for a brand-new Growth Partner account. */}
      <button
        type="button"
        onClick={() => onApply?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-900 text-white transition-opacity hover:opacity-90 shadow-sm"
      >
        Become a Growth Partner
      </button>
      {/* Sign In: promoted directly under Sign Up for existing partner accounts. */}
      <button
        type="button"
        onClick={() => handleSignIn?.()}
        className="mt-3 w-full py-3 rounded-xl border-2 border-slate-900 bg-white text-sm font-bold cursor-pointer text-slate-900 transition-opacity hover:opacity-80"
      >
        <span className="inline-flex items-center justify-center gap-2">
          <LogIn className="w-4 h-4" aria-hidden="true" />
          Sign In
        </span>
      </button>
      <p className="mt-2 text-xs text-slate-500">
        Already have a Growth Partner account? Sign in with it to open your partner dashboard.
      </p>
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-700 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
    </StateCard>
  </main>
  );
};

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
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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
        {/* Direct Sign In: opens the partner login form for an existing account. */}
        <button
          type="button"
          onClick={() => onSwitchAccount?.()}
          className="mt-3 w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
        >
          Sign In
        </button>
      </StateCard>
    </main>
  );
};

export const PartnerPortalRejected: React.FC<{
  onBack?: () => void;
  onSwitchAccount?: () => void;
}> = ({ onBack, onSwitchAccount }) => (
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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
      {/* Direct Sign In: opens the partner login form for an existing account. */}
      <button
        type="button"
        onClick={() => onSwitchAccount?.()}
        className="mt-3 w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
      >
        Sign In
      </button>
    </StateCard>
  </main>
);

export const PartnerPortalInactive: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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
  <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
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

type PartnerPortalMode = 'login' | 'signup' | 'apply' | 'forgot' | 'set-password';

/** Title of the screen a successful submission lands on (spec copy). */
export const PARTNER_APPLICATION_PENDING_TITLE = 'Application submitted';
export const PARTNER_APPLICATION_PENDING_BODY =
  'Your application was saved. Continue to your partner dashboard.';

/**
 * The signed-in "Become a Growth Partner" application form.
 *
 * What changed (the "Application failed. Please try again." report):
 *   • every field is validated BEFORE the request, with the same rules the
 *     database enforces — a 10-digit phone, a 12-digit Aadhaar number, a real
 *     PAN/Passport format — so the user is told "Invalid Aadhaar number"
 *     instead of a whole-form failure;
 *   • the submit button is disabled and shows a spinner while the request is
 *     pending, and every field is disabled with it, which makes a double
 *     submission impossible (the backend refuses duplicates too);
 *   • the server's answer is classified, so the alert says "You have already
 *     submitted an application", "Network error…" or "Your session expired…"
 *     with a sign-in action — never a generic failure;
 *   • the typed values survive a failed submit: nothing is cleared, only the
 *     offending field is marked.
 */
export const PartnerApplicationForm: React.FC<{
  busy: boolean;
  /** Form-level message (server/network/session failure). */
  error?: string;
  /** Field-level messages from the last attempt. */
  fieldErrors?: PartnerApplicationFieldErrors;
  /** True when the last failure means the session is gone. */
  needsSignIn?: boolean;
  accentHex?: string;
  logoSrc?: string;
  onSubmit: (input: { fullName: string; phone: string; kycDocumentType: string; kycDocumentReference: string }) => void;
  onBack: () => void;
  /** Sign in again (offered when `needsSignIn`). */
  onSignIn: () => void;
}> = ({
  busy,
  error = '',
  fieldErrors: externalFieldErrors,
  needsSignIn = false,
  accentHex = '#C20E5A',
  logoSrc,
  onSubmit,
  onBack,
  onSignIn,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [kycDocumentType, setKycDocumentType] = useState('');
  const [kycDocumentReference, setKycDocumentReference] = useState('');
  // Re-validate on every keystroke only AFTER an attempt, so a pristine form
  // never shows errors while the user is still typing.
  const [submitted, setSubmitted] = useState(false);
  const [localErrors, setLocalErrors] = useState<PartnerApplicationFieldErrors>({});

  const spec = kycDocumentSpec(kycDocumentType);

  // Merge external (server) field errors with local validation errors.
  // Server errors take precedence so the user sees exactly what the backend rejected.
  const fieldErrors: PartnerApplicationFieldErrors = {
    ...localErrors,
    ...(externalFieldErrors ?? {}),
  };

  const clearFieldError = (field: keyof PartnerApplicationFieldErrors) => {
    setLocalErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // The guard that makes a double submission impossible even if the disabled
    // button is somehow activated (double-click, Enter keypress, autofill).
    if (busy) return;
    setSubmitted(true);
    // The submitted form controls are the source of truth: browser autofill can
    // fill the DOM without dispatching a React change event.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const values = {
      fullName: String(form.get('partner-apply-name') ?? fullName),
      phone: String(form.get('partner-apply-phone') ?? phone),
      kycDocumentType: String(form.get('partner-apply-kyc-type') ?? kycDocumentType),
      kycDocumentReference: String(form.get('partner-apply-kyc-reference') ?? kycDocumentReference),
    };
    setFullName(values.fullName);
    setPhone(values.phone);
    setKycDocumentType(values.kycDocumentType);
    setKycDocumentReference(values.kycDocumentReference);

    const validated = validatePartnerApplication(values);
    setLocalErrors(validated.errors);
    if (!validated.ok) return;
    onSubmit({
      fullName: values.fullName,
      phone: values.phone,
      kycDocumentType: values.kycDocumentType,
      kycDocumentReference: values.kycDocumentReference,
    });
  };

  // Live re-validation after the first attempt.
  const revalidate = (next: {
    fullName?: string;
    phone?: string;
    kycDocumentType?: string;
    kycDocumentReference?: string;
  }) => {
    if (!submitted) return;
    const result = validatePartnerApplication({
      fullName: next.fullName ?? fullName,
      phone: next.phone ?? phone,
      kycDocumentType: next.kycDocumentType ?? kycDocumentType,
      kycDocumentReference: next.kycDocumentReference ?? kycDocumentReference,
    });
    setLocalErrors(result.errors);
  };

  const inputClass = (invalid?: string) =>
    `mt-1.5 w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-500 disabled:opacity-60 ${
      invalid ? 'border-rose-400' : 'border-slate-200'
    }`;

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
      <form
        className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-4"
        aria-busy={busy || undefined}
        onSubmit={handleSubmit}
      >
        <PartnerBrandMark logoSrc={logoSrc} />
        <h1 className="text-2xl font-bold text-slate-900">Become a Growth Partner</h1>
        <p className="text-sm text-slate-600">
          Use your current account to submit a Growth Partner application. Your dashboard opens after submission.
        </p>

        <Field
          id="partner-apply-name"
          label="Full name"
          value={fullName}
          onChange={(value) => {
            setFullName(value);
            clearFieldError('fullName');
            revalidate({ fullName: value });
          }}
          disabled={busy}
          error={fieldErrors.fullName}
          autoComplete="name"
        />

        <Field
          id="partner-apply-phone"
          label="Phone (optional)"
          value={phone}
          onChange={(value) => {
            setPhone(value);
            clearFieldError('phone');
            revalidate({ phone: value });
          }}
          disabled={busy}
          error={fieldErrors.phone}
          autoComplete="tel"
          placeholder="9876543210"
        />

        <div>
          <label htmlFor="partner-apply-kyc-type" className="block text-sm font-bold text-slate-800">
            KYC document type
          </label>
          <select
            id="partner-apply-kyc-type"
            name="partner-apply-kyc-type"
            value={kycDocumentType}
            onChange={(event) => {
              const value = event.target.value;
              const nextRef = restrictKycReferenceInput(value, kycDocumentReference);
              setKycDocumentType(value);
              setKycDocumentReference(nextRef);
              clearFieldError('kycDocumentType');
              revalidate({ kycDocumentType: value, kycDocumentReference: nextRef });
            }}
            disabled={busy}
            aria-invalid={fieldErrors.kycDocumentType ? true : undefined}
            aria-describedby={fieldErrors.kycDocumentType ? 'partner-apply-kyc-type-error' : undefined}
            className={inputClass(fieldErrors.kycDocumentType)}
          >
            <option value="">Select document</option>
            {KYC_DOCUMENT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {fieldErrors.kycDocumentType ? (
            <p id="partner-apply-kyc-type-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
              {fieldErrors.kycDocumentType}
            </p>
          ) : null}
        </div>

        <Field
          id="partner-apply-kyc-reference"
          label="KYC reference number"
          value={kycDocumentReference}
          inputMode={spec?.inputMode}
          maxLength={spec?.maxLength}
          onChange={(value) => {
            const nextValue = restrictKycReferenceInput(kycDocumentType, value);
            setKycDocumentReference(nextValue);
            clearFieldError('kycDocumentReference');
            revalidate({ kycDocumentReference: nextValue });
          }}
          disabled={busy}
          error={fieldErrors.kycDocumentReference}
          placeholder={spec ? spec.placeholder : 'Reference only; do not upload a document here'}
        />
        {spec && !fieldErrors.kycDocumentReference ? (
          <p className="-mt-2 text-xs text-slate-500">
            {spec.hint}
            {spec.value === 'aadhaar' && kycDocumentReference.trim()
              ? ` (${normalizeKycReference('aadhaar', kycDocumentReference).length}/12 digits)`
              : ''}
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="space-y-2">
            <FormAlert tone="error">{error}</FormAlert>
            {needsSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                disabled={busy}
                className="w-full py-2.5 rounded-xl text-sm font-bold cursor-pointer bg-slate-900 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Sign in
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          aria-disabled={busy || undefined}
          className="w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          style={{ backgroundColor: accentHex }}
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Submitting…
            </>
          ) : (
            'Submit application'
          )}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-60"
        >
          Back
        </button>
      </form>
    </main>
  );
};

/**
 * Shown immediately after a successful submission: the application exists and
 * is waiting for review. It is a real state of the record (status `pending`),
 * not a local promise — the "Check status" action re-reads it from the backend.
 */
export const PartnerApplicationPending: React.FC<{
  submittedAt?: string | null;
  busy?: boolean;
  onCheckStatus?: () => void;
  onBack?: () => void;
}> = ({ submittedAt, busy = false, onCheckStatus, onBack }) => {
  const submittedLabel = (() => {
    if (!submittedAt) return '';
    const parsed = new Date(submittedAt);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
  })();
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
      <StateCard
        icon={<Hourglass className="w-7 h-7 text-slate-400" />}
        title={PARTNER_APPLICATION_PENDING_TITLE}
        body={PARTNER_APPLICATION_PENDING_BODY}
      >
        {submittedLabel ? (
          <p className="mt-3 text-xs text-slate-500" data-testid="partner-application-submitted">
            Submitted {submittedLabel}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => onCheckStatus?.()}
          disabled={busy}
          className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-900 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" />}
            Check application status
          </span>
        </button>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
        >
          Back to app
        </button>
      </StateCard>
    </main>
  );
};

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
  onLogout?: () => void;
}> = ({ user, navigate, onBack, accentHex = '#C20E5A', client, logoSrc, onLogout }) => {
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
  // Kept separate from `loadError`: a failed self-enrollment is NOT a failed
  // verification (the row read already answered), so it must not blank the
  // page with the generic error card.
  const [enrollmentError, setEnrollmentError] = useState<unknown>(null);
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

  const [applicationFieldErrors, setApplicationFieldErrors] = useState<PartnerApplicationFieldErrors>({});
  const [applicationNeedsSignIn, setApplicationNeedsSignIn] = useState(false);

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
    const { data } = subscribe.call(sb.auth, (event: string, session: any) => {
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
    setEnrollmentError(null);
    (async () => {
      try {
        let row = await readPartnerRow();
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
          if ((!client || client.ensurePartnerRow) && (own?.status === 'pending' || own?.status === 'approved' || (!own && client?.ensurePartnerRow))) {
            try {
              await (client?.ensurePartnerRow ?? ensureMyGrowthPartner)();
            } catch (error) {
              if (!cancelled) { setEnrollmentError(error); setApplication(own); }
              return;
            }
            row = await readPartnerRow();
            if (!row) throw new Error('Could not finish partner dashboard setup. Please retry.');
            if (!cancelled) { setPartnerRow(row); setApplication(null); }
          } else if (!cancelled) setApplication(own);
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
          setQueueError(safePartnerErrorMessage(error, 'Could not load the application queue'));
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
        setQueueError(safePartnerErrorMessage(error, 'Could not update that application'));
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
    clearAllLocalUserState();
    onLogout?.();
    setSessionUser(null);
    setPartnerRow(null);
    setApplication(null);
    setLoadError(null);
    setFormError('');
    setFieldErrors({});
    setMode('login');
  };

  /**
   * The DIRECT Login / Sign In flow for visitors who already have a Growth
   * Partner account but are currently denied (signed in with a non-partner
   * account, or holding a stale session). It signs the current session out,
   * opens the partner login form immediately and — when this card is shown
   * on a protected URL rather than the login route itself — redirects to the
   * dedicated login page (`/partner/login`).
   */
  const handleDirectSignIn = async () => {
    await clearSession();
    if (typeof window !== 'undefined') {
      const path = window.location?.pathname || '';
      if (!isPartnerLoginPath(path) && !isGrowthPartnerLoginPath(path)) {
        navigate?.(PARTNER_LOGIN_PATH);
      }
    }
  };

  // If the visitor navigated with ?switch=1 or ?signout=1, auto-clear stale non-partner session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const search = window.location?.search || '';
      const params = new URLSearchParams(search);
      if (
        params.get('switch') === '1' ||
        params.get('switch') === 'true' ||
        params.get('signout') === '1' ||
        params.get('logout') === '1'
      ) {
        void clearSession();
      }
    } catch {}
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // The submitted form controls are the source of truth, not component
    // state: browser autofill can fill the DOM without dispatching React
    // change events, which would otherwise sign in with a stale password.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const submittedEmail = String(form.get('partner-login-email') ?? email);
    const submittedPassword = String(form.get('partner-login-password') ?? password);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    logPasswordLengths('partner-portal:login', password, submittedPassword);
    const errors: { email?: string; password?: string } = {};
    if (!EMAIL_RE.test(submittedEmail.trim())) errors.email = 'Enter a valid email address.';
    if (!submittedPassword) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    setBusy(true);
    setFormError('');
    // "Remember me" decides which browser store holds the session BEFORE the
    // credentials are submitted; a failed attempt reverts the choice so an
    // existing remembered session is never destroyed.
    const revertLifetime = beginPartnerSessionLifetime(rememberMe);
    void signInGrowthPartner(sb, { email: submittedEmail, password: submittedPassword }).then(
      (viewer) => {
        writeRememberedPartnerEmail(submittedEmail.trim(), rememberMe);
        finishPartnerSessionLifetime(rememberMe);
        setSessionUser(viewer);
      },
      (error: Error) => {
        revertLifetime();
        setFormError(safePartnerErrorMessage(error, 'Login failed. Please try again.'));
      }
    ).finally(() => setBusy(false));
  };

  const handleForgotSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (forgotBusy) return;
    setForgotError('');
    setForgotSuccess('');
    // The submitted form controls are the source of truth, not component
    // state: browser autofill can fill the DOM without dispatching React
    // change events.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const submittedEmail = String(form.get('partner-forgot-email') ?? forgotEmail);
    setForgotEmail(submittedEmail);
    if (!EMAIL_RE.test(submittedEmail.trim())) {
      setForgotError('Enter a valid email address.');
      return;
    }
    setForgotBusy(true);
    void sendPartnerPasswordReset(sb, submittedEmail.trim()).then(
      () => setForgotSuccess(PARTNER_RESET_REQUESTED_MESSAGE),
      (error: Error) => setForgotError(safePartnerErrorMessage(error, 'Password reset failed. Please try again.'))
    ).finally(() => setForgotBusy(false));
  };

  const handleSetPasswordSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (resetBusy) return;
    setResetError('');
    setResetSuccess('');
    // The submitted form controls are the source of truth: validate exactly
    // what the user sees, then send exactly what was validated.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const submittedPassword = String(form.get('partner-new-password') ?? newPassword);
    const submittedConfirm = String(form.get('partner-confirm-password') ?? newPasswordConfirm);
    setNewPassword(submittedPassword);
    setNewPasswordConfirm(submittedConfirm);
    logPasswordLengths('partner-portal:set-password', newPassword, submittedPassword);
    const check = validatePartnerNewPassword(submittedPassword, submittedConfirm);
    if (check.ok === false) {
      setResetError(check.message);
      return;
    }
    setResetBusy(true);
    void completePartnerPasswordReset(sb, submittedPassword).then(
      () => {
        setResetSuccess(PARTNER_PASSWORD_UPDATED_MESSAGE);
        // The recovery session is already live; let the role verification (or
        // the forward effect) take over once the mode clears.
        setMode('login');
        setNewPassword('');
        setNewPasswordConfirm('');
      },
      (error: Error) => setResetError(safePartnerErrorMessage(error, 'Could not update the password. Please try again.'))
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
    const errors = validateGrowthPartnerSignupInput(input);
    if (Object.keys(errors).length > 0) {
      const specificError =
        errors.fullName ||
        errors.email ||
        errors.password ||
        errors.kycDocumentType ||
        errors.kycDocumentReference ||
        'Please check the form for errors.';
      setFormError(specificError);
      return;
    }
    setBusy(true);
    setFormError('');
    setSignupSuccess('');
    void signUpGrowthPartner(sb, input).then(
      (result) => {
        if (result.viewer) {
          setSessionUser(result.viewer);
          setAttempt((value) => value + 1);
        }
        if (result.applicationError) {
          // The account was created and the visitor is signed in, so switch to
          // the signed-in application view and surface the exact field/reason.
          setMode('apply');
          setFormError(`Account created, but your application was not submitted. ${result.applicationError.message}`);
          if (result.applicationError.kind === 'validation' && result.applicationError.field) {
            setApplicationFieldErrors({ [result.applicationError.field]: result.applicationError.message });
          }
          return;
        }
        setSignupSuccess(
          result.confirmed
            ? 'Application submitted. Opening your partner dashboard…'
            : 'Account created. Verify your email, then return here to sign in and submit your application.'
        );
      },
      (error: Error) => setFormError(safePartnerErrorMessage(error, 'Signup failed. Please try again.'))
    ).finally(() => setBusy(false));
  };

  /**
   * Submit the signed-in application.
   *
   * The failure path is the fix for the reported bug: instead of replacing
   * every error with "Application failed. Please try again.", the thrown value
   * is classified and rendered as the message the user can act on — with a
   * sign-in action for an expired session, a field marker for a validation
   * refusal, and the pending screen for a duplicate that turns out to be an
   * application this account already has.
   */
  const handleExistingUserApplication = (input: { fullName: string; phone: string; kycDocumentType: string; kycDocumentReference: string }) => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    setApplicationFieldErrors({});
    setApplicationNeedsSignIn(false);
    void submitGrowthPartnerApplication(
      sb,
      input,
      // The duplicate pre-check reads the caller's OWN application row through
      // the same source the gate used, so a stale screen cannot submit twice.
      { fetchApplicationRow: readApplicationRow }
    ).then(
      (result) => {
        setApplication({
          id: result.id ?? 'submitted',
          status: result.status || 'pending',
          kyc_status: result.kycStatus ?? 'submitted',
          created_at: result.createdAt ?? new Date().toISOString(),
        });
        setVerifying(true);
        setMode('login');
        setAttempt((value) => value + 1);
      },
      (error: unknown) => {
        const failure = toPartnerApplicationError(error);
        // For validation errors, prefer the original server message for the field
        // so the user sees the exact reason (e.g., "Invalid Aadhaar number...")
        // instead of a generic fallback. Only show form-level error for non-validation
        // failures (session, network, schema, etc.) or when no specific field is identified.
        if (failure.kind === 'validation' && failure.field) {
          setApplicationFieldErrors({ [failure.field]: failure.message });
          // Don't set a generic form error for validation failures — the inline
          // field error is more actionable. Only set formError for non-field errors.
        } else {
          setFormError(failure.message);
        }
        setApplicationNeedsSignIn(failure.kind === 'session');
      }
    ).finally(() => setBusy(false));
  };

  // A project that never had the Growth Partner migrations applied answers
  // PGRST202 for the gate read: say exactly that (with the setup pointer)
  // instead of "Please try again", which can never succeed.
  const schemaMissing = isMissingPartnerSchemaError(loadError) || isMissingPartnerSchemaError(enrollmentError);
  const enrollmentNotice = enrollmentError
    ? isMissingPartnerSchemaError(enrollmentError)
      ? GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE
      : 'Self-enrollment could not run for this account. Use "Become a Growth Partner" to submit your details.'
    : null;

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

  if (state === 'unauthorized' && mode === 'apply') {
    return (
      <PartnerApplicationForm
        busy={busy}
        error={formError}
        fieldErrors={applicationFieldErrors}
        needsSignIn={applicationNeedsSignIn}
        accentHex={accentHex}
        logoSrc={logoSrc}
        onSubmit={handleExistingUserApplication}
        onBack={() => {
          setMode('login');
          setFormError('');
          setApplicationFieldErrors({});
          setApplicationNeedsSignIn(false);
        }}
        onSignIn={() => {
            setMode('login');
          setFormError('');
          setApplicationFieldErrors({});
          setApplicationNeedsSignIn(false);
          setSessionUser(null);
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

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

  if (state === 'rejected') {
    return <PartnerPortalRejected onBack={onBack} onSwitchAccount={() => void clearSession()} />;
  }

  if (state === 'pending') {
    return <PartnerPortalPendingReview
      submittedAt={application?.created_at}
      onBack={onBack}
      onCheckAgain={() => setAttempt((value) => value + 1)}
      onSwitchAccount={() => void clearSession()}
    />;
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
        <PartnerPortalUnauthorized
          onBack={onBack}
          onSignIn={() => void handleDirectSignIn()}
          onApply={() => { setMode('apply'); setFormError(''); }}
          notice={enrollmentNotice}
        />
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
      body={schemaMissing ? GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE : PARTNER_PORTAL_ERROR_BODY}
      actionLabel="Retry"
      onAction={() => setAttempt((value) => value + 1)}
    />
  );
};
