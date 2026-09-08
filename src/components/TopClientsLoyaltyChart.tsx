import React, { useState, useMemo } from 'react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Cell, 
  Legend 
} from 'recharts';
import { ClientRecord, Appointment, LoyaltyConfig, LoyaltyTier } from '../types';
import { TIER_METADATA, calculateLoyaltyTier, DEFAULT_LOYALTY_CONFIG } from '../loyaltyData';

export interface TopClientsLoyaltyChartProps {
  clients: ClientRecord[];
  appointments: Appointment[];
  loyaltyConfig?: LoyaltyConfig;
  primaryAccentColor?: string;
  onSelectClient?: (client: ClientRecord) => void;
  onNavigateToLoyalty?: () => void;
}

type RankingMetric = 'spend' | 'appointments' | 'points';
type ChartViewMetric = 'clientCount' | 'totalRevenue' | 'appointmentCount';

const TIER_COLORS: Record<LoyaltyTier, { fill: string; border: string; glow: string; label: string }> = {
  bronze: {
    fill: '#b45309', // amber-700
    border: '#d97706',
    glow: 'rgba(180, 83, 9, 0.15)',
    label: 'Bronze',
  },
  silver: {
    fill: '#64748b', // slate-500
    border: '#94a3b8',
    glow: 'rgba(100, 116, 139, 0.15)',
    label: 'Silver',
  },
  gold: {
    fill: '#eab308', // yellow-500
    border: '#ca8a04',
    glow: 'rgba(234, 179, 8, 0.15)',
    label: 'Gold',
  },
  platinum: {
    fill: '#9333ea', // purple-600
    border: '#7e22ce',
    glow: 'rgba(147, 51, 234, 0.15)',
    label: 'Platinum VIP',
  },
};

export const TopClientsLoyaltyChart: React.FC<TopClientsLoyaltyChartProps> = ({
  clients = [],
  appointments = [],
  loyaltyConfig = DEFAULT_LOYALTY_CONFIG,
  primaryAccentColor = '#0f172a',
  onSelectClient,
  onNavigateToLoyalty,
}) => {
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>('spend');
  const [chartViewMetric, setChartViewMetric] = useState<ChartViewMetric>('clientCount');
  const [topLimit, setTopLimit] = useState<number>(10);
  const [selectedTierFilter, setSelectedTierFilter] = useState<LoyaltyTier | 'all'>('all');

  // Correlate clients with appointments data
  const enrichedClients = useMemo(() => {
    return clients.map((client) => {
      // Find all appointments matching this client
      const clientApts = appointments.filter((apt) => {
        const phoneMatch = apt.clientPhone && client.phone && apt.clientPhone.replace(/\D/g, '').endsWith(client.phone.replace(/\D/g, '').slice(-8));
        const nameMatch = apt.clientName && client.name && apt.clientName.trim().toLowerCase() === client.name.trim().toLowerCase();
        return phoneMatch || nameMatch;
      });

      const confirmedOrCompletedApts = clientApts.filter(
        (a) => a.status === 'confirmed' || a.status === 'completed'
      );

      const appointmentRevenue = clientApts.reduce((acc, a) => acc + (a.amountPaid || a.servicePrice || 0), 0);
      const effectiveTotalSpent = Math.max(client.totalSpent || 0, appointmentRevenue);
      const effectiveVisits = Math.max(client.totalVisits || 0, clientApts.length);

      const computedTier = client.loyaltyTier || calculateLoyaltyTier(
        client.lifetimePoints || client.points || 0,
        loyaltyConfig.tierThresholds
      );

      return {
        ...client,
        computedTier,
        appointmentsCount: clientApts.length,
        confirmedAppointmentsCount: confirmedOrCompletedApts.length,
        appointmentRevenue,
        effectiveTotalSpent,
        effectiveVisits,
        matchedAppointments: clientApts,
      };
    });
  }, [clients, appointments, loyaltyConfig]);

  // Sort and extract top clients according to selected ranking metric
  const rankedTopClients = useMemo(() => {
    const sorted = [...enrichedClients].sort((a, b) => {
      if (rankingMetric === 'spend') {
        return b.effectiveTotalSpent - a.effectiveTotalSpent;
      }
      if (rankingMetric === 'appointments') {
        return b.effectiveVisits - a.effectiveVisits || b.appointmentsCount - a.appointmentsCount;
      }
      return (b.lifetimePoints || b.points || 0) - (a.lifetimePoints || a.points || 0);
    });

    return topLimit === 0 ? sorted : sorted.slice(0, topLimit);
  }, [enrichedClients, rankingMetric, topLimit]);

  // Compute distribution of loyalty tiers among the top clients
  const tierDistributionData = useMemo(() => {
    const tiers: LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];

    return tiers.map((tier) => {
      const meta = TIER_METADATA[tier];
      const tierClients = rankedTopClients.filter((c) => c.computedTier === tier);
      const clientCount = tierClients.length;
      const totalRevenue = tierClients.reduce((sum, c) => sum + c.effectiveTotalSpent, 0);
      const appointmentCount = tierClients.reduce((sum, c) => sum + c.effectiveVisits, 0);
      const totalPoints = tierClients.reduce((sum, c) => sum + (c.points || 0), 0);
      const avgSpend = clientCount > 0 ? Math.round(totalRevenue / clientCount) : 0;

      const percentageOfTop = rankedTopClients.length > 0 
        ? Math.round((clientCount / rankedTopClients.length) * 100) 
        : 0;

      return {
        tier,
        tierName: meta.name.split(' ')[0], // e.g. "Bronze", "Silver", "Gold", "Platinum"
        fullName: meta.name,
        clientCount,
        totalRevenue,
        appointmentCount,
        totalPoints,
        avgSpend,
        percentageOfTop,
        clients: tierClients,
        fill: TIER_COLORS[tier].fill,
        border: TIER_COLORS[tier].border,
        icon: meta.icon,
      };
    });
  }, [rankedTopClients]);

  // Summary KPIs
  const totalTopClients = rankedTopClients.length;
  const totalTopRevenue = rankedTopClients.reduce((sum, c) => sum + c.effectiveTotalSpent, 0);
  const totalTopAppointments = rankedTopClients.reduce((sum, c) => sum + c.effectiveVisits, 0);
  const vipClientsCount = rankedTopClients.filter(
    (c) => c.computedTier === 'gold' || c.computedTier === 'platinum'
  ).length;
  const vipDominancePercentage = totalTopClients > 0 
    ? Math.round((vipClientsCount / totalTopClients) * 100) 
    : 0;

  // Filtered clients list for the detail leaderboard
  const displayedClients = useMemo(() => {
    if (selectedTierFilter === 'all') return rankedTopClients;
    return rankedTopClients.filter((c) => c.computedTier === selectedTierFilter);
  }, [rankedTopClients, selectedTierFilter]);

  // Metric formatter for the chart Y-axis and Tooltip
  const getYAxisFormatter = (val: number) => {
    if (chartViewMetric === 'totalRevenue') {
      if (val >= 1000) return `₹${(val / 1000).toFixed(0)}k`;
      return `₹${val}`;
    }
    return `${val}`;
  };

  const getMetricLabel = () => {
    if (chartViewMetric === 'clientCount') return 'Number of Top Clients';
    if (chartViewMetric === 'totalRevenue') return 'Total Revenue Contributed (₹)';
    return 'Total Appointments / Visits';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
      {/* HEADER & CONTROLS */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-600 via-amber-500 to-purple-600 text-white flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-xl">bar_chart</span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-lg text-gray-900">
                  Loyalty Tier Distribution of Top Clients
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  Top {rankedTopClients.length} Ranked
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Correlating customer booking appointments and loyalty milestones to reveal VIP tier concentration.
              </p>
            </div>
          </div>
        </div>

        {/* CONTROLS: RANKING & VIEW METRIC */}
        <div className="flex flex-wrap items-center gap-2 self-stretch lg:self-auto">
          {/* Top Limit Selector */}
          <div className="flex items-center rounded-xl bg-gray-100 p-1 border border-gray-200 text-xs font-bold">
            <span className="text-gray-500 px-2 font-mono text-[10px] uppercase">Top:</span>
            {[5, 10, 20, 0].map((limit) => (
              <button
                key={limit}
                type="button"
                onClick={() => setTopLimit(limit)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  topLimit === limit
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {limit === 0 ? 'All' : limit}
              </button>
            ))}
          </div>

          {/* Ranking Dimension Toggle */}
          <div className="flex items-center rounded-xl bg-gray-100 p-1 border border-gray-200 text-xs font-bold">
            <span className="text-gray-500 px-2 font-mono text-[10px] uppercase">Rank By:</span>
            <button
              type="button"
              onClick={() => setRankingMetric('spend')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                rankingMetric === 'spend'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>Spend (₹)</span>
            </button>
            <button
              type="button"
              onClick={() => setRankingMetric('appointments')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                rankingMetric === 'appointments'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>Appointments</span>
            </button>
            <button
              type="button"
              onClick={() => setRankingMetric('points')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                rankingMetric === 'points'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>Points</span>
            </button>
          </div>
        </div>
      </div>

      {/* SUMMARY KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/60 flex flex-col justify-between">
          <div className="text-[11px] font-bold font-mono-caps text-gray-500 flex items-center justify-between">
            <span>VIP Dominance</span>
            <span className="material-symbols-outlined text-purple-600 text-base">diamond</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-extrabold text-2xl text-purple-900">{vipDominancePercentage}%</span>
            <span className="text-[10px] text-gray-500 font-mono">({vipClientsCount}/{totalTopClients} Gold/Plat)</span>
          </div>
          <div className="text-[10px] text-purple-700 font-bold mt-1">
            Top tier clients driving salon retention
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/60 flex flex-col justify-between">
          <div className="text-[11px] font-bold font-mono-caps text-gray-500 flex items-center justify-between">
            <span>Top Clients Revenue</span>
            <span className="material-symbols-outlined text-emerald-600 text-base">payments</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-extrabold text-2xl text-emerald-900">
              ₹{totalTopRevenue.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="text-[10px] text-emerald-700 font-bold mt-1">
            Avg: ₹{totalTopClients > 0 ? Math.round(totalTopRevenue / totalTopClients).toLocaleString('en-IN') : 0} / client
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/60 flex flex-col justify-between">
          <div className="text-[11px] font-bold font-mono-caps text-gray-500 flex items-center justify-between">
            <span>Total Bookings</span>
            <span className="material-symbols-outlined text-blue-600 text-base">event_available</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-extrabold text-2xl text-blue-900">{totalTopAppointments}</span>
            <span className="text-[10px] text-gray-500 font-mono">visits</span>
          </div>
          <div className="text-[10px] text-blue-700 font-bold mt-1">
            Avg: {totalTopClients > 0 ? (totalTopAppointments / totalTopClients).toFixed(1) : 0} appointments / client
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/60 flex flex-col justify-between">
          <div className="text-[11px] font-bold font-mono-caps text-gray-500 flex items-center justify-between">
            <span>Active Rewards</span>
            <span className="material-symbols-outlined text-amber-600 text-base">military_tech</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display font-extrabold text-2xl text-amber-900">
              {loyaltyConfig.rewards.filter((r) => r.isActive).length}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">thresholds</span>
          </div>
          {onNavigateToLoyalty && (
            <button
              type="button"
              onClick={onNavigateToLoyalty}
              className="text-[10px] text-amber-800 font-bold mt-1 hover:underline cursor-pointer flex items-center gap-0.5"
            >
              <span>Manage Loyalty Hub</span>
              <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          )}
        </div>
      </div>

      {/* CHART SECTION WITH Y-AXIS VIEW TOGGLE */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-700 font-mono-caps">
              Bar Chart Display Metric:
            </span>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setChartViewMetric('clientCount')}
                className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-all ${
                  chartViewMetric === 'clientCount'
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Top Clients Count
              </button>
              <button
                type="button"
                onClick={() => setChartViewMetric('totalRevenue')}
                className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-all ${
                  chartViewMetric === 'totalRevenue'
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Revenue (₹)
              </button>
              <button
                type="button"
                onClick={() => setChartViewMetric('appointmentCount')}
                className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-all ${
                  chartViewMetric === 'appointmentCount'
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Appointments / Visits
              </button>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 font-mono">
            {getMetricLabel()}
          </div>
        </div>

        {/* RECHARTS BAR CHART CONTAINER */}
        <div className="w-full h-72 bg-gray-50/50 rounded-2xl border border-gray-100 p-3 pt-5">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={tierDistributionData}
              margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="tierName"
                stroke="#64748b"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
                tickFormatter={getYAxisFormatter}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(241, 245, 249, 0.7)' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    const tierKey = data.tier as LoyaltyTier;
                    const meta = TIER_METADATA[tierKey];

                    return (
                      <div className="bg-white/95 backdrop-blur-md p-3.5 rounded-xl border border-gray-200 shadow-xl text-xs max-w-xs animate-scale-in">
                        <div className="flex items-center gap-2 border-b border-gray-100 pb-2 mb-2">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: data.fill }}
                          />
                          <span className="font-bold text-gray-900 font-display">
                            {data.fullName}
                          </span>
                          <span className="ml-auto text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                            {data.percentageOfTop}% of top clients
                          </span>
                        </div>

                        <div className="flex flex-col gap-1.5 text-gray-600 font-mono text-[11px]">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Top Clients:</span>
                            <span className="font-bold text-gray-900">{data.clientCount} clients</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Total Revenue:</span>
                            <span className="font-bold text-emerald-700">
                              ₹{data.totalRevenue.toLocaleString('en-IN')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Avg Spend / Client:</span>
                            <span className="font-bold text-gray-900">
                              ₹{data.avgSpend.toLocaleString('en-IN')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Appointments / Visits:</span>
                            <span className="font-bold text-blue-700">
                              {data.appointmentCount} visits
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Points Multiplier:</span>
                            <span className="font-bold text-purple-700">
                              {loyaltyConfig.tierMultipliers[tierKey]}x pts
                            </span>
                          </div>
                        </div>

                        {data.clients && data.clients.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-gray-100">
                            <span className="text-[10px] font-mono-caps text-gray-400 block mb-1">
                              Members in this tier:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {data.clients.slice(0, 4).map((c: any) => (
                                <span
                                  key={c.id}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 font-medium text-gray-800"
                                >
                                  {c.name}
                                </span>
                              ))}
                              {data.clients.length > 4 && (
                                <span className="text-[10px] text-gray-400">
                                  +{data.clients.length - 4} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar
                dataKey={chartViewMetric}
                radius={[8, 8, 0, 0]}
                maxBarSize={60}
              >
                {tierDistributionData.map((entry) => (
                  <Cell
                    key={`cell-${entry.tier}`}
                    fill={entry.fill}
                    className="transition-all hover:opacity-85 cursor-pointer"
                    onClick={() => setSelectedTierFilter(selectedTierFilter === entry.tier ? 'all' : entry.tier)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* INTERACTIVE TIER SUMMARY PILLS (FILTER LEADERBOARD) */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-gray-700 font-mono-caps">
            Filter Top Clients by Tier:
          </span>
          <button
            type="button"
            onClick={() => setSelectedTierFilter('all')}
            className={`text-[11px] font-bold cursor-pointer ${
              selectedTierFilter === 'all'
                ? 'text-gray-900 underline'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            Show All ({rankedTopClients.length})
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {tierDistributionData.map((t) => {
            const isSelected = selectedTierFilter === t.tier;
            return (
              <button
                key={t.tier}
                type="button"
                onClick={() => setSelectedTierFilter(isSelected ? 'all' : t.tier)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'border-gray-900 bg-gray-900 text-white shadow-xs'
                    : 'bg-white border-gray-200 hover:border-gray-300 text-gray-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: t.fill }}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">{t.tierName}</div>
                    <div className={`text-[10px] font-mono ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                      ₹{t.totalRevenue.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono font-bold text-sm">{t.clientCount}</span>
                  <div className={`text-[9px] font-mono ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                    {t.percentageOfTop}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* TOP CLIENTS LEADERBOARD LIST */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center text-xs">
          <div className="font-bold text-gray-700 font-mono-caps flex items-center gap-2">
            <span>Ranked Top Clients</span>
            {selectedTierFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white border border-gray-300">
                Filtered: {selectedTierFilter.toUpperCase()}
              </span>
            )}
          </div>
          <span className="text-[11px] text-gray-500 font-mono">
            Showing {displayedClients.length} of {rankedTopClients.length}
          </span>
        </div>

        <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {displayedClients.map((client, idx) => {
            const tierMeta = TIER_METADATA[client.computedTier];
            return (
              <div
                key={client.id}
                className="px-4 py-3 flex items-center justify-between hover:bg-gray-50/80 transition-colors text-xs"
              >
                {/* Left: Rank, Name, Contact */}
                <div className="flex items-center gap-3">
                  <span className="font-mono font-extrabold text-xs text-gray-400 w-5">
                    #{idx + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{client.name}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono-caps font-bold border ${tierMeta.badgeBg} ${tierMeta.borderColor} flex items-center gap-0.5`}
                      >
                        <span className="material-symbols-outlined text-[10px]">{tierMeta.icon}</span>
                        <span>{tierMeta.name.split(' ')[0]}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono">
                      {client.phone} • Stylist: {client.favoriteStylist || 'Any'}
                    </div>
                  </div>
                </div>

                {/* Right: Spent, Appointments, Points */}
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="font-mono font-bold text-emerald-700">
                      ₹{client.effectiveTotalSpent.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      {client.effectiveVisits} visits ({client.appointmentsCount} booked)
                    </div>
                  </div>

                  <div className="min-w-[60px]">
                    <div className="font-mono font-bold text-amber-700">
                      {client.points || 0} pts
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      {loyaltyConfig.tierMultipliers[client.computedTier]}x rate
                    </div>
                  </div>

                  {onSelectClient && (
                    <button
                      type="button"
                      onClick={() => onSelectClient(client)}
                      className="px-2.5 py-1 rounded-lg border border-gray-300 hover:bg-gray-100 font-bold text-[11px] text-gray-700 cursor-pointer"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {displayedClients.length === 0 && (
            <div className="p-6 text-center text-xs text-gray-400">
              No clients found in the selected tier filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
