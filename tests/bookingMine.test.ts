// ============================================================================
// Customer-scoped booking endpoints (server/bookingMine.ts).
//
// The security property under test: the customer is identified ONLY by the
// verified bearer token. `GET /api/bookings` is owner-scoped and returns every
// customer of a salon, so the obvious shortcut — accepting `?user_id=` on a
// customer list — would hand any caller anyone's booking history. These tests
// pin that the parameter is ignored, that another user's booking cannot be
// cancelled or reviewed, and that the cancellation rule matches the UI's.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  bookingBelongsTo,
  createCancelMyBookingHandler,
  createMyBookingDetailHandler,
  createMyBookingsListHandler,
  createReviewMyBookingHandler,
} from '../server/bookingMine';

const BOOKING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const ME = 'customer-mine-1';
const OTHER = 'customer-other-2';
const SLOT_UTC = Date.UTC(2026, 8, 20, 6, 0, 0); // 2026-09-20 11:30 IST
const BEFORE_SLOT = Date.UTC(2026, 8, 19, 12, 0, 0);

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

function makeDeps(overrides: Record<string, any> = {}) {
  const rows: any[] = overrides.rows ?? [];
  const notifications: any[] = [];
  return {
    rows,
    notifications,
    deps: {
      db: null,
      isMock: true,
      getMockBookings: () => rows,
      addMockNotifications: (batch: any[]) => { notifications.push(...batch); },
      resolveOwnerEmail: async () => 'owner@salon.com',
      authenticateUser: async () => ({ ok: true, user: { id: ME } }),
      now: () => BEFORE_SLOT,
      ...overrides.deps,
    },
  };
}

function booking(overrides: Record<string, any> = {}) {
  return {
    id: BOOKING_ID,
    owner_id: OWNER,
    user_id: ME,
    customer_name: 'Riya',
    service_name: 'Hair Spa',
    booking_date: '2026-09-20',
    time_slot: '11:30',
    total_amount: 2400,
    advance_paid_amount: 600,
    status: 'confirmed',
    payment_id: 'NX-BLR-12345',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ownership matching
// ---------------------------------------------------------------------------

test('a booking matches its owner by column or by metadata', () => {
  assert.equal(bookingBelongsTo({ user_id: ME }, ME), true);
  assert.equal(bookingBelongsTo({ metadata: { user_id: ME } }, ME), true);
  assert.equal(bookingBelongsTo({ user_id: OTHER }, ME), false);
  assert.equal(bookingBelongsTo({ metadata: { user_id: OTHER } }, ME), false);
});

test('a booking with no customer id belongs to nobody', () => {
  assert.equal(bookingBelongsTo({ id: 'x' }, ME), false);
  assert.equal(bookingBelongsTo(null, ME), false);
  assert.equal(bookingBelongsTo({ user_id: ME }, ''), false);
});

// ---------------------------------------------------------------------------
// GET /api/bookings/mine — authentication and scoping
// ---------------------------------------------------------------------------

test('the list requires a verified token', async () => {
  const { deps } = makeDeps({
    rows: [booking()],
    deps: { authenticateUser: async () => ({ ok: false, status: 401, code: 'auth_required', error: 'Sign in' }) },
  });
  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'auth_required');
});

test('the list returns only the caller\u2019s bookings', async () => {
  const { deps } = makeDeps({
    rows: [booking({ id: 'mine' }), booking({ id: 'theirs', user_id: OTHER, customer_name: 'Someone Else' })],
  });
  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data.map((r: any) => r.id), ['mine']);
});

test('a ?user_id= parameter cannot be used to read another customer\u2019s bookings', async () => {
  // The whole reason these endpoints exist separately from /api/bookings.
  const { deps } = makeDeps({
    rows: [booking({ id: 'mine' }), booking({ id: 'victim', user_id: OTHER, customer_name: 'Victim' })],
  });
  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: { user_id: OTHER } }, res);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data.map((r: any) => r.id), ['mine']);
  assert.ok(!res.body.data.some((r: any) => r.customer_name === 'Victim'));
});

test('a customer with no bookings gets an empty list, not an error', async () => {
  const { deps } = makeDeps({ rows: [booking({ user_id: OTHER })] });
  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []);
});

test('the live path queries by the token\u2019s user id', async () => {
  const seen: any[] = [];
  const chain: any = {
    select: () => chain,
    eq: (column: string, value: any) => {
      seen.push({ column, value });
      return chain;
    },
    order: () => chain,
    limit: () => Promise.resolve({ data: [booking()], error: null }),
    in: () => Promise.resolve({ data: [], error: null }),
  };
  const db = { from: () => chain };
  const { deps } = makeDeps({ deps: { isMock: false, db, hasAdminClient: true } });

  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.body.success, true);
  assert.deepEqual(seen, [{ column: 'user_id', value: ME }]);
});

test('a salon summary is attached so the card can name the salon', async () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: [booking()], error: null }),
    in: () =>
      Promise.resolve({
        data: [{ id: OWNER, salon_name: 'Luxe Salon', logo_url: 'https://img/l.png', city: 'Mumbai', currency: '₹' }],
        error: null,
      }),
  };
  const db = { from: () => chain };
  const { deps } = makeDeps({ deps: { isMock: false, db, hasAdminClient: true } });

  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.body.data[0].salon.name, 'Luxe Salon');
  assert.equal(res.body.data[0].salon.imageUrl, 'https://img/l.png');
  assert.equal(res.body.data[0].salon.city, 'Mumbai');
});

test('a failed salon lookup still returns the bookings', async () => {
  // Presentation data must not blank the customer's whole list.
  let table = '';
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: [booking()], error: null }),
    in: () => Promise.resolve({ data: null, error: { message: 'profiles unavailable' } }),
  };
  const db = { from: (name: string) => { table = name; return chain; } };
  const { deps } = makeDeps({ deps: { isMock: false, db, hasAdminClient: true } });

  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].salon, null);
  assert.equal(table, 'profiles');
});

test('a database failure is reported, not flattened into an empty list', async () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
  };
  const db = { from: () => chain };
  const { deps } = makeDeps({ deps: { isMock: false, db, hasAdminClient: true } });

  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(res.body.success, false);
  assert.notEqual(res.statusCode, 200);
});

// ---------------------------------------------------------------------------
// POST /api/bookings/mine/cancel
// ---------------------------------------------------------------------------

test('cancelling an upcoming booking sets it cancelled and notifies the salon', async () => {
  const { rows, notifications, deps } = makeDeps({ rows: [booking()] });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'cancelled');
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].user_email, 'owner@salon.com');
});

test('another customer\u2019s booking cannot be cancelled', async () => {
  const { rows, deps } = makeDeps({ rows: [booking({ user_id: OTHER })] });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  // Reported as not-found: confirming a guessed id exists is exactly what this
  // must not reveal.
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'not_found');
  assert.equal(rows[0].status, 'confirmed', 'the row must be untouched');
});

test('an unknown booking id is a 404', async () => {
  const { deps } = makeDeps({ rows: [booking()] });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: 'nope' } }, res);
  assert.equal(res.statusCode, 404);
});

test('a missing booking id is a 400', async () => {
  const { deps } = makeDeps({ rows: [booking()] });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_request');
});

test('cancel requires a verified token', async () => {
  const { deps } = makeDeps({
    rows: [booking()],
    deps: { authenticateUser: async () => ({ ok: false, status: 401, code: 'auth_required', error: 'Sign in' }) },
  });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 401);
});

test('a completed booking cannot be cancelled, and the server says why', async () => {
  const { rows, deps } = makeDeps({ rows: [booking({ status: 'completed' })] });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'not_cancellable');
  assert.ok(res.body.error.length > 0);
  assert.equal(rows[0].status, 'completed');
});

test('a booking whose slot has passed cannot be cancelled', async () => {
  const { deps } = makeDeps({ rows: [booking()], deps: { now: () => Date.UTC(2026, 8, 21, 12, 0, 0) } });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'not_cancellable');
});

test('a no-show cannot be cancelled by the customer', async () => {
  const { deps } = makeDeps({ rows: [booking({ status: 'no_show' })] });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 409);
});

test('the cancel window is exactly the slot instant', async () => {
  const { deps } = makeDeps({ rows: [booking()], deps: { now: () => SLOT_UTC } });
  const res = makeRes();
  await createCancelMyBookingHandler(deps as any)({ body: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 409, 'at the slot instant the window is closed');
});

// ---------------------------------------------------------------------------
// POST /api/bookings/mine/review
// ---------------------------------------------------------------------------

test('a completed booking can be reviewed and the rating is stored', async () => {
  const { rows, notifications, deps } = makeDeps({ rows: [booking({ status: 'completed' })] });
  const res = makeRes();
  await createReviewMyBookingHandler(deps as any)(
    { body: { id: BOOKING_ID, rating: 5, text: 'Wonderful' } },
    res
  );
  assert.equal(res.body.success, true);
  assert.equal(rows[0].metadata.review_rating, 5);
  assert.equal(rows[0].metadata.review_text, 'Wonderful');
  assert.ok(rows[0].metadata.reviewed_at);
  assert.equal(rows[0].metadata.reviewed_by, ME);
  assert.equal(notifications[0].title, 'New 5-star review');
});

test('an existing review does not wipe the rest of the metadata', async () => {
  const { rows, deps } = makeDeps({
    rows: [booking({ status: 'completed', metadata: { stylist_name: 'Ananya', salon_name: 'Luxe' } })],
  });
  const res = makeRes();
  await createReviewMyBookingHandler(deps as any)({ body: { id: BOOKING_ID, rating: 4 } }, res);
  assert.equal(res.body.success, true);
  assert.equal(rows[0].metadata.stylist_name, 'Ananya');
  assert.equal(rows[0].metadata.salon_name, 'Luxe');
  assert.equal(rows[0].metadata.review_rating, 4);
});

test('only a completed booking can be reviewed', async () => {
  for (const status of ['pending', 'confirmed', 'cancelled', 'no_show']) {
    const { deps } = makeDeps({ rows: [booking({ status })] });
    const res = makeRes();
    await createReviewMyBookingHandler(deps as any)({ body: { id: BOOKING_ID, rating: 5 } }, res);
    assert.equal(res.statusCode, 422, `status ${status}`);
    assert.equal(res.body.code, 'invalid_review');
  }
});

test('an out-of-range rating is rejected', async () => {
  for (const rating of [0, 6, 'abc', null]) {
    const { deps } = makeDeps({ rows: [booking({ status: 'completed' })] });
    const res = makeRes();
    await createReviewMyBookingHandler(deps as any)({ body: { id: BOOKING_ID, rating } }, res);
    assert.equal(res.statusCode, 422, `rating ${String(rating)}`);
  }
});

test('an over-long review is rejected rather than truncated silently', async () => {
  const { deps } = makeDeps({ rows: [booking({ status: 'completed' })] });
  const res = makeRes();
  await createReviewMyBookingHandler(deps as any)(
    { body: { id: BOOKING_ID, rating: 5, text: 'x'.repeat(5000) } },
    res
  );
  assert.equal(res.statusCode, 422);
});

test('another customer\u2019s booking cannot be reviewed', async () => {
  const { rows, deps } = makeDeps({ rows: [booking({ status: 'completed', user_id: OTHER })] });
  const res = makeRes();
  await createReviewMyBookingHandler(deps as any)({ body: { id: BOOKING_ID, rating: 5 } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(rows[0].metadata, undefined);
});

// ---------------------------------------------------------------------------
// Route ordering
// ---------------------------------------------------------------------------

test('/api/bookings/mine is registered before /api/bookings/:id in both entrypoints', () => {
  // Express matches in order, so a later "/mine" would be swallowed by the
  // ":id" route as a booking id of "mine" — the endpoint would 404 forever.
  // Match the registration calls themselves: the explanatory comments above
  // them mention both paths, so a bare indexOf measures the prose, not the
  // route table.
  const routeAt = (source: string, path: string): number =>
    new RegExp(`app\\.get\\(\\s*["'\`]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`).exec(source)?.index ?? -1;

  for (const file of ['server.ts', 'api/index.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const mine = routeAt(source, '/api/bookings/mine');
    const byId = routeAt(source, '/api/bookings/:id');
    assert.ok(mine > -1, `${file} must register /api/bookings/mine`);
    assert.ok(byId > -1, `${file} must register /api/bookings/:id`);
    assert.ok(mine < byId, `${file}: /api/bookings/mine must come before /api/bookings/:id`);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bookings/mine/:id — the detail page
// ---------------------------------------------------------------------------

/**
 * Chainable stand-in for the Supabase client, good enough for the read-only
 * `.from(t).select(c).eq(k,v).maybeSingle()` chains the detail handler makes.
 */
function makeDetailDb(script: Record<string, any>) {
  const seen: string[] = [];
  const db: any = {
    from(table: string) {
      const api: any = {
        select: () => api,
        eq: () => api,
        in: () => {
          seen.push(table);
          return Promise.resolve(script[table] ?? { data: [], error: null });
        },
        maybeSingle: () => {
          seen.push(table);
          return Promise.resolve(script[table] ?? { data: null, error: null });
        },
      };
      return api;
    },
  };
  return { db, seen };
}

const LIVE_BOOKING = booking({
  owner_id: OWNER,
  user_id: ME,
  status: 'completed',
  customer_phone: '+919876543210',
  notes: 'Sensitive scalp',
  metadata: {
    stylist_name: 'Ananya',
    salon_name: 'Luxe Salon',
    service_addons: [{ name: 'Head Massage', price: 300 }],
  },
});

test('the detail endpoint returns the booking to the customer who made it', async () => {
  const { deps } = makeDeps({ rows: [LIVE_BOOKING] });
  const handler = createMyBookingDetailHandler(deps);
  const res = makeRes();
  await handler({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.booking.id, BOOKING_ID);
  assert.equal(res.body.data.booking.notes, 'Sensitive scalp');
});

test('the detail endpoint requires a verified caller', async () => {
  const { deps } = makeDeps({
    rows: [LIVE_BOOKING],
    deps: {
      authenticateUser: async () => ({
        ok: false,
        status: 401,
        code: 'auth_required',
        error: 'Please sign in.',
      }),
    },
  });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'auth_required');
  // Nothing about the booking is disclosed on the failure path.
  assert.equal(res.body.data, undefined);
});

test('another customer cannot read a booking, and is not told it exists', async () => {
  const { deps } = makeDeps({
    rows: [booking({ user_id: OTHER })],
    deps: { authenticateUser: async () => ({ ok: true, user: { id: ME } }) },
  });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'not_found');
});

test('a missing booking id is a bad request', async () => {
  const { deps } = makeDeps({ rows: [LIVE_BOOKING] });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_request');
});

test('the detail endpoint attaches the salon contact details', async () => {
  const { db, seen } = makeDetailDb({
    bookings: { data: LIVE_BOOKING, error: null },
    profiles: {
      data: {
        id: OWNER,
        salon_name: 'Luxe Salon Andheri',
        logo_url: 'https://cdn/logo.png',
        city: 'Mumbai',
        currency: '₹',
        full_address: 'Linking Road',
        address_line2: 'Bandra West',
        landmark: 'Opposite National College',
        phone_number: '+91 98765 43210',
        whatsapp: '+91 98765 43210',
        latitude: 19.1197,
        longitude: 72.8464,
      },
      error: null,
    },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.salon.name, 'Luxe Salon Andheri');
  assert.equal(
    res.body.data.salon.address,
    'Linking Road, Bandra West, Opposite National College, Mumbai'
  );
  assert.equal(res.body.data.salon.phone, '+91 98765 43210');
  assert.equal(res.body.data.salon.latitude, 19.1197);
  assert.ok(seen.includes('profiles'));
});

test('the customer own tier multiplier is used, not a flat base tier', async () => {
  const { db } = makeDetailDb({
    bookings: { data: LIVE_BOOKING, error: null },
    profiles: { data: null, error: null },
    loyalty_config: {
      data: {
        program_enabled: true,
        points_per_visit: 50,
        points_per_hundred_spent: 10,
        tier_multipliers: { bronze: 1, silver: 1.25, gold: 1.5, platinum: 2 },
      },
      error: null,
    },
    clients: { data: [{ loyalty_tier: 'gold', lifetime_points: 900, phone: '9876543210' }], error: null },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.loyalty.tier, 'gold');
  assert.equal(res.body.data.loyalty.tierMultiplier, 1.5);
  assert.equal(res.body.data.loyalty.pointsPerVisit, 50);
  assert.equal(res.body.data.loyaltyUnavailable, false);
});

test('a salon with no loyalty programme is reported as having none', async () => {
  const { db } = makeDetailDb({
    bookings: { data: LIVE_BOOKING, error: null },
    loyalty_config: { data: null, error: null },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.body.data.loyalty, null);
  // Not an outage — the page may say "no rewards at this salon".
  assert.equal(res.body.data.loyaltyUnavailable, false);
});

test('a failed loyalty lookup is reported as unavailable, never as "no rewards"', async () => {
  // A database blip must not tell a customer their salon has no programme.
  const { db } = makeDetailDb({
    bookings: { data: LIVE_BOOKING, error: null },
    loyalty_config: { data: null, error: { message: 'connection reset' } },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.statusCode, 200, 'the page still loads without the reward line');
  assert.equal(res.body.data.loyalty, null);
  assert.equal(res.body.data.loyaltyUnavailable, true);
});

test('a disabled loyalty programme is reported as disabled', async () => {
  const { db } = makeDetailDb({
    bookings: { data: LIVE_BOOKING, error: null },
    loyalty_config: {
      data: { program_enabled: false, points_per_visit: 50, points_per_hundred_spent: 10 },
      error: null,
    },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.body.data.loyalty.programEnabled, false);
  assert.equal(res.body.data.loyaltyUnavailable, false);
});

test('/api/bookings/mine/:id is registered before /api/bookings/:id in both entrypoints', () => {
  // Same failure mode as the list route: Express would match
  // /api/bookings/mine/<uuid> against the unauthenticated guest endpoint, which
  // returns the raw row — phone, email and payment reference — to anyone.
  const routeAt = (source: string, path: string): number =>
    new RegExp(`app\\.get\\(\\s*["'\`]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`).exec(source)
      ?.index ?? -1;

  for (const file of ['server.ts', 'api/index.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const mine = routeAt(source, '/api/bookings/mine/:id');
    const byId = routeAt(source, '/api/bookings/:id');
    assert.ok(mine > -1, `${file} must register /api/bookings/mine/:id`);
    assert.ok(byId > -1, `${file} must register /api/bookings/:id`);
    assert.ok(mine < byId, `${file}: /api/bookings/mine/:id must come before /api/bookings/:id`);
  }
});

test('an ambiguous phone match keeps the base tier rather than guessing', async () => {
  // Two clients on the same number could be on different tiers; picking one
  // would promise points the salon may not owe.
  const { db } = makeDetailDb({
    bookings: { data: LIVE_BOOKING, error: null },
    loyalty_config: {
      data: {
        program_enabled: true,
        points_per_visit: 50,
        points_per_hundred_spent: 10,
        tier_multipliers: { bronze: 1, gold: 1.5 },
      },
      error: null,
    },
    clients: {
      data: [
        { loyalty_tier: 'gold', phone: '9876543210' },
        { loyalty_tier: 'bronze', phone: '+919876543210' },
      ],
      error: null,
    },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.body.data.loyalty.tier, 'bronze');
  assert.equal(res.body.data.loyalty.tierMultiplier, 1);
});

test('a booking with no usable mobile number is not used to look up a tier', async () => {
  const { db, seen } = makeDetailDb({
    bookings: { data: booking({ ...LIVE_BOOKING, customer_phone: '12345' }), error: null },
    loyalty_config: {
      data: { program_enabled: true, points_per_visit: 50, points_per_hundred_spent: 10 },
      error: null,
    },
    clients: { data: [{ loyalty_tier: 'platinum' }], error: null },
  });
  const { deps } = makeDeps({ deps: { isMock: false, db } });
  const res = makeRes();
  await createMyBookingDetailHandler(deps)({ params: { id: BOOKING_ID } }, res);
  assert.equal(res.body.data.loyalty.tier, 'bronze');
  assert.ok(!seen.includes('clients'), 'no client lookup for an unusable number');
});

test('normalized schema retries with the verified customer id after missing user_id', async () => {
  const seen: any[] = [];
  let column = '';
  const chain: any = {
    select: () => chain,
    eq: (name: string, value: string) => { column = name; seen.push({ column: name, value }); return chain; },
    order: () => chain,
    limit: async () => column === 'user_id'
      ? { data: null, error: { code: '42703', message: 'column bookings.user_id does not exist' } }
      : { data: [{ id: BOOKING_ID, customer_user_id: ME }], error: null },
  };
  const { deps } = makeDeps({ deps: { isMock: false, hasAdminClient: true, db: { from: () => chain } } });
  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: { user_id: OTHER } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].customer_user_id, ME);
  assert.deepEqual(seen, [{ column: 'user_id', value: ME }, { column: 'customer_user_id', value: ME }]);
});

test('normalized customer ownership cannot be overridden by legacy metadata', () => {
  assert.equal(bookingBelongsTo({ customer_user_id: ME }, ME), true);
  assert.equal(bookingBelongsTo({ customer_user_id: OTHER, user_id: ME, metadata: { user_id: ME } }, ME), false);
});

test('unrelated schema errors do not trigger a customer-column retry', async () => {
  let calls = 0;
  const chain: any = { select: () => chain, eq: () => chain, order: () => chain,
    limit: async () => { calls++; return { data: null, error: { code: '42703', message: 'column bookings.created_at does not exist' } }; } };
  const { deps } = makeDeps({ deps: { isMock: false, hasAdminClient: true, db: { from: () => chain } } });
  const res = makeRes();
  await createMyBookingsListHandler(deps as any)({ query: {} }, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 503);
});
