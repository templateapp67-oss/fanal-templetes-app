import React, { useEffect } from 'react';
import { BadgeCheck, Image, Plus, Trash2, UserRound } from 'lucide-react';
import type { Stylist } from '../types';

const portfolioImages = [
  'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=700&q=85',
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=700&q=85',
  'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=700&q=85',
];

export function getStylistBio(stylist: Stylist) {
  if (stylist.bio?.trim()) return stylist.bio.trim();
  const specialties = stylist.specialties.filter(Boolean).slice(0, 2).join(' and ') || 'personalised care';
  return `${stylist.name} is a ${stylist.role} known for ${specialties}. Every appointment begins with a thoughtful consultation and finishes with tailored aftercare.`;
}

export function getStylistPortfolioWorks(stylist: Stylist) {
  if (stylist.portfolioWorks?.length) return stylist.portfolioWorks;
  const primary = stylist.specialties.filter(Boolean)[0] || 'Signature Style';
  return portfolioImages.map((imageUrl, index) => ({
    id: `${stylist.id}-work-${index + 1}`,
    title: index === 0 ? primary : index === 1 ? 'Colour & Finish' : 'Client Favourite',
    caption: index === 0 ? 'Signature result' : 'Personalised detail',
    imageUrl,
  }));
}

export function enrichStylist(stylist: Stylist): Stylist {
  const primary = stylist.specialties.filter(Boolean)[0] || 'personalised beauty';
  return {
    ...stylist,
    bio: stylist.bio ?? getStylistBio(stylist),
    portfolioUrl: stylist.portfolioUrl ?? '#gallery-section',
    credentials: stylist.credentials ?? `Certified ${stylist.role} · ${primary}`,
    reviewCount: stylist.reviewCount ?? Math.max(25, Math.round((stylist.rating || 4.9) * 81)),
    signatureWork: stylist.signatureWork ?? `Signature ${primary}`,
    quote: stylist.quote ?? 'Every detail is shaped around your personal style.',
    portfolioWorks: stylist.portfolioWorks?.length ? stylist.portfolioWorks : getStylistPortfolioWorks(stylist),
    verified: stylist.verified ?? true,
  };
}

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';

export function StaffPortfolioEditor({ stylists, setStylists }: { stylists: Stylist[]; setStylists: React.Dispatch<React.SetStateAction<Stylist[]>> }) {
  useEffect(() => { setStylists(current => current.map(enrichStylist)); }, [setStylists]);
  const update = (id: string, patch: Partial<Stylist>) => setStylists(current => current.map(stylist => stylist.id === id ? { ...stylist, ...patch } : stylist));
  const updateWork = (stylist: Stylist, workId: string, patch: Partial<NonNullable<Stylist['portfolioWorks']>[number]>) => update(stylist.id, { portfolioWorks: getStylistPortfolioWorks(stylist).map(work => work.id === workId ? { ...work, ...patch } : work) });
  const add = () => setStylists(current => [...current, enrichStylist({ id: `stylist-${Date.now()}`, name: 'New Team Member', role: 'Beauty Specialist', avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80', specialties: ['Personalised Care'], rating: 4.9 })]);

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-[#C20E5A]" /><h2 className="font-display text-base font-bold">Meet Your Stylist</h2></div><p className="mt-1 text-xs text-slate-500">Complete public profile: credentials, personal story, signature work and portfolio. It matches every selected template theme.</p></div><button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-xl bg-[#C20E5A] px-3 py-2 text-xs font-bold text-white"><Plus className="h-3.5 w-3.5" />Add stylist</button></div>
    <div className="mt-5 space-y-4">{stylists.map(raw => { const stylist = enrichStylist(raw); const works = getStylistPortfolioWorks(stylist); return <article key={stylist.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4"><div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-bold text-slate-700">Name<input value={stylist.name} onChange={event => update(stylist.id, { name: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Role / title<input value={stylist.role} onChange={event => update(stylist.id, { role: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Credentials / experience<input value={stylist.credentials ?? ''} onChange={event => update(stylist.id, { credentials: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Rating & reviews<div className="mt-1 grid grid-cols-2 gap-2"><input type="number" min="1" max="5" step="0.1" value={stylist.rating} onChange={event => update(stylist.id, { rating: Number(event.target.value) })} className={fieldClass.replace('mt-1 ', '')} /><input type="number" min="0" value={stylist.reviewCount ?? 0} onChange={event => update(stylist.id, { reviewCount: Number(event.target.value) })} aria-label="Review count" className={fieldClass.replace('mt-1 ', '')} /></div></label>
      <label className="text-xs font-bold text-slate-700 sm:col-span-2">Professional bio<textarea rows={3} value={stylist.bio ?? ''} onChange={event => update(stylist.id, { bio: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Signature masterwork<input value={stylist.signatureWork ?? ''} onChange={event => update(stylist.id, { signatureWork: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Personal quote<input value={stylist.quote ?? ''} onChange={event => update(stylist.id, { quote: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Specialties <span className="font-normal text-slate-400">(comma separated)</span><input value={stylist.specialties.join(', ')} onChange={event => update(stylist.id, { specialties: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700">Portfolio link<input value={stylist.portfolioUrl ?? '#gallery-section'} onChange={event => update(stylist.id, { portfolioUrl: event.target.value })} className={fieldClass} /></label>
      <label className="text-xs font-bold text-slate-700 sm:col-span-2">Portrait image URL<input value={stylist.avatarUrl} onChange={event => update(stylist.id, { avatarUrl: event.target.value })} className={fieldClass} /></label>
    </div>
    <div className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><Image className="h-3.5 w-3.5" />Signature portfolio works</div><div className="mt-3 grid gap-3 md:grid-cols-3">{works.map(work => <div key={work.id} className="rounded-lg border border-slate-200 bg-white p-2"><img src={work.imageUrl} alt="" className="h-20 w-full rounded-md object-cover" /><input aria-label="Portfolio work title" value={work.title} onChange={event => updateWork(stylist, work.id, { title: event.target.value })} className={fieldClass} /><input aria-label="Portfolio work image URL" value={work.imageUrl} onChange={event => updateWork(stylist, work.id, { imageUrl: event.target.value })} className={fieldClass} /></div>)}</div></div>
    <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><button type="button" onClick={() => update(stylist.id, { verified: !stylist.verified })} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold ${stylist.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><BadgeCheck className="h-3.5 w-3.5" />{stylist.verified ? 'Verified specialist' : 'Unverified'}</button><button type="button" onClick={() => setStylists(current => current.filter(item => item.id !== stylist.id))} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />Remove</button></div>
    </article>; })}</div>
  </section>;
}
