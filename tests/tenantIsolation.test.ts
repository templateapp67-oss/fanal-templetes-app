import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSalonProfile } from '../src/mockData';
import { clearAllSalonLocalData } from '../src/lib/salonStore';
import { readOwnerDashboard } from '../server/ownerDashboard';

test('createBlankSalonProfile generates a clean profile without previous tenant data', () => {
  const profile = createBlankSalonProfile({
    full_name: 'Jane Doe',
    salon_name: 'Glow Salon',
    phone_number: '9876543210',
    email: 'jane@glow.com',
    city: 'Mumbai',
  });

  assert.equal(profile.businessName, 'Glow Salon');
  assert.equal(profile.ownerName, 'Jane Doe');
  assert.equal(profile.phone, '9876543210');
  assert.equal(profile.email, 'jane@glow.com');
  assert.equal(profile.city, 'Mumbai');
  assert.equal(profile.ownerPhotoUrl, '');
  assert.equal(profile.coverImageUrl, '');
  assert.equal(profile.tagline, '');
  assert.equal(profile.about, '');
  assert.deepEqual(profile.offers, []);
});

test('readOwnerDashboard returns needs_onboarding and null salon for new account without salon', async () => {
  const fakeDb = {
    auth: {
      getUser: async (token) => {
        if (token === 'valid-new-user-token') {
          return { data: { user: { id: 'user-new-123' } }, error: null };
        }
        return { data: null, error: { message: 'invalid token' } };
      },
    },
    from: (table) => {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: null }),
              in: async () => ({ data: [], error: null }),
            }),
            in: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  };

  const request = { headers: { authorization: 'Bearer valid-new-user-token' } };
  const res = await readOwnerDashboard(fakeDb, request);

  assert.equal(res.status, 'needs_onboarding');
  assert.equal(res.salon, null);
  assert.equal(res.success, true);
  assert.deepEqual(res.appointments, []);
  assert.deepEqual(res.clients, []);
});

test('clearAllSalonLocalData purges local storage keys', () => {
  const mockStorage = new Map();
  (global as any).localStorage = {
    setItem: (k, v) => mockStorage.set(k, v),
    getItem: (k) => mockStorage.get(k) || null,
    removeItem: (k) => mockStorage.delete(k),
  };

  mockStorage.set('nexora_salon_state_v1', 'old_data');
  mockStorage.set('nexora_draft_salon_data', 'old_draft');
  mockStorage.set('nexora_auth_profile_state', 'old_profile');

  clearAllSalonLocalData();

  assert.equal(mockStorage.has('nexora_salon_state_v1'), false);
  assert.equal(mockStorage.has('nexora_draft_salon_data'), false);
  assert.equal(mockStorage.has('nexora_auth_profile_state'), false);
});
