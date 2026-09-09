// ============================================================================
// Multi-tenant site resolution and mapping (shared by dev server.ts and
// Vercel serverless api/index.ts).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalonProfile, SalonService, Stylist } from '../src/types.js';
import { runDb, DEFAULT_DB_TIMEOUT_MS } from './dbGuard.js';


export const DEMO_SUBDOMAINS = new Set([
  'arts-by-uma',
  'artsbyuma',
  'mirakistudio',
  'demo',
  'test',
]);

export function slugifySalonName(name: string): string {
  const base = (name || 'mysalon')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  const cleaned = base.replace(/^[0-9]+/, '');
  return (cleaned.slice(0, 30) || 'mysalon').replace(/^-+$/, 'mysalon');
}

export const artsByUmaSalon: {
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
} = {
  profile: {
    ownerId: null,
    businessType: 'hair_salon',
    businessName: 'Arts By Uma',
    ownerName: 'Uma',
    ownerRole: 'Founder & Master Stylist',
    phone: '+91 98450 77654',
    whatsapp: '+91 98450 77654',
    email: 'hello@artsbyuma.com',
    tagline: 'Precision Cuts, Creative Hair Artistry & Luxury Nail Lounge',
    about:
      'Welcome to Arts By Uma. Founded by Uma, our boutique studio brings together master precision haircuts, bespoke balayage, sculpted gel nail art, and restorative hair spa therapies in a luxury sanctuary. We craft personalized looks that elevate your confidence and natural beauty.',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
    themePreset: 'slate_silver',
    currency: '₹',
    subdomain: 'arts-by-uma',
    address: '100 Feet Road, 12th Main, Indiranagar',
    city: 'Bengaluru',
    postalCode: '560038',
    state: 'Karnataka',
    instagramHandle: 'arts_by_uma',
    requireDeposit: true,
    depositPercentage: 20,
    themeAccentKey: 'slate',
    whiteLabelEnabled: true,
  },
  services: [
    { id: 'hs-1', name: 'Master Stylist Precision Cut & Blowdry', category: 'Hair Artistry', description: 'Sculpted haircut tailored to face geometry, invigorating scalp wash, and professional salon blowout.', icon: 'scissors', price: 750, durationMinutes: 45, popular: true, showDuration: true },
    { id: 'hs-2', name: 'Classic Layered Cut & Argan Wash', category: 'Hair Artistry', description: 'Texturizing layers, split-end removal, and deep cleanse with organic Moroccan argan oil shampoo.', icon: 'scissors', price: 450, durationMinutes: 35, popular: false, showDuration: true },
    { id: 'hs-3', name: 'Signature Caramel Balayage & Olaplex Glaze', category: 'Color Alchemy', description: 'Custom hand-painted multidimensional caramel, copper, or hazelnut highlights with bonded Olaplex protection.', icon: 'sparkles', price: 5200, durationMinutes: 150, popular: true, showDuration: true },
    { id: 'hs-4', name: 'Full Set Gel-X Sculpted Extensions & Nail Art', category: 'Nail Couture', description: 'Damage-free soft gel tips custom fitted to your natural nail bed with custom handpainted art and glossy UV seal.', icon: 'sparkles', price: 2400, durationMinutes: 90, popular: true, showDuration: true },
    { id: 'hs-5', name: 'Formaldehyde-Free Keratin Smoothing', category: 'Treatments', description: 'Infuses active keratin proteins, eliminating 95% frizz with mirror-like shine for up to 14 weeks.', icon: 'sparkles', price: 4200, durationMinutes: 120, popular: true, showDuration: true },
    { id: 'hs-6', name: 'Hair Botox Deep Fiber Reconstruction', category: 'Treatments', description: 'Intense peptide filler mask for chemically damaged or heat-stressed hair fibers.', icon: 'sparkles', price: 3600, durationMinutes: 90, popular: false, showDuration: true },
    { id: 'hs-7', name: 'Red Carpet HD Glass Skin & Party Makeover', category: 'Editorial Glam', description: 'Flawless camera-ready HD base, soft contour, winged eyeliner, and magnetic flutter lashes.', icon: 'sparkles', price: 4500, durationMinutes: 75, popular: true, showDuration: true },
    { id: 'hs-8', name: 'Russian Dry Cuticle Precision Manicure', category: 'Nail Couture', description: 'E-file precision diamond bit cuticle cleanup, keratin basecoat, and high-shine gel polish.', icon: 'sparkles', price: 1100, durationMinutes: 60, popular: false, showDuration: true },
    { id: 'hs-9', name: 'Express Glow Organic Cleanup & De-Tan', category: 'Skin & Spa', description: 'Gentle fruit peel scrub, pore steam, blackhead removal, and saffron brightening mask.', icon: 'sparkles', price: 850, durationMinutes: 40, popular: false, showDuration: true },
  ],
  stylists: [
    { id: 'hs-st-uma', name: 'Uma', role: 'Founder & Master Stylist', avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80', bio: 'Founder with 12+ years of experience. Specializes in precision structural cuts, dimensional color, and bespoke nail couture.', phone: '+91 98450 77654', specialties: ['Structural Cuts', 'Balayage Color', 'Keratin Smoothing', 'Gel-X Extensions'], assignedServices: ['hs-1', 'hs-3', 'hs-4', 'hs-5', 'hs-7'], rating: 4.98, commissionRate: 35, status: 'Available', accessRole: 'Manager (Full Access)', hidePhone: false, schedule: [] },
    { id: 'hs-st-1', name: 'Ananya Sharma', role: 'Senior Precision Stylist', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', bio: 'Senior colorist and stylist with extensive background in balayage, ombre, and volume blowouts.', phone: '+91 98450 12890', specialties: ['Precision Fringes', 'Balayage & Color', 'Volume Blowouts'], assignedServices: ['hs-1', 'hs-2', 'hs-3', 'hs-5'], rating: 4.95, commissionRate: 30, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-2', name: 'Rohan Kapoor', role: 'Stylist & Hair Craftsman', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', bio: 'Men and women haircut specialist with expertise in dry cutting, skin fades, and textured styling.', phone: '+91 98450 33412', specialties: ['Dry Cutting', 'Men & Women Styling', 'Fade Geometry'], assignedServices: ['hs-1', 'hs-2', 'hs-6'], rating: 4.92, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-3', name: 'Kavita Deshmukh', role: 'Hair Texture & Scalp Specialist', avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&w=400&q=80', bio: 'Trichology-trained scalp and hair botox specialist focusing on restorative therapies.', phone: '+91 98450 99881', specialties: ['Hair Botox', 'Scalp Analysis', 'Thermal Tongs'], assignedServices: ['hs-5', 'hs-6', 'hs-9'], rating: 4.89, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
  ],
};

export interface SiteLookupDeps {
  db: SupabaseClient<any, any, any>;
  isMockSupabase: boolean;
  mockSalons: Record<string, any>;
}

/**
 * Map a Supabase row (from either the `salons` table or the legacy `profiles`
 * table) to the app's SalonProfile shape.
 */
export function mapProfileRow(row: any): SalonProfile {
  if (!row) return artsByUmaSalon.profile;

  const config = row.data?.editor_profile && typeof row.data.editor_profile === 'object' ? row.data.editor_profile : {};
  const data = { ...(row.data || {}), ...Object.fromEntries(Object.entries(config).map(([key,value]) => [key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value])) };
  const workingHours = data.working_hours || row.working_hours || {};
  const businessName = row.salon_name || row.name || '';
  const phone = row.phone_number ?? row.phone ?? row.mobile ?? '';
  const whatsapp = row.whatsapp || phone;
  const subdomain = row.slug || row.subdomain || slugifySalonName(businessName);
  const city = row.city ?? row.location_city ?? '';
  const address = row.full_address ?? row.address ?? row.location_address ?? '';
  const postalCode = row.postal_code ?? row.pincode ?? row.location_pincode ?? '';
  const state = row.state ?? '';

  return {
    ...config,
    workingHoursMonFri: workingHours.monFri || (row.opening_time ? `${row.opening_time} - ${row.closing_time}` : ''),
    workingHoursSat: workingHours.saturday || '',
    workingHoursSun: workingHours.sunday || '',
    homeService: row.home_service || data.home_service || undefined,
    ownerId: row.owner_id || (row.salon_name ? row.id : undefined),
    businessType: (row.business_type || row.business_category || row.category || data.business_type || 'hair_salon') as SalonProfile['businessType'],
    businessName,
    ownerName: row.full_name || data.owner_name || '',
    ownerRole: row.owner_role || data.owner_role || '',
    phone,
    whatsapp,
    email: row.email ?? '',
    tagline: row.tagline || data.tagline || '',
    about: row.about || data.about || row.description || '',
    ownerPhotoUrl: row.owner_photo_url || data.owner_photo_url || '',
    coverImageUrl: row.cover_image_url || row.cover_url || row.cover_image_path || data.cover_image_url || '',
    logoUrl: row.logo_url || row.logo_path || data.logo_url || undefined,
    themePreset: (row.theme_preset || data.theme_preset || 'slate_silver') as SalonProfile['themePreset'],
    currency: row.currency || '₹',
    subdomain,
    customDomain: row.custom_domain || data.custom_domain || undefined,
    address,
    city,
    postalCode,
    areaLocality: row.area ?? config.areaLocality ?? '',
    state,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    instagramHandle: row.instagram_handle || data.instagram_handle || '',
    facebookPage: row.facebook_page || data.facebook_page || undefined,
    youtubeChannel: row.youtube_channel || data.youtube_channel || undefined,
    tiktokProfile: row.tiktok_profile || data.tiktok_profile || undefined,
    googleBusinessUrl: row.google_business_url || data.google_business_url || undefined,
    requireDeposit: row.require_deposit ?? data.require_deposit ?? false,
    depositPercentage: row.deposit_percentage ?? data.deposit_percentage ?? 20,
    themeAccentKey: row.theme_accent_key || data.theme_accent_key || 'slate',
    customAccentColor: row.custom_accent_color || data.custom_accent_color || undefined,
    landmark: row.landmark || row.location_landmark || undefined,
    foundingYear: row.founding_year || data.founding_year || undefined,
    whiteLabelEnabled: row.white_label_enabled ?? true,
  };
}

export function mapServiceRow(row: any): SalonService {
  const price = Number(row?.price_paise != null ? row.price_paise / 100 : row?.price ?? 0);
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'General',
    description: row.description || '',
    icon: row.icon || 'sparkles',
    price,
    durationMinutes: row.duration_minutes ?? 45,
    popular: row.popular ?? row.is_featured ?? false,
    showDuration: row.show_duration ?? true,
  };
}

export function mapStylistRow(row: any): Stylist {
  return {
    id: row.id,
    name: row.name || row.full_name || 'Service Provider',
    role: row.role || row.role_title || row.primary_role || 'Service Provider',
    avatarUrl: row.avatar_url || row.profile_photo_url || row.avatar_path || '',
    bio: row.bio || '',
    phone: row.phone || '',
    specialties: Array.isArray(row.specialties) ? row.specialties : (row.specialty ? [row.specialty] : []),
    assignedServices: Array.isArray(row.assigned_services) ? row.assigned_services : [],
    rating: Number(row.rating ?? row.rating_average ?? 5),
    commissionRate: Number(row.commission_rate ?? row.commission_percent ?? 0),
    status: row.status || (row.employment_status === 'active' ? 'Available' : 'Unavailable'),
    accessRole: row.access_role || 'Service Provider (Assigned)',
    hidePhone: row.hide_phone ?? false,
    schedule: Array.isArray(row.schedule) ? row.schedule : [],
  };
}

/**
 * Resolve a salon and its catalogue by subdomain or custom domain.
 * Live reads use the normalized salon catalogue and propagate database failures.
 * Demo presets are available only in explicit mock mode.
 */
export async function lookupSalon(
  deps: SiteLookupDeps,
  identifier: string,
  isCustomDomain = false,
  deadlineAt?: number
): Promise<{ found: boolean; salon: any; error?: any }> {
  const sub = identifier.toLowerCase().trim();
  if (!sub) return { found: false, salon: null };

  if (deps.isMockSupabase) {
    const s = deps.mockSalons[sub] || (DEMO_SUBDOMAINS.has(sub) ? artsByUmaSalon : null);
    return { found: !!s, salon: s || null };
  }

  try {
    const queryCol = isCustomDomain ? 'data->editor_profile->>customDomain' : 'slug';
    const salonRes = await runDb(
      () => deps.db.from('salons').select('*').eq(queryCol, sub).eq('is_active', true).maybeSingle(),
      { label: 'public salon lookup', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    );
    if (salonRes.error) return { found: false, salon: null, error: salonRes.error };
    if (!salonRes.data) return { found: false, salon: null };
    const salonRow = salonRes.data;
    const [servicesRes, staffRes] = await Promise.all([
      runDb(() => deps.db.from('services').select('*').eq('salon_id', salonRow.id).eq('is_active', true).eq('is_bookable_online', true).order('display_order'),
        { label: 'public salon services', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }),
      runDb(() => deps.db.from('staff').select('id,name,full_name,role_title,bio,avatar_path,profile_photo_url,employment_status,staff_services(service_id,is_active)').eq('salon_id', salonRow.id).eq('is_active', true).eq('is_public', true),
        { label: 'public salon staff', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }),
    ]);
    if (servicesRes.error || staffRes.error) return { found: false, salon: null, error: servicesRes.error || staffRes.error };
    return { found: true, salon: {
      profile: mapProfileRow(salonRow),
      services: (servicesRes.data || []).map(mapServiceRow),
      stylists: (staffRes.data || []).map(row => mapStylistRow({ ...row, hide_phone: true,
        assigned_services: (row.staff_services || []).filter((link: any) => link.is_active).map((link: any) => link.service_id) })),
    } };
  } catch (error) {
    return { found: false, salon: null, error };
  }
}
