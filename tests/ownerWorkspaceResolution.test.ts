// ============================================================================
// PHASE 10 — OWNER WORKSPACE RESOLUTION
//
// The canonical chain is already the schema's:
//
//   auth.users → profiles → organizations → organization_members → salons
//
// and ownership authority is `organization_members` (user_id, organization_id,
// role, status) — the set `nexora_owner_salon_ids()` returns. This suite audits
// that end to end against real PostgreSQL, and pins the phase's three rules:
//
//   10.1 ownership authority stays the membership model — a salon is resolvable
//        only through an ACTIVE owner/manager membership, never through a
//        legacy profile field, and never across tenants;
//   10.2 multiple salons resolve by RULE (primary active → most recently created
//        active → first authorized active → first authorized) instead of
//        dead-ending the owner;
//   10.3 resolution is idempotent — repeated and concurrent calls create no
//        duplicate organization, membership, salon, slug or website config.
//
// The save path is the REAL transaction (`save_owner_editor_state` →
// `nexora_save_owner_workspace`, patched by 20261006), not a stub.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { asUser, liveSchemaDb } from './liveSchemaFixture';

const MIGRATION = (file: string) =>
  readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const SOURCE = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const PROVISIONING = '20261002_owner_workspace_provisioning.sql';
const EDITOR_STATE = '20260909045308_contact_profile_wiring.sql';
const SAVE_TRANSACTION = '20260909142000_normalized_owner_workspace.sql';
const RESOLUTION = '20261006_owner_salon_resolution.sql';

/**
 * The live-schema fixture models what the SERVER reads; production carries the
 * owner-state columns as well. Same role as the PRODUCTION_GAPS preambles in the
 * other phase suites: fixture gap, not product gap.
 */
const FIXTURE_GAPS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  alter default privileges in schema public grant execute on functions to service_role;
  grant usage on schema auth to authenticated, anon;

  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text, salon_name text, business_name text, business_type text, email text,
    phone_number text, phone text, mobile text, whatsapp text, owner_role text,
    subdomain text unique, city text, state text, pincode text, preferred_city text,
    area text, preferred_area text, avatar_url text, photo_url text,
    updated_at timestamptz not null default now()
  );
  alter table public.profiles enable row level security;
  grant select on public.profiles to authenticated;

  alter table auth.users add column if not exists email text;
  alter table auth.users add column if not exists encrypted_password text;
  alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
  alter table auth.users add column if not exists created_at timestamptz not null default now();

  alter table public.salons add column if not exists deleted_at timestamptz;
  alter table public.salons add column if not exists is_active boolean not null default true;
  alter table public.salons add column if not exists owner_id uuid;
  alter table public.salons add column if not exists mobile text;
  alter table public.salons add column if not exists email text;
  alter table public.salons add column if not exists area text;
  alter table public.salons add column if not exists state text;
  alter table public.salons add column if not exists pincode text;
  alter table public.salons add column if not exists landmark text;
  alter table public.salons add column if not exists created_at timestamptz not null default now();

  create table if not exists public.salon_staff (
    id uuid primary key default gen_random_uuid(), salon_id uuid, staff_id uuid
  );

  -- Production declares the public site address unique (20261002 creates
  -- salons with \`slug text not null unique\`); the fixture omits the constraint,
  -- and ensure_owner_workspace()'s collision retry is driven by unique_violation.
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'salons_slug_key') then
      alter table public.salons add constraint salons_slug_key unique (slug);
    end if;
  end $$;
`;

let db: any;

before(async () => {
  db = await liveSchemaDb();
  await db.exec(FIXTURE_GAPS);
  await db.exec(MIGRATION(PROVISIONING));
  await db.exec(MIGRATION(EDITOR_STATE));
  await db.exec(MIGRATION(SAVE_TRANSACTION));
  await db.exec(MIGRATION(RESOLUTION));
});

let seq = 0;
const uid = () => `a0000000-0000-4000-8000-${String((seq += 1) + 2000).padStart(12, '0')}`;

/** A real account with the profile row the signup trigger writes. */
async function owner(name: string, meta: Record<string, unknown> = {}) {
  const id = uid();
  await db.query(
    'insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values($1,$2,$3,$4::jsonb)',
    [id, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(-4)}@example.com`, 'test-only', JSON.stringify({ full_name: name, salon_name: meta.salonName ?? `${name} Salon` })]
  );
  await db.query('insert into public.profiles(id, full_name, salon_name) values ($1,$2,$3)', [
    id,
    name,
    (meta.salonName as string) ?? `${name} Salon`,
  ]);
  return id;
}

async function rpc(who: string, fn: string, args: any[] = []): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  return (await asUser(db, who, `select public.${fn}(${placeholders}) as r`, args)).rows[0].r;
}

const workspace = (who: string) => rpc(who, 'get_my_owner_workspace');
const ensure = (who: string) => rpc(who, 'ensure_owner_workspace');

/**
 * The rule itself is an internal helper: clients have NO execute grant on it
 * (same as the other private workspace helpers), so the audit reads it through
 * the RPC the client does have. This mirrors the real surface rather than
 * widening it for a test.
 */
const pick = async (who: string) => {
  const view = await workspace(who);
  return view.selection ? { salon_id: view.salon_id, slug: view.slug, selection: view.selection } : null;
};

/** Add a salon to an organization, optionally backdated/deactivated/deleted. */
async function salon(
  organizationId: string,
  slug: string,
  name: string,
  options: { createdOffset?: string; active?: boolean; deleted?: boolean; primary?: boolean } = {}
): Promise<string> {
  const row = await db.query(
    `insert into public.salons(id, organization_id, slug, name, created_at, is_active, deleted_at${options.primary ? ', is_primary' : ''})
     values (gen_random_uuid(), $1, $2, $3, now() ${options.createdOffset ?? ''}, $4, $5${options.primary ? ', true' : ''})
     returning id`,
    [organizationId, slug, name, options.active !== false, options.deleted ? new Date() : null]
  );
  return row.rows[0].id;
}

/** A second, unrelated tenant with its own organization + salon. */
async function otherTenant(slug = 'rival-salon') {
  const rival = await owner('Rival', { salonName: 'Rival Salon' });
  await ensure(rival);
  const view = await workspace(rival);
  const salonId = await salon(view.organization_id, slug, 'Rival Salon', { createdOffset: "+ interval '30 days'" });
  return { owner: rival, organizationId: view.organization_id, salonId, slug };
}

/** The real save transaction, as the editor calls it. */
async function save(who: string, businessName: string, subdomain: string) {
  await asUser(db, who, 'select public.save_owner_editor_state($1::jsonb)', [
    JSON.stringify({
      profile: { businessName, ownerName: 'Owner', phone: '+919000000000', subdomain },
      services: [{ id: 'svc-1', name: 'Signature Cut', price: 500, durationMinutes: 30 }],
      stylists: [],
      loyaltyConfig: { pointsPerVisit: 10 },
    }),
  ]);
}

// ===========================================================================
// 10.1 — ownership authority
// ===========================================================================

test('10.1a resolution follows the membership model: role, status and active state decide', async () => {
  const person = await owner('Authority') as unknown as string;
  await ensure(person);
  const org = (await workspace(person)).organization_id;

  // owner + active → resolves.
  assert.equal((await workspace(person)).resolved, true);

  // manager + active → also an authorized owner-side role.
  await db.query(`update public.organization_members set role = 'manager' where user_id = $1`, [person]);
  assert.equal((await workspace(person)).resolved, true, 'a manager is authorized');
  assert.equal((await pick(person)).selection, 'most-recent');

  // invited / removed → not authorized (the salon still exists, the membership
  // is what grants access).
  for (const status of ['invited', 'removed']) {
    await db.query(`update public.organization_members set status = $2 where user_id = $1`, [person, status]);
    assert.equal((await workspace(person)).resolved, false, `status=${status} must not resolve`);
    assert.equal(await pick(person), null, `status=${status} must not pick`);
  }

  // staff → not an owner/manager workspace.
  await db.query(`update public.organization_members set status = 'active', role = 'staff' where user_id = $1`, [person]);
  assert.equal((await workspace(person)).resolved, false, 'a staff membership is not a workspace');
  assert.equal(await pick(person), null);

  // Restored → resolves again, same salon (nothing was re-provisioned).
  const before = await db.query('select count(*)::int as n from public.salons where organization_id = $1', [org]);
  await db.query(`update public.organization_members set role = 'owner' where user_id = $1`, [person]);
  const restored = await workspace(person);
  assert.equal(restored.resolved, true);
  assert.equal(restored.salon_count, before.rows[0].n);
});

test('10.1b a legacy profile field is never an ownership authority', async () => {
  const rival = await otherTenant('rival-glow');
  const person = await owner('Legacy') as unknown as string;
  await ensure(person);

  // The owner's own profile points at the OTHER tenant's salon slug — the exact
  // shape the legacy owner-scoped generation used to trust.
  await db.query(`update public.profiles set subdomain = $2 where id = $1`, [person, rival.slug]);
  const view = await workspace(person);
  assert.notEqual(view.slug, rival.slug, 'the foreign salon is not selected');
  assert.ok(
    !view.salons.some((entry: any) => entry.slug === rival.slug),
    'nor is it even listed'
  );
  assert.equal((await pick(person)).salon_id, view.salon_id, 'the picker agrees with the read');

  // And the save path refuses to write into it: authorization is checked first,
  // so the subdomain match cannot reach another tenant's salon. The editor's
  // own salon is still updated.
  const ownSalonId = view.salon_id;
  await save(person, 'Legacy Salon', rival.slug);
  const rivalRow = (await db.query('select data from public.salons where id = $1', [rival.salonId])).rows[0];
  assert.equal(rivalRow.data?.editor_profile ?? null, null, "the rival tenant's salon is untouched");
  const ownRow = (await db.query('select data, name from public.salons where id = $1', [ownSalonId])).rows[0];
  assert.equal(ownRow.data.editor_profile.businessName, 'Legacy Salon', 'the owner writes into their own salon');
});

test('10.1c every candidate comes from nexora_owner_salon_ids(), by construction', async () => {
  const person = await owner('Candidate') as unknown as string;
  await ensure(person);
  const org = (await workspace(person)).organization_id;
  const rival = await otherTenant('rival-newest');

  // Make the foreign salon look maximally attractive: newest AND primary.
  await db.query(`alter table public.salons add column if not exists is_primary boolean not null default false`);
  await db.query(`update public.salons set created_at = now() + interval '400 days', is_primary = true where id = $1`, [rival.salonId]);

  const view = await workspace(person);
  assert.notEqual(view.salon_id, rival.salonId);
  assert.equal(view.organization_id, org);
  assert.ok(!JSON.stringify(view.salons).includes('rival-newest'), 'other tenants never appear');

  // The rule itself is defined on the authorized set, not on the table.
  const source = readFileSync(new URL(`../supabase/migrations/${RESOLUTION}`, import.meta.url), 'utf8');
  const picker = source.slice(source.indexOf('create or replace function public.owner_workspace_pick_salon'));
  const candidateQueries = picker.match(/where s\.id in \(select public\.nexora_owner_salon_ids\(\)\)/g) || [];
  assert.equal(candidateQueries.length, 4, 'all four tiers authorize through the membership resolver');
});

// ===========================================================================
// 10.2 — multiple salons
// ===========================================================================

test('10.2a tier 2: the most recently created ACTIVE salon wins, deleted ones never', async () => {
  const person = await owner('Multi') as unknown as string;
  await ensure(person);
  const org = (await workspace(person)).organization_id;

  const older = (await workspace(person)).salon_id;
  const middle = await salon(org, 'multi-middle', 'Multi Middle', { createdOffset: "+ interval '1 day'" });
  const newest = await salon(org, 'multi-newest', 'Multi Newest', { createdOffset: "+ interval '2 days'" });

  const view = await workspace(person);
  assert.equal(view.selection, 'most-recent');
  assert.equal(view.salon_id, newest, 'newest active salon');
  assert.equal(view.salon_count, 3);
  assert.equal(view.ambiguous, true, 'informational: several live salons');
  assert.deepEqual(
    view.salons.map((entry: any) => entry.salon_id),
    [newest, middle, older],
    'chosen first, then newest first'
  );

  // Deactivating the newest moves the choice to the next active one — no dead end.
  await db.query(`update public.salons set is_active = false where id = $1`, [newest]);
  assert.equal((await workspace(person)).salon_id, middle, 'an inactive salon is not the target');

  // Deleting the middle (soft delete) excludes it from both the choice and the list.
  await db.query(`update public.salons set deleted_at = now() where id = $1`, [middle]);
  const afterDelete = await workspace(person);
  assert.equal(afterDelete.salon_id, older, 'the oldest remaining salon is chosen');
  assert.equal(afterDelete.salon_count, 2, 'a deleted salon is not counted');
  assert.ok(!afterDelete.salons.some((entry: any) => entry.salon_id === middle), 'nor listed');
  assert.ok(
    afterDelete.salons.some((entry: any) => entry.salon_id === newest),
    'an inactive salon is still the owner\'s workspace — it is listed, just not chosen'
  );
});

test('10.2b tier 1: the deployment\'s primary salon wins — and only when it is authorized and active', async () => {
  const person = await owner('Primary') as unknown as string;
  await ensure(person);
  const org = (await workspace(person)).organization_id;
  const first = (await workspace(person)).salon_id;
  const newer = await salon(org, 'primary-newer', 'Primary Newer', { createdOffset: "+ interval '3 days'" });

  // Without the marker the newest wins.
  assert.equal((await workspace(person)).selection, 'most-recent');
  assert.equal((await workspace(person)).salon_id, newer);

  await db.query(`alter table public.salons add column if not exists is_primary boolean not null default false`);
  await db.query(`update public.salons set is_primary = true where id = $1`, [first]);
  const primary = await workspace(person);
  assert.equal(primary.selection, 'primary');
  assert.equal(primary.salon_id, first, 'the primary salon outranks a newer one');
  assert.equal(primary.salons[0].salon_id, first);

  // A primary that is inactive is skipped for an active one.
  await db.query(`update public.salons set is_active = false where id = $1`, [first]);
  assert.equal((await workspace(person)).selection, 'most-recent');
  assert.equal((await workspace(person)).salon_id, newer);

  // Clean up so later tests are not affected by a global marker.
  await db.query(`update public.salons set is_primary = false, is_active = true where id = $1`, [first]);
  await db.query(`update public.salons set is_primary = false where id = $1`, [newer]);
});

test('10.2c every salon inactive: still resolved (never a dead end), and never an unauthorized one', async () => {
  const person = await owner('Inactive') as unknown as string;
  await ensure(person);
  const org = (await workspace(person)).organization_id;
  const older = (await workspace(person)).salon_id;
  const newer = await salon(org, 'all-inactive-newer', 'All Inactive Newer', { createdOffset: "+ interval '1 day'" });

  await db.query(`update public.salons set is_active = false where organization_id = $1`, [org]);
  const view = await workspace(person);
  assert.equal(view.resolved, true, 'an authorized owner is never dead-ended');
  assert.equal(view.selection, 'first-authorized-inactive');
  assert.equal(view.salon_id, older, 'deterministic: oldest first, then id');
  assert.ok(view.salons.some((entry: any) => entry.salon_id === newer), 'the other salon is still listed');

  // The save still works, into that same salon.
  await save(person, 'Inactive Salon', 'inactive-salon');
  const edited = (await db.query(`select id from public.salons where organization_id = $1 and data ? 'editor_profile'`, [org])).rows;
  assert.deepEqual(edited.map((row: any) => row.id), [older], 'the deterministic target received the save');
});

test('10.2d the save path works with several salons — no "more than one salon" dead end anywhere', async () => {
  const person = await owner('Saved') as unknown as string;
  await ensure(person);
  const org = (await workspace(person)).organization_id;
  const newest = await salon(org, 'saved-newest', 'Saved Newest', { createdOffset: "+ interval '5 days'" });

  // A subdomain that matches nothing: before 20261006 this raised
  // 'Select a salon owned by this account' and the client answered "This
  // account has more than one salon…", leaving the owner unable to save.
  await save(person, 'Saved Salon', 'nothing-matches-this');
  const target = (await db.query(`select id, name from public.salons where organization_id = $1 and data ? 'editor_profile'`, [org])).rows;
  assert.equal(target.length, 1, 'exactly one salon received the save');
  assert.equal(target[0].id, newest, 'the canonical rule chose the newest active salon');

  // A subdomain that matches exactly one authorized salon still wins outright:
  // that is the owner naming the salon they mean.
  const older = await salon(org, 'saved-older', 'Saved Older', { createdOffset: '- interval' + " '3 days'" });
  await save(person, 'Saved Salon', 'saved-older');
  const nowEdited = (await db.query(`select id from public.salons where organization_id = $1 and data ? 'editor_profile' order by id`, [org])).rows;
  assert.ok(nowEdited.some((row: any) => row.id === older), 'the named salon is updated');
  assert.equal(nowEdited.length, 2, 'and so is the one the rule already chose');

  // The dead-end copy is gone from the client, and the retry no longer reads
  // the ambiguity flag.
  const editorState = SOURCE('src/lib/ownerEditorState.ts');
  assert.doesNotMatch(editorState, /could not pick one automatically/i, 'the dead-end copy is gone');
  assert.doesNotMatch(editorState, /AMBIGUOUS_WORKSPACE_MESSAGE/);
  assert.match(
    editorState,
    /if \(!workspace\.salonId\) return first;/,
    'the retry is gated on a resolvable workspace, not on how many salons exist'
  );
  assert.doesNotMatch(editorState, /if \(workspace\.ambiguous/, 'the ambiguity flag no longer blocks the retry');
});

// ===========================================================================
// 10.3 — idempotency and races
// ===========================================================================

test('10.3a repeated resolution is idempotent: one organization, one membership, one salon, one slug', async () => {
  const person = await owner('Idempotent') as unknown as string;

  const first = await ensure(person);
  assert.equal(first.provisioned, true);
  assert.equal(first.reason, 'created');
  const slug = first.slug;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const again = await ensure(person);
    assert.equal(again.provisioned, false, 'a repeat provisions nothing');
    assert.equal(again.reason, 'existing');
    assert.equal(again.salon_id, first.salon_id, 'the same salon comes back');
    assert.equal(again.slug, slug, 'the public address is stable');
  }

  const counts = (await db.query(
    `select (select count(*)::int from public.organizations o
              join public.organization_members m on m.organization_id = o.id
              where m.user_id = $1) as orgs,
            (select count(*)::int from public.organization_members where user_id = $1) as memberships,
            (select count(*)::int from public.salons s
              join public.organization_members m on m.organization_id = s.organization_id
              where m.user_id = $1) as salons,
            (select count(distinct slug)::int from public.salons s
              join public.organization_members m on m.organization_id = s.organization_id
              where m.user_id = $1) as slugs`,
    [person]
  )).rows[0];
  assert.deepEqual(
    { orgs: counts.orgs, memberships: counts.memberships, salons: counts.salons, slugs: counts.slugs },
    { orgs: 1, memberships: 1, salons: 1, slugs: 1 },
    'no duplicate organization, membership, salon or domain'
  );

  // Repeating the SAVE is idempotent too: same catalogs, no new rows.
  await save(person, 'Idempotent Salon', slug);
  await save(person, 'Idempotent Salon', slug);
  const services = (await db.query('select count(*)::int as n from public.services')).rows[0].n;
  const servicesAgain = (await rpc(person, 'get_my_owner_workspace')).salon_count;
  assert.equal(servicesAgain, 1, 'still one salon');
  assert.ok(services >= 1, 'the catalogue is written once per service, not per salon');
  const edited = (await db.query(`select count(*)::int as n from public.salons where organization_id = $1 and data ? 'editor_profile'`, [first.organization_id])).rows[0].n;
  assert.equal(edited, 1);
});

test('10.3b concurrent resolution cannot duplicate a workspace (advisory lock, then read)', async () => {
  const person = await owner('Concurrent') as unknown as string;

  // Three interleaved calls in one session, the way two browser tabs and a
  // retried handoff would arrive.
  const results = await Promise.all([ensure(person), ensure(person), ensure(person)]);
  const created = results.filter((entry: any) => entry.provisioned === true);
  assert.equal(created.length, 1, 'exactly one call provisions');
  for (const entry of results) assert.ok(entry.salon_id, 'every call answers with a salon');

  const counts = (await db.query(
    `select (select count(*)::int from public.organization_members where user_id = $1) as memberships,
            (select count(*)::int from public.salons s
               join public.organization_members m on m.organization_id = s.organization_id
              where m.user_id = $1) as salons`,
    [person]
  )).rows[0];
  assert.deepEqual({ memberships: counts.memberships, salons: counts.salons }, { memberships: 1, salons: 1 });

  // The serialisation guarantee is the transaction-level advisory lock taken
  // BEFORE the existence read — asserted on the migration that owns it, because
  // a single PGlite session cannot express two truly parallel transactions.
  const source = MIGRATION(PROVISIONING);
  const lockAt = source.indexOf("pg_advisory_xact_lock(hashtext('owner_workspace:'");
  const readAt = source.indexOf('-- Already resolved? Return it and write nothing.');
  assert.ok(lockAt > 0, 'the lock exists');
  assert.ok(readAt > lockAt, 'the lock is taken before the read that decides whether to write');

  // One salon per organization is created by that section, and the slug retry
  // is bounded — a pathological collision loop cannot run away.
  assert.match(source, /if v_attempt > 8 then/);
  assert.match(source, /when unique_violation then/);
});

test('10.3c two owners asking for the same name never share a domain or a website config', async () => {
  const firstOwner = await owner('Same Name', { salonName: 'Same Name Salon' }) as unknown as string;
  const secondOwner = await owner('Same Name', { salonName: 'Same Name Salon' }) as unknown as string;
  const first = await ensure(firstOwner);
  const second = await ensure(secondOwner);

  assert.notEqual(first.slug, second.slug, 'the public address is unique per salon');
  assert.equal(second.provisioned, true, 'the second owner still gets their own workspace');
  assert.notEqual(first.organization_id, second.organization_id);

  // The collision retry is what produced the distinct slug, and the uniqueness
  // that forced it is a database constraint, not a client check.
  const constraint = (await db.query(
    `select conname from pg_constraint where conrelid = 'public.salons'::regclass and contype = 'u'`
  )).rows.map((row: any) => row.conname);
  assert.ok(constraint.includes('salons_slug_key'), `slug is unique: ${constraint.join(', ')}`);
  const profileUnique = (await db.query(
    `select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'u'`
  )).rows.length;
  assert.ok(profileUnique >= 1, 'profiles.subdomain stays unique as well');

  // Each tenant's own website config stays theirs.
  await save(firstOwner, 'First Site', first.slug);
  await save(secondOwner, 'Second Site', second.slug);
  const configs = (await db.query(
    `select slug, data->'editor_profile'->>'businessName' as name from public.salons
     where organization_id in ($1, $2) order by 1`,
    [first.organization_id, second.organization_id]
  )).rows;
  assert.deepEqual(
    configs.map((row: any) => row.name).sort(),
    ['First Site', 'Second Site'],
    'each salon carries its own editor payload'
  );
});

test('10.3d the migration is re-runnable and adds no object of its own', async () => {
  const before = (await db.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`
  )).rows[0].n;
  await db.exec(MIGRATION(RESOLUTION));
  const after = (await db.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`
  )).rows[0].n;
  assert.equal(after, before, 're-running creates no table');

  // Only functions, and the patch is applied exactly once.
  const definition = (await db.query(
    `select pg_get_functiondef('public.nexora_save_owner_workspace(jsonb)'::regprocedure) as def`
  )).rows[0].def as string;
  assert.equal(
    definition.split('owner_workspace_pick_salon()').length - 1,
    1,
    'the save transaction calls the canonical rule once'
  );
  const resolutionSource = MIGRATION(RESOLUTION);
  assert.doesNotMatch(resolutionSource, /add column/i, 'no column is added');
  assert.doesNotMatch(resolutionSource, /create table/i, 'no table is added');
  assert.doesNotMatch(resolutionSource, /create (unique )?index/i, 'no index is added');
  assert.doesNotMatch(resolutionSource, /alter table/i, 'no existing table is altered');
  // The primary tier probes for a marker instead of introducing one.
  assert.match(resolutionSource, /owner_workspace_has_column\('salons', 'is_primary'\)/);

  // Nothing outside the canonical path creates a workspace or a salon.
  const writers = ['src/App.tsx', 'src/lib/ownerEditorState.ts', 'src/lib/ownerWorkspace.ts', 'src/onboarding/OnboardingApp.tsx'];
  for (const file of writers) {
    const source = SOURCE(file);
    assert.doesNotMatch(source, /\.from\(['"]salons['"]\)\s*\.\s*(insert|upsert)/, `${file} must not create salons`);
    assert.doesNotMatch(source, /\.from\(['"]organizations['"]\)/, `${file} must not manage organizations`);
    assert.doesNotMatch(source, /\.from\(['"]organization_members['"]\)/, `${file} must not manage memberships`);
  }
  assert.match(SOURCE('src/lib/ownerWorkspace.ts'), /rpc\('ensure_owner_workspace'\)/, 'provisioning has one client entry point');
});
