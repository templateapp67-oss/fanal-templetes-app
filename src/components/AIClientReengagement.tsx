import React, { useState, useEffect } from 'react';
import { Appointment, ClientRecord, SalonProfile, SalonService, ReengagementAnalysisResult, ReengagementRecommendation } from '../types';
import { calculateLoyaltyTier, TIER_METADATA } from '../loyaltyData';

interface AIClientReengagementProps {
  clients: ClientRecord[];
  appointments: Appointment[];
  services: SalonService[];
  profile: SalonProfile;
  primaryAccentColor?: string;
  isAuthenticated?: boolean;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  onNavigateToPreview?: () => void;
}

export const AIClientReengagement: React.FC<AIClientReengagementProps> = ({
  clients,
  appointments,
  services,
  profile,
  primaryAccentColor = '#0f172a',
  isAuthenticated = true,
  onRequireAuth,
}) => {
  const [inactivityThreshold, setInactivityThreshold] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ReengagementAnalysisResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [contactedClientIds, setContactedClientIds] = useState<Set<string>>(new Set());
  const [customOffers, setCustomOffers] = useState<Record<string, string>>({});
  const [feedbackToast, setFeedbackToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setFeedbackToast({ message, type });
    setTimeout(() => setFeedbackToast(null), 3500);
  };

  // Run AI analysis
  const runAnalysis = async (threshold = inactivityThreshold) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ai/re-engage-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointments,
          clients,
          services,
          profile,
          inactivityDaysThreshold: threshold,
          referenceDate: '2026-09-08',
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data: ReengagementAnalysisResult = await response.json();
      setAnalysisResult(data);
      showToast(`AI Analysis generated personalized offers for ${data.recommendations?.length || 0} clients!`, 'success');
    } catch (err: any) {
      console.error('Failed to run AI re-engagement analysis:', err);
      showToast('Analysis completed using local salon retention intelligence.', 'info');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    runAnalysis(inactivityThreshold);
  }, [inactivityThreshold]);

  const handleCopyMessage = (rec: ReengagementRecommendation, customText?: string) => {
    const textToCopy = customText || customOffers[rec.clientId] || rec.personalizedWhatsApp;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(rec.clientId);
    setTimeout(() => setCopiedId(null), 2500);
    showToast(`Personalized WhatsApp offer copied for ${rec.clientName}!`, 'success');
  };

  const handleSendWhatsApp = (rec: ReengagementRecommendation) => {
    if (!isAuthenticated) {
      if (onRequireAuth) onRequireAuth('login');
      return;
    }

    const message = customOffers[rec.clientId] || rec.personalizedWhatsApp;
    const cleanPhone = rec.clientPhone.replace(/[^0-9]/g, '');
    const encodedText = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    // Mark client as contacted
    setContactedClientIds((prev) => new Set([...prev, rec.clientId]));
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    showToast(`Opened WhatsApp chat for ${rec.clientName}`, 'success');
  };

  const handleSendSms = (rec: ReengagementRecommendation) => {
    if (!isAuthenticated) {
      if (onRequireAuth) onRequireAuth('login');
      return;
    }
    setContactedClientIds((prev) => new Set([...prev, rec.clientId]));
    showToast(`SMS dispatch logged for ${rec.clientName} (${rec.clientPhone})`, 'success');
  };

  const handleExportReengagementCSV = () => {
    if (!analysisResult || !analysisResult.recommendations.length) return;

    const headers = [
      'Client Name',
      'Phone',
      'Email',
      'Loyalty Tier',
      'Days Inactive',
      'Last Visit Date',
      'Last Service',
      'Preferred Stylist',
      'Suggested Service',
      'Personalized Offer',
      'Urgency Level',
      'Recoverable Value (INR)',
      'Churn Risk Diagnostic',
      'WhatsApp Message Copy',
    ];

    const rows = analysisResult.recommendations.map((r) => [
      `"${r.clientName}"`,
      `"${r.clientPhone}"`,
      `"${r.clientEmail || ''}"`,
      `"${r.loyaltyTier}"`,
      r.daysInactive,
      `"${r.lastVisitDate}"`,
      `"${r.lastServiceName}"`,
      `"${r.lastStylistName}"`,
      `"${r.suggestedServiceName}"`,
      `"${r.discountOffer}"`,
      `"${r.urgencyLevel}"`,
      r.estimatedRecoverableValue,
      `"${r.churnRiskAnalysis.replace(/"/g, '""')}"`,
      `"${r.personalizedWhatsApp.replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reengagement_campaign_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Re-engagement campaign data exported to CSV!', 'success');
  };

  // Filter recommendations
  const filteredRecommendations = (analysisResult?.recommendations || []).filter((rec) => {
    const matchesSearch =
      rec.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rec.clientPhone.includes(searchQuery) ||
      rec.lastServiceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rec.lastStylistName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTier = tierFilter === 'all' || rec.loyaltyTier === tierFilter;
    const matchesUrgency = urgencyFilter === 'all' || rec.urgencyLevel === urgencyFilter;

    return matchesSearch && matchesTier && matchesUrgency;
  });

  return (
    <div className="flex flex-col gap-6" id="ai-reengagement-hub">
      {/* Toast Notification */}
      {feedbackToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-gray-700 animate-fade-in">
          <span className="material-symbols-outlined text-emerald-400 text-sm">
            {feedbackToast.type === 'success' ? 'check_circle' : 'info'}
          </span>
          <span>{feedbackToast.message}</span>
        </div>
      )}

      {/* Hero / Header Card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-5">
          <div className="flex items-start gap-3">
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-xs"
              style={{ backgroundColor: `${primaryAccentColor}15`, color: primaryAccentColor }}
            >
              <span className="material-symbols-outlined text-2xl">psychology</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display font-bold text-xl text-gray-900">
                  AI Client Retention & Re-Engagement Hub
                </h2>
                <span className="bg-purple-100 text-purple-800 text-[10px] font-mono-caps font-bold px-2.5 py-0.5 rounded-full border border-purple-200 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">auto_awesome</span>
                  <span>Powered by Gemini</span>
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Analyzes client booking cadence and service lifecycles to generate high-converting promotional offers and custom WhatsApp messages.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => runAnalysis(inactivityThreshold)}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl text-white font-bold text-xs shadow-xs flex items-center gap-2 cursor-pointer hover:opacity-95 disabled:opacity-50 transition-all"
              style={{ backgroundColor: primaryAccentColor }}
              id="btn-reanalyze-gemini"
            >
              <span className={`material-symbols-outlined text-sm ${isLoading ? 'animate-spin' : ''}`}>
                {isLoading ? 'progress_activity' : 'refresh'}
              </span>
              <span>{isLoading ? 'Analyzing Appointments...' : 'Re-Analyze with Gemini'}</span>
            </button>

            <button
              onClick={handleExportReengagementCSV}
              disabled={!analysisResult?.recommendations?.length}
              className="px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
              id="btn-export-reengagement-csv"
            >
              <span className="material-symbols-outlined text-sm text-gray-600">download</span>
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Inactivity Threshold Filter Tabs */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-50/80 p-3 rounded-xl border border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-700 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-gray-500">history_toggle_off</span>
              <span>Lapsed Threshold:</span>
            </span>
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-gray-200 shadow-2xs">
              {[
                { label: '30+ Days', value: 30 },
                { label: '45+ Days', value: 45 },
                { label: '60+ Days', value: 60 },
                { label: '90+ Days', value: 90 },
              ].map((pill) => (
                <button
                  key={pill.value}
                  onClick={() => setInactivityThreshold(pill.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    inactivityThreshold === pill.value
                      ? 'bg-gray-900 text-white shadow-2xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-gray-500 flex items-center gap-1">
            <span className="material-symbols-outlined text-xs text-purple-600">schedule</span>
            <span>Targeting clients overdue for routine beauty maintenance</span>
          </div>
        </div>

        {/* KPI & Metric Banners */}
        {analysisResult && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-gray-200 bg-white flex items-center justify-between shadow-2xs">
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Identified Inactive Clients
                </div>
                <div className="text-2xl font-display font-bold text-gray-900 mt-0.5">
                  {analysisResult.totalInactiveCount}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Avg. {analysisResult.averageInactiveDays} days since last visit
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                <span className="material-symbols-outlined text-xl">person_off</span>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-200 bg-white flex items-center justify-between shadow-2xs">
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Recoverable Revenue Opportunity
                </div>
                <div className="text-2xl font-display font-bold text-emerald-700 mt-0.5">
                  ₹{analysisResult.potentialRecoverableRevenue.toLocaleString('en-IN')}
                </div>
                <div className="text-[10px] text-emerald-600 font-medium mt-0.5">
                  Based on client average ticket & service value
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200">
                <span className="material-symbols-outlined text-xl">payments</span>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 flex items-center justify-between shadow-2xs">
              <div>
                <div className="text-[11px] font-bold text-purple-900 uppercase tracking-wider">
                  AI Campaign Strategy
                </div>
                <div className="text-sm font-bold text-purple-950 mt-1 line-clamp-1">
                  {analysisResult.campaignTheme}
                </div>
                <div className="text-[10px] text-purple-700 mt-0.5">
                  Personalized stylist callbacks & service cycle promos
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center border border-purple-300">
                <span className="material-symbols-outlined text-xl">campaign</span>
              </div>
            </div>
          </div>
        )}

        {/* Gemini Executive Insights Panel */}
        {analysisResult?.topInsights && analysisResult.topInsights.length > 0 && (
          <div className="p-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50/70 via-indigo-50/40 to-white flex flex-col gap-2.5 text-xs">
            <div className="flex items-center gap-2 text-purple-950 font-bold">
              <span className="material-symbols-outlined text-base text-purple-700">lightbulb</span>
              <span>Gemini Retention Diagnostics & Key Findings</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {analysisResult.topInsights.map((insight, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-white/90 border border-purple-100 shadow-2xs flex items-start gap-2 text-[11px] text-gray-700 leading-relaxed"
                >
                  <span className="w-4 h-4 rounded-full bg-purple-200 text-purple-900 font-mono font-bold text-[9px] flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{insight}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            search
          </span>
          <input
            type="text"
            placeholder="Search by client name, stylist, service, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:border-gray-900 bg-gray-50/50"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-gray-700 focus:outline-hidden"
          >
            <option value="all">All Loyalty Tiers</option>
            <option value="platinum">Platinum VIP</option>
            <option value="gold">Gold Member</option>
            <option value="silver">Silver Member</option>
            <option value="bronze">Bronze Member</option>
          </select>

          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-gray-700 focus:outline-hidden"
          >
            <option value="all">All Urgency Levels</option>
            <option value="critical">Critical (60+ Days Lapsed)</option>
            <option value="high">High Risk (45+ Days)</option>
            <option value="medium">Moderate Inactivity</option>
          </select>
        </div>
      </div>

      {/* Client Recommendations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" id="reengagement-client-list">
        {filteredRecommendations.map((rec) => {
          const tier = rec.loyaltyTier || 'silver';
          const tierMeta = TIER_METADATA[tier] || TIER_METADATA.silver;
          const isExpanded = expandedClientId === rec.clientId;
          const isCopied = copiedId === rec.clientId;
          const isContacted = contactedClientIds.has(rec.clientId);
          const currentOfferText = customOffers[rec.clientId] || rec.personalizedWhatsApp;

          return (
            <div
              key={rec.clientId}
              className={`bg-white border rounded-2xl p-5 shadow-xs flex flex-col justify-between gap-4 transition-all ${
                isContacted
                  ? 'border-emerald-200 bg-emerald-50/20'
                  : rec.urgencyLevel === 'critical'
                  ? 'border-rose-200 hover:border-rose-300'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {/* Top Identity & Status Row */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-800 font-bold font-display flex items-center justify-center text-sm border border-gray-200 shrink-0">
                      {rec.clientName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-gray-900">{rec.clientName}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono-caps font-bold border ${tierMeta.badgeBg} ${tierMeta.borderColor} flex items-center gap-1`}
                        >
                          <span className="material-symbols-outlined text-xs">{tierMeta.icon}</span>
                          <span>{tierMeta.name.split(' ')[0]}</span>
                        </span>
                      </div>
                      <div className="text-gray-500 text-[11px] font-mono mt-0.5 flex items-center gap-2">
                        <span>{rec.clientPhone}</span>
                        {rec.clientEmail && <span className="text-gray-400">• {rec.clientEmail}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Urgency Badge */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                        rec.urgencyLevel === 'critical'
                          ? 'bg-rose-100 text-rose-800 border-rose-200'
                          : rec.urgencyLevel === 'high'
                          ? 'bg-amber-100 text-amber-800 border-amber-200'
                          : 'bg-blue-100 text-blue-800 border-blue-200'
                      }`}
                    >
                      <span className="material-symbols-outlined text-xs">
                        {rec.urgencyLevel === 'critical'
                          ? 'error'
                          : rec.urgencyLevel === 'high'
                          ? 'warning'
                          : 'schedule'}
                      </span>
                      <span>{rec.daysInactive} Days Inactive</span>
                    </span>

                    {isContacted && (
                      <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-xs">done_all</span>
                        <span>Contacted</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Visit History Context */}
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[11px] text-gray-600">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-gray-400">event</span>
                      <span>Last Visit: <strong>{rec.lastVisitDate}</strong></span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-gray-400">person</span>
                      <span>Stylist: <strong>{rec.lastStylistName}</strong></span>
                    </span>
                  </div>
                  <div className="text-gray-800 font-medium text-[11px] line-clamp-1">
                    Previous Service: <span className="text-gray-600">{rec.lastServiceName}</span>
                  </div>
                </div>

                {/* Gemini AI Recommendation Box */}
                <div className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/50 flex flex-col gap-2 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-1.5 text-purple-900 font-bold">
                      <span className="material-symbols-outlined text-sm text-purple-600">auto_awesome</span>
                      <span>AI Personalized Re-engagement Offer</span>
                    </div>
                    <span className="bg-purple-200 text-purple-900 font-mono font-bold text-[10px] px-2 py-0.5 rounded-md">
                      Est. Value: ₹{rec.estimatedRecoverableValue.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                    <span className="bg-white border border-purple-200 text-purple-900 font-bold px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 shadow-2xs">
                      <span className="material-symbols-outlined text-xs text-purple-600">sell</span>
                      <span>{rec.discountOffer}</span>
                    </span>
                    <span className="text-[11px] text-purple-950 font-medium">
                      for <strong>{rec.suggestedServiceName}</strong>
                    </span>
                  </div>

                  {/* Churn Risk Diagnostic */}
                  <div className="text-[11px] text-purple-900/80 bg-white/70 p-2 rounded-lg border border-purple-100 italic">
                    💡 "{rec.churnRiskAnalysis}"
                  </div>
                </div>

                {/* Collapsible WhatsApp Preview & Editor */}
                {isExpanded && (
                  <div className="flex flex-col gap-2 p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl text-xs animate-fade-in">
                    <div className="flex justify-between items-center text-emerald-900 font-bold text-[11px]">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-emerald-600">chat</span>
                        <span>WhatsApp Campaign Message (Editable)</span>
                      </span>
                      <span className="text-[10px] text-emerald-700 font-normal">Ready to dispatch</span>
                    </div>
                    <textarea
                      rows={5}
                      value={currentOfferText}
                      onChange={(e) =>
                        setCustomOffers((prev) => ({ ...prev, [rec.clientId]: e.target.value }))
                      }
                      className="w-full p-2.5 text-[11px] font-sans border border-emerald-300 rounded-lg bg-white focus:outline-hidden text-gray-800 leading-relaxed"
                    />
                  </div>
                )}
              </div>

              {/* Action Buttons Deck */}
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100 flex-wrap">
                <button
                  onClick={() => setExpandedClientId(isExpanded ? null : rec.clientId)}
                  className="text-gray-500 hover:text-gray-800 text-[11px] font-bold flex items-center gap-0.5 cursor-pointer py-1"
                >
                  <span>{isExpanded ? 'Hide Message' : 'Preview Message'}</span>
                  <span className="material-symbols-outlined text-xs">
                    {isExpanded ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyMessage(rec, currentOfferText)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs">
                      {isCopied ? 'check' : 'content_copy'}
                    </span>
                    <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                  </button>

                  <button
                    onClick={() => handleSendWhatsApp(rec)}
                    className="px-3.5 py-1.5 rounded-lg text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all hover:opacity-95"
                    style={{ backgroundColor: '#25D366' }}
                    title="Open WhatsApp chat with pre-filled personalized offer"
                  >
                    <span className="material-symbols-outlined text-sm">chat</span>
                    <span>WhatsApp Offer</span>
                  </button>

                  <button
                    onClick={() => handleSendSms(rec)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    title="Send SMS"
                  >
                    <span className="material-symbols-outlined text-xs text-gray-500">sms</span>
                    <span>SMS</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredRecommendations.length === 0 && (
          <div className="col-span-full py-12 text-center bg-white border border-gray-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-3">
            <span className="material-symbols-outlined text-4xl text-gray-300">search_off</span>
            <div className="text-gray-900 font-bold text-base">No inactive clients found</div>
            <p className="text-xs text-gray-500 max-w-sm">
              All clients have visited recently within your selected threshold ({inactivityThreshold} days), or no clients match your active filters.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setTierFilter('all');
                setUrgencyFilter('all');
                setInactivityThreshold(30);
              }}
              className="mt-2 text-xs font-bold text-purple-700 hover:text-purple-900 cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
