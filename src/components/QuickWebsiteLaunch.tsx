import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Search, Sparkles, Store, UserRound } from 'lucide-react';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import type { BusinessTypeId, SalonProfile } from '../types';

interface Props {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  selectedTemplateId?: BusinessTypeId;
  onSelectTemplate: (id: BusinessTypeId) => void;
  onSave: () => Promise<boolean>;
  onGoLive: () => void;
  onOpenDashboard: () => void;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}
const STEPS = ['Your profile', 'Your business', 'Choose a template', 'Go live'];

export const QuickWebsiteLaunch: React.FC<Props> = ({ profile, setProfile, selectedTemplateId, onSelectTemplate, onSave, onGoLive, onOpenDashboard, showToast }) => {
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const templates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(CATEGORY_TEMPLATES).filter((item) => !q || [item.title, item.shortName, ...item.subCategories].join(' ').toLowerCase().includes(q));
  }, [search]);
  const update = (patch: Partial<SalonProfile>) => setProfile((current) => ({ ...current, ...patch }));
  const ready = [
    Boolean(profile.ownerName.trim() && profile.phone.trim() && profile.city.trim()),
    Boolean(profile.businessName.trim()),
    Boolean(selectedTemplateId || profile.businessType),
    true,
  ];
  const next = () => {
    if (!ready[step]) {
      showToast?.(step === 0 ? 'Add your name, mobile number and city.' : step === 1 ? 'Add your shop name.' : 'Choose one template to continue.', 'error');
      return;
    }
    setStep((current) => Math.min(current + 1, 3));
  };
  const publish = async () => {
    setSaving(true);
    try {
      if (await onSave()) onGoLive();
      else showToast?.('We could not save your website yet. Please retry.', 'error');
    } finally { setSaving(false); }
  };
  return <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-24 text-slate-900"><section className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#C20E5A]">Nexora quick launch</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">Launch your website in four simple steps</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Add the basics now. Services, images and advanced settings can be changed later from your dashboard.</p></div><span className="inline-flex h-fit items-center gap-2 rounded-full bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><Clock3 className="h-4 w-4"/>About 30 minutes</span></div>
    <ol className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">{STEPS.map((label, index) => <li key={label} className={`rounded-xl border px-3 py-3 text-xs font-bold ${index === step ? 'border-[#C20E5A] bg-rose-50 text-[#A30B4A]' : index < step ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>{index < step ? '✓' : index + 1}. {label}</li>)}</ol>
    <div className="mt-8 min-h-[330px]">
      {step === 0 && <div className="max-w-2xl space-y-5"><UserRound className="h-6 w-6 text-[#C20E5A]"/><h2 className="text-xl font-black">First, tell us about you</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="Your name" value={profile.ownerName} onChange={(value) => update({ ownerName: value })}/><Field label="Mobile number" value={profile.phone} onChange={(value) => update({ phone: value, whatsapp: profile.whatsapp || value })}/><Field label="City" value={profile.city} onChange={(value) => update({ city: value })}/><Field label="Email" value={profile.email} type="email" onChange={(value) => update({ email: value })}/></div></div>}
      {step === 1 && <div className="max-w-2xl space-y-5"><Store className="h-6 w-6 text-[#C20E5A]"/><h2 className="text-xl font-black">What is your shop called?</h2><p className="text-sm text-slate-600">We use this for your website title. You can change it later.</p><Field label="Shop / salon name" value={profile.businessName} onChange={(value) => update({ businessName: value, subdomain: value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || profile.subdomain })}/></div>}
      {step === 2 && <div><Sparkles className="h-6 w-6 text-[#C20E5A]"/><h2 className="mt-2 text-xl font-black">Choose your category and template</h2><p className="mt-1 text-sm text-slate-600">Search your business type; only matching templates appear.</p><label className="relative mt-5 block max-w-xl"><Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search: hair, barber, spa, nail, beauty…" className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#C20E5A]"/></label><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map((item) => { const selected = (selectedTemplateId || profile.businessType) === item.id; return <button type="button" key={item.id} onClick={() => onSelectTemplate(item.id as BusinessTypeId)} className={`overflow-hidden rounded-2xl border text-left ${selected ? 'border-[#C20E5A] ring-4 ring-rose-100' : 'border-slate-200 hover:border-rose-300'}`}><img src={item.coverImageUrl} alt="" className="h-28 w-full object-cover"/><span className="block p-4 text-sm font-bold">{item.shortName}{selected && <Check className="float-right h-5 w-5 text-[#C20E5A]"/>}<small className="mt-1 block font-normal text-slate-500">{item.subCategories.slice(0, 2).join(' · ')}</small></span></button>; })}</div></div>}
      {step === 3 && <div className="max-w-2xl"><CheckCircle2 className="h-8 w-8 text-emerald-600"/><h2 className="mt-2 text-xl font-black">Your website is ready to publish</h2><p className="mt-2 text-sm leading-6 text-slate-600">We will publish <strong>{profile.businessName}</strong> with the <strong>{CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.shortName || 'selected'}</strong> template. You can edit everything later.</p></div>}
    </div>
    <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-5 sm:flex-row"><button type="button" onClick={() => step === 0 ? onOpenDashboard() : setStep((current) => current - 1)} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100"><ArrowLeft className="h-4 w-4"/>{step === 0 ? 'Do this later' : 'Back'}</button>{step < 3 ? <button type="button" onClick={next} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#C20E5A] px-5 py-3 text-sm font-bold text-white">Continue <ArrowRight className="h-4 w-4"/></button> : <button type="button" disabled={saving} onClick={() => void publish()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#C20E5A] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Publishing…' : 'Publish my website'} <CheckCircle2 className="h-4 w-4"/></button>}</div>
  </section></main>;
};
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="block text-sm font-bold text-slate-700"><span className="mb-1.5 block">{label}</span><input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-[#C20E5A]"/></label>; }
