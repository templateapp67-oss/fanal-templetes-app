import React from 'react';
import type { SalonProfile } from '../types';
import { socialMetadata } from '../lib/socialMetadata';

/** Approximation only; each messaging app chooses its own final layout/cache. */
export function SocialSharePreview({ profile, pageUrl }: { profile: SalonProfile; pageUrl?: string }) {
  const origin = typeof window === 'undefined' ? 'https://example.com' : window.location.origin;
  const metadata = socialMetadata(profile, new URL(pageUrl || '/', origin).href);
  return <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 sm:p-5">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Facebook / WhatsApp / iMessage preview</p>
    <article className="mx-auto max-w-[480px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="aspect-[1200/630] bg-slate-100">
        {metadata.image ? <img src={metadata.image} alt="Social share preview" className="h-full w-full object-cover" /> :
          <div className="flex h-full items-center justify-center p-5 text-center text-sm text-slate-500">Upload an image or generate a branded card.</div>}
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-[10px] uppercase text-gray-400">{new URL(metadata.url).host}</p>
        <h4 className="line-clamp-2 text-sm font-bold text-gray-800">{metadata.title}</h4>
        <p className="line-clamp-2 text-xs text-gray-500">{metadata.description}</p>
      </div>
    </article>
    <p className="mt-3 text-[11px] text-slate-500">Preview only. Save your website to publish changes. Sharing apps may cache an older preview.</p>
  </div>;
}
