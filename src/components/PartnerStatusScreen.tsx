import React, { useState } from 'react';
import { AlertCircle, Loader2, LogIn, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
  isMissingPartnerSchemaError,
  toSafePartnerSectionError,
} from '../lib/growthPartner';
import { classifyPartnerAreaFailure, type PartnerAreaFailure } from '../lib/partnerAreaFailure';
import { supabaseConfig } from '../lib/supabaseClient';
import { PartnerAreaFailurePanel } from './PartnerAreaFailurePanel';

export const GROWTH_PARTNER_SIGNIN_TITLE = 'Sign in to open the Growth Partner area';
export const GROWTH_PARTNER_SIGNIN_BODY =
  'Growth Partner tools are tied to your account, so we can only show them once you are signed in.';
export const GROWTH_PARTNER_UNAUTHORIZED_TITLE = 'Growth Partners only';
export const GROWTH_PARTNER_UNAUTHORIZED_BODY =
  'This account is not registered as a Growth Partner. If you were invited as one, sign in with that account.';
export const GROWTH_PARTNER_ERROR_TITLE = 'Could not load the Growth Partner area';
export const GROWTH_PARTNER_SESSION_TITLE = 'Your session expired';
export const GROWTH_PARTNER_SESSION_BODY = 'Please sign in again to continue to the Growth Partner area.';
export const GROWTH_PARTNER_MOCK_TITLE = 'Growth Partner area needs a live connection';
export const GROWTH_PARTNER_MOCK_BODY =
  'This area reads real partner data from Supabase, which is not connected in this preview. No demo numbers are shown.';

export function PartnerStatusScreen({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 mt-2">{body}</p>
      {children}
    </div>
  );
}

export const GrowthPartnerSignInPrompt: React.FC<{
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  accentHex?: string;
}> = ({ onRequireAuth, accentHex = '#C20E5A' }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <PartnerStatusScreen
      icon={<LogIn className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_SIGNIN_TITLE}
      body={GROWTH_PARTNER_SIGNIN_BODY}
    >
      <button
        type="button"
        onClick={() => onRequireAuth?.('login')}
        className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90"
        style={{ backgroundColor: accentHex }}
      >
        Sign in
      </button>
    </PartnerStatusScreen>
  </main>
);

export const GrowthPartnerUnauthorized: React.FC<{
  onBack?: () => void;
  /** Namespace-specific denial copy (the /partner/* portal shows the spec's exact line). */
  body?: string;
}> = ({ onBack, body }) => {
  // The self-enrollment shortcut reports its own outcome: reloading blindly on
  // failure hid a missing migration behind an unchanged screen.
  const [notice, setNotice] = useState('');
  const enrollSelf = async () => {
    setNotice('');
    try {
      const { approveDemoGrowthPartnerAccount } = await import('../lib/growthPartner');
      await approveDemoGrowthPartnerAccount();
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (error) {
      setNotice(
        isMissingPartnerSchemaError(error)
          ? GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE
          : toSafePartnerSectionError(error).message
      );
    }
  };
  return (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <PartnerStatusScreen
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_UNAUTHORIZED_TITLE}
      body={body ?? GROWTH_PARTNER_UNAUTHORIZED_BODY}
    >
      <button
        type="button"
        onClick={() => void enrollSelf()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
      >
        Instantly Enable & Open Partner Portal
      </button>
      {notice ? <p role="alert" className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900">{notice}</p> : null}
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-3 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </button>
    </PartnerStatusScreen>
  </main>
  );
};

export const GrowthPartnerInactive: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <PartnerStatusScreen
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_INACTIVE_TITLE}
      body={GROWTH_PARTNER_INACTIVE_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </button>
    </PartnerStatusScreen>
  </main>
);

/**
 * The area's failure screen.
 *
 * Two shapes, on purpose:
 *   • explicit `title`/`body`/`actionLabel` — used by the states whose copy is
 *     already exact (session expired, mock mode, …);
 *   • `error` — the raw failure: the screen then classifies it, names the cause
 *     and renders `PartnerAreaFailurePanel`, so a failure that a retry cannot
 *     fix (missing migration, refused grant) says so instead of looping the
 *     user through "Please try again".
 */
export const GrowthPartnerLoadError: React.FC<{
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The failure to explain. When present, it wins over the generic copy. */
  error?: unknown;
  /**
   * The cause, already classified by the layer that saw the raw answer (the
   * service facade). Preferred over re-classifying `error`: a sanitised wrapper
   * would otherwise classify as `unknown`.
   */
  failure?: PartnerAreaFailure | null;
  /** Route shown in the diagnostic report, e.g. `/partner/dashboard`. */
  route?: string | null;
  onSignIn?: () => void;
}> = ({ title, body, actionLabel, onAction, error, failure: classified, route, onSignIn }) => {
  const failure =
    classified ?? (error !== undefined && error !== null ? classifyPartnerAreaFailure(error) : null);
  // A classified failure outranks the caller's generic fallback copy. The gate
  // passes `title`/`body` for the states it can already describe, so without
  // this the screen would be headed by the real cause ("…database setup is
  // missing…") and explained by the very sentence this work removes
  // ("Could not load this section. Please try again.").
  const named = !!failure && failure.kind !== 'unknown';
  const heading = named ? failure.title : title ?? failure?.title ?? GROWTH_PARTNER_ERROR_TITLE;
  const explanation = named ? failure.body : body ?? failure?.body ?? '';

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <PartnerStatusScreen icon={<AlertCircle className="w-7 h-7 text-rose-500" />} title={heading} body={explanation}>
        {failure ? (
          <PartnerAreaFailurePanel
            error={error}
            failure={failure}
            route={route}
            onRetry={onAction}
            onSignIn={onSignIn}
            className="mt-6"
          />
        ) : (
          <button
            type="button"
            onClick={() => onAction?.()}
            className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2 bg-slate-900"
          >
            <RefreshCw className="w-4 h-4" />
            {actionLabel ?? 'Retry'}
          </button>
        )}
      </PartnerStatusScreen>
    </main>
  );
};

export const GrowthPartnerMockNotice: React.FC<{ onBack?: () => void; issues?: string[] }> = ({
  onBack,
  issues = supabaseConfig.issues,
}) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <PartnerStatusScreen
      icon={<AlertCircle className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_MOCK_TITLE}
      body={GROWTH_PARTNER_MOCK_BODY}
    >
      {/* Actionable, not a dead end: name what is missing and the exact next
          step, so this screen is a setup instruction rather than a shrug. */}
      {issues.length > 0 && (
        <ul className="mt-5 space-y-1.5 text-left text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
          {issues.map((issue) => (
            <li key={issue} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span className="break-words">{issue}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 text-left text-xs text-slate-600">
        <p className="font-bold text-slate-800">To finish the setup</p>
        <ol className="mt-1.5 space-y-1 list-decimal list-inside">
          <li>
            Fill in the Supabase variables from <code className="font-mono">.env.example</code> in{' '}
            <code className="font-mono">.env</code>, then restart the app.
          </li>
          <li>
            Apply the Growth Partner migrations (order matters — see{' '}
            <code className="font-mono">GROWTH_PARTNER_SETUP.md</code>).
          </li>
          <li>
            Check it with <code className="font-mono">npm run verify:growth-partner</code>, then
            approve your account so the area unlocks.
          </li>
        </ol>
      </div>
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </button>
    </PartnerStatusScreen>
  </main>
);

export const GrowthPartnerLoading: React.FC = () => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <div
      role="status"
      aria-label="Loading Growth Partner area"
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
      <p className="text-sm font-bold text-slate-700">Loading your partner area…</p>
    </div>
  </main>
);

