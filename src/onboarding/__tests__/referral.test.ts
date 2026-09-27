import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureReferralIntentFromLocation,
  readReferralIntent,
  readPersistedReferralIntent,
  clearReferralIntent,
  persistReferralIntent,
  REFERRAL_INTENT_STORAGE_KEY,
} from '../lib/referralPersistence';
import { captureSignupReferral, prepareSignupAttribution } from '../lib/referralAttribution';
import { normalizeGrowthReferralCode } from '../../lib/growthPartner';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

test('navigation flow with ?ref= query parameter persists in sessionStorage and works with captureSignupReferral', async () => {
  const mockSessionStorage = new MemoryStorage();
  const mockLocalStorage = new MemoryStorage();
  const mockLocation = {
    search: '',
    pathname: '/onboarding/signup',
    origin: 'https://fanal-templetes-app.vercel.app',
  };

  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;

  (globalThis as any).window = Object.assign(Object.create(globalThis), {
    sessionStorage: mockSessionStorage,
    localStorage: mockLocalStorage,
    location: mockLocation,
  });

  const referralCode = 'NEXORA-2D53E93B65B2';
  const canonicalCode = normalizeGrowthReferralCode(referralCode);
  const mockToken = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';

  // Mock fetch for /api/referral-attribution
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/api/referral-attribution')) {
      let bodyCode = '';
      if (init?.body) {
        try {
          const parsed = JSON.parse(init.body as string);
          bodyCode = parsed.code || '';
        } catch {}
      }

      if (bodyCode === canonicalCode || (!bodyCode && init?.method === 'GET')) {
        return new Response(
          JSON.stringify({
            valid: true,
            referralCode: canonicalCode,
            token: mockToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          valid: false,
          referralCode: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  }) as any;

  try {
    // 1. Initial touch with ?ref= in URL query parameter
    const initialQuery = `?ref=${referralCode}`;
    mockLocation.search = initialQuery;
    mockLocation.pathname = '/onboarding/signup';

    const captured = captureReferralIntentFromLocation(initialQuery);
    assert.equal(captured, canonicalCode, 'Captured code must be normalized to canonical format');

    // Verify persistence in sessionStorage
    assert.equal(
      mockSessionStorage.getItem(REFERRAL_INTENT_STORAGE_KEY),
      canonicalCode,
      'Referral code must be persisted into sessionStorage'
    );
    assert.equal(readPersistedReferralIntent(), canonicalCode);

    // 2. Navigation redirect to /onboarding/login (query string stripped)
    mockLocation.search = '';
    mockLocation.pathname = '/onboarding/login';
    assert.equal(
      readReferralIntent(),
      canonicalCode,
      'Referral code must survive query parameter stripping on redirect to login'
    );

    // 3. Navigation redirect to /onboarding/signup
    mockLocation.pathname = '/onboarding/signup';
    assert.equal(
      readReferralIntent(),
      canonicalCode,
      'Referral code must still be accessible on signup screen'
    );

    // 4. Test captureSignupReferral reading and validating intent
    const verifiedCode = await captureSignupReferral(readReferralIntent());
    assert.equal(verifiedCode, canonicalCode, 'captureSignupReferral must return the verified canonical code');

    // 5. Test prepareSignupAttribution generating valid one-time capability token
    const attributionToken = await prepareSignupAttribution(readReferralIntent());
    assert.equal(attributionToken, mockToken, 'prepareSignupAttribution must return the 64-hex capability token');

    // 6. Test invalid referral code
    const invalidResult = await captureSignupReferral('INVALID-CODE-999');
    assert.equal(invalidResult, '', 'Invalid referral code must safely return empty string');

    // 7. Cleanup referral intent on registration completion
    clearReferralIntent();
    assert.equal(
      mockSessionStorage.getItem(REFERRAL_INTENT_STORAGE_KEY),
      null,
      'sessionStorage must be cleared after clearReferralIntent'
    );
    assert.equal(readPersistedReferralIntent(), '');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});
