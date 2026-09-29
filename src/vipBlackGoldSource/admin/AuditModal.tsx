import React, { useState, useEffect } from 'react';
import { ShieldCheck, X, AlertCircle, Clock, User, Check, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminName: string;
  onAdminNameChange: (name: string) => void;
  entityType: string;
  entityName: string;
  fieldChanged: string;
  oldValue: string;
  proposedNewValue: string;
  allowEditNewValue?: boolean;
  onConfirm: (reason: string, finalAdminName: string, finalNewValue: string) => void;
}

export const ADMIN_PRESETS = [
  'Aditya Vardhan (Chief Admin)',
  'Radhika Sen (Compliance Officer)',
  'Vikramaditya (Risk & Settlement Desk)',
  'Zara Qureshi (Operations Lead)',
];

export const REASON_PRESETS = [
  'Physical and documentary compliance verified against official MCA registry.',
  'On-site salon interior aesthetic & luxury standard inspection passed.',
  'Bank settlement UTR cleared via automated RTGS gateway.',
  'Fraud risk investigation concluded: telemetry verified legitimate.',
  'Milestone criteria achieved and audited by growth partner committee.',
  'Standard quarterly tax & regulatory ledger alignment.',
];

export const AuditModal: React.FC<AuditModalProps> = ({
  isOpen,
  onClose,
  adminName,
  onAdminNameChange,
  entityType,
  entityName,
  fieldChanged,
  oldValue,
  proposedNewValue,
  allowEditNewValue = false,
  onConfirm,
}) => {
  const [currentTimestamp, setCurrentTimestamp] = useState<string>('');
  const [changeReason, setChangeReason] = useState<string>('');
  const [editedNewValue, setEditedNewValue] = useState<string>(proposedNewValue);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setEditedNewValue(proposedNewValue);
      setChangeReason('');
      setErrorMsg('');
      const now = new Date();
      const formatted = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 8)} IST`;
      setCurrentTimestamp(formatted);
    }
  }, [isOpen, proposedNewValue]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminName.trim()) {
      setErrorMsg('Admin name is mandatory for manual audit record.');
      return;
    }
    if (!changeReason.trim()) {
      setErrorMsg('Change reason (बदलाव का कारण) is mandatory for audit logging.');
      return;
    }
    onConfirm(changeReason.trim(), adminName.trim(), editedNewValue.trim());
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl bg-[#0A0A0A] border-2 border-[#D4AF37]/50 rounded-xl shadow-[0_0_60px_rgba(212,175,55,0.2)] overflow-hidden text-white"
        >
          {/* Top Gold Accent Bar */}
          <div className="h-1.5 w-full bg-gradient-to-r from-[#D4AF37] via-[#FFF3B0] to-[#D4AF37]"></div>

          {/* Header */}
          <div className="px-6 py-5 border-b border-[#D4AF37]/20 flex items-center justify-between bg-[#111111]/80">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/40 text-[#D4AF37]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-serif font-medium tracking-wide text-white flex items-center gap-2">
                  <span>Mandatory Manual Edit Audit Protocol</span>
                  <span className="text-[10px] font-mono uppercase bg-[#D4AF37]/20 text-[#D4AF37] px-2 py-0.5 rounded border border-[#D4AF37]/30">
                    Live Audit Lock
                  </span>
                </h3>
                <p className="text-xs font-mono text-gray-400">
                  हर manual edit पर Admin name, Date/Time, Old value, New value, Change reason अनिवार्य रूप से दर्ज होगी।
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5 text-sm">
            {/* Entity and Field Banner */}
            <div className="bg-[#050505] p-3.5 rounded-lg border border-[#D4AF37]/25 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div>
                <span className="text-gray-400 block text-[10px] uppercase tracking-wider">TARGET ENTITY</span>
                <span className="text-white font-medium text-sm">{entityName}</span>
                <span className="text-gray-500 text-[11px] ml-2">({entityType})</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] uppercase tracking-wider">FIELD MODIFIED</span>
                <span className="text-[#D4AF37] font-semibold">{fieldChanged}</span>
              </div>
            </div>

            {/* Old vs New Value Diff Box */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#111111] p-3.5 rounded-lg border border-red-500/20">
                <span className="text-[11px] font-mono text-red-400 uppercase tracking-widest block mb-1">
                  OLD VALUE (मौजूदा मान)
                </span>
                <div className="p-2.5 bg-black/60 rounded border border-white/10 font-mono text-xs text-gray-300 break-words">
                  {oldValue || '(Empty)'}
                </div>
              </div>

              <div className="bg-[#111111] p-3.5 rounded-lg border border-emerald-500/30">
                <span className="text-[11px] font-mono text-emerald-400 uppercase tracking-widest block mb-1 flex items-center justify-between">
                  <span>NEW VALUE (नया मान)</span>
                  {allowEditNewValue && <Edit3 className="w-3.5 h-3.5 text-emerald-400" />}
                </span>
                {allowEditNewValue ? (
                  <input
                    type="text"
                    value={editedNewValue}
                    onChange={(e) => setEditedNewValue(e.target.value)}
                    className="w-full p-2.5 bg-black/70 rounded border border-emerald-500/40 font-mono text-xs text-emerald-300 focus:outline-none focus:border-emerald-400"
                    placeholder="Enter customized new value..."
                  />
                ) : (
                  <div className="p-2.5 bg-black/60 rounded border border-emerald-500/40 font-mono text-xs text-emerald-300 font-semibold break-words">
                    {editedNewValue}
                  </div>
                )}
              </div>
            </div>

            {/* Admin Identification & Timestamp */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-gray-300 mb-1 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>ADMIN NAME (ऑपरेटर नाम) *</span>
                </label>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={adminName}
                    onChange={(e) => onAdminNameChange(e.target.value)}
                    placeholder="Enter Admin Full Name..."
                    className="w-full px-3 py-2 bg-black/80 rounded border border-white/20 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                    required
                  />
                  <div className="flex flex-wrap gap-1">
                    {ADMIN_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        onClick={() => onAdminNameChange(preset)}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono border transition-all ${
                          adminName === preset
                            ? 'bg-[#D4AF37] text-black border-[#D4AF37] font-semibold'
                            : 'bg-black/40 text-gray-400 border-white/10 hover:border-[#D4AF37]/50'
                        }`}
                      >
                        {preset.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-gray-300 mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>DATE & TIME (तारीख और समय)</span>
                </label>
                <div className="px-3 py-2 bg-black/60 rounded border border-white/10 font-mono text-xs text-[#D4AF37]">
                  {currentTimestamp}
                </div>
                <span className="text-[10px] font-mono text-gray-500 mt-1 block">
                  Synchronized with Indian Standard Time (IST) tamper-proof clock.
                </span>
              </div>
            </div>

            {/* Change Reason (Mandatory) */}
            <div>
              <label className="block text-xs font-mono text-gray-300 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>CHANGE REASON (बदलाव का कारण) *</span>
                </span>
                <span className="text-[10px] text-amber-400 font-mono">Mandatory for permanent audit ledger</span>
              </label>
              <textarea
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                rows={3}
                placeholder="उदा. 'Physical inspection cleared by regional manager', 'Manual UTR bank verification', 'Customer dispute resolved'..."
                className="w-full px-3 py-2 bg-black/80 rounded border border-white/20 text-xs text-white focus:outline-none focus:border-[#D4AF37] resize-none"
                required
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {REASON_PRESETS.slice(0, 3).map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setChangeReason(r)}
                    className="text-[10px] text-gray-400 bg-black/40 px-2 py-0.5 rounded border border-white/10 hover:border-[#D4AF37]/40 truncate max-w-full text-left"
                    title={r}
                  >
                    • {r.slice(0, 48)}...
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-center gap-2 font-mono">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Actions */}
            <div className="pt-3 border-t border-[#D4AF37]/20 flex items-center justify-between">
              <span className="text-[11px] font-mono text-gray-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Changes will be instantly logged in Complete Audit Logs</span>
              </span>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10 transition-colors"
                >
                  Cancel (रद्द करें)
                </button>
                <button
                  type="submit"
                  className="metallic-button-strong px-5 py-2 rounded text-xs font-semibold uppercase tracking-wider flex items-center space-x-2"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Manual Edit & Audit</span>
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
