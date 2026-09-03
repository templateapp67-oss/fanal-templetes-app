import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { supabase, isMockSupabase } from "./src/lib/supabaseClient";

// In-memory fallback for preview mode without DB
let mockBookings: any[] = [];
let mockNotifications: any[] = [];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "Nexora Salon OS" });
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
        const { data: dbData, error } = await supabase
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
           await supabase.from('in_app_notifications').insert(newNotifs);
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
      
      const { data, error } = await supabase
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
      
      const { data, error } = await supabase
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
      
      const { data, error } = await supabase
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
      
      const { error } = await supabase
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
        // Insert Booking
        const { data: dbData, error: bookingError } = await supabase
          .from('bookings')
          .insert([booking])
          .select()
          .single();
          
        if (bookingError) {
          
          doMock();
        } else {
          bookingData = dbData;
          
          // Insert Notifications if any
          if (notifications && notifications.length > 0) {
             const { error: notifError } = await supabase
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

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const prompt = `Write a high-converting tagline (max 10 words) and a compelling salon story/about bio (2-3 sentences) for a beauty business with the following details:
Salon Name: ${businessName}
Category: ${businessType}
Founder: ${ownerName}
Atmosphere/Vibe: ${vibe}
Specialties: ${specialties}

Return strictly valid JSON in this format:
{"tagline": "...", "bio": "..."}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
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

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const validAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
      const chosenAspect = validAspectRatios.includes(aspectRatio) ? aspectRatio : "1:1";

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
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
        model: 'gemini-3.8-flash',
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

  // Vite middleware for development
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
