// Edge Function: generate-promo-image
// POST { prompt, serviceName, category, style, aspectRatio }
// Returns { success, imageUrl, promptUsed } via Imagen (Gemini).
import { GoogleGenAI } from "https://esm.sh/@google/genai@2.4.0";
import { handleOptions, ok, fail } from "../_shared/cors.ts";

const VALID_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];

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
  const detailedPrompt =
    body.prompt ||
    `A professional, ultra-high quality, editorial advertising photo for a luxury salon promoting "${
      body.serviceName
    }" in the "${
      body.category || "Beauty & Wellness"
    }" category. Aesthetic: ${
      body.style || "Luxury Chic & Modern Elegance"
    }, warm studio lighting, pristine clean background, 8k resolution commercial photoshoot.`;

  if (!apiKey) {
    return ok({
      success: false,
      fallbackNotice: "No GEMINI_API_KEY configured. Using high-resolution curated asset.",
      imageUrl: null,
      promptUsed: detailedPrompt,
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const aspectRatio = VALID_RATIOS.includes(body.aspectRatio) ? body.aspectRatio : "1:1";

    const response = await ai.models.generateContent({
      model: "imagen-3.0-generate-001",
      contents: { parts: [{ text: detailedPrompt }] },
      config: { imageConfig: { aspectRatio } },
    });

    let generatedImageUrl: string | null = null;
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          generatedImageUrl = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (generatedImageUrl) {
      return ok({ success: true, imageUrl: generatedImageUrl, promptUsed: detailedPrompt });
    }
    return ok({
      success: false,
      imageUrl: null,
      promptUsed: detailedPrompt,
      notice: "Image generation model returned without an inline image part; using curated backup.",
    });
  } catch (err: any) {
    console.warn("generate-promo-image error:", err?.message || err);
    return ok({
      success: false,
      imageUrl: null,
      error: err?.message || "Failed to generate promotional image with AI.",
    });
  }
}

Deno.serve(handler);
