// Edge Function: notifications
//   GET  /notifications?email=...  -> list (owner/caller scoped)
//   POST /notifications {action:"read", email} -> mark all as read
import { handleOptions, ok, fail } from "../_shared/cors.ts";
import { callerClient, adminClient } from "../_shared/supabase.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return handleOptions(req);

  const url = new URL(req.url);
  const email = url.searchParams.get("email");

  if (req.method === "GET") {
    if (!email) return fail("email query param is required", 400);
    const client = callerClient(req);
    const { data, error } = await client
      .from("in_app_notifications")
      .select("*")
      .eq("user_email", email)
      .order("created_at", { ascending: false });
    if (error) return fail(error.message, 400);
    return ok(data);
  }

  if (req.method === "POST") {
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      /* no body */
    }
    const target = payload.email || email;
    if (!target) return fail("email is required", 400);

    const db = adminClient();
    const { error } = await db
      .from("in_app_notifications")
      .update({ is_read: true })
      .eq("user_email", target)
      .eq("is_read", false);
    if (error) return fail(error.message, 400);
    return ok(true);
  }

  return fail("Method not allowed", 405);
}

Deno.serve(handler);
