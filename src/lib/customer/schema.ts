// ============================================================================
// Nexora SalonOS — Customer App schema map.
//
// WHY THIS FILE EXISTS
// --------------------
// The Customer App is specced against 18 logical tables (`salons`,
// `salon_services`, `staff_slots`, `reward_wallets`, …). This module is the one
// place where that vocabulary is translated to the physical schema, and it is
// rendered to customers verbatim by the Activity → Data panel
// (`src/customer/screens/Activity.tsx`) and by `/api/customer/connection`. So an
// out-of-date entry here is not a stale comment — it is the app telling a
// customer something false about where their data lives.
//
// TWO CATALOGUE PATHS (this is the part that used to be documented wrongly)
// ------------------------------------------------------------------------
// The project originally shipped only the salon-owner schema
// (`supabase/migrations/00001_init.sql`), where a "salon" is a `profiles` row,
// staff live in `stylists`, and loyalty lives in `clients`. Later migrations
// added a real normalized catalogue:
//
//   • `salons`              — 20261002_owner_workspace_provisioning.sql:175,
//                             columns completed by
//                             20261031000000_fix_website_save_and_public_site.sql:56
//   • `services.salon_id`, `price_paise`, `is_bookable_online` — same migration
//   • `staff`, `salon_hours` — used by server/customerSalonDirectory.ts and
//                             server/customerAvailability.ts
//
// Every discovery/detail handler tries the normalized catalogue FIRST
// (`readNormalizedSalonDirectory`) and falls back to the `profiles` path when a
// deployment has no `salons` rows. The two paths are NOT feature-equal:
// packages, service gender tags, `area`, and the published services/staff/
// reviews payload exist only on the normalized path (the legacy path resolves
// packages and gender from `profiles.data.editor_*` on a salon's own page, but
// not for a card list, because discovery never selects that jsonb).
//
// The original build rule — do NOT create, rename or drop tables — still holds
// for this module: nothing here writes schema, it only reports what exists.
//
// KINDS OF MAPPING (this distinction matters when you audit the app):
//   'table'    — a physical table, read/queried directly (possibly a filtered
//                subset of it, e.g. QR payments are `loyalty_point_transactions`
//                rows of type `qr_payment`).
//   'derived'  — computed at request time from real rows (slots from
//                `stylists.schedule` minus taken `bookings`; favourites and
//                referrals from booking history). Nothing invented, nothing
//                mocked: if the underlying rows are empty the result is empty.
//   'jsonb'    — stored inside an existing jsonb column of an existing row
//                (`bookings.metadata`), because the spec'd column/table does
//                not exist and we are not allowed to add one.
//   'device'   — no home in the schema at all. Persisted per signed-in customer
//                on the device and reported as such. These two (favourites
//                mirror, search history) are the ONLY entities that are not
//                fully database-backed, and that is a direct consequence of the
//                no-new-tables rule — see CUSTOMER_SCHEMA_GAPS.
// ============================================================================

export type CustomerMappingKind = 'table' | 'derived' | 'jsonb' | 'device';

/** Who is allowed to write a customer entity, enforced by the API layer. */
export type CustomerWriteScope =
  /** Nobody — active salon catalogue data is read-only for customers. */
  | 'none'
  /** Only the owning salon (never writable from the Customer App). */
  | 'owner-only'
  /** Only the signed-in customer's own rows. */
  | 'self';

export interface CustomerEntityMap {
  /** Logical name used by the Customer App spec. */
  logical: string;
  /** Physical Supabase table this entity reads from, or null if derived. */
  table: string | null;
  /** All physical tables touched by the read path of this entity. */
  tables: string[];
  kind: CustomerMappingKind;
  /** Columns selected from `table` (empty for derived entities). */
  columns: string[];
  /** Filters that make a read customer-scoped or active-only. */
  filters: string[];
  readScope: 'public-active' | 'self';
  writeScope: CustomerWriteScope;
  /** REST route the screen calls. */
  endpoint: string;
  /** Human explanation of the translation (shown by the verify report). */
  note: string;
}

/**
 * The physical tables this app is allowed to touch. Nothing else.
 *
 * The first group is the original owner schema; the second is the normalized
 * catalogue that later migrations added and that every discovery/detail handler
 * now prefers (see the header note). Listing only the first group made the
 * in-app Data panel report the customer app's own primary read path as
 * "does not exist".
 */
export const PHYSICAL_TABLES = [
  'profiles',
  'services',
  'stylists',
  'bookings',
  'appointments',
  'clients',
  'in_app_notifications',
  'loyalty_config',
  'loyalty_rewards',
  'loyalty_point_transactions',
  'loyalty_redeemed_rewards',
  'social_videos',
  'salon_youtube_videos',
  // Normalized catalogue (20261002_owner_workspace_provisioning.sql,
  // 20261031000000_fix_website_save_and_public_site.sql).
  'salons',
  'staff',
  'salon_hours',
] as const;

export type PhysicalTable = (typeof PHYSICAL_TABLES)[number];

/**
 * The customer's own records are keyed by the Supabase auth user id. `bookings`
 * already carries `user_id`, and `bookingMine.ts` proves ownership from the
 * verified token only — every customer endpoint in this app follows that rule.
 */
export const CUSTOMER_ID_COLUMN = 'user_id';

/** A `profiles` row is a salon only when an owner published it. */
export const SALON_DISCOVERY_FILTERS = [
  'salon_name=not.is.null',
  'business_type=not.is.null',
  'subdomain=not.is.null',
];

export const CUSTOMER_SCHEMA_MAP: CustomerEntityMap[] = [
  {
    logical: 'profiles',
    table: 'profiles',
    tables: ['profiles'],
    kind: 'table',
    columns: [
      'id',
      'full_name',
      'email',
      'phone_number',
      'whatsapp',
      'city',
      'full_address',
      'postal_code',
      'state',
      'landmark',
      'address_line2',
      'owner_photo_url',
      'latitude',
      'longitude',
      'updated_at',
    ],
    filters: ['id=eq.{customerId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/profile',
    note: 'The signup trigger already creates a profiles row for every auth user, so a customer profile is the same table the owner uses — scoped to id = auth.uid(). Customer screens never write salon columns (salon_name, business_type, theme_*, require_deposit…), so an owner row is safe to share.',
  },
  {
    logical: 'salons',
    // Resolved at request time from whichever catalogue this deployment has, so
    // no single physical table owns it — hence `derived`, with both sources
    // named. The handler order is fixed: normalized first, `profiles` fallback.
    table: null,
    tables: ['salons', 'services', 'staff', 'salon_hours', 'bookings', 'profiles'],
    kind: 'derived',
    columns: [],
    filters: ['salons: is_active=eq.true, deleted_at=is.null, is_listed=neq.false', 'profiles: salon_name=not.is.null, subdomain=not.is.null'],
    readScope: 'public-active',
    writeScope: 'none',
    endpoint: '/api/customer/salons',
    note: 'TWO read paths, normalized first. `readNormalizedSalonDirectory` (server/customerSalonDirectory.ts) builds a salon from `salons` + its `services`, `staff`, `salon_hours` and completed `bookings` (the rating is the average of reviews really stored on those bookings). When a deployment has no `salons` rows it falls back to the legacy path, where a salon IS an owner `profiles` row filtered to published ones (salon_name + subdomain). The response says which one answered (`normalizedCatalogue: true`). Packages, service gender tags and `area` are resolved on the normalized path and, for a single salon page, from `profiles.data.editor_profile` on the legacy one — a card list on the legacy path carries none of them, because discovery never selects that jsonb.',
  },
  {
    logical: 'salon_services',
    table: 'services',
    tables: ['services'],
    kind: 'table',
    columns: [
      'id',
      'owner_id',
      'name',
      'category',
      'description',
      'icon',
      'price',
      'duration_minutes',
      'popular',
      'show_duration',
      'sort_order',
    ],
    filters: ['owner_id=eq.{salonId}'],
    readScope: 'public-active',
    writeScope: 'owner-only',
    endpoint: '/api/customer/salons/{salonId}/services',
    note: 'One physical `services` table, two key spaces. The legacy path reads it by `owner_id` (price in `price`, duration in `duration_minutes`, ordered by `sort_order` exactly as the owner edits it in ServiceManagement); the normalized catalogue reads the same rows by `salon_id` with `price_paise` and `is_bookable_online`. There is NO `gender` column — a service gender tag exists only in the owner\'s published website payload (`salons.data.editor_services[].gender`), merged in by `mergeServicePresentation` and normalized by src/lib/serviceGender.ts. Customers can list the menu, never write it.',
  },
  {
    logical: 'salon_staff',
    table: 'stylists',
    tables: ['stylists', 'staff'],
    kind: 'table',
    columns: [
      'id',
      'owner_id',
      'name',
      'role',
      'avatar_url',
      'bio',
      'specialties',
      'assigned_services',
      'rating',
      'status',
      'schedule',
      'sort_order',
      'hide_phone',
    ],
    filters: ['owner_id=eq.{salonId}', "status=neq.Inactive"],
    readScope: 'public-active',
    writeScope: 'owner-only',
    endpoint: '/api/customer/salons/{salonId}/staff',
    note: 'Two staff tables, one logical entity. The legacy path reads `stylists` by `owner_id`, respecting `status` (Available/Busy/On Leave/Inactive) and `hide_phone` — inactive staff are excluded and phone numbers are stripped when the owner hid them. The normalized catalogue reads `staff` by `salon_id` with `is_active` + `is_public` (server/customerSalonDirectory.ts). Neither path exposes a staff member the owner did not publish.',
  },
  {
    logical: 'staff_slots',
    table: null,
    tables: ['stylists', 'bookings', 'salon_hours'],
    kind: 'derived',
    columns: [],
    filters: ['date=eq.{day}', 'stylist_id=eq.{staffId}'],
    readScope: 'public-active',
    writeScope: 'none',
    endpoint: '/api/customer/salons/{salonId}/slots',
    note: 'There is no slots table, and adding one is out of scope. Slots are computed live from what does exist: on the legacy path `stylists.schedule` (falling back to the salon\'s published `working_hours`) minus every `bookings` row on that date for that stylist (pending/confirmed/in_progress hold a slot); on the normalized path the `nexora_customer_booking_options` RPC answers from `salon_hours` + `staff` + `bookings` (server/customerAvailability.ts). Availability is therefore always real database state — and because nothing reserves a row while a customer hesitates on the slot screen, two customers can be offered the same slot until one of them creates the booking.',
  },
  {
    logical: 'bookings',
    table: 'bookings',
    tables: ['bookings'],
    kind: 'table',
    columns: [
      'id',
      'owner_id',
      'user_id',
      'customer_name',
      'customer_phone',
      'customer_email',
      'service_id',
      'service_name',
      'booking_date',
      'time_slot',
      'total_amount',
      'advance_paid_amount',
      'status',
      'payment_status',
      'payment_id',
      'booking_type',
      'home_address',
      'proposed_date',
      'proposed_time_slot',
      'notes',
      'metadata',
      'created_at',
      'updated_at',
    ],
    filters: ['user_id=eq.{customerId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/bookings',
    note: 'The real bookings table, already keyed by user_id. Reads are scoped to the verified token — never to an id passed in the query string, which is the rule /api/bookings/mine was built around.',
  },
  {
    logical: 'booking_services',
    table: 'bookings',
    tables: ['bookings'],
    kind: 'jsonb',
    columns: ['id', 'metadata', 'total_amount'],
    filters: ['user_id=eq.{customerId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/bookings/create',
    note: 'No `booking_services` junction table exists. Multi-service bookings are stored as `metadata.services[]` line items on the booking row, written in the same single-row insert as the booking, so the parent and its lines can never disagree. Read back through the same repository as line items, so the screens are junction-table agnostic and will use a real table if one is added.',
  },
  {
    logical: 'favourites',
    table: null,
    tables: ['bookings', 'profiles'],
    kind: 'derived',
    columns: [],
    filters: ['user_id=eq.{customerId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/favourites',
    note: 'No favourites table exists and we are not creating one. The list is derived from real data — salons/staff you have actually booked (from bookings) — and merged with the customer\'s own explicit pins, which are kept on the device. The derived half is genuine database state; only the manual pin half is device-local.',
  },
  {
    logical: 'reviews',
    table: 'bookings',
    tables: ['bookings', 'profiles'],
    kind: 'jsonb',
    columns: ['id', 'metadata', 'service_name', 'booking_date'],
    filters: ['user_id=eq.{customerId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/reviews',
    note: 'Reviews already live in `bookings.metadata` (review_rating / review_text / reviewed_at), written by /api/bookings/mine/review. This app reuses that exact shape so owner-side and customer-side read the same field. A salon\'s rating is the aggregate over its completed bookings — no synthetic stars anywhere.',
  },
  {
    logical: 'reward_wallets',
    table: 'clients',
    tables: ['clients', 'loyalty_config'],
    kind: 'table',
    columns: [
      'id',
      'owner_id',
      'name',
      'phone',
      'email',
      'points',
      'lifetime_points',
      'total_visits',
      'total_spent',
      'last_visit',
      'loyalty_tier',
    ],
    filters: ['email=eq.{customerEmail}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/rewards',
    note: '`clients` IS the per-salon customer ledger: points, lifetime points, tier, visits and spend. A wallet is therefore "my client row at salon X", which is also exactly what the owner sees in LoyaltyManagement — one number, no second source of truth.',
  },
  {
    logical: 'reward_transactions',
    table: 'loyalty_point_transactions',
    tables: ['loyalty_point_transactions'],
    kind: 'table',
    columns: ['id', 'owner_id', 'client_id', 'date', 'description', 'points_change', 'type', 'created_at'],
    filters: ['client_id=eq.{walletId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/rewards',
    note: 'The points ledger table, filtered to the customer\'s own wallet rows. There is no separate transactions route: /api/customer/me/rewards returns the wallet and this ledger in one response (data.wallets, data.transactions), because a balance without its history is not explainable. Types in use today: visit_earned, spend_earned, bonus, redeemed — plus qr_payment for QR rewards.',
  },
  {
    logical: 'customer_qr_payments',
    table: 'loyalty_point_transactions',
    tables: ['loyalty_point_transactions', 'clients'],
    kind: 'table',
    columns: ['id', 'owner_id', 'client_id', 'date', 'description', 'points_change', 'type', 'created_at'],
    filters: ["type=eq.qr_payment", 'client_id=eq.{walletId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/qr-payments',
    note: 'No QR payments table. A QR reward scan is recorded as a loyalty_point_transactions row of type `qr_payment` (amount and reference in the description) and credited through the wallet\'s own `points` column, which is the same ledger the salon owner reconciles against. Scan → credit → wallet update is one code path, not a parallel book of record.',
  },
  {
    logical: 'memberships',
    table: 'clients',
    tables: ['clients', 'loyalty_config'],
    kind: 'table',
    columns: ['loyalty_tier', 'lifetime_points', 'points'],
    filters: ['email=eq.{customerEmail}'],
    readScope: 'self',
    writeScope: 'owner-only',
    endpoint: '/api/customer/me/memberships',
    note: 'Membership = loyalty_tier on the wallet row + the thresholds/multipliers the owner configures in loyalty_config. Benefits and progress-to-next-tier are computed from those real numbers, so a tier can never show in the app that the salon has not granted.',
  },
  {
    logical: 'referrals',
    // Derived from two places (the code from the auth id, the count from
    // bookings.metadata.referral_code), so no single row "hosts" it — naming one
    // would make the Data-sources screen look like it reads a referrals table.
    table: null,
    tables: ['bookings', 'profiles', 'loyalty_point_transactions'],
    kind: 'derived',
    columns: ['metadata'],
    filters: ["metadata->>referral_code=eq.{code}"],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/referrals',
    note: 'No referrals table. The code is deterministic from the customer\'s own auth uid (NX-xxxxxxxx), so it needs no storage to be verifiable; a referral is counted when a booking was created carrying that code in metadata.referral_code, and rewards appear once the salon\'s point transaction lands. Nothing is displayed as "invited" that cannot be traced to a real row.',
  },
  {
    logical: 'notifications',
    table: 'in_app_notifications',
    tables: ['in_app_notifications'],
    kind: 'table',
    columns: ['id', 'owner_id', 'user_email', 'title', 'message', 'is_read', 'created_at'],
    filters: ['user_email=eq.{customerEmail}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/me/notifications',
    note: 'in_app_notifications is already addressed by email and its existing RLS policy grants the recipient select/update on their own rows (`user_email = auth.jwt() ->> \'email\'`) — the only customer-scoped policy in the schema. That is why notifications are also the one entity that can use native Supabase Realtime without any policy change.',
  },
  {
    logical: 'search_history',
    table: null,
    tables: ['bookings', 'services'],
    kind: 'device',
    columns: [],
    filters: [],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/search-suggestions',
    note: 'There is no search_history column anywhere in the schema and inventing one would mean altering a table, which is forbidden. Recent searches are kept per device under the customer id (so they survive reloads and never leak between accounts on a shared device), while "popular searches" come from real data: services actually booked at salons in the customer\'s city.',
  },
  {
    logical: 'offers',
    table: 'loyalty_rewards',
    tables: ['loyalty_rewards', 'loyalty_config'],
    kind: 'table',
    columns: [
      'id',
      'owner_id',
      'title',
      'required_points',
      'reward_type',
      'discount_value',
      'applicable_category',
      'description',
      'is_active',
      'coupon_code_prefix',
      'sort_order',
    ],
    filters: ['owner_id=eq.{salonId}', 'is_active=is.true'],
    readScope: 'public-active',
    writeScope: 'owner-only',
    endpoint: '/api/customer/offers',
    note: '`loyalty_rewards` is the offer catalogue the owner maintains (percentage/flat/free-service, points required, active flag). Only is_active rows are offered, and the points price is the owner\'s number — the customer app cannot invent or discount an offer.',
  },
  {
    logical: 'offer_redemptions',
    table: 'loyalty_redeemed_rewards',
    tables: ['loyalty_redeemed_rewards', 'loyalty_point_transactions', 'clients'],
    kind: 'table',
    columns: [
      'id',
      'owner_id',
      'client_id',
      'reward_id',
      'reward_title',
      'discount_summary',
      'points_spent',
      'redeemed_at',
      'coupon_code',
      'status',
    ],
    filters: ['client_id=eq.{walletId}'],
    readScope: 'self',
    writeScope: 'self',
    endpoint: '/api/customer/offers/redeem',
    note: 'Redemptions use the redemption table that already exists. A redemption writes three real rows in order — redemption, negative point transaction, wallet balance — and rolls the two ledger writes back if the third fails, because a coupon the customer paid points for must never exist without the debit.',
  },
];

/** The 18 logical entities, in the customer-flow order the spec lists. */
export const CUSTOMER_FLOW_ORDER = [
  'profiles',
  'salons',
  'salon_services',
  'salon_staff',
  'staff_slots',
  'bookings',
  'booking_services',
  'favourites',
  'reviews',
  'reward_wallets',
  'customer_qr_payments',
  'memberships',
  'referrals',
  'notifications',
  'search_history',
  'offers',
  'offer_redemptions',
  'reward_transactions',
];

const BY_LOGICAL = new Map(CUSTOMER_SCHEMA_MAP.map((entry) => [entry.logical, entry]));

export function entityMap(logical: string): CustomerEntityMap | undefined {
  return BY_LOGICAL.get(logical);
}

/** Physical table for a logical entity — `null` for derived/device entities. */
export function physicalTable(logical: string): string | null {
  return BY_LOGICAL.get(logical)?.table ?? null;
}

/** Every physical table the customer app depends on, de-duplicated. */
export function requiredPhysicalTables(): string[] {
  const set = new Set<string>();
  for (const entry of CUSTOMER_SCHEMA_MAP) for (const table of entry.tables) set.add(table);
  return [...set].sort();
}

/**
 * Entities that are NOT a physical table and what a real implementation would
 * need. Surfaced by the verify script and by the in-app connection report, so
 * nobody has to rediscover this by reading code.
 */
export const CUSTOMER_SCHEMA_GAPS = [
  {
    logical: 'staff_slots',
    why: 'no slots table; availability derived from stylists.schedule + bookings',
    needs: 'a `staff_slots` table (salon_id, staff_id, date, start_time, end_time, is_booked) if you want reserved-slot rows instead of derived availability',
  },
  {
    logical: 'booking_services',
    why: 'no junction table; stored in bookings.metadata.services[]',
    needs: 'a `booking_services` table (booking_id fk bookings.id, service_id, price, duration_minutes) for a normalised multi-service line item model',
  },
  {
    logical: 'favourites',
    why: 'no favourites table; derived from bookings + device-local pins',
    needs: 'a `favourites` table (user_id, salon_id, staff_id, created_at)',
  },
  {
    logical: 'reviews',
    why: 'no reviews table; stored in bookings.metadata.review_*',
    needs: 'a `reviews` table (booking_id, user_id, salon_id, rating, body) to review without a booking and to index salon ratings',
  },
  {
    logical: 'customer_qr_payments',
    why: 'the table EXISTS (supabase/migrations/20260908_complete_rewards_qr_referrals_backend.sql:438, owner-scoped RLS) but no code path reads or writes it — a QR reward scan is recorded as a loyalty_point_transactions row of type qr_payment, so the points ledger stays the single book of record',
    needs: 'either write the relational row alongside the ledger row (one transaction, both tables) or drop the unused table; today it is schema that claims a capability the app does not have',
  },
  {
    logical: 'memberships',
    why: 'no memberships table; tier read from clients.loyalty_tier + loyalty_config',
    needs: 'a `memberships` table (user_id, salon_id, plan, started_at, expires_at) for paid subscriptions with expiry',
  },
  {
    logical: 'referrals',
    why: 'no referrals table; code derived from the auth uid, counted from bookings.metadata.referral_code',
    needs: 'a `referrals` table (referrer_user_id, referred_user_id, salon_id, status, credited_at)',
  },
  {
    logical: 'search_history',
    why: 'no column exists to hold it; stored per device',
    needs: 'a `search_history` table (user_id, query, city, created_at)',
  },
  {
    logical: 'salons',
    why: 'resolved at request time from two catalogues: the normalized `salons` rows when a deployment has them, otherwise the legacy "a salon is an owner `profiles` row" path. The two are not feature-equal — packages, service gender tags and `area` are only fully resolved on the normalized path',
    needs: 'one authoritative catalogue. Either backfill `salons` for every published `profiles` salon and delete the legacy branch, or accept the fallback and label it as a degraded mode in the response (today only `normalizedCatalogue: true` marks the good path)',
  },
  {
    logical: 'notifications',
    why: 'delivered by email address, the only customer-scoped RLS policy in the schema',
    needs: 'a user_id column on in_app_notifications to make notification identity independent of an email string',
  },
  {
    logical: 'profile_settings',
    why: 'language (and any other display preference) has no column on profiles, clients or bookings',
    needs: 'a preferences jsonb column on profiles, or a customer_preferences table, for language/notification settings to follow the account instead of the browser',
  },
];

/**
 * RLS reality of the existing schema, as recorded so the access model is not
 * folklore.
 *
 * The original owner schema is owner-scoped with no customer SELECT policy: a
 * customer token asking Supabase directly for `stylists` or `clients` gets zero
 * rows, which is why private customer data is read through `/api/customer/*` on
 * the service-role key with the ownership check applied in SQL.
 *
 * The normalized catalogue added later is deliberately different — it publishes
 * read policies for `anon`/`authenticated`, because a public storefront has to
 * show a salon, its menu, its public staff and its opening hours to a signed-out
 * visitor (20261031000000_fix_website_save_and_public_site.sql:270-326). That
 * is public business data, not customer data; nothing in it is scoped to a
 * person.
 */
export const RLS_REALITY = {
  ownerScoped: [
    'profiles',
    'services',
    'stylists',
    'bookings',
    'appointments',
    'clients',
    'loyalty_config',
    'loyalty_rewards',
    'loyalty_point_transactions',
    'loyalty_redeemed_rewards',
    'social_videos',
  ],
  /**
   * Catalogue tables a signed-out visitor may SELECT directly, each limited to
   * rows the owner published (`is_active`, `deleted_at is null`). `services`
   * appears in both lists: its legacy rows are owner-scoped by `owner_id`, and
   * the public-read policy added for the normalized catalogue exposes active
   * rows of every salon.
   */
  publicRead: ['salons', 'services', 'staff', 'salon_hours'],
  recipientScoped: ['in_app_notifications'],
  customerScoped: [] as string[],
  realtimeSafeWithoutChanges: ['in_app_notifications'],
  note: 'Private customer reads (bookings, profile, rewards, notifications) are still scoped in SQL by the trusted API rather than by RLS: no customer-facing policy exists on any of those tables, and adding one would be an RLS change this module only reports on.',
};

/** Deterministic, verifiable referral code for a customer uid. */
export function referralCodeFor(userId: string | null | undefined): string {
  const clean = String(userId ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!clean) return '';
  return `NX-${clean.slice(0, 8)}`;
}

/** True when `code` is a well-formed referral code (used to validate ?ref=). */
export function isReferralCode(code: unknown): boolean {
  return /^NX-[A-Z0-9]{4,8}$/.test(String(code ?? '').trim().toUpperCase());
}

export function normalizeReferralCode(code: unknown): string {
  const value = String(code ?? '').trim().toUpperCase();
  return isReferralCode(value) ? value : '';
}

/**
 * A slot is held by any booking that has not ended and was not called off —
 * shared by the availability computation and its tests so the two can never
 * drift.
 */
/**
 * The length assumed for a service whose `duration_minutes` is unset.
 *
 * Kept in one place because two layers need the same number: the slot grid (a
 * 30-minute window decides how many slots fit) and the service card (it prints
 * the minutes under the price). They used to disagree — 45 on screen, 30 in the
 * grid — so a customer could be shown "45 min" and then offered a slot at a time
 * that a 45-minute service cannot fit into.
 */
export const DEFAULT_SERVICE_MINUTES = 30;

/**
 * A QR payment earns rewards only at or above this amount. The rule lives here
 * (not in the form, not in the ledger writer) because both the record step and
 * the verification step must agree on it — a payment the customer logs below the
 * minimum is a real payment, it just does not earn, and that distinction is what
 * the `below_minimum` reward state is for.
 */
export const QR_MIN_QUALIFYING_RUPEES = 100;

export const SLOT_HOLDING_STATUSES = ['pending', 'confirmed', 'in_progress', 'reschedule_requested', 'reschedule_proposed'];

export function slotStatusBlocks(status: unknown): boolean {
  return SLOT_HOLDING_STATUSES.includes(String(status ?? '').toLowerCase());
}

export interface SlotDefinition {
  date: string;
  time: string;
  staffId: string;
  available: boolean;
}

/**
 * Free slots for one stylist on one day: walk their weekly opening hours in
 * `stepMinutes`, drop anything in the past, and drop times already taken.
 * Pure, so the booking screen and the API agree by construction.
 */
export function buildSlotGrid(input: {
  date: string;
  fromTime: string;
  toTime: string;
  stepMinutes?: number;
  durationMinutes?: number;
  takenTimes: string[];
  now?: Date;
  staffId?: string;
}): SlotDefinition[] {
  const step = Math.max(5, Number(input.stepMinutes ?? 30));
  const duration = Math.max(0, Number(input.durationMinutes ?? 0));
  const now = input.now ?? new Date();
  const todayIso = toIsoDate(now);
  const startMin = minutesFromClock(input.fromTime);
  const endMin = minutesFromClock(input.toTime);
  if (startMin === null || endMin === null || endMin <= startMin) return [];

  // `normalizeClock` here is the whole point of comparing at all: the held times
  // arrive from a free-text column.
  const taken = new Set((input.takenTimes || []).map((value) => normalizeClock(value)).filter(Boolean));
  const staffId = input.staffId || 'any';
  const out: SlotDefinition[] = [];
  for (let cursor = startMin; cursor + duration <= endMin; cursor += step) {
    const time = clockFromMinutes(cursor);
    const inPast = input.date < todayIso || (input.date === todayIso && cursor <= now.getHours() * 60 + now.getMinutes());
    out.push({ date: input.date, time, staffId, available: !inPast && !taken.has(time) });
  }
  return out;
}

export function toIsoDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * Today in the customer's own timezone. Deliberately not `new Date().toISOString()`:
 * a UTC "today" is yesterday evening for a customer in IST, and an off-by-one
 * date here is an instant 400 on every booking made after 6pm.
 */
export function todayIsoDate(now: Date = new Date()): string {
  return toIsoDate(now);
}

/**
 * Reduce whatever `bookings.time_slot` text holds to the `HH:MM` everything else
 * compares on.
 *
 * The column is plain `text`, so a row can legitimately read `11:00`, `11:00:00`
 * (a Postgres `time` cast or a hand-edited row) or even `11:00 AM`. Those are the
 * same appointment, and slot availability is decided by string equality — so
 * un-normalised values silently read as "not booked" and cost the salon a double
 * booking. Normalising at the boundary is what makes the comparison mean
 * something.
 */
export function normalizeClock(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const plain = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (plain) return `${String(Number(plain[1]) % 24).padStart(2, '0')}:${plain[2]}`;
  const meridiem = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(raw);
  if (meridiem) {
    const hours = Number(meridiem[1]) % 12 + (/pm/i.test(meridiem[3]) ? 12 : 0);
    return `${String(hours).padStart(2, '0')}:${meridiem[2]}`;
  }
  return raw;
}

export function minutesFromClock(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function clockFromMinutes(totalMinutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

/** Weekly opening hours for one day, from a stylist's `schedule` jsonb. */
export function dayWindowFor(schedule: unknown, date: string): { fromTime: string; toTime: string } | null {
  const rows = Array.isArray(schedule) ? (schedule as any[]) : [];
  const dayName = DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
  const found = rows.find((row) => String(row?.day ?? '') === dayName && row?.enabled !== false);
  if (!found) return null;
  const fromTime = String(found.fromTime ?? '').trim();
  const toTime = String(found.toTime ?? '').trim();
  if (!fromTime || !toTime) return null;
  return { fromTime, toTime };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Fall back to the salon's published hours when a stylist has no personal
 * schedule — otherwise a freshly seeded salon would show zero slots and look
 * broken rather than closed.
 */
export function salonWindowFromHours(
  workingHours: { monFri?: string; saturday?: string; sunday?: string } | null | undefined,
  date: string
): { fromTime: string; toTime: string } | null {
  if (!workingHours) return null;
  const day = new Date(`${date}T12:00:00`).getDay();
  const raw = day === 0 ? workingHours.sunday : day === 6 ? workingHours.saturday : workingHours.monFri;
  return parseWindow(String(raw ?? ''));
}

/** "10:00 - 19:00" / "10:00-19:00" → { fromTime, toTime }. */
export function parseWindow(value: string): { fromTime: string; toTime: string } | null {
  const match = /(\d{1,2}):(\d{2})\s*(?:-|–|to)\s*(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const from = `${String(match[1]).padStart(2, '0')}:${match[2]}`;
  const to = `${String(match[3]).padStart(2, '0')}:${match[4]}`;
  if (minutesFromClock(from) === null || minutesFromClock(to) === null) return null;
  return { fromTime: from, toTime: to };
}

/** Great-circle distance in km — used for the Location → Discovery ordering. */
export function distanceKm(
  a: { latitude?: number | null; longitude?: number | null } | null | undefined,
  b: { latitude?: number | null; longitude?: number | null } | null | undefined
): number | null {
  // `Number(null)` is 0, and (0, 0) is a real place in the Gulf of Guinea. A
  // customer whose location is unset would then be "8,666 km away" and sorted to
  // the bottom of every salon list, so absence has to stay absence.
  const coordinate = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const lat1 = coordinate(a?.latitude);
  const lon1 = coordinate(a?.longitude);
  const lat2 = coordinate(b?.latitude);
  const lon2 = coordinate(b?.longitude);
  if ([lat1, lon1, lat2, lon2].some((value) => value === null)) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}
