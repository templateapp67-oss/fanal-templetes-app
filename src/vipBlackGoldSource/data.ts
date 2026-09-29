import { SalonTemplate, AnalyticsMetric } from './types';

export const salonTemplates: SalonTemplate[] = [
  {
    id: 'letoile',
    name: "L'Étoile Hair Lounge",
    tagline: "High-Fashion Hair Sculpture & Balayage",
    slug: "letoile",
    theme: "Noir Gold Prestige",
    bgGrad: "from-[#0A0A0A] via-[#111111] to-[#050505]",
    accentColor: "#D4AF37",
    services: [
      { id: 'let-1', name: 'Signature French Gold Balayage', description: 'Bespoke hand-painted dimensional gold illumination paired with micro-keratin shield.', price: 18500, duration: 180, category: 'Hair Artistry' },
      { id: 'let-2', name: 'Royal Caviar Crown Therapy', description: 'Scalp detoxification infused with French white caviar extracts and warm gold mist infusion.', price: 9500, duration: 90, category: 'Scalp Wellness' },
      { id: 'let-3', name: 'Couture Precision Cut & Styling', description: 'Master-level sculptural cut adjusted perfectly to facial architecture, completed with signature blowout.', price: 6500, duration: 60, category: 'Sculpt & Style' }
    ],
    stylists: [
      { id: 'sty-1', name: 'Master Jean-Jacques', role: 'Global Creative Director', rating: 4.95, image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', specialties: ['Balayage', 'Precision Cuts'] },
      { id: 'sty-2', name: 'Elena Rostova', role: 'Senior Color Sculptor', rating: 4.91, image: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80', specialties: ['Color Correction', 'French Styling'] }
    ]
  },
  {
    id: 'aura',
    name: "AURA Luxury Spa",
    tagline: "Therapeutic sanctuaries of total gold stillness",
    slug: "aura-spa",
    theme: "Warm Amber Champagne",
    bgGrad: "from-[#0D0B05] via-[#050505] to-[#121008]",
    accentColor: "#F5D0A1",
    services: [
      { id: 'aur-1', name: 'Champagne & 24K Gold Body Healing', description: 'Thermal body polish utilizing crushed champagne grapes, completed with a 24-karat gold oil massage.', price: 22000, duration: 120, category: 'Body Rituals' },
      { id: 'aur-2', name: 'Elite Oxygen Facial Infusion', description: 'Hyperbaric pure oxygen serum delivery with mineral-rich thermal quartz crystals massage.', price: 14000, duration: 75, category: 'Skin Radiance' },
      { id: 'aur-3', name: 'Sound Bath & Obsidian Stone Massage', description: 'Vibrational alignment backed by heated volcanic obsidian basalt stone tissue release.', price: 11000, duration: 90, category: 'Mind Stillness' }
    ],
    stylists: [
      { id: 'sty-3', name: 'Anya Sen', role: 'Vibrational Therapist', rating: 4.98, image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80', specialties: ['Obsidian Release', 'Energy Baths'] },
      { id: 'sty-4', name: 'Aditya Vardhan', role: 'Wellness Alchemist', rating: 4.96, image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', specialties: ['Gold Infusions', 'Deep Aromatherapy'] }
    ]
  },
  {
    id: 'obsidian',
    name: "The Obsidian Atelier",
    tagline: "Bespoke body illustration and high-fashion line art",
    slug: "obsidian-atelier",
    theme: "Minimalist Charcoal Steel",
    bgGrad: "from-[#040404] via-[#0A0A0A] to-[#111111]",
    accentColor: "#E5E5E5",
    services: [
      { id: 'obs-1', name: 'Bespoke Fine-Line Illustration', description: 'Luxury custom illustrative sketching directly onto skin, rendered with elite hypoallergenic pigments.', price: 25000, duration: 180, category: 'Luxury Ink' },
      { id: 'obs-2', name: 'Polynesian Geometric Micro-Art', description: 'Complex mathematically aligned geometric patterns with supreme grey-wash details.', price: 15500, duration: 120, category: 'Traditional Ink' },
      { id: 'obs-3', name: 'Luxury Jewelry Restructuring', description: 'Anatomically matched premium solid gold and titanium micro-body-piercing artistry.', price: 8500, duration: 45, category: 'Structural Gems' }
    ],
    stylists: [
      { id: 'sty-5', name: 'Sven Lindqvist', role: 'Lead Resident Artist', rating: 4.99, image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80', specialties: ['Single-needle Lineart', 'Geometric Realism'] },
      { id: 'sty-6', name: 'Zara Blackwood', role: 'Bespoke Jewelry Alchemist', rating: 4.94, image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80', specialties: ['Microdermal Studding', 'Fine Gold Styling'] }
    ]
  }
];

export const mockAnalytics: AnalyticsMetric[] = [
  { date: 'Mon', revenue: 245000, bookings: 32, retentionRate: 88 },
  { date: 'Tue', revenue: 289000, bookings: 39, retentionRate: 91 },
  { date: 'Wed', revenue: 354000, bookings: 44, retentionRate: 94 },
  { date: 'Thu', revenue: 412000, bookings: 51, retentionRate: 95 },
  { date: 'Fri', revenue: 589000, bookings: 68, retentionRate: 97 },
  { date: 'Sat', revenue: 742000, bookings: 89, retentionRate: 98 },
  { date: 'Sun', revenue: 810000, bookings: 95, retentionRate: 99 }
];

export const sampleRetentionCampaign = {
  inactiveCount: 14,
  churnRiskAverage: "84%",
  draftedMessage: "Greetings from L'Étoile. We have noticed your reservation patterns suggest. A dedicated VIP velvet suite is reserved for you on Thursday evening with 20% elite credit. Please review to trigger dispatch.",
  sentChannels: ["WhatsApp Private Line", "Bespoke concierge SMS"],
};
