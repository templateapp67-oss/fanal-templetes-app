import { safePartnerErrorMessage } from '../lib/partnerUiErrors';
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Check, Hourglass, Loader2, LogIn, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import {
  fetchMyGrowthPartnerApplication,
  fetchMyGrowthPartnerRow,
  ensureMyGrowthPartner,
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
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
  resolveGrowthPartnerLogin,
  signInGrowthPartner,
  signUpGrowthPartner,
  signOutGrowthPartner,
  type GrowthPartnerAuthClient,
  type GrowthPartnerLoginState,
  type GrowthPartnerViewer,
} from '../lib/growthPartnerLogin';
import { GROWTH_PARTNER_PATH } from '../lib/router';
import { Field, FormAlert, SubmitButton } from '../onboarding/screens/Shell';
import { logPasswordLengths } from '../lib/authPasswordDiagnostics';
import {
  isValidIndianMobile,
  KYC_DOCUMENT_TYPES,
  kycDocumentSpec,
  normalizeKycReference,
  normalizePhone,
  PARTNER_APPLICATION_MESSAGES,
  restrictKycReferenceInput,
  sanitizePersonName,
} from '../lib/partnerApplicationValidation';

// ============================================================================
// Growth Partner LOGIN route — `/growth-partner/login`.
//
//   • Email + password through Supabase Auth (signInWithPassword). No manual
//     password storage, no second auth system.
//   • After login (or on an already-live session) the backend role is verified
//     by reading the caller's OWN growth_partners row (RLS). A normal user gets
//     zero rows → unauthorized; an inactive partner gets their row → denied
//     (account and data untouched); an active partner is forwarded to the area.
//   • Access is never read from a frontend role flag, a stored value, the URL,
//     or React state — only fetchMyGrowthPartnerRow() decides.
// ============================================================================

export const GROWTH_PARTNER_LOGIN_TITLE = 'Growth Partner sign in';
export const GROWTH_PARTNER_LOGIN_SUBTITLE =
  'Sign in with your Growth Partner account to open your partner area.';
export const GROWTH_PARTNER_LOGIN_VERIFYING_LABEL = 'Checking your Growth Partner access…';
export const GROWTH_PARTNER_LOGIN_MOCK_TITLE = 'Growth Partner sign in needs a live connection';
export const GROWTH_PARTNER_LOGIN_MOCK_BODY =
  'Sign in needs Supabase Auth, which is not connected in this preview.';
export const GROWTH_PARTNER_LOGIN_UNAUTHORIZED_TITLE = 'Growth Partners only';
export const GROWTH_PARTNER_LOGIN_UNAUTHORIZED_BODY =
  'This account is not registered as a Growth Partner. If you were invited as one, sign in with that account.';
export const GROWTH_PARTNER_LOGIN_SESSION_TITLE = 'Your session expired';
export const GROWTH_PARTNER_LOGIN_SESSION_BODY = 'Please sign in again to continue.';
export const GROWTH_PARTNER_LOGIN_ERROR_TITLE = 'Could not verify your Growth Partner access';
export const GROWTH_PARTNER_LOGIN_ERROR_BODY = 'Please try again.';
export const GROWTH_PARTNER_SIGNUP_SUCCESS = 'Growth Partner access activated. Opening your dashboard…';
export const GROWTH_PARTNER_LOGIN_PENDING_TITLE = 'Could not finish opening your dashboard';
export const GROWTH_PARTNER_LOGIN_PENDING_BODY =
  'Please retry to complete your partner dashboard setup.';
export const GROWTH_PARTNER_ADMIN_QUEUE_TITLE = 'Growth Partner applications';
export const GROWTH_PARTNER_ADMIN_QUEUE_EMPTY = 'No applications are waiting for review.';

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

export const GrowthPartnerLoginForm: React.FC<{
  email: string;
  password: string;
  fieldErrors: { email?: string; password?: string };
  formError: string;
  busy: boolean;
  accentHex?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onSwitchToSignup: () => void;
}> = ({ email, password, fieldErrors, formError, busy, accentHex = '#C20E5A', onEmailChange, onPasswordChange, onSubmit, onSwitchToSignup }) => (
  <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{GROWTH_PARTNER_LOGIN_TITLE}</h1>
      <p className="mt-1 text-sm text-slate-600">{GROWTH_PARTNER_LOGIN_SUBTITLE}</p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <Field
          id="growth-partner-login-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={busy}
          error={fieldErrors.email}
          onChange={onEmailChange}
        />
        <Field
          id="growth-partner-login-password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="Your password"
          disabled={busy}
          error={fieldErrors.password}
          onChange={onPasswordChange}
        />
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Signing in…" accentHex={accentHex}>
          Sign in
        </SubmitButton>
        <button type="button" onClick={onSwitchToSignup} className="w-full text-sm font-bold text-slate-500 hover:text-slate-800">Apply as a Growth Partner</button>
      </form>
    </motion.div>
  </main>
);

export interface GrowthPartnerSignupInput {
  fullName: string;
  phone?: string;
  email: string;
  password: string;
  kycDocumentType: string;
  kycDocumentReference: string;
}

export interface GrowthPartnerSignupFieldErrors {
  fullName?: string;
  phone?: string;
  email?: string;
  password?: string;
  kycDocumentType?: string;
  kycDocumentReference?: string;
}

/**
 * Validate the sign-up form.
 *
 * The KYC rules are not re-written here: they come from the shared
 * `validatePartnerApplication` (src/lib/partnerApplicationValidation.ts), the
 * same module the signed-in "Become a Growth Partner" form uses and the same
 * rules the database enforces. That is what stops the two forms (and the two
 * sides of the wire) from drifting apart — before, neither checked the Aadhaar
 * or phone format at all, so malformed KYC was accepted and then reported as
 * "Application failed".
 */
export function validateGrowthPartnerSignupInput(
  input: Partial<GrowthPartnerSignupInput>
): GrowthPartnerSignupFieldErrors {
  const errors: GrowthPartnerSignupFieldErrors = {};

  const fullName = input.fullName?.trim() ?? '';
  if (!fullName) {
    errors.fullName = 'Enter your full name.';
  }

  const email = input.email?.trim() ?? '';
  if (!email) {
    errors.email = 'Enter your email address.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  const password = input.password ?? '';
  if (!password) {
    errors.password = 'Enter a password.';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  }

  // Name, phone and KYC use the SHARED application rules (the same ones the
  // signed-in application form and the database apply), so a value refused here
  // is exactly the value the backend would refuse — and the message names the
  // field instead of blaming the whole form.
  if (!errors.fullName && sanitizePersonName(fullName).length < 2) {
    errors.fullName = PARTNER_APPLICATION_MESSAGES.nameTooShort;
  }

  const phone = String(input.phone ?? '').trim();
  if (phone && !isValidIndianMobile(phone)) {
    errors.phone = PARTNER_APPLICATION_MESSAGES.phoneInvalid;
  }

  const spec = kycDocumentSpec(input.kycDocumentType);
  if (!spec) {
    errors.kycDocumentType = PARTNER_APPLICATION_MESSAGES.kycTypeRequired;
    // Still report an empty reference: an untouched form shows what is missing
    // on both fields at once instead of one message per submit.
    if (!String(input.kycDocumentReference ?? '').trim()) {
      errors.kycDocumentReference = PARTNER_APPLICATION_MESSAGES.kycReferenceRequired;
    }
  } else {
    const reference = normalizeKycReference(spec.value, input.kycDocumentReference);
    if (!reference) {
      errors.kycDocumentReference = PARTNER_APPLICATION_MESSAGES.kycReferenceRequired;
    } else if (!spec.pattern.test(reference)) {
      errors.kycDocumentReference = spec.invalidMessage;
    }
  }

  return errors;
}

export const GrowthPartnerSignupForm: React.FC<{
  busy: boolean;
  formError: string;
  success: string;
  accentHex?: string;
  fieldErrors?: GrowthPartnerSignupFieldErrors;
  onSubmit: (input: {
    fullName: string;
    phone: string;
    email: string;
    password: string;
    kycDocumentType: string;
    kycDocumentReference: string;
  }) => void;
  onBack: () => void;
}> = ({
  busy,
  formError,
  success,
  accentHex = '#C20E5A',
  fieldErrors: propsFieldErrors,
  onSubmit,
  onBack,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [kycDocumentType, setKycDocumentType] = useState('');
  const [kycDocumentReference, setKycDocumentReference] = useState('');
  const [localFieldErrors, setLocalFieldErrors] = useState<GrowthPartnerSignupFieldErrors>({});

  const spec = kycDocumentSpec(kycDocumentType);
  // Merge local (client-side) and external (server-side) field errors.
  // Server errors take precedence so the user sees exactly what the backend rejected.
  const fieldErrors = { ...localFieldErrors, ...(propsFieldErrors ?? {}) };

  const handleFieldChange = <K extends keyof GrowthPartnerSignupFieldErrors>(
    key: K,
    setter: (val: string) => void
  ) => (val: string) => {
    setter(val);
    if (localFieldErrors[key]) {
      setLocalFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // Password managers / browser autofill can fill the DOM without
    // dispatching the React change events that keep component state in sync.
    // The submitted form controls are the source of truth: validate exactly
    // what the user sees, then send exactly what was validated.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const submitted = {
      fullName: String(form.get('growth-partner-signup-name') ?? fullName),
      phone: String(form.get('growth-partner-signup-phone') ?? phone),
      email: String(form.get('growth-partner-signup-email') ?? email),
      password: String(form.get('growth-partner-signup-password') ?? password),
      kycDocumentType: String(form.get('growth-partner-kyc-type') ?? kycDocumentType),
      kycDocumentReference: String(form.get('growth-partner-kyc-reference') ?? kycDocumentReference),
    };
    setFullName(submitted.fullName);
    setPhone(submitted.phone);
    setEmail(submitted.email);
    setPassword(submitted.password);
    setKycDocumentType(submitted.kycDocumentType);
    setKycDocumentReference(submitted.kycDocumentReference);
    logPasswordLengths('growth-partner:signup', password, submitted.password);
    const errors = validateGrowthPartnerSignupInput(submitted);
    setLocalFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    const cleanPhone = submitted.phone.trim() ? normalizePhone(submitted.phone) : '';
    onSubmit({
      fullName: sanitizePersonName(submitted.fullName),
      phone: cleanPhone,
      email: submitted.email.trim(),
      password: submitted.password,
      kycDocumentType: submitted.kycDocumentType.trim().toLowerCase(),
      kycDocumentReference: normalizeKycReference(submitted.kycDocumentType, submitted.kycDocumentReference),
    });
  };

  return (
    <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
      >
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Apply as a Growth Partner</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create an account and submit your application. Your dashboard opens after submission.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleFormSubmit}>
          <Field
            id="growth-partner-signup-name"
            label="Full name"
            value={fullName}
            error={fieldErrors.fullName}
            onChange={handleFieldChange('fullName', setFullName)}
            disabled={busy}
          />
          <Field
            id="growth-partner-signup-phone"
            label="Phone (optional)"
            value={phone}
            error={fieldErrors.phone}
            onChange={handleFieldChange('phone', setPhone)}
            disabled={busy}
          />
          <Field
            id="growth-partner-signup-email"
            label="Email"
            type="email"
            value={email}
            autoComplete="email"
            error={fieldErrors.email}
            onChange={handleFieldChange('email', setEmail)}
            disabled={busy}
          />
          <Field
            id="growth-partner-signup-password"
            label="Password"
            type="password"
            value={password}
            autoComplete="new-password"
            error={fieldErrors.password}
            onChange={handleFieldChange('password', setPassword)}
            disabled={busy}
          />
          <div>
            <label className="block text-sm font-bold text-slate-800" htmlFor="growth-partner-kyc-type">
              KYC document type
            </label>
            <select
              id="growth-partner-kyc-type"
              name="growth-partner-kyc-type"
              value={kycDocumentType}
              onChange={(e) => {
                const val = e.target.value;
                setKycDocumentType(val);
                setKycDocumentReference((prev) => restrictKycReferenceInput(val, prev));
                if (localFieldErrors.kycDocumentType) {
                  setLocalFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.kycDocumentType;
                    return next;
                  });
                }
              }}
              disabled={busy}
              aria-invalid={fieldErrors.kycDocumentType ? true : undefined}
              aria-describedby={fieldErrors.kycDocumentType ? 'growth-partner-kyc-type-error' : undefined}
              className={`mt-1.5 w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-500 disabled:opacity-60 ${
                fieldErrors.kycDocumentType ? 'border-rose-400' : 'border-slate-200'
              }`}
            >
              <option value="">Select document</option>
              {KYC_DOCUMENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldErrors.kycDocumentType && (
              <p id="growth-partner-kyc-type-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
                {fieldErrors.kycDocumentType}
              </p>
            )}
          </div>
          <Field
            id="growth-partner-kyc-reference"
            label="KYC reference number"
            value={kycDocumentReference}
            inputMode={spec?.inputMode}
            maxLength={spec?.maxLength}
            error={fieldErrors.kycDocumentReference}
            onChange={(val) =>
              handleFieldChange('kycDocumentReference', setKycDocumentReference)(
                restrictKycReferenceInput(kycDocumentType, val)
              )
            }
            disabled={busy}
            placeholder={spec ? spec.placeholder : 'Reference only; do not upload document here'}
          />
          {spec && !fieldErrors.kycDocumentReference ? (
            <p className="-mt-2 text-xs text-slate-500">
              {spec.hint}
              {spec.value === 'aadhaar' && kycDocumentReference.trim()
                ? ` (${normalizeKycReference('aadhaar', kycDocumentReference).length}/12 digits)`
                : ''}
            </p>
          ) : null}
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          {success && <FormAlert tone="success">{success}</FormAlert>}
          <SubmitButton busy={busy} busyLabel="Submitting…" accentHex={accentHex}>
            Submit application
          </SubmitButton>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-60"
          >
            Back to sign in
          </button>
        </form>
      </motion.div>
    </main>
  );
};

export const GrowthPartnerLoginVerifying: React.FC = () => (
  <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
    <div
      role="status"
      aria-label={GROWTH_PARTNER_LOGIN_VERIFYING_LABEL}
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
      <p className="text-sm font-bold text-slate-700">{GROWTH_PARTNER_LOGIN_VERIFYING_LABEL}</p>
    </div>
  </main>
);

export const GrowthPartnerLoginMockNotice: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<AlertCircle className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_LOGIN_MOCK_TITLE}
      body={GROWTH_PARTNER_LOGIN_MOCK_BODY}
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

/**
 * Access-error card for the legacy `/growth-partner/login` route: a signed-in
 * account that is not a Growth Partner. Both ways forward stay visible and
 * clear — "Become a Growth Partner" (Sign Up) and "Sign In" (the direct
 * login flow for anyone who already has a Growth Partner account).
 */
export const GrowthPartnerLoginUnauthorized: React.FC<{
  onBack?: () => void;
  /** Direct Login / Sign In flow for an existing Growth Partner account. */
  onSignIn?: () => void;
  /** Legacy alias for `onSignIn` (kept so older call sites keep working). */
  onSwitchAccount?: () => void;
  /** "Become a Growth Partner" (Sign Up) — start a new partner application. */
  onApply?: () => void;
}> = ({ onBack, onSignIn, onSwitchAccount, onApply }) => {
  const handleSignIn = onSignIn ?? onSwitchAccount;
  return (
  <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_LOGIN_UNAUTHORIZED_TITLE}
      body={GROWTH_PARTNER_LOGIN_UNAUTHORIZED_BODY}
    >
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
        Already have a Growth Partner account? Sign in with it to open your partner area.
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

export const GrowthPartnerLoginPendingReview: React.FC<{
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
    <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
      <StateCard
        icon={<Hourglass className="w-7 h-7 text-slate-400" />}
        title={GROWTH_PARTNER_LOGIN_PENDING_TITLE}
        body={GROWTH_PARTNER_LOGIN_PENDING_BODY}
      >
        {submittedLabel ? (
          <p className="mt-3 text-xs text-slate-500" data-testid="growth-partner-pending-submitted">
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
          onClick={() => {
            try {
              if (typeof window !== 'undefined' && window.history) {
                window.history.pushState({}, '', '/');
              }
            } catch {}
            onBack?.();
          }}
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

/**
 * Admin-only review queue, shown on the login route to an account the auth
 * provider marks as an admin. It is a convenience for operating the approval
 * flow; the database decides whether the call is allowed.
 */
export const GrowthPartnerAdminReviewPanel: React.FC<{
  rows: GrowthPartnerApplicationQueueRow[];
  busyId?: string | null;
  error?: string;
  onRefresh?: () => void;
  onDecide?: (row: GrowthPartnerApplicationQueueRow, approve: boolean) => void;
}> = ({ rows, busyId = null, error = '', onRefresh, onDecide }) => (
  <section
    aria-label={GROWTH_PARTNER_ADMIN_QUEUE_TITLE}
    className="max-w-md w-full mx-auto text-left bg-white rounded-3xl border border-slate-200 shadow-sm p-6"
  >
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Admin</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">{GROWTH_PARTNER_ADMIN_QUEUE_TITLE}</h2>
      </div>
      <button
        type="button"
        aria-label="Refresh application queue"
        onClick={() => onRefresh?.()}
        className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>

    {error ? <FormAlert tone="error">{error}</FormAlert> : null}

    {rows.length === 0 ? (
      <p className="mt-4 text-sm text-slate-500">{GROWTH_PARTNER_ADMIN_QUEUE_EMPTY}</p>
    ) : (
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-bold text-slate-900">{row.applicant_name || '(no name)'}</p>
            <p className="text-xs text-slate-500 break-all">{row.applicant_email}</p>
            <p className="mt-1 text-xs text-slate-500">
              {row.kyc_document_type ? `${row.kyc_document_type} · ` : ''}
              {row.kyc_document_reference || 'no reference'}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => onDecide?.(row, true)}
                className="flex-1 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-900 text-white disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  Approve
                </span>
              </button>
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => onDecide?.(row, false)}
                className="flex-1 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-700 disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5" />
                  Reject
                </span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
);

export const GrowthPartnerLoginInactive: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
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

export const GrowthPartnerLoginFailure: React.FC<{
  title: string;
  body: string;
  actionLabel: string;
  onAction?: () => void;
}> = ({ title, body, actionLabel, onAction }) => (
  <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16">
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

export const GrowthPartnerLogin: React.FC<{
  /** The app's restored session user (null = signed out). Verified again below. */
  user?: { id?: string; email?: string } | null;
  navigate?: (to: string) => void;
  onBack?: () => void;
  accentHex?: string;
  /** Injected in tests; defaults to the shared anon-key client. */
  client?: GrowthPartnerAuthClient;
  onLogout?: () => void;
}> = ({ user, navigate, onBack, accentHex = '#C20E5A', client, onLogout }) => {
  const sb = useMemo(
    () => client ?? (supabase as unknown as GrowthPartnerAuthClient),
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
  // The caller's own application, so "waiting for review" is a distinct screen
  // from "you never applied". Admin-only review queue state follows it.
  const [application, setApplication] = useState<GrowthPartnerApplicationRow | null>(null);
  const [queue, setQueue] = useState<GrowthPartnerApplicationQueueRow[]>([]);
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState('');
  // If a session user is already seeded (deep link / already-signed-in), the
  // role check is about to run — start in the "verifying" state so the first
  // paint never flashes the "unauthorized" card for a valid partner.
  const [verifying, setVerifying] = useState<boolean>(() => !!user?.id);
  const [attempt, setAttempt] = useState(0);

  // Form state.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  // Field-level errors for the sign-up form. They live here (not only inside the
  // form) so a rejection the SERVER reports — e.g. an invalid Aadhaar number
  // refused by the RPC — can mark the exact input instead of surfacing as one
  // generic sentence at the top of the form.
  const [signupFieldErrors, setSignupFieldErrors] = useState<GrowthPartnerSignupFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState('');

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
        let row = await readPartnerRow();
        if (cancelled) return;
        setPartnerRow(row);
        setLoadError(null);
        if (row) {
          if (!cancelled) setApplication(null);
        } else {
          // No partner row yet: tell "applied, under review" apart from
          // "never applied". A failed lookup is never an access grant, so it
          // falls back to the plain unauthorized card.
          const pending = (await readApplicationRow().catch(() => null)) as GrowthPartnerApplicationRow | null;
          if (pending?.status === 'pending' || pending?.status === 'approved') {
            await (client?.ensurePartnerRow ?? ensureMyGrowthPartner)();
            row = await readPartnerRow();
            if (!row) throw new Error('Could not finish partner dashboard setup. Please retry.');
            if (!cancelled) { setPartnerRow(row); setApplication(null); }
          } else if (!cancelled) setApplication(pending);
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

  const state: GrowthPartnerLoginState = resolveGrowthPartnerLogin({
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

  // 3) An active Growth Partner never sees the login form twice: forward to the
  //    area (the area re-verifies too). Loop-free: the area is a different path.
  useEffect(() => {
    if (state === 'granted') navigate?.(GROWTH_PARTNER_PATH);
  }, [state, navigate]);

  const clearSession = async () => {
    await signOutGrowthPartner(sb);
    onLogout?.();
    setSessionUser(null);
    setPartnerRow(null);
    setApplication(null);
    setLoadError(null);
    setFormError('');
    setFieldErrors({});
    setSignupFieldErrors({});
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // The submitted form controls are the source of truth, not component
    // state: browser autofill can fill the DOM without dispatching React
    // change events, which would otherwise sign in with a stale password.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const submittedEmail = String(form.get('growth-partner-login-email') ?? email);
    const submittedPassword = String(form.get('growth-partner-login-password') ?? password);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    logPasswordLengths('growth-partner:login', password, submittedPassword);
    const errors: { email?: string; password?: string } = {};
    if (!EMAIL_RE.test(submittedEmail.trim())) errors.email = 'Enter a valid email address.';
    if (!submittedPassword) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    setBusy(true);
    setFormError('');
    void signInGrowthPartner(sb, { email: submittedEmail, password: submittedPassword }).then(
      (viewer) => setSessionUser(viewer),
      (error: Error) => setFormError(safePartnerErrorMessage(error, 'Login failed. Please try again.'))
    ).finally(() => setBusy(false));
  };

  const handleSignup = (input: { fullName: string; phone: string; email: string; password: string; kycDocumentType: string; kycDocumentReference: string }) => {
    const errors = validateGrowthPartnerSignupInput(input);
    if (Object.keys(errors).length > 0) {
      const specificError =
        errors.fullName ||
        errors.email ||
        errors.password ||
        errors.phone ||
        errors.kycDocumentType ||
        errors.kycDocumentReference ||
        'Please check the form for errors.';
      setFormError(specificError);
      // Also set field-level errors so each invalid input is marked inline.
      setSignupFieldErrors(errors);
      return;
    }
    setBusy(true);
    setFormError('');
    setSignupSuccess('');
    setSignupFieldErrors({});
    void signUpGrowthPartner(sb, input)
      .then(
        (result) => {
          if (result.viewer) {
            setSessionUser(result.viewer);
            setAttempt((value) => value + 1);
          }
          if (result.applicationError) {
            // The account exists and the visitor is signed in: report the real
            // reason the application was not stored instead of a catch-all.
            // If the application error has a specific field, set it as a field error
            // so it appears inline on that field instead of just a generic form error.
            if (result.applicationError.kind === 'validation' && result.applicationError.field) {
              setSignupFieldErrors({ [result.applicationError.field]: result.applicationError.message });
            } else {
              setFormError(`Account created, but your application was not submitted. ${result.applicationError.message}`);
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
      )
      .finally(() => setBusy(false));
  };

  if (state === 'mock-mode') return <GrowthPartnerLoginMockNotice onBack={onBack} />;
  if (state === 'loading' || state === 'granted') return <GrowthPartnerLoginVerifying />;
  if (state === 'signed-out' && signup)
    return <GrowthPartnerSignupForm busy={busy} formError={formError} success={signupSuccess} accentHex={accentHex} fieldErrors={signupFieldErrors} onSubmit={handleSignup} onBack={() => { setSignup(false); setFormError(''); setSignupFieldErrors({}); }} />;
  if (state === 'signed-out')
    return (
      <GrowthPartnerLoginForm
        email={email}
        password={password}
        fieldErrors={fieldErrors}
        formError={formError}
        busy={busy}
        accentHex={accentHex}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleSubmit}
        onSwitchToSignup={() => { setSignup(true); setFormError(''); setSignupFieldErrors({}); }}
      />
    );
  if (state === 'pending')
    return <GrowthPartnerLoginPendingReview
      submittedAt={application?.created_at}
      onBack={onBack}
      onCheckAgain={() => setAttempt((value) => value + 1)}
      onSwitchAccount={() => void clearSession()}
    />;
  if (state === 'rejected')
    return <GrowthPartnerLoginFailure
      title="Application not approved"
      body="Your Growth Partner application was not approved, so this dashboard stays closed for this account."
      actionLabel="Sign In"
      onAction={() => void clearSession()}
    />;
  if (state === 'unauthorized')
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
        <GrowthPartnerLoginUnauthorized
          onBack={onBack}
          onSignIn={() => void clearSession()}
          onApply={() => { void clearSession().then(() => { setSignup(true); setFormError(''); setSignupFieldErrors({}); }); }}
        />
      </>
    );
  if (state === 'inactive') return <GrowthPartnerLoginInactive onBack={onBack} />;
  if (state === 'session-expired')
    return (
      <GrowthPartnerLoginFailure
        title={GROWTH_PARTNER_LOGIN_SESSION_TITLE}
        body={GROWTH_PARTNER_LOGIN_SESSION_BODY}
        actionLabel="Sign in again"
        onAction={() => void clearSession()}
      />
    );
  return (
    <GrowthPartnerLoginFailure
      title={GROWTH_PARTNER_LOGIN_ERROR_TITLE}
      body={GROWTH_PARTNER_LOGIN_ERROR_BODY}
      actionLabel="Retry"
      onAction={() => setAttempt((value) => value + 1)}
    />
  );
};
