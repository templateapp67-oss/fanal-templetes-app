import { toSafeAuthError } from '../lib/flow';
import React, { useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton } from './Shell';
import { setNewPassword, type OnboardingSupabaseClient } from '../lib/auth';

// ============================================================================
// Set a new password — the second half of Forgot Password.
//
// The reset email links back to `/onboarding/login`. Supabase Auth exchanges
// the token there (`detectSessionInUrl`) and emits PASSWORD_RECOVERY with a
// real recovery session; OnboardingApp switches to this screen. Supabase Auth
// performs the password change (`updateUser`) — no custom storage, no reset
// table. Without this screen the reset flow dead-ends: the user lands on the
// login form holding a session they cannot use and no way to set a password.
// ============================================================================

export const SET_PASSWORD_TITLE = 'Choose a new password';
export const SET_PASSWORD_SUBTITLE = 'Your reset link is valid. Set a new password to continue.';
export const SET_PASSWORD_SUCCESS = 'Password updated. You are signed in — continuing…';

export const SetPasswordScreen: React.FC<{
  client?: OnboardingSupabaseClient;
  onDone?: () => void;
  onCancel?: () => void;
}> = ({ client, onDone, onCancel }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  return (
    <GatewayShell
      title={SET_PASSWORD_TITLE}
      subtitle={done ? SET_PASSWORD_SUCCESS : SET_PASSWORD_SUBTITLE}
      footer={
        done ? null : (
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="font-bold text-slate-900 underline underline-offset-2 cursor-pointer hover:opacity-80"
          >
            Cancel and sign in
          </button>
        )
      }
    >
      {done ? (
        <FormAlert tone="success">{SET_PASSWORD_SUCCESS}</FormAlert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setFormError('');
            void setNewPassword(client as OnboardingSupabaseClient, password, confirm).then(
              () => {
                setDone(true);
                onDone?.();
              },
              (error: Error) => {
                const mapped = toSafeAuthError(error, 'reset');
                // Field-level codes belong on the field, not the form banner.
                if (mapped.code === 'validation') setFieldErrors({ password: mapped.message });
                else setFormError(mapped.message);
              }
            ).finally(() => setBusy(false));
          }}
        >
          <Field
            id="onboarding-reset-password"
            label="New password"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="At least 6 characters"
            disabled={busy}
            error={fieldErrors.password}
            onChange={setPassword}
          />
          <Field
            id="onboarding-reset-confirm"
            label="Confirm new password"
            type="password"
            value={confirm}
            autoComplete="new-password"
            placeholder="Repeat your new password"
            disabled={busy}
            error={fieldErrors.confirm}
            onChange={setConfirm}
          />
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          <SubmitButton busy={busy} busyLabel="Updating password…">
            Update password
          </SubmitButton>
        </form>
      )}
    </GatewayShell>
  );
};
