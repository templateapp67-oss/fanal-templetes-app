import React from 'react';
import { ShieldCheck } from 'lucide-react';

export const ReferralLinkNotice: React.FC<{
  code: string;
  context?: 'signup' | 'login';
}> = ({ code, context = 'signup' }) => {
  if (!code) return null;
  return (
    <div
      role="status"
      data-onboarding-referral-applied
      className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-700">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black text-emerald-950">Growth Partner referral applied</p>
          <p className="mt-1 break-all font-mono text-sm font-bold text-emerald-800">{code}</p>
          <p className="mt-2 text-xs leading-5 text-emerald-900">
            {context === 'signup'
              ? 'Account create होने पर यह verified referral securely link होगा। इसे कोई दूसरा partner overwrite नहीं कर सकता।'
              : 'यह referral नए account के लिए है। Existing account में पहले से locked partner attribution बदला नहीं जाएगा।'}
          </p>
        </div>
      </div>
    </div>
  );
};
