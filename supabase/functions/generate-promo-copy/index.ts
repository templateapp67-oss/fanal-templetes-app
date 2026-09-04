// Edge Function: generate-promo-copy
// POST { businessName, serviceName, price, offer, city, discountPercent }
// Returns { whatsapp, instagramCaption, headline, badgeText } via Gemini.
import { GoogleGenAI } from "https://esm.sh/@google/genai@2.4.0";
import { handleOptions, ok, fail } from "../_shared/cors.ts";

const MODEL = "gemini-1.5-flash";

function fallback(body: any) {
  const service = body.serviceName || "our signature treatment";
  const business = body.businessName || "our salon";
  const price = body.price ? `₹${Number(body.price).toLocaleString("en-IN")}` : "Special Rate";
  return {
    whatsapp: `✨ *EXCLUSIVE SALON OFFER* ✨\n\nHey beautiful! Treat yourself to *${service}* at *${business}*.\n\n🎉 *Special Deal*: ${body.offer || "Exclusive Discount This Week"}\n💰 *Price*: ${price}\n\n📲 Book your appointment now!`,
    instagramCaption: `✨ Elevate your everyday glow! ✨\n\nBook your *${service}* today at ${business}.\n\n👇 Tap link in bio to book your appointment!\n\n#Salon #Beauty #SelfCare #SalonDeals`,
    headline: `Special Offer: ${service}`,
    badgeText: body.offer ? String(body.offer).toUpperCase() : "LIMITED SPECIAL",
  };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return fail("Method not allowed", 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return ok(fallback(body));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an elite beauty salon social media marketing copywriter. Create promotional copy for a salon service with these details:
Salon: ${body.businessName}
Service: ${body.serviceName}
Price: ₹${body.price}
Special Offer: ${body.offer || `${body.discountPercent || 20}% OFF`}
City: ${body.city || "India"}

Return strictly JSON with the following keys:
{
  "whatsapp": "A high-converting WhatsApp message with emojis, clear bullet points, price details, and a booking call-to-action.",
  "instagramCaption": "An engaging Instagram caption with hook, offer details, CTA ('Link in bio to book'), and 10 relevant hashtags.",
  "headline": "A short, punchy promotional banner headline (max 6 words)",
  "badgeText": "Short badge text for image corner (e.g. '20% OFF TODAY' or 'FESTIVE SPECIAL', max 4 words)"
}`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const text = response.text;
    if (text) return ok(JSON.parse(text));
    return ok(fallback(body));
  } catch (err: any) {
    console.warn("generate-promo-copy error:", err?.message || err);
    return ok(fallback(body));
  }
}

Deno.serve(handler);
