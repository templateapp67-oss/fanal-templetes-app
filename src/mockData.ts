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
    favoriteStylist: 'Ananya Sharma'
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
    favoriteStylist: 'Rohan Kapoor'
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
    favoriteStylist: 'Kavita Deshmukh'
  }
];
