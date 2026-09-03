import React, { useState } from 'react';
import { SalonProfile, SalonService, Stylist, Appointment, ClientRecord, LoyaltyConfig } from '../types';
import { ACCENT_PALETTES, AccentPaletteKey, applyPrimaryAccentCssVar } from '../themeAccents';
import { TeamManagement } from './TeamManagement';
import { PromoStudio } from './PromoStudio';
import { LoyaltyManagement } from './LoyaltyManagement';
import { DEFAULT_LOYALTY_CONFIG, TIER_METADATA, calculateLoyaltyTier, calculateRewardProgress } from '../loyaltyData';

interface SaaSDashboardProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  stylists: Stylist[];
  setStylists: React.Dispatch<React.SetStateAction<Stylist[]>>;
  appointments: Appointment[];
  setAppointments: React.Dispatch<React.SetStateAction<Appointment[]>>;
  clients: ClientRecord[];
  setClients?: React.Dispatch<React.SetStateAction<ClientRecord[]>>;
  loyaltyConfig?: LoyaltyConfig;
  setLoyaltyConfig?: React.Dispatch<React.SetStateAction<LoyaltyConfig>>;
  onNavigateToPreview?: () => void;
}

type TabType = 'overview' | 'calendar' | 'services' | 'team' | 'clients' | 'loyalty' | 'marketing' | 'appearance' | 'website';

export const SaaSDashboard: React.FC<SaaSDashboardProps> = ({
  profile,
  setProfile,
  services,
  stylists,
  setStylists,
  appointments,
  setAppointments,
  clients,
  setClients = (_clients: React.SetStateAction<ClientRecord[]>) => {},
  loyaltyConfig: externalLoyaltyConfig,
  setLoyaltyConfig: externalSetLoyaltyConfig,
  onNavigateToPreview,
}) => {
  const [internalLoyaltyConfig, setInternalLoyaltyConfig] = useState<LoyaltyConfig>(DEFAULT_LOYALTY_CONFIG);
  const loyaltyConfig = externalLoyaltyConfig || internalLoyaltyConfig;
  const setLoyaltyConfig = externalSetLoyaltyConfig || setInternalLoyaltyConfig;

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [marketingSms, setMarketingSms] = useState<string>('');
  const [marketingLoading, setMarketingLoading] = useState<boolean>(false);
  const [smsSentNotice, setSmsSentNotice] = useState<string>('');

  const currentAccentKey: AccentPaletteKey = (profile.themeAccentKey as AccentPaletteKey) || 'slate';
  const currentPalette = ACCENT_PALETTES[currentAccentKey] || ACCENT_PALETTES.slate;
  const currentPrimaryColor = profile.customAccentColor || currentPalette.primaryHex;

  const [customHexInput, setCustomHexInput] = useState<string>(currentPrimaryColor);
  const [accentAppliedFeedback, setAccentAppliedFeedback] = useState<string>('');

  const totalRevenue = appointments.reduce((sum, a) => sum + a.servicePrice, 0) + 142500;
  const totalBookings = appointments.length + 68;

  const handleSelectAccent = (palKey: AccentPaletteKey) => {
    const pal = ACCENT_PALETTES[palKey];
    if (!pal) return;
    setProfile((prev) => ({
      ...prev,
      themeAccentKey: palKey,
      customAccentColor: undefined,
    }));
    // Updates the primary accent CSS variable across all 14 templates
    applyPrimaryAccentCssVar(pal.primaryHex, pal.secondaryHex);
    setCustomHexInput(pal.primaryHex);
    setAccentAppliedFeedback(`Applied "${pal.name}" (${pal.primaryHex}) to CSS variable --primary-accent!`);
    setTimeout(() => setAccentAppliedFeedback(''), 4000);
  };

  const handleApplyCustomHex = (hex: string) => {
    const formatted = hex.startsWith('#') ? hex : `#${hex}`;
    if (!/^#[0-9A-Fa-f]{6}$/.test(formatted)) {
      setAccentAppliedFeedback('Please enter a valid 6-digit hex code (e.g. #9f1239)');
      setTimeout(() => setAccentAppliedFeedback(''), 4000);
      return;
    }
    setProfile((prev) => ({
      ...prev,
      customAccentColor: formatted,
    }));
    // Updates the primary accent CSS variable across all 14 templates
    applyPrimaryAccentCssVar(formatted);
    setCustomHexInput(formatted);
    setAccentAppliedFeedback(`Applied custom accent ${formatted} to CSS variable --primary-accent!`);
    setTimeout(() => setAccentAppliedFeedback(''), 4000);
  };

  const handleGenerateSms = () => {
    setMarketingLoading(true);
    setTimeout(() => {
      setMarketingSms(
        `Namaste [Client Name]! We miss your glow at ${profile.businessName}. Book your favorite service this week and receive an exclusive complimentary botanical scalp or hand spa therapy. Claim your slot: https://${profile.subdomain}.nexora.in/book`
      );
      setMarketingLoading(false);
    }, 1000);
  };

  const updateAppointmentStatus = (id: string, status: 'completed' | 'cancelled') => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    if (status === 'completed') {
      const apt = appointments.find((a) => a.id === id);
      if (apt) {
        const client = clients.find((c) => c.phone === apt.clientPhone || c.name.toLowerCase() === apt.clientName.toLowerCase());
        if (client) {
          const spendPoints = Math.round((apt.servicePrice / 100) * loyaltyConfig.pointsPerHundredSpent);
          const baseVisitPoints = loyaltyConfig.pointsPerVisit;
          const tier = client.loyaltyTier || 'bronze';
          const multiplier = loyaltyConfig.tierMultipliers[tier] || 1.0;
          const finalEarned = Math.round((baseVisitPoints + spendPoints) * multiplier);

          const newTx = {
            id: `tx-${Date.now()}`,
            date: apt.date,
            description: `Completed Appointment: ${apt.serviceName}`,
            pointsChange: finalEarned,
            type: 'spend_earned' as const,
          };

          setClients((prev) =>
            prev.map((c) => {
              if (c.id !== client.id) return c;
              const newPts = (c.points || 0) + finalEarned;
              const newLife = (c.lifetimePoints || (c.points || 0)) + finalEarned;
              const newTier = calculateLoyaltyTier(newLife, loyaltyConfig.tierThresholds);
              return {
                ...c,
                points: newPts,
                lifetimePoints: newLife,
                loyaltyTier: newTier,
                pointHistory: [newTx, ...(c.pointHistory || [])],
              };
            })
          );
        }
      }
    }
  };

  const handleSendCampaign = () => {
    setSmsSentNotice('Campaign dispatched successfully via WhatsApp & SMS to 42 clients across India!');
    setTimeout(() => {
      setSmsSentNotice('');
    }, 4000);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 flex flex-col items-center bg-[#f9f9ff] text-[#151c27]">
      <div className="max-w-[1240px] w-full px-4 sm:px-6">
        
        {/* DASHBOARD HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
          <div className="flex items-center gap-4">
            <div 
              className="w-14 h-14 rounded-2xl text-white flex items-center justify-center font-bold text-2xl shadow-md transition-colors"
              style={{ backgroundColor: currentPrimaryColor }}
            >
              <span className="material-symbols-outlined text-3xl">storefront</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold">{profile.businessName}</h1>
                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-mono-caps font-bold px-2 py-0.5 rounded-full">
                  LIVE SALON SITE
                </span>
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                https://{profile.subdomain}.nexora.in • {profile.city}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {onNavigateToPreview && (
              <button
                onClick={onNavigateToPreview}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-700 flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-sm">visibility</span>
                <span>View Salon Preview</span>
              </button>
            )}

            <div className="text-right hidden sm:block border-l border-gray-200 pl-4">
              <div className="text-xs font-bold text-gray-500 font-mono-caps">Monthly Earnings (₹ INR)</div>
              <div 
                className="font-display font-extrabold text-2xl"
                style={{ color: currentPrimaryColor }}
              >
                ₹{totalRevenue.toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex border-b border-gray-200 mb-6 gap-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: 'dashboard' },
            { id: 'calendar', label: 'Appointments', icon: 'calendar_month' },
            { id: 'services', label: 'Services Menu', icon: 'spa' },
            { id: 'team', label: 'Team Management', icon: 'badge' },
            { id: 'clients', label: 'Clients CRM', icon: 'group' },
            { id: 'loyalty', label: 'Loyalty & Rewards', icon: 'military_tech' },
            { id: 'marketing', label: 'Promo Image & Social', icon: 'photo_camera_back' },
            { id: 'appearance', label: 'Appearance', icon: 'palette' },
            { id: 'website', label: 'Salon Info', icon: 'storefront' }
          ].map((tab) => {
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`px-4 py-3 text-xs font-bold font-mono-caps border-b-2 flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  isTabActive
                    ? 'font-extrabold'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
                style={isTabActive ? { borderColor: currentPrimaryColor, color: currentPrimaryColor } : {}}
              >
                <span className="material-symbols-outlined text-lg">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.id === 'loyalty' && (
                  <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full">
                    {loyaltyConfig.rewards.filter((r) => r.isActive).length} Perks
                  </span>
                )}
                {tab.id === 'marketing' && (
                  <span className="bg-gradient-to-r from-pink-500 to-rose-500 text-white text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full">
                    AI
                  </span>
                )}
                {tab.id === 'team' && (
                  <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-1.5 py-0.2 rounded-full border border-gray-200">
                    {stylists.length}
                  </span>
                )}
                {tab.id === 'appearance' && (
                  <span 
                    className="w-2.5 h-2.5 rounded-full border border-black/10 shadow-xs"
                    style={{ backgroundColor: currentPrimaryColor }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* TAB CONTENT: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Total Revenue (₹)</span>
                  <span className="material-symbols-outlined text-[#b0004a]">payments</span>
                </div>
                <div className="font-display font-extrabold text-2xl">₹{totalRevenue.toLocaleString('en-IN')}</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">+24% vs last month</div>
              </div>

              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Appointments</span>
                  <span className="material-symbols-outlined text-[#b0004a]">calendar_month</span>
                </div>
                <div className="font-display font-extrabold text-2xl">{totalBookings}</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">96% Fill rate</div>
              </div>

              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Active Clients</span>
                  <span className="material-symbols-outlined text-[#b0004a]">person_add</span>
                </div>
                <div className="font-display font-extrabold text-2xl">218</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">+18 Indian clients this week</div>
              </div>

              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Repeat Visit Rate</span>
                  <span className="material-symbols-outlined text-[#b0004a]">repeat</span>
                </div>
                <div className="font-display font-extrabold text-2xl">86%</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">+8% automated retention</div>
              </div>
            </div>

            {/* Upcoming Appointments Table */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-display font-bold text-lg">Confirmed Indian Client Appointments</h2>
                <span className="text-xs text-slate-500 font-mono">Currency: INR (₹)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                      <th className="py-3 px-2">Client</th>
                      <th className="py-3 px-2">Service</th>
                      <th className="py-3 px-2">Stylist</th>
                      <th className="py-3 px-2">Date & Time</th>
                      <th className="py-3 px-2">Payment (INR)</th>
                      <th className="py-3 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((apt) => (
                      <tr key={apt.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2 font-bold">{apt.clientName}</td>
                        <td className="py-3 px-2">{apt.serviceName} (₹{apt.servicePrice.toLocaleString('en-IN')})</td>
                        <td className="py-3 px-2">{apt.stylistName}</td>
                        <td className="py-3 px-2 font-mono">{apt.date} at {apt.time}</td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            apt.paymentStatus === 'paid_full' 
                              ? 'bg-emerald-100 text-emerald-700' 
                              : apt.paymentStatus === 'paid_deposit'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                          }`}>
                            {apt.paymentStatus.replace('_', ' ').toUpperCase()} (₹{apt.amountPaid})
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          {apt.status === 'confirmed' ? (
                            <button
                              onClick={() => updateAppointmentStatus(apt.id, 'completed')}
                              className="text-xs bg-emerald-600 text-white font-bold px-2.5 py-1 rounded hover:bg-emerald-700 cursor-pointer"
                            >
                              Complete
                            </button>
                          ) : (
                            <span className="text-slate-400 font-bold">Done</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: APPOINTMENTS */}
        {activeTab === 'calendar' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
            <h2 className="font-display font-bold text-xl mb-4">Calendar & Appointment Schedule</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {appointments.map((apt) => (
                <div key={apt.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-sm">{apt.clientName}</div>
                    <div className="text-xs text-gray-500">{apt.serviceName} with {apt.stylistName}</div>
                    <div className="text-xs font-mono font-bold text-[#b0004a] mt-1">{apt.date} @ {apt.time}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-base">₹{apt.servicePrice.toLocaleString('en-IN')}</div>
                    <div className="text-[10px] text-gray-400 font-mono">Paid Advance: ₹{apt.amountPaid}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB CONTENT: SERVICES */}
        {activeTab === 'services' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-xl">Manage Services & INR (₹) Pricing</h2>
                <p className="text-xs text-slate-500">Live treatments reflected on client website booking system</p>
              </div>
              <button
                onClick={() => setActiveTab('marketing')}
                className="text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs flex items-center gap-1.5 w-fit cursor-pointer"
                style={{ backgroundColor: currentPrimaryColor }}
              >
                <span className="material-symbols-outlined text-sm">photo_camera_back</span>
                <span>Launch Promo Studio</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {services.map((srv) => (
                <div key={srv.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-sm">{srv.name}</div>
                    <div className="text-xs text-gray-500">{srv.description}</div>
                    <div className="text-xs text-gray-400 mt-1">{srv.durationMinutes} mins | {srv.category}</div>
                    <button
                      onClick={() => setActiveTab('marketing')}
                      className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 mt-2 flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-xs">auto_awesome</span>
                      <span>Generate Promo Image for this Service</span>
                    </button>
                  </div>
                  <div className="text-right">
                    <div className="font-display font-bold text-lg text-[#b0004a]">
                      ₹{srv.price.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB CONTENT: TEAM MANAGEMENT */}
        {activeTab === 'team' && (
          <TeamManagement
            stylists={stylists}
            setStylists={setStylists}
            primaryAccentColor={currentPrimaryColor}
            services={services}
            onNavigateToPreview={onNavigateToPreview}
          />
        )}

        {/* TAB CONTENT: CLIENTS */}
        {activeTab === 'clients' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-4">
              <div>
                <h2 className="font-display font-bold text-xl text-gray-900">
                  Client CRM & Visit History
                </h2>
                <p className="text-xs text-gray-500">
                  Manage customer profiles, visit records, preferences, and automated loyalty reward progression.
                </p>
              </div>

              <button
                onClick={() => setActiveTab('loyalty')}
                className="text-xs font-bold px-4 py-2 rounded-xl text-white shadow-xs flex items-center gap-1.5 cursor-pointer hover:opacity-95"
                style={{ backgroundColor: currentPrimaryColor }}
              >
                <span className="material-symbols-outlined text-sm">military_tech</span>
                <span>Open Loyalty & Rewards Hub</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((cli) => {
                const tier = cli.loyaltyTier || calculateLoyaltyTier(cli.lifetimePoints || 0, loyaltyConfig.tierThresholds);
                const tierMeta = TIER_METADATA[tier];
                const { nextReward, pointsNeeded, progressPercentage, unlockedRewards } = calculateRewardProgress(
                  cli.points || 0,
                  loyaltyConfig.rewards
                );

                return (
                  <div 
                    key={cli.id} 
                    className="p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 shadow-xs flex flex-col justify-between gap-3 text-xs"
                  >
                    <div>
                      {/* Top identity & Tier */}
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-sm text-gray-900">{cli.name}</span>
                          <div className="text-gray-500 text-[11px] font-mono mt-0.5">{cli.phone}</div>
                        </div>
                        <div className="flex flex-col items-end">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono-caps font-bold border ${tierMeta.badgeBg} ${tierMeta.borderColor} flex items-center gap-1`}
                          >
                            <span className="material-symbols-outlined text-xs">{tierMeta.icon}</span>
                            <span>{tierMeta.name.split(' ')[0]}</span>
                          </span>
                          <span className="font-mono text-emerald-700 font-bold text-xs mt-1">
                            ₹{cli.totalSpent.toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>

                      {/* Notes */}
                      {cli.notes && (
                        <div className="text-gray-600 italic bg-gray-50 p-2 rounded-lg border border-gray-100 text-[11px] mt-2">
                          "{cli.notes}"
                        </div>
                      )}

                      {/* Loyalty Progress Card */}
                      <div className="mt-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="font-bold text-amber-900 flex items-center gap-1">
                            <span className="material-symbols-outlined text-xs text-amber-600">stars</span>
                            <span>{cli.points || 0} pts balance</span>
                          </span>
                          <span className="text-[10px] font-mono text-gray-500">
                            {progressPercentage}% to next reward
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-amber-200/60 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-purple-600 rounded-full"
                            style={{ width: `${progressPercentage}%` }}
                          />
                        </div>

                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-gray-600 truncate max-w-[180px]">
                            {nextReward ? `Next: ${nextReward.title}` : '⭐ Max Tier Achieved'}
                          </span>
                          {nextReward && (
                            <span className="font-bold text-amber-800 font-mono">
                              +{pointsNeeded} pts
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer Info & Quick Link */}
                    <div className="flex justify-between items-center text-[11px] text-gray-400 pt-2 border-t border-gray-100">
                      <span>Visits: {cli.totalVisits} | {cli.favoriteStylist}</span>
                      <button
                        onClick={() => setActiveTab('loyalty')}
                        className="text-purple-700 hover:text-purple-900 font-bold flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>Loyalty Hub</span>
                        <span className="material-symbols-outlined text-xs">chevron_right</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB CONTENT: LOYALTY & REWARDS PROGRAM */}
        {activeTab === 'loyalty' && (
          <LoyaltyManagement
            clients={clients}
            setClients={setClients}
            loyaltyConfig={loyaltyConfig}
            setLoyaltyConfig={setLoyaltyConfig}
            primaryAccentColor={currentPrimaryColor}
            profile={profile}
            onNavigateToPreview={onNavigateToPreview}
          />
        )}

        {/* TAB CONTENT: PROMO STUDIO & AI MARKETING */}
        {activeTab === 'marketing' && (
          <div className="flex flex-col gap-6">
            <PromoStudio
              profile={profile}
              services={services}
              primaryAccentColor={currentPrimaryColor}
              onNavigateToPreview={onNavigateToPreview}
            />

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-4">
              <div className="flex items-center gap-2 text-emerald-700">
                <span className="material-symbols-outlined text-xl">sms</span>
                <h3 className="font-display font-bold text-lg text-gray-900">
                  Quick Client Retention SMS & Broadcast
                </h3>
              </div>
              <p className="text-xs text-gray-500">
                Send targeted SMS re-engagement reminders to clients who haven't visited in the last 30+ days.
              </p>

              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-3">
                <button
                  onClick={handleGenerateSms}
                  disabled={marketingLoading}
                  className="text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs w-fit flex items-center gap-2 cursor-pointer transition-opacity"
                  style={{ backgroundColor: currentPrimaryColor }}
                >
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                  <span>{marketingLoading ? 'Composing Campaign...' : 'Generate Retention SMS'}</span>
                </button>

                {marketingSms && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold font-mono-caps text-gray-700">
                      Drafted WhatsApp / SMS Campaign
                    </label>
                    <textarea
                      rows={3}
                      value={marketingSms}
                      onChange={(e) => setMarketingSms(e.target.value)}
                      className="w-full p-3 rounded-xl border border-gray-300 bg-white text-xs font-mono"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSendCampaign}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg w-fit cursor-pointer flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-sm">send</span>
                        <span>Send to 42 Clients Now</span>
                      </button>
                      {smsSentNotice && (
                        <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                          ✓ {smsSentNotice}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: APPEARANCE (THEME ACCENT COLOR PICKER & CSS VARIABLE UPDATER) */}
        {activeTab === 'appearance' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span 
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white"
                    style={{ backgroundColor: currentPrimaryColor }}
                  >
                    <span className="material-symbols-outlined text-lg">palette</span>
                  </span>
                  <h2 className="font-display font-bold text-xl text-gray-900">
                    Appearance & Theme Accent
                  </h2>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Pick a Theme Accent color for your salon. This dynamically updates the primary accent CSS variable (<code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 font-mono text-[11px]">--primary-accent</code>) used across all 14 templates without breaking layout grids or typography scales.
                </p>
              </div>

              {onNavigateToPreview && (
                <button
                  onClick={onNavigateToPreview}
                  className="text-xs font-bold px-4 py-2.5 rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-800 flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  <span>Preview Across 14 Templates</span>
                </button>
              )}
            </div>

            {/* Active CSS Variable Status Indicator */}
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-xl border-2 border-white shadow-md shrink-0 flex items-center justify-center text-white"
                  style={{ backgroundColor: currentPrimaryColor }}
                >
                  <span className="material-symbols-outlined text-lg">check</span>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-gray-900">
                      {profile.customAccentColor ? 'Custom Accent Color' : currentPalette.name}
                    </span>
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-white border border-gray-200">
                      {currentPrimaryColor}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono mt-0.5">
                    <span>CSS Variable: <code className="text-gray-800 font-bold">--primary-accent: {currentPrimaryColor}</code></span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live in DOM
                    </span>
                  </div>
                </div>
              </div>

              {accentAppliedFeedback && (
                <div className="text-xs text-emerald-800 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 animate-fade-in">
                  ✓ {accentAppliedFeedback}
                </div>
              )}
            </div>

            {/* Curated Theme Accent Palettes Grid */}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block">
                  Curated Theme Accent Palettes
                </label>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Professionally balanced palettes calibrated for contrast, legibility, and high conversion in Indian salons.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.values(ACCENT_PALETTES).map((pal) => {
                  const isSelected = !profile.customAccentColor && currentAccentKey === pal.key;
                  return (
                    <button
                      key={pal.key}
                      onClick={() => handleSelectAccent(pal.key)}
                      className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer relative ${
                        isSelected
                          ? 'bg-white shadow-md ring-2'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-xs'
                      }`}
                      style={isSelected ? { borderColor: pal.primaryHex, outlineColor: pal.primaryHex } : {}}
                    >
                      <div className="relative shrink-0 mt-0.5">
                        <span
                          className="w-8 h-8 rounded-xl border border-black/10 flex items-center justify-center shadow-xs text-white"
                          style={{ backgroundColor: pal.primaryHex }}
                        >
                          {isSelected && <span className="material-symbols-outlined text-sm">check</span>}
                        </span>
                        <span
                          className="w-3 h-3 rounded-full border border-white absolute -bottom-1 -right-1 shadow-xs"
                          style={{ backgroundColor: pal.secondaryHex }}
                          title={`Secondary: ${pal.secondaryHex}`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-gray-900 truncate flex items-center justify-between">
                          <span>{pal.name}</span>
                          {isSelected && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-gray-100 text-gray-800">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                          {pal.categoryHint}
                        </div>
                        <div className="font-mono text-[10px] text-gray-400 mt-1">
                          {pal.primaryHex}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Hex Accent Color Picker */}
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block">
                  Custom Hex Accent Color
                </label>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Enter any custom brand hex code or use the color swatch to update <code className="font-mono text-[10px]">--primary-accent</code>.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="color"
                  value={customHexInput.startsWith('#') ? customHexInput : `#${customHexInput}`}
                  onChange={(e) => {
                    setCustomHexInput(e.target.value);
                    handleApplyCustomHex(e.target.value);
                  }}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-300 p-0.5 bg-white shrink-0"
                  title="Choose custom color"
                />
                <input
                  type="text"
                  value={customHexInput}
                  onChange={(e) => setCustomHexInput(e.target.value)}
                  placeholder="#9f1239"
                  className="w-28 p-2 rounded-lg border border-gray-300 font-mono text-xs bg-white text-gray-800 uppercase focus:ring-2 focus:ring-gray-400 outline-none"
                />
                <button
                  onClick={() => handleApplyCustomHex(customHexInput)}
                  className="px-3.5 py-2 rounded-lg font-bold text-xs text-white cursor-pointer shadow-xs transition-opacity shrink-0"
                  style={{ backgroundColor: currentPrimaryColor }}
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Live Interactive CSS Variable Preview Widget */}
            <div className="p-5 rounded-2xl border border-gray-200 bg-white flex flex-col gap-4">
              <div>
                <span className="text-[11px] font-bold font-mono-caps text-gray-400 uppercase tracking-wider">
                  Live UI Component Test Preview (Using var(--primary-accent))
                </span>
                <p className="text-xs text-gray-500 mt-0.5">
                  See how all 14 salon category templates render this accent on buttons, badges, prices, and highlights:
                </p>
              </div>

              <div 
                className="p-6 rounded-xl border border-dashed border-gray-300 bg-slate-50 flex flex-wrap items-center justify-around gap-6"
                style={{
                  '--primary-accent': currentPrimaryColor,
                  '--theme-primary': currentPrimaryColor,
                } as React.CSSProperties}
              >
                {/* 1. Primary Action Button */}
                <button
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-xs flex items-center gap-1.5 cursor-pointer hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: 'var(--primary-accent)' }}
                >
                  <span className="material-symbols-outlined text-sm">calendar_month</span>
                  <span>Book Appointment</span>
                </button>

                {/* 2. Active Tab Pill */}
                <div 
                  className="px-4 py-1.5 rounded-full text-xs font-bold text-white shadow-xs flex items-center gap-1"
                  style={{ backgroundColor: 'var(--primary-accent)' }}
                >
                  <span>Signature Treatments</span>
                  <span className="text-[10px] font-mono">✓</span>
                </div>

                {/* 3. Transparent Tag Chip */}
                <div 
                  className="px-3 py-1 rounded-md text-xs font-mono font-bold"
                  style={{ 
                    backgroundColor: `${currentPrimaryColor}18`, 
                    color: 'var(--primary-accent)' 
                  }}
                >
                  Bridal & Makeover
                </div>

                {/* 4. Pricing Highlight */}
                <div className="text-center">
                  <div className="text-[10px] font-mono text-gray-400">Treatment Price</div>
                  <div 
                    className="font-mono text-xl font-extrabold"
                    style={{ color: 'var(--primary-accent)' }}
                  >
                    ₹3,800
                  </div>
                </div>

                {/* 5. Rating Badge */}
                <div 
                  className="px-3 py-1 rounded-lg text-white font-mono text-xs font-bold flex items-center gap-1 shadow-xs"
                  style={{ backgroundColor: 'var(--primary-accent)' }}
                >
                  <span>★ 4.95 / 5.0</span>
                </div>
              </div>

              <div className="text-[11px] text-gray-500 italic text-center">
                ✓ Changes to <code className="font-mono font-bold text-gray-700">--primary-accent</code> propagate immediately to all 14 category templates (Bridal, Barbershop, Ayurvedic Spa, Hair Studio, Nail Bar, Skincare, Tattoo, etc.)
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: SALON DETAILS (FORM) */}
        {activeTab === 'website' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
            <div>
              <div className="flex items-center gap-2 text-gray-900">
                <span className="material-symbols-outlined text-2xl" style={{ color: currentPrimaryColor }}>storefront</span>
                <h2 className="font-display font-bold text-xl text-gray-900">
                  Salon Profile & Business Details
                </h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Essential business details displayed across your live salon website, click-to-call links, and WhatsApp bookings.
              </p>
            </div>

            {/* Core Salon Information Form */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Salon Brand Name
                </label>
                <input
                  type="text"
                  value={profile.businessName}
                  onChange={(e) => setProfile((prev) => ({ ...prev, businessName: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Tagline / Catchphrase
                </label>
                <input
                  type="text"
                  value={profile.tagline}
                  onChange={(e) => setProfile((prev) => ({ ...prev, tagline: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Phone (Direct Click-to-Call)
                </label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs font-mono focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  WhatsApp Number
                </label>
                <input
                  type="text"
                  value={profile.whatsapp}
                  onChange={(e) => setProfile((prev) => ({ ...prev, whatsapp: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs font-mono focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Salon Address
                </label>
                <input
                  type="text"
                  value={profile.address}
                  onChange={(e) => setProfile((prev) => ({ ...prev, address: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  City & State
                </label>
                <input
                  type="text"
                  value={profile.city}
                  onChange={(e) => setProfile((prev) => ({ ...prev, city: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Postal PIN Code
                </label>
                <input
                  type="text"
                  value={profile.postalCode}
                  onChange={(e) => setProfile((prev) => ({ ...prev, postalCode: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs font-mono focus:ring-2 focus:ring-gray-400 outline-none"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
              <span className="font-medium">
                ✓ Changes update automatically in live preview and across all 14 category templates.
              </span>
              <span className="font-mono text-[11px] font-bold bg-emerald-100 px-2 py-0.5 rounded">
                Live Synced
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
