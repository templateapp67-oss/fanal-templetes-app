// ============================================================================
// Owner appointment save → read → refresh → cancel, executed against a REAL
// Postgres engine (PGlite) loaded with the live normalized schema contract and
// the actual supabase/migrations/20260910200000_create_owner_booking.sql.
//
// This is the regression suite for the production blocker: POST
// /api/owner/appointments was rejected by the database because the
// create_owner_booking RPC did not exist (Postgres 42883 / PostgREST
// PGRST202). The first test reproduces that exact rejection before the
// migration is applied; the rest prove the full flow once it is.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerAppointment, readOwnerDashboard, ownerDashboardHandler } from '../server/ownerDashboard';
import { updateNormalizedBooking } from '../server/normalizedBookingAccess';
import { dashboardTotals } from '../src/lib/useOwnerDashboard';
import {
  liveSchemaDb, liveSchemaDbWithRpc, asUser,
  OWNER, OTHER_OWNER, SALON, SERVICE, STAFF,
} from './liveSchemaFixture';

const q = async (db: any, sql: string, params?: any[]) => (await db.query(sql, params)).rows as any[];

const OWNER_TOKEN = 'owner-session-token';
const OTHER_TOKEN = 'other-owner-session-token';
const tokens: Record<string, string> = { [OWNER_TOKEN]: OWNER, [OTHER_TOKEN]: OTHER_OWNER };

// --- a minimal supabase-js-compatible client over PGlite ---------------------
// Implements exactly the surface the owner dashboard paths use: auth.getUser,
// from(table).select/eq/in/order/range/maybeSingle/update and the
// create_owner_booking RPC (executed as the signed-in role with auth.uid()
// set, the way PostgREST executes it). Postgres errors are returned in the
// PostgREST error shape (missing function → PGRST202).
const RPC_PARAM_TYPES: Record<string, string> = {
  p_salon_id: 'uuid', p_service_ids: 'uuid[]', p_staff_id: 'uuid',
  p_appointment_start: 'timestamptz', p_customer_user_id: 'uuid',
  p_customer_name: 'text', p_customer_phone: 'text', p_customer_email: 'text',
  p_customer_note: 'text', p_is_walk_in: 'boolean', p_idempotency_key: 'text',
};

class Shim {
  private state: any = { select: '*', filters: [] as any[], orders: [] as any[], range: null as any, maybe: false, update: null as any };
  constructor(private db: any, private table: string) {}
  select(cols: string) { this.state.select = cols; return this; }
  eq(k: string, v: any) { this.state.filters.push({ k, v }); return this; }
  in(k: string, vs: any[]) { this.state.filters.push({ k, v: vs, op: 'in' }); return this; }
  is(k: string, v: any) { this.state.filters.push({ k, v, op: 'is' }); return this; }
  order(k: string, opts?: any) { this.state.orders.push({ k, dir: opts?.ascending === false ? 'desc' : 'asc' }); return this; }
  range(a: number, b: number) { this.state.range = [a, b]; return this; }
  limit(n: number) { this.state.range = [0, n - 1]; return this; }
  maybeSingle() { this.state.maybe = true; return this; }
  update(changes: any) { this.state.update = changes; return this; }
  then(onOk: any, onErr: any) { return this.exec().then(onOk, onErr); }
  private async exec(): Promise<{ data: any; error: any }> {
    try {
      const where: string[] = [];
      const params: any[] = [];
      for (const f of this.state.filters) {
        if (f.op === 'in') { params.push(f.v); where.push(`${f.k} = any($${params.length})`); }
        else if (f.op === 'is' && f.v === null) { where.push(`${f.k} is null`); }
        else { params.push(f.v); where.push(`${f.k} = $${params.length}`); }
      }
      let sql: string;
      const embed = this.table === 'bookings' && /customer:salon_customers/.test(this.state.select);
      if (this.state.update) {
        // Filter params were pushed first (positions 1..F), set params after —
        // the placeholders below match that order exactly.
        const sets = Object.entries(this.state.update).map(([k, v]) => { params.push(v); return `${k} = $${params.length}`; });
        sql = `update public.${this.table} set ${sets.join(', ')}${where.length ? ' where ' + where.join(' and ') : ''} returning *`;
      } else {
        // PostgREST embed selects (customer:salon_customers!…(…)) are executed
        // as `select *` here, with the related rows attached below.
        const cols = embed || this.state.select === '*' ? '*' : this.state.select.split(',').map((c: string) => c.trim()).join(', ');
        sql = `select ${cols} from public.${this.table}${where.length ? ' where ' + where.join(' and ') : ''}`;
        if (this.state.orders.length) sql += ' order by ' + this.state.orders.map((o: any) => `${o.k} ${o.dir}`).join(', ');
        if (this.state.range) sql += ` limit ${this.state.range[1] - this.state.range[0] + 1} offset ${this.state.range[0]}`;
      }
      let rows = (await this.db.query(sql, params)).rows;
      if (embed) {
        rows = await Promise.all(rows.map(async (row: any) => {
          row.customer = row.salon_customer_id
            ? (await this.db.query('select name, phone, email from public.salon_customers where id = $1', [row.salon_customer_id])).rows[0] ?? null
            : null;
          row.salon = row.salon_id
            ? (await this.db.query('select id, name, slug, address, city, phone, whatsapp, latitude, longitude, timezone, logo_url, cover_url from public.salons where id = $1', [row.salon_id])).rows[0] ?? null
            : null;
          row.review = (await this.db.query('select rating, review_text, updated_at from public.reviews where booking_id = $1 order by id limit 1', [row.id])).rows[0] ?? null;
          row.items = (await this.db.query('select service_id, service_name_snapshot, duration_minutes_snapshot, unit_price_paise, quantity from public.booking_items where booking_id = $1 order by id', [row.id])).rows;
          return row;
        }));
      }
      const data = this.state.maybe ? (rows[0] ?? null) : rows;
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error: { code: error.code ?? 'XX000', message: error.message, details: error?.details ?? null, hint: error?.hint ?? null } };
    }
  }
}

function shimClient(db: any) {
  return {
    auth: {
      getUser: async (token: string) => {
        const userId = tokens[token];
        return userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT', status: 401 } };
      },
    },
    from(table: string) { return new Shim(db, table); },
  };
}

/** userDatabase(token).rpc(...) — executes as the signed-in role like PostgREST. */
function rpcDatabaseFor(db: any) {
  return (token: string) => ({
    rpc: async (name: string, args: any) => {
      const userId = tokens[token];
      if (!userId) return { data: null, error: { code: '401', message: 'Invalid JWT' } };
      const keys = Object.keys(args);
      const sql = `select public.${name}(${keys.map((k, i) => `${k} := $${i + 1}${RPC_PARAM_TYPES[k] ? '::' + RPC_PARAM_TYPES[k] : ''}`).join(', ')}) as result`;
      try {
        const res = await asUser(db, userId, sql, keys.map((k) => args[k]));
        return { data: res.rows[0].result, error: null };
      } catch (error: any) {
        if (error.code === '42883') {
          // Exactly what PostgREST answers for a missing function: 404 + PGRST202.
          return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} without parameters in the schema cache`, details: null, hint: null } };
        }
        return { data: null, error: { code: error.code ?? 'XX000', message: error.message, details: error?.details ?? null, hint: error?.hint ?? null } };
      }
    },
  });
}

const ownerRequest = (body: any, token = OWNER_TOKEN, subdomain = 'uma-salon') => ({
  headers: { authorization: `Bearer ${token}` },
  query: { subdomain },
  body,
});

function mockRes() {
  const out: any = { statusCode: 0, body: null };
  out.status = (code: number) => { out.statusCode = code; return { json: (b: any) => { out.body = b; return out; } }; };
  out.json = (b: any) => { out.statusCode = 200; out.body = b; return out; };
  return out;
}

// ---------------------------------------------------------------------------
// 1. ROOT CAUSE — the exact production rejection, before the migration.
// ---------------------------------------------------------------------------
test('live rejection reproduced: create_owner_booking does not exist (42883 / PGRST202) and maps to an actionable error', async () => {
  const db = await liveSchemaDb(); // live schema contract, NO owner-booking migration yet
  try {
    // Direct database attempt (what the RPC call compiles down to):
    await assert.rejects(
      asUser(db, OWNER, 'select public.create_owner_booking(p_salon_id := $1::uuid, p_service_ids := $2::uuid[], p_staff_id := $3::uuid, p_appointment_start := $4::timestamptz, p_customer_user_id := null, p_customer_name := $5::text, p_customer_phone := $6::text, p_customer_note := null, p_is_walk_in := true, p_idempotency_key := $7::text)',
        [SALON, [SERVICE], STAFF, '2026-09-12T04:30:00Z', 'Backend Verification', '+919999888877', 'ref']),
      (error: any) => {
        assert.equal(error.code, '42883');
        assert.match(error.message, /function public\.create_owner_booking.*does not exist/);
        return true;
      }
    );

    // Through the real server handler, with the PostgREST error shape:
    const res = mockRes();
    await ownerDashboardHandler(shimClient(db), true, rpcDatabaseFor(db) as any)(ownerRequest({
      clientName: 'Backend Verification', clientPhone: '+919999888877',
      serviceId: SERVICE, stylistId: STAFF, date: '2026-09-12', time: '10:00',
      reference: 'backend-verification', paymentStatus: 'pay_at_salon',
    }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'booking_rpc_missing');
    assert.match(res.body.error, /create_owner_booking update/);
    assert.match(res.body.error, /20260910200000_create_owner_booking\.sql/);
    // Raw database internals must NOT be surfaced to the browser.
    assert.doesNotMatch(res.body.error, /PGRST202|42883|schema cache/i);
  } finally { await db.close(); }
});

// ---------------------------------------------------------------------------
// 2. Full live flow with the migration applied: create → read → refresh →
//    cancel → re-read, plus totals and slot release.
// ---------------------------------------------------------------------------
test('owner creates, reads, refreshes and cancels a real appointment end to end (empty customer table first)', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const client = shimClient(db);
    const rpc = rpcDatabaseFor(db);

    // The salon starts with 0 saved customers and 0 bookings.
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 0);
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 0);

    // -- create (POST /api/owner/appointments) -------------------------------
    const created = await createOwnerAppointment(client, ownerRequest({
      clientName: 'Backend Verification', clientPhone: '+919999888877', clientEmail: 'uma@example.com',
      serviceId: SERVICE, stylistId: STAFF, date: '2026-09-12', time: '10:00',
      reference: 'backend-verification-1', paymentStatus: 'pay_at_salon',
    }), rpc as any);
    assert.equal(created.success, true);
    assert.match(created.id, /^[0-9a-f-]{36}$/);

    // -- the database row: every FK is a real persisted id -------------------
    const row = (await q(db,
      `select b.*, (select count(*)::int from public.booking_items i where i.booking_id = b.id) as item_count
       from public.bookings b where b.id = $1`, [created.id]))[0];
    assert.equal(row.salon_id, SALON);
    assert.equal(row.staff_id, STAFF);
    assert.equal(row.status, 'confirmed');
    assert.equal(String(row.total_paise), '50000');
    assert.equal(row.currency, 'INR');
    assert.equal(parseFloat(row.paid_amount), 0);
    assert.equal(row.created_by, OWNER);
    assert.equal(row.is_walk_in, true);
    assert.equal(row.appointment_start.toISOString ? row.appointment_start.toISOString() : String(row.appointment_start), '2026-09-12T04:30:00.000Z');
    assert.equal(row.item_count, 1);
    const item = (await q(db, 'select * from public.booking_items where booking_id = $1', [created.id]))[0];
    assert.equal(item.service_id, SERVICE);
    assert.equal(item.service_name_snapshot, 'Signature Cut');
    assert.equal(String(item.unit_price_paise), '50000');
    const customer = (await q(db, 'select * from public.salon_customers where id = $1', [row.salon_customer_id]))[0];
    assert.equal(customer.name, 'Backend Verification');
    assert.equal(customer.phone, '+919999888877');
    assert.equal(customer.email, 'uma@example.com');
    assert.equal(customer.salon_id, SALON);

    // -- dashboard read (GET /api/owner/dashboard) ----------------------------
    const dashboard = await readOwnerDashboard(client, ownerRequest(null));
    assert.equal(dashboard.appointments.length, 1);
    const appointment = dashboard.appointments[0];
    assert.equal(appointment.id, created.id);
    assert.equal(appointment.clientName, 'Backend Verification');
    assert.equal(appointment.serviceId, SERVICE);          // persisted service id
    assert.equal(appointment.stylistId, STAFF);            // persisted staff id
    assert.equal(appointment.serviceName, 'Signature Cut');
    assert.equal(appointment.stylistName, 'Priya');
    assert.equal(appointment.date, '2026-09-12');
    assert.equal(appointment.time, '10:00');
    assert.equal(appointment.status, 'confirmed');
    assert.equal(appointment.paymentStatus, 'pay_at_salon');
    assert.equal(dashboard.clients.length, 1);
    assert.equal(dashboard.clients[0].totalVisits, 0);

    // -- refresh: a brand-new dashboard read returns the same persisted row --
    const refreshed = await readOwnerDashboard(client, ownerRequest(null));
    assert.deepEqual(refreshed.appointments.map((a: any) => a.id), [created.id]);
    assert.equal(refreshed.appointments[0].status, 'confirmed');

    // -- idempotent retry: same reference returns the original booking -------
    const retry = await createOwnerAppointment(client, ownerRequest({
      clientName: 'Backend Verification', clientPhone: '+919999888877',
      serviceId: SERVICE, stylistId: STAFF, date: '2026-09-12', time: '10:00',
      reference: 'backend-verification-1', paymentStatus: 'pay_at_salon',
    }), rpc as any);
    assert.equal(retry.id, created.id);
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 1);

    // -- cancel through the real update flow (POST /api/bookings/update) -----
    const cancelled = await updateNormalizedBooking(client, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      body: { id: created.id, status: 'cancelled' },
    });
    assert.equal(cancelled.success, true);
    assert.equal(cancelled.data.status, 'cancelled');

    // -- the cancellation is PERSISTED, not local-only ------------------------
    const afterCancel = (await q(db, 'select status, cancelled_at from public.bookings where id = $1', [created.id]))[0];
    assert.equal(afterCancel.status, 'cancelled');
    assert.ok(afterCancel.cancelled_at);

    // -- a refresh after cancelling still shows the booking, with its status --
    const postCancelDashboard = await readOwnerDashboard(client, ownerRequest(null));
    assert.equal(postCancelDashboard.appointments.length, 1);
    assert.equal(postCancelDashboard.appointments[0].status, 'cancelled');

    // -- business rules: cancelled bookings are not active/upcoming revenue ---
    const totals = dashboardTotals(postCancelDashboard.appointments as any, postCancelDashboard.clients as any);
    assert.equal(totals.revenue, 0);       // cancelled ≠ completed revenue
    assert.equal(totals.bookings, 1);      // still a recorded booking
    // The cancelled slot is released: the same specialist can be rebooked.
    const rebooked = await createOwnerAppointment(client, ownerRequest({
      clientName: 'Backend Verification 2', clientPhone: '+919999888877',
      serviceId: SERVICE, stylistId: STAFF, date: '2026-09-12', time: '10:00',
      reference: 'backend-verification-2', paymentStatus: 'pay_at_salon',
    }), rpc as any);
    assert.equal(rebooked.success, true);
    // Same phone → same salon customer record, still exactly one customer.
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 1);
    const finalDashboard = await readOwnerDashboard(client, ownerRequest(null));
    assert.equal(finalDashboard.appointments.length, 2);
    assert.equal(finalDashboard.appointments.filter((a: any) => a.status === 'cancelled').length, 1);
    assert.equal(finalDashboard.appointments.filter((a: any) => a.status === 'confirmed').length, 1);
  } finally { await db.close(); }
});

// ---------------------------------------------------------------------------
// 3. Multi-tenant security: another owner's account is refused at BOTH layers.
// ---------------------------------------------------------------------------
test('another salon owner cannot create an appointment in a salon they do not manage', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    // Server layer: the foreign owner's request can never reference this
    // salon's catalogue, and nothing is written.
    const res = mockRes();
    await ownerDashboardHandler(shimClient(db), true, rpcDatabaseFor(db) as any)(ownerRequest({
      clientName: 'Intruder', clientPhone: '+910000000000',
      serviceId: SERVICE, stylistId: STAFF, date: '2026-09-13', time: '10:00',
      reference: 'intruder-attempt', paymentStatus: 'pay_at_salon',
    }, OTHER_TOKEN), res);
    assert.equal(res.statusCode, 409);
    assert.ok(['service_unavailable', 'staff_unavailable', 'forbidden'].includes(res.body.code));
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 0);
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 0);

    // Database layer: even a direct create_owner_booking call naming this
    // salon is refused for a caller who does not manage it (42501), and the
    // server maps that rejection to "outside your salon workspace".
    await assert.rejects(
      asUser(db, OTHER_OWNER, `select public.create_owner_booking(
        p_salon_id := $1::uuid, p_service_ids := $2::uuid[], p_staff_id := $3::uuid,
        p_appointment_start := $4::timestamptz, p_customer_user_id := null,
        p_customer_name := $5::text, p_customer_phone := $6::text,
        p_customer_note := null, p_is_walk_in := true, p_idempotency_key := $7::text)`,
        [SALON, [SERVICE], STAFF, '2026-09-13T04:30:00Z', 'Intruder', '+910000000000', 'intruder-direct']),
      (error: any) => {
        assert.equal(error.code, '42501');
        assert.match(error.message, /outside your salon workspace/);
        return true;
      }
    );
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 0);
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 0);
  } finally { await db.close(); }
});

// ---------------------------------------------------------------------------
// 4. Stale editor slug resolves the sole authorized salon for the CREATE path.
// ---------------------------------------------------------------------------
test('stale profile slug with exactly one authorized salon still creates the appointment in that salon', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const created = await createOwnerAppointment(shimClient(db), ownerRequest({
      clientName: 'Backend Verification', clientPhone: '+919999888877',
      serviceId: SERVICE, stylistId: STAFF, date: '2026-09-12', time: '11:00',
      reference: 'stale-slug-ref', paymentStatus: 'pay_at_salon',
    }, OWNER_TOKEN, 'arts-by-uma' /* stale legacy slug */), rpcDatabaseFor(db) as any);
    assert.equal(created.success, true);
    const row = (await q(db, 'select salon_id from public.bookings where id = $1', [created.id]))[0];
    assert.equal(row.salon_id, SALON);
  } finally { await db.close(); }
});

// ---------------------------------------------------------------------------
// 5. Catalogue integrity through the server path.
// ---------------------------------------------------------------------------
test('editor or placeholder ids never reach the booking foreign keys', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const client = shimClient(db);
    const rpc = rpcDatabaseFor(db);
    await assert.rejects(
      createOwnerAppointment(client, ownerRequest({
        clientName: 'X', clientPhone: '+919999888877', serviceId: 'srv-1',
        stylistId: STAFF, date: '2026-09-12', time: '10:00', reference: 'r1', paymentStatus: 'pay_at_salon',
      }), rpc as any),
      /Choose a service from the saved salon catalogue/
    );
    await assert.rejects(
      createOwnerAppointment(client, ownerRequest({
        clientName: 'X', clientPhone: '+919999888877', serviceId: SERVICE,
        stylistId: 'st-default', date: '2026-09-12', time: '10:00', reference: 'r2', paymentStatus: 'pay_at_salon',
      }), rpc as any),
      /Choose a specialist from the saved salon team/
    );
    await assert.rejects(
      createOwnerAppointment(client, ownerRequest({
        clientName: 'X', clientPhone: '+919999888877', serviceId: '40000000-0000-4000-8000-000000000002' /* other salon's service */,
        stylistId: STAFF, date: '2026-09-12', time: '10:00', reference: 'r3', paymentStatus: 'pay_at_salon',
      }), rpc as any),
      /no longer available/
    );
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 0);
  } finally { await db.close(); }
});

// ---------------------------------------------------------------------------
// 6. Slot conflicts surface as an actionable "already booked" error.
// ---------------------------------------------------------------------------
test('overlapping slots for the same specialist are rejected with a slot-conflict error', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const client = shimClient(db);
    const rpc = rpcDatabaseFor(db);
    const first = await createOwnerAppointment(client, ownerRequest({
      clientName: 'First', clientPhone: '+919999888877', serviceId: SERVICE, stylistId: STAFF,
      date: '2026-09-12', time: '10:00', reference: 's1', paymentStatus: 'pay_at_salon',
    }), rpc as any);
    assert.equal(first.success, true);
    const res = mockRes();
    await ownerDashboardHandler(client, true, rpc as any)(ownerRequest({
      clientName: 'Second', clientPhone: '+919999888878', serviceId: SERVICE, stylistId: STAFF,
      date: '2026-09-12', time: '10:30', reference: 's2', paymentStatus: 'pay_at_salon',
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'slot_conflict');
    assert.match(res.body.error, /already booked/);
  } finally { await db.close(); }
});

