// Edge Function: bookings
// Handles the booking lifecycle for Nexora Salon OS.
//   GET  /bookings                     -> list (owner) or public list
//   GET  /bookings?id=<uuid>           -> single booking (customer portal)
//   POST /bookings                     -> create (authenticated customer, service-role insert)
//   POST /bookings  {action:"update"}  -> update status / reschedule proposal
import {
  handleOptions,
  ok,
  fail,
} from "../_shared/cors.ts";
import { callerClient, adminClient } from "../_shared/supabase.ts";

const OWNER_EMAIL_FALLBACK = "owner@salon.com";

async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return handleOptions(req);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/bookings\/?/, "");
    const id = url.searchParams.get("id") || (path && path !== "" ? path : null);

    // ---- CREATE / UPDATE (authenticated caller only) ---------------------
    // This function is a separately deployable serverless surface. Keep the
    // same no-guest rule as api/index.ts: verify the Supabase bearer token before
    // any service-role write (and before a claimed payment can be acted on).
    if (req.method === "POST") {
      const authorization = req.headers.get("Authorization") || "";
      if (!/^Bearer\s+\S+/i.test(authorization)) {
        return fail("Please sign in or create an account before booking an appointment.", 401);
      }
      if (!runtimeConfigAvailable()) {
        return fail("The booking service is not configured on this server.", 503);
      }

      const authenticated = await requireAuthenticatedCaller(req);
      if (authenticated instanceof Response) return authenticated;

      let payload: any = {};
      try {
        payload = await req.json();
      } catch {
        return fail("Malformed JSON request body.", 400);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return fail("A JSON object is required.", 400);
      }

      // Update route
      if (payload.action === "update" || (payload.id && payload.status)) {
        return handleUpdate(payload);
      }
      return handleCreate(payload, authenticated);
    }

    // ---- READ --------------------------------------------------------------
    if (req.method === "GET") {
      if (!runtimeConfigAvailable()) {
        return fail("The booking service is not configured on this server.", 503);
      }
      if (id && !isUuid(id)) {
        return fail("The booking ID must be a valid UUID.", 400);
      }

      const ownerId = url.searchParams.get("owner_id");
      if (ownerId && !isUuid(ownerId)) {
        return fail("The owner ID must be a valid UUID.", 400);
      }

      const client = callerClient(req);
      if (id) {
        const { data, error } = await runEdgeDb(() => client
          .from("bookings")
          .select("*")
          .eq("id", id)
          .single());
        if (error) {
          if (error.code === "PGRST116") return fail("Booking not found.", 404);
          console.error("[Bookings] Booking lookup failed:", error);
          return fail("The booking service is temporarily unavailable. Please try again.", 503);
        }
        return ok(data);
      }

      const { data, error } = await runEdgeDb(() => {
        let query = client.from("bookings").select("*");
        if (ownerId) query = query.eq("owner_id", ownerId);
        return query.order("created_at", { ascending: false });
      });
      if (error) {
        console.error("[Bookings] Booking list failed:", error);
        return fail("The booking service is temporarily unavailable. Please try again.", 503);
      }
      return ok(data);
    }

    return fail("Method not allowed", 405);
  } catch (error) {
    console.error("[Bookings] Unhandled Edge Function error:", error);
    return fail("The booking service is temporarily unavailable. Please try again.", 503);
  }
}

interface AuthenticatedCaller {
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function rawMetadata(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  try {
    const serialized = JSON.stringify(value);
    return (typeof serialized === "string" ? serialized : String(value)).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function uuidOrNull(value: unknown, metadata: Record<string, string>, key: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (isUuid(value)) return value;
  metadata[key] = rawMetadata(value);
  return null;
}

function normalizedAmount(value: unknown, maximum = Number.POSITIVE_INFINITY): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Number(Math.min(amount, maximum).toFixed(2));
}

async function verifyRazorpayPayment(payment: Record<string, any>): Promise<boolean> {
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET") || Deno.env.get("RAZORPAY_SECRET") || "";
  if (!secret) return false;
  const orderId = String(payment.razorpay_order_id || "");
  const paymentId = String(payment.razorpay_payment_id || "");
  const signature = String(payment.razorpay_signature || "").toLowerCase();
  if (!orderId || !paymentId || !/^[0-9a-f]{64}$/.test(signature)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${orderId}|${paymentId}`));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

interface OwnerResolution {
  id: string | null;
  unavailable?: boolean;
}

async function resolveOwnerId(body: Record<string, any>, booking: Record<string, any>, metadata: Record<string, string>, db: any): Promise<OwnerResolution> {
  const explicit = body.owner_id ?? booking.owner_id;
  if (isUuid(explicit)) return { id: explicit };
  if (explicit !== null && explicit !== undefined && explicit !== "") {
    metadata.owner_id = rawMetadata(explicit);
  }

  const configuredOwner = Deno.env.get("DEFAULT_OWNER_ID") || Deno.env.get("SUPABASE_DEMO_OWNER_ID") || "";
  const configuredUuid = isUuid(configuredOwner) ? configuredOwner : null;
  const subdomain = typeof (body.subdomain ?? booking.subdomain) === "string"
    ? String(body.subdomain ?? booking.subdomain).trim().toLowerCase()
    : "";
  const ownerEmail = typeof body.owner_email === "string"
    ? body.owner_email.trim()
    : Array.isArray(body.notifications) && typeof body.notifications[0]?.user_email === "string"
      ? body.notifications[0].user_email.trim()
      : "";
  const customDomain = typeof (body.custom_domain ?? booking.custom_domain) === "string"
    ? String(body.custom_domain ?? booking.custom_domain).trim().toLowerCase()
    : "";

  for (const [column, value] of [["subdomain", subdomain], ["custom_domain", customDomain]] as const) {
    if (!value) continue;
    const { data, error } = await runEdgeDb(() => db.from("profiles").select("id").eq(column, value).maybeSingle());
    if (error) {
      console.error(`[Bookings] Edge owner lookup by ${column} failed:`, error);
      return { id: null, unavailable: true };
    }
    if (isUuid(data?.id)) return { id: data.id };
  }

  if (ownerEmail) {
    const { data, error } = await runEdgeDb(() => db.from("profiles").select("id").eq("email", ownerEmail).maybeSingle());
    if (error) {
      console.error("[Bookings] Edge owner lookup by email failed:", error);
      return { id: null, unavailable: true };
    }
    if (isUuid(data?.id)) return { id: data.id };
  }

  if (configuredUuid) return { id: configuredUuid };

  const { data, error } = await runEdgeDb(() => db.from("profiles").select("id").limit(2));
  if (error) {
    console.error("[Bookings] Edge sole-owner lookup failed:", error);
    return { id: null, unavailable: true };
  }
  if (Array.isArray(data) && data.length === 1 && isUuid(data[0]?.id)) return { id: data[0].id };
  return { id: null };
}

const EDGE_DB_TIMEOUT_MS = 5500;
const EDGE_AUTH_TIMEOUT_MS = 4000;

function runtimeConfigAvailable(): boolean {
  return Boolean(
    Deno.env.get("SUPABASE_URL") &&
    Deno.env.get("SUPABASE_ANON_KEY") &&
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

function isRetryableEdgeError(error: any): boolean {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error || "").toLowerCase();
  return status >= 500 || /fetch failed|network|timeout|timed out|socket|unavailable|gateway/.test(message);
}

async function withEdgeTimeout<T>(work: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Edge service request timed out.")), timeoutMs) as unknown as number;
  });
  try {
    return await Promise.race([Promise.resolve(work), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runEdgeDb<T = any>(build: () => PromiseLike<{ data: T | null; error: any }>): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await withEdgeTimeout(build(), EDGE_DB_TIMEOUT_MS);
      if (!result?.error || !isRetryableEdgeError(result.error) || attempt === 1) {
        return { data: result?.data ?? null, error: result?.error ?? null };
      }
      lastError = result.error;
    } catch (error) {
      lastError = error;
      if (!isRetryableEdgeError(error) || attempt === 1) break;
    }
  }
  console.error("[Bookings] Edge database request failed:", lastError);
  return {
    data: null,
    error: { code: "db_unavailable", message: "The booking database is temporarily unavailable." },
  };
}

async function requireAuthenticatedCaller(req: Request): Promise<AuthenticatedCaller | Response> {
  const authorization = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return fail("Please sign in or create an account before booking an appointment.", 401);
  }
  if (!runtimeConfigAvailable()) {
    return fail("The sign-in service is temporarily unavailable. Please try again.", 503);
  }

  try {
    const { data, error } = await withEdgeTimeout(callerClient(req).auth.getUser(), EDGE_AUTH_TIMEOUT_MS);
    if (error) {
      const status = typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 0;
      const authMessage = String((error as { message?: unknown }).message || "");
      if (status === 400 || status === 401 || status === 403 || /invalid|expired|jwt/i.test(authMessage)) {
        return fail("Your session is invalid or has expired. Please sign in again before booking.", 401);
      }
      console.error("[Bookings] Supabase Auth returned an unavailable response:", error);
      return fail("The sign-in service is temporarily unavailable. Please try again.", 503);
    }
    if (!data.user || !isUuid(data.user.id)) {
      return fail("Your session is invalid or has expired. Please sign in again before booking.", 401);
    }
    return { id: data.user.id };
  } catch (error) {
    console.error("[Bookings] Supabase Auth verification failed:", error);
    return fail("The sign-in service is temporarily unavailable. Please try again.", 503);
  }
}

// Create a booking. Runs with the service role after caller authentication so
// the authenticated customer is never confused with the salon owner.
async function handleCreate(body: any, caller: AuthenticatedCaller): Promise<Response> {
  const booking = body?.booking && typeof body.booking === "object" ? body.booking : body;
  if (!booking || typeof booking !== "object" || !booking.customer_name) {
    return fail("customer_name is required", 400);
  }
  if (!runtimeConfigAvailable()) {
    return fail("The booking service is not configured on this server.", 503);
  }

  const db = adminClient();
  const metadata: Record<string, string> = {};
  const incomingMetadata = booking.metadata;
  if (incomingMetadata && typeof incomingMetadata === "object" && !Array.isArray(incomingMetadata)) {
    for (const [key, value] of Object.entries(incomingMetadata).slice(0, 32)) {
      if (/^[a-zA-Z0-9_.-]{1,80}$/.test(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)) {
        metadata[key] = rawMetadata(value);
      }
    }
  }

  // Multi-service bookings keep their full ordered treatment list as structured
  // `metadata.services` lines — the same shape the customer app writes — and the
  // parent `service_name` is rebuilt from those names so list/detail screens and
  // rebooking see every service, not just the primary one. Lines are capped and
  // re-normalized here; this is the one structured key metadata may carry.
  const normalizedLines: any[] = [];
  const rawLines = Array.isArray(booking.services) ? booking.services : [];
  for (const raw of rawLines.slice(0, 20)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const serviceId = String(raw.service_id ?? raw.serviceId ?? "").trim().slice(0, 80);
    const name = String(raw.name ?? raw.service_name ?? "").trim().slice(0, 160);
    if (!serviceId && !name) continue;
    const price = Number(raw.price ?? raw.unit_price ?? NaN);
    const minutes = Number(raw.duration_minutes ?? raw.durationMinutes ?? NaN);
    normalizedLines.push({
      service_id: serviceId,
      name,
      price: Number.isFinite(price) && price >= 0 ? Number(price.toFixed(2)) : 0,
      duration_minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
    });
  }
  if (normalizedLines.length > 0) {
    metadata.services = normalizedLines as any;
    const totalMinutes = normalizedLines.reduce((total, line) => total + line.duration_minutes, 0);
    if (totalMinutes > 0) metadata.duration_minutes = totalMinutes;
  }
  const derivedServiceName = normalizedLines.length > 0
    ? normalizedLines.map((line) => line.name).filter(Boolean).join(" + ").slice(0, 240)
    : "";

  // A verified customer token is necessary but not sufficient to trust a
  // browser payment claim. Re-check the Razorpay signature before owner lookup
  // or the booking insert, and reset unverified money fields to pending.
  const payment = body.payment && typeof body.payment === "object" ? body.payment : booking.payment;
  let verifiedPaymentId: string | null = null;
  if (payment && typeof payment === "object" && payment.razorpay_payment_id) {
    const razorpaySecretConfigured = Boolean(
      Deno.env.get("RAZORPAY_KEY_SECRET") || Deno.env.get("RAZORPAY_SECRET"),
    );
    if (razorpaySecretConfigured) {
      if (!(await verifyRazorpayPayment(payment))) {
        return fail("We could not verify your payment with Razorpay. The booking was not saved.", 400);
      }
      verifiedPaymentId = String(payment.razorpay_payment_id);
    }
  }
  const totalAmount = normalizedAmount(booking.total_amount);
  const claimedAdvance = normalizedAmount(booking.advance_paid_amount, totalAmount);

  const insertRow: any = {
    customer_name: booking.customer_name,
    customer_phone: booking.customer_phone || "",
    customer_email: booking.customer_email || "",
    service_id: uuidOrNull(booking.service_id ?? normalizedLines[0]?.service_id, metadata, "service_id"),
    user_id: uuidOrNull(caller.id, metadata, "user_id"),
    service_name: derivedServiceName || booking.service_name || "",
    booking_date: booking.booking_date || null,
    time_slot: booking.time_slot || "",
    total_amount: totalAmount,
    advance_paid_amount: verifiedPaymentId ? claimedAdvance : 0,
    status: booking.status || "pending",
    payment_status: verifiedPaymentId ? "paid_deposit" : "pending",
    payment_id: verifiedPaymentId || booking.payment_id || "",
    booking_type: booking.booking_type || "salon",
    home_address: booking.home_address || "",
    proposed_date: booking.proposed_date || null,
    proposed_time_slot: booking.proposed_time_slot || "",
    notes: booking.notes || "",
    metadata,
  };

  // The authenticated caller is the customer, not the salon owner. Resolve a
  // tenant owner independently and send only its UUID to the owner_id column.
  const owner = await resolveOwnerId(body, booking, metadata, db);
  if (!owner.id) {
    if (owner.unavailable) {
      return fail("The booking database is temporarily unavailable. Please try again shortly.", 503);
    }
    return fail("This salon is not linked to an owner account yet, so the booking cannot be stored.", 422);
  }
  insertRow.owner_id = owner.id;

  const { data, error } = await runEdgeDb(() => db.from("bookings").insert([insertRow]).select().single());
  if (error) {
    console.error("[Bookings] Booking insert failed:", error);
    return fail("The booking could not be saved. Please try again.", 503);
  }
  const created = data;
  if (!created || typeof created !== "object") {
    return fail("The booking was not returned by the database. Please try again.", 503);
  }

  // Also insert any notifications that ship with the request. A notification
  // failure must not turn a successful booking into an invocation crash.
  if (Array.isArray(body.notifications) && body.notifications.length) {
    const notifs = body.notifications.map((n: any) => ({
      owner_id: created.owner_id,
      user_email: n.user_email || created.customer_email || OWNER_EMAIL_FALLBACK,
      title: n.title || "New Booking",
      message: n.message || "",
    }));
    const { error: notificationError } = await runEdgeDb(() => db.from("in_app_notifications").insert(notifs));
    if (notificationError) console.error("[Bookings] Notification insert failed:", notificationError);
  }

  return ok(created);
}

// Update a booking status / reschedule proposal. Uses service role.
async function handleUpdate(body: any): Promise<Response> {
  const { id, status, proposed_date, proposed_time_slot } = body;
  if (!id) return fail("id is required", 400);
  if (!isUuid(id)) return fail("The booking ID must be a valid UUID.", 400);
  if (!(new Set(["pending", "confirmed", "cancelled", "completed", "reschedule_proposed"])).has(status)) {
    return fail("Unsupported booking status.", 400);
  }
  if (status === "reschedule_proposed" && (!proposed_date || !proposed_time_slot)) {
    return fail("A proposed date and time are required to propose a reschedule.", 400);
  }
  if (!runtimeConfigAvailable()) {
    return fail("The booking service is not configured on this server.", 503);
  }

  const updateData: any = { status };
  if (status === "reschedule_proposed") {
    updateData.proposed_date = proposed_date || null;
    updateData.proposed_time_slot = proposed_time_slot || "";
  }

  const db = adminClient();
  const { data, error } = await runEdgeDb(() => db
    .from("bookings")
    .update(updateData)
    .eq("id", id)
    .select()
    .single());
  if (error) {
    console.error("[Bookings] Booking update failed:", error);
    if (error.code === "PGRST116") return fail("Booking not found.", 404);
    return fail("The booking could not be updated. Please try again.", 503);
  }

  // Trigger notifications for the booking lifecycle.
  if (status === "reschedule_proposed") {
    await insertNotification(db, data, "Reschedule Proposed",
      `The salon proposed a new time: ${proposed_date} at ${proposed_time_slot}.`);
  } else if (status === "confirmed") {
    await insertNotification(db, data, "Booking Confirmed",
      `Your booking on ${data.booking_date} at ${data.time_slot} is now confirmed.`);
  } else if (status === "cancelled") {
    await insertNotification(db, data, "Booking Cancelled", "Your booking was cancelled.");
  }

  return ok(data);
}

async function insertNotification(db: any, booking: any, title: string, message: string) {
  const rows = [
    {
      owner_id: booking.owner_id,
      user_email: booking.customer_email || OWNER_EMAIL_FALLBACK,
      title,
      message,
    },
    {
      owner_id: booking.owner_id,
      user_email: OWNER_EMAIL_FALLBACK,
      title: `Booking ${title}`,
      message: `${booking.customer_name}'s booking was ${title}.`,
    },
  ];
  const { error } = await runEdgeDb(() => db.from("in_app_notifications").insert(rows));
  if (error) console.error("[Bookings] Edge notification insert failed:", error);
}

Deno.serve(handler);
