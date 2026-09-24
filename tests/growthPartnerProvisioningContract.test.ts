// ============================================================================
// Provisioning contract — the ONE way a partner row is created.
//
// A migration proposing a second entry point was submitted as:
//
//   create unique index if not exists growth_partners_user_id_key
//     on public.growth_partners(user_id);
//   create or replace function public.get_or_create_my_growth_partner() …
//     insert into public.growth_partners (user_id) values (uid) …
//     if result.id is null then …
//
// It cannot work against this schema, and where it does work it duplicates a
// path that is already audited. This file turns each of those facts into an
// assertion, so the next submission like it fails here instead of in production:
//
//   1. `user_id` is already the PRIMARY KEY — a second unique index is dead
//      weight, and the schema must not grow one.
//   2. `user_id` stays the identity: a later migration added an internal `id`
//      surrogate for the referrals FK, so `result.id` is a valid reference — but
//      existence is decided by user_id, and nothing may provision by `id`.
//   3. `referral_code` is NOT NULL + format-checked: a bare `insert (user_id)`
//      is a 23502, so provisioning MUST go through `provision_growth_partner`,
//      which generates a valid code.
//   4. Exactly ONE JWT-scoped entry point may exist, and it must keep its
//      audit properties (auth.uid() only, granted to authenticated only, never
//      reactivates a suspended partner).
//   5. The admin provisioner takes an actor uuid, so it must never be granted
//      to a browser role — including by a future migration.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

const migration = (name: string) => readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
const allMigrations = () => migrationFiles.map((name) => ({ name, sql: migration(name) }));

/** Comments stripped — only executable SQL counts. */
const sql = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const TABLE_SQL = migration('20260912_growth_partner_onboarding.sql');
const ENTRY_SQL = migration('20260922091000_direct_growth_partner_dashboard_access.sql');

// ---------------------------------------------------------------------------
// 1 + 2. The shape of the table decides what is redundant and what is invalid
// ---------------------------------------------------------------------------

test('growth_partners.user_id is the primary key, so no extra unique index is needed', () => {
  assert.match(
    TABLE_SQL,
    /create table if not exists public\.growth_partners \(\s*user_id uuid primary key/,
    'user_id must stay the PRIMARY KEY (the unique constraint already exists as growth_partners_pkey)'
  );

  // A second unique index on the same column is pure write overhead — and it
  // implies the constraint is missing, which is how duplicate rows get feared
  // into existence in review.
  for (const { name, sql: text } of allMigrations()) {
    assert.doesNotMatch(
      sql(text),
      /create unique index[^;]*growth_partners\s*\(\s*user_id/i,
      `${name}: user_id is already unique via the primary key`
    );
  }
});

test('user_id identifies a partner row; id is a later surrogate and never the identity', () => {
  const table = sql(TABLE_SQL);
  const columns = table.match(/create table if not exists public\.growth_partners \(([\s\S]*?)\);/);
  assert.ok(columns, 'table definition found');
  const names = columns![1]
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name && !name.startsWith('--'));
  assert.ok(names.includes('user_id'), 'user_id is the identity');
  assert.ok(!names.includes('id'), 'the surrogate id arrived later, not in the original table');

  // It exists as of 20260928 — and is documented there as an INTERNAL id for the
  // referrals FK, explicitly NOT a replacement for the user_id PK.
  const surrogate = sql(migration('20260928_partner_referrals_table.sql'));
  assert.match(surrogate, /alter table public\.growth_partners add column if not exists id uuid default gen_random_uuid\(\)/);
  // The "why" lives in a comment, so read the file un-stripped for it.
  assert.match(migration('20260928_partner_referrals_table.sql'), /Introduce a separate,/);
  assert.match(surrogate, /create unique index if not exists growth_partners_id_key on public\.growth_partners\(id\)/);

  // So: an existence check may not depend on `id` (a row exists iff its user_id
  // exists), and the client-facing identity stays user_id.
  assert.match(sql(ENTRY_SQL), /if existing\.user_id is not null then/, 'existence is user_id-based');
  const lib = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  assert.match(lib, /user_id: text\(row\.user_id\)/, 'the client model keys on user_id');
  assert.doesNotMatch(
    lib.replace(/--[^\n]*/g, ''),
    /normalizeGrowthPartnerRow[\s\S]{0,400}?\bid:\s*text\(row\.id\)/,
    'the surrogate id is not part of the client partner model'
  );
});

// ---------------------------------------------------------------------------
// 3. Every insert generates a code — the bare `insert (user_id)` cannot work
// ---------------------------------------------------------------------------

test('referral_code is required, so provisioning always goes through the code generator', () => {
  assert.match(TABLE_SQL, /referral_code text not null/, 'referral_code is NOT NULL');
  assert.match(
    TABLE_SQL,
    /growth_partners_code_format check \(referral_code ~ '\^\[A-Z0-9\]\{6,12\}\$'\)/,
    'and format-checked'
  );

  for (const { name, sql: text } of allMigrations()) {
    const code = sql(text);
    for (const insert of code.matchAll(/insert into public\.growth_partners[\s\S]{0,200}?values\s*\(([^;]*?)\)/g)) {
      const statement = insert[0];
      assert.match(
        statement,
        /referral_code|provision_growth_partner/,
        `${name}: inserting a partner row without a referral_code is a 23502`
      );
    }
  }
});

test('the admin provisioner is what mints codes, and it stays admin-only', () => {
  const provisioner = sql(TABLE_SQL);
  assert.match(provisioner, /create or replace function public\.provision_growth_partner\(\s*p_user_id uuid/, 'takes an actor id by design');
  assert.match(provisioner, /substr\(md5\(gen_random_uuid\(\)::text\), 1, 8\)/, 'the code is generated, not assumed');
  assert.match(
    provisioner,
    /revoke all on function public\.provision_growth_partner\(uuid, text, boolean\) from public, anon, authenticated/,
    'no browser role may call it — it accepts ANY user id'
  );
  // And no later migration may hand it back.
  for (const { name, sql: text } of allMigrations()) {
    assert.doesNotMatch(
      sql(text),
      /grant execute on function public\.provision_growth_partner(_by_email)?\s*\([^)]*\)\s+to\s+(anon|authenticated|public)/i,
      `${name} must not grant the admin provisioner to a browser role`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Exactly one JWT-scoped entry point, with its audit properties intact
// ---------------------------------------------------------------------------

test('exactly one session-scoped provisioning entry point exists', () => {
  const entryPoints = new Set<string>();
  for (const { sql: text } of allMigrations()) {
    for (const match of sql(text).matchAll(/create or replace function public\.([a-z_]*my_growth_partner[a-z_]*)\(/g)) {
      entryPoints.add(match[1]);
    }
  }
  // Reads are many (get_my_growth_partner, get_my_growth_partner_profile, …);
  // the PROVISIONING one is singular — a second name would be a second path.
  // Provisioning VERBS only: profile readers/writers (get_/save_my_growth_partner_profile)
  // are a different concern — this is about who may CREATE a partner row.
  const provisioning = [...entryPoints].filter((name) => /^(ensure|get_or_create|provision|create)_/.test(name));
  assert.deepEqual(
    provisioning,
    ['ensure_my_growth_partner'],
    'one provisioning entry point: a get_or_create_*/ensure_* twin must not be added'
  );
});

test('the entry point infers identity from the JWT and cannot touch another account', () => {
  const entry = sql(ENTRY_SQL);
  assert.match(entry, /actor uuid := auth\.uid\(\)/, 'identity comes from the session');
  assert.match(entry, /if actor is null then/, 'signed-out callers are refused');
  assert.match(entry, /using errcode = '42501'/, 'with the code the client classifies as "sign in"');
  assert.doesNotMatch(entry, /p_user_id|p_actor uuid/, 'it takes no identity argument at all');
  assert.doesNotMatch(entry, /where user_id = actor[\s\S]{0,80}(or|in)\s*\(/i, 'the read is scoped to actor only');
  assert.match(entry, /return public\.provision_growth_partner\(actor\)/, 'it provisions the caller and nobody else');
});

test('the entry point is granted to signed-in users only, and never reactivates a suspension', () => {
  const entry = sql(ENTRY_SQL);
  assert.match(entry, /security definer/, 'runs with definer rights');
  assert.match(entry, /set search_path = pg_catalog, public, pg_temp/, 'hardened search path, pg_temp last');
  assert.match(entry, /revoke all on function public\.ensure_my_growth_partner\(\) from public, anon/, 'anon cannot call it');
  assert.match(entry, /grant execute on function public\.ensure_my_growth_partner\(\) to authenticated/, 'authenticated can');
  // The suspension rule: an existing row is returned unchanged.
  assert.match(entry, /if existing\.user_id is not null then[\s\S]*?'is_active', existing\.is_active[\s\S]*?end if;/);
  // And the failure class we just made diagnosable must be announced to PostgREST.
  assert.match(entry, /notify pgrst, 'reload schema'/, 'a new function is invisible until PostgREST reloads');
});

// ---------------------------------------------------------------------------
// 5. The client calls that one name — SQL and TypeScript stay in step
// ---------------------------------------------------------------------------

test('the client and the facade call the audited function by name', () => {
  const lib = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  assert.match(lib, /\.rpc\('ensure_my_growth_partner'\)/, 'the lib calls the audited entry point');
  assert.doesNotMatch(lib, /get_or_create_my_growth_partner|p_user_id/, 'and never a twin or an identity argument');

  const facade = readFileSync(new URL('../src/services/growthPartner.ts', import.meta.url), 'utf8');
  assert.match(facade, /ensureMyGrowthPartner\(\)/, 'the facade delegates to it');

  // The name the SQL defines is the name the JS calls: if either side renames
  // the function, this is the assertion that says so.
  const entry = sql(ENTRY_SQL);
  assert.match(entry, /function public\.ensure_my_growth_partner\(\)/);
  assert.match(lib, /ensure_my_growth_partner/);
});
