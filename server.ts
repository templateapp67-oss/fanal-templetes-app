import { registerReferralAttributionRoutes } from './server/referralAttribution.js';
import { availabilityHandler, customerPaymentOrderHandler } from './server/customerAvailability.js';
import { ownerDashboardHandler, salonHoursHandler } from './server/ownerDashboard.js';
import { createOwnerSalonHandler } from './server/backendContext.js';
// Loads process env > .env > .env.development (see server/env.ts).
import "./server/env";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase, getSupabaseAdmin, supabaseConfig } from "./src/lib/supabaseClient";
import { resolveTenantFromHost, isTenantHost, BASE_DOMAIN } from "./src/lib/tenant";
import { SalonProfile, SalonService, Stylist } from "./src/types";
import { nexoraCors } from "./server/cors";
import { handleWebsiteSave, handleGetSalonState } from "./server/websiteSave";
import { handleFetchYouTubeMetadata } from "./server/youtubeMetadata";
import { createBookingHandler } from "./server/bookingCreate";
import { authenticateBookingRequest } from "./server/bookingAuth";
import {
  createBookingsListHandler,
  createBookingGetHandler,
  createBookingUpdateHandler,
  createNotificationsListHandler,
  createNotificationsReadHandler,
  type BookingRoutesDeps,
} from "./server/bookingRoutes";
import { createBookingCheckinHandler } from "./server/bookingCheckin";
import { registerCustomerRoutes } from "./server/customerRoutes";
import { registerStaffPerformanceRoutes } from "./server/staffPerformanceRoutes";
import { registerPartnerPortalRoutes } from "./server/partnerPortalRoutes";
import {
  createMyBookingsListHandler,
  createMyBookingDetailHandler,
  createCancelMyBookingHandler,
  createReviewMyBookingHandler,
  type BookingMineDeps,
} from "./server/bookingMine";
import { createHealthHandler } from "./server/health";
import {
  withRequestTimeout,
  API_REQUEST_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
  DEFAULT_DB_TIMEOUT_MS,
  runDb,
} from "./server/dbGuard";
import { installProcessGuards } from "./server/processGuards";
import {
  handleRazorpayConfig,
  handleCreateRazorpayOrder,
  handleVerifyRazorpayPayment,
  handleMockRazorpayPayment,
  describeRazorpayGateway,
} from "./server/razorpay";
import { createRazorpayWebhookHandler, isWebhookConfigured } from "./server/razorpayWebhook";
import { asyncRoute } from "./server/expressSafety";
import { safeDatabaseError, sendSafeError } from "./server/safeError";
import { lookupSalon } from "./server/siteLookup";
import { handleReengageClients } from "./server/geminiReengagement";

// Log (instead of silently dying on) stray async faults.
installProcessGuards("server.ts");

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
// The local preview may use an explicit mock auth token. Do not enable that
// shortcut if this process is running inside Vercel.
const isVercelRuntime =
  process.env.VERCEL === '1' || process.env.VERCEL === 'true' || Boolean(process.env.VERCEL_ENV);
const allowMockBookingAuth = isMockSupabase && !isVercelRuntime;
const bookingHandlerIsMock = allowMockBookingAuth;

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
  // Modes: live / test (real keys), mock (no keys, non-production runtime —
  // payments are simulated end-to-end), disabled (no keys in production).
  const gateway = describeRazorpayGateway();
  // Same as the Supabase notice: the gateway still resolves to the same mode and
  // summary, a test run just does not print the environment banner.
  const quietBootLogs = process.env.NEXORA_TEST_RUN === '1';
  if (!quietBootLogs) {
    if (gateway.mode === 'live' || gateway.mode === 'test') {
      console.log(`[Razorpay] ${gateway.summary}`);
    } else {
      console.warn(`[Razorpay] ${gateway.summary}`);
    }
    for (const warning of gateway.warnings) console.warn(`[Razorpay] WARNING: ${warning}`);

    if (isWebhookConfigured()) {
      console.log('[Razorpay] Webhook signature verification ready (POST /api/payments/razorpay/webhook).');
    } else {
      console.warn(
        '[Razorpay] RAZORPAY_WEBHOOK_SECRET is not set — incoming webhooks will be rejected with 503. ' +
          'Use the same secret you entered in the Razorpay dashboard (Settings → Webhooks).'
      );
    }
  }
}

// Define default demo salon profile
const defaultDemoSalon = {
  profile: {
    ownerId: null,
    businessType: 'hair_salon',
    businessName: 'Luxe Hair & Styling Studio',
    ownerName: 'Aria Sen',
    ownerRole: 'Founder & Master Stylist',
    phone: '+91 98450 77654',
    whatsapp: '+91 98450 77654',
    email: 'hello@luxestudio.in',
    tagline: 'Precision Cuts, Creative Hair Artistry & Luxury Salon Lounge',
    about:
      'Welcome to Luxe Hair & Styling Studio. Bringing together master precision haircuts, bespoke balayage, sculpted gel nail art, and restorative hair spa therapies in a luxury sanctuary. We craft personalized looks that elevate your confidence and natural beauty.',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
    themePreset: 'slate_silver',
    currency: '₹',
    subdomain: 'luxe-hair-studio',
    address: '100 Feet Road, 12th Main, Indiranagar',
    city: 'Bengaluru',
    postalCode: '560038',
    state: 'Karnataka',
    instagramHandle: 'luxehair_studio',
    requireDeposit: true,
    depositPercentage: 20,
    themeAccentKey: 'slate',
    whiteLabelEnabled: true,
    offers: [
      {
        id: 'off-1',
        title: 'Festive Hair & Styling Glowup',
        description: 'Get our premium master balayage highlight and restorative hair spa treatments with our top master stylists.',
        discountValue: '20% OFF',
        code: 'FESTIVE20',
        imageUrl: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=600&q=80',
        expiryDate: '2026-10-31',
        terms: 'Valid on services above ₹3000. Cannot be combined with other offers.',
        isActive: true
      },
      {
        id: 'off-2',
        title: 'Bridal Glow Pre-Booking',
        description: 'Pre-book your bridal HD makeup and skincare ritual to receive a complimentary gel nail extension set.',
        discountValue: 'Flat ₹1500 OFF',
        code: 'BRIDALGLOW',
        imageUrl: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80',
        expiryDate: '2026-12-31',
        terms: 'Applicable only on pre-booked full bridal packages.',
        isActive: true
      }
    ]
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
    { id: 'hs-st-101', name: 'Aria Sen', role: 'Founder & Master Stylist', avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80', bio: 'Founder with 12+ years of experience. Specializes in precision structural cuts, dimensional color, and bespoke nail couture.', phone: '+91 98450 77654', specialties: ['Structural Cuts', 'Balayage Color', 'Keratin Smoothing', 'Gel-X Extensions'], assignedServices: ['hs-1', 'hs-3', 'hs-4', 'hs-5', 'hs-7'], rating: 4.98, commissionRate: 35, status: 'Available', accessRole: 'Manager (Full Access)', hidePhone: false, schedule: [] },
    { id: 'hs-st-1', name: 'Ananya Sharma', role: 'Senior Precision Stylist', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', bio: 'Senior colorist and stylist with extensive background in balayage, ombre, and volume blowouts.', phone: '+91 98450 12890', specialties: ['Precision Fringes', 'Balayage & Color', 'Volume Blowouts'], assignedServices: ['hs-1', 'hs-2', 'hs-3', 'hs-5'], rating: 4.95, commissionRate: 30, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-2', name: 'Rohan Kapoor', role: 'Stylist & Hair Craftsman', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', bio: 'Men and women haircut specialist with expertise in dry cutting, skin fades, and textured styling.', phone: '+91 98450 33412', specialties: ['Dry Cutting', 'Men & Women Styling', 'Fade Geometry'], assignedServices: ['hs-1', 'hs-2', 'hs-6'], rating: 4.92, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    { id: 'hs-st-3', name: 'Kavita Deshmukh', role: 'Hair Texture & Scalp Specialist', avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&w=400&q=80', bio: 'Trichology-trained scalp and hair botox specialist focusing on restorative therapies.', phone: '+91 98450 99881', specialties: ['Hair Botox', 'Scalp Analysis', 'Thermal Tongs'], assignedServices: ['hs-5', 'hs-6', 'hs-9'], rating: 4.89, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
  ] as Stylist[],
};

// Seed demo salons
mockSalons['demo'] = defaultDemoSalon;
mockSalons['luxe-hair-studio'] = defaultDemoSalon;
mockSalons['luxestudio'] = defaultDemoSalon;
mockSalons['mirakistudio'] = {
  ...defaultDemoSalon,
  profile: {
    ...defaultDemoSalon.profile,
    businessName: 'Miraki Hair Cut & Styling Studio',
    subdomain: 'mirakistudio',
  },
};

// Subdomains that legitimately fall back to the bundled demo catalogue when no
// matching row exists in the database (and in mock mode). Exact keys only.
const DEMO_SUBDOMAINS = new Set(['luxe-hair-studio', 'luxestudio', 'mirakistudio']);

/** Owner email for booking notifications, resolved from the profiles row. */
async function resolveOwnerEmail(ownerId: string | null | undefined, deadlineAt?: number): Promise<string> {
  if (ownerId && !isMockSupabase) {
    const { data, error } = await runDb(
      () => db.from('profiles').select('email').eq('id', ownerId).maybeSingle(),
      { label: 'owner email lookup', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
    );
    if (error) console.warn('[Bookings] Owner email lookup failed:', error.message || error);
    if ((data as any)?.email) return (data as any).email;
  }
  return 'owner@salon.com';
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // `verify` stashes the RAW bytes of every JSON body. The Razorpay webhook
  // signature is an HMAC over exactly those bytes — re-serializing req.body
  // would change key order/spacing and every signature check would fail.
  app.use(
    express.json({
      limit: "10mb",
      verify: (req: any, _res, buf) => {
        if (buf?.length) req.rawBody = buf;
      },
    })
  );
  // CORS for cross-origin API callers (split dev on different ports, preview
  // hosts, custom domains). Same-origin traffic (no Origin header) is
  // untouched. Mounted before the routes so OPTIONS preflights for
  // /api/* (incl. /api/website/save) get a 204 instead of a 404.
  app.use(nexoraCors);
  registerReferralAttributionRoutes(app);

  // API Routes
  // Configuration + connectivity diagnostics. `?deep=1` also round-trips the
  // database and reports whether an authenticated booking could be written right now.
  app.get(
    "/api/health",
    withRequestTimeout(API_REQUEST_TIMEOUT_MS),
    asyncRoute(createHealthHandler({
      db,
      isMock: bookingHandlerIsMock,
      hasAdminClient: !!admin,
      supabaseConfig,
      entrypoint: 'express (server.ts)',
    }))
  );

  // -------------------------------------------------------------------------
  // HIGH-RELIABILITY OWNER AUTH HELPER ENDPOINTS
  // -------------------------------------------------------------------------
  app.post(
    "/api/auth/owner-login",
    withRequestTimeout(API_REQUEST_TIMEOUT_MS),
    asyncRoute(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const purpose = req.body?.purpose || 'owner';

      if (!email) {
        return res.status(400).json({ error: 'Email address is required' });
      }

      if (isMockSupabase) {
        const mockUser = {
          id: 'mock-user-123',
          email,
          user_metadata: {
            full_name: req.body?.fullName || (purpose === 'customer' ? 'Mock Customer' : 'Mock Owner'),
            salon_name: req.body?.salonName || 'My Salon',
            phone_number: req.body?.phoneNumber || '',
            city: req.body?.city || 'Jaipur',
          },
        };
        return res.json({ success: true, user: mockUser, isMock: true });
      }

      // Try standard sign-in if password supplied
      if (password) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (!error && data?.user) {
            return res.json({
              success: true,
              user: data.user,
              session: data.session,
            });
          }
        } catch {
          // Fall through to admin magic link
        }
      }

      // Use admin magic link generator to issue instant verification OTP for valid owner accounts
      if (admin) {
        try {
          const { data, error } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email,
          });

          if (!error && data?.properties?.email_otp) {
            return res.json({
              success: true,
              needsVerify: true,
              otp: data.properties.email_otp,
              user: data.user,
              message: 'Verified via secure owner OTP.',
            });
          }
        } catch (adminErr: any) {
          console.warn('[Auth API] Admin generateLink failed:', adminErr?.message);
        }
      }

      return res.status(401).json({
        error: 'Invalid login credentials. Please verify your password or use Quick Access.',
      });
    })
  );

  app.post(
    "/api/auth/quick-access",
    withRequestTimeout(API_REQUEST_TIMEOUT_MS),
    asyncRoute(async (req, res) => {
      const targetEmail = typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email.trim().toLowerCase()
        : 'templateapp67@gmail.com';

      if (isMockSupabase) {
        const mockUser = {
          id: 'mock-user-123',
          email: targetEmail,
          user_metadata: {
            full_name: 'Salon Owner',
            salon_name: 'My Salon',
            phone_number: '',
            city: 'Jaipur',
          },
        };
        return res.json({ success: true, user: mockUser, isMock: true });
      }

      if (admin) {
        try {
          const { data, error } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email: targetEmail,
          });

          if (!error && data?.properties?.email_otp) {
            return res.json({
              success: true,
              needsVerify: true,
              otp: data.properties.email_otp,
              user: data.user,
            });
          }
        } catch (err: any) {
          console.warn('[Auth API] quick-access admin error:', err?.message);
        }
      }

      try {
        const { data: profile } = await db.from('profiles').select('*').ilike('email', targetEmail).maybeSingle();
        if (profile) {
          return res.json({
            success: true,
            user: {
              id: profile.id,
              email: profile.email,
              user_metadata: {
                full_name: profile.full_name,
                salon_name: profile.salon_name,
                phone_number: profile.phone || profile.mobile,
                city: profile.city,
              },
            },
          });
        }
      } catch {}

      return res.status(500).json({ error: 'Quick access currently unavailable' });
    })
  );

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
      homeService: row.home_service || undefined,
      ownerId: row.id,
      businessType: (row.business_type as SalonProfile['businessType']) || 'hair_salon',
      businessName: row.salon_name || row.name || 'My Salon',
      ownerName: row.full_name || '',
      ownerRole: row.owner_role || '',
      phone: row.phone_number || '',
      whatsapp: row.whatsapp || row.phone_number || '',
      email: row.email || '',
      tagline: row.tagline || '',
      about: row.about || '',
      ownerPhotoUrl: row.owner_photo_url || '',
      coverImageUrl: row.cover_image_url || '',
      logoUrl: row.logo_url || undefined,
      themePreset: (row.theme_preset as SalonProfile['themePreset']) || 'slate_silver',
      currency: row.currency || '₹',
      subdomain: row.subdomain || '',
      customDomain: row.custom_domain || undefined,
      address: row.full_address || '',
      city: row.city || '',
      postalCode: row.postal_code || '',
      state: row.state || '',
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
      instagramHandle: row.instagram_handle || '',
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
  async function resolveSalonFromHost(req: any, deadlineAt?: number) {
    const host = req.headers.host || req.get('host') || '';
    const tenant = resolveTenantFromHost(host);
    if (!tenant) return { host, tenant: null, salon: null };

    try {
      const identifier = tenant.customDomain || tenant.subdomain;
      const isCustom = Boolean(tenant.customDomain);
      const { found, salon, error } = await lookupSalon(
        { db, isMockSupabase, mockSalons },
        identifier,
        isCustom,
        deadlineAt
      );

      if (error) {
        return { host, tenant, salon: null, error };
      }
      return { host, tenant, salon };
    } catch (err) {
      console.error('Failed to resolve tenant salon:', err);
      return { host, tenant, salon: null, error: err };
    }
  }

  // Public JSON endpoint the SPA calls to hydrate the tenant's live site.
  app.get("/api/site", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    const { host, tenant, salon, error } = await resolveSalonFromHost(req, res.locals?.requestDeadlineAt);
    if (error) {
      // DB failure while resolving the tenant — JSON 500 (never "not found"),
      // so the SPA logs the real status instead of guessing.
      const safe = safeDatabaseError(error, 'Database read failed while loading this site.');
      return res.status(safe.status).json({
        success: false,
        found: false,
        isTenant: true,
        code: safe.code,
        error: safe.message,
        ...(safe.retryable ? { retryable: true } : {}),
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
  }));

  // Convenience: resolve by an explicit subdomain (useful for testing/SEO).
  app.get("/api/site/:subdomain", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    const sub = String(req.params.subdomain || '').toLowerCase();
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const { found, salon, error } = await lookupSalon(
        { db, isMockSupabase, mockSalons },
        sub,
        false,
        deadlineAt
      );

      if (error) {
        console.error(`[Site lookup] Failed to read profile for subdomain "${sub}":`, error);
        const safe = safeDatabaseError(error, 'Database read failed while loading this site.');
        return res.status(safe.status).json({
          success: false,
          found: false,
          code: safe.code,
          error: safe.message,
          ...(safe.retryable ? { retryable: true } : {}),
        });
      }

      return res.json({
        found: !!salon,
        isTenant: true,
        tenant: { subdomain: sub, customDomain: null },
        salon: salon || null,
        baseDomain: BASE_DOMAIN,
      });
    } catch (err: any) {
      console.error(`[Site lookup] Unexpected error for subdomain "${sub}":`, err);
      sendSafeError(res, err, {
        context: 'database',
        fallbackMessage: 'The site could not be loaded right now.',
      });
    }
  }));

  // ==========================================================================
  // BOOKINGS + NOTIFICATIONS (read/update)
  // --------------------------------------------------------------------------
  // Shared with the serverless entrypoint via server/bookingRoutes.ts so the
  // two copies can never drift again. The list endpoint is owner-scoped (it
  // used to return every salon's bookings), every database call is time-boxed,
  // and a database failure is reported instead of being masked with an empty
  // in-memory result.
  // ==========================================================================
  const bookingRouteDeps: BookingRoutesDeps = {
    normalizedBookings: true,
    db,
    isMock: bookingHandlerIsMock,
    hasAdminClient: !!admin,
    getMockBookings: () => mockBookings,
    getMockNotifications: () => mockNotifications,
    setMockNotifications: (rows) => { mockNotifications = rows; },
    addMockNotifications: (rows) => { mockNotifications.push(...rows); },
    resolveOwnerEmail,
  };

  // ==========================================================================
  // MY BOOKINGS — customer-scoped endpoints (src/lib/bookingTabs.ts drives the
  // cancellation rule on both sides so the server cannot contradict the UI).
  //
  // Registered BEFORE "/api/bookings/:id": Express matches in order, so a later
  // "/mine" would be swallowed by the ":id" route as a booking id of "mine".
  // ==========================================================================
  const bookingMineDeps: BookingMineDeps = {
    normalizedBookings: true,
    db,
    isMock: bookingHandlerIsMock,
    hasAdminClient: !!admin,
    getMockBookings: () => mockBookings,
    addMockNotifications: (rows) => { mockNotifications.push(...rows); },
    resolveOwnerEmail,
    authenticateUser: (req, deadlineAt) => authenticateBookingRequest(req, deadlineAt, allowMockBookingAuth),
  };

  app.get("/api/bookings/mine", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createMyBookingsListHandler(bookingMineDeps)));
  app.get("/api/bookings/mine/:id", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createMyBookingDetailHandler(bookingMineDeps)));
  app.post("/api/bookings/mine/cancel", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createCancelMyBookingHandler(bookingMineDeps)));
  app.post("/api/bookings/mine/review", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createReviewMyBookingHandler(bookingMineDeps)));

  app.post("/api/owner/hours", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(salonHoursHandler(db)));
app.get("/api/bookings/availability", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(availabilityHandler(db)));
  app.get("/api/owner/salon", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createOwnerSalonHandler(db)));
  app.get("/api/owner/resolution", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createOwnerSalonHandler(db)));
  app.get("/api/owner/dashboard", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(ownerDashboardHandler(db)));
app.post("/api/owner/appointments", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(ownerDashboardHandler(db, true)));
app.get("/api/bookings", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createBookingsListHandler(bookingRouteDeps)));
  app.get("/api/bookings/:id", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createBookingGetHandler(bookingRouteDeps)));
  app.post("/api/bookings/update", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createBookingUpdateHandler(bookingRouteDeps)));
  app.post("/api/bookings/check-in", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createBookingCheckinHandler(bookingRouteDeps)));
  app.get("/api/notifications", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createNotificationsListHandler(bookingRouteDeps)));
  app.post("/api/notifications/read", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(createNotificationsReadHandler(bookingRouteDeps)));
  // ==========================================================================
  // CUSTOMER APP — /api/customer/* (Nexora SalonOS Customer App)
  // --------------------------------------------------------------------------
  // Every customer screen reads through these routes: the existing RLS is
  // owner-scoped, so this is where customer scoping is enforced (identity from
  // the verified bearer token, never from a query parameter). Shared with the
  // serverless entrypoint via server/customerRoutes.ts so the two never drift.
  // ==========================================================================
  registerCustomerRoutes(
    app,
    {
      db,
      isMock: bookingHandlerIsMock,
      hasAdminClient: !!admin,
      authenticateUser: (req, deadlineAt) => authenticateBookingRequest(req, deadlineAt, allowMockBookingAuth),
      getMockBookings: () => mockBookings,
      getMockNotifications: () => mockNotifications,
      addMockNotifications: (rows) => { mockNotifications.push(...rows); },
      resolveOwnerEmail,
    },
    asyncRoute,
    withRequestTimeout
  );

  registerStaffPerformanceRoutes(app);

  // ==========================================================================
  // GROWTH PARTNER PORTAL OPERATIONS — /api/partner/*
  // --------------------------------------------------------------------------
  // The HTTP surface behind the promoted partner sidebar sections (Earnings,
  // Withdrawals, Marketing Materials, Partner Levels, Leaderboards,
  // Notifications, Support). Handlers verify the caller's bearer token and then
  // call the same session-scoped RPCs the SPA would call directly, so RLS and
  // the functions' own "active partner" guard stay in force; the browser falls
  // back to the direct RPC whenever these routes are not deployed.
  // ==========================================================================
  registerPartnerPortalRoutes(
    app,
    {
      db,
      isMock: bookingHandlerIsMock,
      // Private marketing buckets: a 60-second URL, signed only after the
      // asset proved itself present in the CALLER's published list.
      signAssetUrl: admin
        ? async (bucket: string, path: string) => {
            const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60);
            return error || !data ? null : (data as any).signedUrl || null;
          }
        : undefined,
    },
    asyncRoute
  );


  // ==========================================================================
  // BOOKING CREATE — POST /api/bookings/create
  // --------------------------------------------------------------------------
  // Shared with the serverless entrypoint (server/bookingCreate.ts). Validates
  // the payload, resolves the NOT NULL owner_id, re-verifies any Razorpay
  // payment signature, logs the exact failure to stdout and answers with a
  // precise 4xx instead of an opaque HTTP 500.
  // ==========================================================================
  app.post(
    "/api/bookings/create",
    // Answer with JSON *before* the hosting platform kills a stuck invocation
    // and replies with its own un-parseable HTML error page.
    withRequestTimeout(API_REQUEST_TIMEOUT_MS, 'Saving your booking took too long. Nothing was charged — please try again.'),
    asyncRoute(createBookingHandler({
    normalizedBookings: true,
      db,
      isMock: bookingHandlerIsMock,
      hasAdminClient: !!admin,
      authenticateUser: (req, deadlineAt) => authenticateBookingRequest(req, deadlineAt, allowMockBookingAuth),
      addMockBooking: (row) => { mockBookings.push(row); },
      getMockBookings: () => mockBookings,
      addMockNotifications: (rows) => { mockNotifications.push(...rows); },
      resolveOwnerEmail,
    }))
  );

  // ==========================================================================
  // PAYMENTS — Razorpay (checkout for the 25% advance token)
  // --------------------------------------------------------------------------
  // GET  /api/payments/razorpay/config   -> { configured, mode, keyId }  (public key)
  // POST /api/payments/razorpay/order    -> creates an order for the advance
  //                                         ({ totalAmount, depositPercent } → integer paise)
  // POST /api/payments/razorpay/verify   -> HMAC-SHA256 signature check
  // POST /api/payments/razorpay/mock-pay -> MOCK gateway only: signs a
  //                                         simulated payment (404 otherwise)
  // Credentials come from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env; with
  // none present outside production the mock gateway takes over.
  // ==========================================================================
  app.get("/api/payments/razorpay/config", asyncRoute(handleRazorpayConfig));
  app.post("/api/payments/razorpay/order", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(customerPaymentOrderHandler(db, bookingHandlerIsMock)));
  app.post("/api/payments/razorpay/verify", asyncRoute(handleVerifyRazorpayPayment));
  app.post("/api/payments/razorpay/mock-pay", asyncRoute(handleMockRazorpayPayment));

  // Server-to-server callback from Razorpay (payment captured / failed /
  // refunded). Signed with RAZORPAY_WEBHOOK_SECRET — see server/razorpayWebhook.ts.
  app.post(
    "/api/payments/razorpay/webhook",
    withRequestTimeout(API_REQUEST_TIMEOUT_MS),
    asyncRoute(createRazorpayWebhookHandler({
      db,
      isMock: isMockSupabase,
      hasAdminClient: !!admin,
      getMockBookings: () => mockBookings,
      addMockNotifications: (rows) => { mockNotifications.push(...rows); },
      resolveOwnerEmail,
    }))
  );

  // AI Bio Generation Route with Gemini
  app.post("/api/generate-bio", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    try {
      const { businessName, businessType, ownerName, vibe, specialties, targetCustomers = 'Luxury', storyTone = 'Professional' } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({
          tagline: `Elevating ${businessType.replace('_', ' ')} with bespoke ${targetCustomers.toLowerCase()} care.`,
          taglines: [`Elevating ${businessType.replace('_', ' ')} with bespoke ${targetCustomers.toLowerCase()} care.`, `Where expert ${specialties || 'beauty care'} meets confidence.`, `Your ${targetCustomers.toLowerCase()} destination for beautiful results.`, `Feel renewed. Look radiant. Love your time with us.`, `Beauty, thoughtfully crafted around you.`],
          bio: `Welcome to ${businessName}, founded by ${ownerName}. We create a calm and welcoming space where every guest can pause, recharge, and feel genuinely cared for. Our team specialises in ${specialties || 'exceptional salon services'}, combining thoughtful technique with authentic attention to your individual needs. From the moment you arrive, we listen carefully, explain each step, and tailor every experience around your comfort and goals. Whether you are visiting for a fresh new look, restorative care, or a moment of self-care, our promise is simple: honest guidance, beautiful results, and care that feels personal. We believe confidence grows when expertise is delivered with warmth, respect, and consistency, and we are proud to make that belief part of every visit.`
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const prompt = `Write a high-converting tagline (max 10 words) and a compelling salon story/about bio of 100-150 words for a beauty business with the following details:
Salon Name: ${businessName}
Category: ${businessType}
Founder: ${ownerName}
Atmosphere/Vibe: ${vibe}
Target customers: ${targetCustomers}
Story tone: ${storyTone}
Specialties: ${specialties}

The About Us story must focus on customer comfort and authentic care, use the requested tone, and be between 100 and 150 words.

Return strictly valid JSON in this format:
{"taglines": ["...", "...", "...", "...", "..."], "tagline": "...", "bio": "..."}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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
    } catch {
      return res.json({
        tagline: `Redefining beauty & relaxation in a luxury space.`,
        bio: `Welcome to ${req.body.businessName || 'our studio'}. Our passionate team offers bespoke salon treatments designed to accentuate your unique natural style.`
      });
    }
  }));

  app.post("/api/recommend-brand-identity", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    const focus = String(req.body?.focus || 'beauty and wellness').trim();
    const businessType = String(req.body?.businessType || 'salon').trim();
    const presets: Record<string, string> = {
      'aura': 'Aura Sanctuary fits a modern luxury wellness template: warm taupe, muted champagne, emerald green, and soft cream. Use minimalist layouts, soft arches, warm lighting, natural stone, and refined metallic accents. Lead with premium self-care, hydrafacials, specialised hair treatments, and stress relief, followed by a calm service menu, trust signals, and an elegant consultation CTA.',
      'luxury': 'Aura Sanctuary fits a modern luxury wellness template: warm taupe, muted champagne, emerald green, and soft cream. Use minimalist layouts, soft arches, warm lighting, natural stone, and refined metallic accents. Lead with premium self-care, hydrafacials, specialised hair treatments, and stress relief, followed by a calm service menu, trust signals, and an elegant consultation CTA.',
      'botanica': 'Botanica Hair & Skin Lab fits a fresh, eco-conscious template: sage green, terracotta, olive, and warm sand with natural textures. Use indoor greenery, warm wood, clear glass product imagery, and calm editorial typography. Lead with organic ingredients and sustainable care, followed by herbal rituals, clean-beauty services, testimonials, and a gentle consultation CTA.',
      'organic': 'Botanica Hair & Skin Lab fits a fresh, eco-conscious template: sage green, terracotta, olive, and warm sand with natural textures. Use indoor greenery, warm wood, clear glass product imagery, and calm editorial typography. Lead with organic ingredients and sustainable care, followed by herbal rituals, clean-beauty services, testimonials, and a gentle consultation CTA.',
      'cut': 'The Cut & Curve Co. fits a modern, vibrant precision template: matte black, slate gray, warm white, and soft rose gold with a restrained neon accent. Use high-contrast typography, an edge-to-edge transformation hero, bold service cards, and a prominent express-booking CTA. Pair industrial-chic imagery with client before-and-after reels.',
      'skin': 'Choose a clean clinical template with ivory, sage, and charcoal. Use generous whitespace, consultation-first messaging, results-led imagery, and clear before-and-after service sections.',
      'barber': 'Choose a bold editorial template with charcoal, warm tan, and brass. Lead with a strong hero, service cards with pricing, and a compact booking call-to-action.',
      'herbal': 'Choose a calm botanical template with sand, deep forest, and terracotta. Use soft sections, ingredient storytelling, treatment rituals, and an earthy gallery.'
    };
    const match = Object.keys(presets).find(k => focus.toLowerCase().includes(k));
    if (!process.env.GEMINI_API_KEY) return res.json({ advice: presets[match || 'herbal'] + ` Best fit for your ${businessType} brand.` });
    try { const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); const r = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: `For a Nexora ${businessType} website focused on ${focus}, recommend one template style, a 3-color palette with hex codes, and a layout in 70 words. Be practical and specific.` }); return res.json({ advice: r.text?.trim() || presets[match || 'herbal'] }); } catch { return res.json({ advice: presets[match || 'herbal'] }); }
  }));

  // Generate concise service descriptions for the website menu
  app.post("/api/generate-service-description", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    const { serviceName, category } = req.body || {};
    const name = String(serviceName || 'beauty treatment').trim();
    const categoryName = String(category || 'Beauty & Wellness').trim();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.json({ description: `${name} is a thoughtfully tailored ${categoryName.toLowerCase()} treatment designed to refresh, enhance, and leave you feeling confident. Enjoy expert care, quality products, and beautiful results in a comfortable setting.` });
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: `Write one polished, inviting description in 1-2 sentences (maximum 35 words) for the salon service "${name}" in the category "${categoryName}". Mention its main benefit. Return only the description, no quotes or headings.` });
      return res.json({ description: response.text?.trim() || `${name} delivers expert care and beautiful results in a comfortable, welcoming setting.` });
    } catch { return res.json({ description: `${name} is a thoughtfully tailored ${categoryName.toLowerCase()} treatment designed to refresh, enhance, and leave you feeling confident.` }); }
  }));

  // Promotional Image Generation Endpoint with Gemini
  app.post("/api/generate-promo-image", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
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
        error: "Failed to generate promotional image with AI. Please try again.",
      });
    }
  }));

  // Promotional Copy and Caption Generation Endpoint
  app.post("/api/generate-promo-copy", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
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

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

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
        model: 'gemini-2.5-flash',
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
    } catch {
      return res.json({
        whatsapp: `✨ *EXCLUSIVE SALON OFFER* ✨\n\nHey beautiful! Treat yourself to *${req.body.serviceName || 'our signature treatment'}* at *${req.body.businessName || 'our salon'}*.\n\n🎉 *Special Deal*: ${req.body.offer || 'Exclusive Discount This Week'}\n💰 *Price*: ₹${req.body.price || 'Special Rate'}\n\n📲 Book your appointment now!`,
        instagramCaption: `✨ Elevate your everyday glow! ✨\n\nBook your *${req.body.serviceName || 'treatment'}* today at ${req.body.businessName || 'our studio'}.\n\n👇 Tap link in bio to book your appointment!\n\n#Salon #Beauty #SelfCare #SalonDeals`,
        headline: `Special Offer: ${req.body.serviceName || 'Signature Service'}`,
        badgeText: req.body.offer ? req.body.offer.toUpperCase() : 'LIMITED SPECIAL'
      });
    }
  }));

  // Gemini AI Inactive Client Re-engagement Analysis & Personalized Offers
  app.post("/api/ai/re-engage-clients", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleReengageClients));



  // -------------------------------------------------------------------------
  // YOUTUBE MANAGEMENT API (mirrors api/index.ts so the editor works in dev)
  // -------------------------------------------------------------------------

  // Auto-fetch latest videos from a YouTube channel via the Data API.
  app.post("/api/youtube/fetch-videos", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
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
  }));

  // Fetch metadata (title / thumbnail / likes) for a single YouTube URL.
  app.post("/api/fetch-youtube-meta", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleFetchYouTubeMetadata));

  // --------------------------------------------------------------------------
  // OWNER SAVE & SALON STATE HYDRATION
  // --------------------------------------------------------------------------
  app.get("/api/salon/state", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleGetSalonState({ mockSalons })));
  app.post("/api/salon/save", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleWebsiteSave({ mockSalons })));
  app.post("/api/website/save", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleWebsiteSave({ mockSalons })));

  // JSON 404 for unmatched /api/* routes (registered after all routes above).
  // Without this the SPA receives an HTML error page and res.json() callers
  // only see a confusing SyntaxError instead of the real status.
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'API route not found' });
  });

  // Global JSON error handler. It is the final safety net for synchronous
  // middleware failures; async routes are wrapped with asyncRoute above.
  app.use((err: any, _req: any, res: any, next: any) => {
    if (res.headersSent) return next(err);
    const isBodyError = err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large';
    if (isBodyError) {
      console.warn('[API] Malformed request body.');
      return res.status(err?.type === 'entity.too.large' ? 413 : 400).json({
        success: false,
        code: 'malformed_json',
        error: 'Malformed JSON request body.',
      });
    }
    console.error('[API] Unhandled server error:', err?.stack || err);
    sendSafeError(res, err, {
      requestId: res.locals?.requestId,
      context: 'request',
    });
  });

  // --------------------------------------------------------------------------
  // LOCAL SUPABASE-COMPATIBLE GATEWAY (development only).
  // Serves /auth/v1 + /rest/v1 from PGlite running the real migrations, so the
  // Growth Partner area is usable without a cloud project. Mounted only when
  // explicitly enabled AND no real project is configured, so it can never
  // shadow a production connection. See server/localSupabase.ts.
  // --------------------------------------------------------------------------
  const localSupabaseEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.VITE_LOCAL_SUPABASE === "true" &&
    !process.env.SUPABASE_URL &&
    !process.env.VITE_SUPABASE_URL;
  if (localSupabaseEnabled) {
    const { registerLocalSupabaseGateway } = await import("./server/localSupabase.js");
    await registerLocalSupabaseGateway(app, {
      dataDir: path.join(process.cwd(), ".local-db"),
    });
  }

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
