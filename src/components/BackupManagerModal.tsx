import React, { useState, useRef, useEffect } from 'react';
import { SalonProfile, SalonService, Stylist, Appointment, ClientRecord, LoyaltyConfig } from '../types';

export interface SalonConfigurationBackup {
  _metadata: {
    formatVersion: '1.0';
    exportDate: string;
    app: string;
    salonName: string;
    salonCity: string;
    itemCounts: {
      services: number;
      stylists: number;
      loyaltyRewards: number;
      clients: number;
      appointments: number;
    };
    fileSizeEstimateKb?: number;
  };
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
  loyaltyConfig: LoyaltyConfig;
  clients?: ClientRecord[];
  appointments?: Appointment[];
}

interface BackupHistoryItem {
  id: string;
  date: string;
  salonName: string;
  servicesCount: number;
  stylistsCount: number;
  fileSizeKb: number;
  filename: string;
  payloadStr: string;
}

interface BackupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  stylists: Stylist[];
  setStylists: React.Dispatch<React.SetStateAction<Stylist[]>>;
  loyaltyConfig: LoyaltyConfig;
  setLoyaltyConfig: React.Dispatch<React.SetStateAction<LoyaltyConfig>>;
  clients?: ClientRecord[];
  setClients?: React.Dispatch<React.SetStateAction<ClientRecord[]>>;
  appointments?: Appointment[];
  setAppointments?: React.Dispatch<React.SetStateAction<Appointment[]>>;
  primaryAccentColor?: string;
}

const STORAGE_KEY_PREFIX = 'salon_snapshots_history_';

export const BackupManagerModal: React.FC<BackupManagerModalProps> = ({
  isOpen,
  onClose,
  profile,
  setProfile,
  services,
  setServices,
  stylists,
  setStylists,
  loyaltyConfig,
  setLoyaltyConfig,
  clients = [],
  setClients,
  appointments = [],
  setAppointments,
  primaryAccentColor = '#C20E5A',
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'history'>('export');
  const [includeCrmData, setIncludeCrmData] = useState<boolean>(true);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [showJsonPreview, setShowJsonPreview] = useState<boolean>(false);

  // Import / Restore states
  const [importedData, setImportedData] = useState<SalonConfigurationBackup | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [restoreScope, setRestoreScope] = useState<'all' | 'config_only' | 'services_only' | 'team_only' | 'loyalty_only'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const storageKey = `${STORAGE_KEY_PREFIX}${profile.subdomain || 'default'}`;

  // Load history on open
  useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          setHistory(JSON.parse(saved));
        }
      } catch (err) {
        console.error('Failed to load backup history', err);
      }
    }
  }, [isOpen, storageKey]);

  // Construct current snapshot payload
  const buildSnapshotPayload = (): SalonConfigurationBackup => {
    const rawBackup: SalonConfigurationBackup = {
      _metadata: {
        formatVersion: '1.0',
        exportDate: new Date().toISOString(),
        app: 'Salon SaaS Suite Pro',
        salonName: profile.businessName || 'My Salon',
        salonCity: profile.city || '',
        itemCounts: {
          services: services.length,
          stylists: stylists.length,
          loyaltyRewards: loyaltyConfig.rewards?.length || 0,
          clients: includeCrmData ? clients.length : 0,
          appointments: includeCrmData ? appointments.length : 0,
        },
      },
      profile: { ...profile },
      services: [...services],
      stylists: [...stylists],
      loyaltyConfig: { ...loyaltyConfig },
    };

    if (includeCrmData) {
      rawBackup.clients = [...clients];
      rawBackup.appointments = [...appointments];
    }

    const str = JSON.stringify(rawBackup, null, 2);
    const sizeKb = Math.round((new Blob([str]).size / 1024) * 10) / 10;
    rawBackup._metadata.fileSizeEstimateKb = sizeKb;

    return rawBackup;
  };

  const handleDownloadSnapshot = () => {
    try {
      const payload = buildSnapshotPayload();
      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const sanitizedName = (profile.businessName || 'salon')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toTimeString().slice(0, 5).replace(':', '');
      const filename = `${sanitizedName}_backup_${dateStr}_${timeStr}.json`;

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Save to local snapshot history
      const historyItem: BackupHistoryItem = {
        id: `snap_${Date.now()}`,
        date: new Date().toISOString(),
        salonName: profile.businessName || 'Salon',
        servicesCount: services.length,
        stylistsCount: stylists.length,
        fileSizeKb: payload._metadata.fileSizeEstimateKb || Math.round(blob.size / 1024),
        filename,
        payloadStr: jsonStr,
      };

      const updatedHistory = [historyItem, ...history.slice(0, 9)];
      setHistory(updatedHistory);
      try {
        localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
      } catch (e) {
        console.warn('Could not cache full backup string in localStorage', e);
      }

      setDownloadSuccess(`Backup file "${filename}" downloaded successfully!`);
      setTimeout(() => setDownloadSuccess(null), 4500);
    } catch (err) {
      console.error('Download failed', err);
      alert('Failed to generate snapshot file. Please try copying the JSON instead.');
    }
  };

  const handleCopyJson = () => {
    const payload = buildSnapshotPayload();
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        // Validation checks
        if (!parsed.profile && !parsed.services && !parsed.stylists) {
          throw new Error('Invalid salon backup format. Missing profile, services, or stylists data.');
        }

        setImportedData(parsed as SalonConfigurationBackup);
      } catch (err: any) {
        setImportError(err.message || 'Failed to parse JSON file. Please ensure it is a valid salon backup.');
        setImportedData(null);
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteRestore = () => {
    if (!importedData) return;

    try {
      let restoredItems: string[] = [];

      if (restoreScope === 'all' || restoreScope === 'config_only') {
        if (importedData.profile) {
          setProfile(importedData.profile);
          restoredItems.push('Profile & Branding');
        }
        if (importedData.services && Array.isArray(importedData.services)) {
          setServices(importedData.services);
          restoredItems.push(`${importedData.services.length} Services`);
        }
        if (importedData.stylists && Array.isArray(importedData.stylists)) {
          setStylists(importedData.stylists);
          restoredItems.push(`${importedData.stylists.length} Stylists`);
        }
        if (importedData.loyaltyConfig) {
          setLoyaltyConfig(importedData.loyaltyConfig);
          restoredItems.push('Loyalty Program');
        }

        if (restoreScope === 'all') {
          if (importedData.clients && setClients && Array.isArray(importedData.clients)) {
            setClients(importedData.clients);
            restoredItems.push(`${importedData.clients.length} Clients`);
          }
          if (importedData.appointments && setAppointments && Array.isArray(importedData.appointments)) {
            setAppointments(importedData.appointments);
            restoredItems.push(`${importedData.appointments.length} Appointments`);
          }
        }
      } else if (restoreScope === 'services_only' && importedData.services) {
        setServices(importedData.services);
        restoredItems.push(`${importedData.services.length} Services`);
      } else if (restoreScope === 'team_only' && importedData.stylists) {
        setStylists(importedData.stylists);
        restoredItems.push(`${importedData.stylists.length} Stylists`);
      } else if (restoreScope === 'loyalty_only' && importedData.loyaltyConfig) {
        setLoyaltyConfig(importedData.loyaltyConfig);
        restoredItems.push('Loyalty Configuration');
      }

      setImportSuccess(`Successfully restored: ${restoredItems.join(', ')}!`);
      setImportedData(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setImportError(`Restoration failed: ${err.message}`);
    }
  };

  const handleDownloadHistorical = (item: BackupHistoryItem) => {
    const blob = new Blob([item.payloadStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClearHistory = () => {
    if (confirm('Clear all local backup history records?')) {
      setHistory([]);
      localStorage.removeItem(storageKey);
    }
  };

  if (!isOpen) return null;

  const currentPayload = buildSnapshotPayload();
  const estimatedSize = currentPayload._metadata.fileSizeEstimateKb || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in" id="backup-manager-modal">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div className="p-5 md:p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-md font-bold"
              style={{ backgroundColor: primaryAccentColor }}
            >
              <span className="material-symbols-outlined text-2xl">cloud_download</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-display font-extrabold">Salon Configuration Backup</h2>
                <span className="text-[10px] font-mono-caps font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  OFFLINE JSON
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Trigger manual data snapshots, download secure local JSON backups, or restore configurations.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Close"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* TABS HEADER */}
        <div className="flex border-b border-gray-200 bg-gray-50/80 px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`pb-3 px-3 text-xs font-bold font-mono-caps flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'export'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-base">download</span>
            <span>Create & Download Snapshot</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`pb-3 px-3 text-xs font-bold font-mono-caps flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'import'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-base">upload_file</span>
            <span>Restore / Import Backup</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`pb-3 px-3 text-xs font-bold font-mono-caps flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'history'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-base">history</span>
            <span>Snapshot History</span>
            {history.length > 0 && (
              <span className="text-[10px] bg-gray-200 text-gray-700 px-1.5 py-0.2 rounded-full font-mono">
                {history.length}
              </span>
            )}
          </button>
        </div>

        {/* NOTIFICATIONS */}
        {downloadSuccess && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 font-medium animate-fade-in">
            <span className="material-symbols-outlined text-emerald-600 text-base">check_circle</span>
            <span>{downloadSuccess}</span>
          </div>
        )}

        {importSuccess && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 font-medium animate-fade-in">
            <span className="material-symbols-outlined text-emerald-600 text-base">verified</span>
            <span>{importSuccess}</span>
          </div>
        )}

        {importError && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center gap-2 font-medium animate-fade-in">
            <span className="material-symbols-outlined text-rose-600 text-base">error</span>
            <span>{importError}</span>
          </div>
        )}

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* ============================================================ */}
          {/* TAB 1: EXPORT / CREATE SNAPSHOT */}
          {/* ============================================================ */}
          {activeTab === 'export' && (
            <div className="space-y-5">
              {/* Snapshot Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[10px] font-mono-caps font-bold">
                    <span className="material-symbols-outlined text-sm text-slate-700">storefront</span>
                    <span>Salon Profile</span>
                  </div>
                  <div className="font-bold text-sm text-gray-900 mt-1 truncate">
                    {profile.businessName || 'Salon'}
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                    Theme: {profile.themePreset?.split('_')[0] || 'Modern'}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[10px] font-mono-caps font-bold">
                    <span className="material-symbols-outlined text-sm text-pink-600">spa</span>
                    <span>Services Menu</span>
                  </div>
                  <div className="font-extrabold text-base text-gray-900 mt-1">
                    {services.length} <span className="text-xs font-normal text-gray-500">Items</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    Full pricing & duration
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[10px] font-mono-caps font-bold">
                    <span className="material-symbols-outlined text-sm text-blue-600">badge</span>
                    <span>Team Roster</span>
                  </div>
                  <div className="font-extrabold text-base text-gray-900 mt-1">
                    {stylists.length} <span className="text-xs font-normal text-gray-500">Staff</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    Specialties & timings
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-1.5 text-gray-500 text-[10px] font-mono-caps font-bold">
                    <span className="material-symbols-outlined text-sm text-amber-600">military_tech</span>
                    <span>Loyalty Setup</span>
                  </div>
                  <div className="font-extrabold text-base text-gray-900 mt-1">
                    {loyaltyConfig.rewards?.length || 0} <span className="text-xs font-normal text-gray-500">Perks</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    4 Tiers & Multipliers
                  </div>
                </div>
              </div>

              {/* Options & Inclusion settings */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeCrmData}
                      onChange={(e) => setIncludeCrmData(e.target.checked)}
                      className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900 border-gray-300"
                      id="checkbox-include-crm"
                    />
                    <span className="text-xs font-bold text-gray-900">
                      Include CRM Client Records & Appointments ({clients.length} clients, {appointments.length} bookings)
                    </span>
                  </label>
                  <p className="text-[11px] text-gray-500 ml-6 mt-0.5">
                    When checked, exports historical client profiles, loyalty points, and booked appointments for complete backup safety.
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[11px] font-mono text-gray-500 bg-white px-2.5 py-1 rounded-lg border border-gray-200">
                    Est. Size: ~{estimatedSize} KB
                  </span>
                </div>
              </div>

              {/* Snapshot Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDownloadSnapshot}
                  className="w-full sm:w-auto flex-1 py-3 px-6 rounded-2xl text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] cursor-pointer"
                  style={{ backgroundColor: primaryAccentColor }}
                  id="btn-download-json-snapshot"
                >
                  <span className="material-symbols-outlined text-lg">download</span>
                  <span>Download Local JSON Snapshot File</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="w-full sm:w-auto py-3 px-5 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  id="btn-copy-json-snapshot"
                >
                  <span className="material-symbols-outlined text-base">
                    {copiedJson ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedJson ? 'Copied to Clipboard!' : 'Copy JSON Payload'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowJsonPreview(!showJsonPreview)}
                  className="w-full sm:w-auto py-3 px-4 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">code</span>
                  <span>{showJsonPreview ? 'Hide Raw JSON' : 'Inspect JSON'}</span>
                </button>
              </div>

              {/* Collapsible JSON Inspector */}
              {showJsonPreview && (
                <div className="p-4 rounded-2xl bg-slate-950 text-emerald-400 font-mono text-[11px] max-h-56 overflow-y-auto border border-slate-800 shadow-inner">
                  <pre>{JSON.stringify(currentPayload, null, 2)}</pre>
                </div>
              )}

              {/* Safety Guarantee Info */}
              <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 text-[11px] text-amber-900 flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-700 text-base shrink-0 mt-0.5">verified_user</span>
                <div>
                  <strong>100% Offline Safe & Portable:</strong> Your salon data is packaged into a standard, open JSON structure that you can store in your own drive, share with team administrators, or restore onto any new instance at any time.
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: IMPORT / RESTORE BACKUP */}
          {/* ============================================================ */}
          {activeTab === 'import' && (
            <div className="space-y-5">
              {/* File Dropzone */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="p-8 border-2 border-dashed border-gray-300 hover:border-slate-800 rounded-3xl bg-gray-50 hover:bg-slate-50/50 flex flex-col items-center justify-center text-center cursor-pointer transition-colors group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".json,application/json"
                  className="hidden"
                  id="file-input-salon-restore"
                />
                <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-center text-slate-700 group-hover:scale-110 transition-transform mb-3">
                  <span className="material-symbols-outlined text-2xl">upload_file</span>
                </div>
                <div className="font-bold text-sm text-gray-900">
                  Select or Drag & Drop your Salon Backup JSON file
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Supports any <code className="font-mono bg-gray-200 px-1 py-0.5 rounded text-gray-800">.json</code> snapshot generated by this dashboard.
                </p>
              </div>

              {/* Staged File Diff & Confirmation */}
              {importedData && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                      <span className="font-bold text-sm text-slate-200">
                        Staged Snapshot: {importedData._metadata?.salonName || 'Salon Profile'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      Exported: {importedData._metadata?.exportDate ? new Date(importedData._metadata.exportDate).toLocaleDateString() : 'Unknown date'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700">
                      <div className="text-[10px] text-slate-400 font-mono-caps">Services</div>
                      <div className="font-bold text-emerald-400 text-sm mt-0.5">
                        {importedData.services?.length || 0} Items
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700">
                      <div className="text-[10px] text-slate-400 font-mono-caps">Team Stylists</div>
                      <div className="font-bold text-emerald-400 text-sm mt-0.5">
                        {importedData.stylists?.length || 0} Staff
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700">
                      <div className="text-[10px] text-slate-400 font-mono-caps">Loyalty Perks</div>
                      <div className="font-bold text-emerald-400 text-sm mt-0.5">
                        {importedData.loyaltyConfig?.rewards?.length || 0} Rewards
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700">
                      <div className="text-[10px] text-slate-400 font-mono-caps">CRM Records</div>
                      <div className="font-bold text-emerald-400 text-sm mt-0.5">
                        {importedData.clients?.length || 0} Clients
                      </div>
                    </div>
                  </div>

                  {/* Selective Scope */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      Select Scope of Data to Restore:
                    </label>
                    <select
                      value={restoreScope}
                      onChange={(e) => setRestoreScope(e.target.value as any)}
                      className="w-full text-xs font-semibold px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-400"
                    >
                      <option value="all">Full Restore (Profile, Services, Team, Loyalty, Clients & Appointments)</option>
                      <option value="config_only">Configuration Only (Profile, Services, Team & Loyalty)</option>
                      <option value="services_only">Services Menu Catalog Only</option>
                      <option value="team_only">Team Members & Stylists Only</option>
                      <option value="loyalty_only">Loyalty Program Settings Only</option>
                    </select>
                  </div>

                  {/* Warning & Action */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
                    <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      <span>Restoring will update your active configuration immediately.</span>
                    </p>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setImportedData(null)}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleExecuteRestore}
                        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-extrabold shadow-md flex items-center gap-1.5 transition-transform hover:scale-[1.02] cursor-pointer"
                        id="btn-confirm-restore"
                      >
                        <span className="material-symbols-outlined text-base">restore</span>
                        <span>Confirm &amp; Restore</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 3: LOCAL SNAPSHOT HISTORY */}
          {/* ============================================================ */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500">
                  Previous snapshots downloaded on this browser device:
                </p>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="text-xs text-rose-600 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-xs">delete</span>
                    <span>Clear History</span>
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-200 text-gray-400 text-xs">
                  <span className="material-symbols-outlined text-3xl mb-1 text-gray-300 block">history</span>
                  No snapshots recorded on this device yet. Click &quot;Create &amp; Download Snapshot&quot; to generate your first backup.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-2xl bg-white border border-gray-200 hover:border-gray-300 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                          <span className="material-symbols-outlined text-lg">description</span>
                        </div>
                        <div>
                          <div className="font-bold text-xs text-gray-900 flex items-center gap-2">
                            <span>{item.filename}</span>
                            <span className="text-[10px] font-mono text-gray-500 font-normal">
                              ({item.fileSizeKb} KB)
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                            {new Date(item.date).toLocaleString()} • {item.servicesCount} Services • {item.stylistsCount} Stylists
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDownloadHistorical(item)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Re-download this snapshot file"
                      >
                        <span className="material-symbols-outlined text-sm">download</span>
                        <span>Re-Download</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 px-6 bg-gray-50 border-t border-gray-200 flex justify-between items-center text-xs text-gray-500">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="material-symbols-outlined text-sm text-emerald-600">lock</span>
            <span>Client-side secure export • No external storage needed</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 font-bold text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
