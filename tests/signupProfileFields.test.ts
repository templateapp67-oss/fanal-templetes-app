import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// ============================================================================
// 20261003_signup_profile_fields.sql  (PHASE 2 — owner signup audit & fix)
//
// `handle_new_user()` built every new owner's `profiles` row from
// `raw_user_meta_data ->> 'full_name'`, but the onboarding sign-up form never
// sent any metadata — so each account created through the funnel got
// full_name = '', phone_number = NULL and owner_role = NULL. The trigger was
// right; the gateway was not feeding it.
//
// These tests run the REAL migration text against real PostgreSQL (PGlite) so
// the column probe, the generated function body and the trigger re-attachment
// are all executed, not just reviewed.
// ============================================================================

const MIGRATION = await readFile(
  new URL('../supabase/migrations/20261003_signup_profile_fields.sql', import.meta.url),
  'utf8'
);
const HARDENED_MIGRATION = await readFile(
  new URL('../supabase/migrations/20261015_safe_owner_signup_trigger.sql', import.meta.url),
  'utf8'
);

/** The original 00001_init trigger, verbatim, so replacement is observable. */
const ORIGINAL_HANDLE_NEW_USER = `
  create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict (id) do nothing;
    return new;
  end;
  $$;
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created after insert on auth.users
    for each row execute procedure public.handle_new_user();
`;

async function setup(options: { legacyProfiles?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(`
    -- The migration revokes the probe from these roles, so they must exist.
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
      ${options.legacyProfiles ? '' : 'phone_number text, owner_role text,'}
      subdomain text,
      salon_name text
    );
    ${ORIGINAL_HANDLE_NEW_USER}
  `);
  await db.exec(MIGRATION);

  // A legacy `profiles` has neither new column, so project only what exists —
  // the point of that variant is precisely that nothing else changes.
  const columns = await db.query(
    `select string_agg(column_name, ', ' order by column_name) as cols
       from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'`
  );
  const projection = String((columns.rows[0] as any).cols);

  const signUp = async (email: string, metadata: Record<string, unknown>) => {
    const inserted = await db.query(
      `insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [email, JSON.stringify(metadata)]
    );
    const id = (inserted.rows[0] as any).id as string;
    const profile = await db.query(
      `select ${projection} from public.profiles where id = $1`,
      [id]
    );
    return { id, profile: (profile.rows[0] ?? null) as any };
  };

  return { db, signUp, close: async () => { await db.close(); } };
}

test('handle_new_user persists the identity fields the sign-up form sends', async () => {
  const { signUp, close } = await setup();
  try {
    const { profile } = await signUp('owner@example.com', {
      full_name: 'Uma Rao',
      phone_number: '+919845077654',
    });
    assert.ok(profile, 'the trigger created a profiles row');
    assert.equal(profile.full_name, 'Uma Rao');
    assert.equal(profile.phone_number, '+919845077654');
    assert.equal(profile.email, 'owner@example.com');
    // owner_role is deliberately NOT seeded. The canonical owner role is
    // organization_members.role; profiles.owner_role is a display title owned
    // by the template the owner picks. NULL lets src/App.tsx:762
    // (`data.owner_role || prev.ownerRole`) fall through to that title.
    assert.equal(profile.owner_role, null, 'signup must not seed the display title');
  } finally {
    await close();
  }
});

test('a signup carrying no metadata keeps 00001_init\'s empty-string contract', async () => {
  const { signUp, close } = await setup();
  try {
    const { profile } = await signUp('bare@example.com', {});
    // 00001_init wrote coalesce(..., '') — never NULL — and nothing downstream
    // depends on that changing. Phone stays NULL when none was supplied.
    assert.equal(profile.full_name, '');
    assert.equal(profile.phone_number, null);
    assert.equal(profile.owner_role, null);
  } finally {
    await close();
  }
});

test('blank and whitespace-only metadata is normalised, not stored verbatim', async () => {
  const { signUp, close } = await setup();
  try {
    const { profile } = await signUp('blank@example.com', {
      full_name: '   ',
      phone_number: '   ',
    });
    assert.equal(profile.full_name, '');
    assert.equal(profile.phone_number, null, 'a blank phone must not become a blank string');
  } finally {
    await close();
  }
});

test('the migration survives a profiles table that predates the new columns', async () => {
  // A project whose `profiles` never gained phone_number / owner_role must not
  // have its signup trigger broken by this migration.
  const { signUp, close } = await setup({ legacyProfiles: true });
  try {
    const { profile } = await signUp('legacy@example.com', {
      full_name: 'Legacy Owner',
      phone_number: '+919845077654',
    });
    assert.equal(profile.full_name, 'Legacy Owner');
    assert.equal('phone_number' in profile, false, 'no phantom column');
    assert.equal('owner_role' in profile, false, 'no phantom column');
  } finally {
    await close();
  }
});

test('the trigger stays idempotent and never overwrites an existing profile', async () => {
  const { db, signUp, close } = await setup();
  try {
    const { id } = await signUp('first@example.com', { full_name: 'First Name' });

    // Re-running the migration must not duplicate the trigger or the row.
    await db.exec(MIGRATION);
    const triggers = await db.query(
      `select count(*)::int as n from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal`
    );
    assert.equal((triggers.rows[0] as any).n, 1, 'exactly one on_auth_user_created trigger');

    // Exercise the `on conflict (id) do nothing` branch: pre-seed a profile for
    // an id that has no auth user yet (FK dropped for the setup only), then let
    // the trigger run against it.
    const presetId = 'd0000000-0000-4000-8000-0000000000aa';
    await db.exec(`alter table public.profiles drop constraint profiles_id_fkey;`);
    await db.query(
      `insert into public.profiles(id, full_name, owner_role) values ($1, 'Pre-existing', 'Chosen Later')`,
      [presetId]
    );
    await db.query(
      `insert into auth.users(id, email, raw_user_meta_data) values ($1, 'preset@example.com', $2::jsonb)`,
      [presetId, JSON.stringify({ full_name: 'Should Not Win', phone_number: '+910000000000' })]
    );
    const preset = await db.query(`select full_name, owner_role from public.profiles where id = $1`, [presetId]);
    const row = preset.rows[0] as any;
    assert.equal(row.full_name, 'Pre-existing', 'an existing profile is left alone');
    assert.equal(row.owner_role, 'Chosen Later', 'a role the owner chose is not clobbered');

    const count = await db.query(`select count(*)::int as n from public.profiles where id = $1`, [id]);
    assert.equal((count.rows[0] as any).n, 1);
  } finally {
    await close();
  }
});

test('handle_new_user keeps its SECURITY DEFINER + fixed search_path', async () => {
  const { db, close } = await setup();
  try {
    const res = await db.query(
      `select p.prosecdef, p.proconfig::text as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'handle_new_user'`
    );
    const row = res.rows[0] as any;
    assert.equal(row.prosecdef, true, 'the trigger must stay SECURITY DEFINER');
    assert.match(String(row.config), /search_path=public/);
  } finally {
    await close();
  }
});

test('the column probe is not callable by anon or authenticated', async () => {
  const { db, close } = await setup();
  try {
    await db.exec(`grant usage on schema public to anon, authenticated;`);
    const res = await db.query(
      `select has_function_privilege('anon', 'public.owner_signup_profiles_has_column(text)', 'EXECUTE') as anon_ok,
              has_function_privilege('authenticated', 'public.owner_signup_profiles_has_column(text)', 'EXECUTE') as auth_ok`
    );
    const row = res.rows[0] as any;
    assert.equal(row.anon_ok, false, 'revoked from anon');
    assert.equal(row.auth_ok, false, 'revoked from authenticated');
  } finally {
    await close();
  }
});

test('the hardened trigger keeps Auth creation alive when the optional profile write fails', async () => {
  const { db, close } = await setup();
  try {
    await db.exec(HARDENED_MIGRATION);
    // Simulate a production-only profile constraint drift. Auth still gets its
    // user row; the trigger logs a warning rather than aborting signup.
    await db.exec(`alter table public.profiles add constraint profiles_reject_all check (false);`);
    await db.query(
      `insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb)`,
      ['trigger-safe@example.com', JSON.stringify({ full_name: 'Safe Owner', referral_code: 'NEXORA-3E038732' })]
    );
    const user = await db.query(`select email from auth.users where email = 'trigger-safe@example.com'`);
    assert.equal((user.rows[0] as any).email, 'trigger-safe@example.com');
  } finally {
    await close();
  }
});
