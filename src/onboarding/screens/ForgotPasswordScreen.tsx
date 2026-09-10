import React, { useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton, TextLinkButton } from './Shell';
import { sendPasswordReset, type OnboardingSupabaseClient } from '../lib/auth';
import { isValidEmail } from '../lib/flow';

// ============================================================================
// Forgot password — Supabase Auth reset emails only. No custom password
// storage or reset tables. Success copy never reveals account existence.
// ============================================================================

export const FORGOT_TITLE = 'Reset your password';
export const FORGOT_SUBTITLE = 'Enter your account email and we will send a reset link.';
export const FORGOT_SUCCESS = 'If an account exists for this email, a reset link is on its way.';

export const ForgotPasswordScreen: React.FC<{
  client?: OnboardingSupabaseClient;
  onGoLogin?: () => void;
}> = ({ client, onGoLogin }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <GatewayShell
      title={FORGOT_TITLE}
      subtitle={FORGOT_SUBTITLE}
      footer={
        <>
          Remembered it? <TextLinkButton onClick={() => onGoLogin?.()}>Back to login</TextLinkButton>
        </>
      }
    >
      {sent ? (
        <FormAlert tone="success">{FORGOT_SUCCESS}</FormAlert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (!isValidEmail(email)) {
              setFieldError('Enter a valid email address.');
              return;
            }
            setFieldError('');
            setBusy(true);
            setFormError('');
            void sendPasswordReset(client as OnboardingSupabaseClient, email).then(
              () => setSent(true),
              (error: Error) => setFormError(error?.message || 'Password reset failed. Please try again.')
            ).finally(() => setBusy(false));
          }}
        >
          <Field
            id="onboarding-forgot-email"
            label="Email"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@example.com"
            disabled={busy}
            error={fieldError}
            onChange={setEmail}
          />
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          <SubmitButton busy={busy} busyLabel="Sending reset link…">
            Send reset link
          </SubmitButton>
        </form>
      )}
    </GatewayShell>
  );
};
