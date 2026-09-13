import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// ============================================================================
// PHASE 2.3 — SIGNUP RECOVERY MUST NOT CREATE DUPLICATES
//
// Every path that can re-enter provisioning after a partial or interrupted
// signup:
//
//   profile missing            -> the row is created
//   profile already exists     -> it is left alone (never overwritten)
//   auth user already created  -> no second profile row, no second anything
//   workspace partially
//     provisioned              -> the missing piece is completed IN PLACE,
//                                 never by creating a second organization
//
// All of it runs against real PostgreSQL (PGlite) with the real migrations.
// ============================================================================

const MIGRATION_20261002 = await readFile(
  new URL('../supabase/migrations/20261002_owner_workspace_provisioning.sql', import.meta.url),
  'utf8'
);
const MIGRATION_20261003 = await readFile(
  new URL('../supabase/migrations/20261003_signup_profile_fields.sql', import.meta.url),
  'utf8'
);

// Pre-seeded in the harness so `organization_members.user_id` has a target.
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
// NOT pre-seeded: the signup tests need a real auth.users INSERT so the
// handle_new_user() trigger actually fires.
const NEW_A = 'b0000000-0000-4000-8000-000000000001';
const NEW_B = 'b0000000-0000-4000-8000-000000000002';

async function setup(withAuthUsers: boolean) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    -- organization_members.user_id references auth.users(id), so both actors
    -- must exist before any provisioning can be exercised.
    insert into auth.users(id, email) values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com'),
                                              ('a0000000-0000-4000-8000-000000000002', 'other@example.com');
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text,
      email text,
      phone_number text,
      owner_role text,
      salon_name text
    );
  `);
  await db.exec(MIGRATION_20261002);
  if (withAuthUsers) await db.exec(MIGRATION_20261003);

  const asUser = async (userId: string | null, sql: string, params: unknown[] = []) => {
    await db.query(`select set_config('request.jwt.claim.sub', ${userId ? `'${userId}'` : "''"}, false)`);
    await db.exec('set role authenticated');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role');
    }
  };
  const ensure = async () => {
    const res = await asUser(OWNER, 'select public.ensure_owner_workspace() as r');
    return (res.rows[0] as any).r as Record<string, any>;
  };
  const counts = async () => {
    const org = await db.query('select count(*)::int as n from public.organizations');
    const mem = await db.query('select count(*)::int as n from public.organization_members');
    const salon = await db.query('select count(*)::int as n from public.salons');
    return {
      organizations: (org.rows[0] as any).n,
      memberships: (mem.rows[0] as any).n,
      salons: (salon.rows[0] as any).n,
    };
  };
  // A trigger function can only be driven by a trigger, so replay it honestly:
  // an insert on a table carrying the columns handle_new_user() reads fires the
  // real function body with a real NEW record.
  const replayTrigger = async (id: string, meta: Record<string, unknown>) => {
    await db.exec(`
      create table if not exists public.trigger_replay (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      drop trigger if exists on_replay on public.trigger_replay;
      create trigger on_replay before insert on public.trigger_replay
        for each row execute function public.handle_new_user();
    `);
    await db.query(
      `insert into public.trigger_replay(id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
      [id, 'replayed@example.com', JSON.stringify(meta)]
    );
  };
  const profileCount = async () => {
    const res = await db.query('select count(*)::int as n from public.profiles');
    return (res.rows[0] as any).n as number;
  };
  return { db, asUser, ensure, counts, profileCount, replayTrigger, close: () => db.close() };
}

const insertUser = (db: PGlite, id: string, email: string, meta: Record<string, unknown>) =>
  db.query(`insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [
    id,
    email,
    JSON.stringify(meta),
  ]);

// ---------------------------------------------------------------------------
// profile missing / profile already exists / auth user already created
// ---------------------------------------------------------------------------

test('a fresh signup creates exactly one profile row with the supplied identity', async () => {
  const h = await setup(true);
  try {
    await insertUser(h.db, NEW_A, 'fresh-a@example.com', {
      full_name: 'Uma Rao',
      phone_number: '+919845077654',
    });
    assert.equal(await h.profileCount(), 1);
    const row = (await h.db.query('select full_name, phone_number, owner_role from public.profiles')).rows[0] as any;
    assert.equal(row.full_name, 'Uma Rao');
    assert.equal(row.phone_number, '+919845077654');
    assert.equal(row.owner_role, null);
  } finally {
    await h.close();
  }
});

test('profile already exists: re-firing the trigger does not overwrite it', async () => {
  const h = await setup(true);
  try {
    await insertUser(h.db, NEW_A, 'signup-retry@example.com', { full_name: 'Uma Rao' });
    // The owner later edits their name (this is what the editor saves).
    await h.db.query(`update public.profiles set full_name = 'Uma R. (edited)' where id = $1`, [NEW_A]);

    // A retried signup -- a network retry that actually landed, or a restored
    // queue -- fires handle_new_user() again for the same id, with different
    // metadata. The contract is `on conflict (id) do nothing`.
    await h.replayTrigger(NEW_A, { full_name: 'ATTACKER NAME', phone_number: '+910000000000' });

    assert.equal(await h.profileCount(), 1, 'no duplicate profile row');
    const row = (await h.db.query('select full_name from public.profiles where id = $1', [NEW_A])).rows[0] as any;
    assert.equal(row.full_name, 'Uma R. (edited)', 'a re-fired trigger must not clobber later edits');
  } finally {
    await h.close();
  }
});

test('profile missing: re-firing the trigger creates the row', async () => {
  const h = await setup(true);
  try {
    await insertUser(h.db, NEW_A, 'signup-retry2@example.com', {
      full_name: 'Uma Rao',
      phone_number: '+919845077654',
    });
    // Simulate a row that went missing (trigger predating the migration, or a
    // rolled-back insert) and then a recovered signup firing again.
    await h.db.query('delete from public.profiles where id = $1', [NEW_A]);
    assert.equal(await h.profileCount(), 0);

    await h.replayTrigger(NEW_A, { full_name: 'Uma Rao', phone_number: '+919845077654' });
    assert.equal(await h.profileCount(), 1, 'the missing row is recreated');
    const row = (await h.db.query('select full_name, phone_number from public.profiles where id = $1', [NEW_A])).rows[0] as any;
    assert.equal(row.full_name, 'Uma Rao');
    assert.equal(row.phone_number, '+919845077654');
  } finally {
    await h.close();
  }
});

test('auth user already created: distinct addresses stay separate', async () => {
  const h = await setup(true);
  try {
    await insertUser(h.db, NEW_A, 'first@example.com', { full_name: 'Uma Rao' });
    await insertUser(h.db, NEW_B, 'second@example.com', { full_name: 'Other Owner' });
    assert.equal(await h.profileCount(), 2, 'one profile per auth user');
    const rows = (await h.db.query('select full_name from public.profiles order by full_name')).rows as any[];
    assert.deepEqual(rows.map((r) => r.full_name), ['Other Owner', 'Uma Rao']);
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// workspace partially provisioned
// ---------------------------------------------------------------------------

test('provisioning is idempotent: repeated calls create nothing new', async () => {
  const h = await setup(false);
  try {
    const first = await h.ensure();
    assert.equal(first.provisioned, true);
    assert.equal(first.reason, 'created');
    const after = await h.counts();
    assert.deepEqual(after, { organizations: 1, memberships: 1, salons: 1 });

    for (let i = 0; i < 5; i += 1) {
      const again = await h.ensure();
      assert.equal(again.reason, 'existing', `call ${i + 2}`);
      assert.equal(again.provisioned, false);
      assert.equal(again.salon_id, first.salon_id, 'the same salon every time');
    }
    assert.deepEqual(await h.counts(), after, 'no duplicate organization, membership or salon');
  } finally {
    await h.close();
  }
});

test('partial: membership exists but the salon is missing -> salon created in the SAME org', async () => {
  const h = await setup(false);
  try {
    const first = await h.ensure();
    // Simulate the interrupted case: the salon insert never happened.
    await h.db.query('delete from public.salons');
    assert.deepEqual(await h.counts(), { organizations: 1, memberships: 1, salons: 0 });

    const repaired = await h.ensure();
    assert.equal(repaired.reason, 'created');
    assert.equal(repaired.organization_id, first.organization_id, 'reuses the existing organization');
    assert.equal(await h.counts().then((c) => c.organizations), 1, 'no second organization');
    assert.equal(await h.counts().then((c) => c.memberships), 1, 'no second membership');
    assert.equal(await h.counts().then((c) => c.salons), 1);
  } finally {
    await h.close();
  }
});

test('partial: salon exists but the membership is inactive -> promoted, not duplicated', async () => {
  const h = await setup(false);
  try {
    const first = await h.ensure();
    await h.db.query(`update public.organization_members set status = 'invited', role = 'staff'`);

    // An inactive membership does not resolve, so the workspace looks empty…
    const ids = await h.asUser(OWNER, 'select public.nexora_owner_salon_ids() as id');
    assert.equal(ids.rows.length, 0);

    const repaired = await h.ensure();
    assert.equal(repaired.organization_id, first.organization_id, 'the same organization is reused');
    assert.equal(repaired.salon_id, first.salon_id, 'and the same salon comes back');
    assert.deepEqual(await h.counts(), { organizations: 1, memberships: 1, salons: 1 });
    const member = (await h.db.query('select role, status from public.organization_members')).rows[0] as any;
    assert.equal(member.status, 'active');
    assert.equal(member.role, 'owner');
  } finally {
    await h.close();
  }
});

test('partial: soft-deleted salon -> a replacement is created in the same organization', async () => {
  const h = await setup(false);
  try {
    const first = await h.ensure();
    await h.db.query('update public.salons set deleted_at = now()');

    const repaired = await h.ensure();
    assert.equal(repaired.organization_id, first.organization_id);
    assert.notEqual(repaired.salon_id, first.salon_id, 'a new live salon replaces the deleted one');
    assert.equal(await h.counts().then((c) => c.organizations), 1);
  } finally {
    await h.close();
  }
});

test('a membership in somebody else\'s organization is never promoted', async () => {
  // The privilege-escalation guard: an owner whose only membership is in a
  // shared tenant must get their own fresh workspace, not control of it.
  const h = await setup(false);
  try {
    const tenant = (await h.db.query(
      `insert into public.organizations(name) values ('Shared Tenant') returning id`
    )).rows[0] as any;
    await h.db.query(
      `insert into public.organization_members(organization_id, user_id, role, status) values ($1, $2, 'staff', 'active')`,
      [tenant.id, OWNER]
    );
    await h.db.query(
      `insert into public.organization_members(organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')`,
      [tenant.id, OTHER]
    );

    const result = await h.ensure();
    assert.notEqual(result.organization_id, tenant.id, 'must not attach to another tenant');
    const mine = (await h.db.query(
      `select role from public.organization_members where user_id = $1 and organization_id = $2`,
      [OWNER, result.organization_id]
    )).rows[0] as any;
    assert.equal(mine.role, 'owner');
    const inShared = (await h.db.query(
      `select role from public.organization_members where user_id = $1 and organization_id = $2`,
      [OWNER, tenant.id]
    )).rows[0] as any;
    assert.equal(inShared.role, 'staff', 'the shared-tenant role is untouched');
  } finally {
    await h.close();
  }
});

test('provisioning with no display name still succeeds and is idempotent', async () => {
  const h = await setup(false);
  try {
    // No profiles row at all — the fallback name must be used, and a second
    // call must not mint a second salon for it.
    const first = await h.ensure();
    assert.equal(first.name, 'My Salon');
    const second = await h.ensure();
    assert.equal(second.reason, 'existing');
    assert.deepEqual(await h.counts(), { organizations: 1, memberships: 1, salons: 1 });
  } finally {
    await h.close();
  }
});

test('an unauthenticated caller provisions nothing', async () => {
  const h = await setup(false);
  try {
    await assert.rejects(
      h.asUser(null, 'select public.ensure_owner_workspace()'),
      /sign in required|42501/i
    );
    assert.deepEqual(await h.counts(), { organizations: 0, memberships: 0, salons: 0 });
  } finally {
    await h.close();
  }
});
