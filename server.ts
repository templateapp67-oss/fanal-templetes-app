import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase, getSupabaseAdmin } from "./src/lib/supabaseClient";
import { resolveTenantFromHost, isTenantHost, BASE_DOMAIN } from "./src/lib/tenant";
import { SalonProfile, SalonService, Stylist } from "./src/types";

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

// Seed the in-memory demo salon(s) so the public subdomain experience works in
// mock/preview mode (no Supabase). We keep the demo data inline rather than
// importing mockData (which pulls in Vite-only .jpg imports that break tsx).
if (isMockSupabase) {
  const demoSubdomain = 'mirakistudio';
  mockSalons[demoSubdomain] = {
    profile: {
      ownerId: null,
      businessType: 'hair_salon',
      businessName: 'Miraki Hair Cut & Styling Studio',
      ownerName: 'Ananya Sharma',
      ownerRole: 'Founder & Lead Stylist',
      phone: '+91 98450 12345',
      whatsapp: '+91 98450 12345',
      email: 'hello@mirakistudio.co',
      tagline: 'Redefining luxury salon care',
      about:
        'Welcome to Miraki Hair Cut & Styling Studio, founded by Ananya Sharma. ' +
        'We are a modern sanctuary dedicated to exceptional salon services. ' +
        'Blending a luxury aesthetic with high-performance organic products, our mission ' +
        'is to make every client feel renewed and confident.',
      ownerPhotoUrl: '',
      coverImageUrl: '',
      themePreset: 'slate_silver',
      currency: '₹',
      subdomain: demoSubdomain,
      address: 'Shop No. 12, Crystal Plaza, MG Road',
      city: 'Bengaluru',
      postalCode: '560001',
      state: 'Karnataka',
      instagramHandle: 'mirakistudio',
      requireDeposit: false,
      depositPercentage: 20,
      themeAccentKey: 'slate',
      whiteLabelEnabled: true,
    } as SalonProfile,
    services: [
      { id: 'demo-hs-1', name: 'Master Stylist Precision Cut & Blowdry', category: 'Hair', description: 'Signature cut by our senior stylists.', icon: 'scissors', price: 750, durationMinutes: 60, popular: true, showDuration: true },
      { id: 'demo-hs-2', name: 'Classic Layered Cut & Argan Wash', category: 'Hair', description: 'Relaxing cut and cleanse.', icon: 'scissors', price: 450, durationMinutes: 45, popular: false, showDuration: true },
      { id: 'demo-hs-3', name: 'Formaldehyde-Free Keratin Smoothing', category: 'Treatments', description: 'Frizz-free, long-lasting smoothness.', icon: 'sparkles', price: 4200, durationMinutes: 120, popular: true, showDuration: true },
      { id: 'demo-hs-4', name: 'Hair Botox Deep Fiber Reconstruction', category: 'Treatments', description: 'Repairs and rebuilds hair fibers.', icon: 'sparkles', price: 3600, durationMinutes: 90, popular: false, showDuration: true },
    ] as SalonService[],
    stylists: [
      { id: 'demo-hs-st-1', name: 'Ananya Sharma', role: 'Senior Stylist', avatarUrl: '', bio: 'Senior stylist with 10+ years experience.', phone: '+91 98450 12345', specialties: ['Cuts', 'Keratin'], assignedServices: [], rating: 4.9, commissionRate: 30, status: 'Available', accessRole: 'Manager (Full Access)', hidePhone: false, schedule: [] },
      { id: 'demo-hs-st-2', name: 'Rohan Kapoor', role: 'Barber & Stylist', avatarUrl: '', bio: 'Men\'s grooming specialist.', phone: '+91 98450 12345', specialties: ['Men grooming', 'Cuts'], assignedServices: [], rating: 4.8, commissionRate: 25, status: 'Available', accessRole: 'Service Provider (Assigned)', hidePhone: false, schedule: [] },
    ] as Stylist[],
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Global Error Handler for better debugging
  app.use((err: any, _req: any, res: any, next: any) => {
    if (res.headersSent) {
      return next(err);
    }
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error', details: err.message });
  });

  // API Routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "Nexora Salon OS", mode: isMockSupabase ? 'mock' : 'live' });
  });

  // -------------------------------------------------------------------------
  // MULTI-TENANT PUBLIC SITE RESOLUTION
  // -------------------------------------------------------------------------
  // Map a snake_case Supabase profiles row to the app's SalonProfile shape.
  function mapProfileRow(row: any): SalonProfile {
    return {
      ownerId: row.id,
      businessType: (row.business_type as SalonProfile['businessType']) || 'hair_salon',
      businessName: row.salon_name || '',
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
      state: row.state || undefined,
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
      instagramHandle: row.instagram_handle || '',
      facebookPage: row.facebook_page || undefined,
      youtubeChannel: row.youtube_channel || undefined,
      tiktokProfile: row.tiktok_profile || undefined,
      googleBusinessUrl: row.google_business_url || undefined,
      requireDeposit: row.require_deposit ?? false,
      depositPercentage: row.deposit_percentage ?? 20,
      themeAccentKey: row.theme_accent_key || undefined,
      customAccentColor: row.custom_accent_color || undefined,
      landmark: row.landmark || undefined,
      foundingYear: row.founding_year || undefined,
      whiteLabelEnabled: row.white_label_enabled ?? false,
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
        const salon = mockSalons[registryKey];
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
        console.warn('Tenant lookup error:', error);
        return { host, tenant, salon: null };
      }
      if (!profileRow) return { host, tenant, salon: null };

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
      console.warn('Failed to resolve tenant salon:', err);
      return { host, tenant, salon: null };
    }
  }

  // Public JSON endpoint the SPA calls to hydrate the tenant's live site.
  app.get("/api/site", async (req, res) => {
    const { host, tenant, salon } = await resolveSalonFromHost(req);
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
    const sub = req.params.subdomain;
    if (isMockSupabase) {
      const salon = mockSalons[sub];
      return res.json({ found: !!salon, isTenant: true, tenant: { subdomain: sub, customDomain: null }, salon });
    }
    const { data: profileRow } = await db
      .from('profiles')
      .select('*')
      .eq('subdomain', sub)
      .maybeSingle();
    if (!profileRow) return res.json({ found: false, isTenant: true, salon: null });
    const ownerId = profileRow.id;
    const [{ data: serviceRows }, { data: stylistRows }] = await Promise.all([
      db.from('services').select('*').eq('owner_id', ownerId).order('sort_order'),
      db.from('stylists').select('*').eq('owner_id', ownerId).order('sort_order'),
    ]);
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
        // Attribute the booking to the salon owner. The public booking form
        // sends owner_id via the profile; if absent we fall back to a default.
        const bookingRow = {
          ...booking,
          owner_id: (req.body.owner_id || booking?.owner_id || process.env.DEFAULT_OWNER_ID || null),
        };

        // Insert Booking
        const { data: dbData, error: bookingError } = await db
          .from('bookings')
          .insert([bookingRow])
          .select()
          .single();
          
        if (bookingError) {
          
          doMock();
        } else {
          bookingData = dbData;
          
          // Insert Notifications if any
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
        // Fallback response if key is missing
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
      // Fallback
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

  // The SPA hydrates the tenant (public salon site) by calling `GET /api/site`,
  // which resolves the salon from the request Host header. We keep the serving
  // path simple: Vite middleware in dev, static SPA in prod. No HTML rewriting
  // is needed because the browser already knows its own hostname.
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
