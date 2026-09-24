import { captureSignupReferral, prepareSignupAttribution } from './lib/referralAttribution';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import {
  isGrowthReferralCodeFormat,
  isSessionExpiredError,
  normalizeGrowthReferralCode,
} from '../lib/growthPartner';
import {
  clearReferralIntent,
  hasReferralIntentInLocation,
  persistReferralIntent,
  readReferralIntent,
  writeFlashToast,
} from './lib/referralPersistence';
import {
  normalizePath,
  matchOnboardingRoute,
  onboardingPath,
  type OnboardingSection,
} from '../lib/router';
import { createSingleFlight, resolveOnboardingRoute, toSafeReferralError, type OnboardingPhase } from './lib/flow';
import {
  fetchOnboardingSnapshot,
  loadViewer,
  signOutViewer,
  type OnboardingSupabaseClient,
  type OnboardingViewer,
  type OnboardingSnapshot,
} from './lib/auth';
import { clearAllLocalUserState } from '../lib/salonStore';
import {
  buildTemplateHandoffUrl,
  createTemplateHandoff,
  newHandoffState,
  redirectToTemplateApp,
  saveHandoffState,
  templateAppBaseUrl,
} from './lib/handoff';
import { FormAlert, GatewayShell } from './screens/Shell';
import { SignupScreen } from './screens/SignupScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { ReferralScreen } from './screens/ReferralScreen';
import { StatusScreen } from './screens/StatusScreen';
import { SetPasswordScreen } from './screens/SetPasswordScreen';
import { BusinessSetupScreen } from './screens/BusinessSetupScreen';

// ============================================================================
// Onboarding App (`/onboarding/...`) — auth + referral gateway on the SHARED
// backend (same Supabase project/Auth/database/RPCs/RLS as the Template App).
//
//   • Session: Supabase Auth persistence (getSession + onAuthStateChange).
//   • Routing: resolveOnboardingRoute(session, backendPhase, requested) — the
//     database is the source of truth; routing is never trusted from
//     localStorage. Protected screens bounce to login when signed out;
//     linked users are never forced back to the referral screen.
//   • After linking: snapshot is re-fetched from the backend (no reliance on
//     local component state) and the user lands on the status screen.
//   • No Template App handoff here (Phase 4/5 boundary).
// ============================================================================

export interface OnboardingAppProps {
  path: string;
  navigate: (to: string) => void;
  /** Injected in tests; defaults to the shared anon-key client. */
  client?: OnboardingSupabaseClient;
}

export const ONBOARDING_BOOT_ERROR_TITLE = 'Could not reach the onboarding service';
export const ONBOARDING_MOCK_TITLE = 'Onboarding needs a live connection';
export const ONBOARDING_MOCK_BODY =
  'Sign up, login and referral verification need Supabase Auth, which is not connected in this preview.';

/**
 * Read the referral code of a partner's share link
 * (`/signup?ref=CODE`, `?referral=CODE` accepted as an alias). The code is
 * captured ONCE on mount (the router may redirect through the login screen,
 * which drops the query) and the backend re-validates it on submit.
 *
 * Only a code the database can actually link is pre-filled: normalised to the
 * canonical form, and dropped when it fails the format check the database
 * itself enforces. A rejected value falls back to manual entry instead of
 * pre-filling something that is guaranteed to fail on submit.
 */
export function readSharedReferralCode(): string {
  return readReferralIntent();
}


export const OnboardingBootLoading: React.FC = () => (
  <GatewayShell title="One moment…" subtitle="Restoring your session.">
    <div role="status" aria-label="Loading onboarding" className="py-6 text-center">
      <p className="text-sm font-bold text-slate-700 animate-pulse">Loading…</p>
    </div>
  </GatewayShell>
);

export const OnboardingBootError: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <GatewayShell title={ONBOARDING_BOOT_ERROR_TITLE} subtitle="Check your connection and try again.">
    <div className="space-y-4">
      <FormAlert tone="error">{message}</FormAlert>
      <button
        type="button"
        onClick={onRetry}
        className="w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer bg-slate-900 transition-opacity hover:opacity-90"
      >
        Retry
      </button>
    </div>
  </GatewayShell>
);

export const OnboardingMockNotice: React.FC = () => (
  <GatewayShell title={ONBOARDING_MOCK_TITLE} subtitle={ONBOARDING_MOCK_BODY}>
    <FormAlert tone="error">Connect Supabase to use sign up, login and referral verification.</FormAlert>
  </GatewayShell>
);

export const OnboardingApp: React.FC<OnboardingAppProps> = ({
  path,
  navigate,
  client,
}) => {
  const sb = useMemo(
    () => client ?? (supabase as unknown as OnboardingSupabaseClient),
    [client]
  );
  const [boot, setBoot] = useState<'loading' | 'error' | 'ready'>('loading');
  const [bootError, setBootError] = useState('');
  const [bootKey, setBootKey] = useState(0);
  const [viewer, setViewer] = useState<OnboardingViewer | null>(null);
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  // A partner's share link (`?ref=CODE`) is captured once, before any
  // login-redirect drops the query, and pre-fills the referral screen.
  // Capture synchronously on entry, before auth restoration or any route change
  // can remove the referral query parameter.
  const referralCameFromLink = useRef(hasReferralIntentInLocation());
  const [sharedReferralCode, setSharedReferralCode] = useState<string>(readSharedReferralCode);
  const [existingAccountNotice, setExistingAccountNotice] = useState(false);
  const [invalidReferral, setInvalidReferral] = useState(false);
  // Forgot Password, second half: Supabase Auth emits PASSWORD_RECOVERY when
  // it exchanges the reset-link token, and the user must set a new password
  // before the funnel means anything again.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [skipLinkPrefill, setSkipLinkPrefill] = useState(false);
  const captureFlight = useRef<Promise<string> | null>(null);
  const handoffFlight = useRef(createSingleFlight());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<OnboardingSnapshot | null> => {
    try {
      const next = await fetchOnboardingSnapshot(sb);
      if (mounted.current) setSnapshot(next);
      return next;
    } catch (error) {
      // An expired/invalid JWT mid-session drops back to signed-out — the
      // resolver then routes to login instead of stranding the user.
      if (isSessionExpiredError(error) || /sign in|session/i.test((error as Error)?.message || '')) {
        if (mounted.current) {
          setViewer(null);
          setSnapshot(null);
          setExistingAccountNotice(false);
        }
        return null;
      }
      throw error;
    }
  }, [sb]);

  // Boot: restore persisted session, then load backend onboarding state.
  useEffect(() => {
    if (isMockSupabase && !client) {
      setBoot('ready');
      return;
    }
    let cancelled = false;
    setBoot('loading');
    setBootError('');
    (async () => {
      try {
        // Restore the session first. A referral URL must not capture a new
        // capability or prefill reassignment for an existing signed-in account.
        const restored = await loadViewer(sb);
        if (cancelled || !mounted.current) return;
        if (sharedReferralCode && restored && referralCameFromLink.current) {
          setExistingAccountNotice(true);
          setSkipLinkPrefill(true);
        } else if (sharedReferralCode) {
          if (!captureFlight.current) captureFlight.current = captureSignupReferral(sharedReferralCode);
          try {
            const code = await captureFlight.current;
            if (!code) {
              // An invalid share link must not block an organic signup. The
              // server did not create a usable capability, so this is display
              // state only and cannot affect signup attribution.
              setInvalidReferral(true);
            } else {
              setInvalidReferral(false);
              setSharedReferralCode(code);
              try { sessionStorage.setItem('nexora_ref_code', code); } catch {}
            }
          } catch {
            // Network/API failure is actionable; a syntactically valid but
            // unknown code is handled above as an optional referral.
            captureFlight.current = null;
            setInvalidReferral(true);
          }
        }
        if (cancelled || !mounted.current) return;
        setViewer(restored);
        if (restored) {
          try {
            await refreshSnapshot();
          } catch (error) {
            if (cancelled || !mounted.current) return;
            setBootError(toSafeReferralError(error).message);
            setBoot('error');
            return;
          }
        } else {
          setSnapshot(null);
        }
        if (!cancelled && mounted.current) setBoot('ready');
      } catch (error) {
        if (cancelled || !mounted.current) return;
        setBootError(toSafeReferralError(error).message);
        setBoot('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, bootKey, refreshSnapshot, client, sharedReferralCode]);

  // Live auth events: sign-out clears everything; sign-in refreshes state.
  useEffect(() => {
    if (isMockSupabase && !client) return;
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;
      // The reset link lands on /onboarding/login with a recovery session.
      // Show the set-a-new-password screen instead of the funnel; the session
      // is real, so on success the resolver routes onward like any sign-in.
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setBoot('ready');
        if (session?.user) setViewer({ id: String(session.user.id), email: session.user.email || '' });
        return;
      }
      if (event === 'SIGNED_OUT' || !session?.user) {
        if (event === 'SIGNED_OUT') {
          setViewer(null);
          setSnapshot(null);
          setExistingAccountNotice(false);
          setPasswordRecovery(false);
        }
        return;
      }
      setViewer({ id: String(session.user.id), email: session.user.email || '' });
      if (event === 'SIGNED_IN') setPasswordRecovery(false);
      setRefreshing(true);
      void refreshSnapshot().catch(error => {
        if (mounted.current) { setBootError(toSafeReferralError(error).message); setBoot('error'); }
      }).finally(() => {
        if (mounted.current) setRefreshing(false);
      });
    });
    return () => data.subscription.unsubscribe();
  }, [sb, client, refreshSnapshot]);

  const requested: OnboardingSection = matchOnboardingRoute(path);
  const phase: OnboardingPhase = snapshot?.phase ?? 'pending';
  const resolved = resolveOnboardingRoute({ hasSession: !!viewer, phase, requested });

  // A bare /signup is never useful to an authenticated account. Keep a
  // referral-bearing visit on the hybrid choice screen, but otherwise send the
  // user to their current workspace with a one-time toast.
  useEffect(() => {
    if (boot !== 'ready' || !viewer || existingAccountNotice || passwordRecovery) return;
    if (requested === 'signup' && !referralCameFromLink.current) {
      writeFlashToast('You are already logged in.');
      if (typeof window !== 'undefined' && window.location) {
        window.location.assign('/owner/dashboard');
      } else {
        navigate('/owner/dashboard');
      }
    }
  }, [boot, viewer, requested, existingAccountNotice, passwordRecovery, navigate]);

  // Sync the URL to the resolved route (converges in one step — no loops).
  useEffect(() => {
    if (boot !== 'ready' || existingAccountNotice || passwordRecovery) return;
    const canonical = onboardingPath(resolved);
    if (normalizePath(path) !== normalizePath(canonical)) navigate(canonical);
  }, [boot, resolved, path, navigate, existingAccountNotice, passwordRecovery]);

  const handleAuthDone = useCallback(async () => {
    try {
      const restored = await loadViewer(sb);
      if (!mounted.current) return;
      setViewer(restored);
      if (restored) await refreshSnapshot();
    } catch {
      // The auth event subscription covers the steady state; a failed manual
      // refresh here simply leaves the resolver on backend-known state.
    }
  }, [sb, refreshSnapshot]);

  const handleLogout = useCallback(async () => {
    clearAllLocalUserState();
    await signOutViewer(sb);
    if (!mounted.current) return;
    setViewer(null);
    setSnapshot(null);
    setHandoffError('');
    navigate(onboardingPath('login'));
  }, [sb, navigate]);

  // Phase 4: mint a one-time handoff (backend verifies auth + live referral)
  // and redirect to the Template App. Single-flight + disabled button stop
  // double-clicks; the backend additionally keeps at most one active grant.
  const handleContinueToTemplateApp = useCallback(() => {
    if (handoffBusy) return;
    setHandoffBusy(true);
    setHandoffError('');
    void handoffFlight.current
      .run(async () => {
        const state = newHandoffState();
        saveHandoffState(state);
        const handoff = await createTemplateHandoff(sb, state);
        redirectToTemplateApp(buildTemplateHandoffUrl(templateAppBaseUrl(), handoff.token, state));
      })
      .then(
        () => {
          // Success leaves this page (full redirect); busy stays on purpose.
        },
        (error: unknown) => {
          if (!mounted.current) return;
          setHandoffError(toSafeReferralError(error).message);
          setHandoffBusy(false);
        }
      );
  }, [sb, handoffBusy]);

  if (isMockSupabase && !client) return <OnboardingMockNotice />;
  if (boot === 'loading' || (refreshing && !snapshot && !!viewer)) return <OnboardingBootLoading />;
  if (boot === 'error') {
    return <><OnboardingBootError message={bootError} onRetry={() => setBootKey((key) => key + 1)} />
      {invalidReferral && <div className="mx-auto max-w-md px-6 pb-8"><button type="button" className="min-h-11 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold" onClick={() => { setInvalidReferral(false); setSharedReferralCode(''); captureFlight.current = null; setBootKey(key => key + 1); }}>Continue without a referral</button></div>}</>;
  }

  if (existingAccountNotice) return (
    <GatewayShell
      title="Referral code saved"
      subtitle={`You are currently signed in as ${viewer?.email || 'this account'}. Referral codes only apply to new account registrations.`}
    >
      <div className="space-y-3">
        <FormAlert tone="success">
          The referral code <span className="font-mono font-bold">{sharedReferralCode}</span> is saved for a new account. It will not change this account's existing attribution.
        </FormAlert>
        <button
          type="button"
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"
          onClick={() => navigate('/owner/dashboard')}
        >
          Go to Dashboard
        </button>
        <button
          type="button"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800"
          onClick={() => {
            const code = persistReferralIntent(sharedReferralCode);
            clearAllLocalUserState();
            void signOutViewer(sb).finally(() => {
              const destination = code ? `/signup?ref=${encodeURIComponent(code)}` : '/signup';
              if (typeof window !== 'undefined' && window.location) {
                window.location.assign(destination);
              } else {
                navigate('/signup');
              }
            });
          }}
        >
          Log Out &amp; Apply Referral
        </button>
      </div>
    </GatewayShell>
  );

  if (passwordRecovery) {
    return (
      <SetPasswordScreen
        client={sb}
        onDone={() => {
          setPasswordRecovery(false);
          void handleAuthDone();
        }}
        onCancel={() => {
          setPasswordRecovery(false);
          void signOutViewer(sb);
          setViewer(null);
          setSnapshot(null);
          navigate(onboardingPath('login'));
        }}
      />
    );
  }
  if (resolved === 'signup') {
    return (
      <SignupScreen
        prepareAttribution={prepareSignupAttribution}
        referralCode={sharedReferralCode}
        referralState={sharedReferralCode ? (invalidReferral ? 'invalid' : 'valid') : 'none'}
        client={sb}
        onDone={() => void handleAuthDone()}
        onGoLogin={() => navigate(onboardingPath('login'))}
        onReferralCodeChange={(value) => {
          // The field is editable: keep only a canonical complete code as
          // convenience state, never as an attribution decision.
          if (value.trim()) persistReferralIntent(value);
          else clearReferralIntent();
        }}
      />
    );
  }
  if (resolved === 'forgot-password') {
    return <ForgotPasswordScreen client={sb} onGoLogin={() => navigate(onboardingPath('login'))} />;
  }
  if (resolved === 'referral') {
    return (
      <ReferralScreen
        client={sb}
        email={viewer?.email || ''}
        initialCode={skipLinkPrefill ? '' : sharedReferralCode}
        onLinked={() => void handleAuthDone()}
        onLogout={() => void handleLogout()}
      />
    );
  }
  if (resolved === 'website') {
    return (
      <BusinessSetupScreen
        client={sb}
        email={viewer?.email || ''}
        onLogout={() => void handleLogout()}
        onProvisioned={({ salonId }) => {
          // The editor route (rather than the public ?site entry) keeps this
          // owner session inside the guarded, authenticated surface.
          navigate(`/editor?site=${encodeURIComponent(salonId)}`);
        }}
      />
    );
  }
  if (resolved === 'status') {
    return (
      <StatusScreen
        phase={phase}
        referralCode={snapshot?.referralCode ?? null}
        partnerName={snapshot?.partnerName ?? null}
        email={viewer?.email || ''}
        onLogout={() => void handleLogout()}
        onContinueToTemplateApp={phase === 'completed' ? undefined : handleContinueToTemplateApp}
        handoffBusy={handoffBusy}
        handoffError={handoffError}
        completed={phase === 'completed'}
      />
    );
  }
  return (
    <LoginScreen
      client={sb}
      onDone={() => void handleAuthDone()}
      onGoSignup={() => navigate(onboardingPath('signup'))}
      onGoForgot={() => navigate(onboardingPath('forgot-password'))}
    />
  );
};
