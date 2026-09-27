import React from 'react';
import type { BusinessTypeId } from '../types';
import { getTemplateById } from '../data/templates';

interface LandingPageProps { onBrowseTemplates: (category?: string) => void; selectedTemplateId?: BusinessTypeId; }

/** Home deliberately stays small: the catalogue belongs exclusively to /templates. */
export const LandingPage: React.FC<LandingPageProps> = ({ onBrowseTemplates, selectedTemplateId }) => {
  const selected = getTemplateById(selectedTemplateId);
  return <main className="min-h-dvh bg-surface px-4 pb-12 pt-28 text-on-surface sm:px-8">
    <section className="mx-auto grid max-w-6xl items-center gap-10 py-12 lg:grid-cols-[1.1fr_.9fr]">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#C20E5A]">Step 1 of 3</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-black tracking-tight sm:text-5xl">Choose a website design for your business</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-on-surface-variant">Explore ready-to-use websites for Barber Shop, Hair Studio, Beauty Parlour, Nails, Spa, Tattoo, Skin Clinic and more.</p>
        <button type="button" onClick={() => onBrowseTemplates()} className="mt-7 rounded-xl bg-[#C20E5A] px-6 py-3 text-sm font-black text-white shadow-lg shadow-rose-900/20 hover:bg-[#A30B4A]">Choose Your Template</button>
        <div className="mt-7 flex flex-wrap items-center gap-2 text-sm font-bold"><button type="button" onClick={() => onBrowseTemplates('barber')} className="rounded-full bg-slate-100 px-4 py-2 hover:bg-rose-50">Barber Shop</button><button type="button" onClick={() => onBrowseTemplates('beauty')} className="rounded-full bg-slate-100 px-4 py-2 hover:bg-rose-50">Beauty Parlour</button><button type="button" onClick={() => onBrowseTemplates('nails')} className="rounded-full bg-slate-100 px-4 py-2 hover:bg-rose-50">Nails &amp; Lashes</button><button type="button" onClick={() => onBrowseTemplates()} className="px-2 py-2 text-[#C20E5A] hover:underline">View all templates →</button></div>
      </div>
      <div className="overflow-hidden rounded-3xl border border-outline-variant/40 bg-white p-3 shadow-xl"><img src={getTemplateById('hair_salon')?.thumbnailUrl} alt="Nexora website design preview" className="h-72 w-full rounded-2xl object-cover sm:h-96" /></div>
    </section>
    {selected && <section className="mx-auto flex max-w-6xl items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><img src={selected.thumbnailUrl} alt="" className="h-14 w-14 rounded-xl object-cover" /><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Selected design</p><p className="font-black">{selected.name}</p></div><button type="button" onClick={() => onBrowseTemplates()} className="ml-auto text-sm font-black text-emerald-800 hover:underline">Change Template</button></section>}
  </main>;
};
