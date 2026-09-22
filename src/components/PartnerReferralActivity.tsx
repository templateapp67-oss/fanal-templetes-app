import React from 'react';
import { normalizePartnerReferralActivity, type PartnerReferralActivity as Activity } from '../lib/growthPartner';
import type { ReferralStatus } from '../lib/referralStatus';
import { ReferralStatusPill } from './ReferralStatusPill';

// ============================================================================
// Referral activity card.
//
// `activity` is backend analytics: it can be absent (rolling schema upgrade),
// empty, or partially populated. It is normalized before use so a missing
// `recentReferrals`/`last7DaysReferrals` renders as '—' / "not available yet"
// instead of throwing while React renders — a thrown render would blank the
// whole route through the root ErrorBoundary.
//
// The dashboard MAY also pass its `recent_activity` event list (an array) when
// the analytics window is absent, so both shapes are accepted. Event rows are
// mapped from their own fields (`display_name`/`at`/`type`) — never from a
// fabricated name or "now" timestamp.
//
// Dates are rendered through a UTC-safe formatter that says '—' for a missing
// or malformed timestamp rather than "Invalid Date".
// ============================================================================

/** UTC calendar date (the card's stated window) — '—' for a malformed value. */
function activityDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString(undefined, { timeZone: 'UTC' });
}

/** A recent-activity event row, as the dashboard's `recent_activity` sends it. */
type ActivityEventRow = { type?: unknown; display_name?: unknown; at?: unknown };

/** The referral stage an activity event represents (never a fabricated one). */
const EVENT_STATUS: Record<string, ReferralStatus> = {
  referral_added: 'pending',
  website_started: 'active',
  website_completed: 'converted',
};

function rowsFromEvents(events: ActivityEventRow[]) {
  return events.map((event, index) => ({
    referralId: `event-${index}`,
    name: typeof event.display_name === 'string' && event.display_name.trim() ? event.display_name : '',
    date: typeof event.at === 'string' ? event.at : '',
    status: EVENT_STATUS[String(event.type)] ?? null,
  }));
}

export function PartnerReferralActivity({ activity }: { activity?: Activity | ActivityEventRow[] | null }) {
  // An array is the dashboard's raw event list, not the analytics window.
  const events = Array.isArray(activity) ? activity.filter((row): row is ActivityEventRow => !!row && typeof row === 'object') : null;
  const normalized = events ? null : activity ? normalizePartnerReferralActivity(activity) : undefined;
  const recent = events ? rowsFromEvents(events) : normalized?.recentReferrals ?? [];
  const last7Days = events ? null : normalized?.last7DaysReferrals;
  // "Not available" means the payload carried no activity at all: a card that
  // is genuinely empty (a real 0 / an empty list) says exactly that instead.
  const available = !!activity;

  return <section aria-label="Referral activity" className="min-w-0 space-y-4">
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-bold text-slate-600" title="Referrals credited today and in the previous six UTC calendar days. Today is counted so far.">Last 7 Days Referrals</h2>
      <p className="mt-2 text-3xl font-black text-slate-900">{last7Days ?? '—'}</p>
      <p className="mt-2 text-xs text-slate-500">Today and the previous six days · UTC · Today so far</p>
    </div>
    <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">Recent Referrals</h2>
      <p className="mt-1 text-xs text-slate-500">Your latest 10 referred accounts, newest first. Date is when the referral was credited.</p>
      {!available ? <p role="status" className="mt-5 text-sm text-slate-500">Referral activity is not available yet. Refresh to try again.</p>
        : recent.length === 0 ? <p className="mt-5 text-sm text-slate-500">No referrals yet.</p>
        : <div role="region" aria-label="Recent referrals — scroll horizontally on small screens" tabIndex={0} className="mt-4 max-w-full overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-slate-500">
          <table className="w-full min-w-[400px] text-left text-sm">
            <thead><tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              {['Name','Date','Status'].map(label => <th key={label} scope="col" className="py-3 pr-4 font-bold">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{recent.map((row, index) => <tr key={row.referralId || `referral-${index}`}>
              <td className="max-w-48 py-3 pr-4"><span className="block truncate font-semibold text-slate-800" title={row.name}>{row.name || 'Referred user'}</span></td>
              <td className="whitespace-nowrap py-3 pr-4 text-slate-500">{row.date ? <time dateTime={row.date} title={row.date}>{activityDate(row.date)}</time> : '—'}</td>
              <td className="py-3 pr-2"><ReferralStatusPill status={row.status} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
  </section>;
}
