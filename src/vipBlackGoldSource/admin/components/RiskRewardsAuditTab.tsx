import React, { useState } from 'react';
import {
  MilestonePlusOne,
  FraudAlert,
  RewardClaim,
  ComplaintAppeal,
  AuditLogEntry,
} from '../types';
import {
  ShieldAlert,
  Award,
  Gift,
  FileSpreadsheet,
  AlertTriangle,
  Check,
  X,
  History,
  Search,
  Filter,
  MessageSquare,
  Clock,
  User,
} from 'lucide-react';

interface RiskRewardsAuditTabProps {
  milestones: MilestonePlusOne[];
  fraudAlerts: FraudAlert[];
  rewardClaims: RewardClaim[];
  complaints: ComplaintAppeal[];
  auditLogs: AuditLogEntry[];
  onRequestAudit: (
    entityType: string,
    entityName: string,
    fieldChanged: string,
    oldValue: string,
    proposedNewValue: string,
    onConfirmed: (reason: string, finalAdmin: string, finalVal: string) => void,
    allowEditNewVal?: boolean
  ) => void;
  onValidateMilestone: (id: string) => void;
  onUpdateFraudStatus: (id: string, status: 'investigating' | 'frozen' | 'cleared') => void;
  onApproveReward: (id: string, status: 'approved' | 'rejected' | 'dispatched') => void;
  onResolveComplaint: (id: string, resolution: string) => void;
}

export const RiskRewardsAuditTab: React.FC<RiskRewardsAuditTabProps> = ({
  milestones,
  fraudAlerts,
  rewardClaims,
  complaints,
  auditLogs,
  onRequestAudit,
  onValidateMilestone,
  onUpdateFraudStatus,
  onApproveReward,
  onResolveComplaint,
}) => {
  const [subView, setSubView] = useState<'audit' | 'milestones' | 'fraud' | 'rewards' | 'complaints'>('audit');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditFilterType, setAuditFilterType] = useState<string>('all');

  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchSearch =
      log.adminName.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.entityName.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.fieldChanged.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.changeReason.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.id.toLowerCase().includes(auditSearch.toLowerCase());
    const matchType = auditFilterType === 'all' || log.entityType.toLowerCase() === auditFilterType.toLowerCase();
    return matchSearch && matchType;
  });

  return (
    <div className="space-y-6">
      {/* Sub navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[#D4AF37]/20 pb-3">
        <button
          onClick={() => setSubView('audit')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all flex items-center gap-1.5 ${
            subView === 'audit'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Complete Audit Logs ({auditLogs.length})</span>
        </button>
        <button
          onClick={() => setSubView('milestones')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'milestones'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          9. Milestone +1 Validation
        </button>
        <button
          onClick={() => setSubView('fraud')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'fraud'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          11. Fraud Alerts ({fraudAlerts.filter(f => f.status !== 'cleared').length})
        </button>
        <button
          onClick={() => setSubView('rewards')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'rewards'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          12. Reward Claim Approval
        </button>
        <button
          onClick={() => setSubView('complaints')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'complaints'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          19. Complaints & Appeals ({complaints.filter(c => c.status !== 'resolved').length})
        </button>
      </div>

      {/* 20. COMPLETE AUDIT LOGS (CRITICAL USER REQUIREMENT) */}
      {subView === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="text-sm font-serif font-medium text-white flex items-center gap-2">
                <span>Complete Tamper-Proof Audit Logs</span>
                <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded">
                  Mandatory Manual Edit Tracker Active
                </span>
              </h3>
              <p className="text-xs font-mono text-gray-400">
                हर manual edit पर Admin name, Date/Time, Old value, New value, Change reason अनिवार्य रूप से सुरक्षित है।
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search admin, salon, reason..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="pl-8 pr-3 py-1 bg-black rounded border border-white/15 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <select
                value={auditFilterType}
                onChange={(e) => setAuditFilterType(e.target.value)}
                className="px-2.5 py-1 bg-black rounded border border-white/15 text-xs text-gray-300 focus:outline-none focus:border-[#D4AF37]"
              >
                <option value="all">All Entity Types</option>
                <option value="Shop Onboarding">Shop Onboarding</option>
                <option value="KYC Verification">KYC Verification</option>
                <option value="QR Terminal">QR Terminal</option>
                <option value="Settlement Confirmation">Settlements</option>
                <option value="Growth Partner">Growth Partners</option>
                <option value="Fraud Defense">Fraud Alerts</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/30 bg-[#0A0A0A] shadow-2xl">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/30">
                <tr>
                  <th className="p-3">Audit ID & Timestamp</th>
                  <th className="p-3">Admin Operator Name</th>
                  <th className="p-3">Entity Modified</th>
                  <th className="p-3">Field Changed</th>
                  <th className="p-3">Old Value</th>
                  <th className="p-3">New Value</th>
                  <th className="p-3 min-w-[220px]">Change Reason (कारण)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {filteredAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-gray-500 font-mono">
                      No audit records match the selected query.
                    </td>
                  </tr>
                ) : (
                  filteredAuditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-3 font-mono">
                        <div className="text-[#D4AF37] font-semibold text-xs">{log.id}</div>
                        <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-500" />
                          <span>{log.timestamp}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-[#D4AF37]" />
                          <span>{log.adminName}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-white font-medium">{log.entityName}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{log.entityType}</div>
                      </td>
                      <td className="p-3 font-mono text-xs text-[#D4AF37] font-semibold">{log.fieldChanged}</td>
                      <td className="p-3 font-mono">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-red-950/60 text-red-300 border border-red-500/30 break-all">
                          {log.oldValue}
                        </span>
                      </td>
                      <td className="p-3 font-mono">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 break-all font-semibold">
                          {log.newValue}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-gray-300 bg-white/[0.01]">
                        <p className="italic leading-relaxed">{log.changeReason}</p>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 9. MILESTONE PLUS-ONE VALIDATION */}
      {subView === 'milestones' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Milestone Plus-One (+1) Validation</h3>
              <p className="text-xs font-mono text-gray-400">Audit milestone triggers when partner or salon scales +1 unit</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {milestones.map((m) => (
              <div key={m.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/30 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-mono text-gray-500 uppercase">{m.role}</span>
                    <h4 className="text-sm font-medium text-white">{m.partnerOrSalon}</h4>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      m.plusOneStatus === 'bonus_unlocked'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {m.plusOneStatus.replace('_', ' ')}
                  </span>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 space-y-2 text-xs font-mono">
                  <div className="flex justify-between text-gray-400">
                    <span>Progress:</span>
                    <span className="text-[#D4AF37] font-bold">
                      {m.currentCount} / {m.targetCount} (+1 Milestone)
                    </span>
                  </div>
                  <div className="text-white font-medium">{m.plusOneMilestoneName}</div>
                  <div className="text-emerald-400 text-[11px]">Reward: {m.bonusReward}</div>
                  <div className="text-[10px] text-gray-500">Proof: {m.validationDoc}</div>
                </div>

                <div className="flex justify-end pt-2 border-t border-white/10">
                  {m.plusOneStatus !== 'bonus_unlocked' ? (
                    <button
                      onClick={() =>
                        onRequestAudit(
                          'Milestone Validation',
                          m.partnerOrSalon,
                          'Plus-One Milestone Status',
                          m.plusOneStatus,
                          'bonus_unlocked',
                          () => onValidateMilestone(m.id)
                        )
                      }
                      className="px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-xs font-mono flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" /> Validate & Release Reward
                    </button>
                  ) : (
                    <span className="text-xs font-mono text-emerald-400">Bonus Disbursed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 11. FRAUD ALERTS */}
      {subView === 'fraud' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Fraud Defense & Anomaly Alerts</h3>
              <p className="text-xs font-mono text-gray-400">Velocity anomaly detection, duplicate scans & chargeback defense</p>
            </div>
          </div>

          <div className="space-y-3">
            {fraudAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`bg-[#0A0A0A] p-4 rounded-lg border space-y-3 ${
                  alert.severity === 'critical'
                    ? 'border-red-500/40'
                    : alert.severity === 'high'
                    ? 'border-amber-500/30'
                    : 'border-white/10'
                }`}
              >
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert
                      className={`w-4 h-4 ${
                        alert.severity === 'critical' ? 'text-red-400 animate-pulse' : 'text-amber-400'
                      }`}
                    />
                    <span className="font-mono text-xs text-white font-semibold">{alert.type}</span>
                    <span
                      className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded ${
                        alert.severity === 'critical'
                          ? 'bg-red-950 text-red-300 border border-red-500/40'
                          : 'bg-amber-950 text-amber-300'
                      }`}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-gray-500">{alert.timestamp}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-2.5 bg-black/60 rounded border border-white/10">
                    <span className="text-[10px] text-gray-500 block">Flagged Entity:</span>
                    <span className="text-white font-medium">{alert.entityName}</span>
                  </div>
                  <div className="p-2.5 bg-black/60 rounded border border-white/10">
                    <span className="text-[10px] text-gray-500 block">Flagged Amount:</span>
                    <span className="text-red-400 font-semibold">₹{alert.flaggedAmount.toLocaleString()}</span>
                  </div>
                </div>

                <p className="text-xs text-gray-300 font-sans italic">{alert.description}</p>

                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <span className="text-xs font-mono text-gray-400">
                    Current Status: <span className="text-[#D4AF37] uppercase">{alert.status}</span>
                  </span>
                  <div className="flex space-x-2">
                    {alert.status !== 'frozen' && (
                      <button
                        onClick={() =>
                          onRequestAudit(
                            'Fraud Defense',
                            alert.entityName,
                            'Risk Status',
                            alert.status,
                            'frozen',
                            () => onUpdateFraudStatus(alert.id, 'frozen')
                          )
                        }
                        className="px-2.5 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/40 rounded text-[10px] font-mono"
                      >
                        Emergency Freeze
                      </button>
                    )}
                    {alert.status !== 'cleared' && (
                      <button
                        onClick={() =>
                          onRequestAudit(
                            'Fraud Defense',
                            alert.entityName,
                            'Risk Status',
                            alert.status,
                            'cleared',
                            () => onUpdateFraudStatus(alert.id, 'cleared')
                          )
                        }
                        className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono"
                      >
                        Clear Anomaly
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 12. REWARD CLAIM APPROVAL */}
      {subView === 'rewards' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Reward Claim Approvals</h3>
              <p className="text-xs font-mono text-gray-400">Gold vouchers, luxury emblem plaques & bespoke partner perks</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Claimant & Role</th>
                  <th className="p-3">Tier Level</th>
                  <th className="p-3">Requested Reward</th>
                  <th className="p-3">Claim Date</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {rewardClaims.map((rwd) => (
                  <tr key={rwd.id} className="hover:bg-white/[0.02]">
                    <td className="p-3">
                      <div className="font-medium text-white">{rwd.claimantName}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{rwd.role}</div>
                    </td>
                    <td className="p-3 font-mono text-xs text-[#D4AF37]">{rwd.tierLevel}</td>
                    <td className="p-3 text-white font-medium">{rwd.rewardTitle}</td>
                    <td className="p-3 font-mono text-xs text-gray-400">{rwd.claimDate}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          rwd.status === 'approved' || rwd.status === 'dispatched'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {rwd.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {rwd.status === 'submitted' && (
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() =>
                              onRequestAudit(
                                'Reward Claim',
                                rwd.claimantName,
                                'Reward Status',
                                rwd.status,
                                'approved',
                                () => onApproveReward(rwd.id, 'approved')
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() =>
                              onRequestAudit(
                                'Reward Claim',
                                rwd.claimantName,
                                'Reward Status',
                                rwd.status,
                                'rejected',
                                () => onApproveReward(rwd.id, 'rejected')
                              )
                            }
                            className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded text-[10px] font-mono"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 19. COMPLAINT & APPEAL MANAGEMENT */}
      {subView === 'complaints' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Complaint & Appeal Management</h3>
              <p className="text-xs font-mono text-gray-400">Dispute resolution, guest escrow refunds & stylist arbitration</p>
            </div>
          </div>

          <div className="space-y-3">
            {complaints.map((cmp) => (
              <div key={cmp.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/25 space-y-3">
                <div className="flex flex-wrap justify-between items-start gap-2">
                  <div>
                    <span className="text-[10px] font-mono text-[#D4AF37] block">{cmp.ticketId}</span>
                    <h4 className="text-sm font-medium text-white">{cmp.subject}</h4>
                    <p className="text-xs text-gray-400">
                      Filed by: {cmp.filedBy} ({cmp.role}) • {cmp.filedDate}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      cmp.status === 'resolved'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {cmp.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 text-xs text-gray-300">
                  <p>{cmp.details}</p>
                  {cmp.resolutionNotes && (
                    <div className="mt-2 pt-2 border-t border-white/10 text-emerald-300 font-mono text-[11px]">
                      Resolution: {cmp.resolutionNotes}
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2 border-t border-white/10">
                  {cmp.status !== 'resolved' && (
                    <button
                      onClick={() => {
                        onRequestAudit(
                          'Complaint & Dispute',
                          `${cmp.ticketId} (${cmp.filedBy})`,
                          'Dispute Resolution',
                          cmp.status,
                          'resolved (Arbitration Settlement Complete)',
                          (reason) => onResolveComplaint(cmp.id, reason),
                          true
                        );
                      }}
                      className="px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-xs font-mono"
                    >
                      Resolve & Close Ticket
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
