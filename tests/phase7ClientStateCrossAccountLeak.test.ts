import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveSalonState,
  loadSalonState,
  clearAllLocalUserState,
  getScopedSalonStateKey,
  getScopedAuthProfileKey,
  getStoredAuthenticatedProfile,
  setStoredAuthenticatedProfile,
  SALON_STATE_STORAGE_KEY,
} from '../src/lib/salonStore.js';
import {
  writeLocalDraft,
  loadLocalDraft,
  clearLocalDraft,
  getScopedDraftStorageKey,
  DRAFT_STORAGE_KEY,
} from '../src/lib/autoSave.js';
import { createBlankSalonProfile } from '../src/lib/ownerSalonResolution.js';
import { queryKeys } from '../src/lib/cacheKeys.js';
import { DEFAULT_LOYALTY_CONFIG } from '../src/loyaltyData.js';

function setupMockLocalStorage() {
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
  (globalThis as any).window = globalThis;
}

test('PHASE 7 - Salon state is scoped by userId and salonId and never writes to global keys', () => {
  setupMockLocalStorage();
  localStorage.clear();

  const userAId = 'user-uuid-1111';
  const salonAId = 'salon-uuid-aaaa';
  const profileA = {
    ...createBlankSalonProfile({ id: userAId, email: 'ownerA@salon.com', user_metadata: { salon_name: "Owner A's Studio" } }),
    id: salonAId,
    ownerId: userAId,
    businessName: "Owner A's Studio",
  };

  const stateA = {
    profile: profileA,
    services: [{ id: 'srv-1', name: 'Master Cut', price: 500, durationMinutes: 30, category: 'Hair', description: '', icon: 'scissors', popular: true, showDuration: true }],
    stylists: [{ id: 'stf-1', name: 'Sarah', role: 'Stylist', avatarUrl: '', bio: '', phone: '', specialties: [], assignedServices: [], rating: 5, commissionRate: 20, status: 'Available' as const, accessRole: 'Service Provider (Assigned)' as const, hidePhone: false, schedule: [] }],
    loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
    selectedTemplateId: 'hair_salon' as const,
  };

  // Save for User A
  saveSalonState(stateA, userAId, salonAId);

  // 1. Verify scoped key format: nexora:salon:${userId}:${salonId}
  const scopedKey = getScopedSalonStateKey(userAId, salonAId);
  assert.equal(scopedKey, `nexora:salon:${userAId}:${salonAId}`);
  assert.ok(localStorage.getItem(scopedKey), 'Scoped key must be populated');

  // 2. Verify global keys are NOT written for authenticated tenant data
  assert.equal(localStorage.getItem(SALON_STATE_STORAGE_KEY), null, 'Global nexora_salon_state_v1 must not be populated');
  assert.equal(localStorage.getItem('salonState'), null, 'Global salonState must not exist');
  assert.equal(localStorage.getItem('profile'), null, 'Global profile must not exist');
  assert.equal(localStorage.getItem('currentSalon'), null, 'Global currentSalon must not exist');
  assert.equal(localStorage.getItem('websiteState'), null, 'Global websiteState must not exist');
  assert.equal(localStorage.getItem('partnerProfile'), null, 'Global partnerProfile must not exist');

  // 3. User B signs up / logs in: loadSalonState for User B must return null
  const userBId = 'user-uuid-2222';
  const loadedForB = loadSalonState(userBId, 'salon-uuid-bbbb');
  assert.equal(loadedForB, null, 'User B must NOT see User A cached salon state');

  // 4. Anonymous visitor (e.g. before login) must NOT load User A state
  const loadedForAnon = loadSalonState(null);
  assert.equal(loadedForAnon, null, 'Anonymous visitor must NOT load authenticated tenant state');

  // 5. User A loads their own state
  const loadedForA = loadSalonState(userAId, salonAId);
  assert.ok(loadedForA);
  assert.equal(loadedForA?.profile.businessName, "Owner A's Studio");
});

test('PHASE 7 - On logout, account switch, or new signup, clearAllLocalUserState purges previous tenant state', () => {
  setupMockLocalStorage();
  localStorage.clear();

  const userAId = 'user-uuid-1111';
  const profileA = {
    ...createBlankSalonProfile({ id: userAId, email: 'a@salon.com', user_metadata: { salon_name: 'Salon Alpha' } }),
    ownerId: userAId,
    businessName: 'Salon Alpha',
  };

  saveSalonState({
    profile: profileA,
    services: [],
    stylists: [],
    loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
    selectedTemplateId: 'hair_salon',
  }, userAId);

  setStoredAuthenticatedProfile({
    salonName: 'Salon Alpha',
    ownerName: 'Owner Alpha',
    email: 'a@salon.com',
  }, userAId);

  writeLocalDraft({
    ownerId: userAId,
    profile: profileA,
    services: [],
    stylists: [],
    loyaltyConfig: {},
  }, userAId);

  // Verify stored
  assert.ok(localStorage.getItem(getScopedSalonStateKey(userAId, 'default')));
  assert.ok(localStorage.getItem(getScopedAuthProfileKey(userAId)));
  assert.ok(localStorage.getItem(getScopedDraftStorageKey(userAId)));

  // Simulate logout or account switch
  clearAllLocalUserState();

  // Verify all tenant keys wiped
  assert.equal(localStorage.getItem(getScopedSalonStateKey(userAId, 'default')), null);
  assert.equal(localStorage.getItem(getScopedAuthProfileKey(userAId)), null);
  assert.equal(localStorage.getItem(getScopedDraftStorageKey(userAId)), null);
  assert.equal(localStorage.getItem('nexora_draft_salon_data'), null);
  assert.equal(localStorage.getItem('nexora_authenticated_profile'), null);
  assert.equal(localStorage.getItem('nexora_auth_profile_state'), null);

  // New User B signs up: initializes cleanly with blank profile
  const userBId = 'user-uuid-2222';
  const loadedForB = loadSalonState(userBId);
  assert.equal(loadedForB, null);

  const blankB = createBlankSalonProfile({ id: userBId, email: 'b@salon.com', user_metadata: { salon_name: 'Beta Salon' } });
  assert.equal(blankB.businessName, 'Beta Salon');
  assert.equal(blankB.ownerId, userBId);
  assert.notEqual(blankB.businessName, 'Salon Alpha');
});

test('PHASE 7 - Authenticated profile storage is strictly scoped to userId', () => {
  setupMockLocalStorage();
  localStorage.clear();

  const userAId = 'user-1';
  const userBId = 'user-2';

  // Cannot write without userId
  setStoredAuthenticatedProfile({ salonName: 'Ghost Salon' }, null);
  assert.equal(localStorage.getItem('nexora_auth_profile_state'), null, 'Must not write to un-scoped key');
  assert.equal(getStoredAuthenticatedProfile(null), null, 'Must not read without userId');

  // Write for User A
  setStoredAuthenticatedProfile({ salonName: 'Alpha Salon', ownerName: 'Alice' }, userAId);
  const profileA = getStoredAuthenticatedProfile(userAId);
  assert.equal(profileA?.salonName, 'Alpha Salon');

  // User B cannot read User A profile
  const profileB = getStoredAuthenticatedProfile(userBId);
  assert.equal(profileB, null);
});

test('PHASE 7 - Local drafts are scoped by ownerId and purged on clearLocalDraft', () => {
  setupMockLocalStorage();
  localStorage.clear();

  const userAId = 'owner-a';
  writeLocalDraft({
    ownerId: userAId,
    profile: { businessName: 'Draft A' },
    services: [],
    stylists: [],
    loyaltyConfig: {},
  }, userAId);

  // Un-scoped DRAFT_STORAGE_KEY must not contain User A draft
  assert.equal(localStorage.getItem(DRAFT_STORAGE_KEY), null);

  // Owner A can load their draft
  const draftA = loadLocalDraft(userAId);
  assert.equal((draftA?.profile as any)?.businessName, 'Draft A');

  // Another user cannot load Owner A draft
  const draftB = loadLocalDraft('owner-b');
  assert.equal(draftB, null);

  // Clearing for Owner A
  clearLocalDraft(userAId);
  assert.equal(loadLocalDraft(userAId), null);
});

test('PHASE 7 - Query keys for cache layers are strictly scoped by userId and salonId', () => {
  const userId = 'user-123';
  const salonId = 'salon-456';

  assert.deepEqual(queryKeys.salonProfile(userId, salonId), ['salon-profile', 'user-123', 'salon-456']);
  assert.deepEqual(queryKeys.salonServices(userId, salonId), ['salon-services', 'user-123', 'salon-456']);
  assert.deepEqual(queryKeys.salonStylists(userId, salonId), ['salon-stylists', 'user-123', 'salon-456']);
  assert.deepEqual(queryKeys.salonAppointments(userId, salonId), ['salon-appointments', 'user-123', 'salon-456']);
  assert.deepEqual(queryKeys.salonClients(userId, salonId), ['salon-clients', 'user-123', 'salon-456']);

  // Anonymous fallback
  assert.deepEqual(queryKeys.salonProfile(null, null), ['salon-profile', 'anonymous', 'default']);
});
