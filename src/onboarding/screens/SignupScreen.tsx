import { toSafeAuthError } from '../lib/flow';
import React, { useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton, TextLinkButton } from './Shell';
import { signUpWithEmail, type OnboardingSupabaseClient } from '../lib/auth';
import { validateSignup } from '../lib/flow';

// ============================================================================
// Sign Up — email + password + confirm only. Supabase Auth creates the user;
// passwords are never stored by this app. No business/profile fields here.
// ============================================================================

export const SIGNUP_TITLE = 'Create your account';
export const SIGNUP_SUBTITLE = 'Sign up to start onboarding.';
export const SIGNUP_CONFIRM_TITLE = 'Check your inbox';
export const SIGNUP_CONFIRM_BODY =
  'Your account was created. Please verify your email, then log in to continue.';

export const SignupScreen: React.FC<{
  client?: OnboardingSupabaseClient;
  prepareAttribution?: () => Promise<string | undefined>;
  onDone?: () => void;
  onGoLogin?: () => void;
}> = ({ client, onDone, onGoLogin, prepareAttribution }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState('');
  const [confirmationSent, setConfirmationSent] = useState(false);

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
        <FormAlert tone="success">Account created. Verify your email to continue.</FormAlert>
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
          if (busy) return;
          const validation = validateSignup({ email, password, confirm });
          setFieldErrors(validation.errors);
          if (!validation.ok) return;
          setBusy(true);
          setFormError('');
          void (async () => {
            const attributionToken = await prepareAttribution?.();
            return signUpWithEmail(client as OnboardingSupabaseClient, { email, password, confirm, attributionToken });
          })().then(
            (result) => {
              if (result.confirmationRequired) {
                setConfirmationSent(true);
                return;
              }
              onDone?.();
            },
            (error: Error) => setFormError(toSafeAuthError(error, 'signup').message)
          ).finally(() => setBusy(false));
        }}
      >
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
