import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase.ts';
import {
  captureReferralIntentFromLocation,
  readReferralIntent,
  readPersistedReferralIntent,
  clearReferralIntent,
  persistReferralIntent,
} from '../src/onboarding/lib/referralPersistence.ts';
import { normalizeGrowthReferralCode } from '../src/lib/growthPartner.ts';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

test('Referral code in URL persists through multiple login/auth redirects and links to DB on registration', async () => {
  const mockStorage = new MemoryStorage();
  const mockLocation = {
    search: '',
    pathname: '/onboarding/signup',
    origin: 'https://fanal-templetes-app.vercel.app',
  };

  // Safe window environment that retains all standard global functions
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = Object.assign(Object.create(globalThis), {
    localStorage: mockStorage,
    location: mockLocation,
  });

  const referralCode = 'NEXORA-2D53E93B65B2';

  // 1. Initial touch on referral signup URL
  const initialSearch = `?ref=${referralCode}`;
  mockLocation.search = initialSearch;
  mockLocation.pathname = '/onboarding/signup';

  const capturedCode = captureReferralIntentFromLocation(initialSearch);
  assert.equal(capturedCode, normalizeGrowthReferralCode(referralCode));
  assert.equal(readReferralIntent(), referralCode);

  // 2. User gets redirected to login (query parameter ?ref= is dropped)
  mockLocation.search = '';
  mockLocation.pathname = '/onboarding/login';
  assert.equal(readReferralIntent(), referralCode, 'Referral intent persists across login redirect');
  assert.equal(readPersistedReferralIntent(), referralCode);

  // 3. User navigates to forgot password, then back to signup without query parameters
  mockLocation.pathname = '/onboarding/forgot-password';
  assert.equal(readReferralIntent(), referralCode, 'Referral intent persists through forgot-password route');

  mockLocation.pathname = '/onboarding/signup';
  mockLocation.search = '';
  assert.equal(readReferralIntent(), referralCode, 'Referral intent is preserved when returning to signup');

  // 4. Test real database capture and registration integration
  const local = await createLocalDatabase();
  const db = local.db;

  try {
    // Provision Growth Partner with the referral code
    const partnerId = randomUUID();
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'test-pw', $3::jsonb)",
      [partnerId, 'partner@example.com', JSON.stringify({ full_name: 'Alpha Partner' })]
    );
    await db.query("select public.provision_growth_partner($1, $2)", [partnerId, referralCode]);

    // Backend attribution exchange with the persisted referral code
    const attributionResult = (
      await local.asRequest({ sub: null, isAdmin: false }, async (conn) =>
        (await conn.query('select public.capture_growth_referral($1, $2) as result', [capturedCode, null])).rows[0].result
      )
    );

    assert.equal(attributionResult.valid, true);
    assert.equal(attributionResult.referral_code, referralCode);
    assert.match(attributionResult.token, /^[a-f0-9]{64}$/);

    // Register a new user using the attribution token
    const newUserId = randomUUID();
    const newUserEmail = 'new-salon-owner@example.com';
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'password123', $3::jsonb)",
      [
        newUserId,
        newUserEmail,
        JSON.stringify({
          full_name: 'Priya Sharma',
          phone_number: '+919845012345',
          growth_referral_token: attributionResult.token,
        }),
      ]
    );

    // Verify referral attribution row is created and correctly linked in the database
    const attributionRow = (
      await db.query(
        'select * from public.partner_referral_attribution where referred_user_id = $1',
        [newUserId]
      )
    ).rows[0];

    assert.ok(attributionRow, 'Database attribution row must exist for new user');
    assert.equal(attributionRow.referred_user_id, newUserId);
    assert.equal(attributionRow.partner_id, partnerId);
    assert.equal(attributionRow.referral_code, referralCode);
    assert.ok(attributionRow.referred_at);

    // Verify growth_onboarding row reflects referral attribution
    const onboardingRow = (
      await db.query('select * from public.growth_onboarding where user_id = $1', [newUserId])
    ).rows[0];

    assert.ok(onboardingRow, 'Onboarding record must exist');
    assert.equal(onboardingRow.growth_partner_id, partnerId);
    assert.equal(onboardingRow.referral_code, referralCode);

    // 5. Clean up referral intent after successful consumption
    clearReferralIntent();
    assert.equal(readPersistedReferralIntent(), '');
  } finally {
    await local.close();
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});
