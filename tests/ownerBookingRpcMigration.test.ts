// ============================================================================
// create_owner_booking migration semantics — run against a real Postgres
// engine (PGlite) with the live normalized schema contract.
//
// Regression suite for the production root cause: the RPC had never been
// created, so owner appointments were rejected by the database. These tests
// pin the migration's contract: the exact rejection before it is applied, the
// atomic customer → booking → booking_items transaction, tenant isolation,
// catalogue validation, idempotency, slot conflicts and cancellation
// persistence.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  liveSchemaDb, liveSchemaDbWithRpc, asUser,
  OWNER, OTHER_OWNER, SALON, OTHER_SALON, SERVICE, STAFF, ORG,
} from './liveSchemaFixture';

const MIGRATION_URL = new URL('../supabase/migrations/20260910200000_create_owner_booking.sql', import.meta.url);
const q = async (db: any, sql: string, params?: any[]) => (await db.query(sql, params)).rows as any[];

const createSql = `select public.create_owner_booking(
  p_salon_id := $1::uuid, p_service_ids := $2::uuid[], p_staff_id := $3::uuid,
  p_appointment_start := $4::timestamptz, p_customer_user_id := $5::uuid,
  p_customer_name := $6::text, p_customer_phone := $7::text,
  p_customer_email := $8::text, p_customer_note := $9::text,
  p_is_walk_in := $10::boolean, p_idempotency_key := $11::text) as booking_id`;

function createParams(overrides: Record<number, any> = {}) {
  const params = [SALON, [SERVICE], STAFF, '2026-09-12T04:30:00Z', null, 'Backend Verification', '+919999888877', null, null, true, 'ref-1'];
  for (const [index, value] of Object.entries(overrides)) params[Number(index)] = value;
  return params;
}

test('root cause regression: before the migration the exact live rejection is 42883 (function does not exist)', async () => {
  const db = await liveSchemaDb();
  try {
    await assert.rejects(
      asUser(db, OWNER, createSql, createParams()),
      (error: any) => {
        assert.equal(error.code, '42883');
        assert.match(error.message, /function public\.create_owner_booking.*does not exist/);
        return true;
      }
    );
  } finally { await db.close(); }
});

test('migration is idempotent and grants execute to authenticated only', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const migration = await readFile(MIGRATION_URL, 'utf8');
    await db.exec(migration); // re-running must not throw
    const signature = 'public.create_owner_booking(uuid, uuid[], uuid, timestamptz, uuid, text, text, text, text, boolean, text)';
    assert.equal((await q(db, `select has_function_privilege('authenticated', '${signature}', 'EXECUTE') as ok`))[0].ok, true);
    assert.equal((await q(db, `select has_function_privilege('anon', '${signature}', 'EXECUTE') as ok`))[0].ok, false);
  } finally { await db.close(); }
});

test('anon callers cannot execute the RPC even with valid arguments', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    await assert.rejects(
      asUser(db, '', createSql, createParams()),
      (error: any) => /permission denied|42501/i.test(`${error.code} ${error.message}`)
    );
  } finally { await db.close(); }
});

test('owner creates an appointment from an EMPTY customer table: customer, booking and line items are written atomically', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 0);
    const result = await asUser(db, OWNER, createSql, createParams({ 7: 'uma@example.com' }));
    const bookingId = result.rows[0].booking_id;

    const booking = (await q(db, 'select * from public.bookings where id = $1', [bookingId]))[0];
    assert.equal(booking.salon_id, SALON);
    assert.equal(booking.staff_id, STAFF);
    assert.equal(booking.staff_name_snapshot, 'Priya');
    assert.equal(booking.status, 'confirmed');
    assert.ok(booking.confirmed_at);
    assert.equal(booking.appointment_start.toISOString(), '2026-09-12T04:30:00.000Z');
    assert.equal(booking.appointment_end.toISOString(), '2026-09-12T05:15:00.000Z'); // +45 min service
    assert.equal(String(booking.total_paise), '50000');
    assert.equal(booking.currency, 'INR');
    assert.equal(booking.created_by, OWNER);
    assert.equal(booking.is_walk_in, true);
    assert.equal(booking.idempotency_key, 'ref-1');
    assert.equal(new Date(booking.booking_date).toISOString().slice(0, 10), '2026-09-12'); // salon-local date (IST)
    assert.equal(booking.booking_time, '10:00');          // salon-local time (IST)

    const items = (await q(db, 'select * from public.booking_items where booking_id = $1', [bookingId]));
    assert.equal(items.length, 1);
    assert.equal(items[0].service_id, SERVICE);
    assert.equal(items[0].service_name_snapshot, 'Signature Cut');
    assert.equal(String(items[0].unit_price_paise), '50000');
    assert.equal(items[0].quantity, 1);
    assert.equal(items[0].duration_minutes_snapshot, 45);

    const customer = (await q(db, 'select * from public.salon_customers where id = $1', [booking.salon_customer_id]))[0];
    assert.equal(customer.salon_id, SALON);
    assert.equal(customer.name, 'Backend Verification');
    assert.equal(customer.phone, '+919999888877');
    assert.equal(customer.email, 'uma@example.com');
  } finally { await db.close(); }
});

test('a later failure rolls back the customer row too — no partial appointment is left behind', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    // Second service id does not exist → validation fails AFTER nothing was
    // written; but to prove rollback, corrupt the tail of the transaction by
    // requesting a valid service from ANOTHER salon (fails the catalogue
    // check) and confirm zero rows of any kind exist.
    await assert.rejects(
      asUser(db, OWNER, createSql, createParams({ 1: [SERVICE, '40000000-0000-4000-8000-000000000002'] })),
      (error: any) => { assert.equal(error.code, '22023'); return true; }
    );
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 0);
    assert.equal((await q(db, 'select count(*)::int as n from public.booking_items'))[0].n, 0);
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 0);
  } finally { await db.close(); }
});

test('retrying the same reference returns the original booking instead of a duplicate', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const first = await asUser(db, OWNER, createSql, createParams());
    const second = await asUser(db, OWNER, createSql, createParams());
    assert.equal(second.rows[0].booking_id, first.rows[0].booking_id);
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 1);
    assert.equal((await q(db, 'select count(*)::int as n from public.booking_items'))[0].n, 1);
    // A different reference creates a new booking for the SAME customer.
    const third = await asUser(db, OWNER, createSql, createParams({ 3: '2026-09-12T06:30:00Z', 10: 'ref-2' }));
    assert.notEqual(third.rows[0].booking_id, first.rows[0].booking_id);
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 2);
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 1);
  } finally { await db.close(); }
});

test('cross-salon access is denied even though the function is SECURITY DEFINER', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    // Another owner booking into a salon they do not manage:
    await assert.rejects(
      asUser(db, OTHER_OWNER, createSql, createParams()),
      (error: any) => {
        assert.equal(error.code, '42501');
        assert.match(error.message, /outside your salon workspace/);
        return true;
      }
    );
    // An inactive member of the RIGHT organization is denied as well:
    await db.query(`insert into public.organization_members (organization_id, user_id, role, status)
      values ('${ORG}', '10000000-0000-4000-8000-000000000009', 'owner', 'inactive')`);
    await assert.rejects(
      asUser(db, '10000000-0000-4000-8000-000000000009', createSql, createParams()),
      (error: any) => { assert.equal(error.code, '42501'); return true; }
    );
    // A salon the caller manages but with foreign catalogue ids:
    await assert.rejects(
      asUser(db, OTHER_OWNER, createSql, createParams({ 0: OTHER_SALON })),
      (error: any) => { assert.equal(error.code, '22023'); return true; }
    );
    assert.equal((await q(db, 'select count(*)::int as n from public.bookings'))[0].n, 0);
    assert.equal((await q(db, 'select count(*)::int as n from public.salon_customers'))[0].n, 0);
  } finally { await db.close(); }
});

test('retired catalogue records are refused with a clear error', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    await db.query(`update public.staff set is_active = false where id = '${STAFF}'`);
    await assert.rejects(
      asUser(db, OWNER, createSql, createParams()),
      (error: any) => { assert.equal(error.code, '22023'); assert.match(error.message, /specialist/); return true; }
    );
    await db.query(`update public.staff set is_active = true where id = '${STAFF}'`);
    await db.query(`update public.services set is_active = false where id = '${SERVICE}'`);
    await assert.rejects(
      asUser(db, OWNER, createSql, createParams()),
      (error: any) => { assert.equal(error.code, '22023'); assert.match(error.message, /service/); return true; }
    );
  } finally { await db.close(); }
});

test('staff/service assignments are enforced when the salon saved a mapping', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    // No mapping saved → any of the salon's services is bookable.
    const free = await asUser(db, OWNER, createSql, createParams({ 10: 'free' }));
    assert.ok(free.rows[0].booking_id);
    // Save a mapping that does NOT include the requested service:
    await db.query(`insert into public.services (id, salon_id, name, price_paise, duration_minutes, is_active)
      values ('40000000-0000-4000-8000-000000000099', '${SALON}', 'Mapped Only', 1000, 10, true)`);
    await db.query(`insert into public.staff_services (staff_id, service_id, is_active) values ('${STAFF}', '40000000-0000-4000-8000-000000000099', true)`);
    await assert.rejects(
      asUser(db, OWNER, createSql, createParams({ 10: 'mapped' })),
      (error: any) => {
        assert.equal(error.code, '22023');
        assert.match(error.message, /does not offer this service/);
        return true;
      }
    );
    // With the mapping satisfied, the booking succeeds:
    const ok = await asUser(db, OWNER, createSql, createParams({ 1: ['40000000-0000-4000-8000-000000000099'], 3: '2026-09-12T07:30:00Z', 10: 'mapped-ok' }));
    assert.ok(ok.rows[0].booking_id);
  } finally { await db.close(); }
});

test('overlapping the same specialist slot is rejected with 23P01, other specialists are unaffected', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const first = await asUser(db, OWNER, createSql, createParams());
    assert.ok(first.rows[0].booking_id);
    // Same specialist, overlapping time (10:00–10:45 IST vs 10:30–11:15 IST):
    await assert.rejects(
      asUser(db, OWNER, createSql, createParams({ 3: '2026-09-12T05:00:00Z', 10: 'overlap' })),
      (error: any) => {
        assert.equal(error.code, '23P01');
        assert.match(error.message, /already booked/);
        return true;
      }
    );
    // A cancelled booking no longer holds the slot:
    await db.query(`update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1`, [first.rows[0].booking_id]);
    const rebook = await asUser(db, OWNER, createSql, createParams({ 10: 'rebook' }));
    assert.ok(rebook.rows[0].booking_id);
  } finally { await db.close(); }
});

test('cancelled appointments stay persisted with their status and timestamps', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    const created = await asUser(db, OWNER, createSql, createParams({ 10: 'cancel-me' }));
    const id = created.rows[0].booking_id;
    // The application's cancel flow (server/normalizedBookingAccess.ts
    // ownerBookingChanges) writes status + cancelled_at + updated_at:
    await db.query(`update public.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = $1`, [id]);
    const row = (await q(db, 'select status, cancelled_at, salon_customer_id, total_paise from public.bookings where id = $1', [id]))[0];
    assert.equal(row.status, 'cancelled');
    assert.ok(row.cancelled_at);
    assert.ok(row.salon_customer_id);
    assert.equal(String(row.total_paise), '50000');
    // Line items survive cancellation (history is never rewritten):
    assert.equal((await q(db, 'select count(*)::int as n from public.booking_items where booking_id = $1', [id]))[0].n, 1);
    // The status check constraint keeps the value legal:
    await assert.rejects(db.query(`update public.bookings set status = 'nonsense' where id = $1`, [id]));
  } finally { await db.close(); }
});

test('RLS stays enabled: direct authenticated inserts into bookings are refused', async () => {
  const db = await liveSchemaDbWithRpc();
  try {
    await assert.rejects(
      asUser(db, OWNER, `insert into public.bookings (salon_id, status) values ($1::uuid, 'confirmed')`, [SALON]),
      (error: any) => /row-level security|42501/i.test(`${error.code} ${error.message}`)
    );
  } finally { await db.close(); }
});
