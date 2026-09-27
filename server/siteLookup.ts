// ============================================================================
// Multi-tenant site resolution and mapping (shared by dev server.ts and
// Vercel serverless api/index.ts).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalonProfile, SalonService, Stylist } from '../src/types.js';
import { runDb, DEFAULT_DB_TIMEOUT_MS } from './dbGuard.js';


export const DEMO_SUBDOMAINS = new Set([
  'luxe-hair-studio',
  'luxestudio',
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

/** Trim and case-normalize a public site identifier without inventing a slug. */
export function normalizeSiteIdentifier(identifier: unknown): string {
  return String(identifier ?? '').trim().toLowerCase();
}

function isIgnorableLookupSchemaError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('could not find') ||
    message.includes('column') && message.includes('schema cache')
  );
}

export const defaultDemoSalon: {
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
} = {
  profile: {
    ownerId: null,
    businessType: 'hair_salon',
    businessName: 'Nexora Hair Studio',
    ownerName: 'Studio Director',
    ownerRole: 'Founder & Master Stylist',
    phone: '+91 98000 00000',
    whatsapp: '+91 98000 00000',
    email: 'contact@nexora.in',
    tagline: 'Precision Cuts, Creative Hair Artistry & Luxury Salon Lounge',
    about:
      'Welcome to our boutique studio. We bring together master precision haircuts, bespoke balayage, sculpted gel nail art, and restorative hair spa therapies in a luxury sanctuary. We craft personalized looks that elevate your confidence and natural beauty.',
    ownerPhotoUrl: '',
    coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
    themePreset: 'slate_silver',
    currency: '₹',
    subdomain: 'demo',
    address: '100 Feet Road, 12th Main, Indiranagar',
    city: 'Bengaluru',
    postalCode: '560038',
    state: 'Karnataka',
    instagramHandle: 'nexorastudio',
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
    { id: 'hs-st-10', name: 'Elena', role: 'Founder & Master Stylist', avatarUrl: '', bio: 'Founder with 12+ years of experience. Specializes in precision structural cuts, dimensional color, and bespoke nail couture.', phone: '+91 98000 00001', specialties: ['Structural Cuts', 'Balayage Color', 'Keratin Smoothing', 'Gel-X Extensions'], assignedServices: ['hs-1', 'hs-3', 'hs-4', 'hs-5', 'hs-7'], rating: 4.98, commissionRate: 35, status: 'Available', accessRole: 'Manager (Full Access)', hidePhone: false, schedule: [] },
    { id: 'hs-st-1', name: 'Ananya Sharma', role: 'Senior Precision Stylist', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', bio: 'Senior colorist and stylist with extensive background in balayage, ombre, and volume blowouts.', phone: '+91 98000 00002', specialties: ['Precision Fringes', 'Balayage & Color', 'Volume Blowouts'], assignedServices: ['hs-1', 'hs-2', 'hs-3', 'hs-5'], rating: 4.95, commissionRate: 30, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-2', name: 'Rohan Kapoor', role: 'Stylist & Hair Craftsman', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', bio: 'Men and women haircut specialist with expertise in dry cutting, skin fades, and textured styling.', phone: '+91 98000 00003', specialties: ['Dry Cutting', 'Men & Women Styling', 'Fade Geometry'], assignedServices: ['hs-1', 'hs-2', 'hs-6'], rating: 4.92, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-3', name: 'Kavita Deshmukh', role: 'Hair Texture & Scalp Specialist', avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&w=400&q=80', bio: 'Trichology-trained scalp and hair botox specialist focusing on restorative therapies.', phone: '+91 98000 00004', specialties: ['Hair Botox', 'Scalp Analysis', 'Thermal Tongs'], assignedServices: ['hs-5', 'hs-6', 'hs-9'], rating: 4.89, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
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
  if (!row) {
    return {
      businessType: 'hair_salon',
      businessName: '',
      ownerName: '',
      ownerRole: '',
      phone: '',
      whatsapp: '',
      email: '',
      tagline: '',
      about: '',
      ownerPhotoUrl: '',
      coverImageUrl: '',
      themePreset: 'slate_silver',
      currency: '₹',
      subdomain: '',
      address: '',
      city: '',
      postalCode: '',
      state: '',
      instagramHandle: '',
      requireDeposit: false,
      depositPercentage: 20,
      themeAccentKey: 'slate',
      whiteLabelEnabled: true,
    };
  }

  const config = row.data?.editor_profile && typeof row.data.editor_profile === 'object' ? row.data.editor_profile : {};
  const data = { ...(row.data || {}), ...Object.fromEntries(Object.entries(config).map(([key,value]) => [key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value])) };
  const workingHours = data.working_hours || row.working_hours || {};
  const businessName = row.salon_name || row.name || '';
  const phone = row.phone_number ?? row.phone ?? row.mobile ?? '';
  const whatsapp = row.whatsapp || phone;
  const subdomain = row.__resolved_public_slug || row.slug || row.subdomain || data.subdomain || config.subdomain || slugifySalonName(businessName);
  const city = row.city ?? row.location_city ?? '';
  const address = row.full_address ?? row.address ?? row.location_address ?? '';
  const postalCode = row.postal_code ?? row.pincode ?? row.location_pincode ?? '';
  const state = row.state ?? '';

  return {
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
    // The public site payload must carry this setting. Legacy rows with no
    // value retain the database/product default instead of being treated as off.
    acceptsOnlineBookings: row.accepts_online_bookings ?? true,
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

// ---------------------------------------------------------------------------
// Editor-state fallback for the PUBLIC site
// ---------------------------------------------------------------------------
// A published salon can exist in `salons` while its catalogue was never
// mirrored into `services`/`staff` (saves that predate the normalized mirror,
// or a workspace whose rows live under another salon id). The public site then
// rendered an empty template, which reads as "the website did not open".
//
// The editor draft is therefore consulted as a FALLBACK only:
//   • the normalized catalogue always wins when it has rows (it is what the
//     booking engine and every RLS-protected read use);
//   • the draft only fills EMPTY catalogue slots;
//   • the draft only fills EMPTY profile text fields — never overwrites
//     published values.
// Nothing here can widen access: the read is scoped to the salon's own owner
// and every failure degrades to "no fallback".
// ---------------------------------------------------------------------------

const MAX_PUBLIC_FALLBACK_ITEMS = 200;

async function readOwnerEditorState(
  deps: SiteLookupDeps,
  ownerId: unknown,
  deadlineAt?: number
): Promise<any | null> {
  const id = String(ownerId ?? '').trim();
  if (!id || deps.isMockSupabase) return null;
  try {
    const res = await runDb(
      () => deps.db.from('owner_editor_state').select('state').eq('owner_id', id).maybeSingle(),
      // Best effort only: a public page must not pay for a second round-trip
      // (or a retry delay) when the draft cannot be read.
      { label: 'public editor state fallback', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
    );
    const state = res?.data?.state;
    return state && typeof state === 'object' ? state : null;
  } catch {
    // Unreadable draft (missing table, RLS, timeout) is not a site failure.
    return null;
  }
}

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function publicServicesFromEditorState(raw: unknown): SalonService[] {
  if (!Array.isArray(raw)) return [];
  const out: SalonService[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, any>;
    const name = textOrEmpty(row.name);
    const id = textOrEmpty(row.id) || `svc-${out.length + 1}`;
    if (!name) continue;
    const price = Number(row.price);
    const duration = Number(row.durationMinutes);
    out.push({
      id,
      name: name.slice(0, 200),
      category: textOrEmpty(row.category) || 'General',
      description: typeof row.description === 'string' ? row.description.slice(0, 2000) : '',
      icon: textOrEmpty(row.icon) || 'sparkles',
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 45,
      popular: row.popular === true,
      showDuration: row.showDuration !== false,
    });
    if (out.length >= MAX_PUBLIC_FALLBACK_ITEMS) break;
  }
  return out;
}

function publicStylistsFromEditorState(raw: unknown): Stylist[] {
  if (!Array.isArray(raw)) return [];
  const out: Stylist[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, any>;
    const name = textOrEmpty(row.name);
    if (!name) continue;
    out.push({
      id: textOrEmpty(row.id) || `st-${out.length + 1}`,
      name: name.slice(0, 120),
      role: textOrEmpty(row.role) || 'Service Provider',
      avatarUrl: textOrEmpty(row.avatarUrl),
      bio: typeof row.bio === 'string' ? row.bio.slice(0, 2000) : '',
      // A public visitor must never see a staff member's private number.
      phone: '',
      specialties: Array.isArray(row.specialties) ? row.specialties.filter((s: unknown) => typeof s === 'string').slice(0, 20) : [],
      assignedServices: Array.isArray(row.assignedServices) ? row.assignedServices.filter((s: unknown) => typeof s === 'string').slice(0, 200) : [],
      rating: Number.isFinite(Number(row.rating)) ? Number(row.rating) : 5,
      commissionRate: 0,
      status: (textOrEmpty(row.status) || 'Available') as Stylist['status'],
      accessRole: 'Service Provider (Assigned)',
      hidePhone: true,
      schedule: [],
    });
    if (out.length >= MAX_PUBLIC_FALLBACK_ITEMS) break;
  }
  return out;
}

/**
 * Fill only the EMPTY public text/media fields from the editor draft.
 * A published value is never replaced, and identity/contact columns that the
 * public site renders from the salon row (name, phone, city…) are untouched.
 */
function fillProfileFromEditorState(profile: SalonProfile, draft: unknown): SalonProfile {
  if (!draft || typeof draft !== 'object') return profile;
  const source = draft as Record<string, any>;
  const merged: SalonProfile = { ...profile };
  const fill = (key: keyof SalonProfile, value: unknown) => {
    const current = (merged as Record<string, any>)[key];
    if (current !== undefined && current !== null && String(current).trim() !== '') return;
    const next = typeof value === 'string' ? value.trim() : '';
    if (next) (merged as Record<string, any>)[key] = next;
  };
  fill('tagline', source.tagline);
  fill('about', source.about);
  fill('coverImageUrl', source.coverImageUrl);
  fill('ownerPhotoUrl', source.ownerPhotoUrl);
  fill('logoUrl', source.logoUrl);
  fill('instagramHandle', source.instagramHandle);
  fill('facebookPage', source.facebookPage);
  fill('youtubeChannel', source.youtubeChannel);
  fill('landmark', source.landmark);
  fill('themeAccentKey', source.themeAccentKey);
  fill('themePreset', source.themePreset);
  fill('areaLocality', source.areaLocality);
  if (profile.latitude === undefined && Number.isFinite(Number(source.latitude))) {
    merged.latitude = Number(source.latitude);
  }
  if (profile.longitude === undefined && Number.isFinite(Number(source.longitude))) {
    merged.longitude = Number(source.longitude);
  }
  return merged;
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
  const sub = normalizeSiteIdentifier(identifier);
  if (!sub) return { found: false, salon: null };

  if (deps.isMockSupabase) {
    const s = deps.mockSalons[sub] || (DEMO_SUBDOMAINS.has(sub) ? defaultDemoSalon : null);
    return { found: !!s, salon: s || null };
  }

  try {
    const runSalonLookup = (column: string, label: string) => runDb(
      () => {
        const query: any = deps.db.from('salons').select('*');
        const filtered = typeof query.ilike === 'function'
          ? query.ilike(column, sub)
          : query.eq(column, sub);
        return filtered
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
      },
      { label, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    );

    const lookupColumns = isCustomDomain
      ? ['custom_domain', 'data->editor_profile->>customDomain', 'data->editor_profile->>custom_domain']
      : ['slug', 'data->editor_profile->>subdomain', 'subdomain'];

    let salonRow: any = null;
    for (const column of lookupColumns) {
      const salonRes = await runSalonLookup(column, `public salon lookup (${column})`);
      if (salonRes.error) {
        if (isIgnorableLookupSchemaError(salonRes.error)) continue;
        return { found: false, salon: null, error: salonRes.error };
      }
      if (salonRes.data) {
        salonRow = { ...salonRes.data, __resolved_public_slug: sub };
        break;
      }
    }

    if (!salonRow && !isCustomDomain) {
      const websiteRes = await runDb(
        () => {
          const query: any = deps.db.from('websites').select('*');
          const filtered = typeof query.ilike === 'function'
            ? query.ilike('slug', sub)
            : query.eq('slug', sub);
          return filtered.limit(1).maybeSingle();
        },
        { label: 'public website lookup (slug)', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
      );
      if (websiteRes.error) {
        if (!isIgnorableLookupSchemaError(websiteRes.error)) {
          return { found: false, salon: null, error: websiteRes.error };
        }
      } else if (websiteRes.data) {
        const websiteRow: any = websiteRes.data;
        const salonId = websiteRow.salon_id || websiteRow.salonId || websiteRow.salon?.id || websiteRow.id;
        salonRow = {
          ...websiteRow.salon,
          ...websiteRow,
          id: salonId,
          name: websiteRow.name || websiteRow.title || websiteRow.salon_name || websiteRow.salon?.name,
          data: websiteRow.data || websiteRow.config || websiteRow.salon?.data || {},
          __resolved_public_slug: sub,
          __catalogue_salon_id: salonId,
        };
      }
    }

    if (!salonRow) return { found: false, salon: null };
    const catalogueSalonId = salonRow.__catalogue_salon_id || salonRow.id;

    const [servicesRes, staffRes, hoursRes, editorState] = await Promise.all([
      runDb(() => deps.db.from('services').select('*').eq('salon_id', catalogueSalonId).eq('is_active', true).or('is_bookable_online.is.true,is_bookable_online.is.null').order('display_order'),
        { label: 'public salon services', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }),
      runDb(() => deps.db.from('staff').select('id,name,full_name,role_title,bio,avatar_path,profile_photo_url,employment_status,staff_services(service_id,is_active)').eq('salon_id', catalogueSalonId).eq('is_active', true).eq('is_public', true),
        { label: 'public salon staff', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }),
      runDb(() => deps.db.from('salon_hours').select('day_of_week,opens_at,closes_at,is_closed').eq('salon_id',catalogueSalonId),
        { label: 'public salon hours', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }),
      readOwnerEditorState(deps, salonRow.owner_id || salonRow.ownerId, deadlineAt),
    ]);
    if (hoursRes.error) return { found: false, salon: null, error: hoursRes.error };
    if (servicesRes.error || staffRes.error) return { found: false, salon: null, error: servicesRes.error || staffRes.error };

    const catalogueServices = (servicesRes.data || []).map(mapServiceRow);
    const catalogueStylists = (staffRes.data || []).map(row => mapStylistRow({ ...row, hide_phone: true,
      assigned_services: (row.staff_services || []).filter((link: any) => link.is_active).map((link: any) => link.service_id) }));
    const profile = { ...mapProfileRow(salonRow), ownerId: undefined, ...publicHours(hoursRes.data || []) };

    return { found: true, salon: {
      // The editor draft is the fallback, never the primary source: the
      // normalized catalogue is what the booking engine and RLS-protected
      // reads use, so it wins whenever it has rows. Only when the public
      // catalogue is empty — a salon saved before the catalogue mirror
      // existed, or one whose services were never mirrored — does the owner's
      // own saved draft fill the site, instead of a template with no content.
      profile: fillProfileFromEditorState(profile, editorState?.profile),
      services: catalogueServices.length ? catalogueServices : publicServicesFromEditorState(editorState?.services),
      stylists: catalogueStylists.length ? catalogueStylists : publicStylistsFromEditorState(editorState?.stylists),
      selectedTemplateId: typeof editorState?.selectedTemplateId === 'string' ? editorState.selectedTemplateId : null,
    } };
  } catch (error) {
    return { found: false, salon: null, error };
  }
}

export function publicHours(hours: any[]) {
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const display=(day:number)=>{const h=hours.find(h=>h.day_of_week===day);return !h?'Not configured':h.is_closed?'Closed':String(h.opens_at).slice(0,5)+'–'+String(h.closes_at).slice(0,5);};
  const weekday=[1,2,3,4,5].map(display);
  return {workingHoursMonFri:new Set(weekday).size===1?weekday[0]:weekday.map((value,index)=>days[index+1]+': '+value).join('; '),workingHoursSat:display(6),workingHoursSun:display(0)};
}
