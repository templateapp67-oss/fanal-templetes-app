import { PartnerLoading } from './PartnerLoading';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fetchMyPartnerReferralDetail, toSafePartnerSectionError, PARTNER_SECTION_ERROR_MESSAGE, type PartnerReferralEntry } from '../lib/growthPartner';
import { referralStatusDescriptor } from '../lib/referralStatus';

const timestamp = (value?: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';

export function ReferralDetailsDrawer({ referralId, onClose }: { referralId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const heading = useId();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ id: string; loading: boolean; data: PartnerReferralEntry | null; error: string }>({ id: referralId, loading: true, data: null, error: '' });
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modal = dialog.current;
    if (modal && !modal.open) {
      if (typeof modal.showModal === 'function') modal.showModal();
      else modal.setAttribute('open', '');
    }
    closeButton.current?.focus();
    return () => {
      if (modal && typeof modal.close === 'function') modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setResult({ id: referralId, loading: true, data: null, error: '' });
    fetchMyPartnerReferralDetail(referralId).then(data => {
      if (!cancelled) setResult({ id: referralId, loading: false, data, error: '' });
    }, error => {
      const safe = toSafePartnerSectionError(error).message;
      if (!cancelled) setResult({ id: referralId, loading: false, data: null, error: safe === PARTNER_SECTION_ERROR_MESSAGE ? 'Could not load referral details. Please retry.' : safe });
    });
    return () => { cancelled = true; };
  }, [referralId, retry]);
  const loading = result.id !== referralId || result.loading;
  const row = result.id === referralId ? result.data : null;
  const status = referralStatusDescriptor(row?.referral_status ?? row?.status);
  return createPortal(
    <dialog ref={dialog} aria-modal="true" aria-labelledby={heading} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-lg overflow-y-auto border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50"
      onCancel={event => { event.preventDefault(); closeRef.current(); }}
      onClick={event => { if (event.target === event.currentTarget) closeRef.current(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
        if (event.key !== 'Tab') return;
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]') ?? [])];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="min-h-full p-6 sm:p-8">
        <header className="flex items-start justify-between gap-4">
          <div><h2 id={heading} className="text-xl font-bold">Referral details</h2><p className="mt-1 text-xs text-slate-500">Read-only · Contact details are masked</p></div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close referral details" className="rounded-xl bg-slate-100 p-2 focus:outline-2 focus:outline-slate-900"><X className="h-5 w-5" /></button>
        </header>
        {loading ? <div className="mt-8"><PartnerLoading label="Loading referral details…" kind="details" /></div> : result.error ? <div role="alert" className="mt-8"><p>{result.error}</p><button className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-white" onClick={() => setRetry(value => value + 1)}>Retry details</button></div> : !row ? <p role="status" className="mt-8">Referral not available.</p> : <>
          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              ['User Name', row.display_name?.trim() || 'Referred user'],
              ['Masked Contact', row.masked_contact || 'Not available'],
              ['Referral Date', timestamp(row.linked_at)],
              ['Signup Date', timestamp(row.joined_at)],
              ['Current Status', <span title={status.description} className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${status.badgeClassName}`}>{status.label}</span>],
              ['Conversion Status', row.conversion_status === 'converted' ? 'Converted' : row.conversion_status === 'not_converted' ? 'Not converted' : 'Not available'],
              ['Last Activity', timestamp(row.last_activity_at)],
              ['Referral Code Used', row.referral_code || 'Not available'],
            ].map(([label, value]) => <div key={String(label)}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-all text-sm">{value}</dd></div>)}
          </dl>
          <h3 className="mt-8 font-bold">Status timeline</h3>
          <p className="mt-2 text-xs text-slate-500">Activation means website onboarding started; conversion means website completion, not a payment. Unrecorded events are not assumed.</p>
          <ol className="mt-5 space-y-5 border-l border-slate-200 pl-5">
            {[
              { label: 'Referral Clicked', at: row.referral_clicked_at, missing: 'Not recorded' },
              { label: 'Account Registered', at: row.joined_at, missing: 'Not recorded' },
              { label: 'Account Activated', at: row.template_started_at, missing: 'Not yet recorded' },
              { label: 'Converted', at: row.template_completed_at, missing: 'Not yet recorded' },
            ].map(event => <li key={event.label} className="relative"><span aria-hidden="true" className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-slate-400" /><p className="text-sm font-bold">{event.label}</p><p className="mt-1 text-xs text-slate-500">{event.at ? timestamp(event.at) : event.missing}</p></li>)}
          </ol>
        </>}
      </div>
    </dialog>, document.body
  );
}
