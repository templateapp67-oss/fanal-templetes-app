import { toSafeAuthError } from '../lib/flow';
import React, { useCallback, useRef, useState } from 'react';
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
  prepareAttribution?: () => Promise<string | undefined>;
  onDone?: () => void;
  onGoLogin?: () => void;
}> = ({ client, onDone, onGoLogin, prepareAttribution }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
                const attributionToken = await prepareAttribution?.();
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
              (error: Error) => setFormError(toSafeAuthError(error, 'signup').message)
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
