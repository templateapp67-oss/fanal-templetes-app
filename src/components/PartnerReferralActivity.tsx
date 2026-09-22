import React from 'react';
import type { PartnerReferralActivity as Activity } from '../lib/growthPartner';
import { ReferralStatusPill } from './ReferralStatusPill';

export function PartnerReferralActivity({ activity }: { activity?: Activity | any }) {
  const isArray = Array.isArray(activity);
  const recentReferrals: Array<any> = isArray
    ? activity
    : (activity && Array.isArray(activity.recentReferrals) ? activity.recentReferrals : []);
  const last7DaysCount = isArray
    ? activity.length
    : (activity?.last7DaysReferrals ?? recentReferrals.length);

  return (
    <section aria-label="Referral activity" className="min-w-0 space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-600" title="Referrals credited today and in the previous six UTC calendar days. Today is counted so far.">Last 7 Days Referrals</h2>
        <p className="mt-2 text-3xl font-black text-slate-900">{last7DaysCount}</p>
        <p className="mt-2 text-xs text-slate-500">Today and the previous six days · UTC · Today so far</p>
      </div>
      <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Recent Referrals</h2>
        <p className="mt-1 text-xs text-slate-500">Your latest 10 referred accounts, newest first. Date is when the referral was credited.</p>
        {recentReferrals.length === 0 ? (
          <p className="mt-5 text-sm text-slate-500">No referrals yet.</p>
        ) : (
          <div role="region" aria-label="Recent referrals — scroll horizontally on small screens" tabIndex={0} className="mt-4 max-w-full overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-slate-500">
            <table className="w-full min-w-[400px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  {['Name','Date','Status'].map(label => <th key={label} scope="col" className="py-3 pr-4 font-bold">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentReferrals.map((row: any, idx: number) => {
                  const name = row.name ?? row.customer_name ?? 'Referred User';
                  const dateStr = row.date ?? row.created_at ?? new Date().toISOString();
                  const status = row.status ?? 'pending';
                  const key = row.referralId ?? row.id ?? `ref-${idx}`;
                  return (
                    <tr key={key}>
                      <td className="max-w-48 py-3 pr-4">
                        <span className="block truncate font-semibold text-slate-800" title={name}>{name}</span>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-slate-500">
                        <time dateTime={dateStr} title={dateStr}>
                          {new Date(dateStr).toLocaleDateString(undefined, { timeZone: 'UTC' })}
                        </time>
                      </td>
                      <td className="py-3 pr-2">
                        <ReferralStatusPill status={status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
