import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import {
  fetchMyGrowthPartnerRow,
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  type GrowthPartner,
} from '../lib/growthPartner';
import {
  loadGrowthPartnerSession,
  resolveGrowthPartnerLogin,
  signInGrowthPartner,
  signUpGrowthPartner,
  signOutGrowthPartner,
  type GrowthPartnerAuthClient,
  type GrowthPartnerLoginState,
  type GrowthPartnerViewer,
} from '../lib/growthPartnerLogin';
import { GROWTH_PARTNER_PATH } from '../lib/router';
import { Field, FormAlert, SubmitButton } from '../onboarding/screens/Shell';

// ============================================================================
// Growth Partner LOGIN route — `/growth-partner/login`.
//
//   • Email + password through Supabase Auth (signInWithPassword). No manual
//     password storage, no second auth system.
//   • After login (or on an already-live session) the backend role is verified
//     by reading the caller's OWN growth_partners row (RLS). A normal user gets
//     zero rows → unauthorized; an inactive partner gets their row → denied
//     (account and data untouched); an active partner is forwarded to the area.
//   • Access is never read from a frontend role flag, a stored value, the URL,
//     or React state — only fetchMyGrowthPartnerRow() decides.
// ============================================================================

export const GROWTH_PARTNER_LOGIN_TITLE = 'Growth Partner sign in';
export const GROWTH_PARTNER_LOGIN_SUBTITLE =
  'Sign in with your Growth Partner account to open your partner area.';
export const GROWTH_PARTNER_LOGIN_VERIFYING_LABEL = 'Checking your Growth Partner access…';
export const GROWTH_PARTNER_LOGIN_MOCK_TITLE = 'Growth Partner sign in needs a live connection';
export const GROWTH_PARTNER_LOGIN_MOCK_BODY =
  'Sign in needs Supabase Auth, which is not connected in this preview.';
export const GROWTH_PARTNER_LOGIN_UNAUTHORIZED_TITLE = 'Growth Partners only';
export const GROWTH_PARTNER_LOGIN_UNAUTHORIZED_BODY =
  'This account is not registered as a Growth Partner. If you were invited as one, sign in with that account.';
export const GROWTH_PARTNER_LOGIN_SESSION_TITLE = 'Your session expired';
export const GROWTH_PARTNER_LOGIN_SESSION_BODY = 'Please sign in again to continue.';
export const GROWTH_PARTNER_LOGIN_ERROR_TITLE = 'Could not verify your Growth Partner access';
export const GROWTH_PARTNER_LOGIN_ERROR_BODY = 'Please try again.';
export const GROWTH_PARTNER_SIGNUP_SUCCESS = 'Application submitted. We will review it and email you after approval.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StateCard({
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 mt-2">{body}</p>
      {children}
    </motion.div>
  );
}

export const GrowthPartnerLoginForm: React.FC<{
  email: string;
  password: string;
  fieldErrors: { email?: string; password?: string };
  formError: string;
  busy: boolean;
  accentHex?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onSwitchToSignup: () => void;
}> = ({ email, password, fieldErrors, formError, busy, accentHex = '#C20E5A', onEmailChange, onPasswordChange, onSubmit, onSwitchToSignup }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{GROWTH_PARTNER_LOGIN_TITLE}</h1>
      <p className="mt-1 text-sm text-slate-600">{GROWTH_PARTNER_LOGIN_SUBTITLE}</p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <Field
          id="growth-partner-login-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={busy}
          error={fieldErrors.email}
          onChange={onEmailChange}
        />
        <Field
          id="growth-partner-login-password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="Your password"
          disabled={busy}
          error={fieldErrors.password}
          onChange={onPasswordChange}
        />
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Signing in…" accentHex={accentHex}>
          Sign in
        </SubmitButton>
        <button type="button" onClick={onSwitchToSignup} className="w-full text-sm font-bold text-slate-500 hover:text-slate-800">Apply as a Growth Partner</button>
      </form>
    </motion.div>
  </main>
);

export const GrowthPartnerSignupForm: React.FC<{
  busy: boolean; formError: string; success: string; accentHex?: string;
  onSubmit: (input: { fullName: string; phone: string; email: string; password: string; kycDocumentType: string; kycDocumentReference: string }) => void; onBack: () => void;
}> = ({ busy, formError, success, accentHex = '#C20E5A', onSubmit, onBack }) => {
  const [fullName, setFullName] = useState(''); const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [kycDocumentType, setKycDocumentType] = useState(''); const [kycDocumentReference, setKycDocumentReference] = useState('');
  return <main className="min-h-[70vh] flex items-center justify-center px-4 py-16"><motion.div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Growth Partner</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Apply as a Growth Partner</h1>
    <p className="mt-1 text-sm text-slate-600">Create an account and submit your application. Access starts only after approval.</p>
    <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit({ fullName, phone, email, password, kycDocumentType, kycDocumentReference }); }}>
      <Field id="growth-partner-signup-name" label="Full name" value={fullName} onChange={setFullName} disabled={busy} />
      <Field id="growth-partner-signup-phone" label="Phone (optional)" value={phone} onChange={setPhone} disabled={busy} />
      <Field id="growth-partner-signup-email" label="Email" type="email" value={email} onChange={setEmail} disabled={busy} />
      <Field id="growth-partner-signup-password" label="Password" type="password" value={password} autoComplete="new-password" onChange={setPassword} disabled={busy} />
      <label className="block text-sm font-bold text-slate-700" htmlFor="growth-partner-kyc-type">KYC document type<select id="growth-partner-kyc-type" value={kycDocumentType} onChange={(e) => setKycDocumentType(e.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"><option value="">Select document</option><option value="pan">PAN</option><option value="aadhaar">Aadhaar</option><option value="passport">Passport</option><option value="driving_license">Driving licence</option><option value="business_registration">Business registration</option></select></label>
      <Field id="growth-partner-kyc-reference" label="KYC reference number" value={kycDocumentReference} onChange={setKycDocumentReference} disabled={busy} placeholder="Reference only; do not upload document here" />
      {formError && <FormAlert tone="error">{formError}</FormAlert>}{success && <FormAlert tone="success">{success}</FormAlert>}
      <SubmitButton busy={busy} busyLabel="Submitting…" accentHex={accentHex}>Submit application</SubmitButton>
      <button type="button" onClick={onBack} className="w-full text-sm font-bold text-slate-500 hover:text-slate-800">Back to sign in</button>
    </form>
  </motion.div></main>;
};

export const GrowthPartnerLoginVerifying: React.FC = () => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <div
      role="status"
      aria-label={GROWTH_PARTNER_LOGIN_VERIFYING_LABEL}
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
      <p className="text-sm font-bold text-slate-700">{GROWTH_PARTNER_LOGIN_VERIFYING_LABEL}</p>
    </div>
  </main>
);

export const GrowthPartnerLoginMockNotice: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<AlertCircle className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_LOGIN_MOCK_TITLE}
      body={GROWTH_PARTNER_LOGIN_MOCK_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerLoginUnauthorized: React.FC<{
  onBack?: () => void;
  onSwitchAccount?: () => void;
}> = ({ onBack, onSwitchAccount }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_LOGIN_UNAUTHORIZED_TITLE}
      body={GROWTH_PARTNER_LOGIN_UNAUTHORIZED_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
      <button
        type="button"
        onClick={() => onSwitchAccount?.()}
        className="mt-3 w-full text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
      >
        Sign in with a different account
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerLoginInactive: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_INACTIVE_TITLE}
      body={GROWTH_PARTNER_INACTIVE_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to app
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerLoginFailure: React.FC<{
  title: string;
  body: string;
  actionLabel: string;
  onAction?: () => void;
}> = ({ title, body, actionLabel, onAction }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard icon={<AlertCircle className="w-7 h-7 text-rose-500" />} title={title} body={body}>
      <button
        type="button"
        onClick={() => onAction?.()}
        className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 bg-slate-900"
      >
        {actionLabel}
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerLogin: React.FC<{
  /** The app's restored session user (null = signed out). Verified again below. */
  user?: { id?: string; email?: string } | null;
  navigate?: (to: string) => void;
  onBack?: () => void;
  accentHex?: string;
  /** Injected in tests; defaults to the shared anon-key client. */
  client?: GrowthPartnerAuthClient;
}> = ({ user, navigate, onBack, accentHex = '#C20E5A', client }) => {
  const sb = useMemo(
    () => client ?? (supabase as unknown as GrowthPartnerAuthClient),
    [client]
  );
  // Authorization read through the SAME source as the auth actions: an
  // injected client supplies its own role read; otherwise the default
  // RLS SELECT-own-row query is used (they are the same client in production).
  const readPartnerRow = client?.fetchPartnerRow ?? fetchMyGrowthPartnerRow;

  // Session source of truth for this route: seed from the app's restored user
  // for first paint, then re-verify against the live Supabase session so a
  // revoked/expired session can never carry a partner in.
  const [sessionUser, setSessionUser] = useState<GrowthPartnerViewer | null>(() =>
    user?.id ? { id: String(user.id), email: typeof user.email === 'string' ? user.email : '' } : null
  );
  const [partnerRow, setPartnerRow] = useState<GrowthPartner | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // If a session user is already seeded (deep link / already-signed-in), the
  // role check is about to run — start in the "verifying" state so the first
  // paint never flashes the "unauthorized" card for a valid partner.
  const [verifying, setVerifying] = useState<boolean>(() => !!user?.id);
  const [attempt, setAttempt] = useState(0);

  // Form state.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState('');

  // 1) Verify the live session (page refresh / already-signed-in path).
  useEffect(() => {
    if (isMockSupabase && !client) return;
    let cancelled = false;
    (async () => {
      try {
        const viewer = await loadGrowthPartnerSession(sb);
        if (!cancelled) setSessionUser(viewer);
      } catch {
        // A failed session read is not an access grant: leave the seeded state
        // and let the role fetch below surface any auth error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, client]);

  // 2) Verify the backend role whenever a session user exists.
  useEffect(() => {
    const userId = sessionUser?.id ?? null;
    if (!userId || (isMockSupabase && !client)) {
      // No session, or a live Supabase connection is unavailable and no test
      // client was injected: nothing to verify (and no placeholder-host call).
      setVerifying(false);
      setPartnerRow(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setVerifying(true);
    setLoadError(null);
    (async () => {
      try {
        const row = await readPartnerRow();
        if (cancelled) return;
        setPartnerRow(row);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setPartnerRow(null);
        setLoadError(error);
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUser?.id, attempt, readPartnerRow, client]);

  const state: GrowthPartnerLoginState = resolveGrowthPartnerLogin({
    loading: verifying,
    isMockMode: isMockSupabase && !client,
    userId: sessionUser?.id ?? null,
    partnerRow,
    loadError,
  });

  // 3) An active Growth Partner never sees the login form twice: forward to the
  //    area (the area re-verifies too). Loop-free: the area is a different path.
  useEffect(() => {
    if (state === 'granted') navigate?.(GROWTH_PARTNER_PATH);
    if (state === 'unauthorized') navigate?.('/growth-partner/onboarding');
  }, [state, navigate]);

  const clearSession = async () => {
    await signOutGrowthPartner(sb);
    setSessionUser(null);
    setPartnerRow(null);
    setLoadError(null);
    setFormError('');
    setFieldErrors({});
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const errors: { email?: string; password?: string } = {};
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    setBusy(true);
    setFormError('');
    void signInGrowthPartner(sb, { email, password }).then(
      (viewer) => setSessionUser(viewer),
      (error: Error) => setFormError(error?.message || 'Login failed. Please try again.')
    ).finally(() => setBusy(false));
  };

  const handleSignup = (input: { fullName: string; phone: string; email: string; password: string; kycDocumentType: string; kycDocumentReference: string }) => {
    if (!input.fullName.trim() || !EMAIL_RE.test(input.email.trim()) || input.password.length < 8 || !input.kycDocumentType || !input.kycDocumentReference.trim()) {
      setFormError('Enter your name, valid email, 8+ character password, and KYC details.'); return;
    }
    setBusy(true); setFormError(''); setSignupSuccess('');
    void signUpGrowthPartner(sb, input).then((result) => {
      setSignupSuccess(result.confirmed ? GROWTH_PARTNER_SIGNUP_SUCCESS : 'Account created. Verify your email, then return here to sign in and submit your application.');
    }, (error: Error) => setFormError(error.message || 'Signup failed. Please try again.')).finally(() => setBusy(false));
  };

  if (state === 'mock-mode') return <GrowthPartnerLoginMockNotice onBack={onBack} />;
  if (state === 'loading' || state === 'granted') return <GrowthPartnerLoginVerifying />;
  if (state === 'signed-out' && signup)
    return <GrowthPartnerSignupForm busy={busy} formError={formError} success={signupSuccess} accentHex={accentHex} onSubmit={handleSignup} onBack={() => { setSignup(false); setFormError(''); }} />;
  if (state === 'signed-out')
    return (
      <GrowthPartnerLoginForm
        email={email}
        password={password}
        fieldErrors={fieldErrors}
        formError={formError}
        busy={busy}
        accentHex={accentHex}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleSubmit}
        onSwitchToSignup={() => { if (navigate) navigate('/growth-partner/onboarding'); else setSignup(true); setFormError(''); }}
      />
    );
  if (state === 'unauthorized')
    return <GrowthPartnerLoginUnauthorized onBack={onBack} onSwitchAccount={() => void clearSession()} />;
  if (state === 'inactive') return <GrowthPartnerLoginInactive onBack={onBack} />;
  if (state === 'session-expired')
    return (
      <GrowthPartnerLoginFailure
        title={GROWTH_PARTNER_LOGIN_SESSION_TITLE}
        body={GROWTH_PARTNER_LOGIN_SESSION_BODY}
        actionLabel="Sign in again"
        onAction={() => void clearSession()}
      />
    );
  return (
    <GrowthPartnerLoginFailure
      title={GROWTH_PARTNER_LOGIN_ERROR_TITLE}
      body={GROWTH_PARTNER_LOGIN_ERROR_BODY}
      actionLabel="Retry"
      onAction={() => setAttempt((value) => value + 1)}
    />
  );
};
