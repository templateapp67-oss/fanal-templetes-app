import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Copy, Check, Download, Share2, Sparkles, Smartphone } from 'lucide-react';

export interface ShareReferralQRProps {
  referralCode?: string | null;
  partnerName?: string | null;
}

export const ShareReferralQR: React.FC<ShareReferralQRProps> = ({
  referralCode = 'NEXORA-ALPHA01',
  partnerName = 'Growth Partner',
}) => {
  const code = referralCode || 'NEXORA-ALPHA01';
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/signup?ref=${encodeURIComponent(code)}`
      : `https://nexora.app/signup?ref=${encodeURIComponent(code)}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(shareUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H',
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch((err) => {
        console.warn('Failed to generate QR code:', err);
      });

    return () => {
      active = false;
    };
  }, [shareUrl]);

  const handleCopyLink = () => {
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQR = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `referral-qr-${code.toLowerCase()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      setSharing(true);
      try {
        await navigator.share({
          title: 'Join Nexora with my referral link',
          text: `Use my referral code ${code} to sign up for Nexora!`,
          url: shareUrl,
        });
      } catch {
        // User cancelled or share failed
      } finally {
        setSharing(false);
      }
    } else {
      handleCopyLink();
    }
  };

  const canNativeShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  return (
    <div className="w-full bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <QrCode className="w-5 h-5 text-[#C20E5A]" />
            Share Referral QR Code
          </h3>
          <p className="text-xs text-slate-500">
            Scan with any smartphone camera to automatically apply your referral code during sign-up
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold rounded-full">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            Instant Attribution
          </span>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* QR Code Graphic Container */}
        <div className="md:col-span-5 flex flex-col items-center justify-center p-5 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="relative p-3 bg-white rounded-xl shadow-sm border border-slate-200 group">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code for referral ${code}`}
                className="w-48 h-48 object-contain rounded-lg transition-transform group-hover:scale-102"
              />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center text-slate-400 text-xs font-semibold">
                Generating QR code…
              </div>
            )}
          </div>
          <p className="text-[11px] font-semibold text-slate-500 mt-3 flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-slate-400" />
            Scan using any mobile device
          </p>
        </div>

        {/* Sharing Details & Action Buttons */}
        <div className="md:col-span-7 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Your Personal Share Link
            </label>
            <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="w-full bg-transparent text-xs sm:text-sm font-mono text-slate-800 font-semibold focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-700">Referral Code: <span className="font-mono text-slate-900">{code}</span></div>
            <div className="text-xs text-slate-500">
              New users opening this link or scanning the QR code will have your referral code pre-filled automatically.
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownloadQR}
              disabled={!qrDataUrl}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 rounded-xl font-bold text-xs transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-slate-600" />
              Download QR Image
            </button>

            {canNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                disabled={sharing}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#C20E5A] text-white hover:opacity-90 rounded-xl font-bold text-xs transition-opacity cursor-pointer shadow-2xs disabled:opacity-50"
              >
                <Share2 className="w-4 h-4" />
                Share Link
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
