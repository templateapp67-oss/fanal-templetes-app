import React, { useState, useEffect } from 'react';
import { DEFAULT_REFERRAL_FILTERS, referralDateBounds, type ReferralFilters } from '../lib/referralFilters';

export function ReferralSearchControls({ onApply, resetKey = 0 }: { resetKey?: number; onApply: (filters: ReferralFilters, clearStatus?: boolean) => void }) {
  const [draft, setDraft] = useState<ReferralFilters>({ ...DEFAULT_REFERRAL_FILTERS });
  const [error, setError] = useState('');
  useEffect(() => { setDraft({ ...DEFAULT_REFERRAL_FILTERS }); setError(''); }, [resetKey]);
  const inputClass = 'min-w-0 max-w-full mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-2 focus:outline-slate-900';
  return (
    <form aria-label="Search and filter referrals" className="rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => {
      event.preventDefault();
      try { referralDateBounds(draft); setError(''); onApply({ ...draft, search: draft.search.trim() }); }
      catch (cause) { setError((cause as Error).message); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold text-slate-600">Search referrals
          <input type="search" maxLength={254} placeholder="Name, email or referral code" value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} className={inputClass} />
        </label>
        <label className="text-xs font-bold text-slate-600">Joined Date
          <select value={draft.datePreset} onChange={e => setDraft({ ...draft, datePreset: e.target.value as ReferralFilters['datePreset'] })} className={inputClass}>
            <option value="all">All dates</option><option value="today">Today</option><option value="last7">Last 7 Days</option><option value="last30">Last 30 Days</option><option value="custom">Custom Range</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Conversion Status
          <select value={draft.conversion} onChange={e => setDraft({ ...draft, conversion: e.target.value as ReferralFilters['conversion'] })} className={inputClass}>
            <option value="all">All conversions</option><option value="converted">Converted</option><option value="not_converted">Not converted</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Sort by
          <select value={draft.sort} onChange={e => setDraft({ ...draft, sort: e.target.value as ReferralFilters['sort'] })} className={inputClass}>
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="recently_active">Recently Active</option>
          </select>
        </label>
        {draft.datePreset === 'custom' && <>
          <label className="text-xs font-bold text-slate-600">Start date<input required type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} className={inputClass} /></label>
          <label className="text-xs font-bold text-slate-600">End date<input required type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} className={inputClass} /></label>
        </>}
      </div>
      <p className="mt-2 text-xs text-slate-500">Dates use your local timezone. Custom ranges include both dates. Use the status tabs below to refine results.</p>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Apply filters</button>
        <button type="button" className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => { setDraft({ ...DEFAULT_REFERRAL_FILTERS }); setError(''); onApply({ ...DEFAULT_REFERRAL_FILTERS }, true); }}>Clear filters</button>
      </div>
    </form>
  );
}
