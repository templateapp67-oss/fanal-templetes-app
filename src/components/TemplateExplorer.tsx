import React, { useMemo, useState } from 'react';
import { Search, ArrowRight, Eye, CheckCircle2, Sparkles } from 'lucide-react';
import { TEMPLATE_REGISTRY, getTemplateById, type RegisteredTemplate, type TemplateCategory } from '../data/templates';
import type { BusinessTypeId } from '../types';
import nexoraLogo from '../assets/nexora-salonos-logo.png';

type ExplorerCategory = 'all' | TemplateCategory;

const CATEGORY_FILTERS: Array<{ id: ExplorerCategory; label: string }> = [
  { id: 'all', label: 'All Templates' }, { id: 'barber', label: 'Barber Shop' },
  { id: 'hair', label: 'Hair Studio' }, { id: 'beauty', label: 'Beauty Parlour' },
  { id: 'nails', label: 'Nails & Lashes' }, { id: 'spa', label: 'Spa & Massage' },
  { id: 'ayurvedic', label: 'Ayurvedic Wellness' }, { id: 'skin', label: 'Skin Clinic' },
  { id: 'tattoo', label: 'Tattoo Studio' }, { id: 'kids', label: 'Kids Salon' },
];

function categoryForUrl(value: string): ExplorerCategory {
  return (CATEGORY_FILTERS.some((item) => item.id === value) ? value : 'all') as ExplorerCategory;
}

function TemplateThumbnail({ template }: { template: RegisteredTemplate }) {
  const [failed, setFailed] = useState(!template.thumbnailUrl);
  if (failed) return <div className="relative grid h-52 w-full place-items-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-700 to-[#C20E5A] p-6 text-center text-white">
    <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
    <div className="relative"><Sparkles className="mx-auto h-7 w-7 text-rose-200" /><p className="mt-3 text-lg font-black">{template.name}</p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-rose-100">{template.category}</p></div>
  </div>;
  return <img src={template.thumbnailUrl} onError={() => setFailed(true)} alt={`${template.name} website preview`} className="h-52 w-full object-cover transition duration-300 group-hover:scale-105" />;
}

export interface TemplateExplorerProps {
  category: string; query: string; selectedTemplateId?: BusinessTypeId;
  onFiltersChange: (filters: { category: ExplorerCategory; query: string }) => void;
  onPreview: (templateId: BusinessTypeId) => void; onSelect: (templateId: BusinessTypeId) => void; onHome: () => void;
}

export function TemplateExplorer({ category, query, selectedTemplateId, onFiltersChange, onPreview, onSelect, onHome }: TemplateExplorerProps) {
  const activeCategory = categoryForUrl(category);
  const templates = useMemo(() => TEMPLATE_REGISTRY.filter((template) => {
    const haystack = [template.name, template.tagline, template.description, template.category, ...template.keywords, ...template.keyFeatures].join(' ').toLowerCase();
    return (activeCategory === 'all' || template.category === activeCategory) && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [activeCategory, query]);

  return <main className="min-h-dvh bg-gradient-to-br from-rose-100 via-slate-100 to-violet-100 px-4 pb-14 pt-28 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <button type="button" onClick={onHome} className="text-sm font-bold text-slate-600 hover:text-[#C20E5A]">← Back to Home</button>
      <section className="mt-5 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-slate-900/10 backdrop-blur-xl sm:p-8">
        <img src={nexoraLogo} alt="Nexora" className="mb-5 h-10 w-auto rounded-lg transition duration-200 ease-out hover:scale-105 hover:drop-shadow-lg" />
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Choose a template for your business</h1>
        <p className="mt-3 text-slate-600">Preview complete live websites before selecting your design.</p>
        <label className="relative mt-6 block max-w-2xl"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input aria-label="Search templates" value={query} onChange={(event) => onFiltersChange({ category: activeCategory, query: event.target.value })} placeholder="Search templates: barber, hair, nails, spa, tattoo..." className="w-full rounded-2xl border border-slate-300 py-3 pl-12 pr-4 outline-none focus:border-[#C20E5A] focus:ring-2 focus:ring-rose-100" /></label>
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Template categories">{CATEGORY_FILTERS.map((filter) => <button key={filter.id} type="button" onClick={() => onFiltersChange({ category: filter.id, query })} className={`rounded-full px-4 py-2 text-sm font-bold transition ${activeCategory === filter.id ? 'bg-[#C20E5A] text-white' : 'bg-slate-100 text-slate-700 hover:bg-rose-50'}`}>{filter.label}</button>)}</div>
      </section>

      {selectedTemplateId && getTemplateById(selectedTemplateId) && <div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/70 bg-white/65 p-4 shadow-lg shadow-slate-900/5 backdrop-blur-xl"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" /><div className="min-w-0"><p className="text-xs font-bold uppercase text-emerald-700">Selected design</p><p className="truncate font-black">{getTemplateById(selectedTemplateId)?.name}</p></div><button type="button" onClick={() => onPreview(selectedTemplateId)} className="ml-auto whitespace-nowrap text-sm font-bold text-emerald-800 hover:underline">Preview Full Website</button></div>}
      <p className="mt-7 text-sm font-semibold text-slate-500">Showing: {templates.length} template{templates.length === 1 ? '' : 's'}</p>
      <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{templates.map((template) => <article key={template.id} className="overflow-hidden rounded-3xl border border-white/70 bg-white/70 shadow-lg shadow-slate-900/10 backdrop-blur-xl transition duration-200 ease-out hover:scale-[1.025] hover:shadow-2xl hover:shadow-slate-900/20"><button type="button" onClick={() => onPreview(template.id)} className="group relative block w-full overflow-hidden text-left"><TemplateThumbnail template={template} /><span className="absolute inset-0 grid place-items-center bg-slate-950/0 text-sm font-black text-white transition duration-200 group-hover:bg-slate-950/45"><span className="hidden items-center gap-2 group-hover:flex"><Eye className="h-4 w-4" /> Preview Full Website</span></span></button><div className="p-5"><span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black capitalize text-[#C20E5A]">{template.category}</span><h2 className="mt-3 text-lg font-black">{template.name}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{template.description}</p><ul className="mt-4 space-y-1.5 text-sm text-slate-700">{template.keyFeatures.slice(0, 3).map((feature) => <li key={feature} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul><div className="mt-5 flex gap-2"><button type="button" onClick={() => onPreview(template.id)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold hover:bg-slate-50"><Eye className="h-4 w-4" /> Preview Full Website</button><button type="button" onClick={() => onSelect(template.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#C20E5A] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#A30B4A]">Select &amp; Customize <ArrowRight className="h-4 w-4" /></button></div></div></article>)}</div>
      {!templates.length && <div className="mt-5 rounded-2xl border border-dashed border-white/80 bg-white/70 p-10 text-center shadow-lg shadow-slate-900/5 backdrop-blur-xl"><p className="font-bold">No templates match this search.</p><button type="button" onClick={() => onFiltersChange({ category: 'all', query: '' })} className="mt-3 text-sm font-bold text-[#C20E5A] hover:underline">Clear filters</button></div>}
    </div>
  </main>;
}
