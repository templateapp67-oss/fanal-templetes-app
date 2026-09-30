import React, { useState } from 'react';
import { FormAlert, GatewayShell } from './Shell';
import type { OnboardingPhase } from '../lib/flow';
import { templateAppBaseUrl } from '../lib/handoff';
import { copyToClipboard } from '../../lib/clipboard';

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
  'Your account is linked to your Growth Partner. Continue to the Template App to build your website.';

/** Shown only when the host renders no handoff call to action. */
export const STATUS_VERIFIED_WAITING_BODY =
  'Nothing more to do right now — stay signed in and you will pick up here.';

/**
 * The pending state an owner reaches through "Continue without a referral":
 * the account is real and usable, no partner code is attached yet. It must
 * read as a normal state, not as an error or as a linked referral.
 */
export const STATUS_PENDING_TITLE = 'Your account is ready.';
export const STATUS_PENDING_BODY =
  'No referral code is linked yet. You can continue now and link your Growth Partner code whenever you have it.';
export const STATUS_PENDING_NO_CODE = 'No referral code is linked yet.';
export const STATUS_LINK_REFERRAL_LABEL = 'Link a referral code';

export const STATUS_COMPLETED_TITLE = 'Your website setup is complete.';
export const STATUS_COMPLETED_BODY =
  'Your Template App website is finished and linked to your referral.';

/** Label of the live website link card (shown the moment a site exists). */
export const STATUS_SITE_LINK_LABEL = 'Your live website';
/** Honest placeholder while no slugged site exists yet — never a broken URL. */
export const STATUS_SITE_LINK_PENDING_BODY =
  'Your website link will appear here as soon as your business is set up in the Template App.';

// ============================================================================
// Live website link card — the owner's public URL, shown the moment a slugged
// site exists so every user gets their link right after sign-up / sign-in.
// ============================================================================
const SiteLinkCard: React.FC<{ siteUrl: string }> = ({ siteUrl }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyToClipboard(siteUrl);
    if (ok) {
      setCopied(true);
      if (typeof setTimeout === 'function') {
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };
  return (
    <div
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
      data-testid="status-site-link"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span className="block text-xs font-bold uppercase tracking-wider text-emerald-700">
            {STATUS_SITE_LINK_LABEL}
          </span>
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-mono text-sm font-black text-slate-900 underline underline-offset-2"
            data-testid="status-site-link-url"
          >
            {siteUrl}
          </a>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="px-3 py-2 rounded-lg bg-white border border-emerald-300 text-xs font-bold text-slate-900 cursor-pointer hover:opacity-80 shadow-xs"
            data-testid="status-site-link-copy"
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-lg text-xs font-bold text-white cursor-pointer hover:opacity-90 shadow-xs"
            style={{ backgroundColor: '#C20E5A' }}
            data-testid="status-site-link-open"
          >
            Open site
          </a>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        Share it with customers — your bookings land directly on this site.
      </p>
    </div>
  );
};

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
  /**
   * The owner's live public website URL (getPublicWebsiteUrl + workspace
   * slug). Shown immediately after sign-up / sign-in whenever a slugged
   * site already exists; absent = the link card is hidden (and a pending
   * hint is shown until setup finishes).
   */
  siteUrl?: string | null;
  /**
   * Present → pending owners can reopen the referral form from the status
   * screen (the reversible half of "Continue without a referral").
   */
  onLinkReferral?: () => void;
}> = ({
  phase,
  referralCode,
  partnerName,
  email,
  onLogout,
  onContinueToTemplateApp,
  handoffBusy,
  handoffError,
  completed,
  siteUrl,
  onLinkReferral,
}) => {
  // A pending owner (no linked code — typically via "Continue without a
  // referral") gets its own honest copy; verified/completed keep theirs.
  const pending = !completed && phase === 'pending' && !referralCode;
  return (
  <div className="w-full max-w-5xl mx-auto space-y-6">
    <GatewayShell
      title={completed ? STATUS_COMPLETED_TITLE : pending ? STATUS_PENDING_TITLE : STATUS_VERIFIED_TITLE}
      subtitle={completed ? STATUS_COMPLETED_BODY : pending ? STATUS_PENDING_BODY : STATUS_VERIFIED_BODY}
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
        {/* Live website URL — handed to the user the moment a slugged site
            exists (right after sign-up's setup or on every sign-in). */}
        {siteUrl ? (
          <SiteLinkCard siteUrl={siteUrl} />
        ) : completed ? (
          // A completed owner always has a slugged site; if the read failed we
          // stay silent rather than ever showing a placeholder link.
          null
        ) : (
          <p className="text-xs text-slate-500" data-testid="status-site-link-pending">
            {STATUS_SITE_LINK_PENDING_BODY}
          </p>
        )}
        {/* Activation Status Badge */}
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Referral Activation Status</span>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black tracking-wide uppercase shadow-xs ${
              completed
                ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                : phase === 'verified' || referralCode
                ? 'bg-blue-100 text-blue-900 border border-blue-200'
                : 'bg-amber-100 text-amber-900 border border-amber-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                completed ? 'bg-emerald-500 animate-pulse' : phase === 'verified' || referralCode ? 'bg-blue-500' : 'bg-amber-500'
              }`}
            />
            {completed ? 'Active' : phase === 'verified' || referralCode ? 'Verified' : 'Pending'}
          </span>
        </div>

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
          ) : pending ? (
            STATUS_PENDING_NO_CODE
          ) : (
            'Your referral is linked.'
          )}
        </FormAlert>
        {pending && onLinkReferral && (
          <button
            type="button"
            onClick={onLinkReferral}
            data-testid="status-link-referral"
            className="w-full py-3 rounded-xl text-sm font-bold cursor-pointer transition-opacity hover:opacity-80 border border-slate-300 bg-white text-slate-800"
          >
            {STATUS_LINK_REFERRAL_LABEL}
          </button>
        )}
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
            {/* Without a handoff handler there is genuinely nothing to do here,
                so say so. With one, the button below IS the next step — telling
                the user "nothing more to do" next to it was self-contradictory. */}
            {onContinueToTemplateApp ? null : (
              <p className="text-sm text-slate-600">{STATUS_VERIFIED_WAITING_BODY}</p>
            )}
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


  </div>
  );
};

