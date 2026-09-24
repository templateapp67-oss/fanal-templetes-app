import { toSafeReferralError } from '../lib/flow';
import { captureSignupReferral } from '../lib/referralAttribution';
import { clearReferralIntent, persistReferralIntent, readReferralIntent } from '../lib/referralPersistence';
import React, { useRef, useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton } from './Shell';
import { linkReferralCode, type OnboardingSupabaseClient } from '../lib/auth';
import { OnboardingError, createSingleFlight } from '../lib/flow';

// ============================================================================
// Referral Code — this screen asks for NOTHING else (no name, business,
// address, phone, GST, staff or payment fields). Validation + linking happen
// server-side inside link_my_growth_referral; the frontend only submits the
// raw code and renders the safe outcome.
// ============================================================================

export const REFERRAL_TITLE = 'Enter Referral Code';
export const REFERRAL_SUBTITLE = 'Enter the code shared by your Growth Partner to continue.';

/** Presentational form (exported so the busy/disabled contract is testable). */
export const ReferralForm: React.FC<{
  code: string;
  busy: boolean;
  error: string;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
}> = ({ code, busy, error, onCodeChange, onSubmit }) => (
  <form
    className="space-y-4"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <Field
      id="onboarding-referral-code"
      label="Referral Code"
      value={code}
      autoComplete="off"
      placeholder="e.g. ALPHA01"
      disabled={busy}
      onChange={onCodeChange}
    />
    {error && <FormAlert tone="error">{error}</FormAlert>}
    <SubmitButton busy={busy} busyLabel="Verifying…">
      Continue
    </SubmitButton>
  </form>
);

export const ReferralScreen: React.FC<{
  client?: OnboardingSupabaseClient;
  email?: string;
  /**
   * Code from a partner's share link (`/onboarding/referral?ref=CODE`).
   * Pre-fills the form only — the backend re-validates on submit.
   */
  initialCode?: string;
  onLinked?: () => void;
  onLogout?: () => void;
}> = ({ client, email, initialCode = '', onLinked, onLogout }) => {
  // URL wins over persisted intent, then the router-provided initial code.
  // This runs on mount so a direct /onboarding/referral?code=... link works
  // even if it reaches this screen without first visiting /signup.
  const [code, setCode] = useState(() => readReferralIntent() || (typeof initialCode === 'string' ? initialCode : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(createSingleFlight());

  const submit = () => {
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      clearReferralIntent();
      setError('Enter your referral code.');
      return;
    }
    setBusy(true);
    setError('');
    // Validate/canonicalize the input through the existing same-origin
    // attribution endpoint before linking. The stored value remains intent
    // only; linkReferralCode still performs the authenticated DB write.
    void flight.current
      .run(async () => {
        const canonical = await captureSignupReferral(trimmed);
        if (!canonical) throw new OnboardingError('invalid-code', 'Invalid referral code. Please check and try again.');
        persistReferralIntent(canonical);
        setCode(canonical);
        await linkReferralCode(client as OnboardingSupabaseClient, canonical);
      })
      .then((result) => {
        if (result === null) return; // duplicate tap while busy — ignored
        onLinked?.();
      })
      .catch((err: unknown) => {
        // Already linked is not a dead-end: the relationship exists
        // server-side, so refresh state and move on instead of erroring.
        if (err instanceof OnboardingError && err.code === 'already-linked') {
          onLinked?.();
          return;
        }
        setError(toSafeReferralError(err).message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <GatewayShell
      title={REFERRAL_TITLE}
      subtitle={REFERRAL_SUBTITLE}
      footer={
        <>
          {email ? (
            <>
              Signed in as <span className="font-bold text-slate-900">{email}</span>.{' '}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => onLogout?.()}
            className="font-bold text-slate-900 underline underline-offset-2 cursor-pointer hover:opacity-80"
          >
            Sign out
          </button>
        </>
      }
    >
      <ReferralForm
        code={code}
        busy={busy}
        error={error}
        onCodeChange={(value) => {
          setCode(value);
          if (!value.trim()) clearReferralIntent();
          else persistReferralIntent(value);
        }}
        onSubmit={submit}
      />
    </GatewayShell>
  );
};
