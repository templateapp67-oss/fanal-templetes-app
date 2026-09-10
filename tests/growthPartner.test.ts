// ============================================================================
// Growth Partner + shared Onboarding backend wiring (Phase 1).
//
// Runs supabase/migrations/20260912_growth_partner_onboarding.sql against a
// real Postgres engine (PGlite) with the production auth contract
// (auth.users + auth.uid() + anon/authenticated roles) and pins:
//   • valid / invalid referral validation (no identity leaked)
//   • duplicate referral codes rejected (23505, at RPC and constraint level)
//   • linking attaches the user to the CORRECT Growth Partner
//   • referral ownership is immutable (no self-assign, no owner change)
//   • growth_partners is not client-writable (provision is admin-only)
//   • cross-user reads blocked; partners read ONLY their own referrals
//   • onboarding progress is forward-only, idempotent, server-timestamped
//   • the migration is idempotent and preserves existing data
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { asUser } from './liveSchemaFixture';
import { normalizeGrowthReferralCode, isGrowthReferralCodeFormat } from '../src/lib/growthPartner';

const PARTNER_A = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_B = 'a0000000-0000-4000-8000-000000000002';
const USER_1 = 'b0000000-0000-4000-8000-000000000001';
const USER_2 = 'b0000000-0000-4000-8000-000000000002';
const USER_3 = 'b0000000-0000-4000-8000-000000000003';
const USER_4 = 'b0000000-0000-4000-8000-000000000004';

const CODE_A = 'ALPHA01';
const CODE_B = 'BETA002';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    -- Minimal slice of the EXISTING profiles table (reused for display names).
    create table public.profiles(id uuid primary key, full_name text);
    insert into auth.users(id) values
      ('${PARTNER_A}'), ('${PARTNER_B}'),
      ('${USER_1}'), ('${USER_2}'), ('${USER_3}'), ('${USER_4}');
    insert into public.profiles(id, full_name) values
      ('${PARTNER_A}', 'Partner Anita'), ('${PARTNER_B}', 'Partner Bala'),
      ('${USER_1}', 'User One'), ('${USER_2}', 'User Two');
  `);
  await db.exec(MIGRATION);
  return db;
}

/** Call an RPC as an authenticated user; returns the parsed jsonb result. */
async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}

/** Provision a partner as the database administrator (owner role). */
async function provision(db: any, userId: string, code?: string, active?: boolean) {
  const args: any[] = [userId];
  let sql = 'select public.provision_growth_partner($1::uuid';
  if (code !== undefined) {
    sql += ', $2';
    args.push(code);
  }
  if (active !== undefined) {
    sql += ', $3';
    args.push(active);
  }
  return (await db.query(`${sql}) as result`, args)).rows[0].result;
}

async function captureError(promise: Promise<any>) {
  try {
    await promise;
  } catch (err: any) {
    return err;
  }
  assert.fail('expected the statement to fail, but it succeeded');
}

test('referral validation accepts an active code and rejects unknown, malformed and inactive codes', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B, false);

    // Valid: normalization is case/whitespace-insensitive, canonical form returned.
    assert.deepEqual(await rpc(db, USER_1, 'validate_growth_referral_code', ['  alpha01 ']), {
      valid: true,
      referral_code: CODE_A,
    });
    // Unknown code.
    assert.deepEqual(await rpc(db, USER_1, 'validate_growth_referral_code', ['NOPE99']), {
      valid: false,
      referral_code: null,
    });
    // Malformed codes never match (and never throw).
    for (const bad of ['bad!!', 'x', '', 'NX-ABC123']) {
      assert.deepEqual(await rpc(db, USER_1, 'validate_growth_referral_code', [bad]), {
        valid: false,
        referral_code: null,
      });
    }
    // Inactive partner.
    assert.deepEqual(await rpc(db, USER_1, 'validate_growth_referral_code', [CODE_B]), {
      valid: false,
      referral_code: null,
    });
    // Validation reveals NO partner identity (only validity + canonical code).
    const keys = Object.keys(await rpc(db, USER_1, 'validate_growth_referral_code', [CODE_A]));
    assert.deepEqual(keys.sort(), ['referral_code', 'valid']);
    // Anonymous callers cannot even execute the function.
    const anonErr = await captureError(
      asUser(db, '', 'select public.validate_growth_referral_code($1)', [CODE_A])
    );
    assert.match(anonErr.message, /permission denied for function/);
    // Authenticated role WITHOUT a verified identity is rejected inside the RPC.
    await db.exec('set role authenticated');
    try {
      await assert.rejects(db.query('select public.validate_growth_referral_code($1)', [CODE_A]), /Sign in required/);
    } finally {
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('duplicate referral codes are rejected at provision time and at the database level', async () => {
  const db = await setup();
  try {
    assert.equal((await provision(db, PARTNER_A, CODE_A)).referral_code, CODE_A);

    // Same code for a DIFFERENT partner -> 23505 with a clear message.
    const dup = await captureError(provision(db, PARTNER_B, CODE_A));
    assert.equal(dup.code, '23505');
    assert.match(dup.message, /already in use/);

    // Case-insensitive duplicates are caught too (codes are stored canonical).
    const dupLower = await captureError(provision(db, PARTNER_B, '  alpha01 '));
    assert.equal(dupLower.code, '23505');

    // The unique index is the backstop even for direct privileged writes.
    const direct = await captureError(
      db.query('insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)', [
        PARTNER_B,
        CODE_A,
      ])
    );
    assert.equal(direct.code, '23505');

    // Malformed codes and unknown users are rejected by the provision RPC.
    await assert.rejects(provision(db, PARTNER_B, 'bad!'), /Invalid referral code format/);
    await assert.rejects(provision(db, PARTNER_B, 'TOOLONGCODE123'), /Invalid referral code format/);
    await assert.rejects(
      provision(db, 'c0000000-0000-4000-8000-000000000009', 'FRESH01'),
      /Unknown user/
    );

    // Auto-generated codes work and stay unique across partners.
    const autoA = await provision(db, PARTNER_A);
    const autoB = await provision(db, PARTNER_B);
    assert.match(autoA.referral_code, /^[A-Z0-9]{6,12}$/);
    assert.match(autoB.referral_code, /^[A-Z0-9]{6,12}$/);
    assert.notEqual(autoA.referral_code, autoB.referral_code);
  } finally {
    await db.close();
  }
});

test('linking attaches the user to the correct Growth Partner', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B);

    // Lowercase + padded input still links to partner B (server normalization).
    const linked = await rpc(db, USER_1, 'link_my_growth_referral', ['  beta002 ']);
    assert.equal(linked.growth_partner_id, PARTNER_B);
    assert.notEqual(linked.growth_partner_id, PARTNER_A);
    assert.equal(linked.referral_code, CODE_B);
    assert.equal(linked.status, 'linked');
    assert.equal(linked.partner_name, 'Partner Bala');
    assert.ok(linked.linked_at);

    // The relationship read-back agrees (partner name resolved from profiles).
    assert.deepEqual(await rpc(db, USER_1, 'get_my_growth_referral'), linked);

    // Onboarding status reflects the link.
    const status = await rpc(db, USER_1, 'get_my_onboarding_status');
    assert.equal(status.status, 'linked');
    assert.equal(status.linked, true);
    assert.equal(status.growth_partner_id, PARTNER_B);
    assert.equal(status.referral_code, CODE_B);

    // A second user linking the other code lands on the other partner.
    const linked2 = await rpc(db, USER_2, 'link_my_growth_referral', [CODE_A]);
    assert.equal(linked2.growth_partner_id, PARTNER_A);
    assert.equal(linked2.partner_name, 'Partner Anita');
  } finally {
    await db.close();
  }
});

test('invalid links and self-referral are rejected without creating ownership', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B, false);

    await assert.rejects(rpc(db, USER_1, 'link_my_growth_referral', ['NOPE99']), /Invalid or inactive referral code/);
    await assert.rejects(rpc(db, USER_1, 'link_my_growth_referral', ['x']), /Invalid referral code/);
    await assert.rejects(rpc(db, USER_1, 'link_my_growth_referral', [CODE_B]), /Invalid or inactive referral code/);
    // A partner cannot use their own code.
    await assert.rejects(rpc(db, PARTNER_A, 'link_my_growth_referral', [CODE_A]), /own referral code/);

    // None of the failures left an ownership row behind.
    assert.equal((await db.query('select * from public.growth_onboarding')).rows.length, 0);
    assert.equal(await rpc(db, USER_1, 'get_my_growth_referral'), null);
  } finally {
    await db.close();
  }
});

test('referral ownership is immutable: linked users cannot switch partners or write around the RPC', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B);
    await rpc(db, USER_1, 'link_my_growth_referral', [CODE_A]);

    // Re-linking (even to the same code) is refused.
    await assert.rejects(rpc(db, USER_1, 'link_my_growth_referral', [CODE_B]), /already linked/);
    await assert.rejects(rpc(db, USER_1, 'link_my_growth_referral', [CODE_A]), /already linked/);

    // Ownership is unchanged after the attempts.
    assert.equal((await rpc(db, USER_1, 'get_my_growth_referral')).growth_partner_id, PARTNER_A);

    // Direct UPDATE of the owner column is denied (no write grant at all).
    const steal = await captureError(
      asUser(
        db,
        USER_1,
        'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid',
        [PARTNER_B, USER_1]
      )
    );
    assert.match(steal.message, /permission denied|row-level security/i);

    // Another user cannot rewrite someone else's owner either.
    const cross = await captureError(
      asUser(
        db,
        USER_2,
        'update public.growth_onboarding set growth_partner_id = $1::uuid where user_id = $2::uuid',
        [PARTNER_B, USER_1]
      )
    );
    assert.match(cross.message, /permission denied|row-level security/i);

    // Direct INSERT/UPDATE/DELETE on onboarding rows are all denied for clients.
    for (const sql of [
      `insert into public.growth_onboarding(user_id, status) values ('${USER_3}', 'template_completed')`,
      `update public.growth_onboarding set status = 'template_completed' where user_id = '${USER_1}'`,
      `delete from public.growth_onboarding where user_id = '${USER_1}'`,
    ]) {
      const err = await captureError(asUser(db, USER_1, sql));
      assert.match(err.message, /permission denied|row-level security/i);
    }

    // Ownership row is byte-identical after every attack.
    const row = (await db.query<any>('select * from public.growth_onboarding where user_id = $1::uuid', [USER_1]))
      .rows[0];
    assert.equal(row.growth_partner_id, PARTNER_A);
    assert.equal(row.referral_code, CODE_A);
    assert.equal(row.status, 'linked');
  } finally {
    await db.close();
  }
});

test('growth_partners is not client-writable and partner provisioning is admin-only', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);

    // A normal client cannot self-provision as a partner.
    const selfServe = await captureError(
      asUser(
        db,
        USER_1,
        'insert into public.growth_partners(user_id, referral_code) values ($1::uuid, $2)',
        [USER_1, 'HACKED1']
      )
    );
    assert.match(selfServe.message, /permission denied|row-level security/i);

    // Partners cannot change (or delete) partner rows, not even their own.
    for (const sql of [
      `update public.growth_partners set referral_code = 'HACKED1' where user_id = '${PARTNER_A}'`,
      `update public.growth_partners set is_active = false where user_id = '${PARTNER_A}'`,
      `delete from public.growth_partners where user_id = '${PARTNER_A}'`,
    ]) {
      const err = await captureError(asUser(db, PARTNER_A, sql));
      assert.match(err.message, /permission denied|row-level security/i);
    }

    // The provision RPC itself rejects authenticated callers (no EXECUTE grant).
    const rpcDenied = await captureError(
      asUser(db, USER_1, 'select public.provision_growth_partner($1::uuid, $2)', [USER_1, 'HACKED1'])
    );
    assert.match(rpcDenied.message, /permission denied for function/);

    // Private helpers are not callable either (no user enumeration via names).
    const helperDenied = await captureError(
      asUser(db, USER_1, 'select public.growth_partner_display_name($1::uuid)', [PARTNER_A])
    );
    assert.match(helperDenied.message, /permission denied for function/);

    // Admin provisioning still works and deactivation blocks new links only.
    await provision(db, PARTNER_B, CODE_B);
    await rpc(db, USER_2, 'link_my_growth_referral', [CODE_B]);
    assert.equal((await provision(db, PARTNER_B, CODE_B, false)).is_active, false);
    await assert.rejects(rpc(db, USER_3, 'link_my_growth_referral', [CODE_B]), /Invalid or inactive/);
    // ...while the pre-existing link is preserved.
    assert.equal((await rpc(db, USER_2, 'get_my_growth_referral')).growth_partner_id, PARTNER_B);
  } finally {
    await db.close();
  }
});

test('onboarding reads are isolated: users see only self, partners see only their own referrals', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B);
    await rpc(db, USER_1, 'link_my_growth_referral', [CODE_A]);
    await rpc(db, USER_2, 'link_my_growth_referral', [CODE_B]);
    await rpc(db, USER_3, 'update_my_onboarding_progress', ['start_template']);

    // Users see exactly their own row.
    assert.equal((await asUser(db, USER_1, 'select * from public.growth_onboarding')).rows.length, 1);
    assert.equal(
      (await asUser(db, USER_2, 'select * from public.growth_onboarding where user_id = $1::uuid', [USER_1]))
        .rows.length,
      0
    );

    // Each partner sees ONLY their own referral's row.
    const aRows = (await asUser(db, PARTNER_A, 'select user_id from public.growth_onboarding')).rows;
    assert.deepEqual(
      aRows.map((r: any) => r.user_id),
      [USER_1]
    );
    const bRows = (await asUser(db, PARTNER_B, 'select user_id from public.growth_onboarding')).rows;
    assert.deepEqual(
      bRows.map((r: any) => r.user_id),
      [USER_2]
    );
    // The organic (unlinked, in-progress) user is visible to nobody but self.
    assert.equal(
      (await asUser(db, PARTNER_A, 'select * from public.growth_onboarding where user_id = $1::uuid', [USER_3]))
        .rows.length,
      0
    );

    // growth_partners exposes only the caller's own row; codes are not listable.
    assert.equal((await asUser(db, USER_1, 'select * from public.growth_partners')).rows.length, 0);
    const partnerRows = (await asUser(db, PARTNER_A, 'select user_id from public.growth_partners')).rows;
    assert.deepEqual(
      partnerRows.map((r: any) => r.user_id),
      [PARTNER_A]
    );

    // Anonymous callers cannot read either table.
    await assert.rejects(asUser(db, '', 'select * from public.growth_onboarding'), /permission denied/);
    await assert.rejects(asUser(db, '', 'select * from public.growth_partners'), /permission denied/);

    // Status RPCs are strictly per-caller.
    assert.equal((await rpc(db, USER_1, 'get_my_onboarding_status')).growth_partner_id, PARTNER_A);
    assert.equal((await rpc(db, USER_2, 'get_my_onboarding_status')).growth_partner_id, PARTNER_B);
    assert.equal(await rpc(db, USER_3, 'get_my_growth_referral'), null);
  } finally {
    await db.close();
  }
});

test('onboarding progress is forward-only, idempotent and server-timestamped', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);

    // Fresh users get defaults WITHOUT a row being created (read has no side effects).
    assert.deepEqual(await rpc(db, USER_1, 'get_my_onboarding_status'), {
      status: 'not_started',
      linked: false,
      growth_partner_id: null,
      referral_code: null,
      linked_at: null,
      template_started_at: null,
      template_completed_at: null,
    });
    assert.equal(
      (await db.query('select * from public.growth_onboarding where user_id = $1::uuid', [USER_1])).rows.length,
      0
    );

    // Completion without a start is rejected (backend validation).
    await assert.rejects(rpc(db, USER_1, 'update_my_onboarding_progress', ['complete_template']), /Start the template/);
    await assert.rejects(rpc(db, USER_1, 'update_my_onboarding_progress', ['skip_everything']), /Unknown onboarding action/);

    // Start sets the server timestamp; repeating is idempotent (same instant).
    const started = await rpc(db, USER_1, 'update_my_onboarding_progress', ['start_template']);
    assert.equal(started.status, 'template_started');
    assert.ok(started.template_started_at);
    assert.equal(started.template_completed_at, null);
    const startedAgain = await rpc(db, USER_1, 'update_my_onboarding_progress', ['start_template']);
    assert.equal(startedAgain.template_started_at, started.template_started_at);

    // Linking AFTER starting preserves progress (link and progress are orthogonal).
    const relinked = await rpc(db, USER_1, 'link_my_growth_referral', [CODE_A]);
    assert.equal(relinked.status, 'template_started');
    assert.equal(relinked.growth_partner_id, PARTNER_A);

    // Complete sets the server timestamp at/after the start; repeating is idempotent.
    const done = await rpc(db, USER_1, 'update_my_onboarding_progress', ['complete_template']);
    assert.equal(done.status, 'template_completed');
    assert.ok(done.template_completed_at);
    assert.ok(Date.parse(done.template_completed_at) >= Date.parse(done.template_started_at));
    const doneAgain = await rpc(db, USER_1, 'update_my_onboarding_progress', ['complete_template']);
    assert.equal(doneAgain.template_completed_at, done.template_completed_at);
    assert.equal(doneAgain.status, 'template_completed');

    // Starting after completion is a no-op (terminal state cannot regress).
    const afterDone = await rpc(db, USER_1, 'update_my_onboarding_progress', ['start_template']);
    assert.equal(afterDone.status, 'template_completed');

    // Other users are unaffected (per-user isolation of progress writes).
    assert.equal((await rpc(db, USER_2, 'get_my_onboarding_status')).status, 'not_started');

    // Organic users (no partner) can complete the same flow end to end.
    await rpc(db, USER_4, 'update_my_onboarding_progress', ['start_template']);
    const organic = await rpc(db, USER_4, 'update_my_onboarding_progress', ['complete_template']);
    assert.equal(organic.status, 'template_completed');
    assert.equal(organic.linked, false);
  } finally {
    await db.close();
  }
});

test('the migration is idempotent and preserves existing partner, link and progress data', async () => {
  const db = await setup();
  try {
    await provision(db, PARTNER_A, CODE_A);
    await provision(db, PARTNER_B, CODE_B);
    await rpc(db, USER_1, 'link_my_growth_referral', [CODE_A]);
    await rpc(db, USER_1, 'update_my_onboarding_progress', ['start_template']);
    await rpc(db, USER_1, 'update_my_onboarding_progress', ['complete_template']);

    const beforePartners = (await db.query('select * from public.growth_partners order by user_id')).rows;
    const beforeOnboarding = (await db.query('select * from public.growth_onboarding order by user_id')).rows;

    // Re-apply the whole migration exactly like `supabase db push` / SQL Editor would.
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);

    assert.deepEqual((await db.query('select * from public.growth_partners order by user_id')).rows, beforePartners);
    assert.deepEqual(
      (await db.query('select * from public.growth_onboarding order by user_id')).rows,
      beforeOnboarding
    );

    // Everything still works after the re-apply.
    assert.equal((await rpc(db, USER_1, 'get_my_onboarding_status')).status, 'template_completed');
    assert.equal((await rpc(db, USER_2, 'link_my_growth_referral', [CODE_B])).growth_partner_id, PARTNER_B);
    const dup = await captureError(provision(db, PARTNER_A, CODE_B));
    assert.equal(dup.code, '23505');
  } finally {
    await db.close();
  }
});

test('growth partner client helpers normalize codes and never reference the service role', () => {
  assert.equal(normalizeGrowthReferralCode('  alpha01 '), 'ALPHA01');
  assert.equal(isGrowthReferralCodeFormat('ALPHA01'), true);
  assert.equal(isGrowthReferralCodeFormat('  beta002'), true);
  // Loyalty NX- codes belong to the separate check-in credit flow, not here.
  assert.equal(isGrowthReferralCodeFormat('NX-ABC123'), false);
  assert.equal(isGrowthReferralCodeFormat('bad!'), false);
  assert.equal(isGrowthReferralCodeFormat(''), false);

  const src = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  // Strip comments: documentation may NAME the service role, but no code may touch it.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE|getSupabaseAdmin|supabaseAdmin/);
  assert.match(codeOnly, /from '\.\/supabaseClient'/);
});
