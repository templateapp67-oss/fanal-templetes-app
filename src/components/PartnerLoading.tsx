import React from 'react';

/** Decorative placeholders never contain synthetic metric values. */
export function PartnerLoading({ label, kind = 'table' }: {
  label: string;
  kind?: 'dashboard' | 'table' | 'profile' | 'details' | 'link';
}) {
  return <div role="status" aria-busy="true" aria-label={label} className="min-w-0 space-y-4" data-partner-skeleton={kind}>
    <p className="text-sm font-medium text-slate-600">{label}</p>
    <div aria-hidden="true" className={kind === 'dashboard' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'space-y-4'}>
      {Array.from({ length: kind === 'dashboard' ? 4 : kind === 'table' ? 5 : 2 }, (_, i) =>
        <div key={i} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-pulse">
          <div className="h-3 w-2/5 rounded bg-slate-200" />
          <div className="mt-4 h-7 w-3/5 rounded-lg bg-slate-100" />
          {kind !== 'dashboard' && <div className="mt-3 h-3 w-4/5 rounded bg-slate-100" />}
        </div>)}
    </div>
  </div>;
}
