import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase.ts';
import { validateSignup } from '../src/onboarding/lib/flow.ts';
import { isGrowthReferralCodeFormat, normalizeGrowthReferralCode, resolveGrowthPartnerGate } from '../src/lib/growthPartner.ts';
import {
  captureReferralIntentFromLocation,
  readReferralIntent,
  clearReferralIntent,
  persistReferralIntent,
} from '../src/onboarding/lib/referralPersistence.ts';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

test('Phase 1 Requirement 1: valid referral prefill, trim and uppercase safely', () => {
  const mockStorage = new MemoryStorage();
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = Object.assign(Object.create(globalThis), {
    localStorage: mockStorage,
    sessionStorage: mockStorage,
    location: { search: '?ref=  nexora-2d53e93b65b2  ', pathname: '/onboarding/signup' },
  });

  try {
    const rawInput = '  nexora-2d53e93b65b2  ';
    assert.equal(isGrowthReferralCodeFormat(rawInput), true);
    const normalized = normalizeGrowthReferralCode(rawInput);
    assert.equal(normalized, 'NEXORA-2D53E93B65B2');

    const captured = captureReferralIntentFromLocation('?ref=  nexora-2d53e93b65b2  ');
    assert.equal(captured, 'NEXORA-2D53E93B65B2');
    assert.equal(readReferralIntent(), 'NEXORA-2D53E93B65B2');
    clearReferralIntent();
  } finally {
    if (originalWindow) (globalThis as any).window = originalWindow;
    else delete (globalThis as any).window;
  }
});

test('Phase 1 Requirement 2: invalid referral code handling', async () => {
  const local = await createLocalDatabase();
  try {
    const invalidInput = 'INVALID-REF-999999999';
    const result = (
      await local.asRequest({ sub: null, isAdmin: false }, async (conn) =>
        (await conn.query('select public.capture_growth_referral($1, $2) as result', [invalidInput, null])).rows[0].result
      )
    );
    assert.equal(result.valid, false, 'Invalid referral code must be rejected by backend');
  } finally {
    await local.close();
  }
});

test('Phase 1 Requirement 3: autofilled password and signup validation', () => {
  const autofilled = {
    fullName: '  Sunita Meena  ',
    email: 'sunita.meena@example.com  ',
    phone: '+91 98450 12345',
    password: 'Password123!',
    confirm: 'Password123!',
  };

  const validation = validateSignup(autofilled);
  assert.equal(validation.ok, true, 'Autofilled credentials with valid fields must pass validation');
  assert.equal(Object.keys(validation.errors).length, 0);

  const shortPw = validateSignup({ ...autofilled, password: '123', confirm: '123' });
  assert.equal(shortPw.ok, false);
  assert.ok(shortPw.errors.password?.includes('at least 6 characters'));
});

test('Phase 1 Requirement 4: referral survives handoff token exchange into database', async () => {
  const local = await createLocalDatabase();
  const db = local.db;
  try {
    const partnerId = randomUUID();
    const refCode = 'NEXORA-2D53E93B65B2';

    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'test-pw', $3::jsonb)",
      [partnerId, 'partner@example.com', JSON.stringify({ full_name: 'Growth Partner Alpha' })]
    );
    await db.query("select public.provision_growth_partner($1, $2)", [partnerId, refCode]);

    const attribution = (
      await local.asRequest({ sub: null, isAdmin: false }, async (conn) =>
        (await conn.query('select public.capture_growth_referral($1, $2) as result', [refCode, null])).rows[0].result
      )
    );
    assert.equal(attribution.valid, true);

    const newUserId = randomUUID();
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'pw123456', $3::jsonb)",
      [
        newUserId,
        'referred.owner@example.com',
        JSON.stringify({
          full_name: 'Referred Salon Owner',
          phone_number: '+919845099887',
          growth_referral_token: attribution.token,
        }),
      ]
    );

    const attrRow = (
      await db.query('select * from public.partner_referral_attribution where referred_user_id = $1', [newUserId])
    ).rows[0];
    assert.ok(attrRow, 'Attribution record must exist');
    assert.equal(attrRow.partner_id, partnerId);
    assert.equal(attrRow.referral_code, refCode);

    const onbRow = (
      await db.query('select * from public.growth_onboarding where user_id = $1', [newUserId])
    ).rows[0];
    assert.ok(onbRow);
    assert.equal(onbRow.growth_partner_id, partnerId);
  } finally {
    await local.close();
  }
});

test('Phase 1 Requirement 5: referred normal user denied partner access', () => {
  const normalUser = {
    userId: 'user-normal-salon-owner-uuid',
    loading: false,
    isMockMode: false,
    partnerRow: null,
    loadError: null,
    applicationStatus: null,
  };

  const gate = resolveGrowthPartnerGate(normalUser);
  assert.equal(gate, 'unauthorized', 'Normal referred user without partner record must resolve to unauthorized');
});

test('Phase 1 Requirement 6: approved partner can access only own partner data', async () => {
  const local = await createLocalDatabase();
  const db = local.db;
  try {
    const partnerA = randomUUID();
    const partnerB = randomUUID();

    await db.query("insert into auth.users(id, email, encrypted_password) values ($1, 'a@partner.com', 'test-pw'), ($2, 'b@partner.com', 'test-pw')", [partnerA, partnerB]);
    await db.query("select public.provision_growth_partner($1, 'NEXORA-PARTNERA')", [partnerA]);
    await db.query("select public.provision_growth_partner($1, 'NEXORA-PARTNERB')", [partnerB]);

    const rowA = (
      await local.asRequest({ sub: partnerA, isAdmin: false }, async (conn) =>
        (await conn.query('select public.get_my_referral_code() as code')).rows[0]
      )
    );
    assert.equal(rowA.code, 'NEXORA-PARTNERA');

    const rowB = (
      await local.asRequest({ sub: partnerB, isAdmin: false }, async (conn) =>
        (await conn.query('select public.get_my_referral_code() as code')).rows[0]
      )
    );
    assert.equal(rowB.code, 'NEXORA-PARTNERB');

    const crossCheck = (
      await local.asRequest({ sub: partnerA, isAdmin: false }, async (conn) =>
        (await conn.query('select * from public.growth_partners where user_id = $1', [partnerB])).rows
      )
    );
    assert.equal(crossCheck.length, 0, 'Partner A cannot select Partner B data');
  } finally {
    await local.close();
  }
});
