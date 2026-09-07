// ============================================================================
// Resilience tests for POST /api/bookings/create — every path that used to end
// in an opaque "Server error (HTTP 500)" must now end in a specific, JSON,
// actionable answer (and, where possible, a saved booking).
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBookingHandler,
  describeDbError,
  missingColumnFromError,
  insertBookingRow,
  readJsonBody,
} from '../server/bookingCreate';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const VALID_BOOKING = {
  customer_name: 'Riya Sharma',
  customer_phone: '9845012345',
  customer_email: 'riya@example.com',
  service_id: 'hs-1',
  service_name: 'Master Stylist Precision Cut',
  booking_date: '2026-10-02',
  time_slot: '11:30',
  total_amount: 750,
  advance_paid_amount: 0,
  status: 'pending',
  payment_status: 'pending',
  booking_type: 'salon',
};

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    locals: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

/**
 * Supabase-client double whose `bookings` insert is driven by a callback, so a
 * test can hang it, fail it transiently, or reject a specific column.
 */
function makeDb(handlers: {
  insert?: (rows: any[], attempt: number) => Promise<any> | any;
  profileId?: string | null;
}) {
  let insertAttempts = 0;
  const from = (table: string) => {
    const api: any = {
      select: () => api,
      eq: () => api,
      limit: async () => ({ data: handlers.profileId ? [{ id: handlers.profileId }] : [], error: null }),
      maybeSingle: async () =>
        handlers.profileId ? { data: { id: handlers.profileId, email: 'owner@real.com' }, error: null } : { data: null, error: null },
      insert(rows: any) {
        if (table !== 'bookings') return Promise.resolve({ data: rows, error: null });
        insertAttempts += 1;
        const attempt = insertAttempts;
        const run = async () => {
          const result = handlers.insert ? await handlers.insert(rows, attempt) : { data: rows[0], error: null };
          return result;
        };
        const thenable = run();
        return Object.assign(thenable, {
          select: () => ({ single: () => thenable, maybeSingle: () => thenable }),
        });
      },
    };
    return api;
  };
  return { db: { from }, getInsertAttempts: () => insertAttempts };
}

const deps = (db: any, overrides: any = {}) => ({
  db,
  isMock: false,
  hasAdminClient: true,
  addMockBooking: () => {},
  addMockNotifications: () => {},
  resolveOwnerEmail: async () => 'owner@real.com',
  ...overrides,
});

const request = (body: any = {}) => ({
  body: { booking: VALID_BOOKING, owner_id: OWNER, ...body },
  headers: {},
  query: {},
});

// ---------------------------------------------------------------------------

test('a database that never answers becomes a 503 with a retry hint (never a hang)', async () => {
  const { db } = makeDb({ insert: () => new Promise(() => {}), profileId: OWNER });
  const handler = createBookingHandler(deps(db));
  const res = makeRes();

  const startedAt = Date.now();
  await handler({ ...request(), }, res);
  const elapsed = Date.now() - startedAt;

  assert.equal(res.statusCode, 503, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /not responding|could not be reached/i);
  assert.ok(res.body.requestId, 'the customer must get a reference to quote');
  assert.ok(elapsed < 30000, `must give up quickly, took ${elapsed}ms`);
});

test('a transient network fault is retried automatically and the booking is saved', async () => {
  const { db, getInsertAttempts } = makeDb({
    profileId: OWNER,
    insert: (rows, attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      return { data: { id: 'booking-1', ...rows[0] }, error: null };
    },
  });
  const handler = createBookingHandler(deps(db));
  const res = makeRes();
  await handler(request(), res);

  assert.equal(getInsertAttempts(), 2);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.id, 'booking-1');
});

test('an unreachable database answers 503 (retryable), not a bare 500', async () => {
  const { db } = makeDb({
    profileId: OWNER,
    insert: () => {
      throw new TypeError('fetch failed');
    },
  });
  const handler = createBookingHandler(deps(db));
  const res = makeRes();
  await handler(request(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.retryable, true);
  assert.match(res.body.error, /could not be reached/i);
});

test('a database missing a newer column drops it and still saves the booking', async () => {
  const { db, getInsertAttempts } = makeDb({
    profileId: OWNER,
    insert: (rows) => {
      const row = rows[0];
      if ('booking_type' in row) {
        return {
          data: null,
          error: {
            code: 'PGRST204',
            message: "Could not find the 'booking_type' column of 'bookings' in the schema cache",
          },
        };
      }
      return { data: { id: 'booking-2', ...row }, error: null };
    },
  });
  const handler = createBookingHandler(deps(db));
  const res = makeRes();
  await handler(request(), res);

  assert.equal(getInsertAttempts(), 2);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.id, 'booking-2');
});

test('insertBookingRow reports which columns it had to drop', async () => {
  const { db } = makeDb({
    insert: (rows) =>
      'notes' in rows[0]
        ? { data: null, error: { code: '42703', message: 'column "notes" of relation "bookings" does not exist' } }
        : { data: { id: 'x', ...rows[0] }, error: null },
  });
  const result = await insertBookingRow(db, { customer_name: 'A', notes: 'hi' }, 'req_test');
  assert.equal(result.error, null);
  assert.deepEqual(result.droppedColumns, ['notes']);
});

test('missingColumnFromError never drops a column the booking cannot exist without', () => {
  assert.equal(
    missingColumnFromError({ code: 'PGRST204', message: "Could not find the 'customer_name' column of 'bookings' in the schema cache" }),
    null
  );
  assert.equal(
    missingColumnFromError({ code: 'PGRST204', message: "Could not find the 'home_address' column of 'bookings' in the schema cache" }),
    'home_address'
  );
  assert.equal(missingColumnFromError({ code: '23505', message: 'duplicate key' }), null);
});

test('describeDbError turns a timeout and a transport fault into 503s', () => {
  assert.equal(describeDbError({ code: 'db_timeout', message: 'x' }).status, 503);
  assert.equal(describeDbError({ code: 'db_unreachable', message: 'x' }).status, 503);
  assert.equal(describeDbError({ message: 'TypeError: fetch failed' }).status, 503);
  // A genuine, non-transient failure is still a 500.
  assert.equal(describeDbError({ message: 'something odd' }).status, 500);
});

test('every failure answer carries success:false, a code and a requestId', async () => {
  const handler = createBookingHandler(deps(makeDb({}).db));
  const res = makeRes();
  await handler({ body: { booking: { customer_name: '' } }, headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'invalid_booking');
  assert.ok(res.body.requestId);
  assert.ok(res.body.fieldErrors.customer_name);
});

test('readJsonBody accepts the object, string and Buffer body shapes', () => {
  const payload = { booking: { customer_name: 'A' } };
  assert.deepEqual(readJsonBody({ body: payload }), payload);
  assert.deepEqual(readJsonBody({ body: JSON.stringify(payload) }), payload);
  assert.deepEqual(readJsonBody({ body: Buffer.from(JSON.stringify(payload)) }), payload);
  assert.deepEqual(readJsonBody({ body: 'not json' }), {});
  assert.deepEqual(readJsonBody({}), {});
});

test('the success answer includes the request id for support follow-up', async () => {
  const { db } = makeDb({ profileId: OWNER, insert: (rows) => ({ data: { id: 'b-9', ...rows[0] }, error: null }) });
  const handler = createBookingHandler(deps(db));
  const res = makeRes();
  await handler(request(), res);
  assert.equal(res.body.success, true);
  assert.match(res.body.requestId, /^bk_/);
});

// ---------------------------------------------------------------------------
// Idempotency — the client retries, and so does runDb, so the same booking can
// arrive twice. It must never become two rows (and two charges of the salon's
// slot inventory).
// ---------------------------------------------------------------------------

test('a repeated submission returns the existing booking instead of duplicating it', async () => {
  const stored = { id: 'b-existing', payment_id: 'NX-BLR-12345', owner_id: OWNER, customer_name: 'Riya Sharma' };
  let insertCalls = 0;
  const db = {
    from: (table: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        limit: async () => ({ data: [{ id: OWNER }], error: null }),
        maybeSingle: async () => (table === 'bookings' ? { data: stored, error: null } : { data: { id: OWNER }, error: null }),
        insert: (rows: any) => {
          insertCalls += 1;
          const thenable: any = Promise.resolve({ data: rows[0], error: null });
          thenable.select = () => ({ single: () => thenable, maybeSingle: () => thenable });
          return thenable;
        },
      };
      return api;
    },
  };
  const handler = createBookingHandler(deps(db));
  const res = makeRes();
  await handler(request({ booking: { ...VALID_BOOKING, payment_id: 'NX-BLR-12345' } }), res);

  assert.equal(insertCalls, 0, 'the duplicate must not be inserted again');
  assert.equal(res.body.success, true);
  assert.equal(res.body.duplicate, true);
  assert.equal(res.body.data.id, 'b-existing');
});

test('mock mode also de-duplicates repeated submissions', async () => {
  const rows: any[] = [];
  const handler = createBookingHandler(
    deps(makeDb({}).db, {
      isMock: true,
      addMockBooking: (row: any) => rows.push(row),
      getMockBookings: () => rows,
    })
  );

  const first = makeRes();
  await handler(request({ booking: { ...VALID_BOOKING, payment_id: 'NX-BLR-99999' } }), first);
  const second = makeRes();
  await handler(request({ booking: { ...VALID_BOOKING, payment_id: 'NX-BLR-99999' } }), second);

  assert.equal(rows.length, 1, 'only one booking may be stored');
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.data.id, first.body.data.id);
});
