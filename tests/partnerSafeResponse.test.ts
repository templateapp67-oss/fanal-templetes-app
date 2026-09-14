// ============================================================================
// PHASE 5 — 5.2 SAFE RESPONSE.
//
// Public/client validation must not expose:
//   • the partner's private profile   • internal IDs unnecessarily
//   • bank details                    • commission configuration
//   • admin metadata                  • private contact details
// and must return only required safe information.
//
// These tests do not restate the rule — they probe every surface that answers
// a validation question, with the most hostile payload each surface can be
// handed, and assert that nothing outside the allowlist comes back:
//
//   1. the projector itself (unit)          src/lib/safePartnerResponse.ts
//   2. the anonymous HTTP endpoint          POST/GET /api/referral-attribution
//   3. the committed SQL RPCs on a REAL PostgreSQL engine (PGlite), called as
//      `anon` and as `authenticated` through the local gateway
//   4. the browser wrappers                 src/lib/growthPartner.ts,
//                                           src/onboarding/lib/*
//
// The hostile payloads contain a partner row that DOES hold bank details,
// commission configuration, admin metadata and private contact details — so
// the tests prove the response is built from an allowlist, not that the
// database happens to be clean.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLocalDatabase } from '../server/localSupabase';
import { registerReferralAttributionRoutes } from '../server/referralAttribution';
import {
  REFERRAL_CAPABILITY,
  SAFE_RELATIONSHIP_FIELDS,
  SAFE_VALIDATION_FIELDS,
  capabilityExpiry,
  findPrivateResponseFields,
  isSafeValidationResponse,
  projectReferralRelationship,
  projectValidationResponse,
  publicValidationBody,
} from '../src/lib/safePartnerResponse';

const PARTNER = 'a0000000-0000-4000-8000-000000000009';
const VISITOR = 'b0000000-0000-4000-8000-000000000009';
const CODE = 'NEXORA-RAHUL25';
const CAPABILITY = 'c'.repeat(64);

/** Every category 5.2 forbids, in one payload — the worst case per surface. */
const HOSTILE = {
  valid: true,
  referral_code: CODE,
  token: CAPABILITY,
  expires_at: '2027-01-01T00:00:00.000Z',
  // private partner profile
  growth_partner_id: PARTNER,
  partner_id: PARTNER,
  user_id: PARTNER,
  partner_name: 'PRIVATE-NAME',
  full_name: 'PRIVATE-NAME',
  business_name: 'PRIVATE-BUSINESS',
  kyc_status: 'approved',
  address: '1 PRIVATE-ADDRESS',
  // bank details
  bank_account_number: 'BANK-MARKER-9931',
  ifsc: 'HDFC0001234',
  upi_id: 'partner@okbank',
  // commission configuration
  commission_rate: 30,
  commission_type: 'percentage',
  payout_amount: 15000,
  // admin metadata
  is_admin: true,
  role: 'service_role',
  raw_app_meta_data: { is_admin: true, internal_note: 'ADMIN-MARKER' },
  // private contact details
  email: 'partner.private@example.com',
  phone: '+919999900001',
  whatsapp: '+919999900001',
};

// ---------------------------------------------------------------------------
// 1. The projector: only the allowlist leaves, and hostile values are refused.
// ---------------------------------------------------------------------------

test('5.2. every validation surface returns exactly its allowlist', () => {
  // Exact key sets, surface by surface — nothing here is derived at runtime.
  assert.deepEqual(Object.keys(projectValidationResponse('validate-code', HOSTILE)).sort(), ['referralCode', 'valid']);
  for (const surface of ['capture-attribution', 'prepare-signup'] as const) {
    assert.deepEqual(
      Object.keys(projectValidationResponse(surface, HOSTILE)).sort(),
      ['expiresAt', 'referralCode', 'token', 'valid'],
      surface
    );
  }

  for (const surface of ['validate-code', 'capture-attribution', 'prepare-signup'] as const) {
    const projected = projectValidationResponse(surface, HOSTILE);
    // Every emitted key maps back to a documented allowlist field.
    const camel = (field: string) => (field === 'referral_code' ? 'referralCode' : field === 'expires_at' ? 'expiresAt' : field);
    const allowed = new Set(SAFE_VALIDATION_FIELDS[surface].map(camel));
    assert.ok(Object.keys(projected).every((key) => allowed.has(key)), surface);
    assert.equal(projected.valid, true);
    assert.equal(projected.referralCode, CODE);
    assert.deepEqual(findPrivateResponseFields(projected), [], surface);
  }

  // Code validation is a question, not a capability: a token returned by a
  // drifted backend is dropped instead of handed to the browser.
  assert.equal(projectValidationResponse('validate-code', HOSTILE).token, undefined);
});

test('5.2. one definition reads both spellings: database jsonb and HTTP body', () => {
  const databaseShape = { valid: true, referral_code: CODE, token: CAPABILITY, expires_at: '2027-01-01T00:00:00.000Z' };
  const httpShape = { valid: true, referralCode: CODE, token: CAPABILITY, expiresAt: '2027-01-01T00:00:00.000Z' };
  const fromDatabase = projectValidationResponse('capture-attribution', databaseShape);
  const fromHttp = projectValidationResponse('capture-attribution', httpShape);
  assert.deepEqual(fromDatabase, fromHttp);
  assert.deepEqual(publicValidationBody(fromHttp), { valid: true, referralCode: CODE });

  // A hostile camelCase answer is refused exactly like its snake_case twin —
  // this is the regression that would otherwise let `referralCode: 'PRIVATE-NAME'`
  // through the HTTP client.
  for (const payload of [{ valid: true, referralCode: 'PRIVATE-NAME' }, { valid: true, referral_code: 'PRIVATE-NAME' }]) {
    assert.deepEqual(publicValidationBody(projectValidationResponse('capture-attribution', payload)), {
      valid: false,
      token: null,
    });
  }
});

test('5.2. the public body is the whole answer, and a private value cannot be echoed', () => {
  const capture = publicValidationBody(projectValidationResponse('capture-attribution', HOSTILE));
  assert.deepEqual(capture, { valid: true, referralCode: CODE });
  // The cookie lifetime stays server-side.
  assert.equal('expires_at' in capture, false);
  assert.equal('expiresAt' in capture, false);

  const prepare = publicValidationBody(projectValidationResponse('prepare-signup', HOSTILE), { includeToken: true });
  assert.deepEqual(prepare, { valid: true, referralCode: CODE, token: CAPABILITY });

  // Capture must not put the capability in the JSON body (cookie only).
  assert.deepEqual(publicValidationBody(projectValidationResponse('capture-attribution', HOSTILE), { includeToken: false }), {
    valid: true,
    referralCode: CODE,
  });

  // Fail closed: a "valid" answer with no usable canonical code is reported
  // invalid rather than as a half-answer the caller might act on.
  for (const payload of [
    { valid: true },
    { valid: true, referral_code: 'PRIVATE-NAME' },
    { valid: true, referral_code: 'partner.private@example.com' },
    { valid: true, referral_code: 'x'.repeat(200) },
    { valid: 'true', referral_code: CODE },
  ]) {
    assert.deepEqual(publicValidationBody(projectValidationResponse('capture-attribution', payload)), {
      valid: false,
      token: null,
    });
  }

  // An unusable capability never becomes a token, and expiry never invents one.
  assert.equal(projectValidationResponse('prepare-signup', { valid: true, token: 'forged' }).token, undefined);
  assert.equal(projectValidationResponse('prepare-signup', { valid: true, token: CAPABILITY + 'ff' }).token, undefined);
  assert.equal(projectValidationResponse('prepare-signup', { valid: true, expires_at: 'never' }).expiresAt, undefined);
  assert.equal(
    projectValidationResponse('prepare-signup', { valid: true, expires_at: HOSTILE.expires_at }).expiresAt,
    HOSTILE.expires_at,
  );
  assert.equal(REFERRAL_CAPABILITY.test(CAPABILITY), true);

  // The cookie lifetime falls back to the documented 7-day TTL, not to a
  // browser-supplied or missing value.
  assert.equal(
    capabilityExpiry({ valid: true, referralCode: CODE }, 1_000_000).getTime(),
    1_000_000 + 7 * 24 * 60 * 60 * 1000,
  );
});

test('5.2. the audit backstop names the six forbidden categories', () => {
  const findings = findPrivateResponseFields(HOSTILE);
  const categories = new Set(findings.map((finding) => finding.category));
  assert.deepEqual(
    [...categories].sort(),
    ['admin-metadata', 'bank-details', 'commission-configuration', 'internal-id', 'private-contact', 'private-partner-profile'],
  );
  // Paths are reported, values never are.
  assert.ok(findings.every((finding) => !finding.path.includes('BANK-MARKER')));
  assert.equal(findings.find((finding) => finding.path === 'bank_account_number')?.category, 'bank-details');
  assert.equal(findings.find((finding) => finding.path === 'commission_rate')?.category, 'commission-configuration');
  assert.equal(findings.find((finding) => finding.path === 'is_admin')?.category, 'admin-metadata');
  assert.equal(findings.find((finding) => finding.path === 'email')?.category, 'private-contact');
  assert.equal(findings.find((finding) => finding.path === 'partner_name')?.category, 'private-partner-profile');
  assert.equal(findings.find((finding) => finding.path === 'growth_partner_id')?.category, 'internal-id');

  // Nested objects and arrays are scanned, whatever the key is called.
  const nested = { rows: [{ label: 'partner.private@example.com' }, { meta: { v: PARTNER } }] };
  const nestedFindings = findPrivateResponseFields(nested);
  assert.deepEqual(
    nestedFindings.map((finding) => [finding.path, finding.category]),
    [['rows.0.label', 'private-contact'], ['rows.1.meta.v', 'internal-id']],
  );

  // The documented relationship fields are clean once exempted. `allow` skips
  // the key rules; the one required id is named explicitly in ignoreValues, so
  // the exemption stays visible at the call site.
  const relationship = {
    growth_partner_id: PARTNER,
    referral_code: CODE,
    linked_at: '2026-09-14T00:00:00.000Z',
    status: 'linked',
    partner_name: 'Partner Anita',
  };
  assert.equal(isSafeValidationResponse(relationship), false, 'without the exemption the id is flagged');
  assert.deepEqual(
    findPrivateResponseFields(relationship).map((finding) => [finding.path, finding.category]),
    [['growth_partner_id', 'internal-id'], ['partner_name', 'private-partner-profile']],
  );
  assert.deepEqual(
    findPrivateResponseFields(relationship, { allow: SAFE_RELATIONSHIP_FIELDS, ignoreValues: [PARTNER] }),
    []
  );
  assert.equal(isSafeValidationResponse(relationship, { allow: SAFE_RELATIONSHIP_FIELDS, ignoreValues: [PARTNER] }), true);
  assert.equal(
    findPrivateResponseFields({ ...relationship, partner_name: 'partner.private@example.com' }, {
      allow: SAFE_RELATIONSHIP_FIELDS,
      ignoreValues: [PARTNER],
    }).length,
    1,
    'an exempted key still may not carry a private value',
  );
});

// ---------------------------------------------------------------------------
// 2. The anonymous HTTP endpoint.
// ---------------------------------------------------------------------------

async function withEndpoint(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>,
  run: (endpoint: string) => Promise<void>
) {
  const app = express();
  app.use(express.json());
  registerReferralAttributionRoutes(app, rpc as any);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(`${origin}/api/referral-attribution`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function hostileRpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: any }> {
  void fn;
  void args;
  return Promise.resolve({ data: HOSTILE, error: null });
}

test('5.2. /api/referral-attribution answers only valid + the canonical code (+ capability)', async () => {
  const writes: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => writes.push(args.map(String).join(' '));
  try {
    await withEndpoint(hostileRpc, async (endpoint) => {
      // POST — anonymous capture. The capability travels in the HttpOnly
      // cookie only, never in the JSON body, and no partner field survives.
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'nexora-rahul25' }),
      });
      assert.equal(response.status, 200);
      const capture: any = await response.json();
      assert.deepEqual(capture, { valid: true, referralCode: CODE });
      assert.match(response.headers.get('set-cookie')!, new RegExp(`nexora_referral=${CAPABILITY}`));

      // GET — signup preparation, the one surface that needs the capability in JS.
      response = await fetch(endpoint, { headers: { cookie: `nexora_referral=${CAPABILITY}` } });
      const prepare: any = await response.json();
      assert.deepEqual(prepare, { valid: true, referralCode: CODE, token: CAPABILITY });

      const serialized = JSON.stringify([capture, prepare]);
      for (const marker of ['PRIVATE-NAME', 'PRIVATE-BUSINESS', 'BANK-MARKER-9931', 'ADMIN-MARKER', 'partner.private@example.com', '+919999900001', PARTNER]) {
        assert.ok(!serialized.includes(marker), marker);
      }
      assert.ok(!serialized.includes('expires_at'));
      assert.equal(isSafeValidationResponse(capture, { ignoreValues: [CODE] }), true);
      assert.equal(isSafeValidationResponse(prepare, { ignoreValues: [CODE, CAPABILITY] }), true);
    });
  } finally {
    console.warn = originalWarn;
  }

  // The drifted database contract is reported to operators as field paths and
  // categories — with no values, and without changing the safe answer.
  const drift = writes.filter((line) => line.includes('partner_response_drift'));
  assert.ok(drift.length >= 2, `expected drift logs, got ${writes.length} lines`);
  for (const line of drift) {
    assert.doesNotMatch(line, /BANK-MARKER|PRIVATE-NAME|partner\.private@example\.com|\+919999900001|ADMIN-MARKER/);
  }
  const reported = JSON.parse(drift[0]);
  assert.equal(reported.event, 'partner_response_drift');
  assert.ok(reported.dropped.some((entry: any) => entry.category === 'bank-details' && entry.path === 'bank_account_number'));
  assert.ok(reported.dropped.some((entry: any) => entry.category === 'admin-metadata' && entry.path === 'is_admin'));
});

test('5.2. a valid-but-incomplete backend answer fails closed and clears the cookie', async () => {
  for (const data of [
    // A private value used as a "code", plus a forged capability.
    { valid: true, referral_code: 'partner.private@example.com', token: 'forged' },
    // Claimed valid, but no capability was issued: a half-answer is not a link.
    { valid: true, referral_code: CODE },
    // A capability without a code cannot be tied to a partner.
    { valid: true, token: CAPABILITY },
  ]) {
    await withEndpoint(async () => ({ data, error: null }), async (endpoint) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'NEXORA-RAHUL25' }),
      });
      assert.deepEqual(await response.json(), { valid: false, token: null }, JSON.stringify(data));
      assert.match(response.headers.get('set-cookie') || '', /nexora_referral=;/, JSON.stringify(data));
    });
  }
});

// ---------------------------------------------------------------------------
// 3. The committed SQL, on a real PostgreSQL engine, called as anon and as an
//    authenticated user. The database rows DO hold private partner data.
// ---------------------------------------------------------------------------

async function setupDatabase() {
  const local = await createLocalDatabase();
  const db = local.db;
  await db.query(
    "insert into auth.users(id, email, encrypted_password, raw_app_meta_data) values ($1,$2,'test-only','{\"is_admin\":true,\"internal_note\":\"ADMIN-MARKER\"}'::jsonb)",
    [PARTNER, 'partner.private@example.com']
  );
  await db.query('insert into auth.users(id, email, encrypted_password) values ($1,$2,\'test-only\')', [
    VISITOR,
    'visitor@example.com',
  ]);
  // A partner profile that really does hold the private data 5.2 forbids.
  await db.query('alter table public.profiles add column bank_account_number text');
  await db.query(
    `update public.profiles set full_name = 'PRIVATE-NAME', phone_number = '+919999900001',
       email = 'partner.private@example.com', bank_account_number = 'BANK-MARKER-9931'
     where id = $1`,
    [PARTNER]
  );
  await db.query("select public.provision_growth_partner($1, 'NEXORA-RAHUL25')", [PARTNER]);
  return local;
}

const rpcAs = (local: any, context: { sub: string | null; isAdmin: boolean }, fn: string, args: any[] = []) =>
  local.asRequest(context, async (db: any) => {
    const placeholders = args.map((_: unknown, index: number) => `$${index + 1}`).join(', ');
    return (await db.query(`select public.${fn}(${placeholders}) as result`, args)).rows[0].result;
  });

test('5.2. the anonymous RPCs return only the documented validation fields', async () => {
  const local = await setupDatabase();
  try {
    const anon = { sub: null, isAdmin: false };
    const capture: any = await rpcAs(local, anon, 'capture_growth_referral', ['nexora-rahul25', null]);
    assert.deepEqual(Object.keys(capture).sort(), ['expires_at', 'referral_code', 'token', 'valid']);
    assert.equal(capture.valid, true);
    assert.equal(capture.referral_code, CODE);
    assert.match(capture.token, REFERRAL_CAPABILITY);

    const prepare: any = await rpcAs(local, anon, 'prepare_growth_referral_signup', [capture.token]);
    assert.deepEqual(Object.keys(prepare).sort(), ['expires_at', 'referral_code', 'token', 'valid']);

    // The partner row behind the code holds PRIVATE-NAME / BANK-MARKER-9931 /
    // ADMIN-MARKER, and none of it appears in either anonymous answer.
    const serialized = JSON.stringify([capture, prepare]);
    for (const marker of ['PRIVATE-NAME', 'BANK-MARKER-9931', 'ADMIN-MARKER', 'partner.private@example.com', '+919999900001', PARTNER, 'is_admin']) {
      assert.ok(!serialized.includes(marker), marker);
    }
    assert.deepEqual(findPrivateResponseFields(prepare, { allow: SAFE_VALIDATION_FIELDS['prepare-signup'] }), []);
  } finally {
    await local.close();
  }
});

test('5.2. authenticated code validation and the own-relationship read stay minimal', async () => {
  const local = await setupDatabase();
  try {
    const validated: any = await rpcAs(local, { sub: VISITOR, isAdmin: false }, 'validate_growth_referral_code', ['NEXORA-RAHUL25']);
    assert.deepEqual(validated, { valid: true, referral_code: CODE });

    const linked: any = await rpcAs(local, { sub: VISITOR, isAdmin: false }, 'link_my_growth_referral', ['NEXORA-RAHUL25']);
    // The related-user disclosure is exactly the documented relationship: the
    // partner's display name, never their profile, bank, commission or admin row.
    assert.deepEqual(Object.keys(linked).sort(), ['growth_partner_id', 'linked_at', 'partner_name', 'referral_code', 'status']);
    assert.equal(linked.partner_name, 'PRIVATE-NAME');
    assert.deepEqual(
      findPrivateResponseFields(linked, { allow: SAFE_RELATIONSHIP_FIELDS, ignoreValues: [linked.growth_partner_id] }),
      []
    );
    const serialized = JSON.stringify(linked);
    for (const marker of ['BANK-MARKER-9931', 'ADMIN-MARKER', 'partner.private@example.com', '+919999900001', 'is_admin']) {
      assert.ok(!serialized.includes(marker), marker);
    }

    const relationship: any = await rpcAs(local, { sub: VISITOR, isAdmin: false }, 'get_my_growth_referral');
    assert.deepEqual(Object.keys(relationship).sort(), ['growth_partner_id', 'linked_at', 'partner_name', 'referral_code', 'status']);
    assert.deepEqual(Object.keys(projectReferralRelationship(relationship)!), [...SAFE_RELATIONSHIP_FIELDS]);
  } finally {
    await local.close();
  }
});

// ---------------------------------------------------------------------------
// 4. The browser wrappers, driven through a hostile HTTP layer.
// ---------------------------------------------------------------------------

function stubFetch(payload: unknown): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('5.2. the client validation wrapper drops everything outside the allowlist', async () => {
  const restore = stubFetch(HOSTILE);
  try {
    const { validateGrowthReferralCode, getMyGrowthReferral, linkMyGrowthReferral } = await import('../src/lib/growthPartner');

    const validated = await validateGrowthReferralCode('nexora-rahul25');
    assert.deepEqual(validated, { valid: true, referral_code: CODE });
    assert.deepEqual(Object.keys(validated).sort(), ['referral_code', 'valid']);
    assert.deepEqual(findPrivateResponseFields(validated), []);

    // The own-relationship reads keep the five documented fields (+ the id the
    // portal uses) and drop bank/commission/admin/contact extras entirely.
    for (const relationship of [await getMyGrowthReferral(), await linkMyGrowthReferral('NEXORA-RAHUL25')]) {
      assert.deepEqual(Object.keys(relationship!).sort(), [...SAFE_RELATIONSHIP_FIELDS].sort());
      assert.equal(relationship!.partner_name, 'PRIVATE-NAME');
      assert.deepEqual(
        findPrivateResponseFields(relationship, { allow: [...SAFE_RELATIONSHIP_FIELDS], ignoreValues: [PARTNER] }),
        []
      );
      assert.ok(!/BANK-MARKER|ADMIN-MARKER|partner\.private@example\.com|9999900001/.test(JSON.stringify(relationship)));
    }

    // A relationship that cannot be projected fails closed: the read answers
    // "no usable relationship" and the write path refuses to report success.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ growth_partner_id: 'p-1', referral_code: CODE }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    assert.equal(await getMyGrowthReferral(), null);
    await assert.rejects(linkMyGrowthReferral(CODE), /incomplete relationship/i);
  } finally {
    restore();
  }
});

test('5.2. the onboarding client keeps only the code and the one-use capability', async () => {
  const restore = stubFetch({ ...HOSTILE, referralCode: CODE, expiresAt: HOSTILE.expires_at });
  try {
    const { captureSignupReferral, prepareSignupAttribution } = await import('../src/onboarding/lib/referralAttribution');
    // Both helpers return a single scalar: `referralCode` is re-validated as a
    // canonical code, and the capability as an opaque 64-hex value.
    assert.equal(await captureSignupReferral('NEXORA-RAHUL25'), CODE);
    assert.equal(await prepareSignupAttribution(), CAPABILITY);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ valid: true, referralCode: 'partner.private@example.com', token: 'forged' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    assert.equal(await captureSignupReferral('NEXORA-RAHUL25'), '');
    assert.equal(await prepareSignupAttribution(), undefined);
  } finally {
    restore();
  }
});

test('5.2. the linking screen returns the safe relationship, not the RPC row', async () => {
  const { linkReferralCode } = await import('../src/onboarding/lib/auth');
  const client = {
    rpc: async () => ({ data: { ...HOSTILE, status: 'linked', linked_at: '2026-09-14T00:00:00.000Z' }, error: null }),
  } as any;
  const result = await linkReferralCode(client, 'nexora-rahul25');
  assert.deepEqual(result, { referralCode: CODE, partnerName: 'PRIVATE-NAME' });
  assert.deepEqual(Object.keys(result).sort(), ['partnerName', 'referralCode']);
});
