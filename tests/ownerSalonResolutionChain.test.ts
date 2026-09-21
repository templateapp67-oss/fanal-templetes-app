import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerSalonIds,
  resolveOwnerSalonResolution,
} from '../server/backendContext.js';
import {
  createBlankSalonProfile,
  resolveOwnerSalon,
} from '../src/lib/ownerSalonResolution';

// Mock DB factory
function createMockDb(config: {
  members?: any[];
  salons?: any[];
  error?: any;
}) {
  return {
    from: (table: string) => {
      let currentTable = table;
      let filters: Record<string, any> = {};

      const builder: any = {
        select: (cols: string) => builder,
        eq: (col: string, val: any) => {
          filters[col] = val;
          return builder;
        },
        in: (col: string, vals: any[]) => {
          filters[col] = vals;
          return builder;
        },
        is: (col: string, val: any) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          if (config.error) return { data: null, error: config.error };
          if (currentTable === 'organization_members') {
            const match = (config.members || []).find((m) =>
              Object.entries(filters).every(([k, v]) => m[k] === v)
            );
            return { data: match || null, error: null };
          }
          if (currentTable === 'salons') {
            const match = (config.salons || []).find((s) =>
              Object.entries(filters).every(([k, v]) => s[k] === v)
            );
            return { data: match || null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: any, reject?: any) => {
          if (config.error) return resolve({ data: null, error: config.error });
          if (currentTable === 'organization_members') {
            const matches = (config.members || []).filter((m) =>
              Object.entries(filters).every(([k, v]) => {
                if (Array.isArray(v)) return v.includes(m[k]);
                return m[k] === v;
              })
            );
            return resolve({ data: matches, error: null });
          }
          if (currentTable === 'salons') {
            const matches = (config.salons || []).filter((s) =>
              Object.entries(filters).every(([k, v]) => {
                if (k === 'deleted_at' && v === null) return s.deleted_at == null;
                if (Array.isArray(v)) return v.includes(s[k]);
                return s[k] === v;
              })
            );
            return resolve({ data: matches, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };

      return builder;
    },
  };
}

test('1. authenticated user with no owner organization/salon returns needs_onboarding and salon: null', async () => {
  const db = createMockDb({ members: [], salons: [] });
  const result = await resolveOwnerSalonResolution(db, 'user-new-123');
  assert.equal(result.status, 'needs_onboarding');
  assert.equal(result.salon, null);
});

test('2. staff role in organization_members does NOT authorize owner salon and returns needs_onboarding', async () => {
  const db = createMockDb({
    members: [
      { user_id: 'user-staff', organization_id: 'org-1', role: 'staff', status: 'active' },
    ],
    salons: [
      { id: 'salon-1', organization_id: 'org-1', name: 'Some Salon' },
    ],
  });

  const ids = await ownerSalonIds(db, 'user-staff');
  assert.deepEqual(ids, []);

  const result = await resolveOwnerSalonResolution(db, 'user-staff');
  assert.equal(result.status, 'needs_onboarding');
  assert.equal(result.salon, null);
});

test('3. inactive or invited membership returns needs_onboarding', async () => {
  const db = createMockDb({
    members: [
      { user_id: 'user-invited', organization_id: 'org-1', role: 'owner', status: 'invited' },
    ],
    salons: [
      { id: 'salon-1', organization_id: 'org-1', name: 'Some Salon' },
    ],
  });

  const ids = await ownerSalonIds(db, 'user-invited');
  assert.deepEqual(ids, []);

  const result = await resolveOwnerSalonResolution(db, 'user-invited');
  assert.equal(result.status, 'needs_onboarding');
  assert.equal(result.salon, null);
});

test('4. active owner membership with valid salon returns active status and salon data', async () => {
  const db = createMockDb({
    members: [
      { user_id: 'user-owner', organization_id: 'org-valid', role: 'owner', status: 'active' },
    ],
    salons: [
      { id: 'salon-valid', organization_id: 'org-valid', name: 'My Own Salon', slug: 'my-own-salon' },
    ],
  });

  const ids = await ownerSalonIds(db, 'user-owner');
  assert.deepEqual(ids, ['salon-valid']);

  const result = await resolveOwnerSalonResolution(db, 'user-owner');
  assert.equal(result.status, 'active');
  assert.ok(result.salon);
  assert.equal(result.salon.id, 'salon-valid');
  assert.equal(result.salon.name, 'My Own Salon');
});

test('5. client-side createBlankSalonProfile provides blank defaults and no hardcoded demo leaks', () => {
  const user = {
    id: 'test-user-uuid',
    email: 'newuser@example.com',
    user_metadata: {
      salon_name: 'Glow Hair Studio',
      full_name: 'Ritu V',
      phone_number: '9876543210',
      city: 'Delhi',
    },
  };

  const blank = createBlankSalonProfile(user);
  assert.equal(blank.ownerId, 'test-user-uuid');
  assert.equal(blank.businessName, 'Glow Hair Studio');
  assert.equal(blank.ownerName, 'Ritu V');
  assert.equal(blank.phone, '9876543210');
  assert.equal(blank.city, 'Delhi');
  assert.equal(blank.email, 'newuser@example.com');
  assert.equal(blank.subdomain, 'glow-hair-studio');

  // Verify no previous tenant leaks:
  assert.equal(blank.ownerPhotoUrl, '', 'Avatar must be blank string');
  assert.equal(blank.coverImageUrl, '', 'Cover image must be blank');
  assert.equal(blank.logoUrl, undefined, 'Logo must be undefined');
  assert.equal(blank.tagline, '', 'Tagline must be blank');
  assert.equal(blank.about, '', 'About must be blank');
  assert.equal(blank.address, '', 'Address must be blank');
  assert.deepEqual(blank.offers, [], 'Offers must be empty array');
});

test('6. client-side resolveOwnerSalon returns needs_onboarding for new user', async () => {
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'new-user-id' } } },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };

  const result = await resolveOwnerSalon(fakeSupabase, 'new-user-id');
  assert.equal(result.status, 'needs_onboarding');
  assert.equal(result.salon, null);
});
