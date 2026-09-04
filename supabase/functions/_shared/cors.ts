// Shared CORS + response helpers for Supabase Edge Functions (Deno).

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-owner-id",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function ok(data: unknown): Response {
  return jsonResponse({ success: true, data });
}

export function fail(error: string, status = 500): Response {
  return jsonResponse({ success: false, error }, status);
}

export function handleOptions(_req: Request): Response {
  return new Response("ok", { headers: corsHeaders });
}
