// Edge Function: bookings
// Handles the booking lifecycle for Nexora Salon OS.
//   GET  /bookings                     -> list (owner) or public list
//   GET  /bookings?id=<uuid>           -> single booking (customer portal)
//   POST /bookings                     -> create (guest booking, service-role insert)
//   POST /bookings  {action:"update"}  -> update status / reschedule proposal
import {
  handleOptions,
  jsonResponse,
  ok,
  fail,
} from "../_shared/cors.ts";
import { callerClient, adminClient } from "../_shared/supabase.ts";

const OWNER_EMAIL_FALLBACK = "owner@salon.com";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return handleOptions(req);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/bookings\/?/, "");
  const id = url.searchParams.get("id") || (path && path !== "" ? path : null);

  // ---- CREATE (guest booking via trusted service role) ----
  if (req.method === "POST") {
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      /* empty body */
    }

    // Update route
    if (payload.action === "update" || (payload.id && payload.status)) {
      return handleUpdate(payload);
    }
    return handleCreate(payload);
  }

  // ---- READ ----
  if (req.method === "GET") {
    const client = callerClient(req);
    if (id) {
      const { data, error } = await client
        .from("bookings")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return fail(error.message, 404);
      return ok(data);
    }

    const ownerId = url.searchParams.get("owner_id");
    let query = client.from("bookings").select("*");
    if (ownerId) query = query.eq("owner_id", ownerId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) return fail(error.message, 400);
    return ok(data);
  }

  return fail("Method not allowed", 405);
}

// Create a booking. Runs with the service role so public (guest) bookings
// bypass RLS. Anomaly: the booking must be attributed to an owner.
async function handleCreate(body: any): Promise<Response> {
  const booking = body.booking || body;
  if (!booking.customer_name) {
    return fail("customer_name is required", 400);
  }

  const db = adminClient();

  const insertRow: any = {
    customer_name: booking.customer_name,
    customer_phone: booking.customer_phone || "",
    customer_email: booking.customer_email || "",
    service_id: booking.service_id || null,
    service_name: booking.service_name || "",
    booking_date: booking.booking_date || null,
    time_slot: booking.time_slot || "",
    total_amount: booking.total_amount || 0,
    advance_paid_amount: booking.advance_paid_amount || 0,
    status: booking.status || "pending",
    payment_status: booking.payment_status || "pending",
    payment_id: booking.payment_id || "",
    booking_type: booking.booking_type || "salon",
    home_address: booking.home_address || "",
    proposed_date: booking.proposed_date || null,
    proposed_time_slot: booking.proposed_time_slot || "",
    notes: booking.notes || "",
  };

  // If caller is an authenticated owner, attribute the booking to them.
  if (body.owner_id) {
    insertRow.owner_id = body.owner_id;
  } else {
    // Owner not provided: try to resolve via a supplied owner email or fallback.
    insertRow.owner_id = body.owner_id || null;
  }

  const { data, error } = await db.from("bookings").insert([insertRow]).select().single();
  if (error) return fail(error.message, 400);
  const created = data;

  // Also insert any notifications that ship with the request.
  if (Array.isArray(body.notifications) && body.notifications.length) {
    const notifs = body.notifications.map((n: any) => ({
      owner_id: created.owner_id,
      user_email: n.user_email || created.customer_email || OWNER_EMAIL_FALLBACK,
      title: n.title || "New Booking",
      message: n.message || "",
    }));
    await db.from("in_app_notifications").insert(notifs);
  }

  return ok(created);
}

// Update a booking status / reschedule proposal. Uses service role.
async function handleUpdate(body: any): Promise<Response> {
  const { id, status, proposed_date, proposed_time_slot } = body;
  if (!id) return fail("id is required", 400);

  const updateData: any = { status };
  if (status === "reschedule_proposed") {
    updateData.proposed_date = proposed_date || null;
    updateData.proposed_time_slot = proposed_time_slot || "";
  }

  const db = adminClient();
  const { data, error } = await db
    .from("bookings")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) return fail(error.message, 400);

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
  await db.from("in_app_notifications").insert(rows);
}

Deno.serve(handler);
