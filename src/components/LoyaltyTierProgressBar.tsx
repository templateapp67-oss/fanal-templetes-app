import React from 'react';
import { LoyaltyTier, LoyaltyConfig } from '../types';
import { calculateTierProgress, TIER_METADATA, DEFAULT_LOYALTY_CONFIG } from '../loyaltyData';

interface LoyaltyTierProgressBarProps {
  lifetimePoints: number;
  currentPoints?: number;
  tierThresholds?: LoyaltyConfig['tierThresholds'];
  tierMultipliers?: LoyaltyConfig['tierMultipliers'];
  variant?: 'compact' | 'standard' | 'roadmap' | 'card';
  clientName?: string;
  showPerks?: boolean;
  className?: string;
  id?: string;
}

export const LoyaltyTierProgressBar: React.FC<LoyaltyTierProgressBarProps> = ({
  lifetimePoints,
  currentPoints,
  tierThresholds = DEFAULT_LOYALTY_CONFIG.tierThresholds,
  tierMultipliers = DEFAULT_LOYALTY_CONFIG.tierMultipliers,
  variant = 'standard',
  clientName,
  showPerks = true,
  className = '',
  id,
}) => {
  const progress = calculateTierProgress(lifetimePoints, tierThresholds);
  const {
    currentTier,
    nextTier,
    currentTierMeta,
    nextTierMeta,
    pointsNeeded,
    progressPercentage,
    isMaxTier,
    allTiers,
  } = progress;

  // COMPACT VARIANT: Perfect for table rows, minimal cards, and popovers
  if (variant === 'compact') {
    return (
      <div id={id} className={`flex flex-col gap-1.5 w-full ${className}`}>
        <div className="flex justify-between items-center text-[11px]">
          <div className="flex items-center gap-1.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono-caps font-bold border ${currentTierMeta.badgeBg} ${currentTierMeta.borderColor}`}
            >
              {currentTierMeta.name.split(' ')[0]}
            </span>
            <span className="text-gray-400 font-mono">→</span>
            {isMaxTier ? (
              <span className="text-purple-700 font-bold font-mono-caps text-[10px]">
                ⭐ Top Tier VIP
              </span>
            ) : (
              <span className="font-bold text-gray-700 text-[10px]">
                {nextTierMeta?.name.split(' ')[0]} ({nextTier ? tierThresholds[nextTier] : 0} pts)
              </span>
            )}
          </div>
          <span className="font-mono font-bold text-gray-700 text-[11px]">
            {isMaxTier ? '100%' : `${progressPercentage}%`}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden relative">
          <div
            className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${currentTierMeta.gradient}`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {!isMaxTier && (
          <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
            <span>{lifetimePoints} lifetime pts</span>
            <span className="text-amber-800 font-semibold">+{pointsNeeded} pts to level up</span>
          </div>
        )}
      </div>
    );
  }

  // ROADMAP VARIANT: Displays the full 4-tier progression milestone path with step dots
  if (variant === 'roadmap') {
    return (
      <div
        id={id}
        className={`p-4 rounded-xl border border-gray-200 bg-white shadow-xs flex flex-col gap-4 ${className}`}
      >
        <div className="flex justify-between items-start">
          <div>
            <div className="text-xs font-mono-caps font-bold text-gray-500">
              {clientName ? `${clientName}'s Loyalty Level` : 'Loyalty Tier Status'}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-mono-caps font-bold border ${currentTierMeta.badgeBg} ${currentTierMeta.borderColor} flex items-center gap-1.5`}
              >
                <span className="material-symbols-outlined text-sm">{currentTierMeta.icon}</span>
                <span>{currentTierMeta.name}</span>
              </span>
              <span className="text-xs text-purple-700 font-bold">
                {tierMultipliers[currentTier]}x Points Rate
              </span>
            </div>
          </div>

          <div className="text-right">
            <div className="font-mono font-bold text-base text-gray-900">
              {lifetimePoints.toLocaleString('en-IN')}{' '}
              <span className="text-xs font-normal text-gray-500">lifetime pts</span>
            </div>
            {currentPoints !== undefined && (
              <div className="text-[11px] text-amber-700 font-mono">
                {currentPoints.toLocaleString('en-IN')} available balance
              </div>
            )}
          </div>
        </div>

        {/* Milestone Steps Bar */}
        <div className="relative pt-2 pb-1">
          {/* Background Line */}
          <div className="absolute top-6 left-6 right-6 h-1.5 bg-gray-200 rounded-full -translate-y-1/2 z-0" />
          
          {/* Active Fill Line */}
          <div
            className="absolute top-6 left-6 h-1.5 bg-gradient-to-r from-amber-500 via-yellow-500 to-purple-600 rounded-full -translate-y-1/2 z-0 transition-all duration-500"
            style={{
              width: isMaxTier
                ? 'calc(100% - 48px)'
                : `calc(${
                    currentTier === 'bronze'
                      ? (progressPercentage / 100) * 33.33
                      : currentTier === 'silver'
                        ? 33.33 + (progressPercentage / 100) * 33.33
                        : 66.66 + (progressPercentage / 100) * 33.33
                  }% - 24px)`,
            }}
          />

          {/* Stepper Dots */}
          <div className="relative z-10 grid grid-cols-4 gap-2">
            {allTiers.map((t) => {
              return (
                <div key={t.tier} className="flex flex-col items-center text-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all border-2 shadow-xs ${
                      t.isAchieved
                        ? `bg-white ${t.meta.borderColor} text-gray-900 ring-2 ring-emerald-400`
                        : t.isNext
                          ? 'bg-amber-50 border-amber-400 text-amber-900 ring-2 ring-amber-300 animate-pulse'
                          : 'bg-gray-100 border-gray-300 text-gray-400'
                    }`}
                  >
                    {t.isAchieved ? (
                      <span className="material-symbols-outlined text-sm text-emerald-600">
                        check
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-sm">{t.meta.icon}</span>
                    )}
                  </div>
                  <span className="text-[11px] font-bold text-gray-800 mt-1">
                    {t.meta.name.split(' ')[0]}
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    {t.threshold} pts
                  </span>
                  <span className="text-[9px] font-bold text-purple-600">
                    {tierMultipliers[t.tier]}x
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Next Tier Milestone Note */}
        <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div>
            {isMaxTier ? (
              <span className="text-purple-800 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-purple-600">diamond</span>
                <span>Maximum Tier Achieved! Enjoy VIP priority concierge and 2.0x points.</span>
              </span>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-amber-600 text-sm">flag</span>
                <span>
                  Next Tier:{' '}
                  <strong className="text-gray-900">{nextTierMeta?.name}</strong> at{' '}
                  <span className="font-mono font-bold text-amber-800">
                    {nextTier ? tierThresholds[nextTier] : 0} lifetime pts
                  </span>
                </span>
              </div>
            )}
          </div>

          {!isMaxTier && (
            <div className="font-mono font-bold text-amber-900 bg-amber-100/80 px-2.5 py-1 rounded-lg border border-amber-300 text-[11px] shrink-0 text-right">
              {pointsNeeded} pts needed ({progressPercentage}% completed)
            </div>
          )}
        </div>
      </div>
    );
  }

  // CARD VARIANT: Ideal for VIP dashboards or spotlight widgets
  if (variant === 'card') {
    return (
      <div
        id={id}
        className={`p-5 rounded-2xl border border-gray-200 bg-white shadow-xs flex flex-col justify-between gap-4 ${className}`}
      >
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-xs bg-gradient-to-br ${currentTierMeta.gradient}`}
            >
              <span className="material-symbols-outlined text-2xl">{currentTierMeta.icon}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-gray-900">
                  {clientName ? clientName : 'Loyalty Tier Status'}
                </h4>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono-caps font-bold border ${currentTierMeta.badgeBg} ${currentTierMeta.borderColor}`}
                >
                  {currentTierMeta.name}
                </span>
              </div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                {lifetimePoints.toLocaleString('en-IN')} lifetime pts accrued • {tierMultipliers[currentTier]}x points rate
              </div>
            </div>
          </div>

          <div className="text-right font-mono">
            <span className="text-xs text-gray-400 block font-mono-caps">Progress</span>
            <span className="font-extrabold text-base text-gray-900">
              {isMaxTier ? '100%' : `${progressPercentage}%`}
            </span>
          </div>
        </div>

        {/* Progress Bar Component */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-gray-50 border border-gray-200">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-gray-700 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-amber-600">trending_up</span>
              <span>
                {isMaxTier ? 'Top Tier Milestone Reached' : `Progress to ${nextTierMeta?.name}`}
              </span>
            </span>
            <span className="font-mono text-[11px] text-gray-600 font-bold">
              {isMaxTier
                ? '⭐ MAX'
                : `${lifetimePoints} / ${nextTier ? tierThresholds[nextTier] : 0} pts`}
            </span>
          </div>

          {/* Visual Track */}
          <div className="w-full bg-gray-200 h-2.5 rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${currentTierMeta.gradient}`}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[10px] text-gray-500">
            <span>
              {isMaxTier ? (
                <span className="text-purple-700 font-bold">
                  All VIP privileges and maximum point accrual unlocked
                </span>
              ) : (
                <span className="text-amber-800 font-semibold">
                  Earn {pointsNeeded} more points to upgrade to {nextTierMeta?.name}
                </span>
              )}
            </span>
            {!isMaxTier && (
              <span className="font-mono text-purple-700 font-bold">
                +{tierMultipliers[nextTier || 'silver']}x Next Multiplier
              </span>
            )}
          </div>
        </div>

        {showPerks && (
          <div className="text-[11px] text-gray-600 bg-gray-50/70 p-2.5 rounded-lg border border-gray-100 flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-500 text-sm shrink-0">
              military_tech
            </span>
            <span>
              <strong className="text-gray-900">Current Perks:</strong> {currentTierMeta.perks}
            </span>
          </div>
        )}
      </div>
    );
  }

  // STANDARD / DEFAULT VARIANT: Balanced for client lists and CRM cards
  return (
    <div
      id={id}
      className={`p-3 bg-gray-50/90 rounded-xl border border-gray-200 flex flex-col gap-2 ${className}`}
    >
      {/* Top Header: Current & Next Tier */}
      <div className="flex justify-between items-center text-xs">
        <div className="flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono-caps font-bold border ${currentTierMeta.badgeBg} ${currentTierMeta.borderColor} flex items-center gap-1`}
          >
            <span className="material-symbols-outlined text-xs">{currentTierMeta.icon}</span>
            <span>{currentTierMeta.name.split(' ')[0]}</span>
          </span>
          {!isMaxTier && (
            <>
              <span className="text-gray-400 font-mono text-[10px]">→</span>
              <span className="font-bold text-gray-800 text-[11px]">
                {nextTierMeta?.name.split(' ')[0]}
              </span>
            </>
          )}
        </div>

        <span className="font-mono font-bold text-[11px] text-gray-700">
          {isMaxTier ? (
            <span className="text-purple-700 font-bold">⭐ MAX TIER</span>
          ) : (
            `${progressPercentage}%`
          )}
        </span>
      </div>

      {/* Progress Track */}
      <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${currentTierMeta.gradient}`}
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Bottom Subtitle */}
      <div className="flex justify-between items-center text-[10px] text-gray-500">
        <span>
          {isMaxTier ? (
            <span className="text-purple-800 font-bold">VIP Platinum Sanctuary Active</span>
          ) : (
            <span className="text-amber-800 font-semibold">
              Need {pointsNeeded} more points for {nextTierMeta?.name.split(' ')[0]}
            </span>
          )}
        </span>
        <span className="font-mono text-gray-500">
          {lifetimePoints} / {isMaxTier ? lifetimePoints : nextTier ? tierThresholds[nextTier] : 0} pts
        </span>
      </div>

      {showPerks && !isMaxTier && (
        <div className="text-[10px] text-purple-700 bg-purple-50 px-2 py-1 rounded border border-purple-100 flex items-center gap-1 font-medium">
          <span className="material-symbols-outlined text-xs text-purple-500">stars</span>
          <span>Next tier perk: {nextTierMeta?.perks.split('+')[0]}</span>
        </div>
      )}
    </div>
  );
};
