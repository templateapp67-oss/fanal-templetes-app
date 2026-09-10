import React from 'react';
import { FormAlert, GatewayShell } from './Shell';
import type { OnboardingPhase } from '../lib/flow';
import { templateAppBaseUrl } from '../lib/handoff';

// ============================================================================
// Post-referral status. Two variants, both read-only views of the BACKEND
// onboarding row (never localStorage):
//   • verified (default): referral linked, Template App not finished yet.
//     Phase 4 secure handoff button when the host passes the handler.
//   • completed (Phase 5): the Template App backend verified a finished
//     website. Ready state only — no referral/handoff/signup repeated, just
//     a plain link back to the Template App (no token: the user returns on
//     their normal session).
// ============================================================================

export const STATUS_VERIFIED_TITLE = 'Referral code verified successfully.';
export const STATUS_VERIFIED_BODY =
  'Your account is linked and ready for the next step. You will continue from here when it opens.';

export const STATUS_COMPLETED_TITLE = 'Your website setup is complete.';
export const STATUS_COMPLETED_BODY =
  'Your Template App website is finished and linked to your referral.';

export const StatusScreen: React.FC<{
  phase: OnboardingPhase;
  referralCode?: string | null;
  partnerName?: string | null;
  email?: string;
  onLogout?: () => void;
  /** Phase 4: secure one-time handoff into the Template App. Absent = hidden. */
  onContinueToTemplateApp?: () => void;
  handoffBusy?: boolean;
  handoffError?: string;
  /** Phase 5: true when the backend reports template_completed. Ready state. */
  completed?: boolean;
}> = ({
  referralCode,
  partnerName,
  email,
  onLogout,
  onContinueToTemplateApp,
  handoffBusy,
  handoffError,
  completed,
}) => (
  <GatewayShell
    title={completed ? STATUS_COMPLETED_TITLE : STATUS_VERIFIED_TITLE}
    subtitle={completed ? STATUS_COMPLETED_BODY : STATUS_VERIFIED_BODY}
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
    <div className="space-y-4">
      <FormAlert tone="success">
        {referralCode ? (
          <>
            Linked with code <span className="font-mono font-black">{referralCode}</span>
            {partnerName ? (
              <>
                {' '}
                from <span className="font-bold">{partnerName}</span>
              </>
            ) : null}
            .
          </>
        ) : (
          'Your referral is linked.'
        )}
      </FormAlert>
      {completed ? (
        <>
          <p className="text-sm text-slate-600">
            Nothing more to do — your progress is saved and recognized every time you sign in.
          </p>
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <a
              href={templateAppBaseUrl() || '/'}
              className="block w-full py-3 rounded-xl text-white text-sm font-bold text-center cursor-pointer transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#C20E5A' }}
            >
              Open Template App
            </a>
            <p className="text-xs text-slate-500">
              Opens the Template App in this browser — no new code or sign-up needed.
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Nothing more to do right now — stay signed in and you will pick up here.
          </p>
          {onContinueToTemplateApp && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={onContinueToTemplateApp}
                disabled={handoffBusy}
                className="w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#C20E5A' }}
              >
                {handoffBusy ? 'Preparing secure handoff…' : 'Continue to Template App'}
              </button>
              {handoffError ? <FormAlert tone="error">{handoffError}</FormAlert> : null}
              <p className="text-xs text-slate-500">
                You will be securely signed in to the Template App. This pass can only be used once and expires in 5
                minutes.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  </GatewayShell>
);
