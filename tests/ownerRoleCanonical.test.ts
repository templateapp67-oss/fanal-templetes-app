import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// ============================================================================
// PHASE 2.2 — how the owner role is actually resolved.
//
// This schema has TWO things called a "role", and confusing them is the bug
// this file exists to prevent:
//
//   profiles.owner_role        text, NULLable, 00001_init:33.
//                              A DISPLAY TITLE ("Founder & Master Stylist"),
//                              owned by the template the owner picks and the
//                              editor. No policy, function or server module
//                              reads it. It grants nothing.
//
//   organization_members.role  text not null default 'owner'
//                              check (role in ('owner','manager','staff')),
//                              20261002:160. THE canonical role.
//                              nexora_owner_salon_ids() filters on it, and
//                              every owner-side write resolves its target
//                              through that function.
//
// So: no `profiles.role` column is ever added, signup never seeds
// `profiles.owner_role`, and demoting the membership must immediately revoke
// the workspace. All of it is exercised here against real PostgreSQL.
// ============================================================================

const MIGRATION = await readFile(
  new URL('../supabase/migrations/20261002_owner_workspace_provisioning.sql', import.meta.url),
  'utf8'
);

const OWNER = 'c0000000-0000-4000-8000-0000000000a1';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table auth.users(id uuid primary key, email text);
    insert into auth.users(id, email) values ('${OWNER}', 'owner@example.com');
    create table public.profiles (
      id uuid primary key,
      full_name text,
      owner_role text,
      business_name text
    );
    insert into public.profiles(id, full_name, business_name)
      values ('${OWNER}', 'Uma Rao', 'Glow Studio');
  `);
  await db.exec(MIGRATION);

  const asUser = async (sql: string, params: unknown[] = []) => {
    await db.query(`select set_config('request.jwt.claim.sub', '${OWNER}', false)`);
    await db.exec('set role authenticated');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role');
    }
  };
  const workspace = async () => {
    const res = await asUser('select public.get_my_owner_workspace() as r');
    // PGlite types rows as unknown under tsc; the shape is asserted below.
    return (res.rows[0] as any).r as Record<string, any>;
  };
  const salonIds = async (): Promise<string[]> => {
    const res = await asUser('select public.nexora_owner_salon_ids() as id');
    return res.rows.map((row: any) => String(row.id));
  };
  return { db, asUser, workspace, salonIds, close: () => db.close() };
}

test('a freshly signed-up user has no workspace and no salon', async () => {
  const h = await setup();
  try {
    const ws = await h.workspace();
    assert.equal(ws.resolved, false);
    assert.equal(ws.salon_count, 0);
    assert.deepEqual(ws.salons, []);
    assert.deepEqual(await h.salonIds(), []);
  } finally {
    await h.close();
  }
});

test('ensure_owner_workspace grants the canonical role: organization_members.role = owner', async () => {
  const h = await setup();
  try {
    const result = await h.asUser('select public.ensure_owner_workspace() as r');
    const ensured = (result.rows[0] as any).r;
    assert.equal(ensured.provisioned, true);
    assert.equal(ensured.reason, 'created');

    const membership = await h.db.query(
      `select role, status from public.organization_members where user_id = $1`,
      [OWNER]
    );
    assert.equal(membership.rows.length, 1, 'exactly one membership');
    assert.equal((membership.rows[0] as any).role, 'owner');
    assert.equal((membership.rows[0] as any).status, 'active');

    const ws = await h.workspace();
    assert.equal(ws.resolved, true);
    assert.equal(ws.salon_count, 1);
    assert.equal((await h.salonIds()).length, 1, 'the resolver now returns the salon');
  } finally {
    await h.close();
  }
});

test('the role column is constrained: an arbitrary role value is rejected', async () => {
  const h = await setup();
  try {
    await h.asUser('select public.ensure_owner_workspace()');
    await assert.rejects(
      h.db.query(`update public.organization_members set role = 'superadmin' where user_id = $1`, [OWNER]),
      /check constraint|organization_members_role_check/i,
      'the check constraint is what keeps the role vocabulary closed'
    );
  } finally {
    await h.close();
  }
});

test('demoting the membership immediately revokes the workspace', async () => {
  const h = await setup();
  try {
    await h.asUser('select public.ensure_owner_workspace()');
    assert.equal((await h.workspace()).resolved, true);

    await h.db.query(
      `update public.organization_members set role = 'staff' where user_id = $1`,
      [OWNER]
    );
    // nexora_owner_salon_ids() keeps only owner/manager, so a demotion takes
    // effect on the very next call — no cache, no client-side flag.
    assert.deepEqual(await h.salonIds(), [], 'a staff member owns no salon');
    const ws = await h.workspace();
    assert.equal(ws.resolved, false, 'resolution follows the role, not the signup');
    assert.equal(ws.salon_count, 0);
  } finally {
    await h.close();
  }
});

test('deactivating the membership revokes it too', async () => {
  const h = await setup();
  try {
    await h.asUser('select public.ensure_owner_workspace()');
    await h.db.query(
      `update public.organization_members set status = 'invited' where user_id = $1`,
      [OWNER]
    );
    assert.deepEqual(await h.salonIds(), []);
    assert.equal((await h.workspace()).resolved, false);
  } finally {
    await h.close();
  }
});

test('profiles.owner_role grants nothing, whatever it says', async () => {
  const h = await setup();
  try {
    // Claim every plausible role string in the display field, with no
    // membership behind it.
    for (const claim of ['owner', 'Owner', 'manager', 'admin', 'superadmin', 'Founder & Master Stylist']) {
      await h.db.query(`update public.profiles set owner_role = $2 where id = $1`, [OWNER, claim]);
      assert.deepEqual(await h.salonIds(), [], `owner_role='${claim}' must not grant a salon`);
      assert.equal(
        (await h.workspace()).resolved,
        false,
        `owner_role='${claim}' must not resolve a workspace`
      );
    }

    // And it cannot be used to escalate once a real membership exists either:
    // the display field is free text, the membership row is the authority.
    await h.asUser('select public.ensure_owner_workspace()');
    await h.db.query(
      `update public.organization_members set role = 'staff' where user_id = $1`,
      [OWNER]
    );
    await h.db.query(`update public.profiles set owner_role = 'owner' where id = $1`, [OWNER]);
    assert.deepEqual(await h.salonIds(), [], 'the display title cannot override a demotion');
  } finally {
    await h.close();
  }
});

test('signup leaves profiles.owner_role NULL so the template owns the title', async () => {
  // The real trigger, against real PostgreSQL: this is the provisioning path a
  // new owner actually takes.
  const db = new PGlite();
  try {
    await db.exec(`
      -- 20261003 revokes its probe helper from these, so they must exist.
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text not null unique,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create table public.profiles (
        id uuid primary key references auth.users(id) on delete cascade,
        full_name text,
        email text,
        phone_number text,
        owner_role text
      );
    `);
    await db.exec(
      await readFile(
        new URL('../supabase/migrations/20261003_signup_profile_fields.sql', import.meta.url),
        'utf8'
      )
    );
    await db.query(
      `insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb)`,
      ['owner@example.com', JSON.stringify({ full_name: 'Uma Rao', phone_number: '+919845077654' })]
    );
    const res = await db.query(`select full_name, phone_number, owner_role from public.profiles`);
    const row = res.rows[0] as any;
    assert.equal(row.full_name, 'Uma Rao', 'identity the owner supplied is persisted');
    assert.equal(row.phone_number, '+919845077654');
    // NULL on purpose: src/App.tsx:762 does `data.owner_role || prev.ownerRole`,
    // so NULL lets the chosen template supply the title instead of the signup
    // installing a generic one that then beats the template.
    assert.equal(row.owner_role, null, 'signup must not seed the display title');
  } finally {
    await db.close();
  }
});
