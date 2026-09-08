// ============================================================================
// Nexora SalonOS — Customer App schema map.
//
// WHY THIS FILE EXISTS
// --------------------
// The Customer App is specced against 18 logical tables (`salons`,
// `salon_services`, `staff_slots`, `reward_wallets`, …). The Supabase project
// this app is connected to ships a *salon-owner* schema (see
// `supabase/migrations/00001_init.sql`) with 13 physical tables, and only two
// of the 18 names (`profiles`, `bookings`) exist literally.
//
// The instruction was explicit: do NOT create, rename or drop tables, and do
// not overwrite existing data. So this module is the one place where the
// customer vocabulary is translated to the physical schema. Every customer
// screen and every `/api/customer/*` handler resolves its data through here,
// which means re-pointing the app at a real 18-table schema later is a
// one-file change instead of a rewrite.
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

/** The physical tables this app is allowed to touch. Nothing else. */
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
    table: 'profiles',
    tables: ['profiles'],
    kind: 'table',
    columns: [
      'id',
      'salon_name',
      'business_type',
      'tagline',
      'about',
      'logo_url',
      'cover_image_url',
      'city',
      'state',
      'full_address',
      'postal_code',
      'latitude',
      'longitude',
      'phone_number',
      'whatsapp',
      'instagram_handle',
      'subdomain',
      'currency',
      'theme_preset',
      'theme_accent_key',
      'working_hours',
      'home_service',
      'require_deposit',
      'deposit_percentage',
      'founding_year',
    ],
    filters: ['salon_name=not.is.null', 'subdomain=not.is.null'],
    readScope: 'public-active',
    writeScope: 'none',
    endpoint: '/api/customer/salons',
    note: 'A salon IS an owner profile row: profiles holds the published name, address, geo, images and hours. Read-only for customers; discovery filters to rows that actually published a salon (salon_name + subdomain), which is what "active" means in this schema.',
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
    note: '`services` is the salon service catalogue, ordered by sort_order exactly as the owner edits it in ServiceManagement. Customers can list it, never write it.',
  },
  {
    logical: 'salon_staff',
    table: 'stylists',
    tables: ['stylists'],
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
    note: '`stylists` is the staff table. `status` (Available/Busy/On Leave/Inactive) and `hide_phone` are respected: inactive staff are excluded from the customer app and phone numbers are stripped when the owner hid them.',
  },
  {
    logical: 'staff_slots',
    table: null,
    tables: ['stylists', 'bookings'],
    kind: 'derived',
    columns: [],
    filters: ['date=eq.{day}', 'stylist_id=eq.{staffId}'],
    readScope: 'public-active',
    writeScope: 'none',
    endpoint: '/api/customer/salons/{salonId}/slots',
    note: 'There is no slots table, and adding one is out of scope. Slots are computed live from the two tables that do exist: `stylists.schedule` (the owner-editable weekly opening hours) minus every `bookings` row on that date for that stylist (pending/confirmed/in_progress hold a slot). So availability is always the real database state, and it is the same computation the owner sees in TeamManagement.',
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
    endpoint: '/api/customer/me/rewards/transactions',
    note: 'The points ledger table, filtered to the customer\'s own wallet rows. Types in use today: visit_earned, spend_earned, bonus, redeemed — plus qr_payment for QR rewards.',
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
    table: 'bookings',
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
    why: 'no QR table; recorded as loyalty_point_transactions of type qr_payment',
    needs: 'a `customer_qr_payments` table (user_id, salon_id, amount, reference, status) if QR payments must exist independently of the points ledger',
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
    why: 'a salon is an owner profile row, not a salons table',
    needs: 'a `salons` table if one owner must run several salons',
  },
  {
    logical: 'notifications',
    why: 'delivered by email address, the only customer-scoped RLS policy in the schema',
    needs: 'a user_id column on in_app_notifications to make notification identity independent of an email string',
  },
];

/**
 * RLS reality of the existing schema, as recorded so the access model is not
 * folklore: every salon table is owner-scoped, there is no customer SELECT
 * policy, so a customer token asking Supabase directly for `services` gets zero
 * rows. That is why the Customer App reads through `/api/customer/*`, which
 * runs on the service-role key and applies the ownership check itself.
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
  recipientScoped: ['in_app_notifications'],
  customerScoped: [] as string[],
  realtimeSafeWithoutChanges: ['in_app_notifications'],
  note: 'Adding customer policies would be an RLS change; the chosen plan is zero schema/RLS changes, so private customer reads are scoped in SQL by the trusted API instead of by RLS.',
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
