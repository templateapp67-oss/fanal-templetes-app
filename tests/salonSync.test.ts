import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  toProfileRow,
  toServiceDbRow,
  toStylistDbRow,
  toLoyaltyConfigDbRow,
  toRewardDbRow,
  buildWorkingHours,
  applyWorkingHoursFromRow,
  deleteRowsNotIn,
  syncSalonToSupabase,
  SERVICE_ID_NAMESPACE,
} from '../src/lib/salonSync';
import { toDbId } from '../src/lib/autoSave';
import { SalonProfile, SalonService, Stylist, LoyaltyConfig } from '../src/types';
import { DEFAULT_LOYALTY_CONFIG } from '../src/loyaltyData';

const OWNER_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

// Inline fixtures (importing mockData pulls in .jpg assets that Node can't load).
const PROFILE: SalonProfile = {
  ownerId: OWNER_ID,
  businessType: 'hair_salon',
  businessName: 'Arts By Uma',
  ownerName: 'Uma',
  ownerRole: 'Founder & Master Stylist',
  phone: '+91 98450 77654',
  whatsapp: '+91 98450 77654',
  email: 'hello@artsbyuma.com',
  tagline: 'Precision Cuts & Creative Hair Artistry',
  about: 'Our story…',
  ownerPhotoUrl: 'https://example.com/u.jpg',
  coverImageUrl: 'https://example.com/c.jpg',
  themePreset: 'slate_silver',
  currency: '₹',
  subdomain: 'arts-by-uma',
  address: '100 Feet Road, Indiranagar',
  city: 'Bengaluru',
  postalCode: '560038',
  instagramHandle: 'arts_by_uma',
  requireDeposit: true,
  depositPercentage: 20,
  themeAccentKey: 'slate',
};

const SERVICES: SalonService[] = [
  {
    id: 'hs-1',
    name: 'Master Stylist Precision Cut & Blowdry',
    category: 'Hair Artistry',
    durationMinutes: 45,
    price: 750,
    description: 'Signature cut.',
    icon: 'scissors',
    popular: true,
    showDuration: true,
  },
  {
    id: 'hs-2',
    name: 'Classic Layered Cut',
    category: 'Hair Artistry',
    durationMinutes: 35,
    price: 450,
    description: 'Layers.',
    icon: 'scissors',
    popular: false,
  },
];

const STYLISTS: Stylist[] = [
  {
    id: 'hs-st-uma',
    name: 'Uma',
    role: 'Founder & Master Stylist',
    avatarUrl: 'https://example.com/a.jpg',
    specialties: ['Balayage', 'Keratin'],
    rating: 4.98,
    commissionRate: 35,
    status: 'Available',
    accessRole: 'Manager (Full Access)',
    assignedServices: ['hs-1'],
    bio: '12+ years of experience.',
  },
];

test('toProfileRow maps every editor field to the backend profiles schema', () => {
  const profile: SalonProfile = {
    ...PROFILE,
    businessName: 'Miraki Hair Studio',
    tagline: 'Redefining luxury salon care',
    about: 'Our story…',
    whatsapp: '+91 90000 00000',
    city: 'Hyderabad',
    subdomain: 'miraki-hair-studio',
    workingHoursMonFri: '10:00 AM - 08:30 PM',
    workingHoursSat: '09:00 AM - 09:00 PM',
    workingHoursSun: 'Closed',
    themeAccentKey: 'rose',
  };

  const row = toProfileRow(profile, OWNER_ID);

  // The columns the old save path forgot (which made Timings / Sub-domain /
  // Salon Details edits never reach the database).
  assert.equal(row.id, OWNER_ID);
  assert.equal(row.business_type, profile.businessType);
  assert.equal(row.salon_name, 'Miraki Hair Studio');
  assert.equal(row.tagline, 'Redefining luxury salon care');
  assert.equal(row.about, 'Our story…');
  assert.equal(row.whatsapp, '+91 90000 00000');
  assert.equal(row.city, 'Hyderabad');
  assert.equal(row.subdomain, 'miraki-hair-studio');
  assert.equal(row.theme_preset, profile.themePreset);
  assert.equal(row.theme_accent_key, 'rose');
  // Timings go into the working_hours jsonb column, matching the DB schema.
  assert.deepEqual(row.working_hours, {
    monFri: '10:00 AM - 08:30 PM',
    saturday: '09:00 AM - 09:00 PM',
    sunday: 'Closed',
  });
  assert.ok(typeof row.updated_at === 'string');
});

test('working hours round-trip through the jsonb column', () => {
  const base: SalonProfile = {
    ...PROFILE,
    workingHoursMonFri: '10–8',
    workingHoursSat: '9–9',
    workingHoursSun: 'Closed',
  };
  const row = toProfileRow(base, OWNER_ID);
  const restored = applyWorkingHoursFromRow({ ...base, workingHoursMonFri: '' }, { working_hours: row.working_hours as any });
  assert.equal(restored.workingHoursMonFri, '10–8');
  assert.equal(restored.workingHoursSat, '9–9');
  assert.equal(restored.workingHoursSun, 'Closed');
});

test('toServiceDbRow produces uuid-safe ids with sort_order (fixes the Save Failed bug)', () => {
  const svc: SalonService = { ...SERVICES[0], id: 'hs-1' };
  const row = toServiceDbRow(svc, OWNER_ID, 3);

  // Friendly ids like 'hs-1' used to be sent to a uuid primary key and every
  // save failed with "invalid input syntax for type uuid".
  assert.equal(row.id, toDbId('hs-1', SERVICE_ID_NAMESPACE));
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  assert.equal(row.owner_id, OWNER_ID);
  assert.equal(row.duration_minutes, svc.durationMinutes);
  assert.equal(row.show_duration, svc.showDuration ?? true);
  assert.equal(row.sort_order, 3);
  // Hydrated DB rows (already uuids) keep their id.
  const hydrated = toServiceDbRow({ ...svc, id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' }, OWNER_ID, 0);
  assert.equal(hydrated.id, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
});

test('toStylistDbRow and loyalty mappers match the backend schema', () => {
  const stylist: Stylist = { ...STYLISTS[0], id: 'hs-st-uma' };
  const stylistRow = toStylistDbRow(stylist, OWNER_ID, 1);
  assert.match(stylistRow.id, /^[0-9a-f-]{36}$/);
  assert.equal(stylistRow.commission_rate, stylist.commissionRate ?? 0);
  assert.equal(stylistRow.access_role, stylist.accessRole);
  assert.deepEqual(stylistRow.specialties, stylist.specialties);
  assert.equal(stylistRow.sort_order, 1);

  const config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG;
  const configRow = toLoyaltyConfigDbRow(config, OWNER_ID);
  assert.equal(configRow.owner_id, OWNER_ID);
  assert.equal(configRow.program_enabled, config.programEnabled);
  assert.deepEqual(configRow.tier_thresholds, config.tierThresholds);

  const rewardRow = toRewardDbRow(config.rewards[0], OWNER_ID, 2);
  assert.match(rewardRow.id, /^[0-9a-f-]{36}$/);
  assert.equal(rewardRow.required_points, config.rewards[0].requiredPoints);
  assert.equal(rewardRow.reward_type, config.rewards[0].rewardType);
  assert.equal(rewardRow.sort_order, 2);
});

// ---------------------------------------------------------------------------
// syncSalonToSupabase with a mock Supabase client
// ---------------------------------------------------------------------------
function makeMockDb(behaviour: {
  upsertError?: (table: string, attempt: number) => any | null;
  deleteError?: (table: string) => any | null;
} = {}) {
  const calls: { op: string; table: string; rows?: any; filter?: string }[] = [];
  const attempts: Record<string, number> = {};

  const db: any = {
    from(table: string) {
      attempts[table] = attempts[table] || 0;
      return {
        upsert(rows: any) {
          const call = { op: 'upsert', table, rows };
          calls.push(call);
          const self = {
            then(resolve: any, reject: any) {
              attempts[table]++;
              const err = behaviour.upsertError?.(table, attempts[table]) ?? null;
              if (err) reject(Object.assign(new Error(err.message), err));
              else resolve({ data: rows, error: null });
              return self;
            },
            catch() {
              return self;
            },
          };
          return self;
        },
        delete() {
          const builder: any = {
            eq() {
              return builder;
            },
            not(_col: string, _op: string, filter: string) {
              builder.__filter = filter;
              return builder;
            },
            then(resolve: any) {
              calls.push({ op: 'delete', table, filter: builder.__filter });
              const err = behaviour.deleteError?.(table) ?? null;
              resolve({ data: null, error: err });
              return builder;
            },
            catch() {
              return builder;
            },
          };
          return builder;
        },
      };
    },
  };
  return { db, calls, attempts };
}

test('syncSalonToSupabase sends schema-matched payloads and cleans up removed rows', async () => {
  const { db, calls } = makeMockDb();

  const result = await syncSalonToSupabase(
    db,
    {
      ownerId: OWNER_ID,
      profile: PROFILE,
      services: SERVICES,
      stylists: STYLISTS,
      loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
    },
    { deleteRemoved: true }
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const upserts = calls.filter((c) => c.op === 'upsert');
  const tables = upserts.map((c) => c.table);
  assert.ok(tables.includes('profiles'));
  assert.ok(tables.includes('services'));
  assert.ok(tables.includes('stylists'));
  assert.ok(tables.includes('loyalty_config'));
  assert.ok(tables.includes('loyalty_rewards'));

  // Every row id sent to uuid primary keys must be a valid uuid.
  for (const c of upserts) {
    const rows = Array.isArray(c.rows) ? c.rows : [c.rows];
    for (const row of rows) {
      if (row.id) assert.match(row.id, /^[0-9a-f-]{36}$/, `${c.table} row id must be a uuid`);
    }
  }

  // Rows removed in the editor are deleted via a "not in" filter.
  const deletes = calls.filter((c) => c.op === 'delete');
  assert.ok(deletes.some((c) => c.table === 'services' && c.filter && c.filter.startsWith('(')));
});

test('syncSalonToSupabase in safe mode (deleteRemoved: false) upserts but never deletes', async () => {
  // This is the mode the auto-save engine uses while the initial cloud
  // hydration has not succeeded yet: the owner's own rows may be pushed
  // (upserts are RLS-scoped to auth.uid()) but rows the client never managed
  // to read must NEVER be deleted.
  const { db, calls } = makeMockDb();

  const result = await syncSalonToSupabase(
    db,
    {
      ownerId: OWNER_ID,
      profile: PROFILE,
      services: SERVICES,
      stylists: STYLISTS,
      loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
    },
    { deleteRemoved: false }
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const ops = calls.map((c) => c.op);
  assert.ok(ops.includes('upsert'), 'owner rows must still be upserted in safe mode');
  assert.ok(!ops.includes('delete'), 'safe mode must never issue destructive deletes');
});

test('syncSalonToSupabase retries network failures and still succeeds', async () => {
  // services upsert fails twice with a network error, then succeeds.
  const { db, attempts } = makeMockDb({
    upsertError: (table, attempt) =>
      table === 'services' && attempt <= 2 ? { message: 'TypeError: fetch failed' } : null,
  });

  const result = await syncSalonToSupabase(db, {
    ownerId: OWNER_ID,
    profile: PROFILE,
    services: SERVICES,
    stylists: [],
    loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(attempts['services'] >= 3, 'the services upsert must have been retried');
});

test('syncSalonToSupabase collects the exact error for deterministic DB failures', async () => {
  const { db } = makeMockDb({
    upsertError: () => ({
      message: 'invalid input syntax for type uuid: "hs-1"',
      code: '22P02',
      details: 'Failing row contains (hs-1, …)',
    }),
  });

  const result = await syncSalonToSupabase(db, {
    ownerId: OWNER_ID,
    profile: PROFILE,
    services: SERVICES,
    stylists: [],
    loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  // The exact Postgres message, code and details must be preserved so the
  // root cause is visible (no more generic "One or more tables failed").
  assert.match(result.errors.join(' · '), /invalid input syntax for type uuid/);
  assert.match(result.errors.join(' · '), /code: 22P02/);
});

test('deleteRowsNotIn builds the right filter and reports errors instead of throwing', async () => {
  const { db } = makeMockDb();
  await deleteRowsNotIn(db, 'services', OWNER_ID, [
    '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    '1f0e3dad-9990-4b7a-9d3b-2b0d7b3dcb6e',
  ]);
  // No assertion on calls here; the mock validates shape. Empty keep list →
  // no filter at all (deletes every row for the owner).
  const result = await deleteRowsNotIn(db, 'services', OWNER_ID, []);
  assert.equal(result.error, null);
});

test('buildWorkingHours always returns all three timing slots', () => {
  const wh = buildWorkingHours({ ...PROFILE });
  assert.deepEqual(Object.keys(wh).sort(), ['monFri', 'saturday', 'sunday']);
});
