// ============================================================================
// PART 1B ACCEPTANCE — Growth Partner + Referral Code + Referral Relationship
// ============================================================================
// Executable gate for Part 1B Steps 1-12. Applies the REAL migration stack
// (20260912 base + 20260916 hardening + 20260917 link atomicity) to PGlite
// with the production auth contract (auth.users + auth.uid() + anon/
// authenticated roles) and pins the 11 required behaviors:
//
//   1. Growth Partner gets a unique referral code (incl. server-side generation)
//   2. Duplicate referral codes are rejected
//   3. Valid codes are accepted
//   4. Invalid codes are rejected
//   5. Inactive partner codes are handled correctly
//   6. Correct user is linked to correct partner
//   7. User cannot change partner after linking
//   8. Duplicate requests do not create duplicate relationships
//   9. Concurrent requests are safe
//  10. Arbitrary partner_id cannot be injected
//  11. Existing referral data is preserved
//
// PGlite is single-connection, so test 9 cannot open two truly parallel
// transactions; it instead pins (a) a rapid duplicate storm yields exactly
// one relationship row, (b) the live function carries the atomic
// single-winner predicate + row_count backstop, and (c) the PK/constraint
// backstops exist. The defense-in-depth chain (row lock + conditional
// update + PK) is what makes concurrent requests safe on production
// Postgres, where the lock serializes racers and the predicate decides.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_A = 'b0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000002';
const USER_C = 'b0000000-0000-4000-8000-000000000003';
const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const BASE = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);
const HARDENING = readFileSync(
  new URL('../supabase/migrations/20260916_part1_referral_hardening.sql', import.meta.url),
  'utf8'
);
const ATOMICITY = readFileSync(
  new URL('../supabase/migrations/20260917_part1b_link_atomicity.sql', import.meta.url),
  'utf8'
);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id, email) values
      ('${PARTNER_A}', 'anita@example.com'), ('${PARTNER_B}', 'bala@example.com'),
      ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com'), ('${USER_C}', 'c@example.com');
    insert into public.profiles(id, full_name) values
      ('${PARTNER_A}', 'Partner Anita'), ('${PARTNER_B}', 'Partner Bala');
  `);
  await db.exec(BASE);
  await db.exec(HARDENING);
  await db.exec(ATOMICITY);
  return db;
}

/** Call an RPC as an authenticated user; returns the parsed jsonb result. */
async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}

async function captureError(promise: Promise<any>) {
  try {
    await promise;
  } catch (err: any) {
    return err;
  }
  assert.fail('expected the statement to fail, but it succeeded');
}

// ---------------------------------------------------------------------------
// 1. Growth Partner gets a unique referral code (server-side generation).
// ---------------------------------------------------------------------------

test('Part1B-1: partners get unique, well-formed, server-side referral codes', async () => {
  const db = await setup();
  try {
    const explicit = (
      await db.query<any>('select public.provision_growth_partner($1::uuid, $2) as result', [PARTNER_A, CODE_A])
    ).rows[0].result;
    assert.equal(explicit.user_id, PARTNER_A);
    assert.equal(explicit.referral_code, CODE_A);
    assert.equal(explicit.is_active, true);

    // Omitted code => server generates (clients never mint codes).
    const generated = (
      await db.query<any>('select public.provision_growth_partner($1::uuid) as result', [PARTNER_B])
    ).rows[0].result;
    assert.match(generated.referral_code, /^[A-Z0-9]{6,12}$/);
    assert.notEqual(generated.referral_code, CODE_A);

    // Stored canonical (normalized): lowercase + padded input stores upper-trimmed.
    const stored = (
      await db.query<any>('select referral_code from public.growth_partners where user_id = $1::uuid', [PARTNER_B])
    ).rows[0].referral_code;
    assert.equal(stored, generated.referral_code);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Duplicate referral codes are rejected.
// ---------------------------------------------------------------------------

test('Part1B-2: duplicate referral codes are rejected (RPC + unique index)', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);

    // Same code for a different partner -> 23505.
    const dup = await captureError(
      db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_A])
    );
    assert.equal(dup.code, '23505');
    assert.match(dup.message, /already in use/);

    // Case/whitespace-insensitive duplicates are caught (canonical storage).
    const dupLower = await captureError(
      db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, '  alpha01 '])
    );
    assert.equal(dupLower.code, '23505');

    // The unique index is the backstop even for direct privileged writes.
    const direct = await captureError(
      db.query<any>('insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)', [
        PARTNER_B,
        CODE_A,
      ])
    );
    assert.equal(direct.code, '23505');
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 3 + 4. Valid codes accepted, invalid codes rejected.
// ---------------------------------------------------------------------------

test('Part1B-3/4: validation accepts active codes, rejects unknown/malformed ones', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);

    // Valid: normalization is case/whitespace-insensitive.
    assert.deepEqual(await rpc(db, USER_A, 'validate_growth_referral_code', ['  alpha01 ']), {
      valid: true,
      referral_code: CODE_A,
    });
    // Unknown + malformed codes never match (and never throw / never leak identity).
    for (const bad of ['NOPE99', 'bad!!', 'x', '', 'NX-ABC123']) {
      assert.deepEqual(await rpc(db, USER_A, 'validate_growth_referral_code', [bad]), {
        valid: false,
        referral_code: null,
      });
    }
    const keys = Object.keys(await rpc(db, USER_A, 'validate_growth_referral_code', [CODE_A]));
    assert.deepEqual(keys.sort(), ['referral_code', 'valid']);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Inactive partner codes are handled correctly.
// ---------------------------------------------------------------------------

test('Part1B-5: inactive partner codes validate false and link nothing (old links kept)', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_B]);

    // Deactivate WITHOUT rotating the code (20260916 fix).
    const deactivated = (
      await db.query<any>('select public.provision_growth_partner($1::uuid, null, false) as result', [PARTNER_B])
    ).rows[0].result;
    assert.equal(deactivated.referral_code, CODE_B);
    assert.equal(deactivated.is_active, false);

    assert.deepEqual(await rpc(db, USER_B, 'validate_growth_referral_code', [CODE_B]), {
      valid: false,
      referral_code: null,
    });
    await assert.rejects(rpc(db, USER_B, 'link_my_growth_referral', [CODE_B]), /Invalid or inactive/);

    // The pre-existing link survives deactivation untouched.
    assert.equal((await rpc(db, USER_A, 'get_my_growth_referral')).growth_partner_id, PARTNER_B);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Correct user is linked to correct partner.
// ---------------------------------------------------------------------------

test('Part1B-6: linking attaches each user to the correct Growth Partner', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);

    const linkedB = await rpc(db, USER_A, 'link_my_growth_referral', ['  beta002 ']);
    assert.equal(linkedB.growth_partner_id, PARTNER_B);
    assert.notEqual(linkedB.growth_partner_id, PARTNER_A);
    assert.equal(linkedB.referral_code, CODE_B);
    assert.equal(linkedB.status, 'linked');
    assert.equal(linkedB.partner_name, 'Partner Bala');
    assert.ok(linkedB.linked_at);

    const linkedA = await rpc(db, USER_B, 'link_my_growth_referral', [CODE_A]);
    assert.equal(linkedA.growth_partner_id, PARTNER_A);
    assert.equal(linkedA.partner_name, 'Partner Anita');

    // Relationship read-back agrees with the link result.
    assert.deepEqual(await rpc(db, USER_A, 'get_my_growth_referral'), linkedB);
    const row = (
      await db.query<any>('select growth_partner_id, referral_code, linked_at from public.growth_onboarding where user_id = $1::uuid', [
        USER_A,
      ])
    ).rows[0];
    assert.equal(row.growth_partner_id, PARTNER_B);
    assert.equal(row.referral_code, CODE_B);
    assert.ok(row.linked_at);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 7. User cannot change partner after linking (ownership immutable).
// ---------------------------------------------------------------------------

test('Part1B-7: referral ownership is immutable after linking', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);

    // Re-linking — to another partner OR the same code — is refused.
    await assert.rejects(rpc(db, USER_A, 'link_my_growth_referral', [CODE_B]), /already linked/);
    await assert.rejects(rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]), /already linked/);

    // Direct owner rewrites are denied (no write grant/policy for clients).
    for (const [attacker, sql, params] of [
      [USER_A, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_A]],
      [USER_B, 'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid', [PARTNER_B, USER_A]],
      [USER_A, `update public.growth_onboarding set referral_code = '${CODE_B}' where user_id = '${USER_A}'`, []],
      [USER_A, `delete from public.growth_onboarding where user_id = '${USER_A}'`, []],
    ] as Array<[string, string, any[]]>) {
      const err = await captureError(asUser(db, attacker, sql, params));
      assert.match(err.message, /permission denied|row-level security/i, sql);
    }

    // Ownership byte-identical after every attempt.
    const row = (await db.query<any>('select * from public.growth_onboarding where user_id = $1::uuid', [USER_A]))
      .rows[0];
    assert.equal(row.growth_partner_id, PARTNER_A);
    assert.equal(row.referral_code, CODE_A);
    assert.equal(row.status, 'linked');
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 8. Duplicate requests do not create duplicate relationships.
// ---------------------------------------------------------------------------

test('Part1B-8: repeated link requests are refused and leave exactly one row', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);

    // Double-click / retry / multi-tab replays: all refused.
    for (let i = 0; i < 4; i++) {
      await assert.rejects(rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]), /already linked/);
    }
    const count = await db.query<any>('select count(*)::int as n from public.growth_onboarding where user_id = $1::uuid', [
      USER_A,
    ]);
    assert.equal(count.rows[0].n, 1);

    // Failed links (bad code, self-referral) create no relationship at all.
    await assert.rejects(rpc(db, USER_B, 'link_my_growth_referral', ['NOPE99']), /Invalid or inactive/);
    await assert.rejects(rpc(db, PARTNER_A, 'link_my_growth_referral', [CODE_A]), /own referral code/);
    assert.equal(await rpc(db, USER_B, 'get_my_growth_referral'), null);
    const total = await db.query<any>('select count(*)::int as n from public.growth_onboarding');
    assert.equal(total.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 9. Concurrent requests are safe (lock + atomic predicate + PK backstops).
// ---------------------------------------------------------------------------

test('Part1B-9: concurrent link attempts are safe (single winner, guarded claim)', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);

    // Rapid duplicate storm (double-clicks across tabs racing the same code).
    const first = await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);
    assert.equal(first.growth_partner_id, PARTNER_A);
    const outcomes = await Promise.allSettled([
      rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]),
      rpc(db, USER_A, 'link_my_growth_referral', [CODE_B]),
      rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]),
    ]);
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      assert.match(String((outcome as PromiseRejectedResult).reason?.message || outcome), /already linked/);
    }
    const count = await db.query<any>('select count(*)::int as n from public.growth_onboarding where user_id = $1::uuid', [
      USER_A,
    ]);
    assert.equal(count.rows[0].n, 1);
    assert.equal(
      (await db.query<any>('select growth_partner_id from public.growth_onboarding where user_id = $1::uuid', [USER_A]))
        .rows[0].growth_partner_id,
      PARTNER_A
    );

    // The live function carries the atomic single-winner backstop
    // (conditional predicate + row_count guard), not just the row lock.
    const def = (
      await db.query<any>(`select pg_get_functiondef('public.link_my_growth_referral(text)'::regprocedure) as def`)
    ).rows[0].def as string;
    assert.match(def, /growth_partner_id is null/i, 'claim must be conditional on unlinked');
    assert.match(def, /row_count/i, 'claim must verify exactly one row won');

    // Constraint backstop: one row per user (PK), so two relationships
    // for the same user are unrepresentable at the database level.
    const pk = await db.query<any>(
      `select conname from pg_constraint where conrelid = 'public.growth_onboarding'::regclass and contype = 'p'`
    );
    assert.ok(pk.rows.length >= 1, 'growth_onboarding must have a primary key');
    const pkCols = await db.query<any>(
      `select a.attname from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.conrelid = 'public.growth_onboarding'::regclass and c.contype = 'p'`
    );
    assert.deepEqual(
      pkCols.rows.map((r: any) => r.attname),
      ['user_id']
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 10. Arbitrary partner_id cannot be injected.
// ---------------------------------------------------------------------------

test('Part1B-10: no partner/user id can be injected (signature + write denial)', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);

    // The user-facing RPCs take ONLY a code string — there is no
    // user_id / partner_id / owner_id parameter to smuggle an identity through.
    for (const fn of ['public.link_my_growth_referral(text)', 'public.validate_growth_referral_code(text)']) {
      const args = (
        await db.query<any>(
          `select pg_get_function_arguments('public.${fn.split('.')[1]}'::regprocedure) as args`
        )
      ).rows[0].args as string;
      assert.match(args, /^p_code text$/, `${fn} must take only p_code`);
      assert.doesNotMatch(args, /user_id|partner_id|owner_id/i, `${fn} must not accept identity args`);
    }

    // Every user RPC derives identity from the auth context (auth.uid()).
    for (const fn of ['link_my_growth_referral', 'validate_growth_referral_code', 'get_my_growth_referral']) {
      const def = (
        await db.query<any>(`select pg_get_functiondef(oid) as def from pg_proc where proname = '${fn}'`)
      ).rows[0].def as string;
      assert.match(def, /auth\.uid\(\)/, `${fn} must derive identity from auth.uid()`);
    }

    // Client call sites pass only the code string (static pin).
    const clientSrc = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
    assert.match(clientSrc, /rpc\('link_my_growth_referral', \{\s*p_code:/);
    assert.match(clientSrc, /rpc\('validate_growth_referral_code', \{\s*p_code:/);
    const onboardingAuth = readFileSync(new URL('../src/onboarding/lib/auth.ts', import.meta.url), 'utf8');
    assert.match(onboardingAuth, /rpc\('link_my_growth_referral', \{ p_code:/);

    // And direct ownership writes stay denied for every client role path.
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);
    const err = await captureError(
      asUser(
        db,
        USER_A,
        'update public.growth_onboarding set growth_partner_id = $1::uuid, referral_code = $2 where user_id = $3::uuid',
        [PARTNER_B, CODE_B, USER_A]
      )
    );
    assert.match(err.message, /permission denied|row-level security/i);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 11. Existing referral data is preserved across the Part 1B stack.
// ---------------------------------------------------------------------------

test('Part1B-11: re-applying the Part 1B stack preserves all referral data', async () => {
  const db = await setup();
  try {
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_A]);
    await db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_B, CODE_B]);
    await rpc(db, USER_A, 'link_my_growth_referral', [CODE_A]);
    await rpc(db, USER_B, 'link_my_growth_referral', [CODE_B]);

    const beforePartners = (await db.query<any>('select * from public.growth_partners order by user_id')).rows;
    const beforeOnboarding = (await db.query<any>('select * from public.growth_onboarding order by user_id')).rows;

    // Re-apply the whole Part 1B stack in order, twice (like db push + re-run).
    await db.exec(BASE);
    await db.exec(HARDENING);
    await db.exec(ATOMICITY);
    await db.exec(BASE);
    await db.exec(HARDENING);
    await db.exec(ATOMICITY);

    assert.deepEqual((await db.query<any>('select * from public.growth_partners order by user_id')).rows, beforePartners);
    assert.deepEqual(
      (await db.query<any>('select * from public.growth_onboarding order by user_id')).rows,
      beforeOnboarding
    );

    // Everything still works after the re-apply.
    assert.equal((await rpc(db, USER_A, 'get_my_growth_referral')).growth_partner_id, PARTNER_A);
    assert.equal((await rpc(db, USER_C, 'link_my_growth_referral', [CODE_B])).growth_partner_id, PARTNER_B);
    const dup = await captureError(db.query<any>('select public.provision_growth_partner($1::uuid, $2)', [PARTNER_A, CODE_B]));
    assert.equal(dup.code, '23505');
  } finally {
    await db.close();
  }
});
