import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Download, Copy, Check, Smartphone, Sparkles } from 'lucide-react';
import { partnerReferralShareLink } from '../../lib/partnerReferralLink';

export interface PartnerReferralQRCodeProps {
  referralCode: string | null;
  loading: boolean;
}

export const PartnerReferralQRCode: React.FC<PartnerReferralQRCodeProps> = ({
  referralCode,
  loading,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const code = (referralCode || '').trim();
  const shareUrl = code ? partnerReferralShareLink(code) : '';

  const handleCopy = () => {
    if (!shareUrl) return;
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!shareUrl || !code) return;
    const svg = document.getElementById('referral-qrcode-svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const downloadLink = document.createElement('a');
    downloadLink.href = svgUrl;
    downloadLink.download = `nexora-referral-qr-${code.toLowerCase()}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(svgUrl);
  };

  // 1. Loading Skeleton State
  if (loading) {
    return (
      <section
        aria-label="Loading QR code"
        className="w-full bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xs animate-pulse space-y-6"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="space-y-2">
            <div className="h-5 w-44 bg-slate-200 rounded-md" />
            <div className="h-3.5 w-64 bg-slate-100 rounded-md" />
          </div>
          <div className="h-6 w-24 bg-slate-100 rounded-full" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="w-48 h-48 bg-slate-200 rounded-xl" />
            <div className="h-3 w-32 bg-slate-200 rounded-md mt-4" />
          </div>
          <div className="md:col-span-7 space-y-4">
            <div className="h-4 w-36 bg-slate-200 rounded-md" />
            <div className="h-10 w-full bg-slate-100 rounded-xl" />
            <div className="h-14 w-full bg-slate-100 rounded-xl" />
            <div className="h-10 w-40 bg-slate-200 rounded-xl" />
          </div>
        </div>
      </section>
    );
  }

  // 2. Unavailable State (Loading finished, but no referralCode)
  if (!code) {
    return (
      <section
        aria-label="Referral QR Code unavailable"
        className="w-full bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xs"
      >
        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
          <QrCode className="w-4 h-4 text-slate-400" />
          Referral QR Code
        </h3>
        <p className="mt-3 text-sm font-bold text-slate-700">
          Referral code unavailable
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Your QR code will automatically appear here once your Growth Partner referral code is issued.
        </p>
      </section>
    );
  }

  // 3. Active QR Code State
  return (
    <section
      aria-label="Your Referral QR Code"
      className="w-full bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xs space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <QrCode className="w-5 h-5 text-[#C20E5A]" />
            Referral QR Code
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
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

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* QR Code Container using qrcode.react QRCodeSVG */}
        <div className="md:col-span-5 flex flex-col items-center justify-center p-5 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="p-3 bg-white rounded-xl shadow-xs border border-slate-200 group">
            <QRCodeSVG
              id="referral-qrcode-svg"
              value={shareUrl}
              size={192}
              level="H"
              marginSize={2}
              fgColor="#0F172A"
              bgColor="#FFFFFF"
              className="rounded-lg transition-transform group-hover:scale-102"
            />
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
              Personal Referral Link
            </label>
            <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <input
                type="text"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-transparent text-xs sm:text-sm font-mono text-slate-800 font-semibold focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                disabled={!shareUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-700">
              Active Referral Code: <span className="font-mono text-[#C20E5A] font-black">{code}</span>
            </div>
            <div className="text-xs text-slate-500">
              Users who scan this QR code are linked to your partner account with lifetime revenue sharing.
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold text-xs transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Download QR Code (SVG)
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
