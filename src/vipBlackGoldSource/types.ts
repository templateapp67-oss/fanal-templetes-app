export interface Service {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  category: string;
}

export interface Stylist {
  id: string;
  name: string;
  role: string;
  rating: number;
  image: string;
  specialties: string[];
}

export interface SalonTemplate {
  id: string;
  name: string;
  tagline: string;
  slug: string;
  theme: string;
  bgGrad: string;
  accentColor: string;
  services: Service[];
  stylists: Stylist[];
}

export interface AnalyticsMetric {
  date: string;
  revenue: number;
  bookings: number;
  retentionRate: number;
}
