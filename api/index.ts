import { registerReferralAttributionRoutes } from '../server/referralAttribution.js';
import { availabilityHandler, customerPaymentOrderHandler } from '../server/customerAvailability.js';
import { ownerDashboardHandler, salonHoursHandler } from '../server/ownerDashboard.js';
import { createOwnerSalonHandler } from '../server/backendContext.js';
// Loads process env > .env > .env.development (see server/env.ts).
import "../server/env.js";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase, getSupabaseAdmin, supabaseConfig } from "../src/lib/supabaseClient.js";
import { resolveTenantFromHost, BASE_DOMAIN } from "../src/lib/tenant.js";
import { SalonProfile, SalonService, Stylist } from "../src/types.js";
import { nexoraCors } from "../server/cors.js";
import { handleWebsiteSave, handleGetSalonState } from "../server/websiteSave.js";
import { handleFetchYouTubeMetadata } from "../server/youtubeMetadata.js";
import { createBookingHandler } from "../server/bookingCreate.js";
import { authenticateBookingRequest } from "../server/bookingAuth.js";
import {
  createBookingsListHandler,
  createBookingGetHandler,
  createBookingUpdateHandler,
  createNotificationsListHandler,
  createNotificationsReadHandler,
  type BookingRoutesDeps,
} from "../server/bookingRoutes.js";
import { createBookingCheckinHandler } from "../server/bookingCheckin.js";
import { registerCustomerRoutes } from "../server/customerRoutes.js";
import { registerStaffPerformanceRoutes } from "../server/staffPerformanceRoutes.js";
import { registerPartnerPortalRoutes } from "../server/partnerPortalRoutes.js";
import {
  createMyBookingsListHandler,
  createMyBookingDetailHandler,
  createCancelMyBookingHandler,
  createReviewMyBookingHandler,
  type BookingMineDeps,
} from "../server/bookingMine.js";
import { createHealthHandler } from "../server/health.js";
import {
  withRequestTimeout,
  API_REQUEST_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
  DEFAULT_DB_TIMEOUT_MS,
  runDb,
} from "../server/dbGuard.js";
import { installProcessGuards } from "../server/processGuards.js";
import { asyncRoute, normalizeApiRequestUrl } from "../server/expressSafety.js";
import {
  safeDatabaseError,
  sendSafeError,
  ApiValidationError,
  ApiServerError,
  ApiUnavailableError,
  ApiInvalidStateError,
} from "../server/safeError.js";
import { lookupSalon } from "../server/siteLookup.js";
import {
  handleRazorpayConfig,
  handleCreateRazorpayOrder,
  handleVerifyRazorpayPayment,
  handleMockRazorpayPayment,
  describeRazorpayGateway,
} from "../server/razorpay.js";
import { createRazorpayWebhookHandler, isWebhookConfigured } from "../server/razorpayWebhook.js";

// Log (instead of silently dying on) stray async faults.
installProcessGuards("api/index.ts");

const app = express();
// Vercel rewrites and direct function invocations do not always preserve the
// `/api` prefix in req.url. Normalize that shape before Express matches routes.
app.use(normalizeApiRequestUrl);
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
registerReferralAttributionRoutes(app);

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

// In-memory fallback
let mockBookings: any[] = [];
let mockNotifications: any[] = [];
const mockSalons: Record<string, any> = {};

const admin = getSupabaseAdmin();
const db = admin ?? supabase;
// Local/template mode may use the explicit mock auth token. A Vercel function
// must never fall back to that path when production Supabase configuration is
// missing; it should answer with a clear 503 instead.
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
  // Environment banner: identical resolution and summary, but a test run does
  // not print it (this entry point is imported by the API tests).
  if (process.env.NEXORA_TEST_RUN !== '1') {
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

app.get(
  "/api/health",
  withRequestTimeout(API_REQUEST_TIMEOUT_MS),
  asyncRoute(createHealthHandler({
    db,
    isMock: bookingHandlerIsMock,
    hasAdminClient: !!admin,
    supabaseConfig,
    entrypoint: 'serverless (api/index.ts)',
  }))
);

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

// ============================================================================
// BOOKINGS + NOTIFICATIONS (read/update) — shared with server.ts via
// server/bookingRoutes.ts so the two entrypoints can never drift again.
// Owner-scoped, time-boxed, and honest about database failures.
// ============================================================================
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
// MY BOOKINGS — customer-scoped, mirrored from server.ts. Registered before
// "/api/bookings/:id" so Express does not read "mine" as a booking id.
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
// ============================================================================
// CUSTOMER APP — /api/customer/* (Nexora SalonOS Customer App)
// ---------------------------------------------------------------------------
// Same shared handlers as the Express server (server/customerRoutes.ts): the
// existing RLS is owner-scoped, so customer scoping is applied here, with the
// identity taken only from the verified bearer token.
// ============================================================================
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


// ============================================================================
// BOOKING CREATE — POST /api/bookings/create
// ---------------------------------------------------------------------------
// Shared with the dev/prod Express server (server/bookingCreate.ts): payload
// validation, NOT NULL owner_id resolution, Razorpay signature re-check,
// explicit stdout logging and precise 4xx errors instead of an opaque 500.
// ============================================================================
app.post(
  "/api/bookings/create",
  // Answer with JSON *before* the hosting platform kills a stuck invocation and
  // replies with its own un-parseable HTML error page.
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

// ============================================================================
// PAYMENTS — Razorpay (advance token checkout)
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are read from the environment. With no
// credentials outside a production runtime the MOCK gateway takes over
// (simulated payments, same order → verify → booking pipeline); /mock-pay
// answers 404 in every other mode.
// ============================================================================
app.get("/api/payments/razorpay/config", asyncRoute(handleRazorpayConfig));
app.post("/api/payments/razorpay/order", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(customerPaymentOrderHandler(db, bookingHandlerIsMock)));
app.post("/api/payments/razorpay/verify", asyncRoute(handleVerifyRazorpayPayment));
app.post("/api/payments/razorpay/mock-pay", asyncRoute(handleMockRazorpayPayment));

// Server-to-server callback from Razorpay, signed with RAZORPAY_WEBHOOK_SECRET.
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

app.post("/api/generate-bio", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    // Phase 12 hardened: validated input + proper error codes.
    const { businessName, businessType, ownerName, vibe, specialties, targetCustomers = 'Luxury', storyTone = 'Professional' } = req.body || {};
    if (typeof businessName !== 'string' || businessName.trim().length < 2) {
      throw new ApiValidationError('businessName is required (min 2 characters).', { field: 'businessName' });
    }
    if (typeof businessType !== 'string' || businessType.trim().length < 2) {
      throw new ApiValidationError('businessType is required.', { field: 'businessType' });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ApiUnavailableError('AI generation is not configured on this server. Set GEMINI_API_KEY.', 'ai_unavailable');
    }
    let parsed: any;
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const prompt = `Write a high-converting tagline (max 10 words) and a compelling salon story/about bio of 100-150 words for a beauty business with the following details:
Salon Name: ${businessName}
Category: ${businessType}
Founder: ${ownerName || ''}
Atmosphere/Vibe: ${vibe || ''}
Target customers: ${targetCustomers}
Story tone: ${storyTone}
Specialties: ${specialties || ''}

Return strictly valid JSON in this format:
{"taglines": ["...","...","...","...","..."], "tagline": "...", "bio": "..."}`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      if (!response.text) throw new ApiServerError('AI provider returned an empty response.');
      parsed = JSON.parse(response.text);
    } catch (err) {
      if (err instanceof Error && typeof (err as any).status === 'number' && (err as any).status >= 400 && (err as any).status < 600) throw err;
      throw new ApiServerError('Failed to generate bio with AI. Please try again.', err);
    }
    return res.status(200).json(parsed);
  }));
app.post("/api/generate-promo-image", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    // Phase 12 hardened: no 200-with-error, validates aspectRatio.
    const { prompt, serviceName, category, style, aspectRatio = "1:1" } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;
    const detailedPrompt = prompt || `A professional, ultra-high quality, editorial advertising photo for a luxury salon promoting "${serviceName}" in the "${category || 'Beauty & Wellness'}" category. Aesthetic: ${style || 'Luxury Chic & Modern Elegance'}, warm studio lighting, pristine clean background, 8k resolution commercial photoshoot.`;
    if (!apiKey) {
      throw new ApiUnavailableError('Image generation is not configured on this server. Set GEMINI_API_KEY.', 'ai_unavailable');
    }
    const validAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    if (!validAspectRatios.includes(aspectRatio)) {
      throw new ApiValidationError('aspectRatio must be one of ' + validAspectRatios.join(', '), { field: 'aspectRatio' });
    }
    let generatedImageUrl: string | null = null;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'imagen-3.0-generate-001',
        contents: { parts: [{ text: detailedPrompt }] },
        config: { imageConfig: { aspectRatio } },
      });
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            generatedImageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            break;
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && typeof (err as any).status === 'number' && (err as any).status >= 400 && (err as any).status < 600) throw err;
      throw new ApiServerError('Failed to generate promotional image. Please try again.', err);
    }
    if (generatedImageUrl) {
      return res.status(200).json({ success: true, imageUrl: generatedImageUrl, promptUsed: detailedPrompt });
    }
    throw new ApiInvalidStateError('Image generation did not produce an image. Please try again.');
  }));
app.post("/api/generate-promo-copy", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    // Phase 12 hardened: validated input, no 200-with-fallback.
    const { businessName, serviceName, price, offer, city, discountPercent } = req.body || {};
    if (typeof businessName !== 'string' || businessName.trim().length < 2) {
      throw new ApiValidationError('businessName is required.', { field: 'businessName' });
    }
    if (typeof serviceName !== 'string' || serviceName.trim().length < 2) {
      throw new ApiValidationError('serviceName is required.', { field: 'serviceName' });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ApiUnavailableError('AI copy generation is not configured on this server. Set GEMINI_API_KEY.', 'ai_unavailable');
    }
    let parsed: any;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an elite beauty salon copywriter. Create promotional copy for:
Salon: ${businessName}
Service: ${serviceName}
Price: ₹${price ?? 'TBD'}
Offer: ${offer || `${discountPercent || 20}% OFF`}
City: ${city || 'India'}

Return strictly JSON with keys: whatsapp, instagramCaption, headline, badgeText.`;
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      if (!response.text) throw new ApiServerError('AI provider returned an empty response.');
      parsed = JSON.parse(response.text);
    } catch (err) {
      if (err instanceof Error && typeof (err as any).status === 'number' && (err as any).status >= 400 && (err as any).status < 600) throw err;
      throw new ApiServerError('Failed to generate promotional copy. Please try again.', err);
    }
    return res.status(200).json(parsed);
  }));
app.post("/api/youtube/fetch-videos", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(async (req, res) => {
    // Phase 12 hardened: 400 for bad input, 503 when API key missing, 500 on fetch/parse errors.
    const { channelUrl, maxResults = 10 } = req.body || {};
    if (typeof maxResults !== 'number' || maxResults < 1 || maxResults > 50) {
      throw new ApiValidationError('maxResults must be an integer between 1 and 50.', { field: 'maxResults' });
    }
    const apiKey = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '';
    if (!apiKey || apiKey === 'YOUR_YOUTUBE_DATA_API_KEY') {
      throw new ApiUnavailableError('YouTube Data API key is not configured. Set YOUTUBE_API_KEY.', 'youtube_unavailable');
    }
    let query = '';
    if (channelUrl && typeof channelUrl === 'string') {
      const matchHandle = channelUrl.match(/youtube\.com\/@([\w_-]+)/);
      const matchChannelId = channelUrl.match(/youtube\.com\/channel\/([\w_-]+)/);
      if (matchHandle) query = matchHandle[1];
      else if (matchChannelId) query = matchChannelId[1];
      else if (channelUrl.includes('@')) query = channelUrl.split('@').pop()?.split('/')[0] || '';
    }
    if (!query) {
      throw new ApiValidationError('Could not extract a channel handle or id from channelUrl.', { field: 'channelUrl' });
    }
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelType=any&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${apiKey}`;
    let videos: any[] = [];
    try {
      const response = await fetch(searchUrl);
      if (!response.ok) throw new ApiServerError(`YouTube API responded with HTTP ${response.status}.`);
      const data = await response.json();
      if (data.error) throw new ApiServerError(`YouTube API error: ${data.error?.message || 'unknown'}`);
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
          transformationTag: 'Auto-Fetched Reel',
        }));
      }
    } catch (err) {
      if (err instanceof Error && typeof (err as any).status === 'number' && (err as any).status >= 400 && (err as any).status < 600) throw err;
      throw new ApiServerError('Failed to fetch videos from YouTube. Please try again.', err);
    }
    return res.status(200).json({
      success: true,
      videos,
      notice: videos.length ? `Fetched ${videos.length} videos from YouTube.` : 'No videos found for this channel.',
    });
  }));
app.post("/api/fetch-youtube-meta", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleFetchYouTubeMetadata));

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
app.get("/api/salon/state", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleGetSalonState({ mockSalons })));
app.post("/api/salon/save", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleWebsiteSave({ mockSalons })));
app.post("/api/website/save", withRequestTimeout(API_REQUEST_TIMEOUT_MS), asyncRoute(handleWebsiteSave({ mockSalons })));

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

export default app;
