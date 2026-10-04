import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { SalonProfile } from '../types';

export function PublishedSectionEmpty({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div data-published-empty className="w-full rounded-2xl border border-current/15 bg-current/[0.025] p-6 my-5">
    <Sparkles size={24} className="mb-3 opacity-60" /><h3 className="text-lg font-semibold">{title}</h3><p className="text-sm opacity-70 mt-2 max-w-2xl leading-relaxed">{detail}</p>
    {action && onAction && <button type="button" onClick={onAction} className="inline-flex items-center gap-2 min-h-11 rounded-xl border border-current/20 px-4 mt-4 text-sm font-semibold">{action}<ArrowRight size={16} /></button>}
  </div>;
}

export function PublishedOwnerCard({ profile, onBook }: { profile: SalonProfile; onBook: () => void }) {
  const name = profile.ownerName?.trim();
  if (!name || /^(user|template app)$/i.test(name)) return <PublishedSectionEmpty title="Your studio team" detail="Specialist profiles have not been published yet. The studio will help you choose the right professional for your appointment." action="View appointment options" onAction={onBook} />;
  const photo = profile.ownerPhotoUrl && !profile.ownerPhotoUrl.endsWith('/nexora-salonos-logo.png') ? profile.ownerPhotoUrl : '';
  return <article data-published-owner className="rounded-2xl border border-current/15 p-6 my-5 max-w-3xl">
    <div className="flex gap-4 items-center">{photo ? <img src={photo} alt={name} className="h-16 w-16 rounded-full object-cover" onError={event => { event.currentTarget.src = '/gallery-placeholder.svg'; event.currentTarget.onerror = null; }} /> : <span className="h-16 w-16 rounded-full border grid place-items-center text-2xl font-semibold">{name[0]}</span>}<div><h3 className="text-xl font-semibold">{name}</h3><p className="text-sm opacity-70">{profile.ownerRole || 'Studio owner'}{profile.ownerExperience ? ` · ${profile.ownerExperience}` : ''}</p></div></div>
    {profile.ownerBio && <p className="text-sm leading-relaxed opacity-70 mt-4">{profile.ownerBio}</p>}
    <p className="text-xs opacity-60 mt-4">Appointments are arranged with the studio.</p><button type="button" onClick={onBook} className="min-h-11 rounded-xl border border-current/20 px-4 mt-3 text-sm font-semibold">Book with the studio</button>
  </article>;
}
