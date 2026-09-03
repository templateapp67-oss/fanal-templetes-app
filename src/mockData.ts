import { BusinessTypeOption, SalonProfile, SalonService, Stylist, Appointment, ClientRecord } from './types';
import { CATEGORY_TEMPLATES, ALL_CATEGORY_OPTIONS } from './categoryTemplates';

export const BUSINESS_TYPES: BusinessTypeOption[] = ALL_CATEGORY_OPTIONS;

// Default to Category 1: Hair Cut & Styling Studio (Miraki, Bengaluru)
const defaultTemplate = CATEGORY_TEMPLATES.hair_salon;

export const INITIAL_SALON_PROFILE: SalonProfile = {
  businessType: 'hair_salon',
  businessName: defaultTemplate.title,
  ownerName: defaultTemplate.ownerName,
  ownerRole: defaultTemplate.ownerRole,
  phone: defaultTemplate.phone,
  whatsapp: defaultTemplate.whatsapp,
  email: 'appointments@mirakihair.in',
  tagline: defaultTemplate.tagline,
  about: defaultTemplate.about,
  ownerPhotoUrl: defaultTemplate.ownerPhotoUrl,
  coverImageUrl: defaultTemplate.coverImageUrl,
  themePreset: defaultTemplate.themePreset,
  currency: '₹',
  subdomain: 'mirakistudio',
  address: defaultTemplate.defaultAddress,
  city: defaultTemplate.defaultCity,
  postalCode: defaultTemplate.defaultPostalCode,
  instagramHandle: defaultTemplate.instagramHandle,
  requireDeposit: true,
  depositPercentage: 20
};

export const INITIAL_SERVICES: SalonService[] = defaultTemplate.services;

export const INITIAL_STYLISTS: Stylist[] = defaultTemplate.stylists;

export const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: 'apt-ind-101',
    clientName: 'Pooja Mehra',
    clientPhone: '+91 98451 22910',
    clientEmail: 'pooja.mehra@gmail.com',
    serviceId: 'hs-3',
    serviceName: 'Formaldehyde-Free Keratin Smoothing',
    servicePrice: 4200,
    stylistId: 'hs-st-1',
    stylistName: 'Ananya Sharma',
    date: '2026-09-04',
    time: '11:00',
    status: 'confirmed',
    paymentStatus: 'paid_deposit',
    amountPaid: 840,
    createdAt: '2026-09-02T10:15:00Z'
  },
  {
    id: 'apt-ind-102',
    clientName: 'Siddharth Verma',
    clientPhone: '+91 98201 44589',
    clientEmail: 'siddharth.verma@techcorp.in',
    serviceId: 'hs-1',
    serviceName: 'Master Stylist Precision Cut & Blowdry',
    servicePrice: 750,
    stylistId: 'hs-st-2',
    stylistName: 'Rohan Kapoor',
    date: '2026-09-04',
    time: '14:30',
    status: 'confirmed',
    paymentStatus: 'paid_full',
    amountPaid: 750,
    createdAt: '2026-09-02T14:45:00Z'
  },
  {
    id: 'apt-ind-103',
    clientName: 'Radhika Singhania',
    clientPhone: '+91 98110 55762',
    clientEmail: 'radhika.singh@outlook.com',
    serviceId: 'hs-4',
    serviceName: 'Hair Botox Deep Fiber Reconstruction',
    servicePrice: 3600,
    stylistId: 'hs-st-3',
    stylistName: 'Kavita Deshmukh',
    date: '2026-09-05',
    time: '10:00',
    status: 'confirmed',
    paymentStatus: 'paid_deposit',
    amountPaid: 720,
    createdAt: '2026-09-03T09:20:00Z'
  },
  {
    id: 'apt-ind-104',
    clientName: 'Aditya Sen',
    clientPhone: '+91 98450 78129',
    clientEmail: 'aditya.sen@gmail.com',
    serviceId: 'hs-2',
    serviceName: 'Classic Layered Cut & Argan Wash',
    servicePrice: 450,
    stylistId: 'hs-st-2',
    stylistName: 'Rohan Kapoor',
    date: '2026-09-05',
    time: '16:00',
    status: 'confirmed',
    paymentStatus: 'pay_at_salon',
    amountPaid: 0,
    createdAt: '2026-09-03T11:00:00Z'
  }
];

export const INITIAL_CLIENTS: ClientRecord[] = [
  {
    id: 'cli-ind-1',
    name: 'Pooja Mehra',
    phone: '+91 98451 22910',
    email: 'pooja.mehra@gmail.com',
    totalVisits: 7,
    totalSpent: 18400,
    lastVisit: '2026-08-14',
    notes: 'Regular Keratin client every 3 months. Prefers herbal tea without sugar.',
    favoriteStylist: 'Ananya Sharma',
    points: 1150,
    lifetimePoints: 2190,
    loyaltyTier: 'platinum',
    pointHistory: [
      { id: 'tx-1', date: '2026-08-14', description: 'Formaldehyde-Free Keratin Smoothing Visit', pointsChange: 470, type: 'spend_earned' },
      { id: 'tx-2', date: '2026-06-10', description: 'Hair Spa Rejuvenation', pointsChange: 220, type: 'spend_earned' },
      { id: 'tx-3', date: '2026-05-02', description: 'Redeemed 20% OFF Festive Voucher', pointsChange: -750, type: 'redeemed' },
      { id: 'tx-4', date: '2026-04-12', description: 'Birthday Milestone Bonus', pointsChange: 250, type: 'bonus' },
    ],
    redeemedRewards: [
      {
        id: 'red-1',
        rewardId: 'rew-3',
        rewardTitle: '20% OFF Festive & Premium Treatments',
        discountSummary: '20% OFF',
        pointsSpent: 750,
        redeemedAt: '2026-05-02',
        couponCode: 'ROYAL20-8492',
        status: 'used',
      }
    ]
  },
  {
    id: 'cli-ind-2',
    name: 'Siddharth Verma',
    phone: '+91 98201 44589',
    email: 'siddharth.verma@techcorp.in',
    totalVisits: 5,
    totalSpent: 4250,
    lastVisit: '2026-08-20',
    notes: 'Likes razor texture on crown, sharp sideburn taper.',
    favoriteStylist: 'Rohan Kapoor',
    points: 425,
    lifetimePoints: 675,
    loyaltyTier: 'silver',
    pointHistory: [
      { id: 'tx-5', date: '2026-08-20', description: 'Precision Cut & Beard Grooming', pointsChange: 125, type: 'spend_earned' },
      { id: 'tx-6', date: '2026-07-15', description: 'Visit Loyalty Bonus', pointsChange: 50, type: 'visit_earned' },
      { id: 'tx-7', date: '2026-06-01', description: 'Welcome Onboarding Bonus', pointsChange: 100, type: 'bonus' },
    ],
  },
  {
    id: 'cli-ind-3',
    name: 'Radhika Singhania',
    phone: '+91 98110 55762',
    email: 'radhika.singh@outlook.com',
    totalVisits: 3,
    totalSpent: 9800,
    lastVisit: '2026-07-28',
    notes: 'Sensitive scalp post-coloring. Uses sulfate-free botanical shampoo only.',
    favoriteStylist: 'Kavita Deshmukh',
    points: 980,
    lifetimePoints: 1130,
    loyaltyTier: 'gold',
    pointHistory: [
      { id: 'tx-8', date: '2026-07-28', description: 'Hair Botox Reconstruction & Argan Therapy', pointsChange: 410, type: 'spend_earned' },
      { id: 'tx-9', date: '2026-05-18', description: 'Balayage Color & Gloss', pointsChange: 570, type: 'spend_earned' },
      { id: 'tx-10', date: '2026-03-02', description: 'First Visit Bonus', pointsChange: 150, type: 'bonus' },
    ],
  },
  {
    id: 'cli-ind-4',
    name: 'Aditya Sen',
    phone: '+91 98450 78129',
    email: 'aditya.sen@gmail.com',
    totalVisits: 2,
    totalSpent: 1250,
    lastVisit: '2026-08-30',
    notes: 'Prefers quiet sessions during haircuts.',
    favoriteStylist: 'Rohan Kapoor',
    points: 175,
    lifetimePoints: 175,
    loyaltyTier: 'bronze',
    pointHistory: [
      { id: 'tx-11', date: '2026-08-30', description: 'Layered Cut & Styling', pointsChange: 95, type: 'spend_earned' },
      { id: 'tx-12', date: '2026-08-01', description: 'First Visit Welcome Points', pointsChange: 80, type: 'bonus' },
    ],
  },
  {
    id: 'cli-ind-5',
    name: 'Meera Iyer',
    phone: '+91 98860 33419',
    email: 'meera.iyer@designhouse.in',
    totalVisits: 9,
    totalSpent: 26500,
    lastVisit: '2026-08-25',
    notes: 'Bridal trial scheduled in November. Loyal VIP customer.',
    favoriteStylist: 'Ananya Sharma',
    points: 1650,
    lifetimePoints: 3100,
    loyaltyTier: 'platinum',
    pointHistory: [
      { id: 'tx-13', date: '2026-08-25', description: 'Full Ayurvedic Rejuvenation Spa Package', pointsChange: 550, type: 'spend_earned' },
      { id: 'tx-14', date: '2026-07-12', description: 'Redeemed Free Deluxe Scalp Detox', pointsChange: -1200, type: 'redeemed' },
      { id: 'tx-15', date: '2026-06-05', description: 'Global Highlights & Toner', pointsChange: 650, type: 'spend_earned' },
    ],
    redeemedRewards: [
      {
        id: 'red-2',
        rewardId: 'rew-4',
        rewardTitle: 'Complimentary Scalp Detox / Hand Spa Ritual',
        discountSummary: '100% Complimentary Add-on',
        pointsSpent: 1200,
        redeemedAt: '2026-07-12',
        couponCode: 'FREESPA-4819',
        status: 'used',
      }
    ]
  }
];
