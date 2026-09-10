import React from 'react';
import { FormAlert, GatewayShell } from './Shell';
import type { OnboardingPhase } from '../lib/flow';

// ============================================================================
// Post-referral status — the Phase 3 terminal state. Shows that the referral
// is verified and keeps the user inside the Onboarding App. NO Template App
// redirect/handoff here (Phase 4/5 boundary).
// ============================================================================

export const STATUS_VERIFIED_TITLE = 'Referral code verified successfully.';
export const STATUS_VERIFIED_BODY =
  'Your account is linked and ready for the next step. You will continue from here when it opens.';

export const StatusScreen: React.FC<{
  phase: OnboardingPhase;
  referralCode?: string | null;
  partnerName?: string | null;
  email?: string;
  onLogout?: () => void;
}> = ({ referralCode, partnerName, email, onLogout }) => (
  <GatewayShell
    title={STATUS_VERIFIED_TITLE}
    subtitle={STATUS_VERIFIED_BODY}
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
      <p className="text-sm text-slate-600">
        Nothing more to do right now — stay signed in and you will pick up here.
      </p>
    </div>
  </GatewayShell>
);
