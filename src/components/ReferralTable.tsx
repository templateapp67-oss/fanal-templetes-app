import React from 'react';
import type { PartnerReferralEntry } from '../lib/growthPartner';
import { formatPartnerDate, referralTitle } from '../lib/partnerPresentation';
import { ReferralStatusPill } from './ReferralStatusPill';

function safeReferralRows(rows: PartnerReferralEntry[] | null | undefined): PartnerReferralEntry[] {
  return Array.isArray(rows) ? rows.filter((row): row is PartnerReferralEntry => !!row && typeof row === 'object') : [];
}

function CustomerReferralTable({ rows = [], showStarted }: { rows?: PartnerReferralEntry[] | null; showStarted: boolean }) {
  const safeRows = safeReferralRows(rows);
  return (
    <div className="max-w-full overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
            <th scope="col" className="py-2 pr-4 font-bold">
              {showStarted ? 'Referral' : 'Customer'}
            </th>
            <th scope="col" className="py-2 pr-4 font-bold">
              Status
            </th>
            <th scope="col" className="py-2 pr-4 font-bold">
              {showStarted ? 'Linked' : 'Joined'}
            </th>
            {showStarted && (
              <th scope="col" className="py-2 pr-4 font-bold">
                Website started
              </th>
            )}
            <th scope="col" className="py-2 font-bold">
              Completed
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {safeRows.map((row) => (
            <tr key={`${row.ref}-${row.linked_at ?? 'na'}`}>
              <td className="py-3 pr-4">
                <p className="font-bold text-slate-900">{referralTitle(row)}</p>
                {row.display_name?.trim() && <p className="font-mono text-xs text-slate-500">{row.ref}</p>}
              </td>
              <td className="py-3 pr-4">
                <ReferralStatusPill status={row.referral_status ?? row.status} />
              </td>
              <td className="py-3 pr-4 text-slate-600">{formatPartnerDate(row.linked_at)}</td>
              {showStarted && <td className="py-3 pr-4 text-slate-600">{formatPartnerDate(row.template_started_at)}</td>}
              <td className="py-3 text-slate-600">{formatPartnerDate(row.template_completed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Presentational table: only the server-provided page, never a full-catalog fetch. */
export function ReferralTable({ rows, showStarted, onOpenDetails }: {
  rows?: PartnerReferralEntry[] | null;
  showStarted?: boolean;
  onOpenDetails?: (id: string) => void;
}) {
  const safeRows = safeReferralRows(rows);
  if (showStarted !== undefined) return <CustomerReferralTable rows={safeRows} showStarted={showStarted} />;
  return (
<div className="max-w-full overflow-x-auto rounded-2xl border border-slate-100 focus-visible:outline-2 focus-visible:outline-slate-500" role="region" aria-label="Referred users table — scroll horizontally on small screens" tabIndex={0}>
            <table className="w-full min-w-[960px] text-left text-sm">
              <caption className="sr-only">Users referred by your partner account</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>{['User', 'Email / masked contact', 'Joined Date', 'Referral Code', 'Status', 'Conversion Status', 'Last Activity'].map(label => <th key={label} scope="col" className="px-4 py-3 font-bold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {safeRows.map(row => (
                  <tr key={row.ref + '-' + row.linked_at} className="align-top hover:bg-slate-50/60">
                    <th scope="row" className="max-w-56 break-words px-4 py-4 font-bold text-slate-900">{row.referral_id ? <button type="button" onClick={() => onOpenDetails?.(row.referral_id!)} className="text-left underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900 focus:outline-2 focus:outline-slate-900" aria-label={`View referral details for ${row.display_name?.trim() || 'referred user'}`}>{row.display_name?.trim() || 'Referred user'}</button> : row.display_name?.trim() || 'Referred user'}</th>
                    <td className="max-w-56 break-words px-4 py-4 text-slate-600">{row.masked_contact || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatPartnerDate(row.joined_at ?? null)}</td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">{row.referral_code || '—'}</td>
                    <td className="px-4 py-4"><ReferralStatusPill status={row.referral_status ?? row.status} /></td>
                    <td className="px-4 py-4 text-slate-600">{row.conversion_status === 'converted' ? 'Converted' : row.conversion_status === 'not_converted' ? 'Not converted' : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatPartnerDate(row.last_activity_at ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
  );
}
