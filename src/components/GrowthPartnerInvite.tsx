import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildInviteUrl } from '../onboarding/lib/invite';

export function GrowthPartnerInvite({ code }: { code: string | null | undefined }) {
  const [qr, setQr] = useState('');
  const [feedback, setFeedback] = useState('');
  const link = code && typeof window !== 'undefined' ? buildInviteUrl(window.location.origin, code) : '';
  useEffect(() => {
    let cancelled = false;
    setQr('');
    if (link) void QRCode.toDataURL(link, { width: 240, margin: 2 }).then(
      value => { if (!cancelled) setQr(value); },
      () => { if (!cancelled) setFeedback('QR unavailable. You can still copy the invite link.'); },
    );
    return () => { cancelled = true; };
  }, [link]);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback('Invite link copied.');
    } catch { setFeedback('Copy unavailable. Select and copy the link below.'); }
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
    <h2 className="text-xl font-bold">Onboard a business</h2>
    <p className="mt-2 text-sm text-slate-600">Share your invite with the business owner. They create their own account, confirm your referral code, and continue to build their website.</p>
    {!link ? <p className="mt-5">Your referral code is unavailable. Refresh your dashboard to try again.</p> : <>
      <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_200px]">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Your business signup link</p>
          <input aria-label="Business signup invite link" readOnly value={link} onFocus={event => event.target.select()} className="mt-2 w-full rounded-xl border p-3 text-sm" />
          <button onClick={() => void copyLink()} className="mt-3 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">Copy invite link</button>
          <p className="mt-3 text-sm">Referral code: <strong>{code}</strong></p>
          <p role="status" className="mt-2 text-sm text-slate-600">{feedback}</p>
        </div>
        {qr && <div><img src={qr} alt="Scan to start business onboarding with your referral code" width={200} height={200} /><a href={qr} download="business-onboarding-qr.png" className="block text-center text-sm font-bold underline">Download QR</a></div>}
      </div>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        <li>Owner opens your link or scans the QR on their phone.</li>
        <li>Owner signs up or signs in and confirms the prefilled code.</li>
        <li>The backend links the referral, then the owner continues to the Template App.</li>
      </ol>
      <p className="mt-4 text-sm text-slate-500">Use the owner’s device for signup so your partner session stays signed in.</p>
      <a href="/growth-partner/referrals" className="mt-5 inline-block font-semibold underline">View referred users</a>
    </>}
  </section>;
}
