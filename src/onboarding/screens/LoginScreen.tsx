import React, { useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton, TextLinkButton } from './Shell';
import { signInWithEmail, type OnboardingSupabaseClient } from '../lib/auth';
import { validateLogin } from '../lib/flow';

// ============================================================================
// Login — email + password via Supabase Auth, plus forgot-password and a
// Sign Up link. Post-login routing is backend-driven (see OnboardingApp).
// ============================================================================

export const LOGIN_TITLE = 'Welcome back';
export const LOGIN_SUBTITLE = 'Log in to continue onboarding.';

export const LoginScreen: React.FC<{
  client?: OnboardingSupabaseClient;
  onDone?: () => void;
  onGoSignup?: () => void;
  onGoForgot?: () => void;
}> = ({ client, onDone, onGoSignup, onGoForgot }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');

  return (
    <GatewayShell
      title={LOGIN_TITLE}
      subtitle={LOGIN_SUBTITLE}
      footer={
        <>
          New here? <TextLinkButton onClick={() => onGoSignup?.()}>Create an account</TextLinkButton>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const validation = validateLogin({ email, password });
          setFieldErrors(validation.errors);
          if (!validation.ok) return;
          setBusy(true);
          setFormError('');
          void signInWithEmail(client as OnboardingSupabaseClient, { email, password }).then(
            () => onDone?.(),
            (error: Error) => setFormError(error?.message || 'Login failed. Please try again.')
          ).finally(() => setBusy(false));
        }}
      >
        <Field
          id="onboarding-login-email"
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
          id="onboarding-login-password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="Your password"
          disabled={busy}
          error={fieldErrors.password}
          onChange={setPassword}
        />
        <div className="text-right">
          <TextLinkButton onClick={() => onGoForgot?.()}>Forgot password?</TextLinkButton>
        </div>
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Logging in…">
          Log in
        </SubmitButton>
      </form>
    </GatewayShell>
  );
};
