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
  initialCode?: string;
  email?: string;
  onLinked?: () => void;
  onLogout?: () => void;
}> = ({ client, email, onLinked, onLogout, initialCode = '' }) => {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(createSingleFlight());

  const submit = () => {
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter your referral code.');
      return;
    }
    setBusy(true);
    setError('');
    // Single-flight: an in-flight verification cannot be duplicated, and the
    // button is disabled meanwhile — no accidental double submissions.
    void flight.current
      .run(() => linkReferralCode(client as OnboardingSupabaseClient, trimmed))
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
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
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
      <ReferralForm code={code} busy={busy} error={error} onCodeChange={setCode} onSubmit={submit} />
    </GatewayShell>
  );
};
