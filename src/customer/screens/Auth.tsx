// ============================================================================
// Customer App — sign in / create account.
//
// Customers are Supabase Auth users: that is what makes `bookings.user_id` mean
// anything, and it is how the API resolves which records are yours (the token,
// never a query parameter). The existing `AuthModal` belongs to the owner flow
// and collects a salon name and business type — a customer must not be funnelled
// through that, so this screen calls `supabase.auth` directly with only customer
// fields. No owner screen is touched.
//
// Signup metadata is deliberately minimal (`full_name`); the `handle_new_user`
// trigger then writes the `profiles` row this app's Profile screen edits.
// ============================================================================

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Lock, Mail, Phone, User, ShieldCheck } from 'lucide-react';
import { supabase, isMockSupabase } from '../../lib/supabaseClient';
import { logPasswordLengths } from '../../lib/authPasswordDiagnostics';
import {
  RESET_SENT_MESSAGE,
  completeCustomerPasswordReset,
  sendCustomerPasswordReset,
} from '../../lib/customer/authRecovery';
import { Button, CARD_CLASS, MUTED_CLASS } from '../ui';

/**
 * `recover` asks for the reset email; `reset` is the form a customer lands on
 * after following the link, when Supabase Auth has already exchanged the token
 * for a recovery session (the shell switches the screen into it on
 * PASSWORD_RECOVERY).
 */
export type CustomerAuthMode = 'login' | 'signup' | 'recover' | 'reset';

export interface AuthScreenProps {
  accentHex?: string;
  /** Called after a successful sign-in/sign-up so the shell can continue. */
  onAuthenticated: (user: { id: string; email?: string }) => void;
  /** Guests may browse salons; only booking needs an account. */
  onContinueAsGuest: () => void;
  mode?: CustomerAuthMode;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ accentHex = '#C20E5A', onAuthenticated, onContinueAsGuest, mode: initialMode = 'login' }) => {
  const [mode, setMode] = useState<CustomerAuthMode>(initialMode);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');

    // Password managers can update the DOM without dispatching React change.
    // Read submitted controls so a visible 6+ character password is not
    // validated as a stale shorter state value.
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const submittedEmail = String(form.get('customer-email') ?? email);
    const submittedPassword = String(
      form.get(mode === 'reset' ? 'customer-new-password' : 'customer-password') ?? password
    );
    const submittedConfirm = String(form.get('customer-new-password-confirm') ?? confirmPassword);
    const submittedFullName = String(form.get('customer-full-name') ?? fullName);
    const submittedPhone = String(form.get('customer-phone') ?? phone);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setConfirmPassword(submittedConfirm);
    setFullName(submittedFullName);
    setPhone(submittedPhone);
    logPasswordLengths(`customer-auth:${mode}`, password, submittedPassword);

    // Recovery runs before the mock guard below: `sendCustomerPasswordReset`
    // reports the unconfigured deployment in its own words, and a reset request
    // must not be rejected as "enter your email and password" for want of a
    // password field this form does not have.
    if (mode === 'recover' || mode === 'reset') {
      setBusy(true);
      try {
        if (mode === 'recover') {
          await sendCustomerPasswordReset(submittedEmail);
          // Same copy whether or not the address has an account, so this form
          // cannot be used to enumerate registered customers.
          setNotice(RESET_SENT_MESSAGE);
          setEmail('');
        } else {
          await completeCustomerPasswordReset(submittedPassword, submittedConfirm);
          // The recovery session Supabase created from the link is a real
          // session, so the customer is signed in the moment the password is
          // accepted — no second email and no re-entry of the old one.
          const { data } = await supabase.auth.getSession();
          const user = data?.session?.user;
          if (!user?.id) throw new Error('Your session expired. Sign in with your new password.');
          onAuthenticated({ id: String(user.id), email: user.email ?? undefined });
        }
      } catch (err: any) {
        setError(describeAuthError(String(err?.message || err || '')));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isMockSupabase) {
      setError(
        'Sign-in needs the connected Supabase project. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — accounts are real database users, so there is no demo login here.'
      );
      return;
    }
    if (!submittedEmail.trim() || !submittedPassword) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && submittedPassword.length < 6) {
      setError('Use at least 6 characters for your password.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: submittedEmail.trim(),
          password: submittedPassword,
          options: {
            data: {
              full_name: submittedFullName.trim(),
              // The phone is stored as auth metadata as well as on the profile,
              // so a booking can be pre-filled before the profile row exists.
              phone: submittedPhone.trim(),
            },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice('Account created. Check your inbox to confirm the address, then sign in to book.');
          setMode('login');
          setBusy(false);
          return;
        }
        // Write the profile fields the trigger cannot know about.
        if (data.user?.id && (submittedPhone.trim() || submittedFullName.trim())) {
          await fetch('/api/customer/me/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
            body: JSON.stringify({ fullName: submittedFullName.trim(), phone: submittedPhone.trim() }),
          }).catch(() => undefined);
        }
        onAuthenticated({ id: String(data.user?.id ?? ''), email: data.user?.email ?? undefined });
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: submittedEmail.trim(), password: submittedPassword });
        if (signInError) throw signInError;
        onAuthenticated({ id: String(data.user?.id ?? ''), email: data.user?.email ?? undefined });
      }
    } catch (err: any) {
      setError(describeAuthError(String(err?.message || err || '')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto pt-6 pb-16">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`${CARD_CLASS} p-6`}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4" style={{ color: accentHex }} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Nexora customer account</span>
        </div>
        <h1 className="text-xl font-extrabold text-slate-900">{headingFor(mode)}</h1>
        <p className={`text-sm mt-1 ${MUTED_CLASS}`}>{subheadingFor(mode)}</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'signup' ? (
            <>
              <Labeled icon={<User className="w-4 h-4" />}>
                <input
                  name="customer-full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                  autoComplete="name"
                />
              </Labeled>
              <Labeled icon={<Phone className="w-4 h-4" />}>
                <input
                  name="customer-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Mobile number"
                  inputMode="tel"
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                  autoComplete="tel"
                />
              </Labeled>
            </>
          ) : null}

          {/* Recovery asks for the address only; the reset form asks for the new
              password twice and never for the old one — the recovery session
              already proved who is asking. */}
          {mode !== 'reset' ? (
            <Labeled icon={<Mail className="w-4 h-4" />}>
              <input
                name="customer-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                autoComplete="email"
              />
            </Labeled>
          ) : null}

          {mode === 'login' || mode === 'signup' ? (
            <Labeled icon={<Lock className="w-4 h-4" />}>
              <input
                name="customer-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signup' ? 'Create a password (6+ characters)' : 'Your password'}
                type="password"
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Labeled>
          ) : null}

          {mode === 'reset' ? (
            <>
              <Labeled icon={<Lock className="w-4 h-4" />}>
                <input
                  name="customer-new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="New password (6+ characters)"
                  type="password"
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                  autoComplete="new-password"
                />
              </Labeled>
              <Labeled icon={<Lock className="w-4 h-4" />}>
                <input
                  name="customer-new-password-confirm"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat the new password"
                  type="password"
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                  autoComplete="new-password"
                />
              </Labeled>
            </>
          ) : null}

          {error ? (
            <p className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5" role="status">
              {notice}
            </p>
          ) : null}

          <Button type="submit" busy={busy} accentHex={accentHex} className="w-full">
            {submitLabelFor(mode)}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-2 text-sm">
          {mode === 'login' || mode === 'signup' ? (
            <button
              id="auth-toggle-mode-btn"
              type="button"
              className="font-bold cursor-pointer min-h-[44px] px-2 -ml-2 inline-flex items-center rounded-lg hover:underline"
              style={{ color: accentHex }}
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}
            >
              {mode === 'login' ? 'Create an account' : 'I already have an account'}
            </button>
          ) : (
            <button
              id="auth-back-to-login-btn"
              type="button"
              className="font-bold cursor-pointer min-h-[44px] px-2 -ml-2 inline-flex items-center gap-1.5 rounded-lg hover:underline"
              style={{ color: accentHex }}
              onClick={() => { setMode('login'); setError(''); setNotice(''); setPassword(''); setConfirmPassword(''); }}
            >
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </button>
          )}

          {mode === 'login' ? (
            <button
              id="auth-forgot-password-btn"
              type="button"
              onClick={() => { setMode('recover'); setError(''); setNotice(''); setPassword(''); }}
              className={`${MUTED_CLASS} font-semibold hover:text-slate-900 cursor-pointer min-h-[44px] px-2 inline-flex items-center rounded-lg`}
            >
              Forgot password?
            </button>
          ) : null}

          <button
            id="auth-browse-guest-btn"
            type="button"
            onClick={onContinueAsGuest}
            className={`${MUTED_CLASS} font-semibold hover:text-slate-900 cursor-pointer min-h-[44px] px-2 -mr-2 inline-flex items-center rounded-lg`}
          >
            Browse as guest
          </button>
        </div>
      </motion.div>
      {isMockSupabase ? (
        <p className="text-xs text-slate-500 mt-4 px-1">
          Supabase is not configured for this deployment, so accounts cannot be created. Connect the project and this screen will sign you straight into your real records.
        </p>
      ) : null}
    </div>
  );
};

/** Copy per mode, kept next to the screen that renders it. */
function headingFor(mode: CustomerAuthMode): string {
  if (mode === 'signup') return 'Create your account';
  if (mode === 'recover') return 'Reset your password';
  if (mode === 'reset') return 'Choose a new password';
  return 'Welcome back';
}

function subheadingFor(mode: CustomerAuthMode): string {
  if (mode === 'signup') return 'One account covers every salon you book through Nexora.';
  if (mode === 'recover') {
    return 'Enter the email on your account and we will send a link to set a new password.';
  }
  if (mode === 'reset') {
    return 'Your reset link is verified — set a new password and you are signed straight in.';
  }
  return 'Your bookings, rewards and notifications all live in your salon’s database.';
}

function submitLabelFor(mode: CustomerAuthMode): string {
  if (mode === 'signup') return 'Create account';
  if (mode === 'recover') return 'Send reset link';
  if (mode === 'reset') return 'Save new password';
  return 'Sign in';
}

/**
 * Supabase Auth returns raw GoTrue strings. Customers cannot act on
 * "Invalid login credentials", so each known case is translated once, here,
 * rather than in three places on the form. Recovery copy comes from
 * `src/lib/customer/authRecovery.ts#describeResetError`, which already returns
 * customer-ready text — the fallback at the bottom passes it through untouched.
 */
export function describeAuthError(message: string): string {
  if (/invalid login credentials|invalid credentials/i.test(message)) {
    return 'That email and password do not match an account. Try again or create an account.';
  }
  if (/already registered|already exists/i.test(message)) {
    return 'An account with that email already exists. Sign in instead.';
  }
  if (/confirm your email|not confirmed|email not confirmed/i.test(message)) {
    return 'Confirm your email address first, then sign in.';
  }
  if (/rate limit|too many requests/i.test(message)) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  if (/password.*at least|length/i.test(message)) {
    return 'Use at least 6 characters for your password.';
  }
  return message || 'We could not complete that. Please try again.';
}

const Labeled: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <label className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-slate-300">
    <span className="text-slate-400">{icon}</span>
    {children}
  </label>
);
