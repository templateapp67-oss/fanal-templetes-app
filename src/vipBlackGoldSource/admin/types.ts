export interface AuditLogEntry {
  id: string;
  adminName: string;
  timestamp: string;
  entityType: string;
  entityId: string;
  entityName: string;
  fieldChanged: string;
  oldValue: string;
  newValue: string;
  changeReason: string;
}

export interface GrowthPartner {
  id: string;
  name: string;
  phone: string;
  email: string;
  region: string;
  salonsReferred: number;
  commissionRate: string;
  tier: 'Gold' | 'Platinum' | 'Diamond';
  status: 'pending' | 'approved' | 'rejected';
  appliedDate: string;
  turnoverContribution: number;
}

export interface ShopOnboarding {
  id: string;
  salonName: string;
  ownerName: string;
  phone: string;
  city: string;
  category: string;
  monthlyTurnover: string;
  interiorPhoto: string;
  status: 'pending_review' | 'approved' | 'action_required' | 'rejected';
  submittedDate: string;
  notes: string;
}

export interface KycVerification {
  id: string;
  applicantName: string;
  businessName: string;
  panNumber: string;
  gstNumber: string;
  aadhaarNumber: string;
  docType: 'GSTIN + PAN' | 'Aadhaar + Trade License' | 'CIN + PAN';
  status: 'pending' | 'verified' | 'rejected';
  verifiedDate?: string;
  rejectionReason?: string;
}

export interface QrActivation {
  id: string;
  terminalCode: string;
  salonId: string;
  salonName: string;
  deskNumber: string;
  upiVpa: string;
  status: 'active' | 'inactive' | 'frozen';
  hardwareModel: string;
  lastPing: string;
  activatedAt?: string;
}

export interface DailyTransaction {
  id: string;
  txnId: string;
  date: string;
  time: string;
  salonName: string;
  clientName: string;
  serviceRendered: string;
  grossAmount: number;
  commission10: number;
  netPayoutToSalon: number;
  paymentMode: 'Gold QR UPI' | 'Escrow Vault' | 'Concierge Card';
  status: 'settled' | 'in_escrow' | 'pending';
}

export interface SettlementRecord {
  id: string;
  cycleCode: string;
  salonName: string;
  grossVolume: number;
  commission10: number;
  tdsDeducted: number;
  netPayable: number;
  status: 'pending' | 'confirmed' | 'released';
  utrNumber?: string;
  dueDate: string;
  confirmedDate?: string;
}

export interface Automated15DayCounter {
  id: string;
  salonName: string;
  cycleStart: string;
  cycleEnd: string;
  daysRemaining: number;
  autoTriggerDate: string;
  accruedAmount: number;
  cycleNumber: number;
  status: 'counting' | 'matured' | 'disbursed';
}

export interface MilestonePlusOne {
  id: string;
  partnerOrSalon: string;
  role: 'Growth Partner' | 'Luxury Salon';
  currentCount: number;
  targetCount: number;
  plusOneMilestoneName: string;
  bonusReward: string;
  plusOneStatus: 'pending_validation' | 'validated' | 'bonus_unlocked';
  validationDoc: string;
}

export interface DuplicateShop {
  id: string;
  candidateName: string;
  existingMatchName: string;
  matchScore: number;
  phone: string;
  geoDistance: string;
  reason: string;
  status: 'flagged' | 'merged' | 'dismissed' | 'blocked';
}

export interface FraudAlert {
  id: string;
  severity: 'critical' | 'high' | 'moderate';
  type: string;
  entityName: string;
  flaggedAmount: number;
  description: string;
  timestamp: string;
  status: 'investigating' | 'frozen' | 'cleared';
}

export interface RewardClaim {
  id: string;
  claimantName: string;
  role: 'Growth Partner' | 'Salon Master';
  tierLevel: string;
  rewardTitle: string;
  claimDate: string;
  status: 'submitted' | 'approved' | 'rejected' | 'dispatched';
  dispatchTracking?: string;
}

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stockUnits: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  luxuryGrade: string;
}

export interface VendorDealer {
  id: string;
  vendorName: string;
  contactPerson: string;
  contactPhone: string;
  category: string;
  rating: number;
  slaTerms: string;
  contractExpiry: string;
  status: 'active' | 'under_review' | 'paused';
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  salonOrVendor: string;
  invoiceDate: string;
  grossAmount: number;
  gstAmount: number;
  type: 'Platform 10% Fee' | 'Hardware Terminal' | 'Supply Wholesale';
  fileAttachment: string;
  status: 'verified' | 'pending_review' | 'rejected';
}

export interface TaxTdsStatus {
  id: string;
  entityName: string;
  pan: string;
  grossTurnover: number;
  tdsSection: '194O (1% E-comm)' | '194C (2% Contractor)' | '194J (10% Tech)';
  tdsAmount: number;
  challanNumber: string;
  quarter: string;
  status: 'deposited' | 'pending_challan' | 'certificate_issued';
}

export interface DispatchRecord {
  id: string;
  awbNumber: string;
  recipientName: string;
  salonName: string;
  destinationCity: string;
  packageType: string;
  courierPartner: string;
  dispatchDate: string;
  status: 'in_transit' | 'out_for_delivery' | 'delivered';
}

export interface VehicleRecord {
  id: string;
  vehicleNumber: string;
  model: string;
  driverName: string;
  driverPhone: string;
  assignedRole: 'VIP Guest Pick-Up Chauffeur' | 'Express Supply Courier' | 'Executive Hub Fleet';
  inspectionStatus: 'certified' | 'pending_audit' | 'renewal_due';
  permitExpiry: string;
}

export interface ComplaintAppeal {
  id: string;
  ticketId: string;
  filedBy: string;
  role: 'Guest VIP' | 'Salon Owner' | 'Growth Partner';
  priority: 'critical' | 'high' | 'normal';
  subject: string;
  details: string;
  status: 'open' | 'in_arbitration' | 'resolved' | 'escalated';
  resolutionNotes?: string;
  filedDate: string;
}
