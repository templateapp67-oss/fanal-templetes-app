import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// ============================================================================
// 20261002_owner_workspace_provisioning.sql
//
// The normalized workspace objects (organizations, organization_members,
// salons, nexora_owner_salon_ids) are read by nexora_save_owner_workspace(),
// template_website_is_complete() and four server modules, but no committed
// migration created them and nothing in the app ever inserted a row — so a
// user onboarded through PART 3 arrived with no salon to save into. These
// tests pin the provisioning contract against real PostgreSQL.
// ============================================================================

const MIGRATION = await readFile(
  new URL('../supabase/migrations/20261002_owner_workspace_provisioning.sql', import.meta.url),
  'utf8'
);
// PHASE 10 appended the canonical resolution rule + its read-side contract to
// the same objects, so the workspace contract is asserted with both applied.
const RESOLUTION_MIGRATION = await readFile(
  new URL('../supabase/migrations/20261006_owner_salon_resolution.sql', import.meta.url),
  'utf8'
);

const OWNER_A = 'c0000000-0000-4000-8000-000000000001';
const OWNER_B = 'c0000000-0000-4000-8000-000000000002';

interface Harness {
  db: PGlite;
  asUser: (userId: string | null, sql: string, params?: unknown[]) => Promise<any>;
  asRole: (role: string, sql: string, params?: unknown[]) => Promise<any>;
  close: () => Promise<void>;
}

async function setup(options: { preCreateNormalized?: boolean; profilesColumns?: string } = {}): Promise<Harness> {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table auth.users(id uuid primary key, email text);
    insert into auth.users(id, email) values ('${OWNER_A}', 'a@example.com'), ('${OWNER_B}', 'b@example.com');
    create table public.profiles (
      id uuid primary key,
      full_name text,
      ${options.profilesColumns ?? 'salon_name text, subdomain text'}
    );
    insert into public.profiles(id, full_name, ${options.profilesColumns ? 'business_name' : 'salon_name'})
      values ('${OWNER_A}', 'Owner A', ${options.profilesColumns ? '' : ''}'Glow Studio');
  `);
  if (options.preCreateNormalized) {
    // A project that already has the normalized generation, with EXTRA
    // not-null columns this repository knows nothing about.
    await db.exec(`
      create table public.organizations (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        billing_email text not null default 'billing@example.com',
        created_at timestamptz not null default now()
      );
      create table public.organization_members (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations(id),
        user_id uuid not null references auth.users(id),
        role text not null default 'owner',
        status text not null default 'active',
        invited_by text
      );
      create table public.salons (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations(id),
        slug text not null unique,
        name text not null,
        is_active boolean not null default true,
        deleted_at timestamptz,
        audit_note text
      );
      create function public.nexora_owner_salon_ids() returns setof uuid
        language sql stable as $$ select null::uuid where false $$;
    `);
  }
  await db.exec(MIGRATION);
  await db.exec(RESOLUTION_MIGRATION);
  const asUser = async (userId: string | null, sql: string, params: unknown[] = []) => {
    await db.query(`select set_config('request.jwt.claim.sub', ${userId ? `'${userId}'` : "''"}, false)`);
    await db.exec('set role authenticated');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role');
    }
  };
  const asRole = async (role: string, sql: string, params: unknown[] = []) => {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec(`set role ${role}`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role');
    }
  };
  return { db, asUser, asRole, close: () => db.close() };
}

const ensure = (h: Harness, userId: string | null = OWNER_A) =>
  h.asUser(userId, 'select public.ensure_owner_workspace() as r').then((res) => res.rows[0].r);

test('the migration creates the normalized workspace objects when a project has none', async () => {
  const h = await setup();
  try {
    for (const table of ['organizations', 'organization_members', 'salons']) {
      const row = (await h.db.query(`select to_regclass('public.${table}') as t`)).rows[0] as any;
      assert.ok(row.t, `public.${table} exists`);
    }
    const fn = (await h.db.query("select to_regprocedure('public.nexora_owner_salon_ids()') as f")).rows[0] as any;
    assert.ok(fn.f, 'nexora_owner_salon_ids exists so normalized saves can resolve a target');
    for (const name of ['public.ensure_owner_workspace()', 'public.get_my_owner_workspace()']) {
      const row = (await h.db.query(`select to_regprocedure('${name}') as f`)).rows[0] as any;
      assert.ok(row.f, `${name} exists`);
    }
    // RLS is on for every table this file creates.
    const rls = await h.db.query(
      `select relname, relrowsecurity from pg_class
       where relname in ('organizations','organization_members','salons') order by relname`
    );
    assert.deepEqual(rls.rows.map((r: any) => [r.relname, r.relrowsecurity]), [
      ['organization_members', true],
      ['organizations', true],
      ['salons', true],
    ]);
  } finally {
    await h.close();
  }
});

test('ensure_owner_workspace provisions the caller an organization, owner membership and salon', async () => {
  const h = await setup();
  try {
    const first = await ensure(h);
    assert.equal(first.provisioned, true);
    assert.equal(first.reason, 'created');
    assert.ok(first.organization_id);
    assert.ok(first.salon_id);
    assert.equal(first.name, 'Glow Studio', 'the salon is named from the owner profile');
    assert.equal(first.slug, 'glow-studio', 'the slug is derived from the name');

    const membership = (
      await h.db.query(
        `select role, status from public.organization_members where user_id = '${OWNER_A}'`
      )
    ).rows[0] as any;
    assert.deepEqual(membership, { role: 'owner', status: 'active' });

    const salons = (await h.db.query('select count(*)::int as n from public.salons')).rows[0] as any;
    assert.equal(salons.n, 1);

    // Resolution now succeeds through the same helper the save path uses.
    const ids = await h.asUser(OWNER_A, 'select array_agg(x)::text as ids from public.nexora_owner_salon_ids() x');
    assert.equal(ids.rows[0].ids, `{${first.salon_id}}`);
    const resolved = await h.asUser(OWNER_A, 'select public.get_my_owner_workspace() as r');
    assert.equal(resolved.rows[0].r.resolved, true);
    assert.equal(resolved.rows[0].r.salon_id, first.salon_id);
  } finally {
    await h.close();
  }
});

test('ensure_owner_workspace is idempotent and never duplicates a workspace', async () => {
  const h = await setup();
  try {
    const first = await ensure(h);
    const second = await ensure(h);
    assert.equal(second.provisioned, false);
    assert.equal(second.reason, 'existing');
    assert.equal(second.salon_id, first.salon_id);
    assert.equal(second.organization_id, first.organization_id);
    for (const table of ['organizations', 'organization_members', 'salons']) {
      const row = (await h.db.query(`select count(*)::int as n from public.${table}`)).rows[0] as any;
      assert.equal(row.n, 1, `${table} still has exactly one row`);
    }
  } finally {
    await h.close();
  }
});

test('each caller gets their own workspace and can only resolve their own', async () => {
  const h = await setup();
  try {
    await h.db.query(`insert into public.profiles(id, full_name, salon_name) values ('${OWNER_B}', 'Owner B', 'Blow Dry Bar')`);
    const a = await ensure(h, OWNER_A);
    const b = await ensure(h, OWNER_B);
    assert.notEqual(a.organization_id, b.organization_id);
    assert.notEqual(a.salon_id, b.salon_id);
    assert.notEqual(a.slug, b.slug);

    const aView = (await h.asUser(OWNER_A, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(aView.salon_id, a.salon_id);
    assert.equal(aView.slug, 'glow-studio');
    const bView = (await h.asUser(OWNER_B, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(bView.salon_id, b.salon_id);
    assert.equal(bView.slug, 'blow-dry-bar');

    const aSalons = await h.asUser(OWNER_A, 'select array_agg(x order by x)::text as ids from public.nexora_owner_salon_ids() x');
    assert.equal(aSalons.rows[0].ids, `{${a.salon_id}}`, 'a caller never sees another tenant\'s salon');
  } finally {
    await h.close();
  }
});

test('a slug collision is resolved with a suffix instead of failing', async () => {
  const h = await setup();
  try {
    // Occupy the slug the first caller would naturally get.
    await h.db.exec(`
      insert into public.organizations(id, name) values ('d0000000-0000-4000-8000-000000000009', 'Squatter');
      insert into public.salons(organization_id, slug, name)
        values ('d0000000-0000-4000-8000-000000000009', 'glow-studio', 'Squatter Salon');
    `);
    const result = await ensure(h);
    assert.equal(result.provisioned, true);
    assert.notEqual(result.slug, 'glow-studio');
    assert.match(result.slug, /^glow-studio-[a-f0-9]{6}$/, 'the retry appends a random suffix');
    assert.equal(result.name, 'Glow Studio');
  } finally {
    await h.close();
  }
});

test('an owner without a profile name still gets a usable workspace', async () => {
  const h = await setup();
  try {
    await h.db.query(`update public.profiles set salon_name = null, full_name = null where id = '${OWNER_A}'`);
    const result = await ensure(h);
    assert.equal(result.provisioned, true);
    assert.equal(result.name, 'My Salon');
    assert.equal(result.slug, 'my-salon');
  } finally {
    await h.close();
  }
});

test('an existing inactive membership is promoted rather than duplicated', async () => {
  const h = await setup();
  try {
    await h.db.exec(`
      insert into public.organizations(id, name) values ('d0000000-0000-4000-8000-00000000000a', 'Existing Org');
      insert into public.organization_members(organization_id, user_id, role, status)
        values ('d0000000-0000-4000-8000-00000000000a', '${OWNER_A}', 'staff', 'removed');
    `);
    const result = await ensure(h);
    assert.equal(result.reason, 'created');
    assert.equal(result.organization_id, 'd0000000-0000-4000-8000-00000000000a', 'the existing organization is reused');
    const members = (await h.db.query('select count(*)::int as n from public.organization_members')).rows[0] as any;
    assert.equal(members.n, 1);
    const member = (await h.db.query(`select role, status from public.organization_members where user_id = '${OWNER_A}'`)).rows[0] as any;
    assert.deepEqual(member, { role: 'owner', status: 'active' });
  } finally {
    await h.close();
  }
});

test('a membership in somebody else\'s organization is never promoted into ownership', async () => {
  const h = await setup();
  try {
    // OWNER_A is plain staff in an organization that also has another member:
    // that is somebody else's tenant, so resolution must leave it alone and
    // give the caller their own organization instead.
    await h.db.exec(`
      insert into auth.users(id, email) values ('d0000000-0000-4000-8000-0000000000ff', 'boss@example.com');
      insert into public.organizations(id, name) values ('d0000000-0000-4000-8000-00000000000b', 'Someone Else');
      insert into public.organization_members(organization_id, user_id, role, status) values
        ('d0000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-0000000000ff', 'owner', 'active'),
        ('d0000000-0000-4000-8000-00000000000b', '${OWNER_A}', 'staff', 'active');
      insert into public.salons(organization_id, slug, name)
        values ('d0000000-0000-4000-8000-00000000000b', 'their-salon', 'Their Salon');
    `);
    const result = await ensure(h, OWNER_A);
    assert.equal(result.provisioned, true);
    assert.notEqual(result.organization_id, 'd0000000-0000-4000-8000-00000000000b', 'a fresh organization is created');
    const staffRow = (
      await h.db.query(
        `select role, status from public.organization_members
         where organization_id = 'd0000000-0000-4000-8000-00000000000b' and user_id = '${OWNER_A}'`
      )
    ).rows[0] as any;
    assert.deepEqual(staffRow, { role: 'staff', status: 'active' }, 'the foreign membership is untouched');
    const own = (await h.asUser(OWNER_A, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(own.organization_id, result.organization_id);
    assert.notEqual(own.slug, 'their-salon');
  } finally {
    await h.close();
  }
});

test('provisioning is refused safely, never with a stack trace, when the schema does not match', async () => {
  const h = await setup();
  try {
    // Drop a column resolution depends on: the function must report instead of
    // raising, because the handoff caller treats this as best-effort.
    await h.db.exec('alter table public.organization_members drop column role');
    const result = await ensure(h);
    assert.equal(result.provisioned, false);
    assert.equal(result.reason, 'schema-incomplete');
    assert.equal(((await h.db.query('select count(*)::int as n from public.salons')).rows[0] as any).n, 0);
  } finally {
    await h.close();
  }
});

test('unauthenticated callers are rejected and clients cannot execute as anon', async () => {
  const h = await setup();
  try {
    await assert.rejects(h.asUser(null, 'select public.ensure_owner_workspace()'), /Sign in required/);
    await assert.rejects(h.asUser(null, 'select public.get_my_owner_workspace()'), /Sign in required/);
    await assert.rejects(h.asRole('anon', 'select public.ensure_owner_workspace()'), /permission denied/);
    await assert.rejects(h.asRole('anon', 'select public.get_my_owner_workspace()'), /permission denied/);
    // Even authenticated callers cannot write the tables directly: there are
    // no policies and no DML grants, so provisioning is RPC-only.
    await assert.rejects(
      h.asUser(OWNER_A, `insert into public.salons(organization_id, slug, name)
        values (gen_random_uuid(), 'sneaky', 'Sneaky')`),
      /row-level security|permission denied/
    );
  } finally {
    await h.close();
  }
});

test('the caller cannot provision or resolve somebody else\'s workspace', async () => {
  const h = await setup();
  try {
    const signature = (
      await h.db.query(
        `select pg_get_function_arguments('public.ensure_owner_workspace()'::regprocedure) as args,
                pg_get_function_arguments('public.get_my_owner_workspace()'::regprocedure) as read_args`
      )
    ).rows[0] as any;
    assert.equal(signature.args, '', 'provisioning takes no user/organization/salon id');
    assert.equal(signature.read_args, '', 'resolution takes no user id');
    await ensure(h, OWNER_A);
    const bView = (await h.asUser(OWNER_B, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(bView.resolved, false, 'a user with no membership resolves nothing');
  } finally {
    await h.close();
  }
});

test('a project that already has the normalized generation is left untouched', async () => {
  const h = await setup({ preCreateNormalized: true });
  try {
    // The pre-existing (deliberately different) definition must survive.
    const before = (
      await h.db.query("select pg_get_functiondef('public.nexora_owner_salon_ids()'::regprocedure) as d")
    ).rows[0] as any;
    assert.match(before.d, /select null::uuid where false/, 'an existing nexora_owner_salon_ids is never replaced');

    // Extra unknown NOT NULL columns must not break provisioning: only columns
    // that actually exist are written.
    const result = await ensure(h);
    assert.equal(result.provisioned, true);
    assert.equal(result.reason, 'created');
    assert.ok(result.salon_id);
    const salon = (await h.db.query('select slug, name, audit_note from public.salons')).rows[0] as any;
    assert.equal(salon.slug, 'glow-studio');
    assert.equal(salon.audit_note, null, 'columns this file knows nothing about keep their defaults');
    const org = (await h.db.query('select billing_email from public.organizations')).rows[0] as any;
    assert.equal(org.billing_email, 'billing@example.com');
  } finally {
    await h.close();
  }
});

test('the migration is re-runnable and preserves provisioned workspaces', async () => {
  const h = await setup();
  try {
    const first = await ensure(h);
    await h.db.exec(MIGRATION);
    const after = await ensure(h);
    assert.equal(after.salon_id, first.salon_id);
    assert.equal(after.reason, 'existing');
    assert.equal(((await h.db.query('select count(*)::int as n from public.salons')).rows[0] as any).n, 1);
  } finally {
    await h.close();
  }
});

test('a provisioned workspace satisfies the completion check\'s normalized branch', async () => {
  const h = await setup();
  try {
    // The exact columns 20260914_template_completion.sql branch 1 probes.
    await h.db.exec(`
      create table public.services (
        id uuid primary key default gen_random_uuid(),
        salon_id uuid references public.salons(id),
        owner_id uuid,
        name text not null,
        is_active boolean not null default true
      );
    `);
    const workspace = await ensure(h);
    // No service yet: resolution works, but the website is not "complete".
    const salonRow = (await h.db.query('select slug, name from public.salons')).rows[0] as any;
    assert.ok(salonRow.slug && salonRow.name, 'the salon is named and slugged, as the completion check requires');
    const membership = (
      await h.db.query(
        `select count(*)::int as n from public.organization_members
         where user_id = '${OWNER_A}' and status = 'active' and role in ('owner','manager')`
      )
    ).rows[0] as any;
    assert.equal(membership.n, 1, 'an active owner membership exists, as the completion check requires');
    // Adding one active service closes the last condition.
    await h.db.query(`insert into public.services(salon_id, name, is_active) values ($1, 'Cut', true)`, [workspace.salon_id]);
    const services = (
      await h.db.query('select count(*)::int as n from public.services where is_active is distinct from false')
    ).rows[0] as any;
    assert.equal(services.n, 1);
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// Multiple salon resolution (PHASE 10, migration 20261006).
//
// Ownership authority is the membership model, and resolution is now a RULE
// rather than a refusal: primary active -> most recently created active ->
// first authorized active -> first authorized. `ambiguous` survives as
// information for the caller ("more than one live salon exists"); it is never a
// reason the caller cannot act, because a target has already been chosen.
// ---------------------------------------------------------------------------

test('a single salon resolves unambiguously and reports its count', async () => {
  const h = await setup();
  try {
    const workspace = await ensure(h);
    const view = (await h.asUser(OWNER_A, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(view.resolved, true);
    assert.equal(view.salon_count, 1);
    assert.equal(view.ambiguous, false);
    assert.equal(view.selection, 'most-recent');
    assert.equal(view.salons.length, 1);
    assert.equal(view.salons[0].salon_id, workspace.salon_id, 'salons[0] is the salon the scalar fields report');
    assert.equal(view.salons[0].slug, 'glow-studio');
  } finally {
    await h.close();
  }
});

test('two salons resolve to the most recent active one, and the list is the caller\'s own', async () => {
  const h = await setup();
  try {
    const workspace = await ensure(h);
    // A second salon in the same organization, e.g. a second location.
    const annexe = await h.db.query(
      `insert into public.salons(organization_id, slug, name, created_at)
       values ($1, 'glow-studio-annexe', 'Glow Studio Annexe', now() + interval '1 day') returning id`,
      [workspace.organization_id]
    );
    const view = (await h.asUser(OWNER_A, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(view.resolved, true, 'several salons are a workspace, not an error');
    assert.equal(view.salon_count, 2);
    assert.equal(view.ambiguous, true, 'informational: more than one live salon exists');
    assert.equal(view.selection, 'most-recent');
    assert.equal(view.salon_id, (annexe.rows[0] as { id: string }).id, 'the most recently created active salon wins');
    assert.equal(view.slug, 'glow-studio-annexe');
    assert.deepEqual(
      view.salons.map((s: any) => s.slug),
      ['glow-studio-annexe', 'glow-studio'],
      'the chosen salon is first, then newest first'
    );
    assert.equal(view.salons[0].salon_id, view.salon_id, 'salons[0] is what the scalar fields report');

    // Another tenant sees none of it.
    await h.db.query(`insert into public.profiles(id, full_name, salon_name) values ('${OWNER_B}', 'Owner B', 'Blow Dry Bar')`);
    await ensure(h, OWNER_B);
    const bView = (await h.asUser(OWNER_B, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(bView.salon_count, 1);
    assert.equal(bView.ambiguous, false);
    assert.ok(!bView.salons.some((s: any) => s.slug.startsWith('glow-studio')));
  } finally {
    await h.close();
  }
});

test('an owner with no salon reports count 0 and ambiguous false, not an error', async () => {
  const h = await setup();
  try {
    const view = (await h.asUser(OWNER_A, 'select public.get_my_owner_workspace() as r')).rows[0].r;
    assert.equal(view.resolved, false);
    assert.equal(view.salon_count, 0);
    assert.equal(view.ambiguous, false);
    assert.equal(view.selection, null);
    assert.deepEqual(view.salons, []);
  } finally {
    await h.close();
  }
});
