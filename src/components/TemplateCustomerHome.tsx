import { templateRating } from '../lib/templateRating';
import React, { useState } from 'react';
import { ArrowRight, CalendarDays, Clock, Gift, Heart, MapPin, Search, Star } from 'lucide-react';
import { getLuminance } from '../themeAccents';
import type { SalonProfile, SalonService } from '../types';
import type { TemplateCustomerSection } from './TemplateCustomerHub';

/** Customer discovery is part of the website itself, before any dialog opens. */
export function TemplateCustomerHome({ profile, services, dark, accentHex = '#0f172a', onOpen, onBook }: {
  profile: SalonProfile;
  services: SalonService[];
  dark: boolean;
  accentHex?: string;
  onOpen: (section: TemplateCustomerSection) => void;
  onBook: (service?: SalonService) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [gender, setGender] = useState('All');
  const [budget, setBudget] = useState('All');
  const categories = ['All', ...new Set(services.map(service => service.category).filter(Boolean))];
  const search = query.trim().toLowerCase();
  const salonMatches = [profile.businessName, profile.city, profile.address, profile.areaLocality].some(value => value?.toLowerCase().includes(search));
  const filtered = services.filter(service =>
    (salonMatches || `${service.name} ${service.category}`.toLowerCase().includes(search)) &&
    (category === 'All' || service.category === category) &&
    (gender === 'All' || !service.gender || service.gender === 'All genders' || service.gender === gender) &&
    (budget === 'All' || service.price <= Number(budget))
  );
  const prices = services.map(service => service.price).filter(price => Number.isFinite(price) && price >= 0);
  const startingPrice = prices.length ? Math.min(...prices) : null;
  const ratingData = templateRating(profile);
  const ratingCount = ratingData?.count ?? 0;
  const rating = ratingData?.average ?? null;
  const card = dark ? 'bg-white/[0.045] border-white/10' : 'bg-white border-slate-200';
  const muted = dark ? 'text-neutral-400' : 'text-slate-500';
  const field = `min-h-11 rounded-xl border px-3 text-sm w-full ${dark ? 'bg-neutral-900 border-white/15 text-white' : 'bg-white border-slate-200 text-slate-900'}`;
  const primary = { backgroundColor: accentHex, color: getLuminance(accentHex) > 0.179 ? '#09090b' : '#ffffff' };

  return <section aria-label="Explore services and customer account" data-template-customer-home className={`@container/customer-home w-full border-b px-4 py-8 @min-[640px]/salon:p-8 @min-[1024px]/salon:p-12 ${dark ? 'bg-[#101014] border-white/10 text-white' : 'bg-[#f7f8fa] border-slate-200 text-slate-900'}`}>
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.22em] mb-2 ${muted}`}>Your next appointment, made simple</p>
          <h2 className="text-2xl @min-[640px]/customer-home:text-3xl font-bold tracking-tight">Find your next feel-good moment</h2>
        </div>
        <button type="button" onClick={() => onOpen('location')} className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${card}`}><MapPin size={16} /><span>{profile.city || 'Choose location'}</span><ArrowRight size={14} /></button>
      </div>

      <div className={`rounded-2xl border p-4 mb-5 ${card}`}>
        <div className="grid grid-cols-1 @min-[700px]/customer-home:grid-cols-[minmax(0,1fr)_160px_160px] gap-3">
          <label className="flex items-center relative"><Search size={18} className={`absolute left-3 ${muted}`} /><input aria-label="Search this salon, services or location" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search salon, service, area or city" className={`${field} pl-10`} type="search" /></label>
          <select id="customer-home-gender" aria-label="Service type" className={field} value={gender} onChange={event => setGender(event.target.value)}><option value="All">All service types</option>{['Women', 'Men', 'Kids'].map(value => <option key={value}>{value}</option>)}</select>
          <select id="customer-home-budget" aria-label="Price range" className={field} value={budget} onChange={event => setBudget(event.target.value)}><option value="All">Any price</option>{[500, 1000, 2500, 5000].map(value => <option key={value} value={value}>Under ₹{value.toLocaleString('en-IN')}</option>)}</select>
        </div>
        <div className="flex gap-2 flex-wrap mt-4" aria-label="Service categories">{categories.map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)} className={`min-h-10 rounded-full border px-4 text-xs font-semibold ${category === value ? 'border-transparent' : card}`} style={category === value ? primary : undefined}>{value === 'All' ? 'All categories' : value}</button>)}</div>
      </div>

      <div className="grid grid-cols-1 @min-[820px]/customer-home:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start">
        <div>
          <div className="flex items-center justify-between gap-3 mb-3"><h3 className="text-lg font-bold">Quick booking</h3><span role="status" className={`text-xs ${muted}`}>{filtered.length} services</span></div>
          <div className="grid grid-cols-1 @min-[520px]/customer-home:grid-cols-2 gap-3">
            {filtered.slice(0, 4).map(service => <article key={service.id} className={`rounded-2xl border p-4 flex flex-col gap-3 ${card}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className={`text-[10px] uppercase tracking-wider ${muted}`}>{service.category}</p><h4 className="font-bold text-sm mt-1 break-words">{service.name}</h4></div>{service.popular ? <span className="text-[10px] rounded-full px-2 py-1 shrink-0" style={primary}>Popular</span> : null}</div>
              <p className={`text-xs flex items-center gap-1.5 ${muted}`}><Clock size={13} />{service.durationMinutes} min · {service.gender || 'All genders'}</p>
              <div className="mt-auto flex items-center justify-between gap-3"><strong className="text-base">₹{service.price.toLocaleString('en-IN')}</strong><button type="button" aria-label={`Book ${service.name}`} onClick={() => onBook(service)} style={primary} className="min-h-10 rounded-xl px-4 text-xs font-bold">Book <ArrowRight size={13} className="inline ml-1" /></button></div>
            </article>)}
          </div>
          {filtered.length === 0 ? <div className={`rounded-2xl border p-6 ${card}`}><h4 className="font-bold">No matching services</h4><p className={`text-sm mt-2 ${muted}`}>Try another service, category or price range.</p><button type="button" className="underline min-h-11 text-sm" onClick={() => { setQuery(''); setCategory('All'); setGender('All'); setBudget('All'); }}>Clear filters</button></div> : null}
          {filtered.length > 4 ? <button type="button" onClick={() => onOpen('services')} className="min-h-11 mt-3 text-sm font-bold flex items-center gap-2">View all {filtered.length} services <ArrowRight size={15} /></button> : null}
        </div>

        <aside className="flex flex-col gap-4">
          <article className={`rounded-2xl border overflow-hidden ${card}`} aria-label="Featured salon">
            <div className="relative h-36"><img src={profile.coverImageUrl || '/gallery-placeholder.svg'} alt={profile.businessName} className="w-full h-full object-cover" loading="lazy" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/gallery-placeholder.svg'; }} /><button type="button" aria-label="Manage salon favorites" onClick={() => onOpen('favourites')} className="absolute right-3 top-3 min-h-11 min-w-11 rounded-full bg-white text-slate-900 flex items-center justify-center shadow"><Heart size={18} fill="none" /></button><span className="absolute bottom-3 left-3 rounded-full bg-black/70 text-white text-[10px] px-3 py-1.5">Featured studio</span></div>
            <div className="p-4"><h3 className="text-lg font-bold">{profile.businessName}</h3><p className={`text-xs flex items-center gap-1 mt-1 ${muted}`}><MapPin size={13} />{[profile.areaLocality, profile.city].filter(Boolean).join(', ') || 'Location coming soon'}</p><div className="flex flex-wrap justify-between gap-2 mt-3 text-xs">{rating !== null && ratingCount > 0 ? <span className="flex items-center gap-1"><Star size={13} />{rating.toFixed(1)} · {ratingCount} {ratingData?.label}</span> : <span className={muted}>Reviews coming soon</span>}{startingPrice !== null ? <span>From <strong>₹{startingPrice.toLocaleString('en-IN')}</strong></span> : null}</div><div className="flex gap-2 mt-4"><button type="button" className="min-h-11 flex-1 rounded-xl border border-current/20 text-xs font-semibold" onClick={() => onOpen('salon')}>View salon</button><button type="button" className="min-h-11 flex-1 rounded-xl text-xs font-bold" style={primary} onClick={() => onBook()}>Book now</button></div></div>
          </article>
          <button type="button" onClick={() => onOpen('wallet')} className={`rounded-2xl border p-4 text-left flex items-center gap-3 ${card}`}><span className="rounded-xl p-3" style={primary}><Gift size={20} /></span><span className="flex-1"><strong className="block text-sm">Your rewards</strong><span className={`text-xs ${muted}`}>Points, benefits & activity</span></span><ArrowRight size={16} /></button>
        </aside>
      </div>

      <div className="grid grid-cols-2 @min-[700px]/customer-home:grid-cols-4 gap-3 mt-6" aria-label="Customer account shortcuts">{[
        { section: 'bookings' as const, label: 'My appointments', detail: 'Upcoming, completed & cancelled', icon: CalendarDays },
        { section: 'packages' as const, label: 'Packages', detail: 'Services combined for you', icon: Gift },
        { section: 'favourites' as const, label: 'Favorites', detail: 'Your saved salons', icon: Heart },
        { section: 'profile' as const, label: 'My profile', detail: 'Details, addresses & settings', icon: MapPin },
      ].map(({ section, label, detail, icon: Icon }) => <button type="button" key={section} onClick={() => onOpen(section)} className={`min-h-24 rounded-2xl border p-4 text-left ${card}`}><Icon size={18} className="mb-3" /><strong className="block text-sm">{label}</strong><span className={`block text-[11px] mt-1 ${muted}`}>{detail}</span></button>)}</div>
    </div>
  </section>;
}
