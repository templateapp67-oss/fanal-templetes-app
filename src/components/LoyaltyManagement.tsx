import React, { useState } from 'react';
import { 
  ClientRecord, 
  LoyaltyConfig, 
  LoyaltyTier, 
  RewardThreshold, 
  PointTransaction, 
  RedeemedReward,
  SalonProfile
} from '../types';
import { 
  TIER_METADATA, 
  calculateLoyaltyTier, 
  calculateRewardProgress, 
  generateCouponCode 
} from '../loyaltyData';
import { LoyaltyTierProgressBar } from './LoyaltyTierProgressBar';
import { getSiteUrl } from '../lib/salonStore';

interface LoyaltyManagementProps {
  clients: ClientRecord[];
  setClients: React.Dispatch<React.SetStateAction<ClientRecord[]>>;
  loyaltyConfig: LoyaltyConfig;
  setLoyaltyConfig: React.Dispatch<React.SetStateAction<LoyaltyConfig>>;
  primaryAccentColor?: string;
  profile: SalonProfile;
  onNavigateToPreview?: () => void;
}

export const LoyaltyManagement: React.FC<LoyaltyManagementProps> = ({
  clients,
  setClients,
  loyaltyConfig,
  setLoyaltyConfig,
  primaryAccentColor = '#0f172a',
  profile,
  onNavigateToPreview,
}) => {
  // Navigation & Tabs within Loyalty
  const [activeSubTab, setActiveSubTab] = useState<'members' | 'rewards' | 'rules'>('members');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTierFilter, setSelectedTierFilter] = useState<LoyaltyTier | 'all'>('all');

  // Modal States
  const [isAddRewardModalOpen, setIsAddRewardModalOpen] = useState<boolean>(false);
  const [editingReward, setEditingReward] = useState<RewardThreshold | null>(null);

  // New Reward Form State
  const [newRewardTitle, setNewRewardTitle] = useState<string>('');
  const [newRewardPoints, setNewRewardPoints] = useState<number>(300);
  const [newRewardType, setNewRewardType] = useState<'percentage_discount' | 'flat_discount' | 'free_service'>('percentage_discount');
  const [newRewardValue, setNewRewardValue] = useState<number>(15);
  const [newRewardCategory, setNewRewardCategory] = useState<string>('All Services');
  const [newRewardDesc, setNewRewardDesc] = useState<string>('');
  const [newRewardPrefix, setNewRewardPrefix] = useState<string>('REWARD');

  // Point Adjustment Modal State
  const [adjustingClient, setAdjustingClient] = useState<ClientRecord | null>(null);
  const [adjustPointsAmount, setAdjustPointsAmount] = useState<number>(50);
  const [adjustPointsReason, setAdjustPointsReason] = useState<string>('Special Customer Delight Bonus');
  const [adjustPointsType, setAdjustPointsType] = useState<'add' | 'deduct'>('add');

  // Redeem Reward Modal State
  const [redeemingClient, setRedeemingClient] = useState<ClientRecord | null>(null);
  const [selectedRewardToRedeem, setSelectedRewardToRedeem] = useState<RewardThreshold | null>(null);

  // Client History Drawer Modal
  const [historyClient, setHistoryClient] = useState<ClientRecord | null>(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // KPIs Calculations
  const totalPointsInCirculation = clients.reduce((sum, c) => sum + (c.points || 0), 0);
  const totalLifetimePoints = clients.reduce((sum, c) => sum + (c.lifetimePoints || 0), 0);
  const tierCounts: Record<LoyaltyTier, number> = {
    bronze: clients.filter((c) => (c.loyaltyTier || 'bronze') === 'bronze').length,
    silver: clients.filter((c) => c.loyaltyTier === 'silver').length,
    gold: clients.filter((c) => c.loyaltyTier === 'gold').length,
    platinum: clients.filter((c) => c.loyaltyTier === 'platinum').length,
  };

  // Filtered Clients
  const filteredClients = clients.filter((c) => {
    const matchesQuery = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase());
    
    const clientTier = c.loyaltyTier || calculateLoyaltyTier(c.lifetimePoints || 0, loyaltyConfig.tierThresholds);
    const matchesTier = selectedTierFilter === 'all' || clientTier === selectedTierFilter;

    return matchesQuery && matchesTier;
  });

  // Save / Add Reward Threshold
  const handleSaveReward = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRewardTitle.trim()) {
      showToast('Please enter a valid reward title');
      return;
    }

    if (editingReward) {
      // Edit
      setLoyaltyConfig((prev) => ({
        ...prev,
        rewards: prev.rewards.map((r) =>
          r.id === editingReward.id
            ? {
                ...r,
                title: newRewardTitle,
                requiredPoints: Number(newRewardPoints),
                rewardType: newRewardType,
                discountValue: Number(newRewardValue),
                applicableCategory: newRewardCategory,
                description: newRewardDesc,
                couponCodePrefix: newRewardPrefix.toUpperCase(),
              }
            : r
        ),
      }));
      showToast(`✓ Updated reward threshold "${newRewardTitle}"`);
    } else {
      // Create new
      const newReward: RewardThreshold = {
        id: `rew-${Date.now()}`,
        title: newRewardTitle,
        requiredPoints: Number(newRewardPoints),
        rewardType: newRewardType,
        discountValue: Number(newRewardValue),
        applicableCategory: newRewardCategory,
        description: newRewardDesc || `${newRewardValue}% discount voucher for salon appointments`,
        isActive: true,
        couponCodePrefix: (newRewardPrefix || 'GLOW').toUpperCase(),
      };

      setLoyaltyConfig((prev) => ({
        ...prev,
        rewards: [...prev.rewards, newReward],
      }));
      showToast(`✓ Added new reward threshold: "${newRewardTitle}" (${newRewardPoints} pts)`);
    }

    // Reset & Close
    setIsAddRewardModalOpen(false);
    setEditingReward(null);
    setNewRewardTitle('');
    setNewRewardPoints(300);
    setNewRewardValue(15);
    setNewRewardDesc('');
    setNewRewardPrefix('REWARD');
  };

  const handleOpenEditReward = (reward: RewardThreshold) => {
    setEditingReward(reward);
    setNewRewardTitle(reward.title);
    setNewRewardPoints(reward.requiredPoints);
    setNewRewardType(reward.rewardType);
    setNewRewardValue(reward.discountValue);
    setNewRewardCategory(reward.applicableCategory || 'All Services');
    setNewRewardDesc(reward.description);
    setNewRewardPrefix(reward.couponCodePrefix);
    setIsAddRewardModalOpen(true);
  };

  const handleDeleteReward = (id: string, title: string) => {
    setLoyaltyConfig((prev) => ({
      ...prev,
      rewards: prev.rewards.filter((r) => r.id !== id),
    }));
    showToast(`Removed reward threshold "${title}"`);
  };

  const handleToggleRewardActive = (id: string) => {
    setLoyaltyConfig((prev) => ({
      ...prev,
      rewards: prev.rewards.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r)),
    }));
  };

  // Adjust Client Points (+ / -)
  const handleExecutePointAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingClient) return;

    const delta = adjustPointsType === 'add' ? adjustPointsAmount : -adjustPointsAmount;
    const currentPts = adjustingClient.points || 0;
    const newPoints = Math.max(0, currentPts + delta);
    const newLifetime = Math.max(0, (adjustingClient.lifetimePoints || currentPts) + (adjustPointsType === 'add' ? adjustPointsAmount : 0));
    const newTier = calculateLoyaltyTier(newLifetime, loyaltyConfig.tierThresholds);

    const newTx: PointTransaction = {
      id: `tx-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      description: adjustPointsReason || (adjustPointsType === 'add' ? 'Manual Points Credit' : 'Manual Points Debit'),
      pointsChange: delta,
      type: 'bonus',
    };

    setClients((prev) =>
      prev.map((c) =>
        c.id === adjustingClient.id
          ? {
              ...c,
              points: newPoints,
              lifetimePoints: newLifetime,
              loyaltyTier: newTier,
              pointHistory: [newTx, ...(c.pointHistory || [])],
            }
          : c
      )
    );

    showToast(
      `✓ ${adjustPointsType === 'add' ? 'Credited' : 'Deducted'} ${adjustPointsAmount} points for ${adjustingClient.name}. New balance: ${newPoints} pts`
    );
    setAdjustingClient(null);
    setAdjustPointsAmount(50);
  };

  // Redeem Reward for Client
  const handleExecuteRedemption = () => {
    if (!redeemingClient || !selectedRewardToRedeem) return;

    if (redeemingClient.points < selectedRewardToRedeem.requiredPoints) {
      showToast('⚠️ Insufficient points balance to claim this reward.');
      return;
    }

    const couponCode = generateCouponCode(selectedRewardToRedeem.couponCodePrefix);
    const newBalance = redeemingClient.points - selectedRewardToRedeem.requiredPoints;

    const redemptionRecord: RedeemedReward = {
      id: `red-${Date.now()}`,
      rewardId: selectedRewardToRedeem.id,
      rewardTitle: selectedRewardToRedeem.title,
      discountSummary:
        selectedRewardToRedeem.rewardType === 'percentage_discount'
          ? `${selectedRewardToRedeem.discountValue}% OFF`
          : selectedRewardToRedeem.rewardType === 'flat_discount'
            ? `₹${selectedRewardToRedeem.discountValue} OFF`
            : 'Complimentary Service Add-on',
      pointsSpent: selectedRewardToRedeem.requiredPoints,
      redeemedAt: new Date().toISOString().split('T')[0],
      couponCode: couponCode,
      status: 'active',
    };

    const newTx: PointTransaction = {
      id: `tx-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      description: `Claimed Reward: ${selectedRewardToRedeem.title} (${couponCode})`,
      pointsChange: -selectedRewardToRedeem.requiredPoints,
      type: 'redeemed',
    };

    setClients((prev) =>
      prev.map((c) =>
        c.id === redeemingClient.id
          ? {
              ...c,
              points: newBalance,
              pointHistory: [newTx, ...(c.pointHistory || [])],
              redeemedRewards: [redemptionRecord, ...(c.redeemedRewards || [])],
            }
          : c
      )
    );

    showToast(`🎉 Claimed "${selectedRewardToRedeem.title}" for ${redeemingClient.name}! Coupon: ${couponCode}`);
    setRedeemingClient(null);
    setSelectedRewardToRedeem(null);
  };

  // WhatsApp Loyalty Share
  const handleSendWhatsAppLoyalty = (client: ClientRecord) => {
    const tierMeta = TIER_METADATA[client.loyaltyTier || 'bronze'];
    const { nextReward, pointsNeeded } = calculateRewardProgress(client.points || 0, loyaltyConfig.rewards);

    const message = `✨ *${(profile?.businessName || 'OUR SALON').toUpperCase()} REWARDS UPDATE* ✨

Namaste *${client.name}*! 🌸

Here is your current salon loyalty rewards snapshot:

👑 *Loyalty Tier*: ${tierMeta.name}
💎 *Available Points*: *${client.points || 0} pts*
⭐ *Total Visits*: ${client.totalVisits} visits

${
  nextReward
    ? `🎁 *Next Reward*: *${nextReward.title}*
👉 You only need *${pointsNeeded} more points* to unlock this exclusive voucher!`
    : '🎉 *Congratulations!* You have unlocked all top-tier luxury reward milestones!'
}

📍 *Book your next appointment online*:
${getSiteUrl(profile)}

We look forward to pampering you soon! 💆‍♀️💇‍♂️`;

    const encoded = encodeURIComponent(message);
    const cleanPhone = client.phone.replace(/[^0-9]/g, '');
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encoded}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    showToast(`📱 Opened WhatsApp loyalty update for ${client.name}!`);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-xs"
              style={{ backgroundColor: primaryAccentColor }}
            >
              <span className="material-symbols-outlined text-xl">loyalty</span>
            </span>
            <h2 className="font-display font-bold text-xl text-gray-900">
              Salon Client Loyalty & Rewards Program
            </h2>
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-mono-caps font-bold px-2.5 py-0.5 rounded-full">
              {loyaltyConfig.programEnabled ? 'ACTIVE & ACCRUE' : 'PAUSED'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Track client visit points, configure automated reward milestones, and deliver instant discount vouchers on bookings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onNavigateToPreview && (
            <button
              onClick={onNavigateToPreview}
              className="text-xs font-bold px-3.5 py-2 rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-700 flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-sm">visibility</span>
              <span>Client Preview</span>
            </button>
          )}

          <button
            onClick={() => {
              setEditingReward(null);
              setNewRewardTitle('');
              setNewRewardPoints(300);
              setNewRewardValue(15);
              setNewRewardDesc('');
              setNewRewardPrefix('REWARD');
              setIsAddRewardModalOpen(true);
            }}
            className="text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer hover:opacity-95 transition-all"
            style={{ backgroundColor: primaryAccentColor }}
          >
            <span className="material-symbols-outlined text-sm">add_circle</span>
            <span>Add Reward Threshold</span>
          </button>
        </div>
      </div>

      {/* TOAST FEEDBACK */}
      {toastMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-4 py-3 rounded-xl flex items-center justify-between animate-fade-in shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-600 text-lg">check_circle</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* KPI METRICS OVERVIEW */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Members */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 flex flex-col gap-1">
          <div className="flex justify-between items-center text-gray-500">
            <span className="text-[11px] font-mono-caps font-bold">Total Enrolled Members</span>
            <span className="material-symbols-outlined text-gray-400 text-lg">group</span>
          </div>
          <div className="font-display font-bold text-2xl text-gray-900">{clients.length}</div>
          <div className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
            <span>✓ 100% Active in CRM</span>
          </div>
        </div>

        {/* Points in Circulation */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 flex flex-col gap-1">
          <div className="flex justify-between items-center text-gray-500">
            <span className="text-[11px] font-mono-caps font-bold">Points In Circulation</span>
            <span className="material-symbols-outlined text-amber-500 text-lg">token</span>
          </div>
          <div className="font-mono font-bold text-2xl text-amber-700">
            {totalPointsInCirculation.toLocaleString('en-IN')} <span className="text-xs font-normal text-gray-500">pts</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            Lifetime accrued: {totalLifetimePoints.toLocaleString('en-IN')} pts
          </div>
        </div>

        {/* Active Reward Milestones */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 flex flex-col gap-1">
          <div className="flex justify-between items-center text-gray-500">
            <span className="text-[11px] font-mono-caps font-bold">Reward Milestones</span>
            <span className="material-symbols-outlined text-purple-500 text-lg">featured_seasonal_and_gifts</span>
          </div>
          <div className="font-display font-bold text-2xl text-purple-900">
            {loyaltyConfig.rewards.filter((r) => r.isActive).length} <span className="text-xs font-normal text-gray-500">active</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {loyaltyConfig.rewards.length} configured thresholds
          </div>
        </div>

        {/* Top Tier Ratio */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 flex flex-col gap-1">
          <div className="flex justify-between items-center text-gray-500">
            <span className="text-[11px] font-mono-caps font-bold">Gold & Platinum VIPs</span>
            <span className="material-symbols-outlined text-yellow-600 text-lg">military_tech</span>
          </div>
          <div className="font-display font-bold text-2xl text-yellow-700">
            {tierCounts.gold + tierCounts.platinum} <span className="text-xs font-normal text-gray-500">clients</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {tierCounts.platinum} Platinum • {tierCounts.gold} Gold • {tierCounts.silver} Silver
          </div>
        </div>

      </div>

      {/* SUB-TABS: MEMBERS CRM | REWARD THRESHOLDS | EARNING RULES & MULTIPLIERS */}
      <div className="flex border-b border-gray-200 gap-6">
        <button
          onClick={() => setActiveSubTab('members')}
          className={`pb-3 text-xs font-bold font-mono-caps flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
            activeSubTab === 'members'
              ? 'border-gray-900 text-gray-900 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <span className="material-symbols-outlined text-base">badge</span>
          <span>Client Loyalty Ledger ({clients.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('rewards')}
          className={`pb-3 text-xs font-bold font-mono-caps flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
            activeSubTab === 'rewards'
              ? 'border-gray-900 text-gray-900 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <span className="material-symbols-outlined text-base">redeem</span>
          <span>Reward Milestones & Thresholds ({loyaltyConfig.rewards.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('rules')}
          className={`pb-3 text-xs font-bold font-mono-caps flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
            activeSubTab === 'rules'
              ? 'border-gray-900 text-gray-900 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <span className="material-symbols-outlined text-base">tune</span>
          <span>Earning Rules & Tier Thresholds</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: MEMBERS DIRECTORY & POINT PROGRESSION */}
      {/* ========================================================================= */}
      {activeSubTab === 'members' && (
        <div className="flex flex-col gap-4">
          
          {/* SEARCH & TIER FILTER BAR */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-sm">search</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search member by name, phone (+91), or email..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-300 text-xs bg-gray-50 focus:bg-white focus:ring-2 focus:ring-gray-300 outline-none"
              />
            </div>

            {/* TIER FILTER PILLS */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setSelectedTierFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-caps transition-all cursor-pointer ${
                  selectedTierFilter === 'all'
                    ? 'bg-gray-900 text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All ({clients.length})
              </button>

              {(['bronze', 'silver', 'gold', 'platinum'] as LoyaltyTier[]).map((tier) => {
                const meta = TIER_METADATA[tier];
                const count = tierCounts[tier];
                const isSelected = selectedTierFilter === tier;
                return (
                  <button
                    key={tier}
                    onClick={() => setSelectedTierFilter(tier)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-caps flex items-center gap-1.5 transition-all cursor-pointer border ${
                      isSelected
                        ? `${meta.badgeBg} ${meta.borderColor} ring-2 ring-gray-400 font-extrabold shadow-xs`
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">{meta.icon}</span>
                    <span>{meta.name.split(' ')[0]}</span>
                    <span className="text-[10px] opacity-75 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* MEMBERS LIST GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredClients.map((client) => {
              const tier = client.loyaltyTier || calculateLoyaltyTier(client.lifetimePoints || 0, loyaltyConfig.tierThresholds);
              const tierMeta = TIER_METADATA[tier];
              const { nextReward, pointsNeeded, progressPercentage, unlockedRewards } = calculateRewardProgress(
                client.points || 0,
                loyaltyConfig.rewards
              );

              return (
                <div
                  key={client.id}
                  className="p-5 rounded-2xl border border-gray-200 bg-white hover:border-gray-300 transition-all shadow-xs flex flex-col justify-between gap-4"
                >
                  {/* TOP: CLIENT IDENTITY & TIER BADGE */}
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white shadow-xs bg-gradient-to-br ${tierMeta.gradient}`}
                      >
                        <span className="material-symbols-outlined text-xl">{tierMeta.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-gray-900">{client.name}</h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono-caps font-bold border ${tierMeta.badgeBg} ${tierMeta.borderColor}`}
                          >
                            {tierMeta.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                          {client.phone} • {client.totalVisits} visits • ₹{client.totalSpent.toLocaleString('en-IN')} spent
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono font-extrabold text-lg text-amber-700">
                        {(client.points || 0).toLocaleString('en-IN')} <span className="text-xs font-normal text-gray-500">pts</span>
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono">
                        Lifetime: {(client.lifetimePoints || 0).toLocaleString('en-IN')} pts
                      </div>
                    </div>
                  </div>

                  {/* MIDDLE 1: LOYALTY TIER PROGRESSION BAR */}
                  <LoyaltyTierProgressBar
                    lifetimePoints={client.lifetimePoints || client.points || 0}
                    currentPoints={client.points}
                    tierThresholds={loyaltyConfig.tierThresholds}
                    tierMultipliers={loyaltyConfig.tierMultipliers}
                    variant="compact"
                    showPerks={true}
                  />

                  {/* MIDDLE 2: LOYALTY PROGRESS BAR TO NEXT REWARD */}
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-gray-700 flex items-center gap-1">
                        <span className="material-symbols-outlined text-purple-600 text-sm">redeem</span>
                        <span>{nextReward ? nextReward.title : 'All Milestones Achieved!'}</span>
                      </span>
                      <span className="font-mono font-bold text-[11px] text-gray-600">
                        {nextReward
                          ? `${client.points || 0} / ${nextReward.requiredPoints} pts (${progressPercentage}%)`
                          : '⭐ MAX TIER'}
                      </span>
                    </div>

                    {/* Progress Track */}
                    <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-purple-600 rounded-full transition-all duration-500"
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-gray-500">
                      <span>
                        {nextReward ? (
                          <span className="text-amber-700 font-bold">
                            Need {pointsNeeded} more points for {nextReward.discountValue}
                            {nextReward.rewardType === 'percentage_discount' ? '%' : '₹'} discount
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold">Eligible for all VIP vouchers</span>
                        )}
                      </span>
                      <span>
                        {unlockedRewards.length} claimable reward{unlockedRewards.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  {/* UNCLAIMED ACTIVE REWARDS NOTICE (IF ANY) */}
                  {unlockedRewards.length > 0 && (
                    <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-800 text-[11px] font-bold">
                      <span className="material-symbols-outlined text-emerald-600 text-sm">stars</span>
                      <span>
                        Ready to claim: <span className="underline">{unlockedRewards[unlockedRewards.length - 1].title}</span>
                      </span>
                    </div>
                  )}

                  {/* BOTTOM: ACTIONS (REDEEM, ADJUST POINTS, WHATSAPP, HISTORY) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100">
                    <div className="flex items-center gap-1.5">
                      {/* Redeem Reward Button */}
                      <button
                        onClick={() => {
                          setRedeemingClient(client);
                          setSelectedRewardToRedeem(unlockedRewards[0] || loyaltyConfig.rewards[0]);
                        }}
                        disabled={unlockedRewards.length === 0}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs transition-all cursor-pointer ${
                          unlockedRewards.length > 0
                            ? 'bg-purple-600 hover:bg-purple-700 text-white'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">redeem</span>
                        <span>Redeem Voucher</span>
                      </button>

                      {/* Adjust Points Button */}
                      <button
                        onClick={() => {
                          setAdjustingClient(client);
                          setAdjustPointsAmount(50);
                          setAdjustPointsReason('Customer Loyalty Bonus');
                          setAdjustPointsType('add');
                        }}
                        className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-gray-300 hover:border-gray-400 bg-white text-gray-700 flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">add_circle</span>
                        <span>Points (+/-)</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* View History */}
                      <button
                        onClick={() => setHistoryClient(client)}
                        className="text-xs font-bold px-2 py-1.5 text-gray-500 hover:text-gray-800 flex items-center gap-1 cursor-pointer"
                        title="View Points Ledger & Redeemed History"
                      >
                        <span className="material-symbols-outlined text-sm">history</span>
                      </button>

                      {/* Share WhatsApp Balance */}
                      <button
                        onClick={() => handleSendWhatsAppLoyalty(client)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-sm">send</span>
                        <span>WhatsApp Summary</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredClients.length === 0 && (
            <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-2xl border border-gray-200">
              <span className="material-symbols-outlined text-3xl text-gray-400 mb-2">person_search</span>
              <p className="text-xs font-bold">No loyalty members match "{searchQuery}"</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: REWARD THRESHOLDS & DISCOUNT CATALOG */}
      {/* ========================================================================= */}
      {activeSubTab === 'rewards' && (
        <div className="flex flex-col gap-5">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-display font-bold text-lg text-gray-900">
                Configured Reward Thresholds & Coupons
              </h3>
              <p className="text-xs text-gray-500">
                Clients automatically unlock these rewards as they accumulate points through salon visits and invoice spending.
              </p>
            </div>

            <button
              onClick={() => {
                setEditingReward(null);
                setNewRewardTitle('');
                setNewRewardPoints(300);
                setNewRewardValue(15);
                setNewRewardDesc('');
                setNewRewardPrefix('REWARD');
                setIsAddRewardModalOpen(true);
              }}
              className="text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              style={{ backgroundColor: primaryAccentColor }}
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>Create New Threshold</span>
            </button>
          </div>

          {/* REWARDS GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loyaltyConfig.rewards.map((reward) => (
              <div
                key={reward.id}
                className={`p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
                  reward.isActive
                    ? 'bg-white border-gray-200 shadow-xs'
                    : 'bg-gray-50 border-gray-200 opacity-60'
                }`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 font-mono font-extrabold text-xs px-2.5 py-1 rounded-lg">
                      {reward.requiredPoints} Points Required
                    </span>
                    <button
                      onClick={() => handleToggleRewardActive(reward.id)}
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer ${
                        reward.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {reward.isActive ? 'ACTIVE' : 'PAUSED'}
                    </button>
                  </div>

                  <h4 className="font-display font-bold text-base text-gray-900 mt-3">{reward.title}</h4>
                  <p className="text-xs text-gray-500 mt-1">{reward.description}</p>
                </div>

                <div className="pt-3 border-t border-gray-100 flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-mono text-gray-600">
                    <span>Discount Type:</span>
                    <span className="font-bold text-gray-900">
                      {reward.rewardType === 'percentage_discount'
                        ? `${reward.discountValue}% OFF`
                        : reward.rewardType === 'flat_discount'
                          ? `₹${reward.discountValue} OFF`
                          : '100% Free Service'}
                    </span>
                  </div>

                  <div className="flex justify-between text-[11px] font-mono text-gray-600">
                    <span>Coupon Prefix:</span>
                    <span className="font-bold text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200">
                      {reward.couponCodePrefix}-XXXX
                    </span>
                  </div>

                  <div className="flex justify-between text-[11px] font-mono text-gray-600">
                    <span>Applicable Category:</span>
                    <span className="font-bold text-gray-800">{reward.applicableCategory || 'All'}</span>
                  </div>

                  {/* EDIT & DELETE ACTIONS */}
                  <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => handleOpenEditReward(reward)}
                      className="text-xs font-bold text-gray-700 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleDeleteReward(reward.id, reward.title)}
                      className="text-xs font-bold text-red-600 hover:text-red-800 flex items-center gap-1 cursor-pointer ml-2"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: EARNING RULES & TIER THRESHOLDS */}
      {/* ========================================================================= */}
      {activeSubTab === 'rules' && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* BASE POINT EARNING RULES */}
            <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-600">tune</span>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Base Point Earning Logic
                </h3>
              </div>
              <p className="text-xs text-gray-500">
                Configure how many loyalty points are automatically credited when clients book and complete salon visits.
              </p>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                    Points Per Completed Visit
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="10"
                      value={loyaltyConfig.pointsPerVisit}
                      onChange={(e) =>
                        setLoyaltyConfig((prev) => ({
                          ...prev,
                          pointsPerVisit: Number(e.target.value),
                        }))
                      }
                      className="w-32 p-2.5 rounded-xl border border-gray-300 font-mono font-bold text-xs bg-white text-gray-900"
                    />
                    <span className="text-xs text-gray-500">points awarded simply for visiting</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                    Points Per ₹100 Spent on Invoices
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={loyaltyConfig.pointsPerHundredSpent}
                      onChange={(e) =>
                        setLoyaltyConfig((prev) => ({
                          ...prev,
                          pointsPerHundredSpent: Number(e.target.value),
                        }))
                      }
                      className="w-32 p-2.5 rounded-xl border border-gray-300 font-mono font-bold text-xs bg-white text-gray-900"
                    />
                    <span className="text-xs text-gray-500">points per ₹100 spent ({loyaltyConfig.pointsPerHundredSpent}% cashback value)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* TIER QUALIFICATION THRESHOLDS */}
            <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-600">military_tech</span>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Tier Qualification Thresholds
                </h3>
              </div>
              <p className="text-xs text-gray-500">
                Lifetime points required to achieve higher VIP tier levels with accelerated point multiplier rates.
              </p>

              <div className="grid grid-cols-2 gap-3">
                {(['bronze', 'silver', 'gold', 'platinum'] as LoyaltyTier[]).map((tier) => {
                  const meta = TIER_METADATA[tier];
                  return (
                    <div key={tier} className="p-3 bg-white rounded-xl border border-gray-200 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm">{meta.icon}</span>
                        <span className="font-bold text-xs text-gray-800">{meta.name}</span>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          disabled={tier === 'bronze'}
                          value={loyaltyConfig.tierThresholds[tier]}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setLoyaltyConfig((prev) => ({
                              ...prev,
                              tierThresholds: {
                                ...prev.tierThresholds,
                                [tier]: val,
                              },
                            }));
                          }}
                          className="w-20 p-1.5 rounded-lg border border-gray-300 font-mono text-xs bg-gray-50 disabled:opacity-50"
                        />
                        <span className="text-[10px] text-gray-500 font-mono">pts req.</span>
                      </div>

                      <div className="text-[10px] text-purple-700 font-bold">
                        {loyaltyConfig.tierMultipliers[tier]}x Point Multiplier
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          <div className="flex justify-end">
            <button
              onClick={() => showToast('✓ Loyalty rules and tier parameters saved successfully!')}
              className="text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-xs cursor-pointer hover:opacity-90"
              style={{ backgroundColor: primaryAccentColor }}
            >
              Save Configuration Changes
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD / EDIT REWARD THRESHOLD */}
      {/* ========================================================================= */}
      {isAddRewardModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 flex flex-col gap-4 animate-scale-in">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-display font-bold text-lg text-gray-900">
                {editingReward ? 'Edit Reward Threshold' : 'Create New Reward Milestone'}
              </h3>
              <button
                onClick={() => setIsAddRewardModalOpen(false)}
                className="text-gray-400 hover:text-gray-700 cursor-pointer font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveReward} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">Reward Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 15% OFF Keratin or Hair Spa"
                  value={newRewardTitle}
                  onChange={(e) => setNewRewardTitle(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs text-gray-900 bg-gray-50 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">Required Points</label>
                  <input
                    type="number"
                    min="50"
                    step="50"
                    required
                    value={newRewardPoints}
                    onChange={(e) => setNewRewardPoints(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-gray-300 font-mono text-xs text-gray-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">Reward Type</label>
                  <select
                    value={newRewardType}
                    onChange={(e) => setNewRewardType(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white"
                  >
                    <option value="percentage_discount">Percentage Discount (% OFF)</option>
                    <option value="flat_discount">Flat Amount Discount (₹ OFF)</option>
                    <option value="free_service">Complimentary Free Service</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                    {newRewardType === 'percentage_discount' ? 'Discount Percent (%)' : 'Discount Value (₹)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newRewardValue}
                    onChange={(e) => setNewRewardValue(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-gray-300 font-mono text-xs text-gray-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">Coupon Prefix</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. GLOW15"
                    value={newRewardPrefix}
                    onChange={(e) => setNewRewardPrefix(e.target.value.toUpperCase())}
                    className="w-full p-2.5 rounded-xl border border-gray-300 font-mono uppercase text-xs text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">Description / Perks</label>
                <textarea
                  rows={2}
                  placeholder="Describe terms and inclusions for this reward milestone..."
                  value={newRewardDesc}
                  onChange={(e) => setNewRewardDesc(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddRewardModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white shadow-xs cursor-pointer"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  {editingReward ? 'Save Changes' : 'Create Threshold'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADJUST POINTS (+/-) FOR CLIENT */}
      {/* ========================================================================= */}
      {adjustingClient && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 flex flex-col gap-4 animate-scale-in">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Adjust Loyalty Points
                </h3>
                <p className="text-xs text-gray-500">{adjustingClient.name} ({adjustingClient.phone})</p>
              </div>
              <button
                onClick={() => setAdjustingClient(null)}
                className="text-gray-400 hover:text-gray-700 cursor-pointer font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecutePointAdjustment} className="flex flex-col gap-4">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center text-xs">
                <span className="text-gray-600">Current Points Balance:</span>
                <span className="font-mono font-bold text-base text-amber-700">
                  {adjustingClient.points || 0} pts
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustPointsType('add')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    adjustPointsType === 'add'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                      : 'bg-white border-gray-200 text-gray-600'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">add_circle</span>
                  <span>Credit (+ Points)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAdjustPointsType('deduct')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    adjustPointsType === 'deduct'
                      ? 'bg-red-50 border-red-500 text-red-800'
                      : 'bg-white border-gray-200 text-gray-600'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">remove_circle</span>
                  <span>Debit (- Points)</span>
                </button>
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Points Quantity
                </label>
                <input
                  type="number"
                  min="10"
                  step="10"
                  required
                  value={adjustPointsAmount}
                  onChange={(e) => setAdjustPointsAmount(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 font-mono font-bold text-xs text-gray-900"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Reason / Description for Transaction
                </label>
                <input
                  type="text"
                  required
                  value={adjustPointsReason}
                  onChange={(e) => setAdjustPointsReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setAdjustingClient(null)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white shadow-xs cursor-pointer"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  Confirm Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: REDEEM REWARD FOR CLIENT */}
      {/* ========================================================================= */}
      {redeemingClient && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 flex flex-col gap-4 animate-scale-in">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Redeem Reward Voucher
                </h3>
                <p className="text-xs text-gray-500">Client: {redeemingClient.name}</p>
              </div>
              <button
                onClick={() => setRedeemingClient(null)}
                className="text-gray-400 hover:text-gray-700 cursor-pointer font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex justify-between items-center text-xs">
              <span className="text-amber-900 font-bold">Available Balance:</span>
              <span className="font-mono font-bold text-base text-amber-800">
                {redeemingClient.points} pts
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold font-mono-caps text-gray-700">Select Reward to Claim</label>
              <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
                {loyaltyConfig.rewards
                  .filter((r) => r.isActive)
                  .map((reward) => {
                    const isAffordable = redeemingClient.points >= reward.requiredPoints;
                    const isSelected = selectedRewardToRedeem?.id === reward.id;

                    return (
                      <div
                        key={reward.id}
                        onClick={() => isAffordable && setSelectedRewardToRedeem(reward)}
                        className={`p-3 rounded-xl border text-xs transition-all cursor-pointer flex justify-between items-center ${
                          isSelected
                            ? 'border-purple-600 bg-purple-50 ring-2 ring-purple-300'
                            : isAffordable
                              ? 'border-gray-200 bg-white hover:bg-gray-50'
                              : 'border-gray-200 bg-gray-50 opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-gray-900">{reward.title}</div>
                          <div className="text-[11px] text-gray-500 font-mono">
                            {reward.requiredPoints} pts • {reward.discountValue}
                            {reward.rewardType === 'percentage_discount' ? '%' : '₹'} discount
                          </div>
                        </div>

                        <div>
                          {isAffordable ? (
                            <span className="material-symbols-outlined text-purple-600 text-lg">
                              {isSelected ? 'radio_button_checked' : 'radio_button_unchecked'}
                            </span>
                          ) : (
                            <span className="text-[10px] text-red-600 font-mono font-bold">Locked</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setRedeemingClient(null)}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRedemption}
                disabled={!selectedRewardToRedeem || redeemingClient.points < (selectedRewardToRedeem?.requiredPoints || 0)}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white shadow-xs cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: primaryAccentColor }}
              >
                Generate & Claim Voucher
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DRAWER 4: CLIENT POINTS & REDEMPTION TRANSACTION HISTORY */}
      {/* ========================================================================= */}
      {historyClient && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 flex flex-col gap-4 animate-scale-in max-h-[85vh] overflow-hidden">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Points History & Vouchers
                </h3>
                <p className="text-xs text-gray-500">{historyClient.name} • {historyClient.phone}</p>
              </div>
              <button
                onClick={() => setHistoryClient(null)}
                className="text-gray-400 hover:text-gray-700 cursor-pointer font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* FULL VIP TIER ROADMAP */}
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200">
              <label className="text-[11px] font-bold font-mono-caps text-gray-700 block mb-2">
                VIP Tier Progress & Roadmap
              </label>
              <LoyaltyTierProgressBar
                lifetimePoints={historyClient.lifetimePoints || historyClient.points || 0}
                currentPoints={historyClient.points}
                tierThresholds={loyaltyConfig.tierThresholds}
                tierMultipliers={loyaltyConfig.tierMultipliers}
                variant="roadmap"
                showPerks={true}
              />
            </div>

            {/* Vouchers Claimed */}
            {historyClient.redeemedRewards && historyClient.redeemedRewards.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold font-mono-caps text-gray-700">Issued Reward Vouchers</label>
                <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
                  {historyClient.redeemedRewards.map((red) => (
                    <div key={red.id} className="p-2.5 rounded-lg border border-purple-200 bg-purple-50 text-xs flex justify-between items-center">
                      <div>
                        <div className="font-bold text-purple-900">{red.rewardTitle}</div>
                        <div className="text-[10px] text-purple-700 font-mono">Issued on {red.redeemedAt} • {red.pointsSpent} pts</div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-purple-800 bg-white px-2 py-0.5 rounded border border-purple-300">
                          {red.couponCode}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transaction Ledger */}
            <div className="flex flex-col gap-2 flex-1 overflow-hidden">
              <label className="text-xs font-bold font-mono-caps text-gray-700">Points Activity Ledger</label>
              <div className="flex flex-col gap-1.5 overflow-y-auto max-h-60 pr-1">
                {(historyClient.pointHistory || []).map((tx) => (
                  <div key={tx.id} className="p-2.5 rounded-lg border border-gray-200 bg-gray-50 text-xs flex justify-between items-center">
                    <div>
                      <div className="font-bold text-gray-800">{tx.description}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{tx.date}</div>
                    </div>
                    <div className="font-mono font-bold text-sm">
                      {tx.pointsChange > 0 ? (
                        <span className="text-emerald-700">+{tx.pointsChange} pts</span>
                      ) : (
                        <span className="text-red-600">{tx.pointsChange} pts</span>
                      )}
                    </div>
                  </div>
                ))}
                {(!historyClient.pointHistory || historyClient.pointHistory.length === 0) && (
                  <div className="text-xs text-gray-400 p-4 text-center">No transaction history recorded yet.</div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <button
                onClick={() => setHistoryClient(null)}
                className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
