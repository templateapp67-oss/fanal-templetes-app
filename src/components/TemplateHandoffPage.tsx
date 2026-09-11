import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { matchTemplateHandoffQuery } from '../lib/router';
import {
  OnboardingError,
} from '../onboarding/lib/flow';
import type { OnboardingSupabaseClient } from '../onboarding/lib/auth';
import {
  buildOnboardingLoginUrl,
  clearHandoffState,
  exchangeTemplateHandoff,
  handoffStateMatches,
  isEnteredOnboardingStatus,
  onboardingAppBaseUrl,
  readHandoffState,
} from '../onboarding/lib/handoff';

// ============================================================================
// Template App handoff route — `/onboarding/handoff?token=…&state=…`.
//
// The Phase 4 entry gate. It trusts NOTHING in the URL: the token is sent
// straight to exchange_template_handoff, which validates owner, destination,
// consumed, expiry, account and live referral server-side, consumes the grant
// atomically, and records template_started. Ref/email/user-id/partner query
// params are ignored entirely — they are never identity proof.
//
// On success the token is scrubbed from the address bar (history.replaceState)
// and the user enters the normal Template App flow ('/') on their EXISTING
// Supabase Auth session — no parallel session system, no per-request token.
// ============================================================================

export const HANDOFF_VERIFYING_TITLE = 'Signing you in…';
export const HANDOFF_VERIFYING_BODY = 'Validating your one-time onboarding session.';
export const HANDOFF_SUCCESS_TITLE = 'Welcome in!';
export const HANDOFF_SUCCESS_BODY = 'Your onboarding session was verified. Entering the Template App…';

export type TemplateHandoffStatus =
  | 'verifying'
  | 'success'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'forbidden'
  | 'session'
  | 'error';

function statusFromError(error: unknown): { status: TemplateHandoffStatus; message: string } {
  if (error instanceof OnboardingError) {
    switch (error.code) {
      case 'invalid-handoff':
        return { status: 'invalid', message: error.message };
      case 'handoff-used':
        return { status: 'used', message: error.message };
      case 'handoff-expired':
        return { status: 'expired', message: error.message };
      case 'handoff-forbidden':
        return { status: 'forbidden', message: error.message };
      case 'session':
        return { status: 'session', message: error.message };
      case 'network':
        return { status: 'error', message: error.message };
      default:
        return { status: 'error', message: error.message };
    }
  }
  return { status: 'error', message: 'Something went wrong. Please try again.' };
}

/** Presentational state renderer (exported so every state is SSR-testable). */
export const TemplateHandoffScreen: React.FC<{
  status: TemplateHandoffStatus;
  message: string;
  showRetry: boolean;
  onRetry: () => void;
  onBackToOnboarding: () => void;
}> = ({ status, message, showRetry, onRetry, onBackToOnboarding }) => {
  const busy = status === 'verifying' || status === 'success';
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          {busy ? (
            <Loader2 className="w-7 h-7 text-slate-400 animate-spin" />
          ) : status === 'success' ? (
            <ShieldCheck className="w-7 h-7 text-emerald-600" />
          ) : (
            <AlertCircle className="w-7 h-7 text-rose-500" />
          )}
        </div>
        <h1 className="text-xl font-bold text-slate-900">
          {status === 'verifying' ? HANDOFF_VERIFYING_TITLE : status === 'success' ? HANDOFF_SUCCESS_TITLE : message}
        </h1>
        {(status === 'verifying' || status === 'success') && (
          <p className="mt-2 text-sm text-slate-600">
            {status === 'verifying' ? HANDOFF_VERIFYING_BODY : HANDOFF_SUCCESS_BODY}
          </p>
        )}
        {!busy && (
          <div className="mt-6 space-y-3">
            {showRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer bg-slate-900 transition-opacity hover:opacity-90"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onBackToOnboarding}
              className="w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2"
            >
              Back to Onboarding App
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </motion.div>
    </main>
  );
};

export const TemplateHandoffPage: React.FC<{
  navigate: (to: string) => void;
  /** Injected in tests; defaults to the shared anon-key client. */
  client?: OnboardingSupabaseClient;
}> = ({ navigate, client }) => {
  const sb = client ?? (supabase as unknown as OnboardingSupabaseClient);
  const [status, setStatus] = useState<TemplateHandoffStatus>('verifying');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const exchangeRef = useRef<ReturnType<typeof exchangeTemplateHandoff> | null>(null);

  useEffect(() => {
    // Exactly one exchange per page load: double-mounts, back/forward and
    // duplicate requests all funnel through this guard (and the backend's
    // atomic consume is the final backstop).
    let cancelled = false;

    const fail = (error: unknown) => {
      if (cancelled) return;
      const mapped = statusFromError(error);
      setStatus(mapped.status);
      setMessage(mapped.message);
    };

    const enter = () => {
      if (cancelled) return;
      clearHandoffState();
      // Scrub the token from the address bar BEFORE entering: replace (not
      // push) so back/forward can never resurface the credential.
      try {
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, '', '/owner/setup');
        }
      } catch {
        // ignore — navigate below still leaves the handoff route
      }
      navigate('/owner/setup');
    };

    (async () => {
      try {
        const search = typeof window !== 'undefined' ? window.location.search || '' : '';
        const { token, state } = matchTemplateHandoffQuery(search);
        if (!token) {
          fail(new OnboardingError('invalid-handoff', 'Invalid onboarding session.'));
          return;
        }
        // Bind this redirect to the one THIS browser started. A mismatch fails
        // closed without consuming anything (no RPC call at all).
        const expected = readHandoffState();
        if (expected && !handoffStateMatches(expected, state)) {
          fail(new OnboardingError('invalid-handoff', 'Invalid onboarding session.'));
          return;
        }
        const exchanged = await (exchangeRef.current ??= exchangeTemplateHandoff(sb, token));
        if (cancelled) return;
        if (exchanged === null) return; // duplicate submit while busy — ignored
        setStatus('success');
        enter();
      } catch (error) {
        // Refresh-during-verify tolerance: if OUR earlier attempt already won
        // the race (token consumed) and the backend shows entry recorded,
        // continue in instead of stranding the user on "already used".
        if (error instanceof OnboardingError && error.code === 'handoff-used') {
          try {
            const { data, error: statusError } = await sb.rpc('get_my_onboarding_status');
            if (cancelled) return;
            if (!statusError && readHandoffState() && isEnteredOnboardingStatus(data?.status)) {
              setStatus('success');
              enter();
              return;
            }
          } catch {
            // fall through to the used-session state below
          }
        }
        fail(error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `attempt` re-arms the guard for explicit retries only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retryable = status === 'error' || status === 'session';

  return (
    <TemplateHandoffScreen
      status={status}
      message={message}
      showRetry={retryable}
      onRetry={() => {
        exchangeRef.current = null;
        setStatus('verifying');
        setMessage('');
        setAttempt((key) => key + 1);
      }}
      onBackToOnboarding={() => {
        try {
          const url = buildOnboardingLoginUrl(onboardingAppBaseUrl());
          if (typeof window !== 'undefined' && window.location) window.location.assign(url);
          else navigate('/onboarding/login');
        } catch {
          navigate('/onboarding/login');
        }
      }}
    />
  );
};
