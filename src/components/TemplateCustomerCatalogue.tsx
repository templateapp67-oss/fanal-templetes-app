import React from 'react';
import type { SalonProfile, SalonService } from '../types';
import { TemplatePackages } from './TemplatePackages';
import { PublishedSectionEmpty } from './PublishedSectionEmpty';

/** Reuse the site's already-published catalogue so customer navigation cannot
 * lose services by loading an unrelated or incomplete salon response. */
export function TemplateCustomerCatalogue({ section, profile, services, onBook, onServices }: { section: 'services' | 'packages'; profile: SalonProfile; services: SalonService[]; onBook: (ids: string[]) => void; onServices: () => void }) {
  return <div className="@container/customer-catalog p-6" data-live-customer-catalogue>
    <p className="text-xs uppercase tracking-widest opacity-60 mb-2">{profile.businessName}</p>
    {section === 'packages' ? <TemplatePackages packages={profile.packages} services={services} onBook={onBook} onViewServices={onServices} /> : <>
      <h2 className="text-2xl font-bold mb-6">Services &amp; treatments</h2>
      {!services.length && <PublishedSectionEmpty title="Service menu coming soon" detail="The studio has not published services yet. Please return later to browse its treatments." />}
      <div className="grid grid-cols-1 @min-[600px]/customer-catalog:grid-cols-2 @min-[960px]/customer-catalog:grid-cols-3 gap-5">{services.map(service => <article key={service.id} className="rounded-2xl border border-current/15 p-5 flex flex-col gap-3">
        <p className="text-xs opacity-60">{service.category}{service.gender ? ` · ${service.gender}` : ''}</p><h3 className="text-lg font-semibold">{service.name}</h3>{service.description && <p className="text-sm opacity-70 leading-relaxed">{service.description}</p>}
        <div className="mt-auto flex justify-between text-sm"><strong>₹{service.price.toLocaleString('en-IN')}</strong><span>{service.durationMinutes} min</span></div>
        <button type="button" onClick={() => onBook([service.id])} className="min-h-11 rounded-xl bg-slate-900 text-white px-4 font-semibold text-sm">Book service</button>
      </article>)}</div>
    </>}
  </div>;
}
