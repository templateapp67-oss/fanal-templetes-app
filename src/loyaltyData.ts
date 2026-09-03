import { LoyaltyConfig, LoyaltyTier, RewardThreshold, ClientRecord } from './types';

export const DEFAULT_REWARD_THRESHOLDS: RewardThreshold[] = [
  {
    id: 'rew-1',
    title: '10% OFF Any Hair or Skin Service',
    requiredPoints: 200,
    rewardType: 'percentage_discount',
    discountValue: 10,
    applicableCategory: 'All Services',
    description: 'Enjoy 10% instant discount on your next appointment billing.',
    isActive: true,
    couponCodePrefix: 'GLOW10',
  },
  {
    id: 'rew-2',
    title: 'Flat ₹300 OFF (Min. Billing ₹1,000)',
    requiredPoints: 400,
    rewardType: 'flat_discount',
    discountValue: 300,
    applicableCategory: 'All Services',
    description: 'Flat ₹300 discount applicable on any service invoice exceeding ₹1,000.',
    isActive: true,
    couponCodePrefix: 'SAVE300',
  },
  {
    id: 'rew-3',
    title: '20% OFF Festive & Premium Treatments',
    requiredPoints: 750,
    rewardType: 'percentage_discount',
    discountValue: 20,
    applicableCategory: 'Hair & Spa',
    description: '20% voucher for Keratin, Hair Botox, or Full Body Rejuvenation packages.',
    isActive: true,
    couponCodePrefix: 'ROYAL20',
  },
  {
    id: 'rew-4',
    title: 'Complimentary Scalp Detox / Hand Spa Ritual',
    requiredPoints: 1200,
    rewardType: 'free_service',
    discountValue: 100, // 100% free add-on
    applicableCategory: 'Spa & Wellness',
    description: 'Free 30-minute luxury botanical scalp massage or rejuvenating crystal hand spa.',
    isActive: true,
    couponCodePrefix: 'FREESPA',
  },
  {
    id: 'rew-5',
    title: 'Flat ₹1,500 OFF Luxury Makeover / Bridal Lounge',
    requiredPoints: 2000,
    rewardType: 'flat_discount',
    discountValue: 1500,
    applicableCategory: 'Makeover & Bridal',
    description: 'VIP luxury voucher for high-end styling, bridal sessions, or full day pampering.',
    isActive: true,
    couponCodePrefix: 'VIP1500',
  },
];

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  programEnabled: true,
  pointsPerVisit: 50,
  pointsPerHundredSpent: 10, // 10 pts per ₹100 spent (10% back in points)
  tierThresholds: {
    bronze: 0,
    silver: 300,
    gold: 800,
    platinum: 1800,
  },
  tierMultipliers: {
    bronze: 1.0,
    silver: 1.25,
    gold: 1.5,
    platinum: 2.0,
  },
  rewards: DEFAULT_REWARD_THRESHOLDS,
};

export const TIER_METADATA: Record<
  LoyaltyTier,
  {
    name: string;
    badgeBg: string;
    badgeText: string;
    borderColor: string;
    icon: string;
    perks: string;
    gradient: string;
  }
> = {
  bronze: {
    name: 'Bronze Member',
    badgeBg: 'bg-amber-100 text-amber-900',
    badgeText: 'text-amber-800',
    borderColor: 'border-amber-300',
    icon: 'workspace_premium',
    perks: 'Standard points earning (50 pts / visit + 10% spend points)',
    gradient: 'from-amber-600 to-amber-800',
  },
  silver: {
    name: 'Silver Elite',
    badgeBg: 'bg-slate-100 text-slate-800',
    badgeText: 'text-slate-700',
    borderColor: 'border-slate-300',
    icon: 'military_tech',
    perks: '1.25x Points multiplier + Complimentary herbal welcome beverage',
    gradient: 'from-slate-400 to-slate-600',
  },
  gold: {
    name: 'Gold Royalty',
    badgeBg: 'bg-yellow-100 text-yellow-900',
    badgeText: 'text-yellow-800',
    borderColor: 'border-yellow-400',
    icon: 'stars',
    perks: '1.5x Points multiplier + Priority weekend appointment booking',
    gradient: 'from-yellow-400 via-amber-500 to-yellow-600',
  },
  platinum: {
    name: 'Platinum VIP Sanctuary',
    badgeBg: 'bg-purple-100 text-purple-900',
    badgeText: 'text-purple-800',
    borderColor: 'border-purple-400',
    icon: 'diamond',
    perks: '2.0x Double points + Dedicated master stylist + Exclusive previews',
    gradient: 'from-purple-500 via-indigo-600 to-pink-500',
  },
};

export function calculateLoyaltyTier(
  lifetimePoints: number,
  thresholds: LoyaltyConfig['tierThresholds'] = DEFAULT_LOYALTY_CONFIG.tierThresholds
): LoyaltyTier {
  if (lifetimePoints >= thresholds.platinum) return 'platinum';
  if (lifetimePoints >= thresholds.gold) return 'gold';
  if (lifetimePoints >= thresholds.silver) return 'silver';
  return 'bronze';
}

export function calculateRewardProgress(
  currentPoints: number,
  rewards: RewardThreshold[] = DEFAULT_REWARD_THRESHOLDS
) {
  const activeRewards = rewards
    .filter((r) => r.isActive)
    .sort((a, b) => a.requiredPoints - b.requiredPoints);

  if (activeRewards.length === 0) {
    return {
      unlockedRewards: [],
      nextReward: null,
      pointsNeeded: 0,
      progressPercentage: 100,
      nextThresholdPoints: 0,
    };
  }

  const unlockedRewards = activeRewards.filter((r) => currentPoints >= r.requiredPoints);
  const nextReward = activeRewards.find((r) => currentPoints < r.requiredPoints) || null;

  if (!nextReward) {
    return {
      unlockedRewards,
      nextReward: null,
      pointsNeeded: 0,
      progressPercentage: 100,
      nextThresholdPoints: activeRewards[activeRewards.length - 1].requiredPoints,
    };
  }

  const prevThreshold =
    unlockedRewards.length > 0
      ? unlockedRewards[unlockedRewards.length - 1].requiredPoints
      : 0;
  
  const span = nextReward.requiredPoints - prevThreshold;
  const currentInSpan = Math.max(0, currentPoints - prevThreshold);
  const progressPercentage = Math.min(100, Math.max(0, Math.round((currentInSpan / (span || 1)) * 100)));
  const pointsNeeded = Math.max(0, nextReward.requiredPoints - currentPoints);

  return {
    unlockedRewards,
    nextReward,
    pointsNeeded,
    progressPercentage,
    nextThresholdPoints: nextReward.requiredPoints,
  };
}

export function generateCouponCode(prefix: string): string {
  const randomHex = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${randomHex}`;
}
