import React, { useEffect } from 'react';
import { Image, Plus, Trash2, UserRound } from 'lucide-react';
import type { Stylist } from '../types';
import { cleanImageUrlInput } from '../lib/websiteValidation';
import { FieldError, ItemIssues, useFieldIssueProps } from './WebsiteIssues';

export function getStylistBio(stylist: Stylist) {
  if (stylist.bio?.trim()) return stylist.bio.trim();
  // A team member is only required to have an id and a name; the database hands the rest back absent.
  const specialties = (stylist.specialties ?? []).filter(Boolean).slice(0, 2).join(' and ') || 'personalised care';
  const role = stylist.role?.trim() || 'team member';
  return `${stylist.name} is a ${role} known for ${specialties}. Every appointment begins with a thoughtful consultation and finishes with tailored aftercare.`;
}

const noopSetStylists: React.Dispatch<React.SetStateAction<Stylist[]>> = () => undefined;

type StylistCardProps = {
  stylist: Stylist;
  index: number;
  update: (id: string, patch: Partial<Stylist>) => void;
  remove: (id: string) => void;
};

/** One team member. Shows the problem a blocked save found in it, field by field. */
const StylistCard: React.FC<StylistCardProps> = ({ stylist, index, update, remove }) => {
  const base = `stylists[${index}]`;
  const nameField = useFieldIssueProps(`${base}.name`);
  const portraitField = useFieldIssueProps(`${base}.avatarUrl`);
  const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';
  return <article data-field-path={base} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">Name<input value={stylist.name} {...nameField.attrs} onChange={event => update(stylist.id, { name: event.target.value })} className={nameField.className(input)} /><FieldError path={`${base}.name`} /></label><label className="text-xs font-bold text-slate-700">Role / title<input value={stylist.role} onChange={event => update(stylist.id, { role: event.target.value })} className={input} /></label><label className="text-xs font-bold text-slate-700 sm:col-span-2">Professional bio<textarea rows={3} value={stylist.bio ?? getStylistBio(stylist)} onChange={event => update(stylist.id, { bio: event.target.value })} className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-sm" /></label><label className="text-xs font-bold text-slate-700">Specialties <span className="font-normal text-slate-400">(comma separated)</span><input value={(stylist.specialties ?? []).join(', ')} onChange={event => update(stylist.id, { specialties: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} className={input} /></label><label className="text-xs font-bold text-slate-700">Portfolio link<input value={stylist.portfolioUrl ?? '#gallery-section'} onChange={event => update(stylist.id, { portfolioUrl: event.target.value })} placeholder="https://instagram.com/… or #gallery-section" className={input} /></label><label className="text-xs font-bold text-slate-700 sm:col-span-2">Portrait image URL<input value={stylist.avatarUrl ?? ''} {...portraitField.attrs} onChange={event => update(stylist.id, { avatarUrl: event.target.value })} onBlur={() => { const cleaned = cleanImageUrlInput(stylist.avatarUrl ?? ''); if (cleaned !== (stylist.avatarUrl ?? '')) update(stylist.id, { avatarUrl: cleaned }); }} className={portraitField.className(input)} /><FieldError path={`${base}.avatarUrl`} /></label></div><ItemIssues prefix={`${base}.assignedServices`} /><ItemIssues prefix={`${base}.schedule`} /><div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><Image className="h-3.5 w-3.5" />Portfolio is visible in the public template</span><button type="button" onClick={() => remove(stylist.id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />Remove</button></div></article>;
};

export function StaffPortfolioEditor({ stylists = [], setStylists = noopSetStylists }: { stylists?: Stylist[]; setStylists?: React.Dispatch<React.SetStateAction<Stylist[]>> }) {
  useEffect(() => {
    setStylists(current => current.map(stylist => {
      const needsBio = typeof stylist.bio === 'undefined';
      const needsPortfolio = typeof stylist.portfolioUrl === 'undefined';
      return needsBio || needsPortfolio ? { ...stylist, ...(needsBio ? { bio: getStylistBio(stylist) } : {}), ...(needsPortfolio ? { portfolioUrl: '#gallery-section' } : {}) } : stylist;
    }));
  }, [setStylists]);
  const update = (id: string, patch: Partial<Stylist>) => setStylists(current => current.map(stylist => stylist.id === id ? { ...stylist, ...patch } : stylist));
  const add = () => setStylists(current => [...current, { id: `stylist-${Date.now()}`, name: 'New Team Member', role: 'Beauty Specialist', avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80', specialties: ['Personalised Care'], rating: 4.9, bio: 'A friendly specialist focused on thoughtful consultations, polished results, and personalised aftercare.', portfolioUrl: '#gallery-section' }]);
  return <section data-field-path="stylists" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-[#C20E5A]" /><h2 className="font-display text-base font-bold">Meet Your Stylist</h2></div><p className="mt-1 text-xs text-slate-500">Add a professional bio and portfolio link for every specialist. These details appear on every template’s team section.</p></div><button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-xl bg-[#C20E5A] px-3 py-2 text-xs font-bold text-white"><Plus className="h-3.5 w-3.5" />Add stylist</button></div><div className="mt-5 space-y-4">{stylists.map((stylist, index) => <StylistCard key={stylist.id} stylist={stylist} index={index} update={update} remove={id => setStylists(current => current.filter(item => item.id !== id))} />)}</div></section>;
}
