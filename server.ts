import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase, getSupabaseAdmin } from "./src/lib/supabaseClient";
import { resolveTenantFromHost, isTenantHost, BASE_DOMAIN } from "./src/lib/tenant";
import { SalonProfile, SalonService, Stylist } from "./src/types";
import { handleFetchYouTubeMetadata } from "./server/youtubeMetadata";

// In-memory fallback for preview mode without DB
let mockBookings: any[] = [];
let mockNotifications: any[] = [];
// A small in-memory salon registry so we can still demo the public subdomain
// experience even when Supabase is not configured (mock mode).
const mockSalons: Record<string, any> = {};

// Use the service-role (admin) client for DB writes/reads so the Express API
// keeps working even when Row Level Security is enabled. RLS cannot block the
// service_role key. Falls back to the anon client if no service key is set.
const admin = getSupabaseAdmin();
const db = admin ?? supabase;

if (!isMockSupabase && !admin) {
  console.warn(
    '[Nexora] Live mode detected but SUPABASE_SERVICE_ROLE_KEY is not set. The API falls back to the anon client, so public-site reads will be blocked by Row Level Security. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY server-side.'
  );
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

// Seed demo salons
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "Nexora Salon OS", mode: isMockSupabase ? 'mock' : 'live' });
  });

  // -------------------------------------------------------------------------
  // MULTI-TENANT PUBLIC SITE RESOLUTION
  // -------------------------------------------------------------------------
  // Map a snake_case Supabase profiles row to the app's SalonProfile shape.
  function mapProfileRow(row: any): SalonProfile {
    const workingHours = row.working_hours || {};
    return {
      workingHoursMonFri: workingHours.monFri || '',
      workingHoursSat: workingHours.saturday || '',
      workingHoursSun: workingHours.sunday || '',
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

  // Given a request, resolve the tenant salon (by subdomain or custom domain)
  // and return its full public catalogue. Uses the service-role admin client
  // (bypasses RLS) so anonymous visitors can read any salon's public site.
  async function resolveSalonFromHost(req: any) {
    const host = req.headers.host || req.get('host') || '';
    const tenant = resolveTenantFromHost(host);
    if (!tenant) return { host, tenant: null, salon: null };

    try {
      if (isMockSupabase) {
        // Mock mode: read from the in-memory registry so the demo still works.
        const registryKey = tenant.customDomain || tenant.subdomain;
        const salon =
          mockSalons[registryKey] || (DEMO_SUBDOMAINS.has(registryKey) ? artsByUmaSalon : null);
        if (salon) {
          return { host, tenant, salon: { ...salon, customDomain: tenant.customDomain || salon.customDomain } };
        }
        return { host, tenant, salon: null };
      }

      // Live mode: match on subdomain OR custom_domain.
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
        // Fallback for demo subdomains
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

  // Public JSON endpoint the SPA calls to hydrate the tenant's live site.
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

  // Convenience: resolve by an explicit subdomain (useful for testing/SEO).
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
      // route rejected promises to the error middleware, so these used to
      // crash the request (Vercel: generic 500/HTML error page).
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

  // Booking Update Endpoint
  app.post("/api/bookings/update", async (req, res) => {
    try {
      const { id, status, proposed_date, proposed_time_slot } = req.body;
      
      const updateData: any = { status };
      if (status === 'reschedule_proposed') {
        updateData.proposed_date = proposed_date;
        updateData.proposed_time_slot = proposed_time_slot;
      }
      
      let data: any;
      const doMockUpdate = () => {
        const idx = mockBookings.findIndex(b => b.id === id);
        if (idx !== -1) {
          mockBookings[idx] = { ...mockBookings[idx], ...updateData };
          data = mockBookings[idx];
        } else {
          throw new Error("Booking not found");
        }
      };

      if (isMockSupabase) {
        doMockUpdate();
      } else {
        const { data: dbData, error } = await db
          .from('bookings')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
          
        if (error) {
           doMockUpdate();
        } else {
           data = dbData;
        }
      }

      // Mock sending WhatsApp/Email based on status update
      console.log(`[TRIGGERED NOTIFICATION] Status updated to ${status} for booking ID: ${id}`);
      let notificationMsg = '';
      let notificationTitle = '';

      if (status === 'reschedule_proposed') {
         notificationTitle = 'Reschedule Proposed';
         notificationMsg = `The salon proposed a new time: ${proposed_date} at ${proposed_time_slot}.`;
      } else if (status === 'confirmed') {
         notificationTitle = 'Booking Confirmed';
         notificationMsg = `Your booking on ${data.booking_date} at ${data.time_slot} is now confirmed.`;
      } else if (status === 'cancelled') {
         notificationTitle = 'Booking Cancelled';
         notificationMsg = `Your booking was cancelled.`;
      }

      if (notificationMsg) {
         const newNotifs = [{
           user_email: data.customer_email,
           title: notificationTitle,
           message: notificationMsg,
         }, {
           user_email: 'owner@salon.com', // hardcoded for the demo owner dashboard
           title: `Booking ${status}`,
           message: `${data.customer_name}'s booking was ${status}.`,
         }];

         if (isMockSupabase) {
           mockNotifications.push(...newNotifs.map(n => ({ ...n, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() })));
         } else {
           await db.from('in_app_notifications').insert(newNotifs);
         }
      }
      
      res.json({ success: true, data });
    } catch (err: any) {
      console.warn('Booking update error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get all bookings
  app.get("/api/bookings", async (req, res) => {
    try {
      const getMock = () => mockBookings.sort((a, b) => new Date(b.created_at || Date.now()).getTime() - new Date(a.created_at || Date.now()).getTime());

      if (isMockSupabase) {
        return res.json({ success: true, data: getMock() });
      }
      
      const { data, error } = await db
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) {
        return res.json({ success: true, data: getMock() });
      }
      
      res.json({ success: true, data });
    } catch (err: any) {
      console.warn('Fetch bookings error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get a single booking
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

  // Get notifications
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

  // Mark notifications as read
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

  // Booking Create Endpoint
  app.post("/api/bookings/create", async (req, res) => {
    try {
      const { booking, notifications } = req.body;
      
      let bookingData: any;
      const doMock = () => {
        bookingData = { ...booking, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() };
        mockBookings.push(bookingData);
        
        if (notifications && notifications.length > 0) {
          mockNotifications.push(...notifications.map((n: any) => ({ ...n, id: String(Date.now() + Math.random()), created_at: new Date().toISOString() })));
        }
      };

      if (isMockSupabase) {
        doMock();
      } else {
        const bookingRow = {
          ...booking,
          owner_id: (req.body.owner_id || booking?.owner_id || process.env.DEFAULT_OWNER_ID || null),
        };

        const { data: dbData, error: bookingError } = await db
          .from('bookings')
          .insert([bookingRow])
          .select()
          .single();
          
        if (bookingError) {
          doMock();
        } else {
          bookingData = dbData;
          
          if (notifications && notifications.length > 0) {
             const { error: notifError } = await db
              .from('in_app_notifications')
              .insert(notifications);
             if (notifError) console.warn('Notification insert error:', notifError);
          }
        }
      }
      
      res.json({ success: true, data: bookingData });
    } catch (err: any) {
      console.warn('Booking create error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // AI Bio Generation Route with Gemini
  app.post("/api/generate-bio", async (req, res) => {
    try {
      const { businessName, businessType, ownerName, vibe, specialties } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({
          tagline: `Elevating ${businessType.replace('_', ' ')} with bespoke luxury & precision care.`,
          bio: `Welcome to ${businessName}, founded by ${ownerName}. We are a modern sanctuary dedicated to ${specialties || 'exceptional salon services'}. Blending a ${vibe || 'luxury'} aesthetic with high-performance organic products, our mission is to make every client feel renewed and confident.`
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Write a high-converting tagline (max 10 words) and a compelling salon story/about bio (2-3 sentences) for a beauty business with the following details:
Salon Name: ${businessName}
Category: ${businessType}
Founder: ${ownerName}
Atmosphere/Vibe: ${vibe}
Specialties: ${specialties}

Return strictly valid JSON in this format:
{"tagline": "...", "bio": "..."}`;

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json(parsed);
      } else {
        throw new Error('Empty AI response');
      }
    } catch (err) {
      console.warn('Gemini generation error:', err);
      return res.json({
        tagline: `Redefining beauty & relaxation in a luxury space.`,
        bio: `Welcome to ${req.body.businessName || 'our studio'}. Our passionate team offers bespoke salon treatments designed to accentuate your unique natural style.`
      });
    }
  });

  // Promotional Image Generation Endpoint with Gemini
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

  // Promotional Copy and Caption Generation Endpoint
  app.post("/api/generate-promo-copy", async (req, res) => {
    try {
      const { businessName, serviceName, price, offer, city, discountPercent } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.json({
          whatsapp: `✨ *EXCLUSIVE SALON OFFER* ✨\n\nHey beautiful! Treat yourself to *${serviceName}* at *${businessName}* in ${city || 'our studio'}.\n\n🎉 *Special Offer*: ${offer || `${discountPercent || 20}% OFF this week!`}\n💰 *Price*: ₹${price ? Number(price).toLocaleString('en-IN') : 'Special Rate'}\n\n📍 Visit us at: ${city || 'Indiranagar, Bengaluru'}\n📲 Reserve your slot now before slots fill up!`,
          instagramCaption: `✨ Glow up season is here! ✨\n\nExperience pure relaxation with our signature *${serviceName}* at ${businessName}.\n\n💎 *Special Deal*: ${offer || `Enjoy ${discountPercent || 20}% OFF for a limited time!`}\n⭐ Price: ₹${price ? Number(price).toLocaleString('en-IN') : 'Special Rate'}\n\n📍 ${city || 'Bengaluru'} | ⏰ Limited slots available\n\n👇 Tap the link in bio to book your appointment!\n\n#SalonOffers #${businessName?.replace(/\s+/g, '') || 'Salon'} #${serviceName?.replace(/\s+/g, '') || 'Beauty'} #SelfCare #GlowUp #HairAndSkin #BridalBeauty #SalonDeals`,
          headline: `Transform Your Look with ${serviceName}`,
          badgeText: offer ? offer.toUpperCase() : `SPECIAL ${discountPercent || 20}% OFF`
        });
      }

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are an elite beauty salon social media marketing copywriter. Create promotional copy for a salon service with these details:
Salon: ${businessName}
Service: ${serviceName}
Price: ₹${price}
Special Offer: ${offer || `${discountPercent || 20}% OFF`}
City: ${city || 'India'}

Return strictly JSON with the following keys:
{
  "whatsapp": "A high-converting WhatsApp message with emojis, clear bullet points, price details, and a booking call-to-action.",
  "instagramCaption": "An engaging Instagram caption with hook, offer details, CTA ('Link in bio to book'), and 10 relevant hashtags.",
  "headline": "A short, punchy promotional banner headline (max 6 words)",
  "badgeText": "Short badge text for image corner (e.g. '20% OFF TODAY' or 'FESTIVE SPECIAL', max 4 words)"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const text = response.text;
      if (text) {
        return res.json(JSON.parse(text));
      }
      throw new Error("Empty copy response");
    } catch (err) {
      console.warn("Copy generation error:", err);
      return res.json({
        whatsapp: `✨ *EXCLUSIVE SALON OFFER* ✨\n\nHey beautiful! Treat yourself to *${req.body.serviceName || 'our signature treatment'}* at *${req.body.businessName || 'our salon'}*.\n\n🎉 *Special Deal*: ${req.body.offer || 'Exclusive Discount This Week'}\n💰 *Price*: ₹${req.body.price || 'Special Rate'}\n\n📲 Book your appointment now!`,
        instagramCaption: `✨ Elevate your everyday glow! ✨\n\nBook your *${req.body.serviceName || 'treatment'}* today at ${req.body.businessName || 'our studio'}.\n\n👇 Tap link in bio to book your appointment!\n\n#Salon #Beauty #SelfCare #SalonDeals`,
        headline: `Special Offer: ${req.body.serviceName || 'Signature Service'}`,
        badgeText: req.body.offer ? req.body.offer.toUpperCase() : 'LIMITED SPECIAL'
      });
    }
  });


  // -------------------------------------------------------------------------
  // YOUTUBE MANAGEMENT API (mirrors api/index.ts so the editor works in dev)
  // -------------------------------------------------------------------------

  // Auto-fetch latest videos from a YouTube channel via the Data API.
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

  // Fetch metadata (title / thumbnail / likes) for a single YouTube URL.
  app.post("/api/fetch-youtube-meta", handleFetchYouTubeMetadata);

  // JSON 404 for unmatched /api/* routes (registered after all routes above).
  // Without this the SPA receives an HTML error page and res.json() callers
  // only see a confusing SyntaxError instead of the real status.
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'API route not found' });
  });

  // Global JSON error handler for better debugging.
  // NOTE: must be registered AFTER the routes above — an error middleware
  // registered before them never fires, so route crashes used to surface as
  // opaque HTML error pages instead of this JSON payload. (Express 4 only
  // forwards *synchronous* errors here; async route handlers are individually
  // wrapped in try/catch above so rejected promises never escape as crashes.)
  app.use((err: any, _req: any, res: any, next: any) => {
    if (res.headersSent) {
      return next(err);
    }
    // Malformed JSON bodies (e.g. a truncated fetch payload) are client errors
    // (400), not server crashes (500).
    const isBodyError = err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large';
    if (isBodyError) {
      console.warn('[API] Malformed request body:', err?.message);
      return res.status(err?.status || 400).json({ success: false, error: 'Malformed JSON request body.' });
    }
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error('Unhandled Server Error:', err);
    res.status(status).json({ success: false, error: err?.message || 'Internal Server Error' });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexora Salon OS running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
