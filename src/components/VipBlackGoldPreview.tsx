import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, Crown, Diamond, MapPin, Play, ShieldCheck, Sparkles, Star } from 'lucide-react';

type VipMode = 'salon' | 'spa' | 'atelier';

const MODES: Record<VipMode, { label: string; name: string; tagline: string; hero: string; services: Array<{ name: string; price: string; note: string }> }> = {
  salon: {
    label: 'L’ÉTOILE • LUXURY SALON', name: 'L’Étoile Hair Lounge',
    tagline: 'High-fashion hair sculpture, gold balayage and private concierge appointments.',
    hero: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1800&q=90',
    services: [
      { name: 'Signature French Gold Balayage', price: '₹18,500', note: '180 min • Hair Artistry' },
      { name: 'Royal Caviar Crown Therapy', price: '₹9,500', note: '90 min • Scalp Wellness' },
      { name: 'Couture Precision Cut & Styling', price: '₹6,500', note: '60 min • Sculpt & Style' },
    ],
  },
  spa: {
    label: 'AURA • LUXURY SPA', name: 'AURA Luxury Spa',
    tagline: 'Therapeutic sanctuaries of total gold stillness, tailored for body and mind.',
    hero: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1800&q=90',
    services: [
      { name: 'Champagne & 24K Gold Body Healing', price: '₹22,000', note: '120 min • Body Rituals' },
      { name: 'Elite Oxygen Facial Infusion', price: '₹14,000', note: '75 min • Skin Radiance' },
      { name: 'Obsidian Stone Massage', price: '₹11,000', note: '90 min • Mind Stillness' },
    ],
  },
  atelier: {
    label: 'OBSIDIAN • ATELIER', name: 'The Obsidian Atelier',
    tagline: 'Bespoke body illustration, fine line art and exceptional private studio experiences.',
    hero: 'https://images.unsplash.com/photo-1565058379802-bbe93b2f703e?auto=format&fit=crop&w=1800&q=90',
    services: [
      { name: 'Bespoke Fine-Line Illustration', price: '₹25,000', note: '180 min • Luxury Ink' },
      { name: 'Polynesian Geometric Micro-Art', price: '₹15,500', note: '120 min • Traditional Ink' },
      { name: 'Luxury Jewellery Restructuring', price: '₹8,500', note: '45 min • Structural Gems' },
    ],
  },
};

export function VipBlackGoldPreview({ onChoose }: { onChoose: () => void }) {
  const [mode, setMode] = useState<VipMode>('salon');
  const data = useMemo(() => MODES[mode], [mode]);
  return <main className="min-h-dvh overflow-x-hidden bg-[#050505] pt-20 font-sans text-[#f8f0dd]">
    <section className="relative isolate min-h-[650px] overflow-hidden border-b border-[#d4af37]/25">
      <img src={data.hero} alt="VIP Black & Gold preview" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-45" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_25%,rgba(212,175,55,.24),transparent_33%),linear-gradient(90deg,rgba(5,5,5,.98)_0%,rgba(5,5,5,.8)_45%,rgba(5,5,5,.22)_100%)]" />
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-28 sm:px-8 lg:px-12">
        <div className="mb-14 flex flex-wrap items-center justify-between gap-4 border-y border-[#d4af37]/35 py-4 text-[10px] font-black uppercase tracking-[.25em] text-[#e4c66c]">
          <span className="flex items-center gap-2"><Crown className="h-4 w-4" /> VIP Black & Gold • Signature Collection</span>
          <span className="text-[#f8f0dd]/70">Luxury websites for premium studios</span>
        </div>
        <p className="text-xs font-black tracking-[.3em] text-[#d4af37]">{data.label}</p>
        <h1 className="mt-5 max-w-3xl font-serif text-5xl leading-[.95] sm:text-7xl">{data.name}</h1>
        <p className="mt-7 max-w-xl text-lg leading-8 text-[#f8f0dd]/80">{data.tagline}</p>
        <div className="mt-9 flex flex-wrap gap-3"><button type="button" onClick={onChoose} className="inline-flex items-center gap-2 bg-gradient-to-r from-[#d4af37] via-[#f2d678] to-[#aa820a] px-6 py-3.5 text-sm font-black text-[#110e07] shadow-[0_0_30px_rgba(212,175,55,.35)]"><Crown className="h-4 w-4" /> Choose VIP Design <ArrowRight className="h-4 w-4" /></button><button type="button" onClick={() => document.getElementById('vip-services')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center gap-2 border border-[#d4af37]/70 bg-black/40 px-6 py-3.5 text-sm font-black text-[#f5d06a]"><Play className="h-4 w-4" /> Explore the experience</button></div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-12" id="vip-services">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-black uppercase tracking-[.25em] text-[#d4af37]">One VIP design • three premium uses</p><h2 className="mt-3 font-serif text-4xl">Not a copied hair website.</h2><p className="mt-3 max-w-2xl text-[#f8f0dd]/65">Choose the presentation that fits your business. After selection, all names, services, team, offers and media are editable from the Nexora dashboard.</p></div><div className="flex flex-wrap gap-2">{(Object.keys(MODES) as VipMode[]).map(key => <button key={key} type="button" onClick={() => setMode(key)} className={`border px-4 py-2 text-xs font-black uppercase tracking-wider ${mode === key ? 'border-[#f2d678] bg-[#d4af37] text-black' : 'border-[#d4af37]/35 text-[#e4c66c]'}`}>{MODES[key].label.split(' • ')[0]}</button>)}</div></div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{data.services.map((service, index) => <article key={service.name} className="group border border-[#d4af37]/25 bg-gradient-to-br from-[#17130b] to-[#090909] p-6 transition hover:-translate-y-1 hover:border-[#f2d678] hover:shadow-[0_0_35px_rgba(212,175,55,.16)]"><Diamond className="h-5 w-5 text-[#d4af37]" /><p className="mt-10 text-xs font-black tracking-[.18em] text-[#d4af37]">0{index + 1}</p><h3 className="mt-2 font-serif text-2xl">{service.name}</h3><p className="mt-4 text-sm text-[#f8f0dd]/60">{service.note}</p><p className="mt-7 text-lg font-black text-[#f2d678]">{service.price}</p></article>)}</div>
    </section>
    <section className="border-y border-[#d4af37]/20 bg-[#0b0a08]"><div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-8 md:grid-cols-3 lg:px-12">{[[ShieldCheck, 'VIP concierge', 'Private appointments, priority scheduling and high-touch client care.'], [Sparkles, 'Brand-ready', 'Your own logo, services, staff, gallery, reels and offers replace every demo detail.'], [MapPin, 'All-purpose', 'Built for salon, spa, beauty, grooming, tattoo, wellness and specialist businesses.']].map(([Icon, title, body]) => { const FeatureIcon = Icon as typeof ShieldCheck; return <div key={String(title)}><FeatureIcon className="h-6 w-6 text-[#d4af37]" /><h3 className="mt-5 font-serif text-2xl">{String(title)}</h3><p className="mt-2 text-sm leading-6 text-[#f8f0dd]/60">{String(body)}</p></div> })}</div></section>
    <section className="mx-auto max-w-7xl px-5 py-16 text-center sm:px-8 lg:px-12"><Star className="mx-auto h-6 w-6 fill-[#d4af37] text-[#d4af37]" /><h2 className="mt-4 font-serif text-4xl">Make it your signature.</h2><p className="mx-auto mt-3 max-w-xl text-[#f8f0dd]/65">Select VIP Black & Gold, then personalise every section in the dashboard without rebuilding your website.</p><button type="button" onClick={onChoose} className="mt-7 inline-flex items-center gap-2 bg-[#d4af37] px-6 py-3.5 text-sm font-black text-black"><Check className="h-4 w-4" /> Choose VIP Black & Gold</button></section>
  </main>;
}
