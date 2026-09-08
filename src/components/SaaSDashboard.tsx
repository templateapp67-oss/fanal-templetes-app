import React, { useState } from 'react';
import { SalonProfile, SalonService, Stylist, Appointment, AppointmentStatus, ClientRecord, LoyaltyConfig } from '../types';
import { ACCENT_PALETTES, AccentPaletteKey, applyPrimaryAccentCssVar, getContrastTextColor, getLuminance } from '../themeAccents';
import { validateAndReadImageFile, compressAndResizeImage } from '../utils/imageUploadHelper';
import { ImageCompressorWidget } from './ImageCompressorWidget';
import { TeamManagement } from './TeamManagement';
import { ServiceManagement } from './ServiceManagement';
import { PromoStudio } from './PromoStudio';
import { LoyaltyManagement } from './LoyaltyManagement';
import { SocialConnectivityStep } from './SocialConnectivityStep';
import { LoyaltyTierProgressBar } from './LoyaltyTierProgressBar';
import { TopClientsLoyaltyChart } from './TopClientsLoyaltyChart';
import { DEFAULT_LOYALTY_CONFIG, TIER_METADATA, calculateLoyaltyTier, calculateRewardProgress, calculateTierProgress } from '../loyaltyData';
import { getSiteUrl } from '../lib/salonStore';

import { BookingManager } from './BookingManager';
import { BookingStatusBadge } from './BookingStatusBadge';
import { GuestModeBanner } from './GuestModeBanner';
import { AIClientReengagement } from './AIClientReengagement';
import { PromotionalBannerConfigSection } from './PromotionalBannerConfigSection';
import { BackupManagerModal } from './BackupManagerModal';
import { TikTokIcon } from './TikTokIcon';
import { formatInstagramUrl, formatFacebookUrl, formatTikTokUrl, displaySocialHandle } from '../utils/social';

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
  onNavigateToEditor?: () => void;
  siteUrl?: string;
  isAuthenticated?: boolean;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
}

type TabType = 'overview' | 'calendar' | 'services' | 'team' | 'clients' | 'loyalty' | 'reengagement' | 'marketing' | 'promobanner' | 'social_connectivity' | 'appearance' | 'website';

export const SaaSDashboard: React.FC<SaaSDashboardProps> = ({
  profile,
  setProfile,
  services,
  setServices,
  stylists,
  setStylists,
  appointments,
  setAppointments,
  clients,
  setClients = (_clients: React.SetStateAction<ClientRecord[]>) => {},
  loyaltyConfig: externalLoyaltyConfig,
  setLoyaltyConfig: externalSetLoyaltyConfig,
  onNavigateToPreview,
  onNavigateToEditor,
  siteUrl,
  isAuthenticated = true,
  onRequireAuth,
}) => {
  const [internalLoyaltyConfig, setInternalLoyaltyConfig] = useState<LoyaltyConfig>(DEFAULT_LOYALTY_CONFIG);
  const loyaltyConfig = externalLoyaltyConfig || internalLoyaltyConfig;
  const setLoyaltyConfig = externalSetLoyaltyConfig || setInternalLoyaltyConfig;

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [dashboardTierClientSearch, setDashboardTierClientSearch] = useState<string>('');
  const [dashboardTierFilter, setDashboardTierFilter] = useState<string>('all');
  const [marketingSms, setMarketingSms] = useState<string>('');
  const [marketingLoading, setMarketingLoading] = useState<boolean>(false);
  const [smsSentNotice, setSmsSentNotice] = useState<string>('');

  const currentAccentKey: AccentPaletteKey = (profile.themeAccentKey as AccentPaletteKey) || 'slate';
  const currentPalette = ACCENT_PALETTES[currentAccentKey] || ACCENT_PALETTES.slate;
  const currentPrimaryColor = profile.customAccentColor || currentPalette.primaryHex;

  const [customHexInput, setCustomHexInput] = useState<string>(currentPrimaryColor);
  const [accentAppliedFeedback, setAccentAppliedFeedback] = useState<string>('');
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceSuccess, setAppearanceSuccess] = useState<string | null>(null);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAppearanceError(null);
    setAppearanceSuccess('Resizing & compressing logo...');
    const result = await compressAndResizeImage(file);
    if (!result.isValid) {
      setAppearanceError(result.errorMessage || 'Invalid image file.');
      setAppearanceSuccess(null);
      return;
    }

    if (result.dataUrl) {
      setProfile((prev) => ({
        ...prev,
        logoUrl: result.dataUrl,
      }));
      setAppearanceSuccess(`Logo optimized (${result.compressedSizeKb} KB, -${result.compressionRatio}%) & saved!`);
      setTimeout(() => setAppearanceSuccess(null), 4000);
    }
  };

  const handleHeroUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAppearanceError(null);
    setAppearanceSuccess('Resizing & compressing hero cover...');
    const result = await compressAndResizeImage(file);
    if (!result.isValid) {
      setAppearanceError(result.errorMessage || 'Invalid image file.');
      setAppearanceSuccess(null);
      return;
    }

    if (result.dataUrl) {
      setProfile((prev) => ({
        ...prev,
        coverImageUrl: result.dataUrl,
      }));
      setAppearanceSuccess(`Hero cover optimized (${result.compressedSizeKb} KB, -${result.compressionRatio}%) & saved!`);
      setTimeout(() => setAppearanceSuccess(null), 4000);
    }
  };

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
    // Updates the primary accent CSS variable across all 27 templates
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
    // Updates the primary accent CSS variable across all 27 templates
    applyPrimaryAccentCssVar(formatted);
    setCustomHexInput(formatted);
    setAccentAppliedFeedback(`Applied custom accent ${formatted} to CSS variable --primary-accent!`);
    setTimeout(() => setAccentAppliedFeedback(''), 4000);
  };

  const handleGenerateSms = () => {
    setMarketingLoading(true);
    const liveLink = siteUrl || getSiteUrl(profile);
    setTimeout(() => {
      setMarketingSms(
        `Namaste [Client Name]! We miss your glow at ${profile?.businessName || 'Arts By Uma'}. Book your favorite service this week and receive an exclusive complimentary treatment. Claim your slot: ${liveLink}`
      );
      setMarketingLoading(false);
    }, 1000);
  };

  const handleDownloadAppointmentsCSV = () => {
    if (!appointments || appointments.length === 0) {
      alert("No appointments available to export.");
      return;
    }

    const headers = [
      'Appointment ID',
      'Client Name',
      'Client Phone',
      'Service Name',
      'Service Price (INR)',
      'Stylist Name',
      'Date',
      'Time',
      'Payment Status',
      'Amount Paid (INR)',
      'Status'
    ];

    const rows = appointments.map((apt) => [
      `"${apt.id}"`,
      `"${(apt.clientName || '').replace(/"/g, '""')}"`,
      `"${(apt.clientPhone || '').replace(/"/g, '""')}"`,
      `"${(apt.serviceName || '').replace(/"/g, '""')}"`,
      apt.servicePrice || 0,
      `"${(apt.stylistName || '').replace(/"/g, '""')}"`,
      `"${apt.date || ''}"`,
      `"${apt.time || ''}"`,
      `"${apt.paymentStatus || ''}"`,
      apt.amountPaid || 0,
      `"${apt.status || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `salon_appointments_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Loyalty points are awarded inside the `completed` branch only, so widening
  // the accepted statuses to the full lifecycle cannot grant points for a
  // no-show or a cancellation.
  const updateAppointmentStatus = (id: string, status: AppointmentStatus) => {
    if (!isAuthenticated) {
      onRequireAuth?.('login');
      return;
    }
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
    if (!isAuthenticated) {
      onRequireAuth?.('login');
      return;
    }
    setSmsSentNotice('Campaign dispatched successfully via WhatsApp & SMS to 42 clients across India!');
    setTimeout(() => {
      setSmsSentNotice('');
    }, 4000);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 flex flex-col items-center bg-[#f9f9ff] text-[#151c27]">
      <div className="max-w-[1240px] w-full px-4 sm:px-6">
        
        {/* Guest Mode Read-Only Banner */}
        {!isAuthenticated && (
          <div className="mb-6">
            <GuestModeBanner
              title="Dashboard Demo / Guest Preview Mode"
              description="You are exploring the salon management dashboard in read-only guest preview. Log in or create an owner account to unlock full editing, booking status changes, and staff management."
              onRequireAuth={onRequireAuth}
            />
          </div>
        )}

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
                <h1 className="font-display text-2xl font-bold">{profile?.businessName || 'Our Salon'}</h1>
                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-mono-caps font-bold px-2 py-0.5 rounded-full">
                  LIVE SALON SITE
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <a 
                  href={siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline font-mono"
                >
                  {siteUrl}
                </a>
                <span className="text-xs text-gray-500 font-mono">• {profile?.city || 'India'}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(siteUrl);
                    alert("Website Link Copied: " + siteUrl);
                  }}
                  className="p-1 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                  title="Copy Website Link"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                </button>
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 transition-colors"
                  title="Open Live Site"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  <span>Open Site</span>
                </a>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsBackupModalOpen(true)}
              className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:border-slate-800 bg-white hover:bg-slate-50 text-slate-800 flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
              title="Download local JSON snapshot & backup"
              id="dashboard-header-backup-btn"
            >
              <span className="material-symbols-outlined text-sm text-slate-700">cloud_download</span>
              <span>Backup</span>
              <span className="bg-emerald-100 text-emerald-800 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-md">
                JSON
              </span>
            </button>

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
            { id: 'reengagement', label: 'AI Re-Engagement', icon: 'psychology' },
            { id: 'promobanner', label: 'Promo Banner', icon: 'campaign' },
            { id: 'marketing', label: 'Promo Studio', icon: 'photo_camera_back' },
            { id: 'social_connectivity', label: 'Social & Reels', icon: 'share' },
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
                {tab.id === 'reengagement' && (
                  <span className="bg-purple-100 text-purple-800 border border-purple-300 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[10px]">auto_awesome</span>
                    <span>AI</span>
                  </span>
                )}
                {tab.id === 'promobanner' && (
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full border ${
                    profile.promotionalBanner?.enabled !== false
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  }`}>
                    {profile.promotionalBanner?.enabled !== false ? 'Active' : 'Off'}
                  </span>
                )}
                {tab.id === 'loyalty' && (
                  <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full">
                    {loyaltyConfig.rewards.filter((r) => r.isActive).length} Perks
                  </span>
                )}
                {tab.id === 'marketing' && (
                  <span className="bg-gradient-to-r from-pink-500 to-rose-500 text-white text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full">
                    Creative
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

            {/* DATA VISUALIZATION: TOP CLIENTS LOYALTY TIER DISTRIBUTION BAR CHART */}
            <TopClientsLoyaltyChart
              clients={clients}
              appointments={appointments}
              loyaltyConfig={loyaltyConfig}
              primaryAccentColor={currentPrimaryColor}
              onSelectClient={(client) => {
                setDashboardTierClientSearch(client.name);
                setActiveTab('clients');
              }}
              onNavigateToLoyalty={() => setActiveTab('loyalty')}
            />

            {/* GEMINI AI CLIENT RE-ENGAGEMENT PROACTIVE BANNER */}
            <div className="bg-gradient-to-r from-purple-900 via-indigo-950 to-slate-900 rounded-2xl p-5 text-white shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center shrink-0 text-purple-300">
                  <span className="material-symbols-outlined text-2xl">psychology</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base text-white">
                      Gemini Client Retention & Re-Engagement Intelligence
                    </span>
                    <span className="bg-purple-500/30 text-purple-200 border border-purple-400/40 text-[10px] font-mono-caps font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">auto_awesome</span>
                      <span>AI Proactive Offer Engine</span>
                    </span>
                  </div>
                  <p className="text-xs text-purple-200/80 mt-1 max-w-2xl">
                    4+ inactive clients identified past their regular service cycle. Generate personalized promotional offers and WhatsApp comeback messages to recover ~₹38,000 in appointments.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveTab('reengagement')}
                className="px-4 py-2.5 rounded-xl bg-white hover:bg-purple-50 text-purple-950 font-bold text-xs shadow-md flex items-center gap-2 shrink-0 cursor-pointer transition-transform hover:scale-[1.02]"
                id="overview-launch-reengagement-btn"
              >
                <span className="material-symbols-outlined text-sm text-purple-600">auto_awesome</span>
                <span>Review AI Re-Engagement Offers</span>
                <span className="material-symbols-outlined text-xs">arrow_forward</span>
              </button>
            </div>

            {/* Upcoming Appointments Table */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 border-b border-gray-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-bold text-lg text-gray-900">Confirmed Client Appointments</h2>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {appointments.length} Records
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">Currency: INR (₹)</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadAppointmentsCSV}
                    className="text-xs font-bold px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    title="Download appointments list as CSV"
                    id="download-appointments-csv-btn"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    <span>Download CSV</span>
                  </button>
                </div>
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
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => updateAppointmentStatus(apt.id, 'completed')}
                                className="text-xs bg-emerald-600 text-white font-bold px-2.5 py-1 rounded hover:bg-emerald-700 cursor-pointer"
                              >
                                Complete
                              </button>
                              {/* No-show is not a cancellation: the advance is
                                  forfeited rather than refunded, and no loyalty
                                  points are earned. It needs its own action. */}
                              <button
                                onClick={() => updateAppointmentStatus(apt.id, 'no_show')}
                                className="text-xs bg-orange-100 text-orange-700 font-bold px-2.5 py-1 rounded hover:bg-orange-200 cursor-pointer"
                              >
                                No-show
                              </button>
                            </div>
                          ) : (
                            // Was a bare "Done" for every non-confirmed row, so
                            // a cancelled booking and a no-show both read Done.
                            <BookingStatusBadge status={apt.status} compact />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CLIENT LOYALTY TIER PROGRESSION & VIP LEADERBOARD */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                      <span className="material-symbols-outlined text-lg">military_tech</span>
                    </span>
                    <h2 className="font-display font-bold text-lg text-gray-900">
                      Client Loyalty Tier Progression
                    </h2>
                    <span className="bg-amber-100 text-amber-900 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-amber-300">
                      Live VIP Tiers
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Visual tracker showing how close clients are to leveling up to their next loyalty tier (Silver, Gold, Platinum VIP).
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('loyalty')}
                    className="text-xs font-bold px-3.5 py-2 rounded-xl text-white shadow-xs flex items-center gap-1.5 cursor-pointer hover:opacity-95"
                    style={{ backgroundColor: currentPrimaryColor }}
                  >
                    <span className="material-symbols-outlined text-sm">tune</span>
                    <span>Manage Loyalty Program</span>
                  </button>
                </div>
              </div>

              {/* TIER DISTRIBUTION SUMMARY PILLS */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(['bronze', 'silver', 'gold', 'platinum'] as const).map((t) => {
                  const meta = TIER_METADATA[t];
                  const count = clients.filter(
                    (c) => (c.loyaltyTier || calculateLoyaltyTier(c.lifetimePoints || 0, loyaltyConfig.tierThresholds)) === t
                  ).length;
                  const isSelected = dashboardTierFilter === t;

                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDashboardTierFilter(isSelected ? 'all' : t)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? `${meta.badgeBg} ${meta.borderColor} ring-2 ring-amber-400 shadow-xs font-bold`
                          : 'bg-gray-50/70 border-gray-200 hover:bg-gray-100/80 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-base">{meta.icon}</span>
                        <div>
                          <div className="text-xs font-bold">{meta.name.split(' ')[0]}</div>
                          <div className="text-[10px] opacity-75 font-mono">
                            {loyaltyConfig.tierThresholds[t]} pts ({loyaltyConfig.tierMultipliers[t]}x)
                          </div>
                        </div>
                      </div>
                      <div className="font-mono font-extrabold text-base">{count}</div>
                    </button>
                  );
                })}
              </div>

              {/* SEARCH & FILTER BAR */}
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-sm">search</span>
                  <input
                    type="text"
                    value={dashboardTierClientSearch}
                    onChange={(e) => setDashboardTierClientSearch(e.target.value)}
                    placeholder="Search client by name or phone..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-gray-300 text-xs bg-gray-50 focus:bg-white focus:ring-2 focus:ring-gray-300 outline-none"
                  />
                </div>

                <div className="text-[11px] text-gray-500 font-mono">
                  Showing {
                    clients.filter((c) => {
                      const matchesQuery =
                        c.name.toLowerCase().includes(dashboardTierClientSearch.toLowerCase()) ||
                        c.phone.includes(dashboardTierClientSearch);
                      const t = c.loyaltyTier || calculateLoyaltyTier(c.lifetimePoints || 0, loyaltyConfig.tierThresholds);
                      const matchesFilter = dashboardTierFilter === 'all' || t === dashboardTierFilter;
                      return matchesQuery && matchesFilter;
                    }).length
                  } of {clients.length} clients
                </div>
              </div>

              {/* CLIENTS TIER PROGRESS BARS GRID */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clients
                  .filter((c) => {
                    const matchesQuery =
                      c.name.toLowerCase().includes(dashboardTierClientSearch.toLowerCase()) ||
                      c.phone.includes(dashboardTierClientSearch);
                    const t = c.loyaltyTier || calculateLoyaltyTier(c.lifetimePoints || 0, loyaltyConfig.tierThresholds);
                    const matchesFilter = dashboardTierFilter === 'all' || t === dashboardTierFilter;
                    return matchesQuery && matchesFilter;
                  })
                  .map((client) => {
                    const lifetimePts = client.lifetimePoints || client.points || 0;
                    return (
                      <div
                        key={client.id}
                        className="p-4 rounded-xl border border-gray-200 bg-white hover:border-amber-300 hover:shadow-xs transition-all flex flex-col justify-between gap-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-sm text-gray-900">{client.name}</span>
                            <div className="text-[11px] text-gray-500 font-mono">{client.phone}</div>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-bold text-amber-800 text-xs">
                              {client.points || 0} pts balance
                            </span>
                            <div className="text-[10px] text-gray-400 font-mono">
                              {client.totalVisits} visits • ₹{client.totalSpent.toLocaleString('en-IN')}
                            </div>
                          </div>
                        </div>

                        {/* Visual Progress Bar to Next Loyalty Tier */}
                        <LoyaltyTierProgressBar
                          lifetimePoints={lifetimePts}
                          currentPoints={client.points}
                          tierThresholds={loyaltyConfig.tierThresholds}
                          tierMultipliers={loyaltyConfig.tierMultipliers}
                          variant="standard"
                          showPerks={true}
                        />

                        <div className="flex justify-between items-center text-[10px] text-gray-400 pt-1 border-t border-gray-100">
                          <span>Stylist: {client.favoriteStylist}</span>
                          <button
                            type="button"
                            onClick={() => setActiveTab('loyalty')}
                            className="text-purple-700 hover:text-purple-900 font-bold flex items-center gap-0.5 cursor-pointer"
                          >
                            <span>Manage in CRM</span>
                            <span className="material-symbols-outlined text-xs">arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* SALON DATA SAFETY & BACKUP SNAPSHOT CARD */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-5 md:p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-slate-700">
              <div className="flex items-start gap-3.5">
                <div 
                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-md"
                  style={{ backgroundColor: currentPrimaryColor }}
                >
                  <span className="material-symbols-outlined text-2xl">cloud_download</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-bold text-base text-white">
                      Salon Configuration &amp; Snapshot Backup
                    </h3>
                    <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full">
                      Offline JSON
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5 max-w-xl">
                    Save a full snapshot of your salon profile, {services.length} services, {stylists.length} stylists, and loyalty tiers as a downloadable <code className="font-mono text-emerald-400 bg-slate-950 px-1 py-0.5 rounded text-[11px]">.json</code> file.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <button
                  type="button"
                  onClick={() => setIsBackupModalOpen(true)}
                  className="w-full md:w-auto px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-extrabold text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-transform hover:scale-[1.02]"
                  id="overview-open-backup-btn"
                >
                  <span className="material-symbols-outlined text-base">download</span>
                  <span>Trigger Backup Snapshot</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: APPOINTMENTS */}
        {activeTab === 'calendar' && (
          <BookingManager
            primaryAccentColor={currentPrimaryColor}
            ownerId={profile.ownerId}
            subdomain={profile.subdomain}
            isAuthenticated={isAuthenticated}
            onRequireAuth={onRequireAuth}
          />
        )}

        {/* TAB CONTENT: SERVICES */}
        {activeTab === 'services' && (
          <ServiceManagement
            services={services}
            setServices={setServices}
            primaryAccentColor={currentPrimaryColor}
            profile={profile}
            onNavigateToPreview={onNavigateToPreview}
            isAuthenticated={isAuthenticated}
            onRequireAuth={onRequireAuth}
          />
        )}

        {/* TAB CONTENT: TEAM MANAGEMENT */}
        {activeTab === 'team' && (
          <TeamManagement
            stylists={stylists}
            setStylists={setStylists}
            primaryAccentColor={currentPrimaryColor}
            services={services}
            onNavigateToPreview={onNavigateToPreview}
            isAuthenticated={isAuthenticated}
            onRequireAuth={onRequireAuth}
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

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveTab('reengagement')}
                  className="text-xs font-bold px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-sm text-purple-600">psychology</span>
                  <span>AI Re-Engagement (Gemini)</span>
                </button>

                <button
                  onClick={() => setActiveTab('loyalty')}
                  className="text-xs font-bold px-4 py-2 rounded-xl text-white shadow-xs flex items-center gap-1.5 cursor-pointer hover:opacity-95 transition-opacity"
                  style={{ backgroundColor: currentPrimaryColor }}
                >
                  <span className="material-symbols-outlined text-sm">military_tech</span>
                  <span>Loyalty Hub</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((cli) => {
                const tier = cli.loyaltyTier || calculateLoyaltyTier(cli.lifetimePoints || 0, loyaltyConfig.tierThresholds);
                const tierMeta = TIER_METADATA[tier];
                const lifetimePts = cli.lifetimePoints || cli.points || 0;
                const { nextReward, pointsNeeded, progressPercentage, unlockedRewards } = calculateRewardProgress(
                  cli.points || 0,
                  loyaltyConfig.rewards
                );

                return (
                  <div 
                    key={cli.id} 
                    className="p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 shadow-xs flex flex-col justify-between gap-3 text-xs"
                  >
                    <div className="flex flex-col gap-3">
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
                        <div className="text-gray-600 italic bg-gray-50 p-2 rounded-lg border border-gray-100 text-[11px]">
                          "{cli.notes}"
                        </div>
                      )}

                      {/* Visual Loyalty Tier Progress Bar */}
                      <LoyaltyTierProgressBar
                        lifetimePoints={lifetimePts}
                        currentPoints={cli.points}
                        tierThresholds={loyaltyConfig.tierThresholds}
                        tierMultipliers={loyaltyConfig.tierMultipliers}
                        variant="standard"
                        showPerks={true}
                      />

                      {/* Next Reward Milestone Chip */}
                      <div className="p-2 rounded-lg border border-purple-200 bg-purple-50/60 flex items-center justify-between text-[11px]">
                        <span className="font-bold text-purple-900 flex items-center gap-1 truncate max-w-[180px]">
                          <span className="material-symbols-outlined text-xs text-purple-600">redeem</span>
                          <span>{nextReward ? nextReward.title : 'All Rewards Unlocked'}</span>
                        </span>
                        {nextReward ? (
                          <span className="font-mono font-bold text-purple-800 text-[10px] shrink-0">
                            {cli.points || 0}/{nextReward.requiredPoints} pts
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-700">Ready</span>
                        )}
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
            appointments={appointments}
            onNavigateToPreview={onNavigateToPreview}
          />
        )}

        {/* TAB CONTENT: AI CLIENT RETENTION & RE-ENGAGEMENT */}
        {activeTab === 'reengagement' && (
          <AIClientReengagement
            clients={clients}
            appointments={appointments}
            services={services}
            profile={profile}
            primaryAccentColor={currentPrimaryColor}
            isAuthenticated={isAuthenticated}
            onRequireAuth={onRequireAuth}
            onNavigateToPreview={onNavigateToPreview}
          />
        )}

        {/* TAB CONTENT: PROMOTIONAL HEADER BANNER CONFIGURATION */}
        {activeTab === 'promobanner' && (
          <PromotionalBannerConfigSection
            profile={profile}
            setProfile={setProfile}
            primaryAccentColor={currentPrimaryColor}
            onNavigateToPreview={onNavigateToPreview}
            isAuthenticated={isAuthenticated}
            onRequireAuth={onRequireAuth}
          />
        )}

        {/* TAB CONTENT: PROMO STUDIO & AI MARKETING */}
        {activeTab === 'marketing' && (
          <div className="flex flex-col gap-6">
            {/* Quick Promo Banner & Retention Jump Banners */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <span className="material-symbols-outlined text-xl">psychology</span>
                  </span>
                  <div>
                    <div className="font-bold text-sm text-purple-950 flex items-center gap-1.5">
                      <span>AI Re-Engagement Hub</span>
                      <span className="bg-purple-200 text-purple-900 text-[9px] font-mono-caps font-bold px-1.5 py-0.2 rounded-full">
                        AI
                      </span>
                    </div>
                    <p className="text-xs text-purple-700 mt-0.5 line-clamp-1">
                      Target overdue clients with 1-click WhatsApp offers.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('reengagement')}
                  className="px-3.5 py-2 rounded-xl bg-purple-900 hover:bg-purple-950 text-white font-bold text-xs shadow-xs flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                >
                  <span>Open Hub</span>
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-amber-500 text-amber-950 flex items-center justify-center shrink-0 shadow-xs">
                    <span className="material-symbols-outlined text-xl">campaign</span>
                  </span>
                  <div>
                    <div className="font-bold text-sm text-amber-950 flex items-center gap-1.5">
                      <span>Header Promo Banner</span>
                      <span className="bg-amber-200 text-amber-950 text-[9px] font-mono-caps font-bold px-1.5 py-0.2 rounded-full">
                        {profile.promotionalBanner?.enabled !== false ? 'Live' : 'Off'}
                      </span>
                    </div>
                    <p className="text-xs text-amber-800/80 mt-0.5 line-clamp-1">
                      Custom announcement, discount codes & CTA bar.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('promobanner')}
                  className="px-3.5 py-2 rounded-xl bg-amber-900 hover:bg-amber-950 text-white font-bold text-xs shadow-xs flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                >
                  <span>Edit Banner</span>
                </button>
              </div>
            </div>

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

        {/* TAB CONTENT: STEP 06 • SOCIAL CONNECTIVITY */}
        {activeTab === 'social_connectivity' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
            <SocialConnectivityStep
              profile={profile}
              setProfile={setProfile}
              onContinue={onNavigateToPreview}
            />
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
                    Appearance & Brand Media
                  </h2>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Customize your salon's brand assets and accent palette. Upload custom logos and hero cover banners (converted to data URLs and saved to localStorage), or pick a Theme Accent color (<code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 font-mono text-[11px]">--primary-accent</code>) used across all 27 templates.
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

            {/* BRAND MEDIA ASSETS: CUSTOM LOGO & HERO IMAGE UPLOAD */}
            <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50/70 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-600 text-xl">add_photo_alternate</span>
                    <h3 className="font-display font-bold text-base text-gray-900">
                      Brand Media Assets (Custom Logo & Hero Image)
                    </h3>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Upload your salon's custom Logo or Hero Cover Image (Max 5MB per file). Images are validated, converted to Data URLs, and saved in your salon profile in localStorage.
                  </p>
                </div>
              </div>

              {/* Error and Success Feedback Alerts */}
              {appearanceError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl flex items-center justify-between text-xs font-medium">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-rose-600 text-base">error</span>
                    <span>{appearanceError}</span>
                  </div>
                  <button onClick={() => setAppearanceError(null)} className="text-rose-500 hover:text-rose-800 text-xs font-bold cursor-pointer">
                    Dismiss
                  </button>
                </div>
              )}

              {appearanceSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl flex items-center gap-2 text-xs font-bold animate-fade-in">
                  <span className="material-symbols-outlined text-emerald-600 text-base">check_circle</span>
                  <span>{appearanceSuccess}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Custom Logo Upload Card */}
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-purple-600">image</span>
                        <span>Salon Header Logo</span>
                      </span>
                      {profile.logoUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setProfile((prev) => ({
                              ...prev,
                              logoUrl: undefined,
                            }));
                            setAppearanceSuccess('Custom header logo cleared.');
                            setTimeout(() => setAppearanceSuccess(null), 3000);
                          }}
                          className="text-[11px] text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                        >
                          Remove Logo
                        </button>
                      )}
                    </div>

                    <div className="h-24 rounded-lg bg-gray-50 border border-dashed border-gray-300 flex items-center justify-center p-2 relative overflow-hidden">
                      {profile.logoUrl ? (
                        <img
                          src={profile.logoUrl}
                          alt="Salon Logo Preview"
                          className="max-h-20 max-w-full object-contain"
                        />
                      ) : (
                        <div className="text-center text-gray-400 text-xs">
                          <span className="material-symbols-outlined text-2xl block text-gray-300">storefront</span>
                          <span>No custom logo uploaded yet</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="w-full py-2.5 px-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs">
                      <span className="material-symbols-outlined text-sm">upload_file</span>
                      <span>Upload Custom Logo (Max 5MB)</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[10px] text-gray-400 text-center mt-1">
                      Validated (&lt;5MB), converted to Data URL & saved in localStorage
                    </p>
                  </div>
                </div>

                {/* 2. Custom Hero Image Upload Card */}
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-purple-600">photo_library</span>
                        <span>Hero Cover Banner</span>
                      </span>
                    </div>

                    <div className="h-24 rounded-lg bg-gray-900 border border-gray-200 flex items-center justify-center relative overflow-hidden">
                      <img
                        src={profile.coverImageUrl}
                        alt="Hero Banner Preview"
                        className="w-full h-full object-cover opacity-80"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-2">
                        <span className="text-[10px] text-white font-mono font-bold truncate">Active Hero Cover Image</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="w-full py-2.5 px-3 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs">
                      <span className="material-symbols-outlined text-sm">upload_file</span>
                      <span>Upload Custom Hero Banner (Max 5MB)</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleHeroUpload}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[10px] text-gray-400 text-center mt-1">
                      Validated (&lt;5MB), converted to Data URL & saved in localStorage
                    </p>
                  </div>
                </div>
              </div>

              {/* Real-time Browser-based Image Compression Hub */}
              <div className="mt-4">
                <ImageCompressorWidget
                  onApplyLogo={(url) => {
                    setProfile((prev) => ({ ...prev, logoUrl: url }));
                    setAppearanceSuccess('Optimized image applied as custom logo!');
                    setTimeout(() => setAppearanceSuccess(null), 4000);
                  }}
                  onApplyCover={(url) => {
                    setProfile((prev) => ({ ...prev, coverImageUrl: url }));
                    setAppearanceSuccess('Optimized image applied as custom cover banner!');
                    setTimeout(() => setAppearanceSuccess(null), 4000);
                  }}
                  themePrimaryColor={currentPrimaryColor}
                />
              </div>
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
                  '--accent-luminance': getLuminance(currentPrimaryColor).toFixed(4),
                  '--accent-text-color': getContrastTextColor(currentPrimaryColor),
                  '--accent-contrast-text': getContrastTextColor(currentPrimaryColor),
                } as React.CSSProperties}
              >
                {/* 1. Primary Action Button */}
                <button
                  className="px-5 py-2.5 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: 'var(--primary-accent)', color: 'var(--accent-text-color, #ffffff)' }}
                >
                  <span className="material-symbols-outlined text-sm">calendar_month</span>
                  <span>Book Appointment</span>
                </button>

                {/* 2. Active Tab Pill */}
                <div 
                  className="px-4 py-1.5 rounded-full text-xs font-bold shadow-xs flex items-center gap-1"
                  style={{ backgroundColor: 'var(--primary-accent)', color: 'var(--accent-text-color, #ffffff)' }}
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
                  Salon Info
                </h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                All website details (brand, contact, services, pricing, timings) are managed in one place — the Website Editor.
              </p>
            </div>

            {/* Read-only summary + link to the single unified editor */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold font-mono-caps mb-1">
                  <span className="material-symbols-outlined text-base" style={{ color: currentPrimaryColor }}>storefront</span>
                  Salon
                </div>
                <div className="font-bold text-gray-900 truncate">{profile.businessName || '—'}</div>
                <div className="text-[11px] text-gray-500 mt-1 truncate">{profile.tagline || ''}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold font-mono-caps mb-1">
                  <span className="material-symbols-outlined text-base" style={{ color: currentPrimaryColor }}>call</span>
                  Contact
                </div>
                <div className="font-bold text-gray-900 font-mono">{profile.phone || '—'}</div>
                <div className="text-[11px] text-gray-500 mt-1">WhatsApp: {profile.whatsapp || '—'}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold font-mono-caps mb-1">
                  <span className="material-symbols-outlined text-base" style={{ color: currentPrimaryColor }}>location_on</span>
                  Location
                </div>
                <div className="text-[12px] font-medium text-gray-800">
                  {profile.address && <span>{profile.address}<br /></span>}
                  {profile.city && <span>{profile.city}{profile.postalCode ? ` — ${profile.postalCode}` : ''}</span>}
                  {!profile.address && !profile.city && <span>—</span>}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold font-mono-caps mb-1">
                  <span className="material-symbols-outlined text-base" style={{ color: currentPrimaryColor }}>link</span>
                  Live Website
                </div>
                <div className="font-mono text-[12px] font-bold text-gray-900 truncate">{siteUrl || '—'}</div>
              </div>
            </div>

            {/* SOCIAL MEDIA LINKS SECTION */}
            <div className="border-t border-gray-100 pt-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ color: currentPrimaryColor }}>share</span>
                    <h3 className="font-display font-bold text-base text-gray-900">
                      Social Media
                    </h3>
                    <span className="bg-pink-50 text-pink-700 border border-pink-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full">
                      Displayed on Website Header
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Add your Instagram, Facebook, and TikTok links so clients can connect with your salon and explore your work directly from your website header.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="salon-social-media-inputs">
                {/* 1. INSTAGRAM */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-pink-300 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold font-mono-caps text-gray-800 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-md bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white flex items-center justify-center text-xs shadow-2xs">
                        <span className="material-symbols-outlined text-[13px]">photo_camera</span>
                      </span>
                      <span>Instagram</span>
                    </label>
                    {profile.instagramHandle && (
                      <a
                        href={formatInstagramUrl(profile.instagramHandle)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-bold text-pink-600 hover:text-pink-800 hover:underline flex items-center gap-0.5"
                        title="Open in Instagram"
                      >
                        <span>Test Link</span>
                        <span className="material-symbols-outlined text-xs">open_in_new</span>
                      </a>
                    )}
                  </div>
                  <input
                    type="text"
                    value={profile.instagramHandle || ''}
                    onChange={(e) => setProfile((prev) => ({ ...prev, instagramHandle: e.target.value }))}
                    placeholder="e.g. @arts_by_uma or url"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 outline-none font-mono"
                    id="salon-info-instagram-input"
                  />
                  <div className="text-[10px] text-gray-400 mt-1.5 flex items-center justify-between">
                    <span>Handle or profile link</span>
                    {profile.instagramHandle && (
                      <span className="text-pink-600 font-mono font-medium truncate max-w-[150px]">
                        {displaySocialHandle(profile.instagramHandle)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. FACEBOOK */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-blue-300 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold font-mono-caps text-gray-800 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs shadow-2xs font-bold">
                        f
                      </span>
                      <span>Facebook</span>
                    </label>
                    {profile.facebookPage && (
                      <a
                        href={formatFacebookUrl(profile.facebookPage)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                        title="Open in Facebook"
                      >
                        <span>Test Link</span>
                        <span className="material-symbols-outlined text-xs">open_in_new</span>
                      </a>
                    )}
                  </div>
                  <input
                    type="text"
                    value={profile.facebookPage || ''}
                    onChange={(e) => setProfile((prev) => ({ ...prev, facebookPage: e.target.value }))}
                    placeholder="e.g. https://facebook.com/salon"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-mono"
                    id="salon-info-facebook-input"
                  />
                  <div className="text-[10px] text-gray-400 mt-1.5 flex items-center justify-between">
                    <span>Page URL or name</span>
                    {profile.facebookPage && (
                      <span className="text-blue-600 font-mono font-medium truncate max-w-[150px]">
                        {displaySocialHandle(profile.facebookPage, '')}
                      </span>
                    )}
                  </div>
                </div>

                {/* 3. TIKTOK */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-slate-800 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold font-mono-caps text-gray-800 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-md bg-slate-900 text-white flex items-center justify-center text-xs shadow-2xs">
                        <TikTokIcon className="w-3.5 h-3.5 text-cyan-300" />
                      </span>
                      <span>TikTok</span>
                    </label>
                    {(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl) && (
                      <a
                        href={formatTikTokUrl(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-bold text-slate-900 hover:text-cyan-600 hover:underline flex items-center gap-0.5"
                        title="Open in TikTok"
                      >
                        <span>Test Link</span>
                        <span className="material-symbols-outlined text-xs">open_in_new</span>
                      </a>
                    )}
                  </div>
                  <input
                    type="text"
                    value={profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProfile((prev) => ({ 
                        ...prev, 
                        tiktokProfile: val, 
                        tiktokHandle: val, 
                        tiktokUrl: val 
                      }));
                    }}
                    placeholder="e.g. @artsbyuma or url"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-none font-mono"
                    id="salon-info-tiktok-input"
                  />
                  <div className="text-[10px] text-gray-400 mt-1.5 flex items-center justify-between">
                    <span>Handle or TikTok link</span>
                    {(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl) && (
                      <span className="text-slate-800 font-mono font-medium truncate max-w-[150px]">
                        {displaySocialHandle(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* LIVE WEBSITE HEADER PREVIEW STRIP */}
              <div className="mt-4 p-3.5 rounded-xl bg-slate-900 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div 
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white text-xs shadow-2xs"
                    style={{ backgroundColor: currentPrimaryColor }}
                  >
                    <span className="material-symbols-outlined text-sm">storefront</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block font-mono">Website Header Preview:</span>
                    <span className="font-bold text-white text-xs">
                      {profile.businessName || 'Salon Brand'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                  <span className="text-[11px] text-slate-400 font-mono mr-1">Header Socials:</span>
                  {profile.instagramHandle ? (
                    <span 
                      className="w-6 h-6 rounded-md bg-gradient-to-tr from-amber-500 to-pink-600 text-white flex items-center justify-center text-xs shadow-2xs"
                      title={`Instagram: ${profile.instagramHandle}`}
                    >
                      <span className="material-symbols-outlined text-[13px]">photo_camera</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 italic">No Instagram</span>
                  )}
                  {profile.facebookPage ? (
                    <span 
                      className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs shadow-2xs font-bold"
                      title={`Facebook: ${profile.facebookPage}`}
                    >
                      f
                    </span>
                  ) : null}
                  {(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl) ? (
                    <span 
                      className="w-6 h-6 rounded-md bg-slate-950 text-cyan-300 border border-slate-700 flex items-center justify-center text-xs shadow-2xs"
                      title="TikTok Active"
                    >
                      <TikTokIcon className="w-3.5 h-3.5" />
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={onNavigateToEditor}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">edit</span>
                <span>Open Website Editor</span>
              </button>
              {onNavigateToPreview && (
                <button
                  type="button"
                  onClick={onNavigateToPreview}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">visibility</span>
                  <span>View Live Preview</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsBackupModalOpen(true)}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                title="Create a local offline JSON backup of your salon configuration"
              >
                <span className="material-symbols-outlined text-lg text-slate-700">cloud_download</span>
                <span>Backup &amp; Snapshot</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
              <span className="font-medium">
                ✓ All website details and social links live in one place. Every change is auto-saved &amp; synced to the live website header.
              </span>
              <span className="font-mono text-[11px] font-bold bg-emerald-100 px-2 py-0.5 rounded">
                Auto-Synced
              </span>
            </div>
          </div>
        )}

        {/* BACKUP & SNAPSHOT MANAGER MODAL */}
        <BackupManagerModal
          isOpen={isBackupModalOpen}
          onClose={() => setIsBackupModalOpen(false)}
          profile={profile}
          setProfile={setProfile}
          services={services}
          setServices={setServices}
          stylists={stylists}
          setStylists={setStylists}
          loyaltyConfig={loyaltyConfig}
          setLoyaltyConfig={setLoyaltyConfig}
          clients={clients}
          setClients={setClients}
          appointments={appointments}
          setAppointments={setAppointments}
          primaryAccentColor={currentPrimaryColor}
        />
      </div>
    </div>
  );
};
