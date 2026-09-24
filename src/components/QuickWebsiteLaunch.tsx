import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Store, UserRound } from 'lucide-react';
import type { SalonProfile } from '../types';

interface Props {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  onExploreTemplates: () => void;
  onOpenDashboard: () => void;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

/** Template browsing stays in the established LandingPage catalogue. */
export const QuickWebsiteLaunch: React.FC<Props> = ({ profile, setProfile, onExploreTemplates, onOpenDashboard, showToast }) => {
  const [step, setStep] = useState<0 | 1>(0);
  const update = (patch: Partial<SalonProfile>) => setProfile((current) => ({ ...current, ...patch }));
  const profileReady = Boolean(profile.ownerName.trim() && profile.phone.trim() && profile.city.trim());
  const continueToTemplates = () => {
    if (!profileReady) return showToast?.('Please add your name, mobile number and city.', 'error');
    setStep(1);
  };
  return <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-24 text-slate-900"><section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#C20E5A]">Nexora website setup</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">Set up your profile, then choose your website</h1><p className="mt-2 text-sm leading-6 text-slate-600">Templates are shown only in the existing Explore Custom Templates catalogue.</p></div><span className="inline-flex h-fit items-center gap-2 rounded-full bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><Clock3 className="h-4 w-4"/>About 30 minutes</span></div>
    <ol className="mt-8 grid grid-cols-2 gap-3">{['Complete profile', 'Explore templates'].map((label, index) => <li key={label} className={`rounded-xl border px-3 py-3 text-xs font-bold ${index === step ? 'border-[#C20E5A] bg-rose-50 text-[#A30B4A]' : 'border-slate-200 text-slate-500'}`}>{index + 1}. {label}</li>)}</ol>
    {step === 0 ? <div className="mt-8 max-w-2xl space-y-5"><div><UserRound className="h-6 w-6 text-[#C20E5A]"/><h2 className="mt-2 text-xl font-black">Complete your profile</h2><p className="mt-1 text-sm text-slate-600">These details are for your owner account and dashboard.</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Your name" value={profile.ownerName} onChange={(value) => update({ ownerName: value })} placeholder="e.g. Priya Sharma"/><Field label="Mobile number" value={profile.phone} onChange={(value) => update({ phone: value, whatsapp: profile.whatsapp || value })} placeholder="e.g. +91 98765 43210"/><Field label="City" value={profile.city} onChange={(value) => update({ city: value })} placeholder="e.g. Jaipur"/><Field label="Email" value={profile.email} onChange={(value) => update({ email: value })} placeholder="you@example.com"/></div></div> : <div className="mt-8 max-w-2xl"><Store className="h-7 w-7 text-[#C20E5A]"/><h2 className="mt-2 text-xl font-black">Browse your existing templates</h2><p className="mt-2 text-sm leading-6 text-slate-600">Open <strong>Explore Custom Templates Designed for Every Category</strong>. It already contains your 27 templates and their existing preview design. No new template list is created here.</p><button type="button" onClick={onExploreTemplates} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#C20E5A] px-5 py-3 text-sm font-bold text-white hover:bg-[#A30B4A]">Explore existing templates <ArrowRight className="h-4 w-4"/></button></div>}
    <div className="mt-8 flex justify-between border-t border-slate-100 pt-5"><button type="button" onClick={() => step === 0 ? onOpenDashboard() : setStep(0)} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100"><ArrowLeft className="h-4 w-4"/>{step === 0 ? 'Do this later' : 'Back'}</button>{step === 0 && <button type="button" onClick={continueToTemplates} className="inline-flex items-center gap-2 rounded-xl bg-[#C20E5A] px-5 py-3 text-sm font-bold text-white hover:bg-[#A30B4A]">Continue <ArrowRight className="h-4 w-4"/></button>}</div>
  </section></main>;
};
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="block text-sm font-bold text-slate-700"><span className="mb-1.5 block">{label}</span><input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-[#C20E5A]"/></label>; }
