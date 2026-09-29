import React, { useState } from 'react';
import { DailyTransaction, SettlementRecord, Automated15DayCounter, TaxTdsStatus } from '../types';
import { DollarSign, Check, Clock, ShieldCheck, Download, Calculator, ArrowUpRight, FileText } from 'lucide-react';

interface FinanceSettlementTabProps {
  dailyTransactions: DailyTransaction[];
  settlements: SettlementRecord[];
  counters15Day: Automated15DayCounter[];
  taxTdsRecords: TaxTdsStatus[];
  onRequestAudit: (
    entityType: string,
    entityName: string,
    fieldChanged: string,
    oldValue: string,
    proposedNewValue: string,
    onConfirmed: (reason: string, finalAdmin: string, finalVal: string) => void,
    allowEditNewVal?: boolean
  ) => void;
  onConfirmSettlement: (id: string, utrNumber: string) => void;
  onUpdateTaxStatus: (id: string, status: 'deposited' | 'certificate_issued') => void;
  onReset15DayCounter: (id: string) => void;
}

export const FinanceSettlementTab: React.FC<FinanceSettlementTabProps> = ({
  dailyTransactions,
  settlements,
  counters15Day,
  taxTdsRecords,
  onRequestAudit,
  onConfirmSettlement,
  onUpdateTaxStatus,
  onReset15DayCounter,
}) => {
  const [activeFinanceView, setActiveFinanceView] = useState<'daily' | 'commission' | 'settlement' | 'counter' | 'tds'>('daily');

  const totalGrossToday = dailyTransactions.reduce((acc, t) => acc + t.grossAmount, 0);
  const totalCommissionToday = dailyTransactions.reduce((acc, t) => acc + t.commission10, 0);
  const totalNetSalonPayout = dailyTransactions.reduce((acc, t) => acc + t.netPayoutToSalon, 0);

  return (
    <div className="space-y-6">
      {/* Sub navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[#D4AF37]/20 pb-3">
        <button
          onClick={() => setActiveFinanceView('daily')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            activeFinanceView === 'daily'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          5. Daily Transaction Tracking
        </button>
        <button
          onClick={() => setActiveFinanceView('commission')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            activeFinanceView === 'commission'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          6. 10% Commission Engine
        </button>
        <button
          onClick={() => setActiveFinanceView('settlement')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            activeFinanceView === 'settlement'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          7. Settlement Confirmation
        </button>
        <button
          onClick={() => setActiveFinanceView('counter')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            activeFinanceView === 'counter'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          8. Automated 15-Day Counter
        </button>
        <button
          onClick={() => setActiveFinanceView('tds')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            activeFinanceView === 'tds'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          16. Tax / TDS Ledger (194O & 194C)
        </button>
      </div>

      {/* 5. DAILY TRANSACTIONS */}
      {activeFinanceView === 'daily' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Daily Transaction Tracking</h3>
              <p className="text-xs font-mono text-gray-400">Live ledger of all salon appointments, UPI gold QR scans & card escrow</p>
            </div>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-black/60 border border-[#D4AF37]/30 rounded text-xs font-mono text-[#D4AF37]">
                Today: ₹{totalGrossToday.toLocaleString()} Gross
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Txn ID & Time</th>
                  <th className="p-3">Salon & Client</th>
                  <th className="p-3">Service Rendered</th>
                  <th className="p-3">Gross Amount</th>
                  <th className="p-3">10% Platform Cut</th>
                  <th className="p-3">Net to Salon</th>
                  <th className="p-3">Mode</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {dailyTransactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-mono">
                      <div className="text-white text-xs">{txn.txnId}</div>
                      <div className="text-[10px] text-gray-500">{txn.date} • {txn.time}</div>
                    </td>
                    <td className="p-3">
                      <div className="text-white font-medium">{txn.salonName}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{txn.clientName}</div>
                    </td>
                    <td className="p-3 text-gray-300">{txn.serviceRendered}</td>
                    <td className="p-3 font-mono font-medium text-white">₹{txn.grossAmount.toLocaleString()}</td>
                    <td className="p-3 font-mono text-[#D4AF37] font-semibold">₹{txn.commission10.toLocaleString()}</td>
                    <td className="p-3 font-mono text-emerald-400 font-semibold">₹{txn.netPayoutToSalon.toLocaleString()}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 border border-white/10 text-gray-300">
                        {txn.paymentMode}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          txn.status === 'settled'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : txn.status === 'in_escrow'
                            ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                            : 'bg-white/10 text-gray-400'
                        }`}
                      >
                        {txn.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. 10% COMMISSION ENGINE */}
      {activeFinanceView === 'commission' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">10% Platform Commission Calculation Engine</h3>
              <p className="text-xs font-mono text-gray-400">Strict 90:10 automated split architecture with zero hidden deductions</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/30">
              <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest block">Total Processed Today</span>
              <p className="text-2xl font-serif text-white font-semibold mt-1">₹{totalGrossToday.toLocaleString()}</p>
              <p className="text-xs font-mono text-gray-500 mt-2">100% Gross Consumer Payments</p>
            </div>
            <div className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/50 shadow-[0_0_30px_rgba(212,175,55,0.1)]">
              <span className="text-[10px] font-mono text-[#D4AF37] uppercase tracking-widest block">Nexora 10% Retained Revenue</span>
              <p className="text-2xl font-serif text-[#D4AF37] font-semibold mt-1">₹{totalCommissionToday.toLocaleString()}</p>
              <p className="text-xs font-mono text-emerald-400 mt-2">Pehle Nexora, Phir Salon System Take-Rate</p>
            </div>
            <div className="bg-[#0A0A0A] p-4 rounded-lg border border-emerald-500/30">
              <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest block">90% Direct Salon Payout</span>
              <p className="text-2xl font-serif text-emerald-400 font-semibold mt-1">₹{totalNetSalonPayout.toLocaleString()}</p>
              <p className="text-xs font-mono text-gray-500 mt-2">Direct Salon Partner Disbursal</p>
            </div>
          </div>

          <div className="p-4 bg-[#0A0A0A] rounded-lg border border-white/10 space-y-2">
            <h4 className="text-xs font-mono text-white uppercase tracking-wider flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#D4AF37]" />
              <span>Automated Split Formula Breakdown:</span>
            </h4>
            <div className="font-mono text-xs text-gray-400 space-y-1">
              <p>• Gross Transaction Amount (G) = Service Price + Add-ons</p>
              <p>• Nexora Platform Commission (C) = 10.0% of G</p>
              <p>• Applicable TDS under Section 194O = 1.0% of G (auto deposited with TRACES)</p>
              <p>• Final Salon Vault Credit = G - (C + TDS) = 89.0% Direct</p>
            </div>
          </div>
        </div>
      )}

      {/* 7. SETTLEMENT CONFIRMATION */}
      {activeFinanceView === 'settlement' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Settlement Confirmation & UTR Disbursals</h3>
              <p className="text-xs font-mono text-gray-400">Release bank payouts, verify UTR reference numbers & approve batches</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Cycle Code & Salon</th>
                  <th className="p-3">Gross Volume</th>
                  <th className="p-3">10% Platform Cut</th>
                  <th className="p-3">TDS (1%)</th>
                  <th className="p-3">Net Payable</th>
                  <th className="p-3">Due Date / Status</th>
                  <th className="p-3">Bank UTR</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {settlements.map((set) => (
                  <tr key={set.id} className="hover:bg-white/[0.02]">
                    <td className="p-3">
                      <div className="font-medium text-white">{set.salonName}</div>
                      <div className="text-[10px] font-mono text-[#D4AF37]">{set.cycleCode}</div>
                    </td>
                    <td className="p-3 font-mono">₹{set.grossVolume.toLocaleString()}</td>
                    <td className="p-3 font-mono text-[#D4AF37]">₹{set.commission10.toLocaleString()}</td>
                    <td className="p-3 font-mono text-gray-400">₹{set.tdsDeducted.toLocaleString()}</td>
                    <td className="p-3 font-mono font-semibold text-emerald-400">₹{set.netPayable.toLocaleString()}</td>
                    <td className="p-3">
                      <div className="text-[10px] font-mono text-gray-400">Due: {set.dueDate}</div>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase inline-block mt-0.5 ${
                          set.status === 'confirmed'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {set.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-gray-300">
                      {set.utrNumber || <span className="text-gray-600 italic">Pending Transfer</span>}
                    </td>
                    <td className="p-3 text-right">
                      {set.status !== 'confirmed' ? (
                        <button
                          onClick={() => {
                            const generatedUtr = `RTGS${Math.floor(10000000 + Math.random() * 90000000)}`;
                            onRequestAudit(
                              'Settlement Confirmation',
                              set.salonName,
                              'Settlement Release & UTR',
                              set.status,
                              `confirmed (UTR: ${generatedUtr})`,
                              (reason, finalAdmin, finalVal) => {
                                onConfirmSettlement(set.id, generatedUtr);
                              },
                              true
                            );
                          }}
                          className="px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono inline-flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Confirm & Disburse
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-emerald-400 flex items-center justify-end gap-1">
                          <ShieldCheck className="w-3.5 h-3.5" /> Disbursed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 8. AUTOMATED 15-DAY COUNTER */}
      {activeFinanceView === 'counter' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Automated 15-Day Rolling Settlement Counters</h3>
              <p className="text-xs font-mono text-gray-400">Autonomous bi-monthly escrow maturity chronometer</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {counters15Day.map((ctr) => (
              <div key={ctr.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/25 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-medium text-white">{ctr.salonName}</h4>
                    <p className="text-[10px] font-mono text-gray-400">
                      Cycle #{ctr.cycleNumber} • {ctr.cycleStart} to {ctr.cycleEnd}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono text-[#D4AF37] px-2 py-0.5 rounded bg-[#D4AF37]/10 border border-[#D4AF37]/30">
                      {ctr.daysRemaining} Days Left
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-[10px] font-mono text-gray-400 mb-1">
                    <span>15-Day Maturity Window</span>
                    <span>{15 - ctr.daysRemaining} / 15 Days</span>
                  </div>
                  <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden border border-white/10">
                    <div
                      className="bg-gradient-to-r from-[#D4AF37] to-amber-300 h-full rounded-full transition-all"
                      style={{ width: `${((15 - ctr.daysRemaining) / 15) * 100}%` }}
                    ></div>
                  </div>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 flex justify-between items-center text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-gray-500 block">Accrued Escrow Vault:</span>
                    <span className="text-white font-semibold">₹{ctr.accruedAmount.toLocaleString()}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-500 block">Auto-Disburse Timestamp:</span>
                    <span className="text-[#D4AF37]">{ctr.autoTriggerDate}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-white/10">
                  <button
                    onClick={() =>
                      onRequestAudit(
                        '15-Day Counter',
                        ctr.salonName,
                        'Maturity Cycle Trigger',
                        `${ctr.daysRemaining} days remaining`,
                        'matured (forced premature disbursal release)',
                        () => onReset15DayCounter(ctr.id)
                      )
                    }
                    className="px-3 py-1 bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300 border border-white/20 rounded"
                  >
                    Force Maturity & Reset Cycle
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 16. TAX / TDS LEDGER */}
      {activeFinanceView === 'tds' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Tax & TDS Compliance Ledger (Section 194O & 194C)</h3>
              <p className="text-xs font-mono text-gray-400">Quarterly challan deposit monitoring & Form 16A generation</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Entity Name</th>
                  <th className="p-3">PAN Number</th>
                  <th className="p-3">Quarter</th>
                  <th className="p-3">Gross Turnover</th>
                  <th className="p-3">Applicable Section</th>
                  <th className="p-3">TDS Deducted</th>
                  <th className="p-3">Challan CIN</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {taxTdsRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-medium text-white">{rec.entityName}</td>
                    <td className="p-3 font-mono text-xs text-[#D4AF37]">{rec.pan}</td>
                    <td className="p-3 font-mono text-xs text-gray-400">{rec.quarter}</td>
                    <td className="p-3 font-mono">₹{rec.grossTurnover.toLocaleString()}</td>
                    <td className="p-3 font-mono text-xs text-gray-300">{rec.tdsSection}</td>
                    <td className="p-3 font-mono text-red-400 font-semibold">₹{rec.tdsAmount.toLocaleString()}</td>
                    <td className="p-3 font-mono text-[10px] text-gray-400">{rec.challanNumber}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          rec.status === 'deposited' || rec.status === 'certificate_issued'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {rec.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {rec.status !== 'certificate_issued' ? (
                        <button
                          onClick={() =>
                            onRequestAudit(
                              'Tax / TDS Ledger',
                              rec.entityName,
                              'TDS Certificate Status',
                              rec.status,
                              'certificate_issued',
                              () => onUpdateTaxStatus(rec.id, 'certificate_issued')
                            )
                          }
                          className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono inline-flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" /> Issue Form 16A
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-emerald-400">Form 16A Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
