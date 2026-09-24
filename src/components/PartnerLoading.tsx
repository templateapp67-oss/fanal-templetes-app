import React from 'react';
import { Loader2 } from 'lucide-react';

/** Decorative placeholders never contain synthetic metric values. */
export function PartnerLoading({ label, kind = 'table' }: {
  label: string;
  kind?: 'dashboard' | 'table' | 'profile' | 'details' | 'link';
}) {
  if (kind === 'dashboard') {
    return (
      <div role="status" aria-busy="true" aria-label={label} className="min-w-0 space-y-5" data-partner-skeleton="dashboard">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" />
            <p className="text-sm font-semibold text-slate-700">{label}</p>
          </div>
          <div className="h-8 w-20 rounded-xl bg-slate-100 motion-safe:animate-pulse" />
        </div>

        {/* Top Profile & Referral Code Cards */}
        <div aria-hidden="true" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-pulse space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-slate-200 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-1/2 rounded bg-slate-200" />
                <div className="h-3 w-3/4 rounded bg-slate-100" />
                <div className="h-3 w-1/3 rounded-full bg-slate-100" />
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-pulse space-y-4">
            <div className="h-3 w-1/3 rounded bg-slate-200" />
            <div className="flex items-center gap-3 mt-3">
              <div className="h-8 w-1/2 rounded-lg bg-slate-200" />
              <div className="h-8 w-24 rounded-xl bg-slate-100" />
            </div>
            <div className="h-2.5 w-4/5 rounded bg-slate-100 mt-2" />
          </div>
        </div>

        {/* 4 KPI Summary Cards */}
        <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-pulse">
              <div className="h-3 w-2/5 rounded bg-slate-200" />
              <div className="mt-4 h-8 w-1/3 rounded-lg bg-slate-100" />
            </div>
          ))}
        </div>

        {/* Activity Feed Skeleton */}
        <div aria-hidden="true" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-pulse space-y-4">
          <div className="h-4 w-1/4 rounded bg-slate-200 mb-4" />
          <div className="space-y-3 divide-y divide-slate-100">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="pt-3 first:pt-0 flex items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-1/3 rounded bg-slate-200" />
                  <div className="h-2.5 w-1/2 rounded bg-slate-100" />
                </div>
                <div className="h-3 w-16 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-busy="true" aria-label={label} className="min-w-0 space-y-4" data-partner-skeleton={kind}>
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" />
        <p className="text-sm font-medium text-slate-600">{label}</p>
      </div>
      <div aria-hidden="true" className="space-y-4">
        {Array.from({ length: kind === 'table' ? 5 : 2 }, (_, i) => (
          <div key={i} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm motion-safe:animate-pulse">
            <div className="h-3 w-2/5 rounded bg-slate-200" />
            <div className="mt-4 h-7 w-3/5 rounded-lg bg-slate-100" />
            <div className="mt-3 h-3 w-4/5 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
