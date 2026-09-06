import express from "express";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase, getSupabaseAdmin } from "../src/lib/supabaseClient";
import { resolveTenantFromHost, BASE_DOMAIN } from "../src/lib/tenant";
import { SalonProfile, SalonService, Stylist } from "../src/types";

const app = express();
app.use(express.json());

// In-memory fallback
let mockBookings: any[] = [];
let mockNotifications: any[] = [];
const mockSalons: Record<string, any> = {};

const admin = getSupabaseAdmin();
const db = admin ?? supabase;

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

function mapProfileRow(row: any): SalonProfile {
  return {
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
    requireDeposit: row.require_deposit ?? true,
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
      const salon = mockSalons[registryKey] || (registryKey.includes('uma') ? artsByUmaSalon : null);
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

    if (error || !profileRow) {
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
    console.warn('Failed to resolve tenant salon:', err);
    return { host, tenant, salon: null };
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Nexora Salon OS", mode: isMockSupabase ? 'mock' : 'live' });
});

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

app.get("/api/site/:subdomain", async (req, res) => {
  const sub = req.params.subdomain;
  if (isMockSupabase) {
    const salon = mockSalons[sub] || (sub.includes('uma') ? artsByUmaSalon : artsByUmaSalon);
    return res.json({ found: !!salon, isTenant: true, tenant: { subdomain: sub, customDomain: null }, salon });
  }
  const { data: profileRow } = await db
    .from('profiles')
    .select('*')
    .eq('subdomain', sub)
    .maybeSingle();
  if (!profileRow) {
    if (sub === 'arts-by-uma' || sub === 'artsbyuma' || sub.includes('uma')) {
      return res.json({ found: true, isTenant: true, tenant: { subdomain: sub, customDomain: null }, salon: artsByUmaSalon, baseDomain: BASE_DOMAIN });
    }
    return res.json({ found: false, isTenant: true, salon: null });
  }
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

    let notificationMsg = '';
    let notificationTitle = '';

    if (status === 'reschedule_proposed') {
       notificationTitle = 'Reschedule Proposed';
       notificationMsg = `The salon proposed a new time: ${proposed_date} at ${proposed_time_slot}.`;
    } else if (status === 'confirmed') {
       notificationTitle = 'Booking Confirmed';
       notificationMsg = `Your booking on ${data?.booking_date || ''} at ${data?.time_slot || ''} is now confirmed.`;
    } else if (status === 'cancelled') {
       notificationTitle = 'Booking Cancelled';
       notificationMsg = `Your booking was cancelled.`;
    }

    if (notificationMsg && data) {
       const newNotifs = [{
         user_email: data.customer_email,
         title: notificationTitle,
         message: notificationMsg,
       }, {
         user_email: 'owner@salon.com',
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

      const { data: dbData, error: bookingError } = await db.from('bookings').insert([bookingRow]).select().single();
      if (bookingError) {
        doMock();
      } else {
        bookingData = dbData;
        if (notifications && notifications.length > 0) {
          await db.from('in_app_notifications').insert(notifications);
        }
      }
    }
    res.json({ success: true, data: bookingData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

app.post("/api/fetch-youtube-meta", async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl || typeof youtubeUrl !== 'string') {
      return res.status(400).json({ success: false, notice: 'youtubeUrl is required.' });
    }

    // 1. Extract Video ID
    let videoId: string | null = null;
    const url = youtubeUrl.trim();

    // Standard watch URL: https://www.youtube.com/watch?v=VIDEO_ID
    const watchMatch = url.match(/(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/)([\w_-]{11})/);
    // Shorts URL: https://www.youtube.com/shorts/VIDEO_ID
    const shortsMatch = url.match(/youtube\.com\/shorts\/([\w_-]{11})/);
    // Short URL: https://youtu.be/VIDEO_ID
    const shortUrlMatch = url.match(/youtu\.be\/([\w_-]{11})/);

    if (watchMatch) videoId = watchMatch[1];
    else if (shortsMatch) videoId = shortsMatch[1];
    else if (shortUrlMatch) videoId = shortUrlMatch[1];

    if (!videoId) {
      return res.status(400).json({ success: false, notice: 'Could not extract YouTube video ID from URL. Supported formats: youtube.com/watch?v=..., youtube.com/shorts/..., youtu.be/...' });
    }

    const apiKey = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '';

    // 2. Metadata Fetching via YouTube Data API v3
    if (apiKey && apiKey !== 'YOUR_YOUTUBE_DATA_API_KEY') {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,statistics&key=${apiKey}`;
      try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          const snippet = item.snippet || {};
          const statistics = item.statistics || {};
          const thumbnails = snippet.thumbnails || {};

          return res.json({
            success: true,
            videoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
            title: snippet.title || '',
            description: snippet.description || '',
            thumbnailUrl: thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.default?.url || '',
            likeCount: Number(statistics.likeCount || 0),
            commentCount: Number(statistics.commentCount || 0),
            source: 'youtube_data_api'
          });
        }
      } catch (err: any) {
        console.warn('YouTube Data API error:', err?.message || err);
      }
    }

    // 3. Fallback Fetcher (No API Key Required)
    // oEmbed for title and description
    let title = '';
    let description = '';
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const oembedResponse = await fetch(oembedUrl);
      const oembedData = await oembedResponse.json();
      if (oembedData && oembedData.title) {
        title = oembedData.title || '';
        description = oembedData.author_name ? `By ${oembedData.author_name}` : '';
      }
    } catch (err: any) {
      console.warn('oEmbed fallback error:', err?.message || err);
    }

    // Standard thumbnail URL fallback
    const fallbackThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    return res.json({
      success: true,
      videoId,
      youtubeUrl: url,
      title: title || 'Unknown Title',
      description: description || '',
      thumbnailUrl: fallbackThumbnail,
      likeCount: 0,
      commentCount: 0,
      source: 'oembed_fallback',
      notice: apiKey ? (title ? '' : 'YouTube Data API returned no results; using oEmbed fallback.') : 'No YOUTUBE_API_KEY configured; using oEmbed fallback.'
    });
  } catch (err: any) {
    console.warn('Fetch YouTube meta endpoint error:', err?.message || err);
    return res.status(500).json({ success: false, notice: 'Failed to fetch YouTube metadata.', error: err?.message || 'Unknown error' });
  }
});

export default app;
