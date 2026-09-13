import React from 'react';
import { usePartnerClipboard } from '../lib/usePartnerClipboard';
import { PartnerToast } from './PartnerToast';
import { Copy, Inbox } from 'lucide-react';
import { partnerReferralShareLink } from '../lib/partnerReferralLink';

export function ReferralEmptyState({ filtered, referralCode, onClear }: {
  filtered: boolean;
  referralCode?: string | null;
  onClear?: () => void;
}) {
  const {copy,error,notice} = usePartnerClipboard();
  const message = error || notice.message;
  const link = referralCode ? partnerReferralShareLink(referralCode) : '';
  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <Inbox aria-hidden="true" className="mx-auto mb-4 h-9 w-9 text-slate-400" />
      <h2 className="text-lg font-bold text-slate-900">{filtered ? 'No matching referrals found.' : 'No referrals yet.'}</h2>
      {!filtered && <p className="mt-2 text-sm text-slate-600">Start sharing your referral link to grow your network.</p>}
      {filtered ? <button type="button" onClick={onClear} disabled={!onClear} className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">Clear Filters</button> : <>
        <button type="button" disabled={!link} onClick={() => void copy(link, 'link')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Copy className="h-4 w-4" aria-hidden="true" />Copy Referral Link</button>
        {!link && <p className="mt-3 text-xs text-slate-500">Your referral link is not available yet.</p>}
        <PartnerToast noticeId={notice.id} message={notice.message} />
        <p role={error ? "alert" : undefined} className="mt-3 text-sm text-slate-600">{message}</p>
        {message.startsWith('Could not') && <input readOnly aria-label="Referral link to copy manually" value={link} onFocus={event => event.currentTarget.select()} className="mt-2 w-full max-w-lg rounded-xl border border-slate-200 px-3 py-2 text-xs" />}
      </>}
    </div>
  );
}
