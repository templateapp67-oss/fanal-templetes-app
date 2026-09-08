// ============================================================================
// Salon pass — the check-in code (and its QR image) a customer shows at the
// salon counter.
//
//   • The code is derived from the verified auth id by the API
//     (`GET /api/customer/me/pass`) — nothing is stored, so there is no
//     `user_qr_codes` row to go stale or to leak.
//   • The QR image is rendered on the device from that code (the `qrcode`
//     encoder runs client-side), so the pass works offline and in mock mode.
//   • The salon types the code into its dashboard (or scans the QR later) to
//     find today's visit and check the customer in.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { toDataURL } from 'qrcode';
import { getMyPass, getMyProfile } from '../../lib/customer/api';
import { Button, CARD_CLASS, ErrorState, LoadingRows, MUTED_CLASS, SectionTitle } from '../ui';

interface PassScreenProps {
  userId?: string;
  email?: string;
  accentHex?: string;
  refreshToken?: number;
  onRequireAuth?: () => void;
}

export const PassScreen: React.FC<PassScreenProps> = ({
  userId,
  email,
  accentHex = '#0f172a',
  refreshToken = 0,
  onRequireAuth,
}) => {
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'live' | 'mock'>('live');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      const [passResult, profileResult] = await Promise.all([getMyPass(), getMyProfile()]);
      if (cancelled) return;
      if (!passResult.ok) {
        setFailed(true);
        setError(passResult.error || 'Your salon pass could not be loaded.');
        setLoading(false);
        return;
      }
      setCode(passResult.data?.code || '');
      setMode(passResult.mode || 'live');
      if (profileResult.ok && profileResult.data) {
        setFullName(profileResult.data.fullName);
        setPhone(profileResult.data.phone);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshToken, reloadKey]);

  // The QR is drawn on the device from the code. onRequireAuth stays unused on
  // purpose — private sections are gated by the shell before this renders.
  void onRequireAuth;

  const [qrDataUrl, setQrDataUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    setQrDataUrl('');
    setQrFailed(false);
    if (!code) return;
    toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const displayName = useMemo(() => fullName.trim() || email?.trim() || 'Member', [fullName, email]);

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (loading) return <LoadingRows rows={2} label="Building your salon pass…" />;
  if (failed) return <ErrorState title="Could not load your pass" body={error} onRetry={() => setLoading(true)} />;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Salon pass"
        subtitle="Your check-in code — show it at the salon counter and they can find today's visit, check you in and activate visit bonuses."
        action={
          mode === 'mock' ? (
            <span className={`text-[11px] font-bold ${MUTED_CLASS}`}>demo identity · code derived from it</span>
          ) : undefined
        }
      />

      <div className={`${CARD_CLASS} overflow-hidden`}>
        <div className="p-5 text-white" style={{ background: accentHex }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">Salon pass</p>
              <p className="text-lg font-display font-bold mt-0.5">{displayName}</p>
              {phone ? <p className="text-xs opacity-80 mt-0.5">{phone}</p> : null}
            </div>
            <span className="text-[10px] font-mono font-bold bg-white/15 px-2.5 py-1.5 rounded-lg tracking-wider">
              MEMBER
            </span>
          </div>
        </div>

        <div className="p-6 flex flex-col items-center gap-4">
          {qrDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img
              src={qrDataUrl}
              alt="QR code for the salon pass"
              width={196}
              height={196}
              className="rounded-2xl border border-slate-200 bg-white p-2"
            />
          ) : qrFailed ? (
            <div className="w-44 h-44 rounded-2xl border border-dashed border-slate-300 flex items-center justify-center text-center p-4">
              <p className="text-xs text-slate-500">QR could not be drawn — use the code below instead.</p>
            </div>
          ) : (
            <div className="w-44 h-44 rounded-2xl bg-slate-100 animate-pulse" />
          )}

          <button
            type="button"
            onClick={copyCode}
            className={`font-mono text-sm font-bold tracking-wider px-4 py-2 rounded-xl border transition ${
              copied ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-900'
            }`}
            title="Copy check-in code"
          >
            {code || '—'}
          </button>
          <p className={`text-xs -mt-2 ${MUTED_CLASS}`}>{copied ? 'Copied — hand it to the receptionist.' : 'Tap to copy'}</p>

          <div className="w-full border-t border-slate-100 pt-4 space-y-2 text-xs text-slate-600">
            <p>
              <span className="font-bold text-slate-900">What happens at the salon:</span> the receptionist enters this
              code (or scans the QR) to find today&apos;s booking, marks you checked in, and the visit bonuses you are
              due — birthday, referral — are credited to your rewards wallet automatically.
            </p>
            <p className={MUTED_CLASS}>The code is stable for your account. No data leaves your device except the code itself.</p>
          </div>

          <Button variant="ghost" onClick={() => setReloadKey((key) => key + 1)} className="self-end">
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
};
