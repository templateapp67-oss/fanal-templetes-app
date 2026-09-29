import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, Monitor, Smartphone, Wand2 } from 'lucide-react';
import { DynamicTemplateRenderer, type DynamicTemplateConfig, type TemplatePreviewSection } from './DynamicTemplateRenderer';

interface LiveTemplatePreviewProps {
  config: DynamicTemplateConfig;
  activeSection: TemplatePreviewSection;
}

const SECTION_TARGETS: Record<TemplatePreviewSection, string> = {
  hero: '#home-section',
  services: '#services-section',
  gallery: '#gallery-section',
  contact: '#location-section',
  brand: '#home-section',
  seo: '#home-section',
  social: '#gallery-section',
};

export function LiveTemplatePreview({ config, activeSection }: LiveTemplatePreviewProps) {
  const [expanded, setExpanded] = useState(true);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const viewport = viewportRef.current;
    const target = viewport?.querySelector<HTMLElement>(SECTION_TARGETS[activeSection]);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('nx-live-preview-highlight');
    const timer = window.setTimeout(() => target.classList.remove('nx-live-preview-highlight'), 1800);
    return () => window.clearTimeout(timer);
  }, [activeSection, expanded]);

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm" aria-label="Live template preview">
    <style>{`.nx-live-preview-highlight{outline:3px solid #C20E5A!important;outline-offset:-3px;box-shadow:inset 0 0 0 9999px rgba(194,14,90,.08),0 0 0 5px rgba(194,14,90,.14);transition:outline .2s,box-shadow .2s}`}</style>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-4 py-3 text-white">
      <div className="flex min-w-0 items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#C20E5A]/20 text-[#ff8abd]"><Wand2 className="h-4 w-4" /></span><div><p className="text-xs font-black">Live template preview</p><p className="truncate text-[10px] text-slate-400">{config.templateId} · editing {activeSection}</p></div></div>
      <div className="flex items-center gap-1"><button type="button" onClick={() => setDevice('desktop')} className={`rounded-lg p-2 ${device === 'desktop' ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10'}`} aria-label="Desktop preview"><Monitor className="h-4 w-4" /></button><button type="button" onClick={() => setDevice('mobile')} className={`rounded-lg p-2 ${device === 'mobile' ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10'}`} aria-label="Mobile preview"><Smartphone className="h-4 w-4" /></button><button type="button" onClick={() => setExpanded((value) => !value)} className="ml-1 inline-flex items-center gap-1 rounded-lg bg-[#C20E5A] px-3 py-2 text-xs font-black"><Eye className="h-3.5 w-3.5" />{expanded ? 'Hide' : 'Show'}{expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button></div>
    </div>
    {expanded && <div ref={viewportRef} className="h-[560px] w-full max-w-full box-border overflow-y-auto overflow-x-hidden bg-slate-100 p-1.5 sm:p-3"><div className={`mx-auto w-full max-w-full box-border overflow-x-hidden rounded-xl bg-white shadow-xl transition-[width,max-width] duration-300 ${device === 'mobile' ? 'sm:w-[390px] sm:max-w-[390px]' : 'w-full'}`}><DynamicTemplateRenderer config={config} activeSection={activeSection} deviceMode={device} /></div></div>}
  </section>;
}
