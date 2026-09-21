import test from 'node:test';
import assert from 'node:assert/strict';
import { growthPartnerPhotoUrl, type GrowthPartnerProfileClient } from '../src/lib/growthPartnerProfile.js';
import { createBlankSalonProfile } from '../src/lib/ownerSalonResolution.js';
import { loadSalonState, saveSalonState, clearAllLocalUserState } from '../src/lib/salonStore.js';

test('growthPartnerPhotoUrl handles storage paths and full URLs correctly without leaking untrusted domains', () => {
  const fakeClient: GrowthPartnerProfileClient = {
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async () => ({ data: null, error: null }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test-project.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  };

  const userUuid = '5a900556-605a-4501-9655-a332f7339a34';
  const fileUuid = '83869de5-e5df-4530-9840-55efb2c9262a';

  // Relative storage paths with various supported extensions
  const webpPath = `${userUuid}/${fileUuid}.webp`;
  const jpegPath = `${userUuid}/${fileUuid}.jpeg`;
  const jpgPath = `${userUuid}/${fileUuid}.jpg`;
  const pngPath = `${userUuid}/${fileUuid}.png`;

  assert.equal(
    growthPartnerPhotoUrl(webpPath, fakeClient),
    `https://test-project.supabase.co/storage/v1/object/public/partner-avatars/${webpPath}`
  );
  assert.equal(
    growthPartnerPhotoUrl(jpegPath, fakeClient),
    `https://test-project.supabase.co/storage/v1/object/public/partner-avatars/${jpegPath}`
  );
  assert.equal(
    growthPartnerPhotoUrl(jpgPath, fakeClient),
    `https://test-project.supabase.co/storage/v1/object/public/partner-avatars/${jpgPath}`
  );
  assert.equal(
    growthPartnerPhotoUrl(pngPath, fakeClient),
    `https://test-project.supabase.co/storage/v1/object/public/partner-avatars/${pngPath}`
  );

  // Full Supabase storage URLs pass through directly
  const fullUrl = `https://qwaehqsmodekbgvnaavz.supabase.co/storage/v1/object/public/partner-avatars/${userUuid}/${fileUuid}.webp`;
  assert.equal(growthPartnerPhotoUrl(fullUrl, fakeClient), fullUrl);

  // Untrusted external URLs must be rejected
  assert.equal(growthPartnerPhotoUrl('https://evil.test/pic', fakeClient), '');
  assert.equal(growthPartnerPhotoUrl('https://attacker.com/avatar.jpg', fakeClient), '');
  assert.equal(growthPartnerPhotoUrl('', fakeClient), '');
  assert.equal(growthPartnerPhotoUrl(null, fakeClient), '');
});

test('createBlankSalonProfile generates clean profile scoped to user metadata with zero demo data contamination', () => {
  const newUser = {
    id: 'user-uuid-1234',
    email: 'newowner@example.com',
    user_metadata: {
      salon_name: 'Glamour Lounge',
      full_name: 'Priya Sharma',
      phone_number: '+91 98765 43210',
      city: 'Mumbai',
    },
  };

  const blank = createBlankSalonProfile(newUser);
  assert.equal(blank.ownerId, 'user-uuid-1234');
  assert.equal(blank.businessName, 'Glamour Lounge');
  assert.equal(blank.ownerName, 'Priya Sharma');
  assert.equal(blank.email, 'newowner@example.com');
  assert.equal(blank.phone, '+91 98765 43210');
  assert.equal(blank.city, 'Mumbai');
  assert.equal(blank.subdomain, 'glamour-lounge');
  assert.equal(blank.ownerPhotoUrl, '', 'Avatar must be blank for a new account');
  assert.equal(blank.about, '', 'About text must be blank');
  assert.equal(blank.tagline, '', 'Tagline must be blank');

  // Verify none of the demo strings appear
  const serialized = JSON.stringify(blank).toLowerCase();
  assert.ok(!serialized.includes('arts by uma'), 'No demo salon name');
  assert.ok(!serialized.includes('uma tiwari'), 'No demo owner name');
  assert.ok(!serialized.includes('jhotwara'), 'No demo city');
});

test('salon state storage preserves account isolation and clearAllLocalUserState prevents state leakage', () => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    };
  }

  // User A saves state
  const userAId = 'user-a-1111';
  const profileA = {
    ...createBlankSalonProfile({ id: userAId, email: 'a@test.com', user_metadata: { salon_name: 'Salon A' } }),
    ownerId: userAId,
  };
  saveSalonState({
    profile: profileA,
    services: [],
    stylists: [],
    loyaltyConfig: { enabled: false, pointsPerRupee: 1, minRedeemPoints: 100, rupeePerPoint: 0.1, expiryMonths: 12 },
    selectedTemplateId: 1,
  }, userAId);

  // User B requests state - must NOT see User A's data
  const userBId = 'user-b-2222';
  const loadedForB = loadSalonState(userBId);
  assert.equal(loadedForB, null, 'User B must not load User A state');

  // User A can load their own state
  const loadedForA = loadSalonState(userAId);
  assert.ok(loadedForA);
  assert.equal(loadedForA?.profile.businessName, 'Salon A');

  // clearAllLocalUserState clears draft and legacy keys
  clearAllLocalUserState();
  const draftAfter = localStorage.getItem('nexora_draft_salon_data');
  const authAfter = localStorage.getItem('nexora_authenticated_profile');
  assert.equal(draftAfter, null);
  assert.equal(authAfter, null);
});
