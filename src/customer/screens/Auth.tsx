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
import { ArrowRight, Lock, Mail, Phone, User, ShieldCheck } from 'lucide-react';
import { supabase, isMockSupabase } from '../../lib/supabaseClient';
import { Button, CARD_CLASS, MUTED_CLASS } from '../ui';

export interface AuthScreenProps {
  accentHex?: string;
  /** Called after a successful sign-in/sign-up so the shell can continue. */
  onAuthenticated: (user: { id: string; email?: string }) => void;
  /** Guests may browse salons; only booking needs an account. */
  onContinueAsGuest: () => void;
  mode?: 'login' | 'signup';
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ accentHex = '#C20E5A', onAuthenticated, onContinueAsGuest, mode: initialMode = 'login' }) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
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

    if (isMockSupabase) {
      setError(
        'Sign-in needs the connected Supabase project. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — accounts are real database users, so there is no demo login here.'
      );
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setError('Use at least 6 characters for your password.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              // The phone is stored as auth metadata as well as on the profile,
              // so a booking can be pre-filled before the profile row exists.
              phone: phone.trim(),
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
        if (data.user?.id && (phone.trim() || fullName.trim())) {
          await fetch('/api/customer/me/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
            body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() }),
          }).catch(() => undefined);
        }
        onAuthenticated({ id: String(data.user?.id ?? ''), email: data.user?.email ?? undefined });
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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
        <h1 className="text-xl font-extrabold text-slate-900">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className={`text-sm mt-1 ${MUTED_CLASS}`}>
          {mode === 'login'
            ? 'Your bookings, rewards and notifications all live in your salon’s database.'
            : 'One account covers every salon you book through Nexora.'}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'signup' ? (
            <>
              <Labeled icon={<User className="w-4 h-4" />}>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
                  autoComplete="name"
                />
              </Labeled>
              <Labeled icon={<Phone className="w-4 h-4" />}>
                <input
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

          <Labeled icon={<Mail className="w-4 h-4" />}>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
              autoComplete="email"
            />
          </Labeled>

          <Labeled icon={<Lock className="w-4 h-4" />}>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'signup' ? 'Create a password (6+ characters)' : 'Your password'}
              type="password"
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </Labeled>

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
            {mode === 'login' ? 'Sign in' : 'Create account'}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <button type="button" className="font-bold cursor-pointer" style={{ color: accentHex }} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Create an account' : 'I already have an account'}
          </button>
          <button type="button" onClick={onContinueAsGuest} className={`${MUTED_CLASS} font-semibold hover:text-slate-900 cursor-pointer`}>
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

/**
 * Supabase Auth returns raw GoTrue strings. Customers cannot act on
 * "Invalid login credentials", so each known case is translated once, here,
 * rather than in three places on the form.
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
