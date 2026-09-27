import React from 'react';
import { AlertCircle, CheckCircle2, ArrowRight, X, Sparkles, Building2 } from 'lucide-react';
import { getSalonProfileCompletion, type SalonProfileCompletionInfo } from '../lib/profileCompletion';
import type { SalonProfile } from '../types';

interface ProfileCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Partial<SalonProfile> | null | undefined;
  onGoToProfileSetup: () => void;
  customMessage?: string;
}

export const ProfileCompletionModal: React.FC<ProfileCompletionModalProps> = ({
  isOpen,
  onClose,
  profile,
  onGoToProfileSetup,
  customMessage,
}) => {
  if (!isOpen) return null;

  const info: SalonProfileCompletionInfo = getSalonProfileCompletion(profile);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-completion-title"
      >
        {/* Top decorative gradient */}
        <div className="h-3 bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500" />

        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8 space-y-5">
          {/* Icon Badge */}
          <div className="w-14 h-14 rounded-2xl bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600 shadow-xs">
            <Building2 className="w-7 h-7 text-[#C20E5A]" />
          </div>

          <div className="space-y-2">
            <h2 id="profile-completion-title" className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
              Complete Your Profile First
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {customMessage ||
                'Please complete your salon profile details before customizing your website. Your profile details will automatically sync with your website!'}
            </p>
          </div>

          {/* Progress Bar & Missing Fields */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-600">Profile Completion</span>
              <span className="font-mono text-pink-700">{info.percentage}%</span>
            </div>

            <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-600 to-rose-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(5, info.percentage)}%` }}
              />
            </div>

            {info.mandatoryMissing.length > 0 && (
              <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
                  Mandatory Fields Missing:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {info.mandatoryMissing.map((field) => (
                    <span
                      key={field}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[11px] font-semibold"
                    >
                      <AlertCircle className="w-3 h-3 text-rose-600" />
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onGoToProfileSetup();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-2xl bg-[#C20E5A] hover:bg-[#A30B4A] text-white font-bold text-sm shadow-md hover:shadow-lg transition-all cursor-pointer"
            >
              <span>Go to Profile Setup</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
            >
              Stay on Page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ProfileCompletionBannerProps {
  profile: Partial<SalonProfile> | null | undefined;
  onGoToProfileSetup: () => void;
  className?: string;
}

export const ProfileCompletionBanner: React.FC<ProfileCompletionBannerProps> = ({
  profile,
  onGoToProfileSetup,
  className = '',
}) => {
  const info = getSalonProfileCompletion(profile);

  if (info.percentage >= 100 && info.isComplete) {
    return null;
  }

  return (
    <div
      className={`rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-rose-50 to-pink-50 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 ${className}`}
    >
      <div className="flex items-start sm:items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-800 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-amber-700" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-slate-900">
              Profile Completion: {info.percentage}%
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-mono text-[10px] font-bold border border-amber-300">
              Setup Incomplete
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Complete setup to unlock full website customization and automated sync.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 self-start md:self-auto">
        <div className="hidden sm:block w-28 h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${Math.max(5, info.percentage)}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onGoToProfileSetup}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
        >
          <span>Complete Profile</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
