// Loads process env > .env > .env.development (see server/env.ts).
import "../server/env";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase, getSupabaseAdmin } from "../src/lib/supabaseClient";
import { resolveTenantFromHost, BASE_DOMAIN } from "../src/lib/tenant";
import { SalonProfile, SalonService, Stylist } from "../src/types";
import { nexoraCors } from "../server/cors";
import { handleWebsiteSave } from "../server/websiteSave";
import { handleFetchYouTubeMetadata } from "../server/youtubeMetadata";
import {
  applyBookingUpdate,
  buildStatusNotifications,
} from "../server/bookingOps";
import { createBookingHandler } from "../server/bookingCreate";
import {
  handleRazorpayConfig,
  handleCreateRazorpayOrder,
  handleVerifyRazorpayPayment,
  getRazorpayConfigIssues,
} from "../server/razorpay";
import { createRazorpayWebhookHandler, isWebhookConfigured } from "../server/razorpayWebhook";

const app = express();
// `verify` keeps the RAW body bytes around: the Razorpay webhook signature is
// an HMAC over exactly what was sent, so the parsed object cannot be re-used.
app.use(
  express.json({
    limit: "10mb",
    verify: (req: any, _res, buf) => {
      if (buf?.length) req.rawBody = buf;
    },
  })
);
// CORS for cross-origin API callers (different preview/custom/subdomain
// host). Same-origin traffic (no Origin header) passes through untouched.
// Must sit BEFORE the routes so OPTIONS preflights never hit the JSON-404
// catch-all — that is exactly the "404 / blocked by CORS" failure mode.
app.use(nexoraCors);

/** Owner email for booking notifications, resolved from the profiles row. */
async function resolveOwnerEmail(ownerId: string | null | undefined): Promise<string> {
  if (ownerId && !isMockSupabase) {
    try {
      const { data } = await db
        .from('profiles')
        .select('email')
        .eq('id', ownerId)
        .maybeSingle();
      if (data?.email) return data.email;
    } catch {
      // fall through to the demo fallback
    }
  }
  return 'owner@salon.com';
}

// In-memory fallback
let mockBookings: any[] = [];
let mockNotifications: any[] = [];
const mockSalons: Record<string, any> = {};

const admin = getSupabaseAdmin();
const db = admin ?? supabase;

if (!isMockSupabase && !admin) {
  console.warn(
    '[Nexora] Live mode detected but SUPABASE_SERVICE_ROLE_KEY is not set. The API falls back to the anon client, so public-site reads will be blocked by Row Level Security. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY server-side.'
  );
}

// ---------------------------------------------------------------------------
// Startup diagnostics — make a broken payment/DB configuration obvious in the
// logs at boot instead of at the customer's checkout click.
// ---------------------------------------------------------------------------
{
  const razorpayIssues = getRazorpayConfigIssues();
  if (razorpayIssues.length === 0) {
    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim().replace(/^['"]|['"]$/g, '');
    console.log(`[Razorpay] Gateway ready (${keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST'} key ${keyId.slice(0, 12)}…).`);
  } else {
    console.warn(
      '[Razorpay] Online payments are DISABLED — ' +
        razorpayIssues.join(' ') +
        ' Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env to enable checkout.'
    );
  }

  if (isWebhookConfigured()) {
    console.log('[Razorpay] Webhook signature verification ready (POST /api/payments/razorpay/webhook).');
  } else {
    console.warn(
      '[Razorpay] RAZORPAY_WEBHOOK_SECRET is not set — incoming webhooks will be rejected with 503. ' +
        'Use the same secret you entered in the Razorpay dashboard (Settings → Webhooks).'
    );
  }
}

// Define default Arts By Uma salon profile
const artsByUmaSalon = {
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
  } as SalonProfile,
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
  ] as SalonService[],
  stylists: [
    { id: 'hs-st-uma', name: 'Uma', role: 'Founder & Master Stylist', avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80', bio: 'Founder with 12+ years of experience. Specializes in precision structural cuts, dimensional color, and bespoke nail couture.', phone: '+91 98450 77654', specialties: ['Structural Cuts', 'Balayage Color', 'Keratin Smoothing', 'Gel-X Extensions'], assignedServices: ['hs-1', 'hs-3', 'hs-4', 'hs-5', 'hs-7'], rating: 4.98, commissionRate: 35, status: 'Available', accessRole: 'Manager (Full Access)', hidePhone: false, schedule: [] },
    { id: 'hs-st-1', name: 'Ananya Sharma', role: 'Senior Precision Stylist', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', bio: 'Senior colorist and stylist with extensive background in balayage, ombre, and volume blowouts.', phone: '+91 98450 12890', specialties: ['Precision Fringes', 'Balayage & Color', 'Volume Blowouts'], assignedServices: ['hs-1', 'hs-2', 'hs-3', 'hs-5'], rating: 4.95, commissionRate: 30, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-2', name: 'Rohan Kapoor', role: 'Stylist & Hair Craftsman', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', bio: 'Men and women haircut specialist with expertise in dry cutting, skin fades, and textured styling.', phone: '+91 98450 33412', specialties: ['Dry Cutting', 'Men & Women Styling', 'Fade Geometry'], assignedServices: ['hs-1', 'hs-2', 'hs-6'], rating: 4.92, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-3', name: 'Kavita Deshmukh', role: 'Hair Texture & Scalp Specialist', avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&w=400&q=80', bio: 'Trichology-trained scalp and hair botox specialist focusing on restorative therapies.', phone: '+91 98450 99881', specialties: ['Hair Botox', 'Scalp Analysis', 'Thermal Tongs'], assignedServices: ['hs-5', 'hs-6', 'hs-9'], rating: 4.89, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
  ] as Stylist[],
};

mockSalons['arts-by-uma'] = artsByUmaSalon;
mockSalons['artsbyuma'] = artsByUmaSalon;
mockSalons['mirakistudio'] = {
  ...artsByUmaSalon,
  profile: {
    ...artsByUmaSalon.profile,
    businessName: 'Miraki Hair Cut & Styling Studio',
    subdomain: 'mirakistudio',
  },
};

// Subdomains that legitimately fall back to the bundled demo catalogue when no
// matching row exists in the database (and in mock mode). Exact keys only —
// previously `sub.includes('uma')` also hijacked unrelated subdomains such as
// "aroma", "perfume" or "zuma" and served them Uma's salon.
const DEMO_SUBDOMAINS = new Set(['arts-by-uma', 'artsbyuma']);

function mapProfileRow(row: any): SalonProfile {
  const workingHours = row.working_hours || {};
  return {
    workingHoursMonFri: workingHours.monFri || '',
    workingHoursSat: workingHours.saturday || '',
    workingHoursSun: workingHours.sunday || '',
    homeService: row.home_service || undefined,
    ownerId: row.id,
    businessType: (row.business_type as SalonProfile['businessType']) || 'hair_salon',
    businessName: row.salon_name || 'Arts By Uma',
    ownerName: row.full_name || 'Uma',
    ownerRole: row.owner_role || 'Founder & Master Stylist',
    phone: row.phone_number || '+91 98450 77654',
    whatsapp: row.whatsapp || row.phone_number || '+91 98450 77654',
    email: row.email || 'hello@artsbyuma.com',
    tagline: row.tagline || 'Precision Cuts, Creative Hair Artistry & Luxury Nail Lounge',
    about: row.about || 'Welcome to Arts By Uma. Founded by Uma, our boutique studio brings together master precision haircuts, bespoke balayage, sculpted gel nail art, and restorative hair spa therapies.',
    ownerPhotoUrl: row.owner_photo_url || '',
    coverImageUrl: row.cover_image_url || '',
    logoUrl: row.logo_url || undefined,
    themePreset: (row.theme_preset as SalonProfile['themePreset']) || 'slate_silver',
    currency: row.currency || '₹',
    subdomain: row.subdomain || 'arts-by-uma',
    customDomain: row.custom_domain || undefined,
    address: row.full_address || '100 Feet Road, 12th Main, Indiranagar',
    city: row.city || 'Bengaluru',
    postalCode: row.postal_code || '560038',
    state: row.state || 'Karnataka',
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    instagramHandle: row.instagram_handle || 'arts_by_uma',
    facebookPage: row.facebook_page || undefined,
    youtubeChannel: row.youtube_channel || undefined,
    tiktokProfile: row.tiktok_profile || undefined,
    googleBusinessUrl: row.google_business_url || undefined,
    requireDeposit: row.require_deposit ?? false,
    depositPercentage: row.deposit_percentage ?? 20,
    themeAccentKey: row.theme_accent_key || 'slate',
    customAccentColor: row.custom_accent_color || undefined,
    landmark: row.landmark || undefined,
    foundingYear: row.founding_year || undefined,
    whiteLabelEnabled: row.white_label_enabled ?? true,
  };
}

function mapServiceRow(row: any): SalonService {
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'General',
    description: row.description || '',
    icon: row.icon || 'sparkles',
    price: Number(row.price ?? 0),
    durationMinutes: row.duration_minutes ?? 45,
    popular: row.popular ?? false,
    showDuration: row.show_duration ?? true,
  };
}

function mapStylistRow(row: any): Stylist {
  return {
    id: row.id,
    name: row.name,
    role: row.role || 'Service Provider',
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    phone: row.phone || '',
    specialties: row.specialties || [],
    assignedServices: row.assigned_services || [],
    rating: Number(row.rating ?? 5),
    commissionRate: Number(row.commission_rate ?? 0),
    status: row.status || 'Available',
    accessRole: row.access_role || 'Service Provider (Assigned)',
    hidePhone: row.hide_phone ?? false,
    schedule: row.schedule || [],
  };
}

async function resolveSalonFromHost(req: any) {
  const host = req.headers.host || req.get('host') || '';
  const tenant = resolveTenantFromHost(host);
  if (!tenant) return { host, tenant: null, salon: null };

  try {
    if (isMockSupabase) {
      const registryKey = tenant.customDomain || tenant.subdomain;
      const salon =
        mockSalons[registryKey] || (DEMO_SUBDOMAINS.has(registryKey) ? artsByUmaSalon : null);
      if (salon) {
        return { host, tenant, salon: { ...salon, customDomain: tenant.customDomain || salon.customDomain } };
      }
      return { host, tenant, salon: null };
    }

    const query = tenant.subdomain
      ? { column: 'subdomain', value: tenant.subdomain }
      : { column: 'custom_domain', value: tenant.customDomain };

    const { data: profileRow, error } = await db
      .from('profiles')
      .select('*')
      .eq(query.column, query.value)
      .maybeSingle();

    if (error) {
      // A real DB failure must NOT be reported as "salon not found" — the
      // /api/site handler turns this into a JSON 500 so the SPA can log it.
      console.error(`[Site lookup] profiles query failed for ${query.column}="${query.value}":`, error);
      return { host, tenant, salon: null, error };
    }
    if (!profileRow) {
      if (tenant.subdomain === 'arts-by-uma' || tenant.subdomain === 'artsbyuma') {
        return { host, tenant, salon: artsByUmaSalon };
      }
      return { host, tenant, salon: null };
    }

    const ownerId = profileRow.id;
    const [{ data: serviceRows }, { data: stylistRows }] = await Promise.all([
      db.from('services').select('*').eq('owner_id', ownerId).order('sort_order'),
      db.from('stylists').select('*').eq('owner_id', ownerId).order('sort_order'),
    ]);

    const salon = {
      profile: mapProfileRow(profileRow),
      services: (serviceRows || []).map(mapServiceRow),
      stylists: (stylistRows || []).map(mapStylistRow),
    };
    return { host, tenant, salon };
  } catch (err) {
    console.error('Failed to resolve tenant salon:', err);
    return { host, tenant, salon: null, error: err };
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Nexora Salon OS", mode: isMockSupabase ? 'mock' : 'live' });
});

app.get("/api/site", async (req, res) => {
  const { host, tenant, salon, error } = await resolveSalonFromHost(req);
  if (error) {
    // DB failure while resolving the tenant — JSON 500 (never "not found"),
    // so the SPA logs the real status instead of guessing.
    return res.status(500).json({
      success: false,
      found: false,
      isTenant: true,
      error: error?.message || 'Database read failed while loading this site.',
    });
  }
  if (!tenant) {
    return res.json({ found: false, host, isTenant: false, salon: null });
  }
  return res.json({
    found: !!salon,
    isTenant: true,
    host,
    tenant,
    salon,
    baseDomain: BASE_DOMAIN,
  });
});

app.get("/api/site/:subdomain", async (req, res) => {
  const sub = String(req.params.subdomain || '').toLowerCase();
  try {
    if (isMockSupabase) {
      const salon = mockSalons[sub] || (DEMO_SUBDOMAINS.has(sub) ? artsByUmaSalon : null);
      return res.json({
        found: !!salon,
        isTenant: true,
        tenant: { subdomain: sub, customDomain: null },
        salon,
        baseDomain: BASE_DOMAIN,
      });
    }

    // Live mode. Wrapped in try/catch so a database read failure returns a
    // JSON 500 instead of an unhandled async rejection — Express 4 cannot
    // route rejected promises to the error middleware, so these used to crash
    // the request (Vercel: generic 500/HTML error page).
    const { data: profileRow, error: profileError } = await db
      .from('profiles')
      .select('*')
      .eq('subdomain', sub)
      .maybeSingle();

    if (profileError) {
      console.error(`[Site lookup] Failed to read profile for subdomain "${sub}":`, profileError);
      return res.status(500).json({
        success: false,
        found: false,
        error: profileError.message || 'Database read failed while loading this site.',
      });
    }

    if (!profileRow) {
      if (DEMO_SUBDOMAINS.has(sub)) {
        return res.json({ found: true, isTenant: true, tenant: { subdomain: sub, customDomain: null }, salon: artsByUmaSalon, baseDomain: BASE_DOMAIN });
      }
      // 200 + found:false — the SPA treats this as "not published", and
      // distinguishes it from transport/HTTP failures (which return null).
      return res.json({ found: false, isTenant: true, tenant: { subdomain: sub, customDomain: null }, salon: null, baseDomain: BASE_DOMAIN });
    }

    const ownerId = profileRow.id;
    const [{ data: serviceRows, error: servicesError }, { data: stylistRows, error: stylistsError }] =
      await Promise.all([
        db.from('services').select('*').eq('owner_id', ownerId).order('sort_order'),
        db.from('stylists').select('*').eq('owner_id', ownerId).order('sort_order'),
      ]);

    const catalogueError = servicesError || stylistsError;
    if (catalogueError) {
      console.error(`[Site lookup] Failed to read catalogue for subdomain "${sub}":`, catalogueError);
      return res.status(500).json({
        success: false,
        found: false,
        error: catalogueError.message || 'Database read failed while loading this site.',
      });
    }

    return res.json({
      found: true,
      isTenant: true,
      tenant: { subdomain: sub, customDomain: null },
      salon: {
        profile: mapProfileRow(profileRow),
        services: (serviceRows || []).map(mapServiceRow),
        stylists: (stylistRows || []).map(mapStylistRow),
      },
      baseDomain: BASE_DOMAIN,
    });
  } catch (err: any) {
    console.error(`[Site lookup] Unexpected error for subdomain "${sub}":`, err);
    return res.status(500).json({
      success: false,
      found: false,
      error: err?.message || 'Internal server error while loading this site.',
    });
  }
});

app.get("/api/bookings", async (req, res) => {
  try {
    const getMock = () => mockBookings.sort((a, b) => new Date(b.created_at || Date.now()).getTime() - new Date(a.created_at || Date.now()).getTime());

    if (isMockSupabase) {
      return res.json({ success: true, data: getMock() });
    }
    const { data, error } = await db.from('bookings').select('*').order('created_at', { ascending: false });
    if (error) {
      return res.json({ success: true, data: getMock() });
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/bookings/:id", async (req, res) => {
  try {
    const getMock = () => mockBookings.find(b => b.id === req.params.id);

    if (isMockSupabase) {
      const booking = getMock();
      if (!booking) throw new Error('Booking not found');
      return res.json({ success: true, data: booking });
    }
    
    const { data, error } = await db
      .from('bookings')
      .select('*')
      .eq('id', req.params.id)
      .single();
      
    if (error) {
      const booking = getMock();
      if (!booking) throw new Error('Booking not found');
      return res.json({ success: true, data: booking });
    }
    res.json({ success: true, data });
  } catch (err: any) {
    console.warn('Fetch booking error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/bookings/update", async (req, res) => {
  try {
    const { id, status, proposed_date, proposed_time_slot } = req.body ?? {};
    if (!id || !status) {
      return res.status(400).json({ success: false, error: 'id and status are required.' });
    }

    let data: any;

    if (isMockSupabase) {
      const idx = mockBookings.findIndex((b) => b.id === id);
      if (idx === -1) return res.status(404).json({ success: false, error: 'Booking not found' });
      const existing = mockBookings[idx];
      const changes = applyBookingUpdate(existing, { status, proposed_date, proposed_time_slot });
      data = { ...existing, ...changes };
      mockBookings[idx] = data;
    } else {
      // Live mode: read the current row first — the confirmation transition
      // needs the proposed slot, and a read/write failure must surface as a
      // real error, never as a fake in-memory success (that used to make the
      // UI show "confirmed" while the database still said "pending").
      const { data: existing, error: fetchError } = await db
        .from('bookings')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (fetchError) {
        console.error('[Bookings] Failed to read booking for update:', fetchError);
        return res.status(500).json({ success: false, error: fetchError.message });
      }
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Booking not found' });
      }
      const changes = applyBookingUpdate(existing, { status, proposed_date, proposed_time_slot });
      const { data: updated, error: updateError } = await db
        .from('bookings')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (updateError || !updated) {
        console.error('[Bookings] Failed to update booking:', updateError);
        return res.status(500).json({ success: false, error: updateError?.message || 'Booking update failed.' });
      }
      data = updated;
    }

    const ownerEmail = await resolveOwnerEmail(data.owner_id);
    const notifs = buildStatusNotifications(
      data,
      status,
      data.proposed_date ?? proposed_date,
      data.proposed_time_slot ?? proposed_time_slot,
      ownerEmail
    );

    if (notifs) {
      const rows = [notifs.owner];
      if (notifs.customer) rows.unshift(notifs.customer);
      if (isMockSupabase) {
        mockNotifications.push(...rows.map((n) => ({ ...n, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() })));
      } else {
        const { error: notifError } = await db.from('in_app_notifications').insert(rows);
        if (notifError) console.warn('[Bookings] Notification insert error:', notifError);
      }
    }

    res.json({ success: true, data });
  } catch (err: any) {
    console.warn('Booking update error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Booking update failed.' });
  }
});

app.get("/api/notifications", async (req, res) => {
  try {
    const { email } = req.query;
    const getMock = () => mockNotifications.filter(n => n.user_email === email).sort((a, b) => new Date(b.created_at || Date.now()).getTime() - new Date(a.created_at || Date.now()).getTime());

    if (isMockSupabase) {
      return res.json({ success: true, data: getMock() });
    }
    
    const { data, error } = await db
      .from('in_app_notifications')
      .select('*')
      .eq('user_email', email)
      .order('created_at', { ascending: false });
      
    if (error) {
      return res.json({ success: true, data: getMock() });
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    const { email } = req.body;
    const doMock = () => {
      mockNotifications = mockNotifications.map(n => n.user_email === email ? { ...n, is_read: true } : n);
    };

    if (isMockSupabase) {
      doMock();
      return res.json({ success: true });
    }
    
    const { error } = await db
      .from('in_app_notifications')
      .update({ is_read: true })
      .eq('user_email', email)
      .eq('is_read', false);
      
    if (error) {
      doMock();
      return res.json({ success: true });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// BOOKING CREATE — POST /api/bookings/create
// ---------------------------------------------------------------------------
// Shared with the dev/prod Express server (server/bookingCreate.ts): payload
// validation, NOT NULL owner_id resolution, Razorpay signature re-check,
// explicit stdout logging and precise 4xx errors instead of an opaque 500.
// ============================================================================
app.post(
  "/api/bookings/create",
  createBookingHandler({
    db,
    isMock: isMockSupabase,
    addMockBooking: (row) => { mockBookings.push(row); },
    addMockNotifications: (rows) => { mockNotifications.push(...rows); },
    resolveOwnerEmail,
  })
);

// ============================================================================
// PAYMENTS — Razorpay (advance token checkout)
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are read from the environment.
// ============================================================================
app.get("/api/payments/razorpay/config", handleRazorpayConfig);
app.post("/api/payments/razorpay/order", handleCreateRazorpayOrder);
app.post("/api/payments/razorpay/verify", handleVerifyRazorpayPayment);

// Server-to-server callback from Razorpay, signed with RAZORPAY_WEBHOOK_SECRET.
app.post(
  "/api/payments/razorpay/webhook",
  createRazorpayWebhookHandler({
    db,
    isMock: isMockSupabase,
    getMockBookings: () => mockBookings,
    addMockNotifications: (rows) => { mockNotifications.push(...rows); },
    resolveOwnerEmail,
  })
);

app.post("/api/generate-bio", async (req, res) => {
  try {
    const { businessName, businessType, ownerName, vibe, specialties } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({
        tagline: `Elevating ${businessType?.replace('_', ' ') || 'salon'} with bespoke luxury & precision care.`,
        bio: `Welcome to ${businessName || 'Arts By Uma'}, founded by ${ownerName || 'Uma'}. We are a modern sanctuary dedicated to ${specialties || 'exceptional salon services'}. Blending a ${vibe || 'luxury'} aesthetic with high-performance organic products, our mission is to make every client feel renewed and confident.`
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Write a high-converting tagline (max 10 words) and a compelling salon story/about bio (2-3 sentences) for a beauty business with details:
Salon: ${businessName}
Category: ${businessType}
Founder: ${ownerName}
Vibe: ${vibe}
Specialties: ${specialties}

Return strictly valid JSON: {"tagline": "...", "bio": "..."}`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const text = response.text;
    if (text) {
      return res.json(JSON.parse(text));
    }
    throw new Error('Empty AI response');
  } catch (err) {
    return res.json({
      tagline: `Redefining beauty & relaxation in a luxury space.`,
      bio: `Welcome to ${req.body.businessName || 'our studio'}. Our passionate team offers bespoke salon treatments designed to accentuate your unique natural style.`
    });
  }
});

app.post("/api/generate-promo-image", async (req, res) => {
  try {
    const { prompt, serviceName, category, style, aspectRatio = "1:1" } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    const detailedPrompt = prompt || `A professional, ultra-high quality, editorial advertising photo for a luxury salon promoting "${serviceName}" in the "${category || 'Beauty & Wellness'}" category. Aesthetic: ${style || 'Luxury Chic & Modern Elegance'}, warm studio lighting, pristine clean background, 8k resolution commercial photoshoot.`;

    if (!apiKey) {
      return res.json({
        success: false,
        fallbackNotice: "No GEMINI_API_KEY configured. Using high-resolution curated asset.",
        imageUrl: null,
        promptUsed: detailedPrompt
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const validAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    const chosenAspect = validAspectRatios.includes(aspectRatio) ? aspectRatio : "1:1";

    const response = await ai.models.generateContent({
      model: 'imagen-3.0-generate-001',
      contents: {
        parts: [{ text: detailedPrompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: chosenAspect,
        },
      },
    });

    let generatedImageUrl: string | null = null;
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          generatedImageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (generatedImageUrl) {
      return res.json({
        success: true,
        imageUrl: generatedImageUrl,
        promptUsed: detailedPrompt,
      });
    } else {
      return res.json({
        success: false,
        imageUrl: null,
        promptUsed: detailedPrompt,
        notice: "Image generation model returned without an inline image part; using curated backup."
      });
    }
  } catch (err: any) {
    console.warn("Gemini Image generation error:", err?.message || err);
    return res.json({
      success: false,
      imageUrl: null,
      error: err?.message || "Failed to generate promotional image with AI.",
    });
  }
});

app.post("/api/generate-promo-copy", async (req, res) => {
  try {
    const { businessName, serviceName, price, offer, city, discountPercent } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.json({
        whatsapp: `✨ *EXCLUSIVE SALON OFFER* ✨\n\nHey beautiful! Treat yourself to *${serviceName || 'Signature Service'}* at *${businessName || 'Arts By Uma'}* in ${city || 'Indiranagar, Bengaluru'}.\n\n🎉 *Special Offer*: ${offer || `${discountPercent || 20}% OFF this week!`}\n💰 *Price*: ₹${price ? Number(price).toLocaleString('en-IN') : 'Special Rate'}\n\n📍 Visit us at: ${city || 'Indiranagar, Bengaluru'}\n📲 Reserve your slot now before slots fill up!`,
        instagramCaption: `✨ Glow up season is here! ✨\n\nExperience pure relaxation with our signature *${serviceName || 'Service'}* at ${businessName || 'Arts By Uma'}.\n\n💎 *Special Deal*: ${offer || `Enjoy ${discountPercent || 20}% OFF for a limited time!`}\n⭐ Price: ₹${price ? Number(price).toLocaleString('en-IN') : 'Special Rate'}\n\n📍 ${city || 'Bengaluru'} | ⏰ Limited slots available\n\n👇 Tap the link in bio to book your appointment!\n\n#ArtsByUma #SalonOffers #Beauty #SelfCare #GlowUp #HairAndSkin #BridalBeauty #SalonDeals`,
        headline: `Transform Your Look with ${serviceName || 'Signature Style'}`,
        badgeText: offer ? offer.toUpperCase() : `SPECIAL ${discountPercent || 20}% OFF`
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an elite beauty salon copywriter. Create promotional copy for:
Salon: ${businessName}
Service: ${serviceName}
Price: ₹${price}
Offer: ${offer || `${discountPercent || 20}% OFF`}
City: ${city || 'India'}

Return strictly JSON with keys: whatsapp, instagramCaption, headline, badgeText.`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const text = response.text;
    if (text) {
      return res.json(JSON.parse(text));
    }
    throw new Error("Empty copy response");
  } catch (err) {
    return res.json({
      whatsapp: `✨ *EXCLUSIVE SALON OFFER* ✨\n\nHey beautiful! Treat yourself to *${req.body.serviceName || 'our signature treatment'}* at *${req.body.businessName || 'Arts By Uma'}*.\n\n🎉 *Special Deal*: ${req.body.offer || 'Exclusive Discount This Week'}\n💰 *Price*: ₹${req.body.price || 'Special Rate'}\n\n📲 Book your appointment now!`,
      instagramCaption: `✨ Elevate your everyday glow! ✨\n\nBook your *${req.body.serviceName || 'treatment'}* today at ${req.body.businessName || 'Arts By Uma'}.\n\n👇 Tap link in bio to book your appointment!`,
      headline: `Special Offer: ${req.body.serviceName || 'Signature Service'}`,
      badgeText: req.body.offer ? req.body.offer.toUpperCase() : 'LIMITED SPECIAL'
    });
  }
});

app.post("/api/youtube/fetch-videos", async (req, res) => {
  try {
    const { channelUrl, maxResults = 10 } = req.body;
    const apiKey = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '';

    if (!apiKey || apiKey === 'YOUR_YOUTUBE_DATA_API_KEY') {
      return res.json({
        success: false,
        notice: 'YouTube Data API key is not configured. Please set YOUTUBE_API_KEY.',
        videos: []
      });
    }

    // Extract channel handle or ID from URL
    let query = '';
    if (channelUrl) {
      const matchHandle = channelUrl.match(/youtube\.com\/@([\w_-]+)/);
      const matchChannelId = channelUrl.match(/youtube\.com\/channel\/([\w_-]+)/);
      if (matchHandle) {
        query = matchHandle[1];
      } else if (matchChannelId) {
        query = matchChannelId[1];
      } else if (channelUrl.includes('@')) {
        query = channelUrl.split('@').pop()?.split('/')[0] || '';
      }
    }

    // Try to search by handle via YouTube Data API
    let videos: any[] = [];
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelType=any&q=${encodeURIComponent(query || 'salon')}&maxResults=${maxResults}&key=${apiKey}`;
    
    try {
      const response = await fetch(searchUrl);
      const data = await response.json();
      if (data.items && data.items.length > 0) {
        videos = data.items.map((item: any) => ({
          youtubeUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
          videoId: item.id.videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          channelTitle: item.snippet.channelTitle,
          thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '',
          categoryTag: 'SHORT',
          isOwnerVideo: false,
          views: 'Auto-fetched via YouTube Data API',
          transformationTag: 'Auto-Fetched Reel'
        }));
      }
    } catch (err: any) {
      console.warn('YouTube API fetch error:', err?.message || err);
    }

    return res.json({ success: true, videos, notice: videos.length ? `Fetched ${videos.length} videos from YouTube.` : 'No videos found for this channel.' });
  } catch (err: any) {
    console.warn('YouTube fetch endpoint error:', err?.message || err);
    return res.json({ success: false, notice: 'Failed to fetch videos from YouTube.', videos: [] });
  }
});

app.post("/api/fetch-youtube-meta", handleFetchYouTubeMetadata);

// ============================================================================
// OWNER SAVE FALLBACK — POST /api/website/save
// ----------------------------------------------------------------------------
// The editor's auto-save pipeline (src/lib/autoSave.ts) calls this when the
// direct Supabase client sync fails (network / auth / RLS). The shared handler
// (server/websiteSave.ts) persists the incoming salonData with the Supabase
// ADMIN service-role client (SUPABASE_SERVICE_ROLE_KEY), which safely bypasses
// RLS policies. Essential fields (subdomain, owner_id) are validated; the
// upserts run inside a try/catch.
//   200 { success: true, timestamp: Date.now() }
//   400 { success: false, error }
//   500 { error: "Failed to persist site state" }
// ============================================================================
app.post("/api/website/save", handleWebsiteSave({ mockSalons }));

// ============================================================================
// JSON error handling for the serverless deployment.
// ---------------------------------------------------------------------------
// Unknown /api/* routes and unexpected handler failures MUST answer with JSON.
// An HTML 404/500 page breaks the SPA's res.json() callers, which previously
// surfaced as a confusing "Unexpected token '<'" / silent fallback instead of
// the real HTTP status and error message.
// ============================================================================

// JSON 404 for any unmatched /api/* route (registered after all routes above).
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'API route not found' });
});

// Global JSON error middleware (Express 4 only forwards synchronous errors
// here; async route handlers are individually wrapped in try/catch above).
app.use((err: any, _req: any, res: any, next: any) => {
  if (res.headersSent) return next(err);
  const isBodyError = err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large';
  if (isBodyError) {
    // Malformed JSON body (e.g. a truncated fetch payload) → 400, never 500.
    return res.status(err?.status || 400).json({ success: false, error: 'Malformed JSON request body.' });
  }
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  console.error('[API] Unhandled server error:', err);
  res.status(status).json({
    success: false,
    error: err?.message || 'Internal Server Error',
    ...(status >= 500 ? { details: err?.message || undefined } : {}),
  });
});

export default app;
