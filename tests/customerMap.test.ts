// =============================================================================
// The Customer App data map, as a test.
//
// The diagram below is the contract this app was built against — the same tree
// that appears in the task brief. Everything in it is asserted mechanically:
// every node has an entry in CUSTOMER_SCHEMA_MAP with a registered endpoint,
// every endpoint is called by the client, every screen-reachable entity is
// rendered somewhere, and every edge is backed by the query or mapper that is
// supposed to implement it. If someone later deletes the review join or stops
// filtering bookings by `user_id`, this file fails instead of the app quietly
// showing another salon's data.
//
// The diagram is parsed, not hand-transcribed into assertions, so editing the
// tree edits the checks.
// =============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CUSTOMER_SCHEMA_MAP,
  CUSTOMER_SCHEMA_GAPS,
  PHYSICAL_TABLES,
} from '../src/lib/customer/schema.ts';

const DIAGRAM = `
AUTH USER
   ↓
PROFILES
   ↓
CUSTOMER

SALONS
   ├── SALON_SERVICES
   ├── SALON_STAFF
   │      └── STAFF_SLOTS
   │
   ├── OFFERS
   ├── REVIEWS
   └── BOOKINGS
           ├── STAFF
           └── BOOKING_SERVICES
                    └── SALON_SERVICES

CUSTOMER
   ├── BOOKINGS
   ├── FAVOURITES
   ├── REVIEWS
   ├── REWARD_WALLET
   ├── REWARD_TRANSACTIONS
   ├── MEMBERSHIPS
   ├── REFERRALS
   ├── NOTIFICATIONS
   ├── SEARCH_HISTORY
   └── QR_PAYMENTS
`;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const serverSource = read('server', 'customerRoutes.ts');
const apiSource = read('src', 'lib', 'customer', 'api.ts');
const mapperSource = read('src', 'lib', 'customer', 'mappers.ts');
const deviceSource = read('src', 'lib', 'customer', 'deviceStore.ts');
const screensSource = ['Auth', 'Discover', 'Book', 'Bookings', 'Rewards', 'Activity', 'Me', 'Settings']
  .map((name) => read('src', 'customer', 'screens', `${name}.tsx`))
  .join('\n');

type ParsedNode = { name: string; parent: string | null };

/**
 * Read the ASCII tree: `↓` links roots to each other, `├──`/`└──` children
 * attach to the nearest preceding line whose branch marker sits further left.
 */
function parseDiagram(text: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  const stack: Array<{ index: number; name: string }> = [];
  let previousRoot: string | null = null;
  let pendingArrow = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.trim() === '↓') {
      pendingArrow = true;
      continue;
    }
    const branch = /(├──|└──)\s*([A-Z_ ]+)$/.exec(line);
    if (branch) {
      const index = line.indexOf(branch[1]);
      while (stack.length && stack[stack.length - 1].index >= index) stack.pop();
      const name = branch[2].trim();
      nodes.push({ name, parent: stack.length ? stack[stack.length - 1].name : null });
      stack.push({ index, name });
      continue;
    }
    // A line with no branch marker is a root of its own tree.
    const name = line.trim();
    if (!/^[A-Z][A-Z_ ]*$/.test(name)) continue;
    nodes.push({ name, parent: pendingArrow ? previousRoot : null });
    if (pendingArrow && previousRoot) {
      // Already recorded as a child of the previous root; roots stay flat.
    }
    previousRoot = name;
    pendingArrow = false;
    // The root owns its tree: an index of -1 means every branch marker in the
    // block below it is deeper, so children attach to the root instead of to
    // nothing (which is how a whole subtree silently loses its parent).
    stack.length = 0;
    stack.push({ index: -1, name });
  }
  return nodes;
}

const nodes = parseDiagram(DIAGRAM);
const edges = nodes.filter((node) => node.parent).map((node) => ({ from: node.parent!, to: node.name }));
const uniqueNames = [...new Set(nodes.map((node) => node.name))];

/** Node label in the diagram → `logical` in CUSTOMER_SCHEMA_MAP. */
const NODE_TO_LOGICAL: Record<string, string> = {
  'AUTH USER': 'profiles',
  PROFILES: 'profiles',
  CUSTOMER: 'profiles',
  SALONS: 'salons',
  SALON_SERVICES: 'salon_services',
  SALON_STAFF: 'salon_staff',
  STAFF: 'salon_staff',
  STAFF_SLOTS: 'staff_slots',
  OFFERS: 'offers',
  REVIEWS: 'reviews',
  BOOKINGS: 'bookings',
  BOOKING_SERVICES: 'booking_services',
  FAVOURITES: 'favourites',
  REWARD_WALLET: 'reward_wallets',
  REWARD_TRANSACTIONS: 'reward_transactions',
  MEMBERSHIPS: 'memberships',
  REFERRALS: 'referrals',
  NOTIFICATIONS: 'notifications',
  SEARCH_HISTORY: 'search_history',
  QR_PAYMENTS: 'customer_qr_payments',
};

/**
 * The query or function that makes each edge real. Grepped from the source it
 * lives in, because "the handler selects the table and filters it by owner" is
 * exactly the kind of thing that disappears in a refactor and leaves a screen
 * rendering the wrong salon's rows.
 */
const EDGE_EVIDENCE: Record<string, { file: 'server' | 'mappers' | 'device'; contains: string[] }> = {
  'AUTH USER→PROFILES': { file: 'server', contains: ['.eq(\'id\', user.id)'] },
  'PROFILES→CUSTOMER': { file: 'server', contains: ['toCustomerProfile'] },
  'SALONS→SALON_SERVICES': { file: 'server', contains: ["from('services')", ".eq('owner_id'"] },
  'SALONS→SALON_STAFF': { file: 'server', contains: ["from('stylists')", "neq('status', 'Inactive')"] },
  'SALON_STAFF→STAFF_SLOTS': { file: 'server', contains: ['schedule', 'buildSlotGrid'] },
  'SALONS→OFFERS': { file: 'server', contains: ["from('loyalty_rewards')"] },
  'SALONS→REVIEWS': { file: 'server', contains: ['review_rating'] },
  'SALONS→BOOKINGS': { file: 'server', contains: ["from('bookings')", "eq('owner_id'"] },
  'BOOKINGS→STAFF': { file: 'server', contains: ['staff_id', "from('stylists')"] },
  'BOOKINGS→BOOKING_SERVICES': { file: 'server', contains: ['serviceLines', 'services'] },
  'BOOKING_SERVICES→SALON_SERVICES': { file: 'mappers', contains: ['toBookingServiceLines', 'serviceId'] },
  'CUSTOMER→BOOKINGS': { file: 'server', contains: ["from('bookings')", ".eq('user_id', user.id)"] },
  'CUSTOMER→FAVOURITES': { file: 'server', contains: ['createFavouritesHandler', 'deriveFavourites'] },
  'CUSTOMER→REVIEWS': { file: 'server', contains: ['createReviewWriteHandler'] },
  'CUSTOMER→REWARD_WALLET': { file: 'server', contains: ["from('clients')"] },
  'CUSTOMER→REWARD_TRANSACTIONS': { file: 'server', contains: ["from('loyalty_point_transactions')"] },
  'CUSTOMER→MEMBERSHIPS': { file: 'server', contains: ['loadLoyaltyConfigs', 'toMembership', 'programEnabled'] },
  'CUSTOMER→REFERRALS': { file: 'server', contains: ['referral_code'] },
  'CUSTOMER→NOTIFICATIONS': { file: 'server', contains: ["from('in_app_notifications')"] },
  'CUSTOMER→SEARCH_HISTORY': { file: 'device', contains: ['readSearchHistory', 'pushSearchHistory'] },
  'CUSTOMER→QR_PAYMENTS': { file: 'server', contains: ['createQrConfirmHandler', 'createQrVerifyHandler'] },
};

test('the diagram parses into the whole data map, nothing lost in translation', () => {
  assert.deepEqual(uniqueNames.slice().sort(), [
    'AUTH USER',
    'BOOKING_SERVICES',
    'BOOKINGS',
    'CUSTOMER',
    'FAVOURITES',
    'MEMBERSHIPS',
    'NOTIFICATIONS',
    'OFFERS',
    'PROFILES',
    'QR_PAYMENTS',
    'REFERRALS',
    'REWARD_TRANSACTIONS',
    'REWARD_WALLET',
    'REVIEWS',
    'SALON_SERVICES',
    'SALON_STAFF',
    'SALONS',
    'SEARCH_HISTORY',
    'STAFF',
    'STAFF_SLOTS',
  ].sort());
  assert.equal(edges.length, 21, 'every branch and arrow in the tree is an edge under test');
});

test('every node in the diagram has a mapping entry, an endpoint and a table', () => {
  for (const name of uniqueNames) {
    const logical = NODE_TO_LOGICAL[name];
    assert.ok(logical, `${name} is in the diagram but the test does not know what it maps to`);
    const entry = CUSTOMER_SCHEMA_MAP.find((row) => row.logical === logical);
    assert.ok(entry, `${name} → ${logical} is missing from CUSTOMER_SCHEMA_MAP`);
    assert.ok(entry!.endpoint, `${logical} has no endpoint for the app to call`);
    assert.ok(entry!.note, `${logical} has no mapping note`);
    assert.ok(['self', 'public-active'].includes(entry!.readScope), `${logical} has an unknown read scope`);
    for (const table of entry!.tables) {
      assert.ok(
        (PHYSICAL_TABLES as readonly string[]).includes(table),
        `${logical} reads ${table}, which is not a table of this schema`
      );
    }
    if (entry!.kind === 'table' || entry!.kind === 'jsonb') {
      // A jsonb-backed entity DOES name a host table (`reviews` lives on
      // `bookings`), because "which row holds it" is the part a reader needs.
      assert.ok(entry!.table && entry!.tables.includes(entry!.table), `${logical} must name the table that holds it`);
    } else {
      assert.equal(entry!.table, null, `${logical} is ${entry!.kind}; it must not claim a table of its own`);
      assert.ok(
        CUSTOMER_SCHEMA_GAPS.some((gap) => gap.logical === logical),
        `${logical} is ${entry!.kind} and the gap list must say why`
      );
    }
  }
});

test('every endpoint the diagram implies is registered on the server and called by the client', () => {
  // The router keeps its table as `['/api/customer/…', 'get'|'post', handler]`
  // triples, so the registered set can be read straight out of it. Placeholders
  // are normalised because the map writes `{salonId}` and the router writes
  // `:idOrSubdomain` for the same hole — a check that only understood one style
  // reported every nested route as missing and skipped the rest.
  const normalise = (value: string) => value.replace(/\{[^}]+\}/g, '*').replace(/:[A-Za-z0-9_]+/g, '*').replace(/\/+$/, '');
  const registered = new Set(
    [...serverSource.matchAll(/^\s*\['(\/api\/customer[^']+)', '(get|post)'/gm)].map((match) => normalise(match[1]))
  );
  assert.ok(registered.size >= 25, `only ${registered.size} customer routes were read out of the router table — the table changed shape`);

  for (const name of new Set(uniqueNames.map((node) => NODE_TO_LOGICAL[node]))) {
    const entry = CUSTOMER_SCHEMA_MAP.find((row) => row.logical === name)!;
    const path = normalise(entry.endpoint.trim().split(' ').pop() || '');
    assert.ok(registered.has(path), `${name}: ${entry.endpoint} is not in the router table`);
    const fragments = entry.endpoint.split(/\{[^}]+\}/).filter((part) => part.length > 4 && !part.startsWith('/api/customer') === false || part.length > 4);
    for (const fragment of fragments) {
      if (fragment === '/api/customer') continue;
      assert.ok(
        apiSource.includes(fragment),
        `${name}: ${entry.endpoint} is registered but src/lib/customer/api.ts never builds that path`
      );
    }
  }
});

test('every edge of the diagram is backed by the query or mapper that implements it', () => {
  for (const edge of edges) {
    const key = `${edge.from}→${edge.to}`;
    const evidence = EDGE_EVIDENCE[key];
    assert.ok(evidence, `${key} has no recorded implementation — is it built, or forgotten?`);
    const source = evidence.file === 'server' ? serverSource : evidence.file === 'mappers' ? mapperSource : deviceSource;
    for (const needle of evidence.contains) {
      assert.ok(source.includes(needle), `${key}: expected ${evidence.file} to contain "${needle}"`);
    }
  }
});

test('every entity the diagram names reaches a screen, through the client layer', () => {
  // A node is "wired" when a screen calls the api.ts function that reads it.
  const methodForNode: Record<string, string> = {
    SALONS: 'searchSalons',
    SALON_SERVICES: 'listSalonServices',
    SALON_STAFF: 'listSalonStaff',
    STAFF_SLOTS: 'fetchSlotWindow',
    OFFERS: 'listOffers',
    REVIEWS: 'listMyReviews',
    BOOKINGS: 'listMyBookings',
    FAVOURITES: 'listFavourites',
    REWARD_WALLET: 'listMyRewards',
    REWARD_TRANSACTIONS: 'listMyRewards',
    MEMBERSHIPS: 'listMyMemberships',
    REFERRALS: 'listMyReferrals',
    NOTIFICATIONS: 'listMyNotifications',
    SEARCH_HISTORY: 'recordSearch',
    QR_PAYMENTS: 'verifyQrPayment',
    PROFILES: 'getMyProfile',
    CUSTOMER: 'getMyProfile',
  };
  for (const [name, method] of Object.entries(methodForNode)) {
    assert.ok(apiSource.includes(method), `api.ts must expose ${method} for ${name}`);
    const declared = new RegExp(`(export (async )?function ${method}|${method}\\s*[:=(])`).test(apiSource);
    assert.ok(declared, `${method} is not a real export of api.ts`);
    assert.ok(screensSource.includes(method), `${name}: no customer screen calls ${method}`);
  }
  // Auth and booking writes are named explicitly because they are not reads.
  assert.ok(screensSource.includes('signInWith') || screensSource.includes('signUp'), 'no screen performs auth');
  assert.ok(screensSource.includes('createBooking'), 'no screen creates a booking');
  assert.ok(screensSource.includes('saveMyProfile'), 'no screen saves the profile');
});

test('customer-side nodes are scoped to the token, and no edge is fufilable by id guessing', () => {
  const customerSide = ['BOOKINGS', 'FAVOURITES', 'REVIEWS', 'REWARD_WALLET', 'REWARD_TRANSACTIONS', 'MEMBERSHIPS', 'REFERRALS', 'NOTIFICATIONS', 'QR_PAYMENTS'];
  for (const name of customerSide) {
    const entry = CUSTOMER_SCHEMA_MAP.find((row) => row.logical === NODE_TO_LOGICAL[name])!;
    assert.equal(entry.readScope, 'self', `${name} is customer data; readScope must be self`);
  }
  // Salon-owned data is readable but never writable from this app.
  for (const name of ['SALONS', 'SALON_SERVICES', 'SALON_STAFF', 'STAFF_SLOTS', 'OFFERS']) {
    const entry = CUSTOMER_SCHEMA_MAP.find((row) => row.logical === NODE_TO_LOGICAL[name])!;
    assert.notEqual(entry.writeScope, 'self', `${name} belongs to the salon, not the customer`);
  }
});
