import React, { useState } from 'react';
import { GrowthPartner, ShopOnboarding, KycVerification, DuplicateShop } from '../types';
import { Check, X, Shield, AlertTriangle, Building, UserCheck, Eye, Copy, ArrowRight } from 'lucide-react';

interface OnboardingKycTabProps {
  growthPartners: GrowthPartner[];
  shopsOnboarding: ShopOnboarding[];
  kycRecords: KycVerification[];
  duplicateShops: DuplicateShop[];
  onRequestAudit: (
    entityType: string,
    entityName: string,
    fieldChanged: string,
    oldValue: string,
    proposedNewValue: string,
    onConfirmed: (reason: string, finalAdmin: string, finalVal: string) => void
  ) => void;
  onUpdateGrowthPartnerStatus: (id: string, status: 'approved' | 'rejected') => void;
  onUpdateShopStatus: (id: string, status: 'approved' | 'rejected' | 'action_required') => void;
  onUpdateKycStatus: (id: string, status: 'verified' | 'rejected') => void;
  onUpdateDuplicateStatus: (id: string, status: 'merged' | 'dismissed' | 'blocked') => void;
}

export const OnboardingKycTab: React.FC<OnboardingKycTabProps> = ({
  growthPartners,
  shopsOnboarding,
  kycRecords,
  duplicateShops,
  onRequestAudit,
  onUpdateGrowthPartnerStatus,
  onUpdateShopStatus,
  onUpdateKycStatus,
  onUpdateDuplicateStatus,
}) => {
  const [subSection, setSubSection] = useState<'partners' | 'shops' | 'kyc' | 'duplicates'>('partners');

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[#D4AF37]/20 pb-3">
        <button
          onClick={() => setSubSection('partners')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subSection === 'partners'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          1. Growth Partner Approvals ({growthPartners.filter(p => p.status === 'pending').length} Pending)
        </button>
        <button
          onClick={() => setSubSection('shops')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subSection === 'shops'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          2. Shop Onboarding Review ({shopsOnboarding.filter(s => s.status === 'pending_review').length} Pending)
        </button>
        <button
          onClick={() => setSubSection('kyc')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subSection === 'kyc'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          3. KYC Verification ({kycRecords.filter(k => k.status === 'pending').length} Unverified)
        </button>
        <button
          onClick={() => setSubSection('duplicates')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subSection === 'duplicates'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          4. Duplicate Shop Detection ({duplicateShops.filter(d => d.status === 'flagged').length} Flagged)
        </button>
      </div>

      {/* 1. GROWTH PARTNERS */}
      {subSection === 'partners' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Growth Partner Registration Approvals</h3>
              <p className="text-xs font-mono text-gray-400">Review luxury agency partners and territorial franchise scouts</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Partner ID & Name</th>
                  <th className="p-3">Contact & Region</th>
                  <th className="p-3">Tier & Salons Referred</th>
                  <th className="p-3">Commission Terms</th>
                  <th className="p-3">Turnover Sourced</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Manual Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {growthPartners.map((partner) => (
                  <tr key={partner.id} className="hover:bg-white/[0.02]">
                    <td className="p-3">
                      <div className="font-medium text-white">{partner.name}</div>
                      <div className="text-[10px] font-mono text-[#D4AF37]">{partner.id}</div>
                    </td>
                    <td className="p-3">
                      <div>{partner.phone}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{partner.region}</div>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 border border-[#D4AF37]/40 text-[#D4AF37]">
                        {partner.tier} ({partner.salonsReferred} Salons)
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-gray-300">{partner.commissionRate}</td>
                    <td className="p-3 font-mono text-emerald-400">₹{(partner.turnoverContribution).toLocaleString()}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          partner.status === 'approved'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : partner.status === 'rejected'
                            ? 'bg-red-950 text-red-300 border border-red-500/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {partner.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {partner.status !== 'approved' && (
                          <button
                            onClick={() =>
                              onRequestAudit(
                                'Growth Partner',
                                partner.name,
                                'Registration Approval',
                                partner.status,
                                'approved',
                                () => onUpdateGrowthPartnerStatus(partner.id, 'approved')
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                        )}
                        {partner.status !== 'rejected' && (
                          <button
                            onClick={() =>
                              onRequestAudit(
                                'Growth Partner',
                                partner.name,
                                'Registration Approval',
                                partner.status,
                                'rejected',
                                () => onUpdateGrowthPartnerStatus(partner.id, 'rejected')
                              )
                            }
                            className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded text-[10px] font-mono flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. SHOP ONBOARDING */}
      {subSection === 'shops' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Shop Onboarding Review</h3>
              <p className="text-xs font-mono text-gray-400">Validate luxury salon applications, aesthetic compliance & turnover</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shopsOnboarding.map((shop) => (
              <div key={shop.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/25 space-y-3">
                <div className="flex gap-4">
                  <img
                    src={shop.interiorPhoto}
                    alt={shop.salonName}
                    className="w-24 h-24 object-cover rounded border border-[#D4AF37]/30"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-start">
                      <h4 className="text-sm font-medium text-white font-serif">{shop.salonName}</h4>
                      <span
                        className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded ${
                          shop.status === 'approved'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : shop.status === 'action_required'
                            ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                            : 'bg-white/10 text-gray-300 border border-white/20'
                        }`}
                      >
                        {shop.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#D4AF37] font-mono">{shop.category}</p>
                    <p className="text-xs text-gray-300">{shop.ownerName} • {shop.phone}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{shop.city}</p>
                  </div>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 text-[11px] text-gray-300 font-mono">
                  <span className="text-gray-500 block text-[9px] uppercase">Turnover & Notes:</span>
                  <div className="flex justify-between text-white font-semibold my-0.5">
                    <span>Target Turnover:</span>
                    <span className="text-emerald-400">{shop.monthlyTurnover}</span>
                  </div>
                  <p className="text-gray-400 text-[10px] italic">{shop.notes}</p>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Shop Onboarding',
                        shop.salonName,
                        'Onboarding Review Status',
                        shop.status,
                        'approved',
                        () => onUpdateShopStatus(shop.id, 'approved')
                      )
                    }
                    className="px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" /> Approve Salon
                  </button>
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Shop Onboarding',
                        shop.salonName,
                        'Onboarding Review Status',
                        shop.status,
                        'action_required',
                        () => onUpdateShopStatus(shop.id, 'action_required')
                      )
                    }
                    className="px-3 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 rounded text-[10px] font-mono flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" /> Request Changes
                  </button>
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Shop Onboarding',
                        shop.salonName,
                        'Onboarding Review Status',
                        shop.status,
                        'rejected',
                        () => onUpdateShopStatus(shop.id, 'rejected')
                      )
                    }
                    className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded text-[10px] font-mono flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. KYC VERIFICATION */}
      {subSection === 'kyc' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">KYC & Regulatory Verification</h3>
              <p className="text-xs font-mono text-gray-400">Aadhaar, PAN & GSTIN ledger authentication</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Applicant & Entity</th>
                  <th className="p-3">PAN Number</th>
                  <th className="p-3">GSTIN Registration</th>
                  <th className="p-3">Aadhaar Vault</th>
                  <th className="p-3">Doc Submission</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Manual Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {kycRecords.map((kyc) => (
                  <tr key={kyc.id} className="hover:bg-white/[0.02]">
                    <td className="p-3">
                      <div className="font-medium text-white">{kyc.applicantName}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{kyc.businessName}</div>
                    </td>
                    <td className="p-3 font-mono text-xs text-[#D4AF37]">{kyc.panNumber}</td>
                    <td className="p-3 font-mono text-xs text-gray-300">{kyc.gstNumber}</td>
                    <td className="p-3 font-mono text-xs text-gray-400">{kyc.aadhaarNumber}</td>
                    <td className="p-3 font-mono text-[10px] text-gray-400">{kyc.docType}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          kyc.status === 'verified'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : kyc.status === 'rejected'
                            ? 'bg-red-950 text-red-300 border border-red-500/40'
                            : 'bg-blue-950 text-blue-300 border border-blue-500/40'
                        }`}
                      >
                        {kyc.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {kyc.status !== 'verified' && (
                          <button
                            onClick={() =>
                              onRequestAudit(
                                'KYC Verification',
                                kyc.businessName,
                                'KYC Status',
                                kyc.status,
                                'verified',
                                () => onUpdateKycStatus(kyc.id, 'verified')
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono flex items-center gap-1"
                          >
                            <Shield className="w-3 h-3" /> Mark Verified
                          </button>
                        )}
                        {kyc.status !== 'rejected' && (
                          <button
                            onClick={() =>
                              onRequestAudit(
                                'KYC Verification',
                                kyc.businessName,
                                'KYC Status',
                                kyc.status,
                                'rejected',
                                () => onUpdateKycStatus(kyc.id, 'rejected')
                              )
                            }
                            className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded text-[10px] font-mono flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. DUPLICATE SHOP DETECTION */}
      {subSection === 'duplicates' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Duplicate Shop Detection</h3>
              <p className="text-xs font-mono text-gray-400">Automated algorithmic geo-proximity & telephone collision detection</p>
            </div>
          </div>

          <div className="space-y-3">
            {duplicateShops.map((dup) => (
              <div key={dup.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-red-500/30 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="font-mono text-xs text-white font-semibold">
                      Match Confidence: <span className="text-red-400">{dup.matchScore}%</span>
                    </span>
                    <span className="text-[10px] font-mono bg-red-950/60 text-red-300 px-2 py-0.5 rounded border border-red-500/40">
                      FLAGGED DUPLICATE
                    </span>
                  </div>
                  <span className="text-xs font-mono text-gray-400">Distance: {dup.geoDistance}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 bg-black/60 rounded border border-white/10">
                    <span className="text-[10px] text-gray-500 block uppercase">Candidate Submission:</span>
                    <div className="text-white font-medium">{dup.candidateName}</div>
                    <div className="text-gray-400 text-[11px] mt-1">{dup.phone}</div>
                  </div>
                  <div className="p-3 bg-black/60 rounded border border-[#D4AF37]/30">
                    <span className="text-[10px] text-[#D4AF37] block uppercase">Existing Verified Salon:</span>
                    <div className="text-white font-medium">{dup.existingMatchName}</div>
                    <div className="text-gray-400 text-[11px] mt-1">Status: Active on Nexora Network</div>
                  </div>
                </div>

                <p className="text-xs text-gray-300 font-sans italic bg-white/[0.02] p-2 rounded border border-white/5">
                  Reason: {dup.reason}
                </p>

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Duplicate Shop',
                        dup.candidateName,
                        'Duplicate Status',
                        dup.status,
                        'merged',
                        () => onUpdateDuplicateStatus(dup.id, 'merged')
                      )
                    }
                    className="px-3 py-1 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 rounded text-[10px] font-mono"
                  >
                    Merge with Existing
                  </button>
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Duplicate Shop',
                        dup.candidateName,
                        'Duplicate Status',
                        dup.status,
                        'dismissed',
                        () => onUpdateDuplicateStatus(dup.id, 'dismissed')
                      )
                    }
                    className="px-3 py-1 bg-white/10 hover:bg-white/20 text-gray-300 border border-white/20 rounded text-[10px] font-mono"
                  >
                    Dismiss (Legitimate Branch)
                  </button>
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Duplicate Shop',
                        dup.candidateName,
                        'Duplicate Status',
                        dup.status,
                        'blocked',
                        () => onUpdateDuplicateStatus(dup.id, 'blocked')
                      )
                    }
                    className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/40 rounded text-[10px] font-mono"
                  >
                    Block Candidate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
