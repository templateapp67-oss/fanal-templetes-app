// ============================================================================
// Regression tests for the three customer-app bugs found in the 2026-10-04
// gap audit. Each block names the bug it locks down, because all three looked
// like "the feature exists" from the outside:
//
//   BUG 1 — the Discover "Gender / service type" filter emptied the list.
//           `serviceGenders` was built as `menu.map(s => s.gender || 'All
//           genders')`, but nothing upstream ever set `gender`, so every salon
//           claimed ['All genders'] and picking "Women" matched nothing. The
//           client-side fallback had the same default, so the list went to zero
//           instead of narrowing.
//
//   BUG 2 — the salon page's Packages tab always said "No packages published".
//           Packages were resolved with a strict all-ids-must-match rule and no
//           diagnostics, and the legacy `profiles` path never emitted packages
//           at all.
//
//   BUG 3 — the in-app Data panel (and /api/customer/connection) described the
//           normalized catalogue — `salons`, `staff`, `salon_hours` — as tables
//           that do not exist, because src/lib/customer/schema.ts still claimed
//           "a salon is an owner profile row".
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SERVICE_GENDERS,
  normalizeServiceGender,
  salonMatchesGender,
  serviceGendersOf,
} from '../src/lib/serviceGender';
import { buildCatalogPackages } from '../server/catalogPackages';
import { catalogId } from '../server/normalizedBookingCreate';
import { readNormalizedSalonDirectory } from '../server/customerSalonDirectory';
import { createSalonDetailHandler, createSalonListHandler } from '../server/customerRoutes';
import { CUSTOMER_SCHEMA_GAPS, PHYSICAL_TABLES, RLS_REALITY, entityMap } from '../src/lib/customer/schema';

// ---------------------------------------------------------------------------
// Harness (same shape as tests/customerRoutes.test.ts: a thenable PostgREST
// builder, because the handlers await `deps.db.from(t).select()…` through runDb)
// ---------------------------------------------------------------------------

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    locals: {},
    req: { headers: {}, user: undefined },
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

function fakeDb(rows: Record<string, any[]>) {
  const db: any = { from: (table: string) => makeTable(table) };

  function makeTable(table: string) {
    let working = rows[table] ? [...rows[table]] : [];
    let single: 'none' | 'maybe' | 'exact' = 'none';
    const apply = (column: string, test: (value: any) => boolean) => {
      working = working.filter((row) => test(row?.[column]));
    };
    const self: any = {
      select: () => self,
      eq: (column: string, value: any) => (apply(column, (actual) => String(actual) === String(value)), self),
      neq: (column: string, value: any) => (apply(column, (actual) => String(actual) !== String(value)), self),
      in: (column: string, values: any[]) => (apply(column, (actual) => values.map(String).includes(String(actual))), self),
      ilike: (column: string, value: any) => (
        apply(column, (actual) => String(actual ?? '').toLowerCase().includes(String(value).replace(/%/g, '').toLowerCase())),
        self
      ),
      // `.not(col,'is',null)` in this app always means "column is present".
      not: (column: string) => (apply(column, (actual) => actual !== null && actual !== undefined), self),
      is: (column: string, value: any) => (apply(column, (actual) => (actual ?? null) === value), self),
      // Discovery's booking-trend lookup chains `.gte('booking_date', sinceIso)`;
      // without it the stub throws inside the builder and the whole catalogue
      // fact pass degrades to "no services", which is not what is under test.
      gte: (column: string, value: any) => (apply(column, (actual) => String(actual ?? '') >= String(value)), self),
      or: () => self,
      order: () => self,
      limit: (count: number) => ((working = working.slice(0, count)), self),
      maybeSingle: () => ((single = 'maybe'), self),
      single: () => ((single = 'exact'), self),
      then: (resolve: any) =>
        Promise.resolve(
          single === 'none'
            ? { data: working, error: null }
            : { data: working[0] ?? null, error: working[0] ? null : { code: 'PGRST116', message: 'no rows' } },
        ).then(resolve),
    };
    return self;
  }
  return db;
}

function makeDeps(db: any) {
  return {
    db,
    isMock: false,
    hasAdminClient: true,
    authenticateUser: async () => ({ ok: true, user: { id: 'customer-1', email: 'me@example.com' } }),
    resolveOwnerEmail: async () => 'owner@salon.com',
    now: () => Date.UTC(2026, 9, 4, 12, 0, 0),
    discoveryLimit: 24,
  } as any;
}

// ---------------------------------------------------------------------------
// BUG 1 — the gender vocabulary and its matching rule
// ---------------------------------------------------------------------------

test('gender values are normalized to one vocabulary, and junk becomes "no tag"', () => {
  assert.deepEqual([...SERVICE_GENDERS], ['All genders', 'Women', 'Men', 'Kids']);
  assert.equal(normalizeServiceGender('women'), 'Women');
  assert.equal(normalizeServiceGender(' Unisex '), 'All genders', 'a free-text spelling still means unisex');
  assert.equal(normalizeServiceGender('Ladies'), 'Women');
  assert.equal(normalizeServiceGender(undefined), undefined, 'a missing column is "not published", never "All genders"');
  assert.equal(normalizeServiceGender(''), undefined);
  assert.equal(normalizeServiceGender('Unicorns'), undefined, 'an unknown value must not widen the audience');
});

test('a salon with no published gender tags matches every request (the bug that emptied the list)', () => {
  // This is the exact assertion the old code failed: `serviceGenders` was
  // undefined/[] for every salon, and the screen defaulted it to
  // ['All genders'], so "Women" matched nothing.
  for (const wanted of SERVICE_GENDERS) {
    assert.equal(salonMatchesGender([], wanted), true, `no tags → ${wanted} still matches`);
    assert.equal(salonMatchesGender(undefined, wanted), true, `undefined → ${wanted} still matches`);
  }
  assert.equal(salonMatchesGender(['Women'], ''), true, 'no request → no filtering');
  assert.equal(salonMatchesGender(['Women'], 'nonsense'), true, 'a junk query value must not filter');
});

test('a salon that does publish tags is narrowed by them', () => {
  assert.equal(salonMatchesGender(['Women'], 'Women'), true);
  assert.equal(salonMatchesGender(['Women'], 'Men'), false, 'a women-only salon is not a men-only result');
  assert.equal(salonMatchesGender(['All genders', 'Kids'], 'Men'), true, 'a unisex service serves everyone');
  assert.equal(salonMatchesGender(['Men', 'Kids'], 'Kids'), true);
});

test('serviceGendersOf reports only what is published, in canonical order', () => {
  assert.deepEqual(serviceGendersOf([{ gender: 'Kids' }, { gender: 'Women' }, {}, null]), ['Women', 'Kids']);
  assert.deepEqual(serviceGendersOf([{ gender: 'Women' }, { gender: 'women' }]), ['Women'], 'duplicates collapse');
  assert.deepEqual(serviceGendersOf(undefined), []);
});

// ---------------------------------------------------------------------------
// BUG 2 — packages resolve against the live menu, and say why when they cannot
// ---------------------------------------------------------------------------

const SALON_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const menu = [
  { id: catalogId(SALON_ID, 'service', 'cut'), name: 'Haircut', price: 400, durationMinutes: 30, category: 'Hair', gender: 'Men' },
  { id: catalogId(SALON_ID, 'service', 'spa'), name: 'Head spa', price: 900, durationMinutes: 45, category: 'Spa', gender: 'Women' },
];

test('editor-local package service ids resolve to the live catalogue rows', () => {
  // The owner's editor stores `serviceIds: ['cut','spa']`; the published rows are
  // `nexora_catalog_uuid(salon,'service',editorId)`. Nothing used to bridge the
  // two on this path, so every package was dropped.
  const result = buildCatalogPackages(
    [{ id: 'pkg-duo', name: 'Groom & Glow', description: 'Two essentials', serviceIds: ['cut', 'spa'], isActive: true }],
    menu as any,
    SALON_ID,
  );
  assert.equal(result.packages.length, 1, JSON.stringify(result.notes));
  assert.deepEqual(result.notes, [], 'a package that fully resolves produces no warning');
  const pkg = result.packages[0];
  assert.deepEqual(pkg.serviceIds, [menu[0].id, menu[1].id], 'real services.id values — bookable');
  assert.equal(pkg.price, 1300, 'the price is the sum of the live services, not the editor number');
  assert.equal(pkg.durationMinutes, 75);
  assert.deepEqual(pkg.items.map((item) => item.name), ['Haircut', 'Head spa'], 'the card can list what is included');
});

test('uuid service ids pass through unchanged', () => {
  const result = buildCatalogPackages(
    [{ id: 'p', name: 'Solo', description: '', serviceIds: [menu[0].id], isActive: true }],
    menu as any,
    SALON_ID,
  );
  assert.deepEqual(result.packages[0].serviceIds, [menu[0].id]);
});

test('a package whose services all vanished is dropped WITH an explanation', () => {
  const result = buildCatalogPackages(
    [{ id: 'p', name: 'Retired ritual', description: '', serviceIds: ['deleted-service'], isActive: true }],
    menu as any,
    SALON_ID,
  );
  assert.deepEqual(result.packages, [], 'booking it would fail at the API, so it is not offered');
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /Retired ritual/);
  assert.match(result.notes[0], /not in this salon's live menu/, 'the note says why, and what to do');
});

test('a partially broken package survives with the live subset, and says so', () => {
  // The old strict resolver dropped the whole package when ONE id missed, so a
  // renamed service silently deleted a bundle the salon was advertising.
  const result = buildCatalogPackages(
    [{ id: 'p', name: 'Duo', description: '', serviceIds: ['cut', 'gone-service'], isActive: true }],
    menu as any,
    SALON_ID,
  );
  assert.equal(result.packages.length, 1);
  assert.deepEqual(result.packages[0].serviceIds, [menu[0].id]);
  assert.equal(result.packages[0].price, 400, 'priced from what is actually bookable');
  assert.deepEqual(result.packages[0].unresolvedIds, [catalogId(SALON_ID, 'service', 'gone-service')]);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /1 of 2 services/);
});

test('inactive packages and empty selections never reach the customer', () => {
  const result = buildCatalogPackages(
    [
      { id: 'off', name: 'Turned off', description: '', serviceIds: ['cut'], isActive: false },
      { id: 'empty', name: 'No services', description: '', serviceIds: [], isActive: true },
    ],
    menu as any,
    SALON_ID,
  );
  assert.deepEqual(result.packages, []);
  assert.equal(result.notes.length, 1, 'the empty one is reported; the inactive one is simply not published');
  assert.match(result.notes[0], /No services/);
});

// ---------------------------------------------------------------------------
// BUG 1 + 2 on the normalized catalogue path (salons/services/staff/salon_hours)
// ---------------------------------------------------------------------------

function normalizedTables() {
  return {
    salons: [
      {
        id: SALON_ID,
        slug: 'mens-room',
        name: "Men's Room",
        is_active: true,
        is_listed: true,
        is_verified: true,
        area: 'Niwaru Road',
        timezone: 'Asia/Kolkata',
        data: {
          editor_profile: {
            city: 'Jaipur',
            packages: [
              { id: 'pkg-1', name: 'Beard & Cut', description: 'Weekly upkeep', serviceIds: ['cut'], isActive: true },
              { id: 'pkg-2', name: 'Ghost bundle', description: '', serviceIds: ['deleted'], isActive: true },
            ],
          },
          editor_services: [
            { id: 'cut', name: 'Haircut', price: 400, durationMinutes: 30, category: 'Hair', gender: 'Men' },
            { id: 'spa', name: 'Head spa', price: 900, durationMinutes: 45, category: 'Spa', gender: 'Women' },
          ],
        },
      },
      {
        id: 'bbbbbbbb-0000-4000-8000-000000000002',
        slug: 'unisex-studio',
        name: 'Unisex Studio',
        is_active: true,
        is_listed: true,
        is_verified: false,
        timezone: 'Asia/Kolkata',
        data: { editor_profile: { city: 'Jaipur' } },
      },
    ],
    services: [
      { id: menu[0].id, salon_id: SALON_ID, name: 'Haircut', price_paise: 40000, duration_minutes: 30, category: 'Hair', is_active: true, is_bookable_online: true },
      { id: menu[1].id, salon_id: SALON_ID, name: 'Head spa', price_paise: 90000, duration_minutes: 45, category: 'Spa', is_active: true, is_bookable_online: true },
      { id: 'cccccccc-0000-4000-8000-000000000003', salon_id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Cut & blow', price_paise: 60000, duration_minutes: 40, category: 'Hair', is_active: true, is_bookable_online: true },
    ],
    staff: [],
    bookings: [],
    salon_hours: [],
  };
}

test('the normalized directory publishes real gender tags instead of defaulting everything to unisex', async () => {
  const salons = await readNormalizedSalonDirectory(fakeDb(normalizedTables()), {}, 'mens-room');
  const salon = (salons || [])[0];
  assert.ok(salon, 'the salon page resolves');
  assert.deepEqual(salon.serviceGenders, ['Women', 'Men'], 'both tags come from the published editor payload');
  assert.equal(salon.publishedServices?.[0].gender, 'Men', 'the service list carries the tag too');
});

test('the normalized directory resolves packages and reports the one it cannot show', async () => {
  const salons = await readNormalizedSalonDirectory(fakeDb(normalizedTables()), {}, 'mens-room');
  const salon = (salons || [])[0];
  assert.equal(salon.packages?.length, 1, 'the bookable package survives');
  assert.equal(salon.packages?.[0].name, 'Beard & Cut');
  assert.equal(salon.packages?.[0].price, 400, 'priced from services.price_paise, the amount the API will charge');
  assert.deepEqual(salon.packages?.[0].serviceIds, [menu[0].id]);
  assert.equal(salon.packageNotes?.length, 1);
  assert.match(salon.packageNotes?.[0] || '', /Ghost bundle/);
});

test('discovery filters by gender server-side, and never wipes untagged salons', async () => {
  const tables = normalizedTables();
  const women = await readNormalizedSalonDirectory(fakeDb(tables), { gender: 'Women' });
  assert.deepEqual((women || []).map((salon) => salon.name), ["Men's Room", 'Unisex Studio'],
    "the salon publishing a Women service matches, and the salon with no tags is not hidden");

  const men = await readNormalizedSalonDirectory(fakeDb(tables), { gender: 'Men' });
  assert.deepEqual((men || []).map((salon) => salon.name), ["Men's Room", 'Unisex Studio']);

  const junk = await readNormalizedSalonDirectory(fakeDb(tables), { gender: 'Unicorns' });
  assert.equal((junk || []).length, 2, 'a junk value is "no filter", not "no results"');
});

// ---------------------------------------------------------------------------
// BUG 1 + 2 on the legacy `profiles` path (the fallback most deployments hit)
// ---------------------------------------------------------------------------

const LEGACY_SALON = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

function legacyTables() {
  // The legacy path keys `services` by `owner_id`, and a package's `serviceIds`
  // only resolve against rows that actually exist — so the fixture has to carry
  // the menu row the package points at, exactly like a real deployment.
  const bridalServiceId = catalogId(LEGACY_SALON, 'service', 'bridal-makeup');
  return {
    // No `salons` rows at all → readNormalizedSalonDirectory returns null and
    // the handler falls back to `profiles`.
    salons: [],
    services: [
      {
        id: bridalServiceId,
        owner_id: LEGACY_SALON,
        name: 'Bridal makeup',
        category: 'Bridal',
        price: 5000,
        duration_minutes: 120,
        is_active: true,
      },
    ],
    staff: [],
    salon_hours: [],
    bookings: [],
    profiles: [
      {
        id: LEGACY_SALON,
        salon_name: 'Legacy Studio',
        subdomain: 'legacy',
        business_type: 'unisex_salons',
        city: 'Jaipur',
        area: 'Vaishali Nagar',
        full_address: '12 Main Road',
        working_hours: null,
        data: {
          editor_profile: {
            city: 'Jaipur',
            packages: [{ id: 'pkg-legacy', name: 'Bridal bundle', description: 'Full day', serviceIds: ['bridal-makeup'], isActive: true }],
          },
          editor_services: [{ id: 'bridal-makeup', name: 'Bridal makeup', price: 5000, durationMinutes: 120, category: 'Bridal', gender: 'Women' }],
        },
      },
    ],
  };
}

test('the legacy path resolves packages from profiles.data instead of showing an empty tab', async () => {
  const res = makeRes();
  await createSalonDetailHandler(makeDeps(fakeDb(legacyTables())))({ params: { idOrSubdomain: 'legacy' }, query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const salon = res.body.data;
  assert.ok(salon, 'the salon page resolves on the legacy path');
  assert.equal(salon.name, 'Legacy Studio');
  assert.equal(salon.packages?.length, 1, 'BUG 2 on the legacy path: packages used to be absent entirely');
  assert.equal(salon.packages?.[0].name, 'Bridal bundle');
  assert.equal(salon.packages?.[0].price, 5000, 'the live service price, not a typed-in number');
  assert.deepEqual(salon.serviceGenders, ['Women'], 'BUG 1 on the legacy path: the tag comes from the published editor payload');
  assert.equal(salon.area, 'Vaishali Nagar');
});

test('legacy discovery filters by gender and echoes the filter it applied', async () => {
  const deps = makeDeps(fakeDb(legacyTables()));

  const women = makeRes();
  await createSalonListHandler(deps)({ query: { gender: 'Women' }, params: {}, headers: {} }, women);
  assert.equal(women.statusCode, 200, JSON.stringify(women.body));
  assert.equal(women.body.data.length, 1, 'the salon publishes a Women service');
  assert.equal(women.body.filtersApplied.gender, 'Women', 'the response says what was applied');

  const junk = makeRes();
  await createSalonListHandler(deps)({ query: { gender: 'Unicorns' }, params: {}, headers: {} }, junk);
  assert.equal(junk.body.filtersApplied.gender, null, 'a value outside the vocabulary is not a filter');
  assert.equal(junk.body.data.length, 1, 'and it must not empty the list');
});

test('legacy discovery searches the locality, which is how customers name a place', async () => {
  const deps = makeDeps(fakeDb(legacyTables()));
  const res = makeRes();
  await createSalonListHandler(deps)({ query: { q: 'Vaishali' }, params: {}, headers: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.length, 1, '`profiles.area` is part of the search term now');
});

// ---------------------------------------------------------------------------
// BUG 3 — the schema map the Data panel renders must describe reality
// ---------------------------------------------------------------------------

test('the normalized catalogue tables are declared, so the Data panel stops reporting them missing', () => {
  for (const table of ['salons', 'staff', 'salon_hours']) {
    assert.ok((PHYSICAL_TABLES as readonly string[]).includes(table), `${table} exists in the migrations and is read by the customer API`);
  }
});

test('the salons entity names both read paths instead of claiming a salon is only a profiles row', () => {
  const salons = entityMap('salons');
  assert.ok(salons);
  assert.equal(salons.kind, 'derived', 'which table answers depends on the deployment, so no single one owns it');
  assert.equal(salons.table, null);
  assert.ok(salons.tables.includes('salons') && salons.tables.includes('profiles'), 'both catalogues are named');
  assert.match(salons.note, /normalizedCatalogue/, 'the response field that tells the two apart is documented');
  assert.ok(
    CUSTOMER_SCHEMA_GAPS.some((gap) => gap.logical === 'salons' && /two catalogues|normalized/i.test(gap.why)),
    'the gap list explains the dual path rather than the old "there is no salons table"',
  );
});

test('the QR table is described as existing-but-unused, not as absent', () => {
  const gap = CUSTOMER_SCHEMA_GAPS.find((entry) => entry.logical === 'customer_qr_payments');
  assert.ok(gap);
  assert.match(gap.why, /EXISTS/i, '20260908_complete_rewards_qr_referrals_backend.sql:438 creates it');
  assert.match(gap.why, /loyalty_point_transactions/, 'and the ledger is still what the code writes');
});

test('the RLS record separates owner-scoped tables from the public catalogue', () => {
  assert.deepEqual(RLS_REALITY.publicRead, ['salons', 'services', 'staff', 'salon_hours']);
  assert.ok(RLS_REALITY.ownerScoped.includes('stylists'), 'the legacy staff table is still owner-scoped');
  assert.equal(RLS_REALITY.customerScoped.length, 0, 'no customer-facing policy was added by this change');
});
