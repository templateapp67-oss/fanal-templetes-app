import React, { useRef, useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton, TextLinkButton } from './Shell';
import { signInWithEmail, type OnboardingSupabaseClient } from '../lib/auth';
import { createSingleFlight, toSafeAuthError, validateLogin } from '../lib/flow';
import { ReferralLinkNotice } from './ReferralLinkNotice';

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
  referralCode?: string;
}> = ({ client, onDone, onGoSignup, onGoForgot, referralCode = '' }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  // `busy` is React state, so two submit events landing in the same tick both
  // read `busy === false` before the re-render — a double click sends two
  // signInWithPassword requests and burns two rate-limit slots. This ref is
  // the real guard; the disabled button is only the visible half. Same
  // pattern as SignupScreen.
  const submitFlight = useRef(createSingleFlight());

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
      <ReferralLinkNotice code={referralCode} context="login" />
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const validation = validateLogin({ email, password });
          setFieldErrors(validation.errors);
          if (!validation.ok) return;
          setFormError('');
          void submitFlight.current
            .run(async () => {
              setBusy(true);
              try {
                return await signInWithEmail(client as OnboardingSupabaseClient, { email, password });
              } finally {
                setBusy(false);
              }
            })
            .then(
              (result) => {
                if (!result) return; // superseded by an in-flight submit
                onDone?.();
              },
              (error: Error) => setFormError(toSafeAuthError(error, 'login').message)
            );
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
