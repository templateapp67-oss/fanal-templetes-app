export type AppView = 'landing' | 'wizard' | 'preview' | 'dashboard';

export type BusinessTypeId = 
  | 'hair_salon'         // Hair Cut & Styling Studio
  | 'barber'             // Barber Shop / Men's Grooming
  | 'unisex_salon'       // Unisex Salon
  | 'beauty_parlour'     // Beauty Parlour
  | 'nail_studio'        // Nail Studio
  | 'hair_spa'           // Hair Spa & Treatment
  | 'skincare_clinic'    // Facial & Skincare Clinic
  | 'makeup_studio'      // Makeup Studio
  | 'massage_wellness'   // Massage & Wellness Center
  | 'hair_coloring'      // Hair Coloring Studio
  | 'bridal_lounge'      // Bridal Makeup & Makeover Lounge
  | 'tattoo_studio'      // Tattoo & Body Art Studio
  | 'lash_brow'          // Lash & Brow Bar
  | 'ayurvedic_spa';     // Ayurvedic Rejuvenation Spa

export type LayoutStyle = 
  | 'modern_minimalist'
  | 'vintage_industrial'
  | 'contemporary_balanced'
  | 'curved_elegant'
  | 'bento_grid'
  | 'zen_emerald'
  | 'clinical_clean'
  | 'dark_glam'
  | 'earth_bamboo'
  | 'creative_gallery'
  | 'royal_crimson'
  | 'urban_monochrome'
  | 'chic_nude'
  | 'ayurvedic_terracotta';

export interface BusinessTypeOption {
  id: BusinessTypeId;
  title: string;
  categoryTag: string;
  icon: string;
  aestheticDescription: string;
  description?: string;
  paletteName: string;
  badge: string;
  defaultServices: Array<{ name: string; price: number; duration: number; category: string }>;
}

export type SalonThemePreset = 
  | 'slate_silver'
  | 'vintage_brass'
  | 'pastel_blush'
  | 'rose_gold_ivory'
  | 'neon_gloss_bento'
  | 'emerald_sage'
  | 'clinical_sky_blue'
  | 'obsidian_gold'
  | 'earth_bamboo'
  | 'chroma_gradient'
  | 'royal_crimson_gold'
  | 'urban_monochrome'
  | 'chic_nude_beige'
  | 'ayurvedic_terracotta';

export interface CategoryTemplateConfig {
  id: BusinessTypeId;
  title: string;
  shortName: string;
  tagline: string;
  about: string;
  icon: string;
  layoutStyle: LayoutStyle;
  paletteLabel: string;
  themePreset: SalonThemePreset;
  subCategories: string[];
  defaultCity: string;
  defaultAddress: string;
  defaultPostalCode: string;
  phone: string;
  whatsapp: string;
  ownerName: string;
  ownerRole: string;
  ownerPhotoUrl: string;
  coverImageUrl: string;
  instagramHandle: string;
  themeStyle: {
    heroBackground: string;
    heroTextColor: string;
    cardBorder: string;
    cardBackground: string;
    cardRadius: string;
    accentColor: string;
    accentBg: string;
    badgeBg: string;
    badgeText: string;
    buttonBg: string;
    buttonText: string;
    priceColor: string;
    isDark?: boolean;
    headerBanner?: string;
  };
  services: SalonService[];
  stylists: Stylist[];
}

export type VideoCategoryTag = 'SHOWCASE' | 'SHORT' | 'LONG';

export interface SocialVideo {
  id: string;
  youtubeUrl: string;
  videoId: string;
  title: string;
  description?: string;
  channelTitle?: string;
  thumbnailUrl: string;
  categoryTag: VideoCategoryTag;
  isOwnerVideo: boolean; // true if added by owner ("yours"), false for default ("showcase")
  views?: string;
  transformationTag?: string;
}

export interface HomeServiceConfig {
  enabled: boolean;
  baseCharge: number;
  radiusLimitKm: number;
}

export interface SalonProfile {
  ownerId?: string;
  businessType: BusinessTypeId;
  businessName: string;
  ownerName: string;
  ownerRole: string;
  phone: string;
  whatsapp: string;
  email: string;
  tagline: string;
  about: string;
  ownerPhotoUrl: string;
  coverImageUrl: string;
  logoUrl?: string;
  themePreset: SalonThemePreset;
  currency: string;
  subdomain: string;
  customDomain?: string;
  address: string;
  city: string;
  postalCode: string;
  shopFlatNo?: string;
  areaLocality?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  homeService?: HomeServiceConfig; // Added this
  instagramHandle: string;
  facebookPage?: string;
  youtubeChannel?: string;
  tiktokProfile?: string;
  googleBusinessUrl?: string;
  socialVideos?: SocialVideo[];
  requireDeposit: boolean;
  depositPercentage: number;
  themeAccentKey?: string;
  customAccentColor?: string;
  landmark?: string;
  foundingYear?: string;
  workingHoursMonFri?: string;
  workingHoursSat?: string;
  workingHoursSun?: string;
  whiteLabelEnabled?: boolean;
}

export interface SalonService {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  description: string;
  icon: string;
  popular?: boolean;
  showDuration?: boolean; // Defaults to true if undefined. When false, duration is hidden on public website menu.
}

export type StaffAccessRole = 'Service Provider (Assigned)' | 'Manager (Full Access)' | 'Receptionist (Frontdesk)';
export type StaffStatus = 'Available' | 'Busy' | 'On Leave' | 'Inactive';

export interface DaySchedule {
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  enabled: boolean;
  fromTime: string;
  toTime: string;
}

export interface Stylist {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
  specialties: string[];
  rating: number;
  phone?: string;
  commissionRate?: number;
  status?: StaffStatus;
  accessRole?: StaffAccessRole;
  hidePhone?: boolean;
  assignedServices?: string[];
  bio?: string;
  schedule?: DaySchedule[];
}

export interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  stylistId: string;
  stylistName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  status: 'confirmed' | 'completed' | 'cancelled' | 'pending';
  paymentStatus: 'paid_deposit' | 'paid_full' | 'pay_at_salon';
  amountPaid: number;
  createdAt: string;
}

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface RewardThreshold {
  id: string;
  title: string;
  requiredPoints: number;
  rewardType: 'percentage_discount' | 'flat_discount' | 'free_service';
  discountValue: number; // e.g. 15 for 15% or 300 for ₹300 OFF
  applicableCategory?: string;
  description: string;
  isActive: boolean;
  couponCodePrefix: string;
}

export interface LoyaltyConfig {
  programEnabled: boolean;
  pointsPerVisit: number;
  pointsPerHundredSpent: number;
  tierThresholds: {
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  tierMultipliers: {
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  rewards: RewardThreshold[];
}

export interface PointTransaction {
  id: string;
  date: string;
  description: string;
  pointsChange: number;
  type: 'visit_earned' | 'spend_earned' | 'bonus' | 'redeemed';
}

export interface RedeemedReward {
  id: string;
  rewardId: string;
  rewardTitle: string;
  discountSummary: string;
  pointsSpent: number;
  redeemedAt: string;
  couponCode: string;
  status: 'active' | 'used';
}

export interface ClientRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalVisits: number;
  totalSpent: number;
  lastVisit: string;
  notes: string;
  favoriteStylist: string;
  points: number;
  lifetimePoints: number;
  loyaltyTier: LoyaltyTier;
  pointHistory?: PointTransaction[];
  redeemedRewards?: RedeemedReward[];
}
