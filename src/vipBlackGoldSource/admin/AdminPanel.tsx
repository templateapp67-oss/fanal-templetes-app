import React, { useState } from 'react';
import {
  AuditLogEntry,
  GrowthPartner,
  ShopOnboarding,
  KycVerification,
  QrActivation,
  DailyTransaction,
  SettlementRecord,
  Automated15DayCounter,
  MilestonePlusOne,
  DuplicateShop,
  FraudAlert,
  RewardClaim,
  ProductItem,
  VendorDealer,
  InvoiceRecord,
  TaxTdsStatus,
  DispatchRecord,
  VehicleRecord,
  ComplaintAppeal,
} from './types';
import {
  initialAuditLogs,
  initialGrowthPartners,
  initialShopsOnboarding,
  initialKycRecords,
  initialQrTerminals,
  initialDailyTransactions,
  initialSettlements,
  initial15DayCounters,
  initialMilestonePlusOnes,
  initialDuplicateShops,
  initialFraudAlerts,
  initialRewardClaims,
  initialProducts,
  initialVendors,
  initialInvoices,
  initialTaxTds,
  initialDispatches,
  initialVehicles,
  initialComplaints,
} from './adminData';
import { OverviewMetrics } from './components/OverviewMetrics';
import { OnboardingKycTab } from './components/OnboardingKycTab';
import { FinanceSettlementTab } from './components/FinanceSettlementTab';
import { OperationsHardwareTab } from './components/OperationsHardwareTab';
import { RiskRewardsAuditTab } from './components/RiskRewardsAuditTab';
import { AuditModal, ADMIN_PRESETS } from './AuditModal';
import { ShieldCheck, ArrowLeft, History, Users, DollarSign, Layers, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface AdminPanelProps {
  onBackToLanding: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ onBackToLanding }) => {
  // Global Active Admin Profile
  const [currentAdminName, setCurrentAdminName] = useState<string>(ADMIN_PRESETS[0]);

  // Main Category Tabs
  const [activeMainTab, setActiveMainTab] = useState<'onboarding' | 'finance' | 'operations' | 'risk_audit'>('onboarding');

  // Master State for all 19 entities
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(initialAuditLogs);
  const [growthPartners, setGrowthPartners] = useState<GrowthPartner[]>(initialGrowthPartners);
  const [shopsOnboarding, setShopsOnboarding] = useState<ShopOnboarding[]>(initialShopsOnboarding);
  const [kycRecords, setKycRecords] = useState<KycVerification[]>(initialKycRecords);
  const [qrTerminals, setQrTerminals] = useState<QrActivation[]>(initialQrTerminals);
  const [dailyTransactions, setDailyTransactions] = useState<DailyTransaction[]>(initialDailyTransactions);
  const [settlements, setSettlements] = useState<SettlementRecord[]>(initialSettlements);
  const [counters15Day, setCounters15Day] = useState<Automated15DayCounter[]>(initial15DayCounters);
  const [milestones, setMilestones] = useState<MilestonePlusOne[]>(initialMilestonePlusOnes);
  const [duplicateShops, setDuplicateShops] = useState<DuplicateShop[]>(initialDuplicateShops);
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlert[]>(initialFraudAlerts);
  const [rewardClaims, setRewardClaims] = useState<RewardClaim[]>(initialRewardClaims);
  const [products, setProducts] = useState<ProductItem[]>(initialProducts);
  const [vendors, setVendors] = useState<VendorDealer[]>(initialVendors);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(initialInvoices);
  const [taxTdsRecords, setTaxTdsRecords] = useState<TaxTdsStatus[]>(initialTaxTds);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>(initialDispatches);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(initialVehicles);
  const [complaints, setComplaints] = useState<ComplaintAppeal[]>(initialComplaints);

  // Audit Modal State
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [auditModalConfig, setAuditModalConfig] = useState<{
    entityType: string;
    entityName: string;
    fieldChanged: string;
    oldValue: string;
    proposedNewValue: string;
    allowEditNewVal: boolean;
    onConfirmedCallback: (reason: string, finalAdmin: string, finalVal: string) => void;
  }>({
    entityType: '',
    entityName: '',
    fieldChanged: '',
    oldValue: '',
    proposedNewValue: '',
    allowEditNewVal: false,
    onConfirmedCallback: () => {},
  });

  const [toastMessage, setToastMessage] = useState<string>('');

  const triggerAuditPrompt = (
    entityType: string,
    entityName: string,
    fieldChanged: string,
    oldValue: string,
    proposedNewValue: string,
    onConfirmed: (reason: string, finalAdmin: string, finalVal: string) => void,
    allowEditNewVal: boolean = false
  ) => {
    setAuditModalConfig({
      entityType,
      entityName,
      fieldChanged,
      oldValue,
      proposedNewValue,
      allowEditNewVal,
      onConfirmedCallback: onConfirmed,
    });
    setIsAuditModalOpen(true);
  };

  const handleAuditConfirm = (reason: string, finalAdmin: string, finalVal: string) => {
    // 1. Generate Audit Log Entry
    const now = new Date();
    const formattedDate = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 8)} IST`;
    const newLogId = `AUD-${Math.floor(8000 + Math.random() * 1999)}`;

    const newAuditLog: AuditLogEntry = {
      id: newLogId,
      adminName: finalAdmin,
      timestamp: formattedDate,
      entityType: auditModalConfig.entityType,
      entityId: `ENT-${Math.floor(100 + Math.random() * 900)}`,
      entityName: auditModalConfig.entityName,
      fieldChanged: auditModalConfig.fieldChanged,
      oldValue: auditModalConfig.oldValue,
      newValue: finalVal,
      changeReason: reason,
    };

    setAuditLogs((prev) => [newAuditLog, ...prev]);

    // 2. Execute entity update callback
    auditModalConfig.onConfirmedCallback(reason, finalAdmin, finalVal);

    setIsAuditModalOpen(false);

    // 3. Show luxury toast
    setToastMessage(`Audit log [${newLogId}] recorded successfully under ${finalAdmin}.`);
    setTimeout(() => setToastMessage(''), 4500);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans selection:bg-[#D4AF37]/30 selection:text-[#D4AF37]">
      {/* Top Luxury Admin Bar */}
      <header className="sticky top-0 z-40 bg-[#0A0A0A]/95 backdrop-blur-xl border-b border-[#D4AF37]/25 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBackToLanding}
              className="p-2 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors flex items-center gap-1.5 text-xs font-mono"
            >
              <ArrowLeft className="w-4 h-4 text-[#D4AF37]" />
              <span className="hidden sm:inline">Back to Showcase</span>
            </button>
            <div className="h-6 w-px bg-white/10"></div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif tracking-[0.2em] text-lg font-light text-[#D4AF37]">
                  NEXORA <span className="text-white font-sans font-bold text-xs bg-[#D4AF37]/15 px-2 py-0.5 rounded border border-[#D4AF37]/30">ADMIN PANEL #22</span>
                </span>
                <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                  LIVE GOVERNANCE
                </span>
              </div>
              <p className="text-[11px] font-mono text-gray-400">
                Pehle Nexora, Phir Salon • Central Operational & Settlement Console
              </p>
            </div>
          </div>

          {/* Active Admin Operator Switcher */}
          <div className="flex items-center space-x-3">
            <div className="text-right hidden md:block">
              <span className="text-[10px] font-mono text-gray-400 block uppercase">Active Admin Operator</span>
              <span className="text-xs font-mono text-[#D4AF37] font-semibold">{currentAdminName}</span>
            </div>
            <select
              value={currentAdminName}
              onChange={(e) => setCurrentAdminName(e.target.value)}
              className="px-3 py-1.5 bg-black/80 rounded border border-[#D4AF37]/40 text-xs font-mono text-white focus:outline-none focus:border-[#D4AF37]"
            >
              {ADMIN_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-6">
        {/* Toast Feedback */}
        {toastMessage && (
          <div className="bg-emerald-950/90 border border-emerald-500/50 p-3 rounded-lg text-emerald-200 text-xs font-mono flex items-center gap-2 shadow-[0_0_30px_rgba(16,185,129,0.15)] animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Global Overview Metrics */}
        <OverviewMetrics
          growthPartnersCount={growthPartners.length}
          pendingShopsCount={shopsOnboarding.filter((s) => s.status === 'pending_review').length}
          pendingKycCount={kycRecords.filter((k) => k.status === 'pending').length}
          activeQrsCount={qrTerminals.filter((q) => q.status === 'active').length}
          totalVolume={dailyTransactions.reduce((acc, t) => acc + t.grossAmount, 0) + 3250000}
          fraudAlertsCount={fraudAlerts.filter((f) => f.status !== 'cleared').length}
          pendingSettlementsCount={settlements.filter((s) => s.status === 'pending').length}
        />

        {/* Primary 4 Category Tabs */}
        <div className="flex flex-wrap gap-3 border-b border-[#D4AF37]/30 pb-4">
          <button
            onClick={() => setActiveMainTab('onboarding')}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded text-xs font-mono uppercase tracking-wider transition-all ${
              activeMainTab === 'onboarding'
                ? 'metallic-button-strong font-bold'
                : 'bg-[#0A0A0A] text-gray-400 hover:text-white border border-white/10'
            }`}
          >
            <Users className="w-4 h-4 text-[#D4AF37]" />
            <span>I. Onboarding & KYC (4)</span>
          </button>

          <button
            onClick={() => setActiveMainTab('finance')}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded text-xs font-mono uppercase tracking-wider transition-all ${
              activeMainTab === 'finance'
                ? 'metallic-button-strong font-bold'
                : 'bg-[#0A0A0A] text-gray-400 hover:text-white border border-white/10'
            }`}
          >
            <DollarSign className="w-4 h-4 text-[#D4AF37]" />
            <span>II. Finance & Settlements (5)</span>
          </button>

          <button
            onClick={() => setActiveMainTab('operations')}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded text-xs font-mono uppercase tracking-wider transition-all ${
              activeMainTab === 'operations'
                ? 'metallic-button-strong font-bold'
                : 'bg-[#0A0A0A] text-gray-400 hover:text-white border border-white/10'
            }`}
          >
            <Layers className="w-4 h-4 text-[#D4AF37]" />
            <span>III. Hardware & Operations (6)</span>
          </button>

          <button
            onClick={() => setActiveMainTab('risk_audit')}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded text-xs font-mono uppercase tracking-wider transition-all ${
              activeMainTab === 'risk_audit'
                ? 'metallic-button-strong font-bold'
                : 'bg-[#0A0A0A] text-gray-400 hover:text-white border border-white/10'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-[#D4AF37]" />
            <span>IV. Risk, Rewards & Audit Logs (5)</span>
          </button>
        </div>

        {/* Tab 1: Onboarding & KYC */}
        {activeMainTab === 'onboarding' && (
          <OnboardingKycTab
            growthPartners={growthPartners}
            shopsOnboarding={shopsOnboarding}
            kycRecords={kycRecords}
            duplicateShops={duplicateShops}
            onRequestAudit={triggerAuditPrompt}
            onUpdateGrowthPartnerStatus={(id, status) => {
              setGrowthPartners((prev) =>
                prev.map((p) => (p.id === id ? { ...p, status } : p))
              );
            }}
            onUpdateShopStatus={(id, status) => {
              setShopsOnboarding((prev) =>
                prev.map((s) => (s.id === id ? { ...s, status } : s))
              );
            }}
            onUpdateKycStatus={(id, status) => {
              setKycRecords((prev) =>
                prev.map((k) => (k.id === id ? { ...k, status } : k))
              );
            }}
            onUpdateDuplicateStatus={(id, status) => {
              setDuplicateShops((prev) =>
                prev.map((d) => (d.id === id ? { ...d, status } : d))
              );
            }}
          />
        )}

        {/* Tab 2: Finance & Settlements */}
        {activeMainTab === 'finance' && (
          <FinanceSettlementTab
            dailyTransactions={dailyTransactions}
            settlements={settlements}
            counters15Day={counters15Day}
            taxTdsRecords={taxTdsRecords}
            onRequestAudit={triggerAuditPrompt}
            onConfirmSettlement={(id, utrNumber) => {
              setSettlements((prev) =>
                prev.map((s) =>
                  s.id === id ? { ...s, status: 'confirmed', utrNumber } : s
                )
              );
            }}
            onUpdateTaxStatus={(id, status) => {
              setTaxTdsRecords((prev) =>
                prev.map((t) => (t.id === id ? { ...t, status } : t))
              );
            }}
            onReset15DayCounter={(id) => {
              setCounters15Day((prev) =>
                prev.map((c) =>
                  c.id === id ? { ...c, daysRemaining: 15, cycleNumber: c.cycleNumber + 1 } : c
                )
              );
            }}
          />
        )}

        {/* Tab 3: Hardware & Operations */}
        {activeMainTab === 'operations' && (
          <OperationsHardwareTab
            qrTerminals={qrTerminals}
            products={products}
            vendors={vendors}
            invoices={invoices}
            dispatches={dispatches}
            vehicles={vehicles}
            onRequestAudit={triggerAuditPrompt}
            onUpdateQrStatus={(id, status) => {
              setQrTerminals((prev) =>
                prev.map((q) => (q.id === id ? { ...q, status } : q))
              );
            }}
            onUpdateProductStock={(id, newStock) => {
              setProducts((prev) =>
                prev.map((p) => (p.id === id ? { ...p, stockUnits: newStock } : p))
              );
            }}
            onUpdateDispatchStatus={(id, status) => {
              setDispatches((prev) =>
                prev.map((d) => (d.id === id ? { ...d, status } : d))
              );
            }}
            onUpdateVehicleInspection={(id, status) => {
              setVehicles((prev) =>
                prev.map((v) => (v.id === id ? { ...v, inspectionStatus: status } : v))
              );
            }}
            onUploadInvoice={(newInv) => {
              setInvoices((prev) => [newInv, ...prev]);
            }}
          />
        )}

        {/* Tab 4: Risk, Rewards & Complete Audit Logs */}
        {activeMainTab === 'risk_audit' && (
          <RiskRewardsAuditTab
            milestones={milestones}
            fraudAlerts={fraudAlerts}
            rewardClaims={rewardClaims}
            complaints={complaints}
            auditLogs={auditLogs}
            onRequestAudit={triggerAuditPrompt}
            onValidateMilestone={(id) => {
              setMilestones((prev) =>
                prev.map((m) =>
                  m.id === id ? { ...m, plusOneStatus: 'bonus_unlocked' } : m
                )
              );
            }}
            onUpdateFraudStatus={(id, status) => {
              setFraudAlerts((prev) =>
                prev.map((f) => (f.id === id ? { ...f, status } : f))
              );
            }}
            onApproveReward={(id, status) => {
              setRewardClaims((prev) =>
                prev.map((r) => (r.id === id ? { ...r, status } : r))
              );
            }}
            onResolveComplaint={(id, resolution) => {
              setComplaints((prev) =>
                prev.map((c) =>
                  c.id === id
                    ? { ...c, status: 'resolved', resolutionNotes: resolution }
                    : c
                )
              );
            }}
          />
        )}
      </main>

      {/* Mandatory Audit Modal for every manual edit */}
      <AuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        adminName={currentAdminName}
        onAdminNameChange={setCurrentAdminName}
        entityType={auditModalConfig.entityType}
        entityName={auditModalConfig.entityName}
        fieldChanged={auditModalConfig.fieldChanged}
        oldValue={auditModalConfig.oldValue}
        proposedNewValue={auditModalConfig.proposedNewValue}
        allowEditNewValue={auditModalConfig.allowEditNewVal}
        onConfirm={handleAuditConfirm}
      />
    </div>
  );
};
