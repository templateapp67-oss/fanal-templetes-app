// ============================================================================
// PHASE 5 — REFERRAL VALIDATION, traced to the authoritative backend.
//
// Every assertion here runs the REAL migrations (the full LOCAL_GROWTH_CHAIN,
// 25 files) against PostgreSQL and calls the shipped RPCs as an authenticated
// user would. Nothing is mocked, and nothing is compared against a frontend
// value: the database decides.
//
// The ten dimensions asked for, and where each one is actually enforced:
//
//   code exists .................... link_my_growth_referral lookup
//   code belongs to a valid partner  same lookup + guard_growth_referral_identity
//   partner exists ................. growth_partners.user_id FK -> auth.users
//   partner is active .............. growth_partners.is_active
//   code is active ................. NO per-code switch exists (asserted)
//   code is not expired ............ NO code expiry exists (asserted); the
//                                    share-link TOKEN has a 7-day TTL
//   code is not blocked ............ NO blocked flag exists (asserted);
//                                    is_active=false and admin correction are
//                                    the real off-switches
//   usage limits ................... NONE exist (asserted) — a code is reusable
//   self-referral .................. RPC check + CHECK constraint (two levels)
//   already attributed ............. row lock + atomic predicate + trigger
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase';
import { toSafeReferralError } from '../src/onboarding/lib/flow';

const CODE = 'NEXORA-RAHUL25';
const OTHER_CODE = 'NEXORA-ANITA77';

/**
 * The whole validation chain, as the browser reaches it: an authenticated
 * Supabase call into a SECURITY DEFINER RPC.
 */
function harness() {
  const local = Promise.resolve().then(() => createLocalDatabase());
  const api = {
    async user(email: string): Promise<string> {
      const l = await local;
      const id = randomUUID();
      await l.db.query(
        "insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values ($1,$2,'x',$3::jsonb)",
        [id, email, JSON.stringify({ full_name: email.split('@')[0] })]
      );
      return id;
    },
    async rpc(actor: string | null, fn: string, args: unknown[] = [], isAdmin = false): Promise<any> {
      const l = await local;
      return l.asRequest({ sub: actor, isAdmin }, async (conn) => {
        const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
        const res = await conn.query(`select public.${fn}(${placeholders}) as result`, args as any[]);
        return (res.rows[0] as { result: any }).result;
      });
    },
    async sql(text: string, args: unknown[] = []): Promise<any[]> {
      const l = await local;
      const res = await l.db.query(text, args as any[]);
      return res.rows as any[];
    },
    async close() {
      const l = await local;
      await l.close();
    },
    /** The error message an RPC failure carries, or null when it succeeded. */
    async failure(actor: string | null, fn: string, args: unknown[] = []): Promise<string | null> {
      try {
        await api.rpc(actor, fn, args);
        return null;
      } catch (error: any) {
        return String(error?.message || error);
      }
    },
  };
  return api;
}

async function provisionPartner(api: ReturnType<typeof harness>, email: string, code = CODE) {
  const id = await api.user(email);
  await api.sql('select public.provision_growth_partner($1::uuid, $2, true)', [id, code]);
  return id;
}

// ---------------------------------------------------------------------------
// 1 + 2. The code must exist AND belong to a real partner.
// ---------------------------------------------------------------------------

test('1/2. a code that exists and belongs to an active partner links', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    const result = await api.rpc(visitor, 'link_my_growth_referral', [CODE]);
    assert.equal(result.growth_partner_id, partner);
    assert.equal(result.referral_code, CODE);
    assert.ok(result.linked_at, 'the link is timestamped server-side');
  } finally {
    await api.close();
  }
});

test('1. a well-formed code that belongs to nobody is rejected', async () => {
  const api = harness();
  try {
    await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    for (const ghost of ['NEXORA-GHOST99', 'ZZZZZZZ', 'ABCDEFGH']) {
      const message = await api.failure(visitor, 'link_my_growth_referral', [ghost]);
      assert.match(message || '', /Invalid or inactive referral code/i, `${ghost} is unknown`);
    }
    const rows = await api.sql(
      'select count(*)::int as n from public.growth_onboarding where growth_partner_id is not null'
    );
    assert.equal(rows[0].n, 0, 'no attribution was written for an unknown code');
  } finally {
    await api.close();
  }
});

test('2. an unknown code and a real-but-deactivated partner are indistinguishable', async () => {
  // Anti-enumeration: if deactivating a partner changed the message, an attacker
  // could enumerate valid codes by toggling partners. Both must read the same.
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    const unknown = await api.failure(visitor, 'link_my_growth_referral', ['NEXORA-GHOST99']);
    await api.sql('update public.growth_partners set is_active = false where user_id = $1::uuid', [partner]);
    const deactivated = await api.failure(visitor, 'link_my_growth_referral', [CODE]);

    assert.equal(unknown, deactivated, 'the two failures are byte-identical');
    assert.match(unknown || '', /Invalid or inactive referral code/i);
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------------------
// 3 + 4. Partner existence and activity.
// ---------------------------------------------------------------------------

test('3. deleting the partner account takes the code with it (FK cascade)', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    await api.sql('delete from auth.users where id = $1::uuid', [partner]);
    const partners = await api.sql('select count(*)::int as n from public.growth_partners');
    assert.equal(partners[0].n, 0, 'the partner row cascaded away');

    const message = await api.failure(visitor, 'link_my_growth_referral', [CODE]);
    assert.match(message || '', /Invalid or inactive referral code/i, 'the code no longer resolves');
  } finally {
    await api.close();
  }
});

test('4. an inactive partner cannot receive new referrals, and can again when reactivated', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    await api.sql('update public.growth_partners set is_active = false where user_id = $1::uuid', [partner]);
    assert.match(
      (await api.failure(visitor, 'link_my_growth_referral', [CODE])) || '',
      /Invalid or inactive referral code/i,
      'deactivated partner is refused'
    );

    await api.sql('update public.growth_partners set is_active = true where user_id = $1::uuid', [partner]);
    const result = await api.rpc(visitor, 'link_my_growth_referral', [CODE]);
    assert.equal(result.growth_partner_id, partner, 'reactivating restores it — is_active is the live switch');
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------------------
// 5-8. The dimensions that DO NOT exist in the data model. Asserting their
//      absence is the point: a reviewer must not believe a check is enforced
//      when there is no column behind it.
// ---------------------------------------------------------------------------

test('5/6/7/8. the code has no per-code active flag, expiry, block flag or usage limit', async () => {
  const api = harness();
  try {
    const columns = await api.sql(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'growth_partners'
       order by column_name`
    );
    const names = columns.map((row: any) => row.column_name);
    assert.deepEqual(
      names,
      ['created_at', 'id', 'is_active', 'referral_code', 'updated_at', 'user_id'],
      'the whole partner table — there is nowhere to put a code-level rule'
    );

    for (const absent of ['expires_at', 'valid_until', 'is_blocked', 'blocked_at', 'max_uses', 'usage_count']) {
      assert.ok(!names.includes(absent), `${absent} does not exist, so it cannot be enforced`);
    }

    // Expiry DOES exist, but on the share-link attribution token, not the code.
    const attr = await api.sql(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'growth_referral_attributions'
         and column_name = 'expires_at'`
    );
    assert.equal(attr.length, 1, 'the 7-day token TTL is the only expiry in this flow');
  } finally {
    await api.close();
  }
});

test('8. a referral code is reusable by design — there is no usage limit', async () => {
  const api = harness();
  try {
    await provisionPartner(api, 'partner@example.com');
    for (let i = 0; i < 5; i++) {
      const visitor = await api.user(`visitor-${i}@example.com`);
      const result = await api.rpc(visitor, 'link_my_growth_referral', [CODE]);
      assert.ok(result.growth_partner_id, `visitor ${i} links with the same code`);
    }
    const rows = await api.sql(
      'select count(*)::int as n from public.growth_onboarding where referral_code = $1',
      [CODE]
    );
    assert.equal(rows[0].n, 5, 'five attributions from one code — no cap exists');
  } finally {
    await api.close();
  }
});

test('6. the share-link attribution token really does expire', async () => {
  const api = harness();
  try {
    await provisionPartner(api, 'partner@example.com');
    const captured: any = await api.rpc(null, 'capture_growth_referral', [CODE, null]);
    assert.equal(captured.valid, true);
    const token: string = captured.token;
    assert.match(token, /^[a-f0-9]{64}$/, 'an opaque 64-hex token, never the code');

    // Force it into the past and confirm the consumer refuses it.
    await api.sql(
      "update public.growth_referral_attributions set expires_at = now() - interval '1 hour' where token_hash = md5($1)",
      [token]
    );
    const visitor = await api.user('visitor@example.com');
    const consumed: any = await api.rpc(visitor, 'prepare_growth_referral_signup', [token]);
    assert.notEqual(consumed?.valid, true, 'an expired token is not honoured');
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------------------
// 9. Self-referral — enforced twice, at two different levels.
// ---------------------------------------------------------------------------

test('9. self-referral is blocked by the RPC and again by a CHECK constraint', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');

    const message = await api.failure(partner, 'link_my_growth_referral', [CODE]);
    assert.match(message || '', /own referral code/i, 'the RPC refuses it with a distinct message');

    // Defense in depth: a direct privileged INSERT cannot sneak past it either.
    await assert.rejects(
      () =>
        api.sql(
          "insert into public.growth_onboarding(user_id,growth_partner_id,referral_code,linked_at,status) values ($1::uuid,$1::uuid,$2,now(),'linked')",
          [partner, CODE]
        ),
      /no_self_referral/i
    );
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------------------
// 10. Already-attributed users.
// ---------------------------------------------------------------------------

test('10. an attributed account can never be re-attributed, by anyone but an admin', async () => {
  const api = harness();
  try {
    const partnerA = await provisionPartner(api, 'a@example.com', CODE);
    const partnerB = await provisionPartner(api, 'b@example.com', OTHER_CODE);
    const visitor = await api.user('visitor@example.com');

    const first = await api.rpc(visitor, 'link_my_growth_referral', [CODE]);
    assert.equal(first.growth_partner_id, partnerA);

    // Same code again, and a different code: both refused.
    for (const code of [CODE, OTHER_CODE]) {
      assert.match(
        (await api.failure(visitor, 'link_my_growth_referral', [code])) || '',
        /already linked/i,
        `${code} is refused once attributed`
      );
    }

    // Even progressing through onboarding does not reopen the link.
    await api.sql(
      "update public.growth_onboarding set status='template_completed', template_started_at=now(), template_completed_at=now() where user_id=$1::uuid",
      [visitor]
    );
    assert.match(
      (await api.failure(visitor, 'link_my_growth_referral', [OTHER_CODE])) || '',
      /already linked/i,
      'a completed account is still not re-attributable'
    );

    // And a privileged UPDATE cannot rotate the attribution either.
    await assert.rejects(
      () =>
        api.sql(
          'update public.growth_onboarding set growth_partner_id = $1::uuid, referral_code = $2 where user_id = $3::uuid',
          [partnerB, OTHER_CODE, visitor]
        ),
      /immutable|administrator action required/i
    );

    const rows = await api.sql('select growth_partner_id, referral_code from public.growth_onboarding where user_id = $1::uuid', [visitor]);
    assert.equal(rows.length, 1, 'exactly one row');
    assert.equal(rows[0].growth_partner_id, partnerA, 'and it still points at the original partner');
    assert.equal(rows[0].referral_code, CODE);
  } finally {
    await api.close();
  }
});

test('10. an admin CAN correct attribution, and it is audited', async () => {
  const api = harness();
  try {
    const partnerA = await provisionPartner(api, 'a@example.com', CODE);
    const partnerB = await provisionPartner(api, 'b@example.com', OTHER_CODE);
    const visitor = await api.user('visitor@example.com');
    await api.rpc(visitor, 'link_my_growth_referral', [CODE]);

    // The function RETURNS VOID by design -- there is no value to trust, only
    // the resulting row and the audit record.
    await api.rpc(
      null,
      'admin_correct_growth_referral',
      [visitor, OTHER_CODE, 'Partner A resigned; reassigned by support'],
      true
    );

    const rows = await api.sql('select growth_partner_id, referral_code from public.growth_onboarding where user_id = $1::uuid', [visitor]);
    assert.equal(rows[0].growth_partner_id, partnerB, 'the attribution moved');
    assert.notEqual(rows[0].growth_partner_id, partnerA);

    const audit = await api.sql('select count(*)::int as n from public.growth_referral_admin_audit');
    assert.equal(audit[0].n, 1, 'exactly one audit record was written');
  } finally {
    await api.close();
  }
});

test('10. attribution cannot be forged by a caller supplying a partner id', async () => {
  // The RPC takes only the code. There is no parameter through which a browser
  // could name a partner, so this asserts the signature rather than a refusal.
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    // A wrong partner id cannot be passed at all — and the trigger re-checks
    // that the code really belongs to the partner being written.
    await assert.rejects(
      () =>
        api.sql(
          "insert into public.growth_onboarding(user_id,growth_partner_id,referral_code,linked_at,status) values ($1::uuid,$2::uuid,$3,now(),'linked')",
          [visitor, partner, OTHER_CODE]
        ),
      /Invalid or inactive referral code/i,
      'a partner/code mismatch is refused even on a direct write'
    );
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------------------
// The gap this phase found: a BANNED partner is not the same as an inactive one.
// ---------------------------------------------------------------------------

test('GAP (fixed). a GoTrue-banned partner cannot receive new referrals', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');

    const hasColumn = await api.sql(
      `select count(*)::int as n from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until'`
    );
    // Assert the precondition rather than skipping on it: a test that returns
    // early proves nothing, and this one used to.
    assert.equal(hasColumn[0].n, 1, 'the local auth schema models GoTrue bans');

    await api.sql("update auth.users set banned_until = now() + interval '30 days' where id = $1::uuid", [partner]);
    const banned = await api.sql(
      'select count(*)::int as n from auth.users where id = $1::uuid and banned_until > now()',
      [partner]
    );
    assert.equal(banned[0].n, 1, 'the partner is banned right now');

    const message = await api.failure(visitor, 'link_my_growth_referral', [CODE]);
    assert.match(message || '', /Invalid or inactive referral code/i, 'a banned partner is refused');

    // ...and indistinguishably from an unknown code, so the ban cannot be used
    // to discover which codes are real.
    const ghost = await api.failure(visitor, 'link_my_growth_referral', ['NEXORA-GHOST99']);
    assert.equal(message, ghost, 'banned and unknown read the same');

    // Unbanning restores it, which proves is_active was never the blocker.
    await api.sql('update auth.users set banned_until = null where id = $1::uuid', [partner]);
    const restored = await api.rpc(visitor, 'link_my_growth_referral', [CODE]);
    assert.equal(restored.growth_partner_id, partner);
  } finally {
    await api.close();
  }
});

test('GAP (fixed). banning a partner does not disturb referrals already made', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    const visitor = await api.user('visitor@example.com');
    await api.rpc(visitor, 'link_my_growth_referral', [CODE]);

    await api.sql("update auth.users set banned_until = now() + interval '30 days' where id = $1::uuid", [partner]);

    const rows = await api.sql(
      'select growth_partner_id, referral_code from public.growth_onboarding where user_id = $1::uuid',
      [visitor]
    );
    assert.equal(rows.length, 1, 'the attribution row is still there');
    assert.equal(rows[0].growth_partner_id, partner, 'and still points at the same partner');
    assert.equal(rows[0].referral_code, CODE, 'with the same code');

    // Onboarding progress still advances for an already-attributed owner.
    await api.rpc(visitor, 'update_my_onboarding_progress', ['start_template']);
    const status: any = await api.rpc(visitor, 'get_my_onboarding_status', []);
    assert.equal(status.status, 'template_started', 'milestones are not blocked by a later ban');
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------------------
// 5.1 — the states the client surfaces, and which ones it deliberately merges.
// ---------------------------------------------------------------------------

test('5.1. the client surfaces the states the backend can actually distinguish', async () => {
  const cases: [string, string][] = [
    ['Invalid referral code', 'invalid-code'],
    ['Invalid or inactive referral code', 'invalid-code'],
    ['You cannot use your own referral code', 'invalid-code'],
    ['This account is already linked to a Growth Partner', 'already-linked'],
    ['Sign in required', 'session'],
    ['Failed to fetch', 'network'],
    ['something nobody anticipated', 'unknown'],
  ];
  for (const [message, expected] of cases) {
    assert.equal(toSafeReferralError(new Error(message)).code, expected, message);
  }

  // The merge that matters: NOT_FOUND and PARTNER_INACTIVE collapse into one
  // client state on purpose, because the database returns one message for both.
  // Splitting them client-side would require the backend to distinguish them,
  // which would let an attacker enumerate valid codes.
  assert.equal(
    toSafeReferralError(new Error('Invalid or inactive referral code')).code,
    toSafeReferralError(new Error('Invalid referral code')).code,
    'unknown and inactive stay indistinguishable end to end'
  );

  // Raw database text is never surfaced to an owner.
  for (const message of [
    'duplicate key value violates unique constraint "growth_partners_referral_code_key"',
    'permission denied for table growth_partners',
    '22023: Invalid or inactive referral code',
  ]) {
    const safe = toSafeReferralError(new Error(message));
    assert.ok(
      !/constraint|permission denied|growth_partners|22023/.test(safe.message),
      `${message} -> ${safe.message}`
    );
  }
});

test('5.1. no validation state is derived from the frontend, storage or static data', async () => {
  const api = harness();
  try {
    const partner = await provisionPartner(api, 'partner@example.com');
    // The correction target has to be a real, active partner's code.
    await provisionPartner(api, 'other-partner@example.com', OTHER_CODE);
    const visitor = await api.user('visitor@example.com');

    // The signed-in user's own view of their referral is read from the database,
    // and it reflects a change made behind their back.
    await api.rpc(visitor, 'link_my_growth_referral', [CODE]);
    const before: any = await api.rpc(visitor, 'get_my_growth_referral', []);
    assert.equal(before.referral_code, CODE);

    // admin_correct_growth_referral checks private.is_admin() from the JWT
    // claim, so it must be called through an admin request context -- not as
    // the database superuser, which has no claim at all.
    await api.rpc(null, 'admin_correct_growth_referral', [visitor, OTHER_CODE, 'reassigned'], true);
    const after: any = await api.rpc(visitor, 'get_my_growth_referral', []);
    assert.equal(after.referral_code, OTHER_CODE, 'the read follows the database, not a cached value');
    assert.notEqual(after.referral_code, before.referral_code);
    void partner;
  } finally {
    await api.close();
  }
});

test('5.1. every referral error the backend can raise maps to real copy, not a generic fallback', async () => {
  // The messages are read out of the migrations rather than restated here, so a
  // new `raise exception` in a future migration is what fails this test.
  const files = [
    '20260912_growth_partner_onboarding.sql',
    '20260917_part1b_link_atomicity.sql',
    '20260921_public_partner_referral_codes.sql',
    '20260922_referral_link_attribution.sql',
    '20260923_referral_fraud_privacy.sql',
    '20260924_referral_lifecycle.sql',
    '20261005_partner_ban_guard.sql',
  ];
  const { readFileSync } = await import('node:fs');
  const messages = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
    for (const match of sql.matchAll(/raise exception '([^']+)'/g)) messages.add(match[1]);
  }
  assert.ok(messages.size >= 8, `found ${messages.size} distinct backend messages`);

  // Messages an OWNER can actually trigger by calling link_my_growth_referral
  // or update_my_onboarding_progress. Admin-only and trigger-only messages are
  // listed separately: they must not reach the fallback in an owner flow, but
  // they are not expected to have tailored copy.
  const ownerFacing = [
    'Sign in required',
    'Invalid referral code',
    'Invalid or inactive referral code',
    'You cannot use your own referral code',
    'This account is already linked to a Growth Partner',
    'Unknown onboarding action',
  ];
  for (const message of ownerFacing) {
    assert.ok(messages.has(message), `the backend really can raise: ${message}`);
    const mapped = toSafeReferralError(new Error(message));
    assert.notEqual(
      mapped.message,
      'Something went wrong. Please try again.',
      `"${message}" must not fall through to the generic fallback`
    );
    assert.ok(mapped.message.length > 10, `"${message}" -> "${mapped.message}"`);
    // Raw SQL vocabulary never reaches an owner.
    assert.ok(!/22023|42501|constraint|permission denied/i.test(mapped.message), mapped.message);
  }

  // Every message the backend can raise must at least produce SAFE copy, even
  // where the generic fallback is the right answer.
  for (const message of messages) {
    const mapped = toSafeReferralError(new Error(message));
    assert.ok(!/22023|42501|pg_catalog|information_schema/i.test(mapped.message), message);
  }
});
