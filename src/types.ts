import type { BookingStatus } from './lib/bookingStatus';

/**
 * `bookings` is the customer's "My Bookings" page, and the only view with a
 * real URL (`/customer/bookings`). The others stay state-driven.
 */
export type AppView =
  | 'landing'
  | 'wizard'
  | 'preview'
  | 'dashboard'
  | 'bookings'
  | 'bookingDetail';

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
  | 'ayurvedic_spa'      // Ayurvedic Rejuvenation Spa
  | 'ayurvedic_wellness_spa' // Ayurvedic & Wellness Spa
  | 'luxury_hair_salon' // Premium Luxury Hair Salon
  | 'bridal_makeover_studio' // Bridal & Makeover Studio
  | 'family_salon' // Modern Unisex Family Salon
  | 'barber_grooming_club' // Gentlemen's Barber & Grooming Club
  | 'nails_lash_brow_bar' // Nails, Lash & Brow Bar
  | 'medispa_aesthetics' // Medi-Spa & Skin Aesthetics Clinic
  | 'organic_bio_salon' // Organic & Eco-Friendly Bio-Salon
  | 'express_beauty_bar' // Express & Quick Beauty Bar
  | 'thai_massage_center' // Thai & Oriental Massage Center
  | 'kids_teens_studio' // Kids & Teens Fun Hair Studio
  | 'resort_spa' // Luxury Hotel & Resort Spa
  | 'vedic_ayurveda_studio'; // Vedic Ayurveda Wellness Studio

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
  | 'ayurvedic_terracotta'
  | 'botanical_wellness'
  | 'haute_luxe'
  | 'ivory_pearl_bridal'
  | 'family_fresh'
  | 'gents_club'
  | 'berry_pearl_bar'
  | 'medispa_porcelain'
  | 'organic_meadow'
  | 'express_pop'
  | 'oriental_silk'
  | 'candy_playroom'
  | 'resort_luxe'
  | 'vedic_marigold';

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
  | 'ayurvedic_terracotta'
  | 'sage_jade_botanical'
  | 'onyx_champagne_gold'
  | 'ivory_blush_pearl'
  | 'sky_cream_family'
  | 'midnight_copper_club'
  | 'berry_blush_pearl'
  | 'porcelain_sage_teal'
  | 'fern_linen_organic'
  | 'coral_slate_express'
  | 'temple_saffron_silk'
  | 'cotton_candy_sky'
  | 'azure_champagne_luxe'
  | 'marigold_warm_sand';

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

export type PromoBannerTheme = 
  | 'gradient_purple'
  | 'royal_gold'
  | 'rose_velvet'
  | 'emerald_botanical'
  | 'obsidian_glam'
  | 'sunset_coral'
  | 'custom';

export interface PromotionalBannerConfig {
  enabled: boolean;
  text: string;
  discountCode?: string;
  badgeText?: string;
  buttonText?: string;
  buttonAction?: 'book' | 'copy';
  themePreset?: PromoBannerTheme;
  customBgColor?: string;
  customTextColor?: string;
  startDate?: string;
  endDate?: string;
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
  promotionalBanner?: PromotionalBannerConfig;
  instagramHandle: string;
  facebookPage?: string;
  youtubeChannel?: string;
  tiktokProfile?: string;
  tiktokHandle?: string;
  tiktokUrl?: string;
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

/**
 * Booking lifecycle: pending -> confirmed -> completed, with cancelled and
 * no_show as the two terminal "did not happen" outcomes. `no_show` is distinct
 * from `cancelled` because the money is treated differently — a customer who
 * cancels may be refunded, one who never turns up forfeits the advance.
 *
 * The canonical list (labels, colours, descriptions) lives in
 * `src/lib/bookingStatus.ts`, which the server handlers import too.
 */
export type AppointmentStatus = BookingStatus;

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
  status: AppointmentStatus;
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
  /** Points credited at check-in when the visit date matches the customer's birthday (0 disables). */
  birthdayBonusPoints?: number;
  /** Points credited to the referrer wallet when a referred booking is checked in (0 disables). */
  referralBonusPoints?: number;
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

export interface ReengagementRecommendation {
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  daysInactive: number;
  lastVisitDate: string;
  lastServiceName: string;
  lastStylistName: string;
  suggestedServiceName: string;
  discountOffer: string;
  discountPercent?: number;
  urgencyLevel: 'critical' | 'high' | 'medium';
  urgencyReason: string;
  churnRiskAnalysis: string;
  personalizedWhatsApp: string;
  personalizedSms: string;
  loyaltyTier: LoyaltyTier;
  estimatedRecoverableValue: number;
}

export interface ReengagementAnalysisResult {
  totalInactiveCount: number;
  potentialRecoverableRevenue: number;
  averageInactiveDays: number;
  campaignTheme: string;
  topInsights: string[];
  recommendations: ReengagementRecommendation[];
  generatedAt: string;
  modelUsed?: string;
}

