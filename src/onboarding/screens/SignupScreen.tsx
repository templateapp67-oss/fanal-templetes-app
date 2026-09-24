import { toSafeAuthError } from '../lib/flow';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton, TextLinkButton } from './Shell';
import {
  resendSignupConfirmation,
  signUpWithEmail,
  type OnboardingSupabaseClient,
} from '../lib/auth';
import { createSingleFlight, validateSignup } from '../lib/flow';

// ============================================================================
// Sign Up — owner identity (name + phone) + credentials. Supabase Auth creates
// the user and owns the password; this app never stores it. The name and phone
// travel as signup metadata and are written into `profiles` by the existing
// `handle_new_user()` trigger, so no second write and no second signup path.
// No business/salon/staff/address fields live here — those belong to the
// Template App editor.
// ============================================================================

export const SIGNUP_TITLE = 'Create your account';
export const SIGNUP_SUBTITLE = 'Sign up to start onboarding.';
export const SIGNUP_CONFIRM_TITLE = 'Check your inbox';
export const SIGNUP_CONFIRM_BODY =
  'Your account was created. Please verify your email, then log in to continue.';

/**
 * The "verify your email" screen is component state, so a page refresh used to
 * drop the owner back onto a blank sign-up form with no hint that an account
 * already exists. This per-tab marker (never localStorage — it must not survive
 * the tab, and it is UX only, never consulted for routing) keeps the inbox
 * screen up until the session actually exists.
 */
const PENDING_CONFIRMATION_KEY = 'nexora.onboarding.signup.pendingConfirmation';

function readPendingConfirmation(): string {
  try {
    if (typeof sessionStorage === 'undefined') return '';
    const raw = sessionStorage.getItem(PENDING_CONFIRMATION_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { email?: unknown };
    return typeof parsed?.email === 'string' ? parsed.email : '';
  } catch {
    return '';
  }
}

function writePendingConfirmation(email: string): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (email) sessionStorage.setItem(PENDING_CONFIRMATION_KEY, JSON.stringify({ email }));
    else sessionStorage.removeItem(PENDING_CONFIRMATION_KEY);
  } catch {
    // Private mode / disabled storage: the screen still works, it just will not
    // survive a refresh. Never block signup over it.
  }
}

export const SignupScreen: React.FC<{
  client?: OnboardingSupabaseClient;
  prepareAttribution?: (referralCode?: string) => Promise<string | undefined>;
  /** Canonical code captured by the same-origin attribution API. */
  referralCode?: string;
  referralState?: 'checking' | 'valid' | 'invalid' | 'none';
  onDone?: () => void;
  onGoLogin?: () => void;
  /** Keeps a shared/edited code available if routing causes a full-page change. */
  onReferralCodeChange?: (value: string) => void;
}> = ({ client, onDone, onGoLogin, prepareAttribution, referralCode = '', referralState = 'none', onReferralCodeChange }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // A code arriving from a share URL is only a prefill. It must remain editable
  // so an owner can correct a stale/invalid code or remove it and sign up normally.
  const [referralInput, setReferralInput] = useState(referralCode);
  const referralEdited = referralInput !== referralCode;
  const displayedReferralState = referralEdited ? 'none' : referralState;
  useEffect(() => {
    // Sync a code captured after boot without overwriting a value the owner typed.
    if (!referralEdited) setReferralInput(referralCode);
  }, [referralCode, referralEdited]);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    fullName?: string;
    email?: string;
    phone?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [formError, setFormError] = useState('');
  const [confirmationSent, setConfirmationSent] = useState<string>(() => readPendingConfirmation());
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  // `busy` is React state, so two submit events landing in the same tick both
  // read `busy === false` before the re-render. This ref is the real guard; the
  // disabled button is only the visible half.
  const submitFlight = useRef(createSingleFlight());

  const handleResend = useCallback(() => {
    if (resendBusy || !confirmationSent) return;
    setResendBusy(true);
    setResendNotice(null);
    void resendSignupConfirmation(client as OnboardingSupabaseClient, confirmationSent).then(
      () => setResendNotice({ tone: 'success', text: 'Confirmation email resent. Check your inbox.' }),
      (error: Error) => setResendNotice({ tone: 'error', text: toSafeAuthError(error, 'resend').message })
    ).finally(() => setResendBusy(false));
  }, [client, confirmationSent, resendBusy]);

  if (confirmationSent) {
    return (
      <GatewayShell
        title={SIGNUP_CONFIRM_TITLE}
        subtitle={SIGNUP_CONFIRM_BODY}
        footer={
          <>
            Already verified? <TextLinkButton onClick={() => onGoLogin?.()}>Log in</TextLinkButton>
          </>
        }
      >
        <div className="space-y-4">
          <FormAlert tone="success">
            Account created for {confirmationSent}. Verify your email to continue.
          </FormAlert>
          {resendNotice && (
            <FormAlert tone={resendNotice.tone}>{resendNotice.text}</FormAlert>
          )}
          <button
            type="button"
            id="onboarding-signup-resend"
            onClick={handleResend}
            disabled={resendBusy}
            className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resendBusy ? 'Sending…' : 'Resend confirmation email'}
          </button>
        </div>
      </GatewayShell>
    );
  }

  return (
    <GatewayShell
      title={SIGNUP_TITLE}
      subtitle={SIGNUP_SUBTITLE}
      footer={
        <>
          Already have an account? <TextLinkButton onClick={() => onGoLogin?.()}>Log in</TextLinkButton>
        </>
      }
    >
      {displayedReferralState === 'checking' && <FormAlert tone="success">Checking referral code…</FormAlert>}
      {displayedReferralState === 'valid' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800">
          ✓ Referral code applied: <span className="font-mono">{referralCode}</span>
        </div>
      )}
      {displayedReferralState === 'invalid' && (
        <FormAlert tone="error">This referral code is unavailable. Update or remove it to continue without a referral.</FormAlert>
      )}
      {(referralCode || referralInput) && (
        <Field
          id="onboarding-signup-referral-code"
          label="Referral code"
          value={referralInput}
          autoComplete="off"
          disabled={busy}
          onChange={(value) => {
            setReferralInput(value);
            onReferralCodeChange?.(value);
          }}
        />
      )}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const validation = validateSignup({ fullName, email, phone, password, confirm });
          setFieldErrors(validation.errors);
          if (!validation.ok) return;
          setFormError('');
          // Ref-guarded single flight: a second submit in the same tick
          // resolves to null without ever reaching Supabase Auth.
          void submitFlight.current
            .run(async () => {
              setBusy(true);
              try {
                const attributionToken = await prepareAttribution?.(referralInput.trim());
                return await signUpWithEmail(client as OnboardingSupabaseClient, {
                  fullName,
                  email,
                  phone,
                  password,
                  confirm,
                  attributionToken,
                });
              } finally {
                setBusy(false);
              }
            })
            .then(
              (result) => {
                if (!result) return; // superseded by an in-flight submit
                if (result.confirmationRequired) {
                  writePendingConfirmation(email.trim());
                  setConfirmationSent(email.trim());
                  return;
                }
                writePendingConfirmation('');
                onDone?.();
              },
              (error: Error) => {
                const mapped = toSafeAuthError(error, 'signup');
                // "Auth user already created" — this address has an account.
                // Nothing was duplicated: Supabase Auth refused the second
                // signUp and `handle_new_user()` is `on conflict (id) do
                // nothing`, so no second row can appear either. But the owner
                // is now stuck between two screens: they cannot sign in (if
                // confirmation is required the account has no usable session
                // yet) and the form keeps rejecting them. Route to the
                // confirmation screen instead, which offers both a resend and
                // a "log in" path, so neither retry can dead-end.
                if (mapped.code === 'email-in-use') {
                  writePendingConfirmation(email.trim());
                  setConfirmationSent(email.trim());
                  return;
                }
                setFormError(mapped.message);
              }
            );
        }}
      >
        <Field
          id="onboarding-signup-full-name"
          label="Full name"
          value={fullName}
          autoComplete="name"
          placeholder="Your name"
          disabled={busy}
          error={fieldErrors.fullName}
          onChange={setFullName}
        />
        <Field
          id="onboarding-signup-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={busy}
          error={fieldErrors.email}
          onChange={setEmail}
        />
        <Field
          id="onboarding-signup-phone"
          label="Phone"
          type="tel"
          value={phone}
          autoComplete="tel"
          placeholder="+91 98450 77654"
          disabled={busy}
          error={fieldErrors.phone}
          onChange={setPhone}
        />
        <Field
          id="onboarding-signup-password"
          label="Password"
          type="password"
          value={password}
          autoComplete="new-password"
          placeholder="At least 6 characters"
          disabled={busy}
          error={fieldErrors.password}
          onChange={setPassword}
        />
        <Field
          id="onboarding-signup-confirm"
          label="Confirm password"
          type="password"
          value={confirm}
          autoComplete="new-password"
          placeholder="Repeat your password"
          disabled={busy}
          error={fieldErrors.confirm}
          onChange={setConfirm}
        />
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Creating account…">
          Sign up
        </SubmitButton>
      </form>
    </GatewayShell>
  );
};
