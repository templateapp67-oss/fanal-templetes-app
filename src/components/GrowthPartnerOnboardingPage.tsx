import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { toGrowthPartnerLoginError } from '../lib/growthPartnerLogin';
import { Field, FormAlert, SubmitButton } from '../onboarding/screens/Shell';
import type { User } from '@supabase/supabase-js';

type Application = {
  status: string;
  kyc_status: string;
  full_name: string;
  phone: string | null;
  kyc_document_type: string | null;
  review_note: string | null;
};
const documents: Record<string, string> = {
  pan: 'PAN', aadhaar: 'Aadhaar', passport: 'Passport',
  driving_license: 'Driving licence', business_registration: 'Business registration',
};
const actionClass = 'rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold hover:bg-slate-50 disabled:opacity-50';

export const GrowthPartnerOnboardingPage: React.FC<{
  navigate?: (to: string) => void; accentHex?: string;
}> = ({ navigate, accentHex = '#C20E5A' }) => {
  const [user, setUser] = useState<User | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signup, setSignup] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState(1);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [docType, setDocType] = useState('');
  const [reference, setReference] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError('');
    async function load() {
      if (isMockSupabase) throw new Error('Live connection required');
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const viewer = sessionData.session?.user || null;
      let row: Application | null = null;
      if (viewer) {
        const result = await supabase.from('growth_partner_applications')
          .select('status,kyc_status,full_name,phone,kyc_document_type,review_note')
          .eq('user_id', viewer.id).maybeSingle();
        if (result.error) throw result.error;
        row = result.data;
      }
      if (cancelled) return;
      setUser(viewer);
      setApplication(row);
      setFullName(row?.full_name || viewer?.user_metadata?.full_name || '');
      setPhone(row?.phone || '');
      setDocType(row?.kyc_document_type || '');
      setReference('');
      setEditing(false);
      setStep(1);
    }
    void load().catch(() => {
      if (!cancelled) { setLoadFailed(true); setError('Could not load onboarding. Check your connection and retry.'); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        setApplication(null);
        setReference('');
        setRefresh(value => value + 1);
      }
    });
    return () => { cancelled = true; listener.subscription.unsubscribe(); };
  }, [refresh]);

  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password || (signup && password.length < 8)) {
      setError('Enter a valid email and password. New passwords need at least 8 characters.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      if (signup) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: window.location.origin + '/growth-partner/onboarding' },
        });
        if (authError) throw authError;
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in here to complete KYC.');
          setSignup(false);
        } else setRefresh(value => value + 1);
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        setRefresh(value => value + 1);
      }
      setPassword('');
    } catch (err) { setError(toGrowthPartnerLoginError(err).message); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!fullName.trim() || fullName.trim().length > 120 || phone.length > 30) {
      setError('Enter your full name (up to 120 characters) and a phone number up to 30 characters.');
      setStep(1); return;
    }
    if (step === 1) { setStep(2); return; }
    if (!documents[docType] || !reference.trim() || reference.trim().length > 160) {
      setError('Choose a document and enter its verification reference (up to 160 characters).'); return;
    }
    if (step === 2) { setStep(3); return; }
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('submit_growth_partner_application', {
        p_full_name: fullName.trim(), p_phone: phone.trim() || null,
        p_kyc_document_type: docType, p_kyc_document_reference: reference.trim(),
      });
      if (rpcError) throw rpcError;
      setReference('');
      setRefresh(value => value + 1);
    } catch { setError('Could not submit KYC. Your details are still here; retry or sign in again if your session expired.'); }
    finally { setBusy(false); }
  }

  const showStatus = application && !editing;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <a href="/growth-partner" onClick={event => { if (navigate) { event.preventDefault(); navigate('/growth-partner'); } }} className="text-sm font-semibold text-slate-600">← Partner dashboard</a>
      <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <ShieldCheck className="h-10 w-10" style={{ color: accentHex }} />
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500">Growth Partner app</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{showStatus ? 'Your application' : 'Start your partner journey'}</h1>
        <p className="mt-2 text-sm text-slate-600">Account → Profile → KYC → Partner dashboard</p>
        {error && <div className="mt-5"><FormAlert tone="error">{error}</FormAlert></div>}
        {notice && <div className="mt-5"><FormAlert tone="success">{notice}</FormAlert></div>}
        {loading ? <div role="status" className="mt-8 flex items-center gap-3"><Loader2 className="animate-spin" />Loading onboarding…</div>
          : loadFailed ? <button className={actionClass + ' mt-6'} onClick={() => setRefresh(value => value + 1)}>Retry connection</button>
          : !user ? <form onSubmit={authenticate} className="mt-6 space-y-4">
            <h2 className="text-lg font-bold">{signup ? 'Create your account' : 'Sign in to continue'}</h2>
            <Field id="gp-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" disabled={busy} />
            <Field id="gp-password" label={signup ? 'Password (at least 8 characters)' : 'Password'} type="password" value={password} onChange={setPassword} autoComplete={signup ? 'new-password' : 'current-password'} disabled={busy} />
            <SubmitButton busy={busy} busyLabel="Please wait…" accentHex={accentHex}>{signup ? 'Create account' : 'Sign in'}</SubmitButton>
            <button type="button" disabled={busy} className={actionClass + ' w-full'} onClick={() => { setSignup(value => !value); setError(''); }}>{signup ? 'Already have an account? Sign in' : 'New partner? Create account'}</button>
          </form>
          : showStatus ? <div className="mt-7 space-y-5">
            <div className="rounded-2xl bg-slate-50 p-5">
              <CheckCircle2 className="mb-3 text-slate-500" />
              <h2 className="text-lg font-bold">{application.status === 'approved' ? 'Partner application approved' : application.status === 'rejected' ? 'KYC needs an update' : 'KYC submitted — verification pending'}</h2>
              <p className="mt-2 text-sm text-slate-600">KYC status: {application.kyc_status.replaceAll('_', ' ')}</p>
              <p className="mt-2 text-sm text-slate-600">Submitting a reference does not verify your identity. Dashboard access depends on backend approval.</p>
              {application.review_note && <p className="mt-4 text-sm">{application.review_note}</p>}
            </div>
            <button className={actionClass} onClick={() => setRefresh(value => value + 1)}>Refresh status</button>
            {application.status === 'approved' && <a href="/growth-partner" className={actionClass + ' ml-2 inline-block'}>Open dashboard</a>}
            {(application.status === 'rejected' || application.kyc_status === 'not_submitted') && <button className={actionClass + ' ml-2'} onClick={() => setEditing(true)}>Update KYC</button>}
          </div>
          : <form onSubmit={submit} className="mt-7 space-y-5">
            <p aria-live="polite" className="font-semibold">Step {step} of 3 — {step === 1 ? 'Profile' : step === 2 ? 'KYC details' : 'Review and submit'}</p>
            {step === 1 && <>
              <Field id="gp-name" label="Full name" value={fullName} onChange={setFullName} disabled={busy} />
              <Field id="gp-phone" label="Phone (optional)" type="tel" value={phone} onChange={setPhone} disabled={busy} />
            </>}
            {step === 2 && <>
              <label htmlFor="gp-document" className="block text-sm font-bold">Document type</label>
              <select id="gp-document" value={docType} onChange={event => setDocType(event.target.value)} className="w-full rounded-xl border border-slate-200 p-3"><option value="">Choose document type</option>{Object.entries(documents).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <Field id="gp-reference" label="KYC verification reference" value={reference} onChange={setReference} disabled={busy} />
              <p className="text-sm text-slate-500">Use a verification reference. Do not enter a full Aadhaar number or upload an identity document here.</p>
            </>}
            {step === 3 && <div className="rounded-xl bg-slate-50 p-5 space-y-2"><p><strong>Name:</strong> {fullName}</p><p><strong>Phone:</strong> {phone || 'Not provided'}</p><p><strong>Document:</strong> {documents[docType]}</p><p><strong>Reference:</strong> ••••{reference.slice(-4)}</p><p className="pt-3 text-sm text-slate-600">Your application will be saved for KYC verification.</p></div>}
            <SubmitButton busy={busy} busyLabel="Submitting…" accentHex={accentHex}>{step === 3 ? 'Submit KYC application' : 'Continue'}</SubmitButton>
            {step > 1 && <button type="button" disabled={busy} className={actionClass} onClick={() => { setStep(value => value - 1); setError(''); }}>Back</button>}
          </form>}
        {user && !loading && <div className="mt-8 border-t pt-5 text-sm text-slate-500"><p className="break-all">{user.email}</p><button className="mt-2 font-semibold" onClick={async () => { const { error: signoutError } = await supabase.auth.signOut(); if (signoutError) setError('Could not sign out. Please retry.'); }}>Sign out</button></div>}
      </section>
    </div>
  </main>;
};
